#!/usr/bin/env bash
#
# Allegro sandbox latency baseline probe (#2861, epic #2840).
#
# Measures real per-request latency for the two Allegro endpoints the #2856
# stub reproduces:
#
#   GET /order/events?from={cursor}&limit=100        (one per poll tick)
#   GET /order/checkout-forms/{id}                    (one per ingested order)
#
# This is a CHARACTERISATION PROBE, not a throughput run: it applies no load
# beyond a small, sequential sample. It does not model concurrency, does not
# drive a sustained rate, and is re-run only when the stub's cost model
# changes - see #2840's own data-source policy.
#
# WHY THIS SCRIPT DOES NOT AUTHENTICATE TO ALLEGRO ITSELF
# ---------------------------------------------------------------------------
# An Allegro sandbox connection's OAuth access token lives encrypted in
# OpenLinker's own `integration_credentials` table. This script deliberately
# never decrypts it, never reads it, and never talks to Allegro directly -
# handling a live OAuth secret outside the system that owns it is exactly the
# kind of thing a one-off perf script should not be trusted with.
#
# Instead it drives the *real* Allegro adapter, inside the running OpenLinker
# worker, through the same public seam an operator already uses:
#
#   - GET /order/events:  this endpoint has ORGANIC traffic already, because
#     the `allegro-orders-poll` scheduler task calls it once a minute for
#     every active connection with OrderSource enabled (see
#     `allegro-scheduler-tasks.ts`). This script therefore does not enqueue a
#     single extra request for this endpoint - it harvests the worker's own
#     structured debug log, which the Allegro HTTP client already writes one
#     line to per request:
#       "[<traceId>] Response: <status> (<ms>ms) - GET /order/events"
#     scoped to the target connection by correlating trace ids against the
#     preceding "GET /order/events?... (connection: <id>)" line. This is a
#     STRICTLY LOWER-LOAD measurement than an active probe: it adds nothing
#     to the sandbox beyond what the deployment already does every minute.
#
#   - GET /order/checkout-forms/{id}: there is no organic traffic for this
#     endpoint unless real orders are being ingested. The script actively
#     re-enqueues `marketplace.order.sync` for a small, caller-supplied list
#     of externalOrderId values ALREADY mapped to the connection (see
#     ORDER_EXTERNAL_IDS below). `OrderIngestionService.syncOrderFromSource`
#     always calls `getOrder()` first (so the endpoint is genuinely hit), so
#     this half is inherently active rather than passive. Re-syncing an
#     already-known order is safe and idempotent ONLY WHEN a destination
#     mapping already exists for it: `OrderSyncService.createOrderIdempotently`
#     then skips re-creating the order at that destination - see
#     `libs/core/src/orders/application/services/order-sync.service.ts`. If
#     no destination mapping exists yet, the SAME re-sync creates a REAL
#     order at every active destination connection. This is not a
#     hypothetical: an earlier run of this exact script, before the safety
#     gate below existed, did exactly that against the demo stand's
#     PrestaShop connection - see #2861's results report for the full
#     account. `step_check_destination_safety` / `probe_checkout_forms`
#     below refuse to run unless this is either structurally impossible (no
#     active destination connection) or the operator has explicitly
#     confirmed it and opted in. Requests are strictly SEQUENTIAL (one
#     enqueue, wait for completion, sleep, repeat) - never parallel.
#
# In both cases the number reported is the Allegro HTTP client's own
# Date.now() round-trip measurement (`allegro-http-client.ts:298,381`), i.e.
# the real network + Allegro-processing time - not OpenLinker's own job
# overhead (identifier mapping, DB writes, etc., which `lastAttemptDurationMs`
# would include and which this script deliberately does NOT report as
# "Allegro latency").
#
# DEPENDENCIES
# ---------------------------------------------------------------------------
#   - An Allegro SANDBOX connection, `status = active`, reachable from the OL
#     API named by OL_API_URL.
#   - Docker log access to the worker container that services that
#     connection (WORKER_CONTAINER), at a log level that includes `debug`
#     (the shipped default - see `apps/worker/src/main.ts`).
#   - For the checkout-forms half only: at least one externalOrderId that is
#     BOTH mapped to the connection AND already destination-mapped (i.e. a
#     prior run already created it at every active OrderProcessorManager
#     connection), so a re-sync is provably a no-op skip rather than a real
#     second order create. Find such ids with:
#       SELECT m1."externalId" FROM identifier_mappings m1
#       JOIN identifier_mappings m2 ON m1."internalId" = m2."internalId"
#       WHERE m1."connectionId" = '<CONNECTION_ID>' AND m1."entityType" = 'Order'
#         AND m2."connectionId" <> m1."connectionId"
#       LIMIT 20;
#     passed via ORDER_EXTERNAL_IDS as a comma-separated list. Without it,
#     that half is SKIPPED (reported as such - never guessed at). See the
#     SAFETY GATE comment above `probe_checkout_forms` for why this matters:
#     an earlier run of this exact script, before the gate existed, used an
#     externalOrderId with no destination mapping and created a real order
#     at the demo stand's PrestaShop connection. The gate below refuses to
#     run unless either no active destination connection exists, or the
#     operator explicitly overrides it with FORCE_CHECKOUT_FORMS_PROBE=yes
#     after confirming every id the query above.
#
# USAGE
# ---------------------------------------------------------------------------
#   CONNECTION_ID=<uuid> \
#   WORKER_CONTAINER=<container-name> \
#   ORDER_EXTERNAL_IDS=<id1,id2,...> \
#   ./allegro-latency.sh
#
# See the full env-var list below (every one is overridable, all have
# defaults suited to the #2854 `lab` stand except CONNECTION_ID, which has
# none - measuring against the wrong connection silently is worse than
# refusing to guess).
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
OL_API_URL="${OL_API_URL:-http://127.0.0.1:13000}"
OL_ADMIN_USER="${OL_ADMIN_USER:-admin}"
OL_ADMIN_PASSWORD="${OL_ADMIN_PASSWORD:-admin}"
CONNECTION_ID="${CONNECTION_ID:?Set CONNECTION_ID to the Allegro sandbox connections UUID}"
WORKER_CONTAINER="${WORKER_CONTAINER:-lab-worker}"

# How many samples to take for the checkout-forms endpoint's ACTIVE probe
# (the fallback path - see probe_checkout_forms's dispatcher). The passive
# harvest below caps at this same number too, most-recent-first.
SAMPLE_SIZE="${SAMPLE_SIZE:-20}"
# How far back to look for organic traffic (minutes) - shared by BOTH
# passive harvesters (/order/events and, since checkout-forms may now have
# real buyer traffic too, /order/checkout-forms/{id}).
EVENTS_LOOKBACK_MINUTES="${EVENTS_LOOKBACK_MINUTES:-120}"
# Comma-separated externalOrderId values already mapped to CONNECTION_ID.
# Leave empty to skip the checkout-forms half.
ORDER_EXTERNAL_IDS="${ORDER_EXTERNAL_IDS:-}"
# Pause between sequential checkout-forms requests - a good-citizen gap, not
# a rate limit workaround (Allegro's own budget is 9000 req/min/client-id).
REQUEST_INTERVAL_SECONDS="${REQUEST_INTERVAL_SECONDS:-5}"
# How long to wait for one marketplace.order.sync job to reach a terminal
# status before giving up on that sample.
JOB_POLL_TIMEOUT_SECONDS="${JOB_POLL_TIMEOUT_SECONDS:-30}"
JOB_POLL_INTERVAL_SECONDS="${JOB_POLL_INTERVAL_SECONDS:-1}"

# Where the raw per-endpoint sample arrays are written (JSON), for the
# results report to cite verbatim rather than re-deriving.
OUT_JSON="${OUT_JSON:-$(cd "$(dirname "$0")" && pwd)/allegro-latency-samples.json}"

log()  { printf '[allegro-latency] %s\n' "$*" >&2; }
warn() { printf '[allegro-latency] WARN  %s\n' "$*" >&2; }
die()  { printf '[allegro-latency] FATAL %s\n' "$*" >&2; exit 1; }

OL_TOKEN=""

# Same shape as bootstrap.sh's `ol_api` helper (this script is standalone -
# see the epic's #2861 conflict-avoidance note - so it is duplicated rather
# than sourced).
ol_api() {
  local method="$1" path="$2" body="${3:-}" resp status resp_body
  if [ -n "$body" ]; then
    resp="$(curl -sS -w '\n%{http_code}' -X "$method" "$OL_API_URL$path" \
      -H "Authorization: Bearer $OL_TOKEN" -H 'Content-Type: application/json' -d "$body")"
  else
    resp="$(curl -sS -w '\n%{http_code}' -X "$method" "$OL_API_URL$path" -H "Authorization: Bearer $OL_TOKEN")"
  fi
  status="${resp##*$'\n'}"
  resp_body="${resp%$'\n'*}"
  if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
    die "$method $path -> HTTP $status: $resp_body"
  fi
  printf '%s' "$resp_body"
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
step_preflight() {
  log "--- preflight ---"
  for tool in docker curl python3; do
    command -v "$tool" >/dev/null 2>&1 || die "missing host tool: $tool"
  done
  docker inspect "$WORKER_CONTAINER" >/dev/null 2>&1 \
    || die "container not running: $WORKER_CONTAINER (set WORKER_CONTAINER)"
  log "preflight ok"
}

step_login() {
  log "--- login ---"
  local body
  body="$(curl -fsS -X POST "$OL_API_URL/v1/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$OL_ADMIN_USER\",\"password\":\"$OL_ADMIN_PASSWORD\"}")" \
    || die "login failed against $OL_API_URL"
  OL_TOKEN="$(printf '%s' "$body" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("access_token") or d.get("accessToken") or "")')"
  [ -n "$OL_TOKEN" ] || die "login succeeded but no access_token in response: $body"

  # Confirm the connection is the sandbox we think it is and that it is
  # active - a stale/wrong connectionId would otherwise fail silently later
  # (an inactive connection simply never calls Allegro, and the checkout-forms
  # probe would time out with a confusing reason).
  local conn_json environment conn_status
  conn_json="$(ol_api GET "/v1/connections/$CONNECTION_ID")"
  conn_status="$(printf '%s' "$conn_json" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("status",""))')"
  environment="$(printf '%s' "$conn_json" | python3 -c 'import sys,json; print((json.load(sys.stdin).get("config") or {}).get("environment",""))')"
  [ "$conn_status" = "active" ] || die "connection $CONNECTION_ID is not active (status=$conn_status)"
  if [ "$environment" != "sandbox" ]; then
    warn "connection $CONNECTION_ID does not declare config.environment=sandbox (got '$environment') - refusing to run against a possibly-production connection"
    die "aborting: this probe is sandbox-only by design"
  fi
  log "logged in; connection confirmed active + sandbox"
}

# ---------------------------------------------------------------------------
# GET /order/events - passive harvest of organic scheduler traffic
# ---------------------------------------------------------------------------
probe_order_events() {
  log "--- GET /order/events (passive harvest, last ${EVENTS_LOOKBACK_MINUTES}m) ---"
  local log_file
  log_file="$(mktemp)"
  docker logs "$WORKER_CONTAINER" --since "${EVENTS_LOOKBACK_MINUTES}m" >"$log_file" 2>&1 || true

  # NOTE: the python script's SOURCE comes from the heredoc below; the log
  # content is passed as a FILE ARGUMENT, never piped in - a command cannot
  # simultaneously read its own script from a heredoc and separate data from
  # a pipe on the same stdin.
  python3 - "$CONNECTION_ID" "order_events" "$SAMPLE_SIZE" "$log_file" <<'PY'
import re, sys, json

connection_id = sys.argv[1]
label = sys.argv[2]
cap = int(sys.argv[3])
log_path = sys.argv[4]
with open(log_path, errors='replace') as f:
    text = f.read()

# Correlate by trace id: the request line carries "(connection: <id>)", the
# response line does not, so build trace -> connection first.
req_re = re.compile(
    r'\[([0-9a-f-]{36})\]\s+GET\s+/order/events\?.*?\(connection:\s*([0-9a-f-]{36})\)'
)
resp_re = re.compile(
    r'\[([0-9a-f-]{36})\]\s+Response:\s+(\d+)\s+\((\d+)ms\)\s+-\s+GET\s+/order/events\b'
)

trace_to_conn = {}
for m in req_re.finditer(text):
    trace_to_conn[m.group(1)] = m.group(2)

samples = []
for m in resp_re.finditer(text):
    trace, status, ms = m.group(1), m.group(2), int(m.group(3))
    if trace_to_conn.get(trace) != connection_id:
        continue
    if status != '200':
        continue  # a fast error is not a fast success - count separately
    samples.append(ms)

samples = samples[-cap:] if len(samples) > cap else samples
print(json.dumps({label: samples}))
PY
  rm -f "$log_file"
}

# ---------------------------------------------------------------------------
# GET /order/checkout-forms/{id} - active, sequential probe
#
# SAFETY GATE (added after a real incident - see #2861's results report):
# `OrderIngestionService.syncOrderFromSource` calls `getOrder()` first (which
# is what we want to measure) but then falls through to
# `OrderSyncService.syncOrder()`, which fans out to every ACTIVE
# OrderProcessorManager-capable connection. Re-syncing an externalOrderId
# that has never been destination-mapped is NOT a no-op: it creates a real
# order at that destination. `createOrderIdempotently` only skips the create
# when a destination mapping ALREADY exists for that specific internal order
# - which is not guaranteed just because the order was ingested before.
#
# This gate therefore refuses to run, by default, whenever any OTHER active
# connection on the deployment advertises OrderProcessorManager - the
# operator must either pre-verify every id in ORDER_EXTERNAL_IDS already has
# a destination mapping (see the SQL in the script header) and set
# FORCE_CHECKOUT_FORMS_PROBE=yes, or run this against a stand with no live
# destination connection at all (the #2854 `lab` stand, once #2856's stub
# ships, or a stand with the destination connection disabled first).
# ---------------------------------------------------------------------------
FORCE_CHECKOUT_FORMS_PROBE="${FORCE_CHECKOUT_FORMS_PROBE:-no}"

step_check_destination_safety() {
  local connections has_destination
  connections="$(ol_api GET '/v1/connections?status=active')"
  has_destination="$(printf '%s' "$connections" | python3 -c "
import sys, json
mine = '$CONNECTION_ID'
data = json.load(sys.stdin)
found = []
for c in data:
    if c.get('id') == mine:
        continue
    caps = c.get('enabledCapabilities') or []
    if 'OrderProcessorManager' in caps:
        found.append(f\"{c.get('name','?')} ({c.get('id','?')})\")
print(';'.join(found))
")"
  if [ -n "$has_destination" ]; then
    warn "active OrderProcessorManager-capable connection(s) found: $has_destination"
    warn "re-syncing an externalOrderId with no existing destination mapping WILL create a real order there"
    if [ "$FORCE_CHECKOUT_FORMS_PROBE" != "yes" ]; then
      warn "refusing to run the checkout-forms probe (set FORCE_CHECKOUT_FORMS_PROBE=yes to override, only after confirming every ORDER_EXTERNAL_IDS value already has a destination mapping)"
      return 1
    fi
    warn "FORCE_CHECKOUT_FORMS_PROBE=yes - proceeding anyway, at the operator's own risk"
  fi
  return 0
}

probe_checkout_forms_active() {
  log "--- GET /order/checkout-forms/{id} (active, sequential, N=$SAMPLE_SIZE) ---"

  if [ -z "$ORDER_EXTERNAL_IDS" ]; then
    warn "ORDER_EXTERNAL_IDS is empty - skipping checkout-forms probe"
    printf '%s' '{"checkout_forms": [], "skipped": true, "skipReason": "no ORDER_EXTERNAL_IDS supplied"}'
    return 0
  fi

  if ! step_check_destination_safety; then
    printf '%s' '{"checkout_forms": [], "skipped": true, "skipReason": "refused: an active destination (OrderProcessorManager) connection exists and FORCE_CHECKOUT_FORMS_PROBE was not set - see the script header for why"}'
    return 0
  fi

  IFS=',' read -r -a ids <<< "$ORDER_EXTERNAL_IDS"
  local id_count="${#ids[@]}"
  [ "$id_count" -gt 0 ] || die "ORDER_EXTERNAL_IDS parsed to zero ids"

  local samples=()
  local i id idempotency_key t_before t_after payload resp status attempt found
  for (( i = 1; i <= SAMPLE_SIZE; i++ )); do
    id="${ids[$(( (i - 1) % id_count ))]}"
    idempotency_key="perf:allegro-latency-probe:checkout-forms:$i:$(date +%s%N)"
    payload="{\"schemaVersion\":1,\"externalOrderId\":\"$id\"}"

    # A couple of seconds of slack before the enqueue call, so the log-window
    # lower bound cannot clip the request line if it lands on the same second.
    t_before="$(date -u -d '-2 seconds' +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -v-2S +%Y-%m-%dT%H:%M:%S)"

    resp="$(ol_api POST /v1/sync/jobs "{\"jobType\":\"marketplace.order.sync\",\"connectionId\":\"$CONNECTION_ID\",\"payload\":$payload,\"idempotencyKey\":\"$idempotency_key\"}")"

    # Poll the job list for our idempotencyKey until it reaches a terminal
    # status. Filtered narrowly (connectionId + jobType), so our own job is
    # almost always item 0; limit=10 covers a brief burst of unrelated churn.
    status=""
    attempt=0
    while [ "$attempt" -lt "$JOB_POLL_TIMEOUT_SECONDS" ]; do
      found="$(ol_api GET "/v1/sync/jobs?connectionId=$CONNECTION_ID&jobType=marketplace.order.sync&limit=10")"
      status="$(printf '%s' "$found" | python3 -c "
import sys, json
key = '$idempotency_key'
d = json.load(sys.stdin)
for item in d.get('items', []):
    if item.get('idempotencyKey') == key:
        print(item.get('status', ''))
        break
")"
      if [ "$status" = "succeeded" ] || [ "$status" = "dead" ]; then
        break
      fi
      sleep "$JOB_POLL_INTERVAL_SECONDS"
      attempt=$(( attempt + JOB_POLL_INTERVAL_SECONDS ))
    done

    if [ "$status" != "succeeded" ]; then
      warn "sample $i (externalOrderId=$id) did not reach succeeded within ${JOB_POLL_TIMEOUT_SECONDS}s (last status='$status') - discarded"
      sleep "$REQUEST_INTERVAL_SECONDS"
      continue
    fi

    t_after="$(date -u -d '+2 seconds' +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -v+2S +%Y-%m-%dT%H:%M:%S)"
    local ms sample_log_file
    sample_log_file="$(mktemp)"
    docker logs "$WORKER_CONTAINER" --since "$t_before" --until "$t_after" >"$sample_log_file" 2>&1 || true
    # Same rule as probe_order_events: the python SOURCE is the heredoc, the
    # log content is a file argument, never piped stdin (the two conflict).
    ms="$(python3 - "$id" "$sample_log_file" <<'PY'
import re, sys
target = sys.argv[1]
log_path = sys.argv[2]
with open(log_path, errors='replace') as f:
    text = f.read()
pattern = re.compile(
    r'Response:\s+(\d+)\s+\((\d+)ms\)\s+-\s+GET\s+/order/checkout-forms/'
)
matches = pattern.findall(text)
# Only 200s count. Take the LAST match in the window - this is the one that
# corresponds to the job we just waited on.
ok = [int(m) for status, m in matches if status == '200']
print(ok[-1] if ok else '')
PY
)"
    rm -f "$sample_log_file"

    if [ -n "$ms" ]; then
      samples+=("$ms")
      log "sample $i/$SAMPLE_SIZE: externalOrderId=$id -> ${ms}ms"
    else
      warn "sample $i (externalOrderId=$id): job succeeded but no matching log line found - discarded"
    fi

    sleep "$REQUEST_INTERVAL_SECONDS"
  done

  local joined
  joined="$(IFS=,; echo "${samples[*]:-}")"
  python3 -c "
import json
raw = '$joined'
samples = [int(x) for x in raw.split(',') if x]
print(json.dumps({'checkout_forms': samples, 'skipped': False}))
"
}

# ---------------------------------------------------------------------------
# GET /order/checkout-forms/{id} - passive harvest, mirroring
# probe_order_events exactly. This exists because there is no reason to
# risk the active path's side effect (see the SAFETY GATE above) when a real
# buyer has already generated organic traffic for this endpoint - e.g. via
# sandbox purchases on the Allegro seller account this connection uses.
# Zero added load, same as probe_order_events.
# ---------------------------------------------------------------------------
probe_checkout_forms_passive() {
  log "--- GET /order/checkout-forms/{id} (passive harvest, last ${EVENTS_LOOKBACK_MINUTES}m) ---"
  local log_file
  log_file="$(mktemp)"
  docker logs "$WORKER_CONTAINER" --since "${EVENTS_LOOKBACK_MINUTES}m" >"$log_file" 2>&1 || true

  python3 - "$CONNECTION_ID" "checkout_forms" "$SAMPLE_SIZE" "$log_file" <<'PY'
import re, sys, json

connection_id = sys.argv[1]
label = sys.argv[2]
cap = int(sys.argv[3])
log_path = sys.argv[4]
with open(log_path, errors='replace') as f:
    text = f.read()

# Same trace-id correlation as probe_order_events: the request line carries
# "(connection: <id>)", the response line does not.
req_re = re.compile(
    r'\[([0-9a-f-]{36})\]\s+GET\s+/order/checkout-forms/[0-9a-f-]{36}\s+\(connection:\s*([0-9a-f-]{36})\)'
)
resp_re = re.compile(
    r'\[([0-9a-f-]{36})\]\s+Response:\s+(\d+)\s+\((\d+)ms\)\s+-\s+GET\s+/order/checkout-forms/'
)

trace_to_conn = {}
for m in req_re.finditer(text):
    trace_to_conn[m.group(1)] = m.group(2)

samples = []
for m in resp_re.finditer(text):
    trace, status, ms = m.group(1), m.group(2), int(m.group(3))
    if trace_to_conn.get(trace) != connection_id:
        continue
    if status != '200':
        continue  # a fast error is not a fast success - count separately
    samples.append(ms)

samples = samples[-cap:] if len(samples) > cap else samples
print(json.dumps({label: samples}))
PY
  rm -f "$log_file"
}

# ---------------------------------------------------------------------------
# Dispatcher: prefer the passive harvest (zero added load) whenever it finds
# ANY organic traffic at all; only fall back to the active, side-effecting
# path (and only then subject to the safety gate) when there is nothing to
# harvest. This is what actually produced this endpoint's measured figure in
# #2861's results report once real sandbox purchases gave it organic
# traffic - the active path below is the fallback for a stand with no such
# traffic, not the preferred route.
# ---------------------------------------------------------------------------
probe_checkout_forms() {
  local passive_json passive_count
  passive_json="$(probe_checkout_forms_passive)"
  passive_count="$(printf '%s' "$passive_json" | python3 -c 'import sys,json; print(len(json.load(sys.stdin).get("checkout_forms") or []))')"

  if [ "$passive_count" -gt 0 ]; then
    log "checkout-forms: $passive_count sample(s) harvested passively - skipping the active probe entirely"
    printf '%s' "$passive_json"
    return 0
  fi

  log "checkout-forms: no organic traffic found in the last ${EVENTS_LOOKBACK_MINUTES}m - falling back to the active probe"
  probe_checkout_forms_active
}

main() {
  step_preflight
  step_login

  local events_json checkout_json
  events_json="$(probe_order_events)"
  checkout_json="$(probe_checkout_forms)"

  python3 -c "
import json
events = json.loads('''$events_json''')
checkout = json.loads('''$checkout_json''')
merged = {**events, **checkout}
print(json.dumps(merged, indent=2))
" > "$OUT_JSON"

  log "--- summary ---"
  python3 - "$OUT_JSON" <<'PY'
import json, sys, statistics

def pct(vals, p):
    vals = sorted(vals)
    return vals[min(len(vals) - 1, int(round(p / 100 * len(vals))) - 1)]

with open(sys.argv[1]) as f:
    data = json.load(f)

for key, label in (('order_events', 'GET /order/events'), ('checkout_forms', 'GET /order/checkout-forms/{id}')):
    vals = data.get(key) or []
    if not vals:
        print(f'{label}: NO SAMPLES')
        continue
    vals_sorted = sorted(vals)
    print(
        f'{label}: n={len(vals)} '
        f'p50={pct(vals, 50)}ms p95={pct(vals, 95)}ms '
        f'min={vals_sorted[0]}ms max={vals_sorted[-1]}ms '
        f'mean={statistics.mean(vals):.1f}ms'
    )
PY

  log "raw samples written to $OUT_JSON"
}

main
