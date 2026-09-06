#!/usr/bin/env bash
#
# F3 - webhook ingress burst throughput (#2842, epic #2840).
# See docs/plans/implementation-plan-f3-webhook-burst.md for the full design.
#
# Measures what POST /webhooks/:provider/:connectionId can absorb under a
# sustained arrival-rate burst, and what happens at the durability gate when
# the same eventId arrives many times at once (ADR-005 / ADR-049 decision 1).
#
# Sources lib.sh (#2841) for every guard/manifest/sampler/verdict primitive -
# this script owns nothing that library already owns. See the README section
# this scenario is documented under for the full mechanics, the DOCKER_CONFIG
# docker-pull workaround, and why the strict path cannot run on a workstation
# stand.
#
# Two modes:
#   (default, strict)  the full measurement: every #2841 guard,
#                       guard_runner_state disabled, the routable-event
#                       probe, the P1-P4 differential probes, three arms,
#                       the pg sampler, run_post_guards, verdict_write, and a
#                       dated report under results/.
#   --smoke             the driver self-test. Runs the pre-signer, fires the
#                       four differential probes and a short low-rate burst
#                       against the live API. Structurally incapable of
#                       producing a measurement - no manifest, no verdict, no
#                       dated report, nothing written under results/.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_LOG_PREFIX="f3"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

DRIVERS_DIR="$SCRIPT_DIR/../drivers"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WEBHOOKS_TS="$REPO_ROOT/apps/e2e/src/support/webhooks.ts"
[ -f "$WEBHOOKS_TS" ] || die "expected the e2e signer at $WEBHOOKS_TS - repo layout changed?"

# ---------------------------------------------------------------------------
# Configuration (env-overridable, same convention as lib.sh/bootstrap.sh).
# ---------------------------------------------------------------------------
PROVIDER="${PROVIDER:-prestashop}"
OL_API_INTERNAL_PORT="${OL_API_INTERNAL_PORT:-3000}"
K6_IMAGE="${K6_IMAGE:-grafana/k6:1.0.0}"
GEN_INTERVAL_SECS="${GEN_INTERVAL_SECS:-60}"
PAYLOAD_BYTES="${PAYLOAD_BYTES:-256}"

# Strict-mode load shape. Illustrative defaults, same posture #2841's own
# example carries - the real ceiling is found on #2854's isolated stand, not
# guessed at here (plan §6).
TARGET_RATE="${TARGET_RATE:-50}"
RAMP_UP_SECS="${RAMP_UP_SECS:-30}"
PLATEAU_SECS="${PLATEAU_SECS:-120}"
RAMP_DOWN_SECS="${RAMP_DOWN_SECS:-15}"
PRE_ALLOCATED_VUS="${PRE_ALLOCATED_VUS:-50}"
MAX_VUS="${MAX_VUS:-300}"

# Smoke-mode load shape - deliberately tiny and short. --smoke exists to
# prove the moving parts, never to produce a number (plan §6).
SMOKE_TARGET_RATE="${SMOKE_TARGET_RATE:-2}"
SMOKE_RAMP_UP_SECS="${SMOKE_RAMP_UP_SECS:-1}"
SMOKE_PLATEAU_SECS="${SMOKE_PLATEAU_SECS:-3}"
SMOKE_RAMP_DOWN_SECS="${SMOKE_RAMP_DOWN_SECS:-1}"
SMOKE_PRE_ALLOCATED_VUS="${SMOKE_PRE_ALLOCATED_VUS:-5}"
SMOKE_MAX_VUS="${SMOKE_MAX_VUS:-20}"

NON_2XX_DISCARD_RATIO="${NON_2XX_DISCARD_RATIO:-0.005}"  # 0.5% (plan §4.5 AC)

REPLAY_CONCURRENT_DISTINCT_IDS="${REPLAY_CONCURRENT_DISTINCT_IDS:-5}"

# #2929 - timed differential probes. Sequential, one request at a time (never
# part of the k6 burst - see run_differential_probes for the untimed
# correctness ladder these reuse the same four modes from), so
# PROBE_TIMING_SAMPLES x ~4 requests x a few ms each is seconds of wall time,
# not a load test in its own right.
PROBE_TIMING_SAMPLES="${PROBE_TIMING_SAMPLES:-300}"

# #2930 - the fixed-VU-pool concurrent-replay sweep. All VUs in one step
# post the SAME pre-signed entry (--distinct-ids 1); the VU count is what
# sweeps, deliberately not the arrival rate, so a waiter or a tuple-lock wait
# is attributable to the collision rather than to the system falling behind
# a rate. CONCURRENT_VUS_DURATION_SECS is short on purpose - long enough for
# k6 to reach a steady VU count, short enough that the run stays comfortably
# inside one pre-signed generation's skew window.
CONCURRENT_VUS_STEPS="${CONCURRENT_VUS_STEPS:-2 8 32 128}"
CONCURRENT_VUS_DURATION_SECS="${CONCURRENT_VUS_DURATION_SECS:-20}"

MODE="strict"
for arg in "$@"; do
  case "$arg" in
    --smoke) MODE="smoke" ;;
    -h|--help)
      cat <<'USAGE'
Usage: f3-webhook-burst.sh [--smoke]

  (no flag)  strict measurement - every #2841 guard runs, aborts loudly if
             any fails. Never skippable; there is no override flag.
  --smoke    driver self-test only. Writes nothing under results/.
USAGE
      exit 0
      ;;
    *) die "unknown argument: $arg (use --smoke, --help, or nothing)" ;;
  esac
done

[ -n "${WEBHOOK_CONNECTION_ID:-}" ] || die "WEBHOOK_CONNECTION_ID is not set - source stand-ids.env (bootstrap.sh, #2842 adds 'perf-webhook-ingress' to it) or export it by hand"

require_tools docker node jq curl python3

docker image inspect "$K6_IMAGE" >/dev/null 2>&1 \
  || die "k6 image $K6_IMAGE not present locally - docker pull it first (README: DOCKER_CONFIG workaround for a broken credsStore helper)"

ol_login

# ---------------------------------------------------------------------------
# The docker network k6 must join to reach the api container by name, and
# the URL the k6 container uses (api's INTERNAL port, never OL_API_URL's
# host-published 127.0.0.1 mapping - the k6 container is not on the host
# network namespace).
# ---------------------------------------------------------------------------
resolve_docker_network() {
  local net
  net="$(docker inspect "$OL_API_CONTAINER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null)"
  [ -n "$net" ] || die "resolve_docker_network: could not read a network for $OL_API_CONTAINER - is it running?"
  printf '%s' "$net"
}
K6_NETWORK="${K6_NETWORK:-$(resolve_docker_network)}"
TARGET_URL="http://$OL_API_CONTAINER:$OL_API_INTERNAL_PORT/webhooks/$PROVIDER/$WEBHOOK_CONNECTION_ID"

# ---------------------------------------------------------------------------
# §4.2 - rotate and hold the webhook secret. Never written to disk, manifest
# or report - held only in this shell's SECRET local for the life of the run.
# Because this connection is F3's own and points at no live shop, rotation
# damages nothing and no `install` restore is owed here, unlike
# apps/e2e/src/support/webhook-secret.ts's situation against a shared,
# operator-relied-on connection.
# ---------------------------------------------------------------------------
rotate_webhook_secret() {
  local resp secret
  resp="$(ol_api POST "/v1/connections/$WEBHOOK_CONNECTION_ID/webhooks/secret/rotate" "")"
  secret="$(printf '%s' "$resp" | json_field secret)"
  [ -n "$secret" ] || die "rotate_webhook_secret: response carried no 'secret' field: $resp"
  printf '%s' "$secret"
}
SECRET="$(rotate_webhook_secret)"
log "rotated webhook secret for connection $WEBHOOK_CONNECTION_ID (not persisted anywhere - held in-process only)"

# ---------------------------------------------------------------------------
# presign <out_pool> <arm> <count> <window_start_ms> <duration_secs> [extra presigner args...]
# ---------------------------------------------------------------------------
presign() {
  local out="$1" arm="$2" count="$3" start_ms="$4" duration="$5"; shift 5
  node --experimental-strip-types "$DRIVERS_DIR/presign-webhooks.mjs" \
    --connection-id "$WEBHOOK_CONNECTION_ID" --secret "$SECRET" --arm "$arm" \
    --count "$count" --window-start-ms "$start_ms" --duration-secs "$duration" \
    --provider "$PROVIDER" --gen-interval-secs "$GEN_INTERVAL_SECS" --payload-bytes "$PAYLOAD_BYTES" \
    --out "$out" "$@" \
    1>&2  # presign-webhooks.mjs's own log lines go to stderr already; this
          # keeps its stdout (none today) from ever mixing into a caller
          # that captures this function's output.
}

# ---------------------------------------------------------------------------
# run_k6 <pool_file> <run_start_ms> <arm> <rate> <ramp_up> <plateau> <ramp_down> <pre_vus> <max_vus> <summary_out>
#
# --user "$(id -u):$(id -g)" - the k6 image's default user (uid 12345) cannot
# write into a bind-mounted directory owned by the invoking host user;
# running as that user's own uid/gid avoids needing to chmod the results
# directory world-writable (verified live against grafana/k6:1.0.0, #2842).
# ---------------------------------------------------------------------------
run_k6() {
  local pool="$1" start_ms="$2" arm="$3" rate="$4" up="$5" plateau="$6" down="$7" pre="$8" mx="$9" summary_out="${10}"
  local pool_dir summary_dir
  pool_dir="$(cd "$(dirname "$pool")" && pwd)"
  summary_dir="$(cd "$(dirname "$summary_out")" && pwd)"
  docker run --rm --network "$K6_NETWORK" --user "$(id -u):$(id -g)" \
    -v "$pool_dir":/pool -v "$summary_dir":/results -v "$DRIVERS_DIR":/drivers:ro \
    -e "POOL_FILE=/pool/$(basename "$pool")" \
    -e "TARGET_URL=$TARGET_URL" \
    -e "RUN_START_MS=$start_ms" \
    -e "ARM=$arm" \
    -e "GEN_INTERVAL_MS=$((GEN_INTERVAL_SECS * 1000))" \
    -e "TARGET_RATE=$rate" -e "RAMP_UP_SECS=$up" -e "PLATEAU_SECS=$plateau" -e "RAMP_DOWN_SECS=$down" \
    -e "PRE_ALLOCATED_VUS=$pre" -e "MAX_VUS=$mx" \
    "$K6_IMAGE" run --summary-export="/results/$(basename "$summary_out")" /drivers/webhook-burst.js
}

# ---------------------------------------------------------------------------
# run_k6_constant_vus <pool_file> <run_start_ms> <arm> <vus> <duration_secs> <summary_out>
#
# #2930 - the constant-vus counterpart to run_k6, above. Same container/mount/
# user shape; EXECUTOR=constant-vus tells the driver to hold a FIXED pool of
# <vus> virtual users for <duration_secs> instead of chasing an arrival rate -
# TARGET_RATE and the ramp/pre-allocated-VUs knobs are irrelevant under that
# executor and are deliberately NOT passed, so a reader of this run's docker
# invocation never mistakes a stale rate value for something that mattered.
# ---------------------------------------------------------------------------
run_k6_constant_vus() {
  local pool="$1" start_ms="$2" arm="$3" vus="$4" duration="$5" summary_out="$6"
  local pool_dir summary_dir
  pool_dir="$(cd "$(dirname "$pool")" && pwd)"
  summary_dir="$(cd "$(dirname "$summary_out")" && pwd)"
  docker run --rm --network "$K6_NETWORK" --user "$(id -u):$(id -g)" \
    -v "$pool_dir":/pool -v "$summary_dir":/results -v "$DRIVERS_DIR":/drivers:ro \
    -e "POOL_FILE=/pool/$(basename "$pool")" \
    -e "TARGET_URL=$TARGET_URL" \
    -e "RUN_START_MS=$start_ms" \
    -e "ARM=$arm" \
    -e "GEN_INTERVAL_MS=$((GEN_INTERVAL_SECS * 1000))" \
    -e "EXECUTOR=constant-vus" \
    -e "VUS=$vus" -e "DURATION_SECS=$duration" \
    "$K6_IMAGE" run --summary-export="/results/$(basename "$summary_out")" /drivers/webhook-burst.js
}

# ---------------------------------------------------------------------------
# §3.4 - differential probes. Four small SEQUENTIAL requests, never part of
# the k6 burst, that reach four different depths of the request path
# (§2.1). Reuses the real signer via a throwaway temp .mjs file (not a 6th
# tracked driver - these one-shot requests are scenario-specific glue, not a
# reusable pool-building tool the way presign-webhooks.mjs is).
#
# Echoes one "MODE STATUS EVENTID" line per probe to stdout.
# ---------------------------------------------------------------------------
probe_request() {
  local mode="$1" tmp status_line
  tmp="$(mktemp --suffix=.mjs)"
  cat > "$tmp" <<NODE
import { signWebhook, computeOlHmacSignature } from '$WEBHOOKS_TS';
const SECRET = process.env.F3_PROBE_SECRET;
const url = process.env.F3_PROBE_URL;
async function post(body, headers) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  return { status: res.status, text: await res.text() };
}
const mode = process.env.F3_PROBE_MODE;
const eventId = mode + '-' + Date.now();
let r;
if (mode === 'auth-fail') {
  // P1 - valid envelope, WRONG signature. Stops after connection-read +
  // secret-resolve + verify (§2.1 steps 2/4/5), plus an auth-rejection
  // upsert - never reaches webhook_deliveries at all (ADR-005).
  const envelope = { schemaVersion: 1, eventId, eventType: 'order.created', occurredAt: new Date().toISOString(), object: { type: 'order', externalId: eventId }, payload: {} };
  const rawBody = JSON.stringify(envelope);
  r = await post(rawBody, { 'X-OpenLinker-Timestamp': String(Date.now()), 'X-OpenLinker-Signature': 'sha256=' + '0'.repeat(64) });
} else if (mode === 'decode-reject') {
  // P2 - valid signature over a body that is not a WebhookRequestDto. Stops
  // after decode/validate (§2.1 step 7). The baseline for "authenticated,
  // well-formed enough to be signed, but the envelope itself is rejected".
  const rawBody = JSON.stringify({ not: 'an envelope' });
  const ts = Date.now();
  const sig = computeOlHmacSignature(SECRET, ts, rawBody);
  r = await post(rawBody, { 'X-OpenLinker-Timestamp': String(ts), 'X-OpenLinker-Signature': sig });
} else {
  // P3 (routable-product, ungated on THIS connection - no ProductMaster) /
  // P4 (routable-order, gated on OrderSource, WHICH THIS CONNECTION HAS).
  const objectType = mode === 'routable-order' ? 'order' : 'product';
  const eventType = mode === 'routable-order' ? 'order.created' : 'product.updated';
  const envelope = { schemaVersion: 1, eventId, eventType, occurredAt: new Date().toISOString(), object: { type: objectType, externalId: eventId }, payload: {} };
  const signed = signWebhook(SECRET, envelope);
  r = await post(signed.rawBody, signed.headers);
}
console.log(r.status + ' ' + eventId);
NODE
  status_line="$(F3_PROBE_SECRET="$SECRET" F3_PROBE_URL="$OL_API_URL/webhooks/$PROVIDER/$WEBHOOK_CONNECTION_ID" F3_PROBE_MODE="$mode" \
    node --experimental-strip-types "$tmp" 2>/dev/null)"
  rm -f "$tmp"
  printf '%s %s\n' "$mode" "$status_line"
}

run_differential_probes() {
  local p
  for p in auth-fail decode-reject routable-product routable-order; do
    probe_request "$p"
  done
}

# ---------------------------------------------------------------------------
# #2929 - TIMED differential probes. run_differential_probes / probe_request
# above answer "which stage does this request reach" (the correctness
# ladder); this answers "how long did each stage cost", which is what the
# AC's per-stage latency breakdown needs and which the untimed ladder cannot
# produce at all (results-F3-2026-09-06.md's own "not buildable from the
# current implementation" finding).
#
# Fires PROBE_TIMING_SAMPLES sequential requests per mode (never part of the
# k6 burst - a burst measures throughput, this measures per-request cost at
# a rate the system is never contending with itself over). Only the
# fetch() round trip is timed - envelope construction and HMAC signing
# happen before the clock starts, the same separation of concerns the
# pre-signed k6 pool uses and for the same reason: client-side signing cost
# must never inflate a number that is supposed to describe the SERVER's
# work.
#
# Echoes one "mode,sampleIndex,httpStatus,durationMs,eventId" CSV line (no
# header) per sample to stdout, in mode order (auth-fail, decode-reject,
# routable-product, routable-order).
# ---------------------------------------------------------------------------
run_timed_probes() {
  local n="$1" tmp
  tmp="$(mktemp --suffix=.mjs)"
  cat > "$tmp" <<NODE
import { signWebhook, computeOlHmacSignature } from '$WEBHOOKS_TS';
const SECRET = process.env.F3_PROBE_SECRET;
const url = process.env.F3_PROBE_URL;
const N = Number(process.env.F3_PROBE_TIMING_SAMPLES);

// Only the fetch() call is timed - see the bash-side comment above for why.
async function timedPost(body, headers) {
  const t0 = performance.now();
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  const t1 = performance.now();
  // Drain the body before the next sample - an unconsumed response body can
  // hold the underlying connection open under undici's fetch, which would
  // silently charge a later sample for a fresh-connection cost this probe
  // is not trying to measure (samples reuse one keep-alive connection).
  await res.text();
  return { status: res.status, durationMs: t1 - t0 };
}

function buildRequest(mode, i) {
  const eventId = \`\${mode}-timing-\${Date.now()}-\${i}\`;
  if (mode === 'auth-fail') {
    // P1 - valid envelope, WRONG signature (mirrors probe_request's P1).
    const envelope = { schemaVersion: 1, eventId, eventType: 'order.created', occurredAt: new Date().toISOString(), object: { type: 'order', externalId: eventId }, payload: {} };
    const rawBody = JSON.stringify(envelope);
    return { body: rawBody, headers: { 'X-OpenLinker-Timestamp': String(Date.now()), 'X-OpenLinker-Signature': 'sha256=' + '0'.repeat(64) }, eventId };
  }
  if (mode === 'decode-reject') {
    // P2 - valid signature, body is not a WebhookRequestDto. The BASELINE
    // (#2929's own framing: connection read + secret resolve + verify +
    // decode, no DB write) - not P1, which additionally writes an
    // auth-rejection row and so is reported alone rather than folded into
    // any delta.
    const rawBody = JSON.stringify({ not: 'an envelope', nonce: i });
    const ts = Date.now();
    const sig = computeOlHmacSignature(SECRET, ts, rawBody);
    return { body: rawBody, headers: { 'X-OpenLinker-Timestamp': String(ts), 'X-OpenLinker-Signature': sig }, eventId };
  }
  // P3 (routable-product, ungated on this connection) / P4 (routable-order,
  // gated on OrderSource, which this connection has).
  const objectType = mode === 'routable-order' ? 'order' : 'product';
  const eventType = mode === 'routable-order' ? 'order.created' : 'product.updated';
  const envelope = { schemaVersion: 1, eventId, eventType, occurredAt: new Date().toISOString(), object: { type: objectType, externalId: eventId }, payload: {} };
  const signed = signWebhook(SECRET, envelope);
  return { body: signed.rawBody, headers: signed.headers, eventId };
}

const modes = ['auth-fail', 'decode-reject', 'routable-product', 'routable-order'];
for (const mode of modes) {
  for (let i = 0; i < N; i++) {
    const req = buildRequest(mode, i);
    const { status, durationMs } = await timedPost(req.body, req.headers);
    console.log(\`\${mode},\${i},\${status},\${durationMs.toFixed(3)},\${req.eventId}\`);
  }
}
NODE
  F3_PROBE_SECRET="$SECRET" F3_PROBE_URL="$OL_API_URL/webhooks/$PROVIDER/$WEBHOOK_CONNECTION_ID" F3_PROBE_TIMING_SAMPLES="$n" \
    node --experimental-strip-types "$tmp"
  rm -f "$tmp"
}

# ---------------------------------------------------------------------------
# probe_timing_report <csv_path>
#
# #2929 - turns run_timed_probes' raw per-sample CSV into the stage-
# breakdown table the AC asks for: per-class n/mean/median/stdev/p95, plus
# the three deltas (P3-P2 = routing + two Redis calls + the delivery INSERT;
# P4-P3 = the sync_jobs INSERT in the same transaction; P1 reported alone)
# with an EXPLICIT noise call on each delta via a percentile bootstrap on
# the difference of medians - printing a number whose confidence interval
# straddles zero as though it were a real cost is exactly what "take enough
# samples that the deltas survive subtraction" (the issue's own words)
# warns against.
# ---------------------------------------------------------------------------
probe_timing_report() {
  local csv="$1"
  python3 - "$csv" <<'PY'
import csv
import random
import statistics
import sys

path = sys.argv[1]
random.seed(20260906)  # deterministic bootstrap - reproducible, not "lucky"

by_mode = {}
with open(path, newline='') as f:
    for row in csv.reader(f):
        if not row:
            continue
        mode, _idx, status, dur, _event_id = row
        by_mode.setdefault(mode, []).append((int(status), float(dur)))


def summarize(samples):
    durs = [d for (_s, d) in samples]
    n = len(durs)
    if n == 0:
        return None
    p95 = statistics.quantiles(durs, n=100)[94] if n >= 20 else max(durs)
    return {
        'n': n,
        'mean': statistics.fmean(durs),
        'median': statistics.median(durs),
        'stdev': statistics.stdev(durs) if n > 1 else 0.0,
        'p95': p95,
    }


def bootstrap_median_diff(a, b, iters=2000, ci=0.90):
    if len(a) < 2 or len(b) < 2:
        return None
    diffs = []
    for _ in range(iters):
        ra = [random.choice(a) for _ in a]
        rb = [random.choice(b) for _ in b]
        diffs.append(statistics.median(ra) - statistics.median(rb))
    diffs.sort()
    lo_idx = int((1 - ci) / 2 * iters)
    hi_idx = int((1 - (1 - ci) / 2) * iters) - 1
    return diffs[lo_idx], diffs[hi_idx]


modes = ['auth-fail', 'decode-reject', 'routable-product', 'routable-order']
label = {
    'auth-fail': 'P1 auth-fail',
    'decode-reject': 'P2 decode-reject',
    'routable-product': 'P3 routable-product',
    'routable-order': 'P4 routable-order',
}
stats = {m: summarize(by_mode.get(m, [])) for m in modes}

print('| probe | n | mean (ms) | median (ms) | stdev (ms) | p95 (ms) |')
print('|---|---:|---:|---:|---:|---:|')
for m in modes:
    s = stats[m]
    if s is None:
        print(f'| {label[m]} | 0 | - | - | - | - |  <!-- no samples captured --> ')
        continue
    print(f"| {label[m]} | {s['n']} | {s['mean']:.3f} | {s['median']:.3f} | {s['stdev']:.3f} | {s['p95']:.3f} |")

print()
print('### Stage deltas')
print()
print('| delta | median delta (ms) | 90% bootstrap CI (ms) | distinguishable from noise? |')
print('|---|---:|---|---|')


def delta_row(name, a_mode, b_mode):
    a = [d for (_s, d) in by_mode.get(a_mode, [])]
    b = [d for (_s, d) in by_mode.get(b_mode, [])]
    if not a or not b:
        print(f'| {name} | - | - | not buildable - missing samples for {a_mode if not a else b_mode} |')
        return
    med_delta = statistics.median(a) - statistics.median(b)
    ci = bootstrap_median_diff(a, b)
    if ci is None:
        print(f'| {name} | {med_delta:.3f} | - | not enough samples for a bootstrap CI (need n>=2 per side) |')
        return
    lo, hi = ci
    distinguishable = not (lo <= 0 <= hi)
    verdict = 'yes' if distinguishable else 'NO - CI straddles zero, not distinguishable from noise'
    print(f'| {name} | {med_delta:.3f} | [{lo:.3f}, {hi:.3f}] | {verdict} |')


delta_row('P3 - P2 (routing + two Redis calls + delivery INSERT)', 'routable-product', 'decode-reject')
delta_row('P4 - P3 (sync_jobs INSERT, same transaction)', 'routable-order', 'routable-product')

s1 = stats.get('auth-fail')
print()
if s1:
    print(f"P1 auth-fail, reported alone (unauthenticated cost, also the attack surface #2842 flags): "
          f"median {s1['median']:.3f} ms, mean {s1['mean']:.3f} ms, n={s1['n']}, stdev {s1['stdev']:.3f} ms")
else:
    print('P1 auth-fail: no samples captured.')
PY
}

# ---------------------------------------------------------------------------
# probe_pgss_corroboration
#
# #2929 - an independent, database-side second view of the P3/P4 stages via
# pg_stat_statements, used to CORROBORATE the differential-probe deltas
# above, never to replace them (the AC's own wording). Reports honestly why
# it could not run when the extension is not preloaded, rather than silently
# printing nothing.
# ---------------------------------------------------------------------------
probe_pgss_corroboration() {
  local preload
  preload="$(pg_sql "SHOW shared_preload_libraries" 2>/dev/null </dev/null || printf '')"
  if ! printf '%s' "$preload" | grep -q 'pg_stat_statements'; then
    printf '`pg_stat_statements` is NOT preloaded on this stand (`shared_preload_libraries`=`%s`) - enabling it needs a `shared_preload_libraries` change plus a Postgres RESTART, which this harness does not perform against a shared stand. Corroboration could not be attempted; the differential-probe deltas above stand on their own.\n' "${preload:-<empty>}"
    return 0
  fi
  local has_ext
  has_ext="$(pg_sql "SELECT COUNT(*) FROM pg_extension WHERE extname='pg_stat_statements'" 2>/dev/null </dev/null || printf 0)"
  if [ "${has_ext:-0}" = "0" ]; then
    printf 'pg_stat_statements is preloaded but has no `CREATE EXTENSION pg_stat_statements` in database `%s` - corroboration could not be attempted.\n' "$PG_DB"
    return 0
  fi
  printf 'pg_stat_statements is preloaded and enabled - top statements touching `webhook_deliveries` or `sync_jobs`, by call count, over the whole time the extension has been collecting on this stand (not reset for this run, so the counts below include activity from other scenarios/arms; corroboration is directional, not an isolated measurement):\n\n'
  printf '```\n'
  pg_sql "SELECT calls, round(mean_exec_time::numeric,3) AS mean_ms, round(total_exec_time::numeric,3) AS total_ms, left(query,140) AS query FROM pg_stat_statements WHERE query ILIKE '%webhook_deliveries%' OR query ILIKE '%sync_jobs%' ORDER BY calls DESC LIMIT 15" 2>&1 </dev/null
  printf '\n```\n'
}

# ---------------------------------------------------------------------------
# §3.5 - Postgres-side sampling alongside #2841's sampler_start/sampler_stop.
# Polls pg_stat_activity for Lock/LWLock waits (tuple-lock evidence for the
# replay-concurrent arm) and the live connection count against
# OL_DB_POOL_MAX (pool-exhaustion evidence). pg_stat_database.deadlocks is a
# single before/after delta, not a per-tick sample - captured by the caller,
# not this loop.
# ---------------------------------------------------------------------------
_F3_PG_SAMPLE_PID=""
f3_pg_sampler_start() {
  local dir="$1" csv="$dir/pg-lockwaits.csv"
  printf 'ts,wait_event_type,wait_event,waiters,active_connections\n' > "$csv"
  (
    while true; do
      local ts waits conns
      ts="$(iso_now)"
      waits="$(pg_sql "SELECT wait_event_type||':'||wait_event||':'||COUNT(*) FROM pg_stat_activity WHERE wait_event_type IN ('Lock','LWLock') GROUP BY wait_event_type, wait_event" 2>/dev/null || true)"
      conns="$(pg_sql "SELECT COUNT(*) FROM pg_stat_activity WHERE datname='$PG_DB'" 2>/dev/null || printf 0)"
      if [ -n "$waits" ]; then
        while IFS='|' read -r wtype wevent wcount; do
          [ -n "$wtype" ] || continue
          printf '%s,%s,%s,%s,%s\n' "$ts" "$wtype" "$wevent" "$wcount" "${conns:-0}" >> "$csv"
        done <<< "$waits"
      else
        printf '%s,,,0,%s\n' "$ts" "${conns:-0}" >> "$csv"
      fi
      sleep 1
    done
  ) &
  _F3_PG_SAMPLE_PID=$!
  echo "$_F3_PG_SAMPLE_PID" > "$dir/.pg-sampler.pid"
}
f3_pg_sampler_stop() {
  local dir="$1" pid
  [ -f "$dir/.pg-sampler.pid" ] || return 0
  pid="$(cat "$dir/.pg-sampler.pid")"
  kill "$pid" >/dev/null 2>&1 || true
  wait "$pid" 2>/dev/null || true
  rm -f "$dir/.pg-sampler.pid"
}
pg_deadlocks_total() {
  pg_sql "SELECT COALESCE(SUM(deadlocks),0) FROM pg_stat_database WHERE datname='$PG_DB'" 2>/dev/null || printf 0
}

# ---------------------------------------------------------------------------
# Reads a k6 --summary-export JSON and echoes "REQS NON2XX" - used to apply
# the 0.5% non-2xx discard rule (plan §4.5 AC). A metric absent from the
# export means it was never incremented (k6 omits an unused custom Counter),
# which is the correct reading of zero, not a parse failure.
# ---------------------------------------------------------------------------
k6_non2xx_ratio() {
  local summary="$1"
  python3 -c "
import json, sys
d = json.load(open('$summary'))
m = d.get('metrics', {})
reqs = m.get('http_reqs', {}).get('count', 0)
non2xx = m.get('non_2xx_responses', {}).get('count', 0)
ratio = (non2xx / reqs) if reqs else 0
print(f'{reqs} {non2xx} {ratio}')
"
}

# ===========================================================================
# --smoke - the driver self-test. Never touches $RESULTS_ROOT.
# ===========================================================================
run_smoke() {
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  # Double-quoted so `$tmp_dir` expands NOW, at trap-registration time, into
  # the trap's command string - not deferred to trap-FIRE time. Deferred
  # expansion looked equivalent and was not: `tmp_dir` is `local` to this
  # function, so by the time the EXIT trap actually runs (after run_smoke
  # has returned), the variable no longer exists and `set -u` turns the
  # reference into a hard "unbound variable" error instead of a clean exit
  # (found live, #2842).
  trap "rm -rf '$tmp_dir'" EXIT

  log "=== --smoke: differential probes ==="
  local probe_out
  probe_out="$(run_differential_probes)"
  printf '%s\n' "$probe_out"
  # Sanity-check the two status codes that must NEVER change under smoke -
  # a smoke run that silently stopped proving the ladder is worse than one
  # that fails loudly.
  local p1_status p2_status
  p1_status="$(printf '%s\n' "$probe_out" | awk '$1=="auth-fail"{print $2}')"
  p2_status="$(printf '%s\n' "$probe_out" | awk '$1=="decode-reject"{print $2}')"
  [ "$p1_status" = "401" ] || die "smoke: P1 auth-fail probe returned $p1_status, expected 401"
  [ "$p2_status" = "400" ] || die "smoke: P2 decode-reject probe returned $p2_status, expected 400"

  log "=== --smoke: pre-signer ==="
  local now_ms pool
  now_ms="$(($(date +%s%N) / 1000000))"
  pool="$tmp_dir/pool.json"
  presign "$pool" unique 40 "$now_ms" 8

  log "=== --smoke: low-rate k6 burst (arm=unique, target rate=$SMOKE_TARGET_RATE/s) ==="
  local summary="$tmp_dir/summary.json"
  run_k6 "$pool" "$now_ms" unique "$SMOKE_TARGET_RATE" "$SMOKE_RAMP_UP_SECS" "$SMOKE_PLATEAU_SECS" "$SMOKE_RAMP_DOWN_SECS" \
    "$SMOKE_PRE_ALLOCATED_VUS" "$SMOKE_MAX_VUS" "$summary"

  local reqs non2xx ratio
  read -r reqs non2xx ratio <<< "$(k6_non2xx_ratio "$summary")"
  log "smoke burst: $reqs request(s), $non2xx non-2xx (ratio=$ratio)"

  log "--smoke complete. Nothing was written under $RESULTS_ROOT."
}

# ===========================================================================
# strict - the full measurement. Never skippable.
# ===========================================================================
run_strict() {
  local CONN_IDS="'$WEBHOOK_CONNECTION_ID'"

  log "=== pre-flight guards ==="
  # First, and unconditionally: claiming the stand is what makes every guard
  # below actually mean what it says. #2842/#2848 (2026-09-06) - a second
  # scenario (F2) shared this stand mid-run, flipped WORKER_RUNNER_ENABLED for
  # its own needs, and two of F3's three arms wrote `"runnerState": "disabled"`
  # into their own manifest for a window the runner was, in fact, executing
  # jobs in. See lib.sh's guard_stand_exclusive docblock for the full account.
  guard_stand_exclusive f3-webhook-burst
  guard_queue_empty "$CONN_IDS"
  guard_scheduler_off
  guard_demo_mode_off
  guard_connection_budget
  guard_pool_recorded
  guard_build
  guard_runner_state disabled
  guard_log_level
  guard_perf_max_attempts

  log "=== probe: one routed event must land job_enqueued, or abort ==="
  local probe_line probe_status probe_event
  probe_line="$(probe_request routable-order)"
  probe_status="$(printf '%s\n' "$probe_line" | awk '{print $2}')"
  probe_event="$(printf '%s\n' "$probe_line" | awk '{print $3}')"
  [ "$probe_status" -ge 200 ] && [ "$probe_status" -lt 300 ] || die "routable-event probe: HTTP $probe_status (expected 2xx)"
  local probe_delivery_status
  probe_delivery_status="$(pg_sql "SELECT status FROM webhook_deliveries WHERE \"eventId\"='$probe_event' AND \"connectionId\"='$WEBHOOK_CONNECTION_ID'")"
  [ "$probe_delivery_status" = "job_enqueued" ] || die "routable-event probe: webhook_deliveries.status='$probe_delivery_status' for eventId=$probe_event, expected job_enqueued - the connection is not routable, or the gate regressed"
  log "routable-event probe ok (eventId=$probe_event, status=job_enqueued)"

  # With guard_runner_state disabled (mandatory above), nothing will EVER pick
  # up a routed event's sync_jobs row - the whole reason the guard requires
  # it (plan §3.6: a burst of N routable webhooks must not become N executing
  # jobs inside the measurement window). That has a consequence lib.sh's
  # drain_wait was not written for: it exists to wait out a RUNNER that is
  # actively draining, and here nothing ever will, so calling it would sit
  # for its full DRAIN_MAX_WAIT_SECS (1800s default) on every single arm
  # transition and then mark everything dead anyway - the same end state,
  # reached the slow way. f3_reset_queue does directly, as one operational
  # action against this scenario's own connection's rows, what drain_wait's
  # timeout branch would eventually do regardless (the enqueue_perf_job
  # maxAttempts-downgrade precedent: acting on our own data is not a
  # product-code change).
  #
  # For the same reason, #2841's reset_between_repeats (cursor + jobdedup:*
  # Redis sweep) is NOT called between arms here: since #2280, a webhook-
  # derived job commits straight into sync_jobs inside the gate transaction
  # and never touches connection_cursors or a jobdedup:* Redis key at all -
  # the durable de-dup gate for THIS path is the webhook_deliveries unique
  # index alone (ADR-005), which reset_between_repeats does not (and must
  # not) touch. Calling it here would be a no-op dressed up as a safety step.
  f3_reset_queue() {
    local conn_ids="$1"
    pg_sql_write "DELETE FROM sync_jobs WHERE \"connectionId\" IN ($conn_ids) AND status IN ('queued','running')" >/dev/null
  }

  local deliveries_at_start
  deliveries_at_start="$(pg_sql "SELECT COUNT(*) FROM webhook_deliveries WHERE \"connectionId\"='$WEBHOOK_CONNECTION_ID'")"

  local run_group probes_dir
  run_group="run$(date +%s)"
  probes_dir="$(results_dir_init f3-webhook-burst "${run_group}-probes")"

  log "=== P1-P4 differential probes ==="
  local probes_out
  probes_out="$(run_differential_probes)"
  printf '%s\n' "$probes_out"
  {
    printf 'mode,http_status,eventId,webhook_deliveries_status\n'
    while read -r mode status eventid; do
      [ -n "$mode" ] || continue
      local dstatus
      # `</dev/null` is load-bearing, not defensive styling: `pg_sql` runs
      # `docker exec -i`, and with no explicit stdin this inherits the loop's
      # own fd0 - the `<<< "$probes_out"` here-string. Without the redirect,
      # the FIRST iteration's `docker exec -i` drains the rest of that
      # here-string trying to forward it to psql, so the outer `while read`
      # sees EOF after one line and every probe past the first silently never
      # reaches this file (found live, #2842: `probes.csv` carried only the
      # `auth-fail` row across every real run so far, P2-P4 rows dropped
      # silently with no error - this is the AC's own "stage breakdown table"
      # deliverable, so a silent 1-of-4 truncation is not a cosmetic gap).
      dstatus="$(pg_sql "SELECT status FROM webhook_deliveries WHERE \"eventId\"='$eventid' AND \"connectionId\"='$WEBHOOK_CONNECTION_ID'" 2>/dev/null </dev/null || printf '')"
      printf '%s,%s,%s,%s\n' "$mode" "$status" "$eventid" "${dstatus:-<none - auth-fail/decode-reject never reach webhook_deliveries>}"
    done <<< "$probes_out"
  } > "$probes_dir/probes.csv"
  log "wrote $probes_dir/probes.csv"

  log "=== P1-P4 TIMED differential probes (#2929, $PROBE_TIMING_SAMPLES samples/class) ==="
  run_timed_probes "$PROBE_TIMING_SAMPLES" > "$probes_dir/probe-timings.csv"
  log "wrote $probes_dir/probe-timings.csv ($(wc -l < "$probes_dir/probe-timings.csv") samples)"
  # The routable-order timed samples each enqueued a real sync_jobs row
  # (runner disabled, so nothing ever drains them) - clear them now so the
  # arms below see the same empty queue guard_queue_empty already expects.
  f3_reset_queue "$CONN_IDS"
  probe_timing_report "$probes_dir/probe-timings.csv" > "$probes_dir/probe-timing-report.md"
  cat "$probes_dir/probe-timing-report.md"
  log "wrote $probes_dir/probe-timing-report.md"

  log "=== pg_stat_statements corroboration (#2929) ==="
  probe_pgss_corroboration > "$probes_dir/pg-stat-statements.md"
  cat "$probes_dir/pg-stat-statements.md"
  log "wrote $probes_dir/pg-stat-statements.md"

  local burst_duration_secs=$((RAMP_UP_SECS + PLATEAU_SECS + RAMP_DOWN_SECS))
  local total_reqs=$((burst_duration_secs * TARGET_RATE))
  # +20% headroom so the `unique` arm's own arrival-rate ramp never wraps
  # back onto an eventId it already sent (plan §3.3 - "unique: fresh id per
  # request" is a claim about every request in the arm, not most of them).
  local unique_pool_count=$((total_reqs + total_reqs / 5 + 10))

  # ===========================================================================
  # #2930 - the fixed-VU-pool concurrent-replay sweep.
  #
  # The three-arm rate sweep's own replay-concurrent arm proved nothing at
  # 43/s (vus_max=1, strictly sequential - the collision this arm exists to
  # force never happened) and only touched genuine concurrency at ~600/s as a
  # SIDE EFFECT of the whole system saturating on CPU/pool/WAL, which swamps
  # whatever index-level signal the arm was meant to isolate. This sweep asks
  # the question directly: hold a FIXED pool of N virtual users, all posting
  # the SAME pre-signed entry, at a rate the system is nowhere near saturated
  # by - so a waiter, a tuple-lock wait, or an elevated gate duration can be
  # attributed to the collision on one eventId and to nothing else.
  # ===========================================================================
  
  # run_concurrent_vus_step <out_var> <vus> <label>
  run_concurrent_vus_step() {
    local out_var="$1" vus="$2" label="$3"
    local dir pool start_ms summary deadlocks_before deadlocks_after extra_manifest
  
    f3_reset_queue "$CONN_IDS"
    guard_queue_empty "$CONN_IDS"
    guard_runner_state disabled
    guard_scheduler_off
  
    dir="$(results_dir_init f3-webhook-burst "$label")"
    pool="$dir/pool.json"
  
    snapshot_jobs_before "$CONN_IDS"
    extra_manifest="$(jq -n --arg arm "replay-concurrent" --argjson vus "$vus" --arg executor "constant-vus" \
      --argjson durationSecs "$CONCURRENT_VUS_DURATION_SECS" \
      '{arm:$arm, executor:$executor, vus:$vus, durationSecs:$durationSecs}')"
    window_start "$dir" f3-webhook-burst "$CONN_IDS" 0 "$extra_manifest"
  
    # Real lead time now, not a SETTLE_SECS-stale one - same rationale as
    # run_one_arm's own start_ms.
    start_ms="$(($(date +%s%N) / 1000000 + 3000))"
    # --distinct-ids 1: every entry this pool holds carries the SAME eventId -
    # the deliberate collision. 200 entries is far more than one short step
    # needs (they are all identical anyway once distinct-ids collapses them),
    # kept only so the pool-building invariants (nGenerations, skew coverage)
    # have something ordinary to compute over.
    presign "$pool" replay-concurrent 200 "$start_ms" "$CONCURRENT_VUS_DURATION_SECS" --distinct-ids 1
  
    deadlocks_before="$(pg_deadlocks_total)"
    f3_pg_sampler_start "$dir"
    summary="$dir/k6-summary.json"
    run_k6_constant_vus "$pool" "$start_ms" replay-concurrent "$vus" "$CONCURRENT_VUS_DURATION_SECS" "$summary"
    f3_pg_sampler_stop "$dir"
    deadlocks_after="$(pg_deadlocks_total)"
  
    window_stop "$dir"
    # executor=constant-vus (the new optional 8th arg, #2930): under this
    # executor vus.max==vus_max.max BY DESIGN (a fixed pool, never grown to
    # chase a rate), so the ordinary ramping-arrival-rate reading of that as
    # "the generator ran out of headroom" would discard every single run here.
    run_post_guards "$dir" "$CONN_IDS" "$(date -u -d "@$WINDOW_START_EPOCH" +%Y-%m-%dT%H:%M:%SZ)" \
      "$WINDOW_START_EPOCH" "$WINDOW_STOP_EPOCH" "" "$dir/k6-summary.json" constant-vus
  
    jq -n --arg before "$deadlocks_before" --arg after "$deadlocks_after" \
      '{deadlocksBefore:($before|tonumber), deadlocksAfter:($after|tonumber), deadlocksDelta:(($after|tonumber)-($before|tonumber))}' \
      > "$dir/pg-deadlocks.json"
  
    f3_reset_queue "$CONN_IDS"
    printf -v "$out_var" '%s' "$dir"
  }
  
  # concurrent_vus_step_row <dir> <vus>
  #
  # Echoes one CSV line: vus,n,p50,p95,p99,maxWaiters,anyWaiters,apiCpuAvg,
  # apiCpuMax,pgCpuAvg,pgCpuMax,events,verdict - joining the k6 gate-duration
  # Trend, the pg-lockwaits.csv tuple-lock evidence and the timeseries.csv CPU
  # evidence for lab-api/lab-postgres into one row this step's sweep table
  # summarizes over.
  concurrent_vus_step_row() {
    local dir="$1" vus="$2" verdict
    verdict="$(verdict_read "$dir" 2>/dev/null | head -1)"
    python3 - "$dir" "$vus" "$OL_API_CONTAINER" "$PG_CONTAINER" "$verdict" <<'PY'
import csv
import json
import sys

dir_path, vus, api_container, pg_container, verdict = sys.argv[1:6]

n = 0
p50 = p95 = p99 = float('nan')
try:
    with open(f'{dir_path}/k6-summary.json') as f:
        summary = json.load(f)
    metrics = summary.get('metrics', {})
    trend = metrics.get('webhook_replay_concurrent_duration_ms', {})
    p50 = trend.get('med', float('nan'))
    p95 = trend.get('p(95)', float('nan'))
    p99 = trend.get('p(99)', float('nan'))
    n = int(metrics.get('http_reqs', {}).get('count', 0))
except (FileNotFoundError, json.JSONDecodeError):
    pass

max_waiters = 0
any_waiters = False
events = set()
try:
    with open(f'{dir_path}/pg-lockwaits.csv') as f:
        for row in csv.DictReader(f):
            raw = row.get('waiters') or '0'
            try:
                w = int(raw)
            except ValueError:
                w = 0
            if w > max_waiters:
                max_waiters = w
            if w > 0:
                any_waiters = True
                ev = (row.get('wait_event') or '').strip()
                if ev:
                    events.add(ev)
except FileNotFoundError:
    pass


def cpu_stats(container):
    vals = []
    try:
        with open(f'{dir_path}/timeseries.csv') as f:
            for row in csv.DictReader(f):
                # lib.sh's sample_queue wraps this field in an outer RFC4180
                # quote pair (fixed alongside this - #2930 review found the
                # unquoted field was silently comma-split by any real CSV
                # reader, truncating it at its own first internal comma), so
                # csv.DictReader has ALREADY un-escaped the doubled quotes by
                # the time this code sees it - re-un-escaping here would
                # corrupt a value that happens to contain a genuine `""`.
                raw = row.get('docker_stats_json') or '[]'
                try:
                    stats = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                for s in stats:
                    if s.get('name') == container:
                        cpu_str = (s.get('cpu') or '0%').rstrip('%')
                        try:
                            vals.append(float(cpu_str))
                        except ValueError:
                            pass
    except FileNotFoundError:
        pass
    if not vals:
        return (float('nan'), float('nan'))
    return (sum(vals) / len(vals), max(vals))


api_avg, api_max = cpu_stats(api_container)
pg_avg, pg_max = cpu_stats(pg_container)

events_str = '|'.join(sorted(events)) if events else '-'
print(f"{vus},{n},{p50:.1f},{p95:.1f},{p99:.1f},{max_waiters},{any_waiters},"
      f"{api_avg:.1f},{api_max:.1f},{pg_avg:.1f},{pg_max:.1f},{events_str},{verdict}")
PY
  }
  
  # run_concurrent_vus_sweep <run_group>
  #
  # Sweeps CONCURRENT_VUS_STEPS, writes a combined CSV to
  # $LIB_DIR-relative results dir, and returns (via echo) the CSV path.
  run_concurrent_vus_sweep() {
    local run_group="$1"
    local out_dir out_csv vus step_dir
    out_dir="$(results_dir_init f3-webhook-burst "${run_group}-concurrent-vus-sweep")"
    out_csv="$out_dir/sweep.csv"
    printf 'vus,n,p50,p95,p99,maxWaiters,anyWaiters,apiCpuAvgPct,apiCpuMaxPct,pgCpuAvgPct,pgCpuMaxPct,waitEvents,verdict\n' > "$out_csv"
    for vus in $CONCURRENT_VUS_STEPS; do
      log "=== concurrent-vus sweep: vus=$vus ==="
      run_concurrent_vus_step step_dir "$vus" "${run_group}-concurrent-vus-$vus"
      concurrent_vus_step_row "$step_dir" "$vus" >> "$out_csv"
      log "concurrent-vus sweep: vus=$vus done ($step_dir)"
    done
    printf '%s' "$out_csv"
  }
  
  # -------------------------------------------------------------------------
  # run_one_arm <out_var> <arm> <results_dir_label> <pool_count> [extra presign args...]
  #
  # Returns the results dir by ASSIGNING it to the variable named by
  # $out_var (printf -v), never by echoing it for a caller to capture via
  # $(...) - the bootstrap.sh ol_ensure_connection precedent. This function
  # calls guard_queue_empty, window_start, window_stop, verdict_write and
  # others that all `log` to stdout (lib.sh's log() has no >&2), so a
  # command-substitution caller would capture the whole transcript instead
  # of the directory path - found live, #2842 (the F3 run that shipped
  # this fix): $unique_dir came back polluted with every log line this
  # function's callees emitted, and a later inline `python3 -c` reading
  # "$unique_dir/pool.json" choked on the garbage path.
  #
  # window_start is called BEFORE the pool is built, deliberately: it is what
  # inserts #2841's SETTLE_SECS (default 60s) sleep between the last guard
  # and the window actually opening, and the pre-signed pool's generation-0
  # timestamp must be anchored to the moment k6 ACTUALLY starts sending
  # traffic - not to a moment 60+ seconds before it, which would already be
  # stale by the time the burst begins. So the run's own RUN_START_MS is
  # chosen, and the pool built against it, only after that sleep is over.
  # -------------------------------------------------------------------------
  run_one_arm() {
    local out_var="$1" arm="$2" label="$3" pool_count="$4"; shift 4
    local dir pool start_ms summary deadlocks_before deadlocks_after extra_manifest

    f3_reset_queue "$CONN_IDS"
    guard_queue_empty "$CONN_IDS"
    # Re-assert per arm, not just once in run_strict's pre-flight block -
    # #2842/#2848 (2026-09-06): a peer scenario sharing this stand (or an
    # operator, or a plain `docker compose up --force-recreate` silently
    # resolving a different default - confirmed to happen independently of
    # any peer scenario) can falsify either of these between arms, and
    # `manifest_write` re-renders MANIFEST_RUNNER_STATE from whatever the
    # pre-flight check found, script-wide, every time it is called. Mirrors
    # guard_queue_empty's own existing per-arm re-check immediately above.
    # This catches a flip BETWEEN arms; it does not poll continuously during
    # an arm's own settle-plus-load window, which stays a residual gap on the
    # same footing `post_guard_attempts` already covers after the fact.
    guard_runner_state disabled
    guard_scheduler_off

    dir="$(results_dir_init f3-webhook-burst "$label")"
    pool="$dir/pool.json"

    snapshot_jobs_before "$CONN_IDS"
    extra_manifest="$(jq -n --argjson n "$deliveries_at_start" --arg arm "$arm" --argjson rate "$TARGET_RATE" \
      '{webhookDeliveriesRowsAtStart:$n, arm:$arm, arrivalRatePerSec:$rate}')"
    window_start "$dir" f3-webhook-burst "$CONN_IDS" 0 "$extra_manifest"

    # Real lead time now, not a 60s-stale one: window_start's settle sleep is
    # already behind us.
    start_ms="$(($(date +%s%N) / 1000000 + 3000))"
    presign "$pool" "$arm" "$pool_count" "$start_ms" "$burst_duration_secs" "$@"

    deadlocks_before="$(pg_deadlocks_total)"
    f3_pg_sampler_start "$dir"
    summary="$dir/k6-summary.json"
    run_k6 "$pool" "$start_ms" "$arm" "$TARGET_RATE" "$RAMP_UP_SECS" "$PLATEAU_SECS" "$RAMP_DOWN_SECS" \
      "$PRE_ALLOCATED_VUS" "$MAX_VUS" "$summary"
    f3_pg_sampler_stop "$dir"
    deadlocks_after="$(pg_deadlocks_total)"

    window_stop "$dir"
    # The k6 summary is passed so post_guard_generator_saturated can run.
    # Omitting it would silently skip the generator check on the one scenario
    # whose headline was nearly published as a system ceiling while k6 sat at
    # 96% of its own VU limit (#2933).
    run_post_guards "$dir" "$CONN_IDS" "$(date -u -d "@$WINDOW_START_EPOCH" +%Y-%m-%dT%H:%M:%SZ)" \
      "$WINDOW_START_EPOCH" "$WINDOW_STOP_EPOCH" "" "$dir/k6-summary.json"

    jq -n --arg before "$deadlocks_before" --arg after "$deadlocks_after" \
      '{deadlocksBefore:($before|tonumber), deadlocksAfter:($after|tonumber), deadlocksDelta:(($after|tonumber)-($before|tonumber))}' \
      > "$dir/pg-deadlocks.json"

    local reqs non2xx ratio
    read -r reqs non2xx ratio <<< "$(k6_non2xx_ratio "$summary")"
    if awk -v r="$ratio" -v t="$NON_2XX_DISCARD_RATIO" 'BEGIN{exit !(r>t)}'; then
      # An array, never a plain string handed to verdict_write unquoted - a
      # reason string legitimately contains spaces (every post_guard_*
      # message does), and word-splitting it would silently shred one reason
      # into several bogus `reason=` lines.
      local -a prior_reasons_arr=()
      while IFS= read -r line; do
        [ -n "$line" ] && prior_reasons_arr+=("$line")
      done < <(verdict_read "$dir" | tail -n +2)
      verdict_write "$dir" DISCARDED "non-2xx ratio $ratio exceeds $NON_2XX_DISCARD_RATIO ($non2xx/$reqs)" "${prior_reasons_arr[@]}"
    fi

    # This arm is done being measured - clear its rows so the NEXT arm's
    # guard_queue_empty (which f3_reset_queue+guard_queue_empty at the top of
    # run_one_arm already enforces) has something true to check.
    f3_reset_queue "$CONN_IDS"

    printf -v "$out_var" '%s' "$dir"
  }

  local unique_dir
  run_one_arm unique_dir unique "${run_group}-unique" "$unique_pool_count"

  # Ids this arm actually committed - "already committed by unique" (§3.3) -
  # read straight back off ITS OWN pool rather than re-derived, so the set
  # the replay-committed arm reuses is exactly what was sent, not what was
  # merely intended.
  python3 -c "
import json
pool = json.load(open('$unique_dir/pool.json'))
# #2931 flattened the pool into generationIndex + a flat entries array (no
# more nested generations[].entries[]) - found live while wiring #2929/#2930,
# since this line still read the pre-#2931 shape and would KeyError the
# instant the unique arm finished, aborting run_strict before the
# replay-committed arm ever ran.
ids = [e['eventId'] for e in pool['entries']]
open('$unique_dir/committed-ids.json', 'w').write(json.dumps({'eventIds': ids}))
"

  local rc_dir
  run_one_arm rc_dir replay-committed "${run_group}-replay-committed" "$total_reqs" \
    --reuse-ids-file "$unique_dir/committed-ids.json"

  local cc_dir
  run_one_arm cc_dir replay-concurrent "${run_group}-replay-concurrent" "$total_reqs" \
    --distinct-ids "$REPLAY_CONCURRENT_DISTINCT_IDS"

  log "=== concurrent-vus lock-contention sweep (#2930) - VUS in {$CONCURRENT_VUS_STEPS} ==="
  local concurrent_vus_csv
  concurrent_vus_csv="$(run_concurrent_vus_sweep "$run_group")"
  log "wrote $concurrent_vus_csv"

  write_dated_report "$run_group" "$probes_dir" "$unique_dir" "$rc_dir" "$cc_dir" "$concurrent_vus_csv"
}

# ---------------------------------------------------------------------------
# write_dated_report <run_group> <probes_dir> <unique_dir> <replay_committed_dir> <replay_concurrent_dir> [concurrent_vus_csv]
# Results contract §4.6: percentiles labelled with their within-run n, both
# replay arms reported separately, and a "what this did not establish"
# section (plan §6 - this stand cannot pass guard_build/guard_runner_state,
# so if this function is ever reached it is on a stand where it could).
#
# concurrent_vus_csv (#2930, optional) is the fixed-VU-pool sweep's own
# combined CSV (run_concurrent_vus_sweep's return value) - rendered as its
# own section, separate from the three-arm table above, because the two use
# DIFFERENT executors (ramping-arrival-rate vs constant-vus) and comparing a
# figure from one against a figure from the other without saying so invites
# exactly the false conclusion the issue warns about.
# ---------------------------------------------------------------------------
write_dated_report() {
  local run_group="$1" probes_dir="$2" unique_dir="$3" rc_dir="$4" cc_dir="$5" concurrent_vus_csv="${6:-}"
  # The package ROOT, never $RESULTS_ROOT: `perf/openlinker-throughput/results/`
  # is wholesale .gitignore'd (line 100), so a written report would never be
  # committed - found live, #2842/#2848 (2026-09-06), after the first interim
  # report was hand-authored straight into the ignored directory. The
  # per-prestashop-baseline precedent is exactly this split: raw per-run
  # artifacts stay in an ignored directory, the written report sits at the
  # package root (`perf/prestashop-baseline/results-A-2026-08-27.md` and
  # siblings). $LIB_DIR is lib.sh's own package-root variable.
  local report="$LIB_DIR/results-F3-$(date -u +%Y-%m-%d).md"
  {
    printf '# F3 - webhook ingress burst throughput\n\n'
    printf '_generated %s, run group %s_\n\n' "$(iso_now)" "$run_group"
    printf '## Differential probes (P1-P4)\n\n'
    printf '```\n'
    cat "$probes_dir/probes.csv"
    printf '```\n\n'
    if [ -f "$probes_dir/probe-timing-report.md" ]; then
      printf '### Timed differential probes (#2929)\n\n'
      cat "$probes_dir/probe-timing-report.md"
      printf '\n'
    fi
    if [ -f "$probes_dir/pg-stat-statements.md" ]; then
      printf '### pg_stat_statements corroboration (#2929)\n\n'
      cat "$probes_dir/pg-stat-statements.md"
      printf '\n'
    fi
    printf '## Arms\n\n'
    local d
    for d in "$unique_dir:unique" "$rc_dir:replay-committed" "$cc_dir:replay-concurrent"; do
      local dir="${d%%:*}" arm="${d##*:}"
      printf '### %s\n\n' "$arm"
      # `--` is load-bearing on every one of these three, not stylistic: bash's
      # printf builtin parses a leading "-" on its FORMAT argument as the
      # start of an option (it accepts `-v var`), so a format string starting
      # "- " throws `printf: - : invalid option` and aborts the whole
      # function - found live, #2842: this is exactly why the two static
      # "What this did not establish" lines below already carry `--`, and why
      # this loop's three DYNAMIC lines, missing it, took down report
      # generation on every real run so far (the partial
      # `results-F3-2026-09-05.md` this bug produced stops mid-way through
      # the very first `### unique` section, right where this line used to
      # sit unguarded).
      printf -- '- verdict: `%s`\n' "$(verdict_read "$dir" | head -1)"
      if [ -f "$dir/k6-summary.json" ]; then
        read -r reqs non2xx ratio <<< "$(k6_non2xx_ratio "$dir/k6-summary.json")"
        printf -- '- requests (measured, n=%s): %s total, %s non-2xx (ratio %s)\n' "$reqs" "$reqs" "$non2xx" "$ratio"
      fi
      if [ -f "$dir/pg-deadlocks.json" ]; then
        printf -- '- deadlocks delta (measured): %s\n' "$(jq -r '.deadlocksDelta' "$dir/pg-deadlocks.json")"
      fi
      printf '\n'
    done
    if [ -n "$concurrent_vus_csv" ] && [ -f "$concurrent_vus_csv" ]; then
      printf '## Concurrent-replay lock-contention sweep - fixed VU pool (#2930)\n\n'
      printf -- '- executor: `constant-vus` (never `ramping-arrival-rate`) - all VUs in every step post the SAME pre-signed entry (`--distinct-ids 1`), so any waiter/lock-wait/gate-duration signal below is attributable to the collision on one eventId alone, not to the system falling behind an arrival rate.\n'
      printf -- '- this is a SEPARATE measurement from the `replay-concurrent` arm in the table above (which uses `ramping-arrival-rate`) - the two executors answer different questions and their figures must never be compared directly.\n\n'
      printf '```\n'
      cat "$concurrent_vus_csv"
      printf '```\n\n'
    fi
    printf '## What this did not establish\n\n'
    printf -- '- No cross-run repeat/agreement check (#2845 owns that policy).\n'
  } > "$report"
  log "wrote $report"
}

case "$MODE" in
  smoke) run_smoke ;;
  strict) run_strict ;;
esac
