#!/usr/bin/env bash
#
# F4 - claim contention at N replicas (#2851, epic #2840).
#
# THE QUESTION. Every performance figure OpenLinker has ever published is
# single-replica. ADR-050's own #2594 amendment states the limitation in one
# line - "It bounds one worker PROCESS. Slot accounting is in-process, so N
# replicas multiply every effective cap by N. Size per replica." - and #2302
# has carried it as a caveat ever since. Nothing has ever measured it, for a
# two-line reason: `docker-compose.lab.yml` pinned `container_name:
# lab-worker` on the worker service, and `docker compose up --scale worker=N`
# refuses to scale a service with a fixed container name.
#
# This scenario runs the SAME bulk-lane aggressor at 1 and at 3 replicas and
# reports (a) whether throughput scales, (b) which channel is responsible
# where it does not, and (c) the effective outbound rate at the destination -
# which is the #2302 concern made concrete, since three replicas at
# `OL_LANE_BULK_SCOPE_CAP=8` put 24 concurrent children on one shop.
#
# ---------------------------------------------------------------------------
# DEVIATIONS FROM #2851's OWN PROPOSED DESIGN, and why - read this before the
# numbers, exactly as F2 and F7 ask the reader to do for theirs.
# ---------------------------------------------------------------------------
#
# (1) #2847's F1 throughput scenario, which #2851 says to "re-run at 1 and 3
#     replicas", DOES NOT EXIST in this worktree - `scenarios/` carries f2,
#     f3, f5 and f7 only. The aggressor here is therefore F7's, verbatim and
#     deliberately: 600 real `master.product.syncFromSweep` /
#     `master.inventory.syncFromSweep` jobs (both registered `bulk`,
#     handler-registration.service.ts) against the real `perf-prestashop`
#     connection's six catalogue products. Reusing F7's aggressor is worth
#     more than inventing a new one anyway - it makes this run's 1-replica arm
#     directly comparable with a measurement that has already been published.
#
# (2) #2850 (the metrics exporter) DOES NOT EXIST, so there is no
#     `ol_lane_slots_in_use`, no `ol_event_loop_lag_seconds` and no
#     `ol_claim_loop_ticks_total`. Every substitute used here is named at its
#     own call site:
#       - lane occupancy       -> COUNT(*) over sync_jobs status='running'
#       - per-replica claims   -> sync_jobs.lockedBy, which is why #2851 makes
#                                 the WORKER_ID change a prerequisite
#       - claim-query cost     -> pg_stat_statements, reset per arm
#       - lock waits           -> pg_stat_activity.wait_event_type='Lock'
#       - pool exhaustion      -> pg_stat_activity backend counts + a worker
#                                 log grep for the connectionTimeoutMillis
#                                 error
#       - claim-loop tick rate -> NOT MEASURED. Reported as such. Inferring it
#                                 from claim latency, as F7 had to, answers a
#                                 different question and is not repeated here
#                                 as though it were the same one.
#
# (3) The destination stub (#2846) does not exist either, so the "destination
#     saturation" candidate is measured at the REAL PrestaShop instead - its
#     Apache access log, which the image symlinks to stdout, counted over each
#     arm's own window. That is a better instrument than a stub for this
#     particular question, because #2302's harm is precisely that a real shop
#     sees N x the concurrency an operator sized for.
#
# (4) ROLES. #2851 asks for "exactly one scheduler and one maintenance
#     process". Compose gives every replica of one service the same
#     environment, so a genuine role split needs a second service definition,
#     which docker-compose.lab.yml deliberately does not carry. What makes the
#     absence safe rather than merely tolerated is recorded on the worker's
#     own `OL_WORKER_ROLE` line in that file: the scheduler is
#     env-disabled AND lease-guarded, and StuckJobRecoveryService needs no
#     lease because `requeueStuckJobs` is an idempotent conditional UPDATE on
#     a stale `lockedAt`. This run additionally asserts, in its post-guards,
#     that no requeue actually fired inside either window.
#
# (5) QUEUED DEPTH is #2851's own named confound: the claim has no
#     `(status, jobType, nextRunAt)` covering index, so claim cost grows with
#     depth, and at 3 replicas the queue drains faster, so depth stays lower -
#     which flatters scaling for a reason that has nothing to do with scaling
#     well. It cannot be HELD equal here (the same fixed aggressor is what
#     makes the two arms comparable at all), so it is REPORTED per arm, and
#     the EXPLAIN probe is additionally run at each arm's own observed peak
#     depth so the cost difference is quantified rather than argued about.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LIB_LOG_PREFIX="f4"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PRODUCTS="${PRODUCTS:-20 21 22 23 24 25}"
# Sized to F7's, so the 1-replica arm is directly comparable with
# results-F7-2026-09-06.md's own 600-job drain.
AGGRESSOR_COUNT="${AGGRESSOR_COUNT:-600}"
# Replica counts. 1 and 3 only: #2851's own assumption is that higher counts
# are memory-bound on a single host that also carries Postgres, Redis, MySQL,
# PrestaShop and WooCommerce.
REPLICA_ARMS="${REPLICA_ARMS:-1 3}"
# Depths for the EXPLAIN probe, in addition to each arm's own observed peak.
DEPTH_POINTS="${DEPTH_POINTS:-0 1000}"

MODE="strict"
for arg in "$@"; do
  case "$arg" in
    --smoke) MODE="smoke" ;;
    -h|--help)
      cat <<'USAGE'
Usage: f4-claim-contention.sh [--smoke]

  (no flag)  strict measurement - both replica arms, full aggressor, every
             applicable guard.
  --smoke    tiny aggressor, to prove the harness plumbing (scaling,
             discovery, per-replica attribution) works before spending a
             full run. Smoke results are NEVER written into a results-F4-*.md
             report.
USAGE
      exit 0 ;;
    *) die "unknown argument: $arg" ;;
  esac
done

if [ "$MODE" = "smoke" ]; then
  AGGRESSOR_COUNT=24
  DEPTH_POINTS="0"
fi

[ -n "${PS_CONNECTION_ID:-}" ] || die "PS_CONNECTION_ID not set - source stand-ids.env or export it"
require_tools docker jq curl awk

# ===========================================================================
# Phase 0 - claim exclusive use of the stand FIRST.
# ===========================================================================
guard_stand_exclusive f4-claim-contention

RUN_GROUP="run$(date +%s)"
DIR="$(results_dir_init f4-claim-contention "$RUN_GROUP")"
log "results dir: $DIR"

CONN_IDS="'$PS_CONNECTION_ID'"
ENV_FILE="$REPO_ROOT/.env.lab"
[ -f "$ENV_FILE" ] || die "$ENV_FILE not found - this scenario recreates the worker service, which needs the stand's own env file"

# The posture to restore on exit, captured BEFORE anything is changed. The
# replica count is read from discovery rather than assumed, for the same
# reason lib.sh discovers it: this scenario may not be the thing that brought
# the stand up.
ORIGINAL_REPLICAS="$(discover_worker_containers | wc -w | tr -d ' ')"
[ "$ORIGINAL_REPLICAS" -ge 1 ] || ORIGINAL_REPLICAS=1
# Read from the RUNNING container rather than from .env.lab: the file is a
# request, the container's own environment is what is actually in force, and a
# peer scenario may have flipped one without the other (this stand is shared -
# guard_stand_exclusive serialises SCENARIOS, not every hand on the stand).
ORIGINAL_RUNNER_ENABLED="$(docker exec "$(discover_worker_containers | awk '{print $1}')" printenv WORKER_RUNNER_ENABLED 2>/dev/null || printf '')"
[ -n "$ORIGINAL_RUNNER_ENABLED" ] || \
  ORIGINAL_RUNNER_ENABLED="$(awk -F= '/^WORKER_RUNNER_ENABLED=/{print $2; exit}' "$ENV_FILE" || printf 'false')"
[ -n "$ORIGINAL_RUNNER_ENABLED" ] || ORIGINAL_RUNNER_ENABLED=false
log "stand posture at scenario start: replicas=$ORIGINAL_REPLICAS WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED (both restored on exit)"

# scale_workers <n> <runner-enabled> - recreate ONLY the worker service at N
# replicas. `--no-deps` so postgres/redis/prestashop/woocommerce are never
# touched: guard_stand_exclusive already gives this run the stand, but a bare
# `up -d` would still recreate every service whose config resolves differently
# from THIS worktree's compose file (bind-mount source paths, chiefly), which
# is a far wider blast radius than a replica-count change needs.
scale_workers() {
  local n="$1" runner="$2" tries=0 found
  if grep -q '^WORKER_RUNNER_ENABLED=' "$ENV_FILE"; then
    sed -i "s/^WORKER_RUNNER_ENABLED=.*/WORKER_RUNNER_ENABLED=$runner/" "$ENV_FILE"
  else
    printf 'WORKER_RUNNER_ENABLED=%s\n' "$runner" >> "$ENV_FILE"
  fi
  ( cd "$REPO_ROOT" && docker compose -f docker-compose.lab.yml --env-file .env.lab -p lab \
      up -d --no-deps --scale "worker=$n" worker >/dev/null 2>&1 ) \
    || die "scale_workers: compose refused to scale worker to $n - if it says 'has a container name', docker-compose.lab.yml still pins container_name on the worker service (#2851 removed it)"

  # The discovery cache in lib.sh is now stale by construction: the set of
  # containers just changed. Re-resolve rather than carrying the old list,
  # which would make every later guard read a container that no longer exists.
  WORKER_CONTAINERS=""
  WORKER_CONTAINERS_RESOLVED=0
  _ensure_worker_containers

  found="$(discover_worker_containers | wc -w | tr -d ' ')"
  [ "$found" -eq "$n" ] || die "scale_workers: asked for $n replica(s), discovery found $found [$WORKER_CONTAINERS]"

  # Wait for every replica to have printed its runner startup line, so no arm
  # opens its window against a worker that has not started claiming yet. A
  # disabled runner prints nothing, so that case waits only for the boot.
  if [ "$runner" = "true" ]; then
    local w hits
    for w in $WORKER_CONTAINERS; do
      tries=0
      # `grep -c`, never `grep -q`. `grep -q` exits on its FIRST match, which
      # closes the pipe while `docker logs` is still writing; `docker logs`
      # then dies of SIGPIPE (141) and `set -o pipefail` makes the whole
      # pipeline non-zero EVEN THOUGH THE LINE MATCHED. The bug is invisible
      # while the log is short enough that `docker logs` finishes first, and
      # appears the moment the worker has been up a while - which is exactly
      # how it was found here (one run passed, the next spun to its retry
      # ceiling against a container whose log plainly carried the line).
      # `grep -c` reads its input to the end, so there is no early close.
      # lib.sh's own guard_runner_state avoids it a different way, by piping
      # through `tail -1`.
      while true; do
        hits="$(docker logs "$w" 2>&1 | grep -cF 'Starting sync job runner loop' || true)"
        [ "${hits:-0}" -eq 0 ] || break
        tries=$((tries + 1))
        [ "$tries" -lt 60 ] || die "scale_workers: $w never logged 'Starting sync job runner loop'"
        sleep 1
      done
    done
  else
    sleep 5
  fi
  log "scaled to $n replica(s): [$WORKER_CONTAINERS], runner=$runner"
}

# The restore is written out longhand rather than calling `scale_workers`,
# because that function `die`s on failure - and a `die` inside an EXIT trap
# skips everything after it, which here would be the stand-lock release. A
# cleanup path must not be able to abort itself.
f4_on_exit() {
  log "restoring stand: replicas=$ORIGINAL_REPLICAS WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED"
  if [ -f "$ENV_FILE" ]; then
    sed -i "s/^WORKER_RUNNER_ENABLED=.*/WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED/" "$ENV_FILE" 2>/dev/null || true
  fi
  ( cd "$REPO_ROOT" && docker compose -f docker-compose.lab.yml --env-file .env.lab -p lab \
      up -d --no-deps --scale "worker=$ORIGINAL_REPLICAS" worker >/dev/null 2>&1 ) \
    || warn "could not restore the worker posture - the stand is left at whatever the last arm set (replicas: [$(discover_worker_containers)])"
  release_stand_exclusive
}
# One trap, both cleanups: bash's EXIT trap is a single slot, so a second
# `trap ... EXIT` REPLACES guard_stand_exclusive's own release and leaves the
# stand locked for the full TTL after any `die` (F7 found this the hard way).
trap f4_on_exit EXIT

# ===========================================================================
# EXPLAIN probe - the missing (status, jobType, nextRunAt) index, #2851's
# second DB-side candidate. Reproduces claimDueJobs's exact query
# (sync-job.repository.ts) inside BEGIN/ROLLBACK, so nothing persists.
# ===========================================================================
BULK_TYPES_SQL="'master.product.syncFromSweep','master.inventory.syncFromSweep'"
REALTIME_TYPES="'fulfillment.work.dispatch','fulfillment.work.statusSync','invoicing.paymentStatus.refreshByExternalId','marketplace.offer.pauseStale','marketplace.offer.pollCreationStatus','marketplace.offer.refreshSnapshot','marketplace.offer.stockRestore','marketplace.offer.updateFields','marketplace.offerQuantity.update','marketplace.order.fxStamp','marketplace.order.sync','marketplace.return.sync','marketplace.shipment.syncByExternalId','master.inventory.syncByExternalId','master.product.syncByExternalId'"

explain_claim_at_depth() {
  local depth="$1" label="$2"
  local out exec_ms plan_ms
  out="$(docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 <<SQL 2>&1
BEGIN;
INSERT INTO sync_jobs
  ("jobType","connectionId","payloadJson","status","idempotencyKey","attempts","maxAttempts","nextRunAt")
SELECT
  'master.product.syncFromSweep', '$PS_CONNECTION_ID'::uuid, '{}'::jsonb, 'queued',
  'f4:depth:' || gs::text || ':' || md5(random()::text), 0, 1,
  now() - interval '2 seconds'
FROM generate_series(1, $depth) gs;
INSERT INTO sync_jobs
  ("jobType","connectionId","payloadJson","status","idempotencyKey","attempts","maxAttempts","nextRunAt")
VALUES
  ('master.product.syncByExternalId', '$PS_CONNECTION_ID'::uuid, '{}'::jsonb, 'queued',
   'f4:depth:probe:' || md5(random()::text), 0, 1, now());
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM sync_jobs
WHERE status = 'queued' AND "nextRunAt" <= now()
  AND "jobType" = ANY(ARRAY[$REALTIME_TYPES])
ORDER BY "nextRunAt" ASC
LIMIT 2
FOR UPDATE SKIP LOCKED;
ROLLBACK;
SQL
)"
  printf '%s\n' "$out" >> "$DIR/depth-vs-claim.raw.log"
  exec_ms="$(printf '%s' "$out" | grep -oP 'Execution Time: \K[0-9.]+' | tail -1 || printf '')"
  plan_ms="$(printf '%s' "$out" | grep -oP 'Planning Time: \K[0-9.]+' | tail -1 || printf '')"
  printf '%s,%s,%s,%s\n' "$label" "$depth" "${exec_ms:-NA}" "${plan_ms:-NA}" >> "$DIR/depth-vs-claim.csv"
  log "  EXPLAIN depth=$depth ($label): execution=${exec_ms:-NA}ms planning=${plan_ms:-NA}ms"
}

# ===========================================================================
# Per-arm samplers. All three run at ~1 Hz for the whole of an arm's window.
# ===========================================================================
CLAIM_LOG="$DIR/claims-by-replica.csv"
printf 'ts,arm,locked_by,running_count\n' > "$CLAIM_LOG"
DEPTH_LOG="$DIR/queue-depth.csv"
printf 'ts,arm,queued_due,running,lock_waits,pg_backends\n' > "$DEPTH_LOG"
_ARM_SAMPLER_PID=""

arm_sampler_start() {
  local arm="$1"
  (
    while true; do
      # Per-replica attribution. `lockedBy` is CLEARED on every terminal
      # transition (sync-job.repository.ts markSucceeded/markFailed/markDead
      # all set it null - F7 found this), so it can only be observed live,
      # never read back after the drain.
      local rows k n
      rows="$(pg_sql "SELECT COALESCE(\"lockedBy\",'<null>') || '|' || COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$PS_CONNECTION_ID' AND status='running' GROUP BY \"lockedBy\"" 2>/dev/null || printf '')"
      if [ -n "$rows" ]; then
        while IFS= read -r line; do
          [ -n "$line" ] || continue
          k="${line%|*}"; n="${line##*|}"
          printf '%s,%s,%s,%s\n' "$(iso_now)" "$arm" "$k" "$n" >> "$CLAIM_LOG"
        done <<<"$rows"
      fi

      local queued running waits backends
      queued="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$PS_CONNECTION_ID' AND status='queued' AND \"nextRunAt\"<=NOW()" 2>/dev/null || printf 0)"
      running="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$PS_CONNECTION_ID' AND status='running'" 2>/dev/null || printf 0)"
      # Lock waits on sync_jobs. The claim uses FOR UPDATE SKIP LOCKED, so
      # this should read ~0; a non-zero reading is itself the finding and is
      # reported as one rather than smoothed away (#2851's own instruction).
      waits="$(pg_sql "SELECT COUNT(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND datname='$PG_DB'" 2>/dev/null || printf 0)"
      backends="$(pg_sql "SELECT COUNT(*) FROM pg_stat_activity WHERE datname='$PG_DB'" 2>/dev/null || printf 0)"
      printf '%s,%s,%s,%s,%s,%s\n' "$(iso_now)" "$arm" "${queued:-0}" "${running:-0}" "${waits:-0}" "${backends:-0}" >> "$DEPTH_LOG"
      sleep 1
    done
  ) &
  _ARM_SAMPLER_PID=$!
}
arm_sampler_stop() {
  [ -z "$_ARM_SAMPLER_PID" ] || { kill "$_ARM_SAMPLER_PID" >/dev/null 2>&1 || true; wait "$_ARM_SAMPLER_PID" 2>/dev/null || true; }
  _ARM_SAMPLER_PID=""
}

# ===========================================================================
# Aggressor. Identical to F7's, so the 1-replica arm is comparable with a
# published run.
# ===========================================================================
SEQ=0
enqueue_bulk_job() {
  local product jt payload key
  SEQ=$((SEQ + 1))
  # shellcheck disable=SC2086 -- word splitting of PRODUCTS is intended
  product="$(printf '%s\n' $PRODUCTS | awk -v n="$((SEQ % 6))" 'NR==n+1')"
  if [ $((SEQ % 2)) -eq 0 ]; then
    jt="master.product.syncFromSweep"; payload="{\"objectType\":\"Product\",\"externalId\":\"$product\"}"
  else
    jt="master.inventory.syncFromSweep"; payload="{\"objectType\":\"Inventory\",\"externalId\":\"$product\"}"
  fi
  key="f4:bulk:$jt:$SEQ:$(date +%s%N)"
  enqueue_perf_job "$jt" "$PS_CONNECTION_ID" "$payload" "$key" >/dev/null \
    || warn "enqueue_bulk_job #$SEQ failed"
}

# ps_request_count <since-epoch> <until-epoch> - PrestaShop webservice
# requests the shop itself logged inside the window. The image symlinks
# Apache's access log to stdout, so `docker logs` IS the access log. This is
# the #2302 concern made concrete: it is what the destination actually saw.
ps_request_count() {
  docker logs --since "$1" --until "$2" "$PS_CONTAINER" 2>&1 \
    | grep -c -E '"(GET|POST|PUT|PATCH|DELETE) /api/' || true
}

# limiter_degraded_count - the hazard results-C measured and results-D named
# as UNEXERCISED: at `bulk` perScope 8 the shared Redis rate limiter timed out
# 85 times in one window and fell back to a PER-PROCESS in-memory limiter.
# With one replica that still held the shop at its declared 60/min. With N
# replicas a degraded episode paces per process, so the shop-side rate can
# approach N x the declared limit - "Not exercised - this run used one
# replica" (perf/prestashop-baseline/results-D-2026-08-28.md).
#
# `post_guard_limiter_degraded` already DISCARDS a window that sees one of
# these lines, and that is the right verdict for a throughput measurement.
# But the count is also the finding, so it is recorded separately here rather
# than surviving only as a discard reason - a discarded arm whose reason is
# the very effect the arm exists to look for must not read as "no data".
limiter_degraded_count() {
  local w n=0 hit
  for w in $WORKER_CONTAINERS; do
    hit="$(docker logs --since "$1" --until "$2" "$w" 2>&1 \
      | grep -c -F 'falling back to per-process in-memory limiting' || true)"
    n=$((n + hit))
  done
  printf '%s' "$n"
}

# rate_limit_timeout_count - jobs that spent MAX_TOTAL_WAIT_MS (120 s) waiting
# for a slot from the shared per-connection limiter and were requeued
# penalty-free (#1810). This is the sixth channel, and on this stand it is the
# one most likely to bind: `prestashopAdapterManifest.defaultRateLimit` is
# `{requestsPerMinute: 60, maxConcurrent: 4}` and the perf-prestashop
# connection carries no override, so 24 concurrent bulk children at three
# replicas all queue behind ONE globally-enforced limiter. A high count here
# means the lane cap was never the ceiling.
rate_limit_timeout_count() {
  local w n=0 hit
  for w in $WORKER_CONTAINERS; do
    hit="$(docker logs --since "$1" --until "$2" "$w" 2>&1 \
      | grep -c -F 'timed out waiting for a rate-limit slot' || true)"
    n=$((n + hit))
  done
  printf '%s' "$n"
}

# pool_timeout_count - the pool-exhaustion candidate, read from the workers'
# own logs. `connectionTimeoutMillis` defaults to 10s
# (libs/shared/src/database/database.module.ts), and exhaustion surfaces as a
# job failure rather than a stall precisely so it is visible here.
pool_timeout_count() {
  local w n=0 hit
  for w in $WORKER_CONTAINERS; do
    hit="$(docker logs --since "$1" --until "$2" "$w" 2>&1 \
      | grep -c -E 'timeout exceeded when trying to connect|Connection terminated due to connection timeout' || true)"
    n=$((n + hit))
  done
  printf '%s' "$n"
}

SUMMARY="$DIR/arm-summary.csv"
printf 'replicas,jobs,elapsed_secs,jobs_per_sec,peak_queued_due,peak_running,max_lock_waits,peak_pg_backends,distinct_lockedby,ps_requests,ps_requests_per_min,pool_timeouts,limiter_degraded,rate_limit_timeouts,max_deferred,claim_calls,claim_total_ms,claim_mean_ms,drain_result,verdict\n' > "$SUMMARY"

# ===========================================================================
# One arm.
# ===========================================================================
run_arm() {
  local replicas="$1" arm="r$1"
  log "=== ARM: $replicas replica(s) ==="

  scale_workers "$replicas" true
  ol_login

  log "--- pre-flight guards ($arm) ---"
  guard_scheduler_off
  guard_demo_mode_off
  guard_connection_budget
  guard_pool_recorded
  guard_runner_state enabled
  guard_log_level
  guard_perf_max_attempts
  guard_build

  # A leftover row from the previous arm would drain into this one's window.
  pg_sql_write "DELETE FROM sync_jobs WHERE \"connectionId\"='$PS_CONNECTION_ID' AND status IN ('queued','running')" >/dev/null
  guard_queue_empty "$CONN_IDS"
  snapshot_jobs_before "$CONN_IDS"

  # pg_stat_statements is reset PER ARM so the claim-query cost reported for
  # this arm is this arm's, not a running total since the container booted.
  pg_sql "SELECT pg_stat_statements_reset()" >/dev/null 2>&1 || \
    warn "pg_stat_statements_reset() failed - claim-query cost for $arm will be a cumulative figure, not this arm's"

  # A per-arm results directory. `window_start` / `window_stop` /
  # `run_post_guards` each write manifest.json / timeseries.csv / verdict.txt
  # into the directory they are given, so two arms sharing one would leave the
  # second silently overwriting the first's - and the first arm's manifest is
  # exactly the thing that records it ran at a DIFFERENT replica count.
  local arm_dir
  arm_dir="$(results_dir_init f4-claim-contention "$RUN_GROUP/$arm")"

  local extra
  extra="$(jq -n \
    --argjson replicas "$replicas" \
    --argjson aggressor_count "$AGGRESSOR_COUNT" \
    --arg arm "$arm" \
    --arg aggressor_route "600 real master.product.syncFromSweep / master.inventory.syncFromSweep jobs against perf-prestashop (bulk lane) - F7's aggressor verbatim, so the 1-replica arm is comparable with results-F7-2026-09-06.md" \
    --arg products "$PRODUCTS" \
    '{arm:$arm, replicaCount:$replicas, aggressorCount:$aggressor_count, aggressorRoute:$aggressor_route, products:$products,
      metricsExporter:"absent (#2850) - lane occupancy proxied via sync_jobs COUNT(*), per-replica attribution via sync_jobs.lockedBy, claim cost via pg_stat_statements; claim-loop tick rate NOT measured",
      destination:"real PrestaShop (no #2846 stub on this stand) - request count read from its own Apache access log"}')"

  window_start "$arm_dir" f4-claim-contention "$CONN_IDS" "$([ "$MODE" = smoke ] && echo 1 || echo 0)" "$extra"

  log "enqueueing $AGGRESSOR_COUNT bulk-lane jobs"
  local i
  for i in $(seq 1 "$AGGRESSOR_COUNT"); do enqueue_bulk_job; done
  # The cap that #2851's own dependency (#2841's guard_perf_max_attempts)
  # exists to apply, and that has never actually applied on any run before
  # this one - see cap_perf_job_attempts in lib.sh.
  cap_perf_job_attempts

  arm_sampler_start "$arm"
  local drain_start drain_end elapsed drain_result
  drain_start="$(epoch)"
  # `drain_wait` RETURNS 1 on timeout (and marks the stuck rows dead), so
  # under `set -e` an unguarded call would abort the whole run mid-arm and
  # lose the arm that had already completed. A timeout is recorded as the
  # arm's own result instead - a throughput figure taken across one is not
  # comparable and the report must be able to say so.
  # Two traps here, both hit while building this scenario.
  #
  # `drain_wait` writes its per-tick progress to stdout via `log` as well as
  # its one-word verdict, so capturing the lot puts a multi-line blob into a
  # CSV cell - which is what it did on the first run, taking the awk that
  # reads that CSV down with a division by zero. Hence the last line only.
  #
  # And the obvious way to keep the progress visible while doing that -
  # piping through `tee /dev/stderr` - TRUNCATES THE LOG. When stderr is a
  # regular file (`>> run.log 2>&1`), `/dev/stderr` is `/proc/self/fd/2`, and
  # `tee` opens it for writing with O_TRUNC: everything written before that
  # point is erased and `tee` restarts at offset 0. Capture, print, then take
  # the last line - no second writer to the log at all.
  local drain_out
  drain_out="$(drain_wait "$CONN_IDS" || true)"
  printf '%s\n' "$drain_out"
  drain_result="$(printf '%s\n' "$drain_out" | tail -1)"
  drain_end="$(epoch)"
  [ "$drain_result" = "timed_out" ] && warn "arm $arm: drain_wait TIMED OUT - its throughput figure is a floor, not a measurement"
  drain_result="${drain_result:-unknown}"
  arm_sampler_stop
  elapsed=$((drain_end - drain_start))
  [ "$elapsed" -gt 0 ] || elapsed=1

  window_stop "$arm_dir"
  run_post_guards "$arm_dir" "$CONN_IDS" "$(date -u -d "@$WINDOW_START_EPOCH" +%Y-%m-%dT%H:%M:%SZ)" \
    "$WINDOW_START_EPOCH" "$WINDOW_STOP_EPOCH" ""
  local verdict
  # `awk NR==1`, never `| head -1`. `head` exits after its first line, the
  # upstream takes SIGPIPE (141), and `set -o pipefail` makes the whole
  # substitution non-zero under `set -e` - which killed this scenario's first
  # full run stone dead AFTER a 17-minute arm had drained successfully. awk
  # reads to EOF, so there is no early close. Same family as the `grep -q`
  # trap in scale_workers; see docs/lessons.md.
  verdict="$(verdict_read "$arm_dir" | awk 'NR==1{print}')"

  # --- per-arm aggregates -------------------------------------------------
  local peak_queued peak_running max_waits peak_backends distinct_lockedby
  peak_queued="$(awk -F, -v a="$arm" 'NR>1 && $2==a {if ($3+0>m) m=$3+0} END{print m+0}' "$DEPTH_LOG")"
  peak_running="$(awk -F, -v a="$arm" 'NR>1 && $2==a {if ($4+0>m) m=$4+0} END{print m+0}' "$DEPTH_LOG")"
  max_waits="$(awk -F, -v a="$arm" 'NR>1 && $2==a {if ($5+0>m) m=$5+0} END{print m+0}' "$DEPTH_LOG")"
  peak_backends="$(awk -F, -v a="$arm" 'NR>1 && $2==a {if ($6+0>m) m=$6+0} END{print m+0}' "$DEPTH_LOG")"
  distinct_lockedby="$(awk -F, -v a="$arm" 'NR>1 && $2==a && $3!="<null>" {seen[$3]=1} END{print length(seen)}' "$CLAIM_LOG")"

  local ps_reqs ps_rpm pool_to
  ps_reqs="$(ps_request_count "$drain_start" "$drain_end")"
  ps_rpm="$(awk -v r="$ps_reqs" -v s="$elapsed" 'BEGIN{printf "%.1f", r*60/s}')"
  pool_to="$(pool_timeout_count "$drain_start" "$drain_end")"
  local degraded rl_timeouts max_deferred
  degraded="$(limiter_degraded_count "$drain_start" "$drain_end")"
  rl_timeouts="$(rate_limit_timeout_count "$drain_start" "$drain_end")"
  # From the shared sampler's own timeseries (queued rows with a FUTURE
  # nextRunAt): a penalty-free requeue parks a job there, so a rising figure
  # is the queue churning rather than draining.
  max_deferred="$(awk -F, 'NR>1 {if ($6+0>m) m=$6+0} END{print m+0}' "$arm_dir/timeseries.csv" 2>/dev/null || printf 0)"

  # The claim query, identified by its own text rather than by a query id
  # (which is not stable across a pg_stat_statements reset).
  local claim_row claim_calls claim_total claim_mean
  claim_row="$(pg_sql "SELECT calls || '|' || round(total_exec_time::numeric,1) || '|' || round(mean_exec_time::numeric,3) FROM pg_stat_statements WHERE query LIKE '%FOR UPDATE SKIP LOCKED%' AND query LIKE '%sync_jobs%' ORDER BY calls DESC LIMIT 1" 2>/dev/null || printf '')"
  claim_calls="${claim_row%%|*}"; claim_row="${claim_row#*|}"
  claim_total="${claim_row%%|*}"; claim_mean="${claim_row##*|}"
  [ -n "$claim_calls" ] || { claim_calls=NA; claim_total=NA; claim_mean=NA; }

  local rate
  rate="$(awk -v n="$AGGRESSOR_COUNT" -v s="$elapsed" 'BEGIN{printf "%.3f", n/s}')"
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$replicas" "$AGGRESSOR_COUNT" "$elapsed" "$rate" \
    "$peak_queued" "$peak_running" "$max_waits" "$peak_backends" "$distinct_lockedby" \
    "$ps_reqs" "$ps_rpm" "$pool_to" "$degraded" "$rl_timeouts" "$max_deferred" "$claim_calls" "$claim_total" "$claim_mean" "$drain_result" "$verdict" >> "$SUMMARY"

  log "arm $arm: $AGGRESSOR_COUNT jobs in ${elapsed}s (${rate} jobs/s), peak queued=$peak_queued peak running=$peak_running"
  log "arm $arm: distinct lockedBy=$distinct_lockedby (expected $replicas), lock waits max=$max_waits, pg backends peak=$peak_backends, pool timeouts=$pool_to, limiter degraded lines=$degraded"
  log "arm $arm: PrestaShop saw $ps_reqs webservice requests (${ps_rpm}/min) against a declared 60/min, maxConcurrent 4"
  log "arm $arm: rate-limit-slot timeouts=$rl_timeouts, max deferred queue depth=$max_deferred, claim query calls=$claim_calls mean=${claim_mean}ms"
  log "arm $arm: verdict=$verdict"

  # EXPLAIN at the fixed depth points plus this arm's own observed peak, so
  # the queued-depth confound (#2851) is quantified rather than argued about.
  local d
  for d in $DEPTH_POINTS; do explain_claim_at_depth "$d" "$arm"; done
  [ "${peak_queued:-0}" -le 0 ] || explain_claim_at_depth "$peak_queued" "$arm-observed-peak"
}

printf 'label,depth,execution_time_ms,planning_time_ms\n' > "$DIR/depth-vs-claim.csv"

for n in $REPLICA_ARMS; do
  run_arm "$n"
done

# ===========================================================================
# Scaling relationship. Reported as a DIRECTION and a MAGNITUDE BAND with the
# sample size per arm, never as a bounded ratio and never as "linear" without
# evidence (#2851's own AC). n=1 run per arm here, and the report says so.
# ===========================================================================
log "=== scaling ==="
awk -F, 'NR>1 {r[$1]=$4; e[$1]=$3; q[$1]=$10}
  END {
    if (r[1] != "" && r[3] != "") {
      printf "1 replica: %s jobs/s over %ss, PrestaShop saw %s requests\n", r[1], e[1], q[1]
      printf "3 replicas: %s jobs/s over %ss, PrestaShop saw %s requests\n", r[3], e[3], q[3]
      printf "throughput ratio (3/1): %.2fx  [n=1 run per arm - a direction, not a bounded figure]\n", r[3]/r[1]
      printf "destination request ratio (3/1): %.2fx\n", q[3]/q[1]
    } else {
      print "not both arms present - no ratio reported"
    }
  }' "$SUMMARY" | while IFS= read -r l; do log "$l"; done

log "=== F4 run complete: $DIR ==="
log "Write results-F4-<date>.md by hand from: $SUMMARY, $DIR/queue-depth.csv, $DIR/claims-by-replica.csv, $DIR/depth-vs-claim.csv, and each arm's manifest.json/verdict.txt"
