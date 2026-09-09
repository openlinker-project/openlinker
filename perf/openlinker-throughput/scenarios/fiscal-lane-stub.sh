#!/usr/bin/env bash
#
# Fiscal lane, real stub (#3006, epic #2840).
#
# `results-lane-caps-2026-09-07.md` § 4.5 offers the arithmetic `N x T / C`
# for the `fiscal` lane and then leaves T unknown, concluding the lane is
# "the likeliest permanent holdout" for measurement — because F8's own
# `fiscal` arm (see its header, deviation (5)) deliberately reuses F7's
# ALWAYS-INVALID `invoicing.issue` payload, which fails
# `InvoicingIssueHandler`'s payload validation and returns `business_failure`
# before ever reaching `InvoiceService.issueInvoice()` — so it measures the
# runner's own claim/retire floor for the lane, never the lane's real
# behaviour under a document that actually issues.
#
# This scenario closes that gap. It builds a genuinely VALID
# `invoicing.issue` payload against a real, in-tree `InvoicingPort` adapter
# (`@openlinker/integrations-invoicing-stub`, #3006) whose one outbound call
# is a fixed-latency HTTP POST to a standalone stub
# (`stubs/invoicing/server.mjs`) — so every job runs the REAL
# `InvoiceService.issueInvoice()` chain: the per-order lock
# (`invoiceIssueLockKey`), the `pending` row, the exactly-once idempotency
# gate, the adapter call, `updateOutcome`. The ONLY thing faked is the
# provider's own decision latency.
#
# It measures documents/hour at T = 2s / 10s / 90s against `perScope` 1
# (shipped) and 4, and it confirms or refutes
# `results-lane-caps-2026-09-07.md` § 4.5's bulk-issue serialisation claim —
# that `invoicing.issue` is serialised by the LANE CAP alone, not by the
# per-order lock, over N DISTINCT orders — by reading the stub's own
# `maxInFlightObserved` counter at the exact point OpenLinker crosses the
# provider boundary. See `stubs/invoicing/README.md` for why that is the
# right instrument (more precise than the runner's own ~1 Hz poll floor, F7's
# own established limit).
#
# WHAT THIS DOES NOT MEASURE, restated so it cannot be misquoted: a real
# provider's variance, its rate limits, or its failure modes. `T` is a single
# fixed constant per arm, never a distribution. 90 s comes from this
# repository's own inFakt/KSeF end-to-end confirmation (§ InfaktInvoicingAdapter
# docblock, #1763); 2 s and 10 s bracket it. Every number this scenario
# produces is a statement about the `fiscal` lane and the per-order lock —
# never about a real invoicing/fiscalization authority.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_LOG_PREFIX="fiscal-lane-stub"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.lab}"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
LATENCIES_MS="${LATENCIES_MS:-2000 10000 90000}"
# jobs-per-arm, ONE value per entry in LATENCIES_MS, same order — sized so the
# SLOWEST (perScope=1, T=90s) arm still finishes inside a reasonable window
# while the fastest still runs long enough to mean something. Overridable so
# a smoke run can shrink both without touching the real numbers.
JOB_COUNTS="${JOB_COUNTS:-20 10 6}"
CAPS="${CAPS:-1 4}"
STUB_URL="${STUB_URL:-http://127.0.0.1:${INVOICING_STUB_HOST_PORT:-19082}}"

MODE="strict"
for arg in "$@"; do
  case "$arg" in
    --latencies-ms=*) LATENCIES_MS="${arg#--latencies-ms=}" ;;
    --jobs=*) JOB_COUNTS="${arg#--jobs=}" ;;
    --caps=*) CAPS="${arg#--caps=}" ;;
    --stub-url=*) STUB_URL="${arg#--stub-url=}" ;;
    --smoke) MODE="smoke" ;;
    -h|--help)
      cat <<'USAGE'
Usage: fiscal-lane-stub.sh [--latencies-ms="2000 10000 90000"] [--jobs="20 10 6"]
                           [--caps="1 4"] [--stub-url=http://127.0.0.1:19082] [--smoke]

  --latencies-ms  space-separated stub latencies to sweep, in ms
  --jobs          space-separated job counts, ONE per --latencies-ms entry,
                   same order
  --caps          OL_LANE_FISCAL_SCOPE_CAP values to sweep (worker recreated
                   once per value)
  --stub-url      the invoicing-stub's HOST-published control surface
  --smoke         tiny counts, to prove the plumbing before spending a real
                   run. Smoke results are NEVER written into a results-*.md.
USAGE
      exit 0 ;;
    *) die "unknown argument: $arg (try --help)" ;;
  esac
done

if [ "$MODE" = "smoke" ]; then
  LATENCIES_MS="200 500"
  JOB_COUNTS="4 4"
  CAPS="1 2"
  warn "SMOKE MODE - plumbing check only. These numbers are not a measurement."
fi

read -ra LATENCY_ARR <<< "$LATENCIES_MS"
read -ra JOBCOUNT_ARR <<< "$JOB_COUNTS"
[ "${#LATENCY_ARR[@]}" -eq "${#JOBCOUNT_ARR[@]}" ] \
  || die "--latencies-ms has ${#LATENCY_ARR[@]} entries but --jobs has ${#JOBCOUNT_ARR[@]} - they must pair up 1:1"

RUN_GROUP="run$(epoch)"
log "fiscal-lane-stub: latencies=[$LATENCIES_MS]ms jobs=[$JOB_COUNTS] caps=[$CAPS] group=$RUN_GROUP stub=$STUB_URL"

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
guard_stand_exclusive "fiscal-lane-stub"

[ -f "$ENV_FILE" ] || die "no $ENV_FILE - the compose recreate needs it. Copy it from the checkout that brought this stand up."

# The stub itself must be reachable and answer /__stub/health before anything
# is enqueued against it - a burst enqueued at a dead stub would fail every
# job with a connect error, which reads exactly like a saturated lane if
# nobody checks first.
curl -sS --max-time 5 "$STUB_URL/__stub/health" >/dev/null \
  || die "invoicing-stub not reachable at $STUB_URL/__stub/health - is the lab stand up with the invoicing-stub service (docker-compose.lab.yml)?"

ORIGINAL_REPLICAS="$(discover_worker_containers | wc -w | tr -d ' ')"
[ "$ORIGINAL_REPLICAS" -ge 1 ] || die "no worker replicas found - is the lab stand up?"
ORIGINAL_RUNNER_ENABLED="$(docker exec "$(discover_worker_containers | awk '{print $1}')" printenv WORKER_RUNNER_ENABLED 2>/dev/null || printf '')"
[ -n "$ORIGINAL_RUNNER_ENABLED" ] || ORIGINAL_RUNNER_ENABLED=false
ORIGINAL_STUB_ENABLED="$(docker exec "$(discover_worker_containers | awk '{print $1}')" printenv OL_INVOICING_STUB_ENABLED 2>/dev/null || printf '')"
ORIGINAL_FISCAL_CAP="$(docker exec "$(discover_worker_containers | awk '{print $1}')" printenv OL_LANE_FISCAL_CAP 2>/dev/null || printf '')"
ORIGINAL_FISCAL_SCOPE_CAP="$(docker exec "$(discover_worker_containers | awk '{print $1}')" printenv OL_LANE_FISCAL_SCOPE_CAP 2>/dev/null || printf '')"
log "stand posture at scenario start: replicas=$ORIGINAL_REPLICAS WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED OL_INVOICING_STUB_ENABLED=${ORIGINAL_STUB_ENABLED:-<unset>} fiscal_cap=${ORIGINAL_FISCAL_CAP:-<default>}/${ORIGINAL_FISCAL_SCOPE_CAP:-<default>} (all restored on exit)"

env_file_set() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

# recreate_worker <fiscal_scope_cap> - always re-enables the runner AND turns
# on OL_INVOICING_STUB_ENABLED, since the whole scenario depends on the
# plugin having been registered.
recreate_worker() {
  local scope_cap="$1" tries=0 w hits
  env_file_set WORKER_RUNNER_ENABLED true
  env_file_set OL_INVOICING_STUB_ENABLED true
  # TOTAL must be raised in lockstep with perScope (the f8-lane-caps.sh
  # `total = perScope x scopes` derivation, scopes=1 here - one connection
  # issues every job in this sweep). Leaving the shipped default TOTAL=2 in
  # force while perScope=4 would cap concurrency at 2 regardless of perScope,
  # which is exactly the "cap did not really apply" trap
  # assert_fiscal_cap_applied exists to catch - except here the SILENT
  # version, since a scope cap wider than the total is not a config error,
  # just an unreachable one.
  env_file_set OL_LANE_FISCAL_CAP "$scope_cap"
  env_file_set OL_LANE_FISCAL_SCOPE_CAP "$scope_cap"
  ( cd "$REPO_ROOT" && docker compose -f docker-compose.lab.yml --env-file .env.lab -p lab \
      up -d --no-deps --force-recreate --scale "worker=$ORIGINAL_REPLICAS" worker >/dev/null 2>&1 ) \
    || die "recreate_worker: compose refused to recreate the worker service"

  WORKER_CONTAINERS=""
  WORKER_CONTAINERS_RESOLVED=0
  _ensure_worker_containers

  for w in $WORKER_CONTAINERS; do
    tries=0
    while true; do
      hits="$(docker logs "$w" 2>&1 | grep -cF 'Starting sync job runner loop' || true)"
      [ "${hits:-0}" -eq 0 ] || break
      tries=$((tries + 1))
      [ "$tries" -lt 90 ] || die "recreate_worker: $w never logged 'Starting sync job runner loop'"
      sleep 1
    done
  done
}

# assert_fiscal_cap_applied <scope_cap> - the F8 discipline: a cap that
# silently did not apply produces a clean curve of the same cap measured
# repeatedly, which is indistinguishable from a lane that does not respond to
# its cap.
assert_fiscal_cap_applied() {
  local want_scope="$1" w line caps got
  for w in $WORKER_CONTAINERS; do
    line="$(docker logs "$w" 2>&1 | grep -F 'Starting sync job runner loop' | tail -1 || true)"
    [ -n "$line" ] || die "assert_fiscal_cap_applied: $w logged no runner startup line"
    caps="$(printf '%s' "$line" | grep -oP 'lane caps: \K.*(?=\))' || true)"
    [ -n "$caps" ] || die "assert_fiscal_cap_applied: could not parse lane caps out of: $line"
    got="$(printf '%s' "$caps" | tr ' ' '\n' | awk -F= '$1=="fiscal"{print $2}')"
    # Expect EXACTLY "want_scope/want_scope" - recreate_worker raises TOTAL in
    # lockstep with perScope (scopes=1), so anything else means one of the two
    # env vars did not apply.
    case "$got" in
      "$want_scope/$want_scope") : ;;
      *) die "assert_fiscal_cap_applied: $w reports fiscal=$got, asked for ${want_scope}/${want_scope} (total/perScope). Full line: $line" ;;
    esac
    MANIFEST_LANE_CAPS="$caps"
  done
  log "assert_fiscal_cap_applied ok (fiscal=... /$want_scope; full: $MANIFEST_LANE_CAPS)"
}

fiscal_lane_stub_on_exit() {
  log "restoring stand: replicas=$ORIGINAL_REPLICAS WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED OL_INVOICING_STUB_ENABLED=${ORIGINAL_STUB_ENABLED:-<unset>} fiscal caps as found"
  if [ -f "$ENV_FILE" ]; then
    sed -i "s|^WORKER_RUNNER_ENABLED=.*|WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED|" "$ENV_FILE" 2>/dev/null || true
    if [ -n "$ORIGINAL_STUB_ENABLED" ]; then
      sed -i "s|^OL_INVOICING_STUB_ENABLED=.*|OL_INVOICING_STUB_ENABLED=$ORIGINAL_STUB_ENABLED|" "$ENV_FILE" 2>/dev/null || true
    fi
    if [ -n "$ORIGINAL_FISCAL_CAP" ]; then
      sed -i "s|^OL_LANE_FISCAL_CAP=.*|OL_LANE_FISCAL_CAP=$ORIGINAL_FISCAL_CAP|" "$ENV_FILE" 2>/dev/null || true
    fi
    if grep -q "^OL_LANE_FISCAL_SCOPE_CAP=" "$ENV_FILE" 2>/dev/null; then
      if [ -n "$ORIGINAL_FISCAL_SCOPE_CAP" ]; then
        sed -i "s|^OL_LANE_FISCAL_SCOPE_CAP=.*|OL_LANE_FISCAL_SCOPE_CAP=$ORIGINAL_FISCAL_SCOPE_CAP|" "$ENV_FILE" 2>/dev/null || true
      else
        sed -i "/^OL_LANE_FISCAL_SCOPE_CAP=/d" "$ENV_FILE" 2>/dev/null || true
      fi
    fi
  fi
  ( cd "$REPO_ROOT" && docker compose -f docker-compose.lab.yml --env-file .env.lab -p lab \
      up -d --no-deps --force-recreate --scale "worker=$ORIGINAL_REPLICAS" worker >/dev/null 2>&1 ) \
    || warn "could not restore the worker posture - the stand is left at whatever the last arm set"
  release_stand_exclusive
}
trap fiscal_lane_stub_on_exit EXIT

guard_scheduler_off
guard_demo_mode_off
guard_connection_budget
guard_pool_recorded
guard_log_level
guard_perf_max_attempts
guard_build

# ---------------------------------------------------------------------------
# The invoicing-stub connection. Created directly against Postgres rather
# than through `POST /v1/connections` - the api process does not need to be
# rebuilt with the plugin registered to run this scenario, only the worker
# does (the worker is what executes `invoicing.issue`). Insert-or-reuse by
# NAME, so a re-run of this scenario is idempotent.
# ---------------------------------------------------------------------------
STUB_CONN_NAME="perf-invoicing-stub"
STUB_CONNECTION_ID="$(pg_sql "SELECT id FROM connections WHERE name='$STUB_CONN_NAME'")"
if [ -z "$STUB_CONNECTION_ID" ]; then
  pg_sql_write "INSERT INTO connections (id, \"platformType\", name, status, config, \"credentialsRef\", \"adapterKey\", \"enabledCapabilities\", \"createdAt\", \"updatedAt\")
    VALUES (gen_random_uuid(), 'invoicing-stub', '$STUB_CONN_NAME', 'active', '{\"apiBaseUrl\":\"http://invoicing-stub:19082\"}'::jsonb, '', 'invoicing-stub.fake.v1', '[\"Invoicing\"]'::jsonb, now(), now())" >/dev/null
  STUB_CONNECTION_ID="$(pg_sql "SELECT id FROM connections WHERE name='$STUB_CONN_NAME'")"
  log "created connection $STUB_CONN_NAME ($STUB_CONNECTION_ID)"
else
  log "reusing connection $STUB_CONN_NAME ($STUB_CONNECTION_ID)"
fi
[ -n "$STUB_CONNECTION_ID" ] || die "could not create/resolve the $STUB_CONN_NAME connection"
CONN_IDS="'$STUB_CONNECTION_ID'"

# ---------------------------------------------------------------------------
# Stub control surface
# ---------------------------------------------------------------------------
stub_set_latency() {
  curl -sS --max-time 5 -X PUT "$STUB_URL/__stub/config" \
    -H 'Content-Type: application/json' -d "{\"latencyMs\":$1}" >/dev/null \
    || die "could not set stub latency to $1 ms via $STUB_URL/__stub/config"
}

stub_reset() {
  curl -sS --max-time 5 -X POST "$STUB_URL/__stub/reset" >/dev/null \
    || die "could not reset stub counters via $STUB_URL/__stub/reset"
}

stub_config() {
  curl -sS --max-time 5 "$STUB_URL/__stub/config" \
    || die "could not read stub config via $STUB_URL/__stub/config"
}

# ---------------------------------------------------------------------------
# Enqueue - a VALID invoicing.issue payload, one per distinct order.
# `InvoicingIssueHandler.validatePayload` requires exactly this shape; nothing
# beyond it is checked (sourceConnectionId/trigger are typed-required on
# `InvoicingIssuePayloadV1` but not validated by the handler, so they are
# omitted).
# ---------------------------------------------------------------------------
enqueue_fiscal_real() {
  local arm="$1" n="$2" i=0 order_id key
  while [ "$i" -lt "$n" ]; do
    order_id="ol_order_f3006_${RUN_GROUP}_${arm}_${i}"
    key="f3006:$RUN_GROUP:$arm:fi:$i"
    enqueue_perf_job 'invoicing.issue' "$STUB_CONNECTION_ID" \
      "{\"schemaVersion\":1,\"connectionId\":\"$STUB_CONNECTION_ID\",\"orderId\":\"$order_id\",\"idempotencyKey\":\"$key\",\"currency\":\"PLN\",\"lines\":[{\"name\":\"Perf test line\",\"quantity\":1,\"unitPriceGross\":10,\"taxRate\":\"0\"}],\"buyer\":{\"type\":\"private\",\"name\":\"Perf Buyer\",\"taxId\":null,\"address\":{\"line1\":\"Testowa 1\",\"city\":\"Warszawa\",\"postalCode\":\"00-001\",\"countryIso2\":\"PL\"}}}" \
      "$key" >/dev/null
    i=$((i + 1))
  done
}

# ===========================================================================
# Per-arm measurement
# ===========================================================================
ARMS_CSV=""
LAST_DIR=""

run_arm() {
  local cap="$1" latency_ms="$2" n="$3" arm dir drained
  arm="cap${cap}-t${latency_ms}ms"
  dir="$(results_dir_init fiscal-lane-stub "$RUN_GROUP-$arm")"

  stub_set_latency "$latency_ms"
  stub_reset
  ol_login

  pg_sql_write "DELETE FROM sync_jobs WHERE \"idempotencyKey\" LIKE 'f3006:$RUN_GROUP:%' AND \"idempotencyKey\" NOT LIKE 'f3006:$RUN_GROUP:$arm:%'" >/dev/null || true
  drain_wait "$CONN_IDS" >/dev/null || warn "pre-arm drain did not go quiet within DRAIN_MAX_WAIT_SECS - guard_queue_empty below will decide"
  guard_queue_empty "$CONN_IDS"

  enqueue_fiscal_real "$arm" "$n"
  cap_perf_job_attempts

  local extra
  extra="$(printf '{"fiscalLaneStub":{"perScopeCap":%s,"latencyMs":%s,"jobsEnqueued":%s,"connectionId":"%s","stubConfigBeforeWindow":%s}}' \
    "$cap" "$latency_ms" "$n" "$STUB_CONNECTION_ID" \
    "$(stub_config)")"

  window_start "$dir" "fiscal-lane-stub" "$CONN_IDS" 0 "$extra"
  drained="$(drain_wait "$CONN_IDS" || true)"
  window_stop "$dir"

  local stub_after
  stub_after="$(stub_config)"
  local max_inflight
  max_inflight="$(printf '%s' "$stub_after" | jq -r '.maxInFlightObserved // "unknown"')"

  local rows
  rows="$(pg_sql "
    SELECT
      COUNT(*) FILTER (WHERE status='succeeded' AND outcome='ok')       AS ok,
      COUNT(*) FILTER (WHERE status='dead')                            AS dead,
      COUNT(*) FILTER (WHERE status IN ('queued','running'))           AS stuck,
      COUNT(*) FILTER (WHERE outcome='business_failure')               AS bizfail,
      COALESCE(ROUND(AVG(\"lastAttemptDurationMs\")),0)                AS exec_mean,
      COALESCE(ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY \"lastAttemptDurationMs\")),0) AS exec_p50,
      COUNT(\"lastAttemptDurationMs\")                                 AS exec_n,
      COALESCE(ROUND(EXTRACT(EPOCH FROM (MAX(\"updatedAt\") - MIN(\"createdAt\")))::numeric, 3),0) AS span_secs
    FROM sync_jobs WHERE \"idempotencyKey\" LIKE 'f3006:$RUN_GROUP:$arm:%'")"

  local elapsed=$((WINDOW_STOP_EPOCH - WINDOW_START_EPOCH))
  local ok dead stuck bizfail exec_mean exec_p50 exec_n span
  IFS='|' read -r ok dead stuck bizfail exec_mean exec_p50 exec_n span <<< "$rows"

  local tput_per_hour predicted_span
  tput_per_hour="$(awk -v o="${ok:-0}" -v s="${span:-0}" 'BEGIN{ if (s+0>0) printf "%.1f", o/s*3600; else print "0" }')"
  predicted_span="$(awk -v n="$n" -v t="$latency_ms" -v c="$cap" 'BEGIN{ printf "%.1f", n * (t/1000) / c }')"

  run_post_guards "$dir" "$CONN_IDS" \
    "$(date -u -d "@$WINDOW_START_EPOCH" +%Y-%m-%dT%H:%M:%SZ)" \
    "$WINDOW_START_EPOCH" "$WINDOW_STOP_EPOCH" || true
  local verdict
  verdict="$(verdict_read "$dir" 2>/dev/null | awk 'NR==1' || printf 'UNKNOWN')"
  [ -n "$verdict" ] || verdict=UNKNOWN

  log "ARM perScope=$cap T=${latency_ms}ms n=$n -> $verdict ok=$ok dead=$dead stuck=$stuck bizfail=$bizfail span=${span}s(predicted ${predicted_span}s) docs/hr=$tput_per_hour exec_p50=${exec_p50}ms maxInFlightObserved=$max_inflight drain=$drained"

  ARMS_CSV="$ARMS_CSV$cap,$latency_ms,$n,$ok,$dead,$stuck,$bizfail,$span,$predicted_span,$tput_per_hour,$exec_mean,$exec_p50,$exec_n,$max_inflight,$elapsed,$drained,$verdict
"
  LAST_DIR="$dir"
}

# ===========================================================================
# Run - outer loop over CAPS (one worker recreate each), inner loop over
# latencies (no recreate needed between them - latency is stub-side runtime
# state, see stub README).
# ===========================================================================
for cap in $CAPS; do
  recreate_worker "$cap"
  assert_fiscal_cap_applied "$cap"
  guard_runner_state enabled

  idx=0
  for latency_ms in "${LATENCY_ARR[@]}"; do
    n="${JOBCOUNT_ARR[$idx]}"
    run_arm "$cap" "$latency_ms" "$n"
    idx=$((idx + 1))
  done
done

SUMMARY="$RESULTS_ROOT/fiscal-lane-stub/$RUN_GROUP-summary.csv"
mkdir -p "$(dirname "$SUMMARY")"
{
  printf 'perScopeCap,latencyMs,jobsEnqueued,succeeded,dead,stuck,businessFailure,spanSecs,predictedSpanSecs,docsPerHour,execMeanMs,execP50Ms,execN,maxInFlightObserved,windowSecs,drainResult,verdict\n'
  printf '%s' "$ARMS_CSV"
} > "$SUMMARY"

log "summary written: $SUMMARY"
printf '\n'
column -s, -t < "$SUMMARY" 2>/dev/null || cat "$SUMMARY"
printf '\n'
log "fiscal-lane-stub complete. Results under $RESULTS_ROOT/fiscal-lane-stub/$RUN_GROUP-*"
log "REMINDER: this stub measures the fiscal LANE and the per-order LOCK. It says nothing about a real provider's variance, rate limits, or failure modes."
