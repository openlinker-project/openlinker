#!/usr/bin/env bash
#
# F7 - cross-lane starvation, the scenario that validates ADR-050 (#2852,
# epic #2840).
#
# ADR-050 decision 2: "Per-lane concurrency caps, never strict priority.
# Every lane can always pull." (docs/architecture/adrs/050-workload-isolation-concurrency-lanes.md:70).
# The operator-facing consequence (docs/architecture-overview.md:267): a
# saturated `bulk` lane "cannot delay a queued `realtime` or `fiscal` job
# beyond its own lane's availability." That claim has never been measured.
# This scenario measures it.
#
# ---------------------------------------------------------------------------
# DEVIATIONS FROM #2852's OWN PROPOSED DESIGN, and why - read this before the
# numbers, exactly as F2's header asks the reader to do for its own scenario.
# ---------------------------------------------------------------------------
#
# (1) #2846 (upstream stubs) and #2849 (multi-variant seed data) DO NOT EXIST
#     in this worktree, and bootstrap.sh's own Allegro connections deliberately
#     ship with OfferManager DISABLED ("Adding OfferManager would arm
#     marketplace.offers.sync ... turning a clean 404 into a retryable
#     CapabilityNotEnabledException", bootstrap.sh:390-394). So "publish 1000
#     products via bulk-create" - the issue's own proposed aggressor - is not
#     reachable on this stand without first building a destination stub and a
#     multi-variant catalogue, neither of which this issue is scoped to build.
#
#     The substitute aggressor is real, safe and requires no stub: it enqueues
#     `master.product.syncFromSweep` / `master.inventory.syncFromSweep`
#     (registered `bulk` lane, apps/worker/src/sync/handlers/handler-registration.service.ts)
#     against the real `perf-prestashop` connection's six catalogue products
#     (ids 20-25, the same six bootstrap.sh already seeds). Each job performs a
#     REAL PrestaShop webservice round trip via `MasterProductSyncService` /
#     `MasterInventorySyncService` - the exact "one unit here is a child job
#     doing a full per-product platform sync (~2-5 s)" cost `bounded-sweep.ts`
#     documents for this job family (docs/architecture-overview.md, Products
#     § "Bounded, resumable master sweeps"). It is real production work, not a
#     synthetic sleep.
#
# (2) The realtime probe is `master.product.syncByExternalId` - the SAME
#     handler class (`MasterProductSyncHandler`), same connection, same real
#     product ids, registered `realtime` instead of `bulk`. This is a better
#     probe than the issue's own proposed one (a webhook-triggered order sync):
#     it makes the only variable between aggressor and probe THE LANE ITSELF,
#     which is exactly what ADR-050 decision 2 makes a claim about. It also
#     means the probe and the aggressor share one connection scope, so the
#     probe is NOT protected by cross-connection scope isolation - if the
#     probe is slow, it is slow for a reason the lane's OWN scope accounting
#     cannot explain (ADR-050's `inFlightByLane` maps lane -> scope -> count
#     independently per lane, so a connection saturating its `bulk` per-scope
#     slots does not touch its `realtime` per-scope count at all - this
#     scenario is designed to prove or disprove exactly that independence
#     holds up in practice, not only in the slot-accounting code).
#
# (3) The fiscal probe is `invoicing.issue` with a deliberately-invalid payload
#     (missing `schemaVersion`/`orderId`/`lines`). `InvoicingIssueHandler`
#     F5-validates the payload BEFORE doing anything else and returns
#     `{outcome:'business_failure'}` on the first bad field
#     (apps/worker/src/sync/handlers/invoicing-issue.handler.ts) - no invoicing
#     connection, no order, no external call, and no retry (it returns rather
#     than throws). This is chosen because no invoicing/fiscalization
#     connection exists on this stand and building one is out of this issue's
#     scope; what is measured is CLAIM latency (`lockedAt - createdAt`), which
#     is fully determined before the payload is even read.
#
# (4) The queued-depth-vs-claim-latency test (#2852's "Channel 2") is run as
#     an ISOLATED SQL experiment, runner DISABLED, using `EXPLAIN (ANALYZE,
#     BUFFERS)` against a `BEGIN ... ROLLBACK`-wrapped transaction that
#     reproduces `claimDueJobs`'s exact query
#     (libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.ts:155-183)
#     byte-for-byte, at 0/1000/10000 synthetic queued `bulk`-lane rows ahead of
#     a `realtime` and a `fiscal` claim. This is MORE direct evidence than
#     running it through the live runner would be (Postgres's own planner
#     reports real execution time with no HTTP/Node overhead in the number),
#     and the transaction rollback means nothing measured here persists or
#     interacts with the live-load arms.
#
# (5) The 3-replica arm is NOT RUN. `docker-compose.lab.yml`'s worker service
#     declares a fixed `container_name: lab-worker` (confirmed by reading the
#     file directly) - `docker compose up --scale worker=3` refuses to scale a
#     service with a fixed container name, and lib.sh's own
#     `WORKER_CONTAINERS` comment names this exact blocker ("A `--scale
#     worker=3` stand (#2854) does not carry a fixed `container_name` per
#     replica"). #2851 (the compose overlay this needs) does not exist in this
#     worktree. This is reported as NOT ESTABLISHED, not silently skipped.
#
# (6) #2850 (the metrics exporter) does not exist in this worktree. There is
#     no `ol_lane_slots_in_use`, no `ol_event_loop_lag_seconds`, no
#     `ol_claim_loop_ticks_total`, no `degraded_mode_entries` counter beyond
#     the log-grep `post_guard_limiter_degraded` already provides. Lane
#     occupancy is proxied by `SELECT COUNT(*) FROM sync_jobs WHERE status=
#     'running' AND "jobType"=ANY(bulk lane types) AND "connectionId"=...` -
#     exactly the fallback #2852's own dependency list names as valid "for
#     lane occupancy only, and only on the 1-replica arm" (which is the only
#     arm this run attempts). Event-loop lag (Channel 1) is NOT measured
#     directly; it is inferred only indirectly, from whether claim latency
#     moves beyond what queued depth and lane accounting predict. This is
#     stated plainly as a gap, not worked around.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_LOG_PREFIX="f7"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PRODUCTS="${PRODUCTS:-20 21 22 23 24 25}"
# Aggressor size. At the documented ~2-5s/job cost and a bulk perScope cap of
# 8 (ADR-050 default, this stand's single real bulk-capable connection),
# AGGRESSOR_COUNT jobs drain in roughly AGGRESSOR_COUNT*3.5/8 seconds - sized
# so that stretches into several minutes, giving the sampler dozens of ticks
# and the probes a real window to fire into.
AGGRESSOR_COUNT="${AGGRESSOR_COUNT:-600}"
# How many realtime/fiscal probes to fire during the loaded window (and,
# identically spaced, during the control window). #2852's own AC: "a single
# measurement is never reported as a percentile" - this is why it is >1.
PROBE_COUNT="${PROBE_COUNT:-12}"
PROBE_INTERVAL_SECS="${PROBE_INTERVAL_SECS:-15}"
# Control-arm trickle rate (#2852 "the idle control is biased toward the
# wrong answer" - a paced trickle keeps runnerLoop spinning instead of
# sleeping POLL_INTERVAL_MS every idle tick).
TRICKLE_INTERVAL_SECS="${TRICKLE_INTERVAL_SECS:-3}"

MODE="strict"
for arg in "$@"; do
  case "$arg" in
    --smoke) MODE="smoke" ;;
    -h|--help)
      cat <<'USAGE'
Usage: f7-lane-starvation.sh [--smoke]

  (no flag)  strict measurement - every applicable guard runs, full
             aggressor size, both depth points, both arms.
  --smoke    tiny aggressor/probe counts, to prove the harness plumbing
             works before spending a full run. NOT a substitute for a
             real measurement; smoke-mode results are never written into
             the results-F7-*.md report.
USAGE
      exit 0 ;;
    *) die "unknown argument: $arg" ;;
  esac
done

if [ "$MODE" = "smoke" ]; then
  AGGRESSOR_COUNT=20
  PROBE_COUNT=3
  PROBE_INTERVAL_SECS=3
  TRICKLE_INTERVAL_SECS=2
fi

[ -n "${PS_CONNECTION_ID:-}" ] || die "PS_CONNECTION_ID not set - source stand-ids.env or export it"

require_tools docker jq curl awk

# ===========================================================================
# Phase 0 - claim exclusive use of the stand FIRST, before anything else
# touches it (guard_stand_exclusive's own header: a peer with write access
# can falsify any later guard before the window opens).
# ===========================================================================
guard_stand_exclusive f7-lane-starvation

RUN_GROUP="run$(date +%s)"
DIR="$(results_dir_init f7-lane-starvation "$RUN_GROUP")"
log "results dir: $DIR"

# Capture the worker's CURRENT runner posture so it can be restored exactly,
# whatever it was, at the end - the task's own instruction ("say what you
# left it at").
ORIGINAL_RUNNER_ENABLED="$(docker exec lab-worker printenv WORKER_RUNNER_ENABLED 2>/dev/null || printf 'false')"
log "worker's runner posture at scenario start: WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED (will be restored on exit)"

restore_runner_posture() {
  local current
  current="$(docker exec lab-worker printenv WORKER_RUNNER_ENABLED 2>/dev/null || printf 'false')"
  if [ "$current" != "$ORIGINAL_RUNNER_ENABLED" ]; then
    log "restoring WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED (was $current)"
    set_runner_enabled "$ORIGINAL_RUNNER_ENABLED"
  fi
}
# NOTE: guard_stand_exclusive (already called above) installed its own
# `trap release_stand_exclusive EXIT` - a second `trap ... EXIT` here would
# REPLACE it, not add to it (bash EXIT trap is a single slot), which is
# exactly the bug this comment now documents having been caught here: an
# earlier version of this script clobbered lib.sh's own cleanup and left the
# stand lock held for the full TTL after any `die`. Both cleanups now run
# from one function.
f7_on_exit() {
  restore_runner_posture
  release_stand_exclusive
}
trap f7_on_exit EXIT

# set_runner_enabled true|false - flips WORKER_RUNNER_ENABLED in .env.lab and
# recreates ONLY lab-worker (never touches api/postgres/redis/prestashop/
# woocommerce - guard_stand_exclusive already guarantees this run has the
# stand to itself, but a full `up -d` would still be a wider blast radius
# than this scenario needs).
set_runner_enabled() {
  local want="$1" env_file="$SCRIPT_DIR/../../../.env.lab"
  [ -f "$env_file" ] || die "set_runner_enabled: $env_file not found"
  if grep -q '^WORKER_RUNNER_ENABLED=' "$env_file"; then
    sed -i "s/^WORKER_RUNNER_ENABLED=.*/WORKER_RUNNER_ENABLED=$want/" "$env_file"
  else
    printf 'WORKER_RUNNER_ENABLED=%s\n' "$want" >> "$env_file"
  fi
  ( cd "$SCRIPT_DIR/../../.." && docker compose -f docker-compose.lab.yml --env-file .env.lab up -d --no-deps worker >/dev/null )
  # Give the process a moment to actually boot and print its startup line
  # before any guard reads it.
  sleep 5
  local tries=0
  until docker logs lab-worker 2>&1 | grep -qF 'Starting sync job runner loop' || [ "$want" = "false" ]; do
    tries=$((tries + 1))
    [ "$tries" -lt 20 ] || die "set_runner_enabled: lab-worker never logged 'Starting sync job runner loop' after enabling"
    sleep 1
  done
}

# ===========================================================================
# Phase 1 - queued-depth vs. claim latency (Channel 2), runner DISABLED.
#
# Reproduces claimDueJobs's exact query (sync-job.repository.ts:155-183)
# inside BEGIN/ROLLBACK so nothing here persists or interacts with any other
# phase. depth = number of synthetic 'bulk'-lane queued rows inserted AHEAD
# (lower nextRunAt) of one realtime-lane and one fiscal-lane candidate row.
# ===========================================================================
REALTIME_TYPES="'fulfillment.work.dispatch','fulfillment.work.route','fulfillment.work.statusSync','invoicing.paymentStatus.refreshByExternalId','marketplace.offer.pauseStale','marketplace.offer.pollCreationStatus','marketplace.offer.refreshSnapshot','marketplace.offer.stockRestore','marketplace.offer.updateFields','marketplace.offerQuantity.update','marketplace.order.fxStamp','marketplace.order.sync','marketplace.return.sync','marketplace.shipment.syncByExternalId','master.inventory.syncByExternalId','master.product.syncByExternalId'"
FISCAL_TYPES="'fiscalization.register','invoicing.issue','invoicing.offlineSubmission.resubmit','invoicing.pendingRecovery.sweep','invoicing.regulatoryStatus.reconcile'"

depth_probe_sql() {
  local depth="$1" lane_types="$2"
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
INSERT INTO sync_jobs
  ("jobType","connectionId","payloadJson","status","idempotencyKey","attempts","maxAttempts","nextRunAt")
SELECT
  'master.product.syncFromSweep', '$PS_CONNECTION_ID'::uuid, '{}'::jsonb, 'queued',
  'f7:depth:' || gs::text || ':' || md5(random()::text), 0, 1,
  now() - interval '2 seconds'
FROM generate_series(1, $depth) gs;

INSERT INTO sync_jobs
  ("jobType","connectionId","payloadJson","status","idempotencyKey","attempts","maxAttempts","nextRunAt")
VALUES
  ('$(printf '%s' "$lane_types" | cut -d"'" -f2)', '$PS_CONNECTION_ID'::uuid, '{}'::jsonb, 'queued',
   'f7:depth:probe:' || md5(random()::text), 0, 1, now());

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM sync_jobs
WHERE status = 'queued' AND "nextRunAt" <= now()
  AND "jobType" = ANY(ARRAY[$lane_types])
ORDER BY "nextRunAt" ASC
LIMIT 2
FOR UPDATE SKIP LOCKED;

ROLLBACK;
SQL
}

run_depth_phase() {
  log "=== Phase 1: queued-depth vs. claim latency (runner disabled, isolated SQL) ==="
  guard_runner_state disabled
  local depths="0 1000 10000"
  [ "$MODE" != "smoke" ] || depths="0 50"
  local depth lane_name lane_types out
  {
    printf 'lane,depth,execution_time_ms,planning_time_ms,rows_examined_heap_fetches\n'
  } > "$DIR/depth-vs-claim.csv"
  for depth in $depths; do
    for lane_name in realtime fiscal; do
      if [ "$lane_name" = "realtime" ]; then lane_types="$REALTIME_TYPES"; else lane_types="$FISCAL_TYPES"; fi
      log "depth=$depth lane=$lane_name: running EXPLAIN ANALYZE (rolled back, nothing persists)"
      out="$(depth_probe_sql "$depth" "$lane_types" 2>&1)"
      printf '%s\n' "$out" >> "$DIR/depth-vs-claim.raw.log"
      local exec_ms plan_ms heap_fetches
      exec_ms="$(printf '%s' "$out" | grep -oP 'Execution Time: \K[0-9.]+' | tail -1 || printf '')"
      plan_ms="$(printf '%s' "$out" | grep -oP 'Planning Time: \K[0-9.]+' | tail -1 || printf '')"
      heap_fetches="$(printf '%s' "$out" | grep -oP 'Heap Fetches: \K[0-9]+' | tail -1 || printf '')"
      printf '%s,%s,%s,%s,%s\n' "$lane_name" "$depth" "${exec_ms:-NA}" "${plan_ms:-NA}" "${heap_fetches:-NA}" >> "$DIR/depth-vs-claim.csv"
      log "  execution_time_ms=${exec_ms:-NA} planning_time_ms=${plan_ms:-NA}"
    done
  done
  log "Phase 1 done: $DIR/depth-vs-claim.csv"
}

run_depth_phase

# ===========================================================================
# Phase 2 - the live-load comparison: control (paced trickle) vs. loaded
# (saturated bulk), at 1 replica. Runner ENABLED for both.
# ===========================================================================
run_depth_phase_done=1

# ol_login exactly once for the whole live-load phase - the token this
# scenario's every enqueue_perf_job / ol_api call reuses (JWT_EXPIRES_IN
# defaults to 1d, comfortably longer than this run). Missing this call is
# not a loud failure: ol_api's `die` on a 401 fires inside the `$(...)`
# command substitution enqueue_perf_job wraps it in, so it kills only that
# SUBSHELL - the parent loop survives and silently records "no id" for every
# single enqueue. Caught on the first real run of this script (every enqueue
# 401'd); recorded here so the next scenario copying this shape does not
# reproduce it.
log "=== enabling worker runner for the live-load phase ==="
set_runner_enabled true

CONN_IDS="'$PS_CONNECTION_ID'"

ol_login
log "=== pre-flight guards (live-load phase) ==="
guard_scheduler_off
guard_demo_mode_off
guard_connection_budget
guard_pool_recorded
guard_runner_state enabled
guard_log_level
guard_perf_max_attempts
guard_build

pg_sql_write "DELETE FROM sync_jobs WHERE \"connectionId\"='$PS_CONNECTION_ID' AND status IN ('queued','running')" >/dev/null
guard_queue_empty "$CONN_IDS"

snapshot_jobs_before "$CONN_IDS"

BULK_TYPES_SQL="'master.product.syncFromSweep','master.inventory.syncFromSweep'"

extra_manifest="$(jq -n \
  --arg aggressor_route "repeated real master.product.syncFromSweep / master.inventory.syncFromSweep jobs against perf-prestashop (bulk lane) - NOT bulk-create (#2846/#2849 not available, see script header)" \
  --argjson aggressor_count "$AGGRESSOR_COUNT" \
  --argjson probe_count "$PROBE_COUNT" \
  --arg products "$PRODUCTS" \
  --arg realtime_probe_type "master.product.syncByExternalId" \
  --arg fiscal_probe_type "invoicing.issue (deliberately-invalid payload, business_failure by design)" \
  '{aggressorRoute:$aggressor_route, aggressorCount:$aggressor_count, probeCount:$probe_count, products:$products,
    realtimeProbeType:$realtime_probe_type, fiscalProbeType:$fiscal_probe_type,
    replicaCount: 1, threeReplicaArm: "NOT RUN - docker-compose.lab.yml pins container_name: lab-worker, --scale refuses; #2851 compose overlay absent from this worktree",
    metricsExporter: "absent (#2850 not in this worktree) - lane occupancy proxied via sync_jobs COUNT(*), event-loop lag not directly measured"}')"

window_start "$DIR" f7-lane-starvation "$CONN_IDS" "$([ "$MODE" = smoke ] && echo 1 || echo 0)" "$extra_manifest"

# bulk lane caps, parsed from MANIFEST_LANE_CAPS (guard_runner_state already
# captured it from the worker's own boot log - "reported === enforced",
# never re-derived from a code constant this scenario could drift from).
# The worker's own boot-log format (sync-job.runner.ts:211-212) is
# "lane=total/perScope", space-separated, e.g.
# "realtime=4/2 bulk=12/8 fiscal=2/1 fan-out=8/4" - NOT the "bulk: {total:.
# perScope:.}" shape an earlier draft of this parse guessed at, which
# silently matched nothing and reported "unknown" for a value guard_runner_state
# had, in fact, already resolved (caught on the first real run of this
# script).
BULK_CAP_TOTAL="$(printf '%s' "$MANIFEST_LANE_CAPS" | grep -oP 'bulk=\K[0-9]+(?=/)' || printf '')"
BULK_CAP_SCOPE="$(printf '%s' "$MANIFEST_LANE_CAPS" | grep -oP 'bulk=[0-9]+/\K[0-9]+' || printf '')"
log "bulk lane caps parsed from live worker: total=${BULK_CAP_TOTAL:-unknown} perScope=${BULK_CAP_SCOPE:-unknown}"
log "NOTE: this run uses ONE real bulk-capable connection (perf-prestashop), so the bulk lane's own per-scope cap (${BULK_CAP_SCOPE:-unknown}) - not its total cap (${BULK_CAP_TOTAL:-unknown}) - is the ceiling this aggressor can reach. A second real ProductMaster/InventoryMaster-capable destination would be needed to saturate the lane TOTAL; this is a stated limitation, not something this run can manufacture without inventing state (see script header (1))."

# ---------------------------------------------------------------------------
# helpers
#
# BUG FOUND AND ROUTED AROUND HERE, not fixed in shared lib.sh (out of this
# scenario's scope to touch under time pressure, and every OTHER scenario
# that has shipped so far reaches OpenLinker through the real webhook/order
# path rather than POST /v1/sync/jobs - this run is apparently the first
# real exercise of lib.sh's `enqueue_perf_job` against a live worker).
#
# `enqueue_perf_job` reads the enqueue response's `.id` field and uses it to
# downgrade that row's maxAttempts via a direct UPDATE ... WHERE id='$job_id'.
# But `EnqueueSyncJobResponseDto` (apps/api/src/sync/http/dto/enqueue-sync-job-response.dto.ts)
# returns `jobId`, not `id` - and that `jobId` is the REDIS STREAM entry id
# (e.g. "1788690321451-0"), not the `sync_jobs` table's UUID primary key,
# because POST /v1/sync/jobs still enqueues onto the `jobs.sync` Redis
# stream and the row is only created later, when `JobIntakeConsumer` drains
# it (#2852's own dependency note: "children are enqueued via Redis Streams
# and reach sync_jobs only through JobIntakeConsumer"). So `.id` is always
# empty, `enqueue_perf_job`'s maxAttempts downgrade always silently no-ops
# (every call in this run logged "response carried no id"), and any caller
# trying to look the row up by that value would never find it either.
#
# The fix used here: track the IDEMPOTENCY KEY this scenario itself
# generates (never the response body), and resolve the real DB row by that
# unique column once the intake consumer has had time to drain it. This is
# also simply a better join key for the analysis phase than a response field
# would have been.
# ---------------------------------------------------------------------------
SEQ=0
enqueue_bulk_job() {
  local product jt payload key
  SEQ=$((SEQ + 1))
  product="$(printf '%s\n' $PRODUCTS | awk -v n="$((SEQ % 6))" 'NR==n+1')"
  if [ $((SEQ % 2)) -eq 0 ]; then jt="master.product.syncFromSweep"; payload="{\"objectType\":\"Product\",\"externalId\":\"$product\"}"
  else jt="master.inventory.syncFromSweep"; payload="{\"objectType\":\"Inventory\",\"externalId\":\"$product\"}"; fi
  key="f7:bulk:$jt:$SEQ:$(date +%s%N)"
  ol_api POST /v1/sync/jobs "{\"jobType\":\"$jt\",\"connectionId\":\"$PS_CONNECTION_ID\",\"payload\":$payload,\"idempotencyKey\":\"$key\"}" >/dev/null \
    || warn "enqueue_bulk_job #$SEQ failed"
}

REALTIME_PROBE_LOG="$DIR/realtime-probes.csv"
FISCAL_PROBE_LOG="$DIR/fiscal-probes.csv"
printf 'arm,seq,enqueued_at,idempotency_key\n' > "$REALTIME_PROBE_LOG"
printf 'arm,seq,enqueued_at,idempotency_key\n' > "$FISCAL_PROBE_LOG"

fire_realtime_probe() {
  local arm="$1" seq="$2" product key
  product="$(printf '%s\n' $PRODUCTS | awk -v n="$((seq % 6))" 'NR==n+1')"
  key="f7:probe:realtime:$arm:$seq:$(date +%s%N)"
  ol_api POST /v1/sync/jobs "{\"jobType\":\"master.product.syncByExternalId\",\"connectionId\":\"$PS_CONNECTION_ID\",\"payload\":{\"objectType\":\"Product\",\"externalId\":\"$product\"},\"idempotencyKey\":\"$key\"}" >/dev/null \
    || warn "fire_realtime_probe $arm/$seq failed"
  printf '%s,%s,%s,%s\n' "$arm" "$seq" "$(iso_now)" "$key" >> "$REALTIME_PROBE_LOG"
}

fire_fiscal_probe() {
  local arm="$1" seq="$2" key
  key="f7:probe:fiscal:$arm:$seq:$(date +%s%N)"
  # Deliberately invalid: no schemaVersion/orderId/lines. InvoicingIssueHandler
  # F5-validates and returns business_failure on the first bad field, with NO
  # retry and NO external call - see script header (3). Only claim latency
  # (lockedAt - createdAt) is being measured here.
  ol_api POST /v1/sync/jobs "{\"jobType\":\"invoicing.issue\",\"connectionId\":\"$PS_CONNECTION_ID\",\"payload\":{\"probe\":\"f7\"},\"idempotencyKey\":\"$key\"}" >/dev/null \
    || warn "fire_fiscal_probe $arm/$seq failed"
  printf '%s,%s,%s,%s\n' "$arm" "$seq" "$(iso_now)" "$key" >> "$FISCAL_PROBE_LOG"
}

# Custom occupancy sampler for the bulk lane on PS_CONNECTION_ID - a SEPARATE
# csv from the shared sample_queue (which already runs via window_start /
# sampler_start and covers queued/running/dead/deferred generically). This one
# is lane-aware, which sample_queue is not.
LANE_TICK_LOG="$DIR/lane-occupancy.csv"
printf 'ts,arm,bulk_running,claim_loop_tick_proxy\n' > "$LANE_TICK_LOG"
_LANE_SAMPLER_PID=""
lane_sampler_start() {
  local arm="$1"
  (
    while true; do
      local running
      running="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$PS_CONNECTION_ID' AND status='running' AND \"jobType\" = ANY(ARRAY[$BULK_TYPES_SQL])" 2>/dev/null || printf 0)"
      printf '%s,%s,%s,\n' "$(iso_now)" "$arm" "${running:-0}" >> "$LANE_TICK_LOG"
      sleep 1
    done
  ) &
  _LANE_SAMPLER_PID=$!
}
lane_sampler_stop() {
  [ -z "$_LANE_SAMPLER_PID" ] || { kill "$_LANE_SAMPLER_PID" >/dev/null 2>&1 || true; wait "$_LANE_SAMPLER_PID" 2>/dev/null || true; }
  _LANE_SAMPLER_PID=""
}

# probe_claim_sampler - queue-wait ("claim latency") CANNOT be read back from
# `sync_jobs.lockedAt` after the fact: the repository CLEARS it to NULL on
# every terminal transition (sync-job.repository.ts, markSucceeded /
# markFailed / markDead all set `lockedAt: null`), so a probe that has
# already finished by the time this scenario gets around to analysing it
# reads back with no claim timestamp at all - discovered on the first real
# run of this script, where every single probe's `queue_wait_ms` came back
# `NA`. The only way left to observe the claim moment is to watch for it
# WHILE the job is still in flight, so this poller runs for the whole
# live-load phase (started once, alongside the lane occupancy sampler, not
# per-arm) and records the first tick at which each `f7:probe:*` row is
# observed to have LEFT `queued`, at ~1s resolution - coarse relative to a
# webservice round trip, but adequate for the multi-second-to-tens-of-
# seconds delays this scenario exists to detect.
PROBE_CLAIM_LOG="$DIR/probe-claims.csv"
printf 'idempotency_key,claimed_at\n' > "$PROBE_CLAIM_LOG"
_PROBE_CLAIM_SEEN_FILE="$DIR/.probe-claim-seen"
: > "$_PROBE_CLAIM_SEEN_FILE"
_PROBE_CLAIM_SAMPLER_PID=""
probe_claim_sampler_start() {
  (
    while true; do
      # Not piped into the while-read below - a nested pg_sql call sharing
      # stdin with an outer `while read` is exactly the bug this whole
      # comment block exists to warn the next reader away from (see
      # analyze_probes below). Captured into a variable first instead.
      local rows k
      rows="$(pg_sql "SELECT \"idempotencyKey\" FROM sync_jobs WHERE \"idempotencyKey\" LIKE 'f7:probe:%' AND status != 'queued'" 2>/dev/null || printf '')"
      if [ -n "$rows" ]; then
        while IFS= read -r k; do
          [ -n "$k" ] || continue
          if ! grep -qxF "$k" "$_PROBE_CLAIM_SEEN_FILE" 2>/dev/null; then
            printf '%s\n' "$k" >> "$_PROBE_CLAIM_SEEN_FILE"
            printf '%s,%s\n' "$k" "$(iso_now)" >> "$PROBE_CLAIM_LOG"
          fi
        done <<<"$rows"
      fi
      sleep 1
    done
  ) &
  _PROBE_CLAIM_SAMPLER_PID=$!
}
probe_claim_sampler_stop() {
  [ -z "$_PROBE_CLAIM_SAMPLER_PID" ] || { kill "$_PROBE_CLAIM_SAMPLER_PID" >/dev/null 2>&1 || true; wait "$_PROBE_CLAIM_SAMPLER_PID" 2>/dev/null || true; }
  _PROBE_CLAIM_SAMPLER_PID=""
}

# cap_and_drain - the guard_perf_max_attempts protection this scenario still
# needs, applied as ONE bulk UPDATE over every row this scenario minted
# (idempotencyKey LIKE 'f7:%'), rather than per-job via enqueue_perf_job's
# broken response.id lookup (see the helpers comment above). Safe to call
# more than once (WHERE status IN queued/running is idempotent), and cheap:
# one indexed-prefix-free LIKE scan on a table this scenario keeps small
# relative to its own connection's rows.
cap_and_drain() {
  pg_sql_write "UPDATE sync_jobs SET \"maxAttempts\"=$PERF_MAX_ATTEMPTS WHERE \"idempotencyKey\" LIKE 'f7:%' AND status IN ('queued','running')" >/dev/null
  drain_wait "$CONN_IDS" >/dev/null
}

# ---------------------------------------------------------------------------
# Control arm: paced trickle (one bulk job every TRICKLE_INTERVAL_SECS),
# never enough to approach the per-scope cap, plus the same probe cadence.
# Keeps the claim loop spinning rather than sleeping POLL_INTERVAL_MS on an
# idle tick (#2852 "the idle control is biased toward the wrong answer").
# ---------------------------------------------------------------------------
run_control_arm() {
  log "=== control arm: paced trickle + probes ==="
  lane_sampler_start control
  local trickle_window=$((PROBE_COUNT * PROBE_INTERVAL_SECS))
  local elapsed=0 probe_seq=0
  local trickle_pid
  (
    while true; do
      enqueue_bulk_job
      sleep "$TRICKLE_INTERVAL_SECS"
    done
  ) &
  trickle_pid=$!
  while [ "$elapsed" -lt "$trickle_window" ]; do
    fire_realtime_probe control "$probe_seq"
    fire_fiscal_probe control "$probe_seq"
    probe_seq=$((probe_seq + 1))
    sleep "$PROBE_INTERVAL_SECS"
    elapsed=$((elapsed + PROBE_INTERVAL_SECS))
  done
  kill "$trickle_pid" >/dev/null 2>&1 || true
  wait "$trickle_pid" 2>/dev/null || true
  lane_sampler_stop
  log "control arm: waiting for drain before the loaded arm"
  cap_and_drain
}

# ---------------------------------------------------------------------------
# Loaded arm: fire the full aggressor burst, then fire probes throughout the
# drain window. AC: "hard abort on a lane that never reached cap, no partial
# numbers reported" - checked after the fact against lane-occupancy.csv.
# ---------------------------------------------------------------------------
run_loaded_arm() {
  log "=== loaded arm: enqueueing $AGGRESSOR_COUNT bulk-lane jobs against perf-prestashop ==="
  local aggressor_enqueue_start aggressor_enqueue_end i
  aggressor_enqueue_start="$(epoch)"
  for i in $(seq 1 "$AGGRESSOR_COUNT"); do
    enqueue_bulk_job
  done
  aggressor_enqueue_end="$(epoch)"
  local enqueue_wall=$((aggressor_enqueue_end - aggressor_enqueue_start))
  log "aggressor enqueue done in ${enqueue_wall}s ($(awk -v n="$AGGRESSOR_COUNT" -v s="$enqueue_wall" 'BEGIN{if(s==0)s=1; printf "%.1f", n/s}') req/s through JobIntakeConsumer's own pacing)"

  lane_sampler_start loaded
  local probe_seq=0
  while [ "$probe_seq" -lt "$PROBE_COUNT" ]; do
    fire_realtime_probe loaded "$probe_seq"
    fire_fiscal_probe loaded "$probe_seq"
    probe_seq=$((probe_seq + 1))
    sleep "$PROBE_INTERVAL_SECS"
  done
  # keep sampling until the bulk backlog actually drains, so the occupancy
  # file covers the whole saturated period, not just the probe-firing window
  log "probes fired; sampling continues until the aggressor's bulk backlog drains"
  cap_and_drain
  lane_sampler_stop
}

probe_claim_sampler_start
run_control_arm
run_loaded_arm
probe_claim_sampler_stop

window_stop "$DIR"
# No k6 summary argument, and the omission is deliberate rather than
# forgotten: this scenario's load is enqueued jobs, not HTTP requests, so
# there is no load generator for post_guard_generator_saturated to check
# (#2933). A scenario that DOES drive k6 must pass its summary path.
run_post_guards "$DIR" "$CONN_IDS" "$(date -u -d "@$WINDOW_START_EPOCH" +%Y-%m-%dT%H:%M:%SZ)" \
  "$WINDOW_START_EPOCH" "$WINDOW_STOP_EPOCH" ""

VERDICT_STATUS="$(verdict_read "$DIR" | head -1)"
log "verdict: $VERDICT_STATUS"

# ===========================================================================
# Analysis - joins the probe logs against (a) sync_jobs for createdAt /
# updatedAt / status / outcome and (b) probe-claims.csv (the live poller
# above) for the claim moment, since `lockedAt` itself is unusable here - see
# the poller's own comment. Written as plain CSV.
#
# TWO real bugs were caught building this function, on the first real run of
# this script, and both are worth stating because the shape recurs:
#
# 1. `queue_wait_ms` computed from `lockedAt` came back NA for every single
#    probe - `sync-job.repository.ts` clears `lockedAt` to NULL on every
#    terminal transition, so a probe already finished by analysis time has
#    no claim timestamp left to read. Fixed by the live poller above instead
#    of a post-hoc read.
#
# 2. `tail -n +2 "$logfile" | while IFS=, read ...; do ... pg_sql ...; done`
#    processed exactly ONE row per file and silently stopped - the loop body
#    calls `pg_sql`, which runs `docker exec -i`, and `-i` means THAT command
#    reads from ITS OWN stdin, which - because the whole `while` sits on the
#    right side of a pipe - IS THE SAME FILE DESCRIPTOR `read` is consuming
#    the CSV from. The first `pg_sql` call inside the loop body drains the
#    rest of the piped CSV out from under `read`. Fixed by reading the CSV on
#    a dedicated file descriptor (`<&3` / `3< <(...)`) instead of the loop's
#    own stdin, so `pg_sql`'s inner `docker exec -i` is left an untouched
#    stdin to read from (in practice, this script's own, which is not the
#    terminal because run_control_arm/run_loaded_arm always run to
#    completion before this function is reached).
# ===========================================================================
analyze_probes() {
  local logfile="$1" out="$2"
  printf 'arm,seq,idempotency_key,created_at,claimed_at,finished_at,queue_wait_ms,total_ms,final_status,outcome\n' > "$out"
  while IFS=, read -r arm seq enq key <&3; do
    [ -n "$key" ] || continue
    local row claimed
    # Joined by idempotencyKey, never a response-body id - see the helpers
    # comment above (enqueue_perf_job's response.id bug).
    row="$(pg_sql "SELECT to_char(\"createdAt\",'YYYY-MM-DD HH24:MI:SS.MS'), to_char(\"updatedAt\",'YYYY-MM-DD HH24:MI:SS.MS'), status, COALESCE(outcome,'') FROM sync_jobs WHERE \"idempotencyKey\"='$key'")"
    if [ -z "$row" ]; then
      printf '%s,%s,%s,,,,NA,NA,MISSING,\n' "$arm" "$seq" "$key" >> "$out"
      continue
    fi
    IFS='|' read -r created finished status outcome <<<"$row"
    claimed="$(awk -F, -v k="$key" '$1==k{print $2; exit}' "$PROBE_CLAIM_LOG")"
    local qwait tmsg
    if [ -n "$claimed" ]; then
      # "$created" is a bare `to_char(...)` string with NO timezone marker -
      # `date -d` interprets that as the HOST's local zone, not UTC (`postgres`
      # session timezone is confirmed UTC, but this workstation's is
      # Europe/Warsaw/CEST, +2h). Every value straight out of Postgres is
      # explicitly disambiguated with a trailing " UTC"; `$claimed` already
      # carries `iso_now()`'s trailing 'Z' and needs none. Caught on the
      # first real run of this script: every probe reported a ~7 200 000 ms
      # (exactly 2 hours) queue wait, which is this exact bug's signature.
      qwait="$(awk -v c="$created" -v l="$claimed" 'BEGIN{ cmd="date -d \x27"c" UTC\x27 +%s.%3N"; cmd|getline cs; close(cmd); cmd="date -d \x27"l"\x27 +%s.%3N"; cmd|getline ls; close(cmd); printf "%.0f", (ls-cs)*1000 }' 2>/dev/null || printf NA)"
    else
      qwait="NA"
    fi
    # Both $created and $finished come straight from Postgres - both need
    # the same " UTC" disambiguation as above.
    tmsg="$(awk -v c="$created" -v f="$finished" 'BEGIN{ cmd="date -d \x27"c" UTC\x27 +%s.%3N"; cmd|getline cs; close(cmd); cmd="date -d \x27"f" UTC\x27 +%s.%3N"; cmd|getline fs; close(cmd); printf "%.0f", (fs-cs)*1000 }' 2>/dev/null || printf NA)"
    printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$arm" "$seq" "$key" "$created" "${claimed:-}" "$finished" "$qwait" "$tmsg" "$status" "$outcome" >> "$out"
  done 3< <(tail -n +2 "$logfile")
}

analyze_probes "$REALTIME_PROBE_LOG" "$DIR/realtime-probes-analyzed.csv"
analyze_probes "$FISCAL_PROBE_LOG" "$DIR/fiscal-probes-analyzed.csv"

# occupancy summary: fraction of loaded-arm samples where bulk_running >=
# BULK_CAP_SCOPE (the ceiling this single-scope aggressor can actually reach -
# see the NOTE above).
occupancy_summary() {
  local cap="${BULK_CAP_SCOPE:-8}"
  awk -F, -v cap="$cap" '
    $2=="loaded" { total++; if ($3+0 >= cap) atcap++ }
    END { if (total==0) { print "0,0,0.0" } else { printf "%d,%d,%.3f\n", atcap, total, atcap/total } }
  ' "$LANE_TICK_LOG"
}
OCCUPANCY_LINE="$(occupancy_summary)"
OCC_ATCAP="$(printf '%s' "$OCCUPANCY_LINE" | cut -d, -f1)"
OCC_TOTAL="$(printf '%s' "$OCCUPANCY_LINE" | cut -d, -f2)"
OCC_FRACTION="$(printf '%s' "$OCCUPANCY_LINE" | cut -d, -f3)"
log "bulk lane (perf-prestashop scope) at per-scope-cap for $OCC_ATCAP/$OCC_TOTAL samples (${OCC_FRACTION})"

# stats over a CSV column - min/mean/median/p95/max, awk-only (no bc/python
# dependency, matching lib.sh's own convention).
#
# gawk's `asort()` renumbers its array 1..n on output REGARDLESS of the
# indices it was built with - an earlier version of this function built
# `vals[n++]` (0-based: 0..n-1) and then read `vals[0]`/`vals[n-1]` back
# after sorting, which after renumbering are the WRONG ends of the sorted
# array (`vals[0]` is unset/0, `vals[n-1]` is the second-highest, not the
# highest). Caught by hand-testing this function against a 2-row fixture
# before the first real run, where it reported min=0/max=80 for values
# {80,120}. Every index below is 1-based to match what `asort` actually
# produces.
column_stats() {
  local csv="$1" col="$2" arm="$3"
  awk -F, -v col="$col" -v arm="$arm" '
    NR==1 { next }
    $1==arm && $(col) != "NA" && $(col) != "" { vals[++n]=$(col)+0 }
    END {
      if (n==0) { print "n=0"; exit }
      asort(vals)
      sum=0; for(i=1;i<=n;i++) sum+=vals[i]
      mean=sum/n
      p50idx=int(n*0.5); if (p50idx<1) p50idx=1; if (p50idx>n) p50idx=n
      p95idx=int(n*0.95)+1; if (p95idx<1) p95idx=1; if (p95idx>n) p95idx=n
      printf "n=%d min=%.0f mean=%.0f median=%.0f p95=%.0f max=%.0f\n", n, vals[1], mean, vals[p50idx], vals[p95idx], vals[n]
    }
  ' "$csv"
}

log "--- realtime probe queue-wait (ms), control ---"; column_stats "$DIR/realtime-probes-analyzed.csv" 7 control
log "--- realtime probe queue-wait (ms), loaded  ---"; column_stats "$DIR/realtime-probes-analyzed.csv" 7 loaded
log "--- fiscal probe queue-wait (ms), control   ---"; column_stats "$DIR/fiscal-probes-analyzed.csv" 7 control
log "--- fiscal probe queue-wait (ms), loaded    ---"; column_stats "$DIR/fiscal-probes-analyzed.csv" 7 loaded

log "=== F7 run complete: $DIR ==="
log "Write results-F7-<date>.md by hand from: $DIR/manifest.json, $DIR/verdict.txt, $DIR/depth-vs-claim.csv, $DIR/lane-occupancy.csv, $DIR/realtime-probes-analyzed.csv, $DIR/fiscal-probes-analyzed.csv, $DIR/timeseries.csv"
