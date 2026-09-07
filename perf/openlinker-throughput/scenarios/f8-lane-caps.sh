#!/usr/bin/env bash
#
# F8 - lane cap SATURATION, the three lanes #2594 left illustrative (#2867,
# epic #2840).
#
# ADR-050 decision 6: "Cap values are illustrative until they are measured. A
# cap without a metric is a guess." Exactly one lane has since stopped being a
# guess - `bulk`, from #2594's interleaved A/B run. ADR-050's own
# § Amendment (#2851 / #2867) then names, per lane, the measurement that is
# missing:
#
#   realtime  4/2  ILLUSTRATIVE - "a saturation run: many concurrent
#                  marketplace.order.sync against one destination, finding the
#                  concurrency at which per-order latency degrades."
#   fiscal    2/1  ILLUSTRATIVE - "a run against a real invoicing or
#                  fiscalization connection issuing real documents."
#   fan-out   8/4  DERIVED      - "a sustained stock-write load that isolates
#                  this lane."
#
# This scenario is that saturation run. It sweeps ONE lane's per-scope cap
# across a list of values, one worker recreate per value, and reports
# throughput and per-job latency at each point - so the knee (the concurrency
# past which added slots stop buying throughput, or start costing latency) is
# read off a curve rather than asserted.
#
# ---------------------------------------------------------------------------
# WHY THIS IS NOT ANOTHER GENERIC SATURATION SWEEP RUN THREE TIMES
# ---------------------------------------------------------------------------
#
# ADR-050 decision 1 picks a lane by COST OF STARVATION, so what a cap has to
# protect differs per lane, and so must the figure that decides it:
#
#   realtime  someone is waiting on ONE unit of work. The cap protects
#             LATENCY, not throughput. The number that matters is where
#             per-job latency starts degrading - which may be well before
#             throughput stops rising.
#   fan-out   near-zero HTTP of its own; output is child jobs. The cap bounds
#             QUEUE FAN-OUT against the database, so throughput is the whole
#             question and there is no destination to protect.
#   fiscal    at-most-once, deadline-bearing, and provider-round-trip bound.
#             See the FISCAL section below: this stand cannot saturate it
#             honestly, and the scenario says so rather than producing a
#             plausible fourth guess.
#
# ---------------------------------------------------------------------------
# DEVIATIONS FROM THE MEASUREMENT ADR-050 ASKS FOR, and why - read this before
# the numbers, exactly as F2/F7's headers ask of their own scenarios.
# ---------------------------------------------------------------------------
#
# (1) THE REALTIME LOAD IS `marketplace.offerQuantity.update`, NOT
#     `marketplace.order.sync`, and that is a correction to the ADR's wording
#     rather than a shortcut around it.
#
#     `marketplace.order.sync` on this stand does not measure the realtime
#     lane. `OrderSyncService` fans an ingested order out to every connection
#     with `OrderProcessorManager` enabled, which here is `perf-prestashop`
#     AND `perf-woocommerce` - so a 400-job realtime saturation arm would
#     create 400 real orders in a real PrestaShop and a real WooCommerce,
#     against PrestaShop's declared 60 req/min. F4 (#2851) already measured
#     what happens next: both its arms were DISCARDED by
#     `post_guard_limiter_degraded`, and the shop, not the lane, was the
#     ceiling. Repeating that would measure the destination a third time.
#
#     `marketplace.offerQuantity.update` is in the SAME lane, is the lane's
#     highest-volume real member (it is what `inventory.propagateToMarketplaces`
#     fans out to), makes exactly ONE synchronous outbound call, and fans out
#     to nothing. Its destination here is the `allegro-stub` service
#     (#2856/#2935), whose latency is a knob rather than a shop - which is the
#     property that makes a LANE measurable at all, because a saturation curve
#     taken against a contended destination is a curve of the destination.
#
# (2) THE DESTINATION LATENCY IS DECLARED IN THE MANIFEST, AND ONE ARM SET IS
#     RUN AT EACH OF TWO LATENCIES. `/__stub/config` reports
#     `latency.quantityMs`, and `quantityMsMeasured` tells a reader whether a
#     driver set it deliberately or it fell back to the generic 120 ms default
#     that has no #2861 sandbox measurement behind it (stubs/allegro/README.md
#     is explicit about this). The scenario records both fields verbatim. It
#     does NOT claim the stub is Allegro; it claims the destination answered in
#     a known, constant time, which is the only property the curve needs.
#
#     Running the realtime sweep at two latencies is the point rather than
#     thoroughness: if the knee moves with destination latency, then a single
#     global default cannot be "the measured value" for this lane, and the
#     honest deliverable is guidance plus a range. That is a falsifiable claim
#     and this scenario is built to falsify it.
#
# (3) LANE OCCUPANCY IS NOT USED TO SIZE ANYTHING. F4 § 2 records that the
#     `sync_jobs`-row proxy OVER-READS - a lane slot is released in-process
#     when the handler resolves, while the row stays `running` until a separate
#     terminal write commits, so a row in that gap is counted and holds no
#     slot. F4 saw peaks of 12 and 32 against caps of 8 and 24 for that reason.
#     The over-read is a LARGER fraction of a small cap, and every cap this
#     scenario sweeps is smaller than `bulk`'s 12. Occupancy is therefore
#     sampled and reported as a PROXY, and every sizing figure comes instead
#     from per-row timestamps and `sync_jobs.lastAttemptDurationMs` (#2611),
#     which are recorded by the worker itself at real precision and do not
#     inherit the 1 Hz sampler's floor.
#
# (4) CLAIM/QUEUE LATENCY IS NOT USED EITHER. F7 established that its own
#     claim-latency band IS the instrument - `POLL_INTERVAL_MS = 1000` plus a
#     ~1 Hz poller - so a sub-second difference between arms cannot be resolved
#     by it. `lastAttemptDurationMs` is not sampled and does not have that
#     floor.
#
# (5) THE FISCAL LANE IS CHARACTERISED, NOT SIZED, AND THAT IS THE RESULT.
#     No invoicing or fiscalization connection exists on this stand, and
#     building one means a real provider issuing real documents - a legal act,
#     not a load generator. What CAN be run here is F7's invalid-payload
#     `invoicing.issue` probe at burst volume, which reaches
#     `InvoicingIssueHandler`'s payload validation and returns
#     `business_failure` before any adapter, lock or provider is touched. That
#     measures the RUNNER's floor for this lane - the cost of claiming and
#     retiring a fiscal job with a no-op handler - and it is reported as
#     exactly that. It is NOT a cap measurement and must never be quoted as
#     one: the handler it exercises does none of the work whose concurrency
#     the cap governs.
#
#     What the floor is good for is bounding the OTHER half of the question
#     arithmetically. A burst of N invoices at cap C against a provider taking
#     T seconds per document drains in about N*T/C seconds plus this floor, so
#     the floor says how much of a fiscal burst's latency is OL's and how much
#     is the provider's. That arithmetic is DERIVED, labelled as such, and left
#     with T unknown rather than filled in with a plausible number.
#
# (6) NO CAP DEFAULT IS CHANGED BY THIS SCRIPT. It sets caps on a perf stand
#     for the duration of a run and restores them on exit. Proposing a new
#     default is the report's job, and changing one is a code change reviewed
#     on its own terms - a cap default is a behaviour change for every install.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_LOG_PREFIX="f8"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.lab}"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
LANE="${LANE:-realtime}"
# The cap points to sweep. Deliberately spanning the current default in both
# directions: a sweep that only goes up cannot show that the default is too
# HIGH, which for a latency-protecting lane is the likelier error.
CAPS="${CAPS:-1 2 4 8 16}"
# Jobs per arm. Sized so the SLOWEST arm (cap 1) still drains inside
# DRAIN_MAX_WAIT_SECS while the FASTEST arm still runs long enough for the
# window to mean something: at the stub's 120 ms and cap 1 the floor is
# ~0.12 s/job of destination time plus per-job runner overhead.
JOB_COUNT="${JOB_COUNT:-240}"
# The lane's TOTAL cap during a per-scope sweep. EMPTY means "derive it as
# perScope x scopes", which is the default and is a correctness choice rather
# than a convenience.
#
# `claimAndStartForLane` claims with `limit: cap.total - inFlightTotal` and
# only THEN drops anything over `perScope`, releasing the surplus one row at a
# time (`releaseSurplusClaim`). The pre-claim `excludedScopes` filter cannot
# prevent it, because a scope is excluded only once it is ALREADY at cap - so
# on the tick where a slot frees, the scope is claimable again and the claim
# takes up to `free` rows to start one.
#
# Pinning TOTAL far above perScope therefore does not "leave the per-scope cap
# as the only variable"; it adds a claim-and-release of (free - 1) rows to
# every single refill, which is exactly the row-lock churn a cap sweep must not
# measure. Deriving TOTAL keeps `free` equal to what can actually be started.
# Override it explicitly to measure that churn on purpose - see
# TOTAL_CAP_OVERSIZED below.
TOTAL_CAP="${TOTAL_CAP:-}"
# Realtime destination latency, ms. Empty leaves the stub as it is (and the
# manifest records `quantityMsMeasured:false`, i.e. the unmeasured 120 ms
# default).
STUB_QUANTITY_MS="${STUB_QUANTITY_MS:-}"

MODE="strict"
SCOPES=1
for arg in "$@"; do
  case "$arg" in
    --lane=*) LANE="${arg#--lane=}" ;;
    --caps=*) CAPS="${arg#--caps=}" ;;
    --jobs=*) JOB_COUNT="${arg#--jobs=}" ;;
    --scopes=*) SCOPES="${arg#--scopes=}" ;;
    --stub-latency-ms=*) STUB_QUANTITY_MS="${arg#--stub-latency-ms=}" ;;
    --smoke) MODE="smoke" ;;
    -h|--help)
      cat <<'USAGE'
Usage: f8-lane-caps.sh [--lane=realtime|fan-out|fiscal] [--caps="1 2 4 8 16"]
                       [--jobs=N] [--scopes=1|2] [--stub-latency-ms=N] [--smoke]

  --lane            which lane's per-scope cap to sweep (default realtime)
  --caps            the cap points, space-separated, in the order to run them
  --jobs            jobs enqueued per arm
  --scopes          1 = one connection (perScope binds); 2 = both Allegro
                    connections (the only way to reach the lane TOTAL cap,
                    which no run in this campaign has yet done). realtime only.
  --stub-latency-ms set the Allegro stub's quantity-endpoint latency for this
                    run, and record it as DELIBERATELY SET in the manifest
                    rather than as the unmeasured default
  --smoke           tiny counts, to prove the plumbing before spending a real
                    run. Smoke results are NEVER written into a results-*.md.
USAGE
      exit 0 ;;
    *) die "unknown argument: $arg (try --help)" ;;
  esac
done

case "$LANE" in
  realtime|fan-out|fiscal) : ;;
  *) die "unknown lane '$LANE' - one of realtime, fan-out, fiscal" ;;
esac

if [ "$MODE" = "smoke" ]; then
  CAPS="1 4"
  JOB_COUNT=12
  warn "SMOKE MODE - plumbing check only. These numbers are not a measurement."
fi

# Env var stem per lane. `fan-out` is the one lane whose env stem is not its
# own name (OL_LANE_FANOUT_*, no hyphen) - resolved here once rather than at
# each use, because getting it wrong sets nothing and the run would silently
# sweep a constant cap.
case "$LANE" in
  realtime) LANE_ENV_STEM="REALTIME" ;;
  fan-out)  LANE_ENV_STEM="FANOUT" ;;
  fiscal)   LANE_ENV_STEM="FISCAL" ;;
esac

RUN_GROUP="run$(epoch)"
log "F8 lane-cap saturation: lane=$LANE caps=[$CAPS] jobs/arm=$JOB_COUNT scopes=$SCOPES total_cap=${TOTAL_CAP:-derived(perScope*scopes)} group=$RUN_GROUP"

# ---------------------------------------------------------------------------
# Stand identity. Read from the database rather than from stand-ids.env: the
# stand is routinely brought up from a different worktree than the one a
# scenario runs in (verified - this stand's compose label points at a sibling
# checkout), so a file-relative path to stand-ids.env resolves to the wrong
# tree or to nothing. The connection NAMES are bootstrap.sh's contract; the
# ids are whatever that stand minted.
# ---------------------------------------------------------------------------
conn_id_by_name() {
  pg_sql "SELECT id FROM connections WHERE name='$1'"
}

PS_CONNECTION_ID="${PS_CONNECTION_ID:-$(conn_id_by_name perf-prestashop)}"
ALLEGRO_A_CONNECTION_ID="${ALLEGRO_A_CONNECTION_ID:-$(conn_id_by_name perf-allegro-a)}"
ALLEGRO_B_CONNECTION_ID="${ALLEGRO_B_CONNECTION_ID:-$(conn_id_by_name perf-allegro-b)}"
[ -n "$PS_CONNECTION_ID" ] || die "no connection named perf-prestashop - run bootstrap.sh"
[ -n "$ALLEGRO_A_CONNECTION_ID" ] || die "no connection named perf-allegro-a - run bootstrap.sh"
[ -n "$ALLEGRO_B_CONNECTION_ID" ] || die "no connection named perf-allegro-b - run bootstrap.sh"

case "$LANE" in
  realtime)
    if [ "$SCOPES" = "2" ]; then
      LOAD_CONNS="$ALLEGRO_A_CONNECTION_ID $ALLEGRO_B_CONNECTION_ID"
    else
      LOAD_CONNS="$ALLEGRO_A_CONNECTION_ID"
    fi
    ;;
  fan-out) LOAD_CONNS="$PS_CONNECTION_ID" ;;
  fiscal)  LOAD_CONNS="$PS_CONNECTION_ID" ;;
esac
# Quoted CSV for the SQL `IN (...)` the lib helpers take.
CONN_IDS="$(for c in $LOAD_CONNS; do printf "'%s'," "$c"; done | sed 's/,$//')"
# The realtime children a fan-out arm produces land on the Allegro connections,
# so the drain has to watch those too or the arm is declared quiet while its
# own fan-out is still running.
if [ "$LANE" = "fan-out" ]; then
  DRAIN_CONN_IDS="$CONN_IDS,'$ALLEGRO_A_CONNECTION_ID','$ALLEGRO_B_CONNECTION_ID'"
else
  DRAIN_CONN_IDS="$CONN_IDS"
fi

# ===========================================================================
# Pre-flight
# ===========================================================================
guard_stand_exclusive "f8-lane-caps"

[ -f "$ENV_FILE" ] || die "no $ENV_FILE - the compose recreate needs it (OL_PII_HASH_SALT and the credentials key are ':?' required in docker-compose.lab.yml). Copy it from the checkout that brought this stand up."

ORIGINAL_REPLICAS="$(discover_worker_containers | wc -w | tr -d ' ')"
[ "$ORIGINAL_REPLICAS" -ge 1 ] || die "no worker replicas found - is the lab stand up?"
ORIGINAL_RUNNER_ENABLED="$(docker exec "$(discover_worker_containers | awk '{print $1}')" printenv WORKER_RUNNER_ENABLED 2>/dev/null || printf '')"
[ -n "$ORIGINAL_RUNNER_ENABLED" ] || ORIGINAL_RUNNER_ENABLED=false

# Every lane cap this run will touch, captured as the container ACTUALLY has
# them - never as "the code default", which is what the restore would get
# wrong on a stand a peer had already tuned.
ORIGINAL_CAPS=""
for stem in REALTIME BULK FISCAL FANOUT; do
  for suffix in CAP SCOPE_CAP; do
    v="$(docker exec "$(discover_worker_containers | awk '{print $1}')" printenv "OL_LANE_${stem}_${suffix}" 2>/dev/null || printf '')"
    ORIGINAL_CAPS="$ORIGINAL_CAPS OL_LANE_${stem}_${suffix}=$v"
  done
done
log "stand posture at scenario start: replicas=$ORIGINAL_REPLICAS WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED caps=[$(printf '%s' "$ORIGINAL_CAPS" | tr -s ' ')] (all restored on exit)"

# env_file_set - write KEY=VALUE into .env.lab, replacing any existing line.
# An EMPTY value writes the key with an empty value rather than deleting it,
# because `resolveLaneCaps` reads '' as "unset, use the code default" - so an
# empty line restores the default explicitly instead of leaving whatever the
# previous arm set.
env_file_set() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

# recreate_worker <runner-enabled> - recreate ONLY the worker service so it
# picks up the env just written. `--no-deps`, for F4's reason: a bare `up -d`
# recreates every service whose config resolves differently from THIS
# worktree's compose file, which is a far wider blast radius than an env change
# needs, and this stand was brought up from a different checkout.
recreate_worker() {
  local runner="$1" tries=0 w hits
  env_file_set WORKER_RUNNER_ENABLED "$runner"
  ( cd "$REPO_ROOT" && docker compose -f docker-compose.lab.yml --env-file .env.lab -p lab \
      up -d --no-deps --force-recreate --scale "worker=$ORIGINAL_REPLICAS" worker >/dev/null 2>&1 ) \
    || die "recreate_worker: compose refused to recreate the worker service"

  WORKER_CONTAINERS=""
  WORKER_CONTAINERS_RESOLVED=0
  _ensure_worker_containers

  if [ "$runner" = "true" ]; then
    for w in $WORKER_CONTAINERS; do
      tries=0
      while true; do
        # `grep -c`, never `grep -q`: `grep -q` exits at its first match and
        # SIGPIPEs `docker logs`, which `set -o pipefail` then adopts as a
        # failure even though the line matched (F4 records this trap; it is
        # length-dependent, so it passes while the log is short).
        hits="$(docker logs "$w" 2>&1 | grep -cF 'Starting sync job runner loop' || true)"
        [ "${hits:-0}" -eq 0 ] || break
        tries=$((tries + 1))
        [ "$tries" -lt 90 ] || die "recreate_worker: $w never logged 'Starting sync job runner loop'"
        sleep 1
      done
    done
  else
    sleep 5
  fi
}

# assert_caps_applied <lane> <total> <perScope> - read the caps back out of the
# worker's OWN startup line and refuse the arm if they are not what was asked
# for.
#
# This is the guard the whole scenario rests on. A cap that silently did not
# apply produces a perfectly clean curve of the SAME cap measured five times,
# which is indistinguishable from a lane that does not respond to its cap -
# and that is a conclusion, so it must not be reachable by accident. Two ways
# it could happen and both are real: docker-compose.lab.yml not passing the
# variable through at all (it did not before #2867), and `resolveLaneCaps`
# silently ignoring a value it considers invalid (it warns and falls back on
# anything non-finite or < 1).
assert_caps_applied() {
  local lane="$1" want_total="$2" want_scope="$3" w line caps got
  for w in $WORKER_CONTAINERS; do
    line="$(docker logs "$w" 2>&1 | grep -F 'Starting sync job runner loop' | tail -1 || true)"
    [ -n "$line" ] || die "assert_caps_applied: $w logged no runner startup line"
    caps="$(printf '%s' "$line" | grep -oP 'lane caps: \K.*(?=\))' || true)"
    [ -n "$caps" ] || die "assert_caps_applied: could not parse lane caps out of: $line"
    got="$(printf '%s' "$caps" | tr ' ' '\n' | awk -F= -v l="$lane" '$1==l{print $2}')"
    [ "$got" = "${want_total}/${want_scope}" ] \
      || die "assert_caps_applied: $w reports $lane=$got, asked for ${want_total}/${want_scope}.
  The cap did NOT apply. Most likely docker-compose.lab.yml is not passing
  OL_LANE_${LANE_ENV_STEM}_CAP / _SCOPE_CAP through to the worker service, or
  resolveLaneCaps rejected the value (it ignores anything non-finite or < 1).
  Full line: $line"
    MANIFEST_LANE_CAPS="$caps"
  done
  log "assert_caps_applied ok ($lane=${want_total}/${want_scope}; full: $MANIFEST_LANE_CAPS)"
}

f8_on_exit() {
  log "restoring stand: replicas=$ORIGINAL_REPLICAS WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED, lane caps as found"
  if [ -f "$ENV_FILE" ]; then
    # Longhand, and never via a function that can `die`: a cleanup path that
    # aborts itself would skip the stand-lock release below and hold the stand
    # for the full TTL (F7 found this the hard way).
    for kv in $ORIGINAL_CAPS; do
      k="${kv%%=*}"; v="${kv#*=}"
      if grep -q "^${k}=" "$ENV_FILE" 2>/dev/null; then
        sed -i "s|^${k}=.*|${k}=${v}|" "$ENV_FILE" 2>/dev/null || true
      elif [ -n "$v" ]; then
        printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE" 2>/dev/null || true
      fi
    done
    sed -i "s|^WORKER_RUNNER_ENABLED=.*|WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED|" "$ENV_FILE" 2>/dev/null || true
  fi
  ( cd "$REPO_ROOT" && docker compose -f docker-compose.lab.yml --env-file .env.lab -p lab \
      up -d --no-deps --force-recreate --scale "worker=$ORIGINAL_REPLICAS" worker >/dev/null 2>&1 ) \
    || warn "could not restore the worker posture - the stand is left at whatever the last arm set"
  release_stand_exclusive
}
trap f8_on_exit EXIT

guard_scheduler_off
guard_demo_mode_off
guard_connection_budget
guard_pool_recorded
guard_log_level
guard_perf_max_attempts
guard_build

# ===========================================================================
# Load generators, one per lane.
#
# Every one of them enqueues through `enqueue_perf_job` so `cap_perf_job_attempts`
# can bound the retry ladder, and every one mints DISTINCT target entities per
# job. That last property is load-bearing for `realtime`: #2617's write-order
# guard takes a per-(connection, offer) SyncLockPort lock, so N jobs against
# ONE offer would serialise on the lock and be reported as contention - a
# perfect flat line at every cap, and a completely wrong conclusion. This stand
# carries 200 distinct Offer mappings per Allegro connection (verified), which
# is above every cap swept here, so the in-flight set never revisits an offer.
# ===========================================================================

# Cached target pools, resolved once. Re-resolving per arm would let the pool
# drift between arms and make them incomparable.
OFFER_IDS_A=""
OFFER_IDS_B=""
FANOUT_TARGETS=""

resolve_offer_pool() {
  local conn="$1"
  pg_sql "SELECT DISTINCT \"internalId\" FROM identifier_mappings WHERE \"entityType\"='Offer' AND \"connectionId\"='$conn' ORDER BY 1 LIMIT 400"
}

resolve_fanout_targets() {
  # productId + variantId pairs. `inventory.propagateToMarketplaces` takes
  # {productId, variantId?} and resolves the publishable quantity itself, so a
  # real product/variant is all the payload needs.
  pg_sql "SELECT p.id || '|' || v.id FROM products p JOIN product_variants v ON v.\"productId\"=p.id ORDER BY p.id, v.id LIMIT 1000"
}

enqueue_realtime() {
  local arm="$1" n="$2" i=0 conn offers idx offer
  local -a pool_a pool_b
  mapfile -t pool_a <<< "$OFFER_IDS_A"
  mapfile -t pool_b <<< "$OFFER_IDS_B"
  while [ "$i" -lt "$n" ]; do
    if [ "$SCOPES" = "2" ] && [ $((i % 2)) -eq 1 ]; then
      conn="$ALLEGRO_B_CONNECTION_ID"; idx=$(( (i / 2) % ${#pool_b[@]} )); offer="${pool_b[$idx]}"
    else
      conn="$ALLEGRO_A_CONNECTION_ID"; idx=$(( (i / (SCOPES > 1 ? 2 : 1)) % ${#pool_a[@]} )); offer="${pool_a[$idx]}"
    fi
    # `observedAt` is monotonically INCREASING across the arm. #2617 refuses a
    # write whose observation is strictly older than the newest already
    # written for that offer, so a constant or decreasing token would have the
    # guard correctly refuse later jobs and the arm would measure the guard
    # rather than the lane.
    enqueue_perf_job 'marketplace.offerQuantity.update' "$conn" \
      "{\"schemaVersion\":1,\"offerId\":\"$offer\",\"quantity\":$(( 10 + i % 50 )),\"observedAt\":\"$(date -u -d "@$(( $(epoch) + i ))" +%Y-%m-%dT%H:%M:%SZ)\"}" \
      "f8:$RUN_GROUP:$arm:rt:$i" >/dev/null
    i=$((i + 1))
  done
}

enqueue_fanout() {
  local arm="$1" n="$2" i=0 pair pid vid
  local -a pool
  mapfile -t pool <<< "$FANOUT_TARGETS"
  while [ "$i" -lt "$n" ]; do
    pair="${pool[$(( i % ${#pool[@]} ))]}"
    pid="${pair%%|*}"; vid="${pair##*|}"
    enqueue_perf_job 'inventory.propagateToMarketplaces' "$PS_CONNECTION_ID" \
      "{\"productId\":\"$pid\",\"variantId\":\"$vid\"}" \
      "f8:$RUN_GROUP:$arm:fo:$i" >/dev/null
    i=$((i + 1))
  done
}

enqueue_fiscal() {
  # DELIBERATELY INVALID payload - F7's probe, reused. InvoicingIssueHandler
  # validates the payload before anything else and returns
  # {outcome:'business_failure'} on the first bad field: no invoicing
  # connection, no order, no lock, no provider, no retry. See deviation (5):
  # this measures the RUNNER's floor for the lane and is not a cap measurement.
  local arm="$1" n="$2" i=0
  while [ "$i" -lt "$n" ]; do
    enqueue_perf_job 'invoicing.issue' "$PS_CONNECTION_ID" \
      "{\"f8Probe\":true}" "f8:$RUN_GROUP:$arm:fi:$i" >/dev/null
    i=$((i + 1))
  done
}

# ===========================================================================
# Per-arm measurement
# ===========================================================================
ARMS_CSV=""

run_arm() {
  local cap="$1" dir drained rows total arm
  # Derived unless pinned - see the TOTAL_CAP comment above for why an
  # oversized TOTAL measures claim-and-release churn rather than the cap.
  if [ -n "$TOTAL_CAP" ]; then total="$TOTAL_CAP"; else total=$(( cap * SCOPES )); fi
  arm="cap${cap}t${total}"
  dir="$(results_dir_init f8-lane-caps "$RUN_GROUP-$LANE-$arm")"

  # 1. Apply the cap and PROVE it applied, before anything is enqueued.
  env_file_set "OL_LANE_${LANE_ENV_STEM}_CAP" "$total"
  env_file_set "OL_LANE_${LANE_ENV_STEM}_SCOPE_CAP" "$cap"
  recreate_worker true
  assert_caps_applied "$LANE" "$total" "$cap"
  guard_runner_state enabled

  # 2. Clear this scenario's own rows from previous arms so the drain and the
  #    row-scoped statistics below see THIS arm only. Scoped to the f8 key
  #    prefix - never a blanket delete, which would take a peer's rows with it.
  pg_sql_write "DELETE FROM sync_jobs WHERE \"idempotencyKey\" LIKE 'f8:$RUN_GROUP:%' AND \"idempotencyKey\" NOT LIKE 'f8:$RUN_GROUP:$arm:%'" >/dev/null || true

  # Drain BEFORE asserting empty, in that order and not the other way round.
  # The previous arm's fan-out children land on the Allegro connections and are
  # still draining when this arm starts, so asserting first would refuse every
  # arm after the first. And the assertion is NOT wrapped in `|| true`: `die`
  # calls `exit`, so `guard_queue_empty ... || true` does not actually tolerate
  # a failure - it aborts the sweep while reading like it cannot. Either the
  # queue is clean and the arm is valid, or it is not and the arm would be
  # measuring a cap it does not have to itself.
  drain_wait "$DRAIN_CONN_IDS" >/dev/null || warn "pre-arm drain did not go quiet within DRAIN_MAX_WAIT_SECS - guard_queue_empty below will decide"
  guard_queue_empty "$DRAIN_CONN_IDS"

  # 3. Enqueue, cap the ladder, then open the window. Enqueue BEFORE
  #    window_start so the window measures draining and not the REST intake -
  #    the enqueue is ~JOB_COUNT HTTP calls and would otherwise be counted as
  #    lane time.
  # Re-login per arm rather than once for the run. A cap sweep is many arms
  # long (recreate + settle + drain, each), so a token minted before the first
  # arm can expire mid-sweep - and `ol_api` DIES on a non-2xx, which would
  # abort the run after several arms' worth of stand time. Logging in again is
  # one request against the api, which no arm is measuring.
  ol_login

  case "$LANE" in
    realtime) enqueue_realtime "$arm" "$JOB_COUNT" ;;
    fan-out)  enqueue_fanout  "$arm" "$JOB_COUNT" ;;
    fiscal)   enqueue_fiscal  "$arm" "$JOB_COUNT" ;;
  esac
  cap_perf_job_attempts

  local extra
  extra="$(printf '{"f8":{"lane":"%s","perScopeCap":%s,"totalCap":%s,"jobsEnqueued":%s,"scopes":%s,"stubConfig":%s}}' \
    "$LANE" "$cap" "$total" "$JOB_COUNT" "$SCOPES" \
    "$(curl -s --max-time 5 "${STUB_URL:-http://127.0.0.1:19081}/__stub/config" 2>/dev/null || printf 'null')")"

  window_start "$dir" "f8-lane-caps" "$DRAIN_CONN_IDS" 0 "$extra"
  drained="$(drain_wait "$DRAIN_CONN_IDS" || true)"
  window_stop "$dir"

  # 4. Statistics from the ROWS, not from the sampler - see deviation (3)/(4).
  #    `lastAttemptDurationMs` is written by the worker at real precision;
  #    end-to-end is updatedAt-createdAt, which is available because a terminal
  #    write always stamps updatedAt (unlike lockedAt, which is CLEARED on
  #    every terminal transition - F7 lost a whole run to that).
  rows="$(pg_sql "
    SELECT
      COUNT(*) FILTER (WHERE status='succeeded')                       AS ok,
      COUNT(*) FILTER (WHERE status='dead')                            AS dead,
      COUNT(*) FILTER (WHERE status IN ('queued','running'))           AS stuck,
      COUNT(*) FILTER (WHERE outcome='business_failure')               AS bizfail,
      COALESCE(SUM(\"deferredTotalMs\"),0)                             AS deferred_ms,
      COALESCE(ROUND(AVG(\"lastAttemptDurationMs\")),0)                AS exec_mean,
      COALESCE(ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY \"lastAttemptDurationMs\")),0) AS exec_p50,
      COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY \"lastAttemptDurationMs\")),0) AS exec_p95,
      COUNT(\"lastAttemptDurationMs\")                                 AS exec_n,
      COALESCE(ROUND(EXTRACT(EPOCH FROM (MAX(\"updatedAt\") - MIN(\"createdAt\")))::numeric, 3),0) AS span_secs,
      COALESCE(ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (\"updatedAt\"-\"createdAt\")))::numeric,3),0) AS e2e_p50,
      COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (\"updatedAt\"-\"createdAt\")))::numeric,3),0) AS e2e_p95
    FROM sync_jobs WHERE \"idempotencyKey\" LIKE 'f8:$RUN_GROUP:$arm:%'")"

  # Children this arm produced. For `fan-out` this is the arm's actual output
  # and the reason its cap exists; for the others it should be zero, and a
  # non-zero value means the load is not what the header claims it is.
  local children
  children="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"jobType\"='marketplace.offerQuantity.update' AND \"idempotencyKey\" NOT LIKE 'f8:%' AND \"createdAt\" >= to_timestamp($WINDOW_START_EPOCH)")"

  # Occupancy, from the timeseries the sampler wrote. PROXY ONLY - see
  # deviation (3). Reported so a reader can see whether the lane was near its
  # cap at all, never used to size it.
  local occ_max occ_mean
  occ_max="$(awk -F, 'NR>1 && $4+0>m{m=$4+0} END{print m+0}' "$dir/timeseries.csv" 2>/dev/null || printf 0)"
  occ_mean="$(awk -F, 'NR>1{s+=$4;n++} END{if(n)printf "%.2f", s/n; else print 0}' "$dir/timeseries.csv" 2>/dev/null || printf 0)"

  local elapsed=$((WINDOW_STOP_EPOCH - WINDOW_START_EPOCH))
  local ok dead stuck bizfail deferred_ms exec_mean exec_p50 exec_p95 exec_n span e2e50 e2e95
  IFS='|' read -r ok dead stuck bizfail deferred_ms exec_mean exec_p50 exec_p95 exec_n span e2e50 e2e95 <<< "$rows"

  local tput
  tput="$(awk -v o="${ok:-0}" -v s="${span:-0}" 'BEGIN{ if (s+0>0) printf "%.3f", o/s; else print "0" }')"

  # Five positional args, not two: post_guard_attempts/deferrals need the
  # window's ISO start and post_guard_limiter_degraded needs its epoch bounds.
  # Passing fewer silences the guards rather than failing them - the #2851
  # "a guard that cannot see reads exactly like a clean run" shape - which is
  # why the verdict is read back and carried into the summary row rather than
  # written once to a file nobody re-reads.
  run_post_guards "$dir" "$DRAIN_CONN_IDS" \
    "$(date -u -d "@$WINDOW_START_EPOCH" +%Y-%m-%dT%H:%M:%SZ)" \
    "$WINDOW_START_EPOCH" "$WINDOW_STOP_EPOCH" || true
  # `awk NR==1`, never `| head -1`: head closes the pipe at its first line and
  # SIGPIPEs the reader, which `set -o pipefail` adopts as a failure - F7 lost
  # a full run to exactly that, after a 17-minute arm had already drained.
  local verdict
  verdict="$(verdict_read "$dir" 2>/dev/null | awk 'NR==1' || printf 'UNKNOWN')"
  [ -n "$verdict" ] || verdict=UNKNOWN

  log "ARM $LANE perScope=$cap -> $verdict ok=$ok dead=$dead stuck=$stuck bizfail=$bizfail span=${span}s throughput=${tput}/s exec_p50=${exec_p50}ms exec_p95=${exec_p95}ms e2e_p50=${e2e50}s occ_max=$occ_max(proxy) children=$children drain=$drained"

  ARMS_CSV="$ARMS_CSV$LANE,$cap,$total,$SCOPES,$JOB_COUNT,$ok,$dead,$stuck,$bizfail,$span,$tput,$exec_mean,$exec_p50,$exec_p95,$exec_n,$e2e50,$e2e95,$deferred_ms,$occ_max,$occ_mean,$children,$elapsed,$drained,$verdict
"
  LAST_DIR="$dir"
}

# ===========================================================================
# Run
# ===========================================================================
if [ -n "$STUB_QUANTITY_MS" ]; then
  warn "STUB_QUANTITY_MS=$STUB_QUANTITY_MS requested. The stub reads its latency from the ENVIRONMENT at request time, so this needs the stub container recreated with STUB_LATENCY_QUANTITY_MS set - do it before invoking this script, and it will be recorded from /__stub/config (quantityMsMeasured:true) rather than asserted here."
fi

case "$LANE" in
  realtime)
    OFFER_IDS_A="$(resolve_offer_pool "$ALLEGRO_A_CONNECTION_ID")"
    OFFER_IDS_B="$(resolve_offer_pool "$ALLEGRO_B_CONNECTION_ID")"
    a_n="$(printf '%s\n' "$OFFER_IDS_A" | grep -c . || true)"
    [ "${a_n:-0}" -gt 0 ] || die "no Offer identifier mappings on perf-allegro-a - run bootstrap.sh"
    # The per-offer write-order lock (#2617) is only harmless while the pool is
    # wider than the widest cap. Refuse rather than silently measure the lock.
    widest="$(printf '%s' "$CAPS" | tr ' ' '\n' | sort -n | tail -1)"
    [ "$a_n" -gt "$widest" ] \
      || die "offer pool for perf-allegro-a is $a_n, which is not wider than the widest cap ($widest). At or below the cap the #2617 per-(connection,offer) lock would serialise the arm and the curve would be a curve of the lock, not of the lane."
    log "realtime load: marketplace.offerQuantity.update, offer pool a=$a_n b=$(printf '%s\n' "$OFFER_IDS_B" | grep -c . || true), scopes=$SCOPES"
    ;;
  fan-out)
    FANOUT_TARGETS="$(resolve_fanout_targets)"
    f_n="$(printf '%s\n' "$FANOUT_TARGETS" | grep -c . || true)"
    [ "${f_n:-0}" -gt 0 ] || die "no product/variant pairs found - run bootstrap.sh"
    log "fan-out load: inventory.propagateToMarketplaces over $f_n product/variant pairs"
    ;;
  fiscal)
    warn "FISCAL: this arm measures the RUNNER's floor for the lane, NOT the cap. See deviation (5) in this script's header. Do not quote its numbers as a cap measurement."
    ;;
esac

# Called plainly. Capturing its output in a command substitution instead
# runs the function in a SUBSHELL, so every `ARMS_CSV` append inside it is
# discarded when the subshell exits - and every `log` line inside it is
# captured as the substitution's value instead of reaching the operator. The
# first run of this scenario did exactly that: both arms executed correctly
# against the stand and the summary came out with a header and no rows.
LAST_DIR=""
for cap in $CAPS; do
  run_arm "$cap"
done

SUMMARY="$RESULTS_ROOT/f8-lane-caps/$RUN_GROUP-$LANE-summary.csv"
mkdir -p "$(dirname "$SUMMARY")"
{
  printf 'lane,perScopeCap,totalCap,scopes,jobsEnqueued,succeeded,dead,stuck,businessFailure,spanSecs,throughputPerSec,execMeanMs,execP50Ms,execP95Ms,execN,e2eP50Secs,e2eP95Secs,deferredTotalMs,occMaxProxy,occMeanProxy,childrenEnqueued,windowSecs,drainResult,verdict\n'
  printf '%s' "$ARMS_CSV"
} > "$SUMMARY"

log "summary written: $SUMMARY"
printf '\n'
column -s, -t < "$SUMMARY" 2>/dev/null || cat "$SUMMARY"
printf '\n'
log "F8 complete for lane=$LANE. Results under $RESULTS_ROOT/f8-lane-caps/$RUN_GROUP-$LANE-*"
log "REMINDER: occMax/occMean are the sync_jobs-row PROXY and OVER-READ (F4 § 2). Size from throughput and execP50/execP95, never from occupancy."
