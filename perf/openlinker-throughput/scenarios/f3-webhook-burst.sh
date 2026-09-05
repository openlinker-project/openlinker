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
      dstatus="$(pg_sql "SELECT status FROM webhook_deliveries WHERE \"eventId\"='$eventid' AND \"connectionId\"='$WEBHOOK_CONNECTION_ID'" 2>/dev/null || printf '')"
      printf '%s,%s,%s,%s\n' "$mode" "$status" "$eventid" "${dstatus:-<none - auth-fail/decode-reject never reach webhook_deliveries>}"
    done <<< "$probes_out"
  } > "$probes_dir/probes.csv"
  log "wrote $probes_dir/probes.csv"

  local burst_duration_secs=$((RAMP_UP_SECS + PLATEAU_SECS + RAMP_DOWN_SECS))
  local total_reqs=$((burst_duration_secs * TARGET_RATE))
  # +20% headroom so the `unique` arm's own arrival-rate ramp never wraps
  # back onto an eventId it already sent (plan §3.3 - "unique: fresh id per
  # request" is a claim about every request in the arm, not most of them).
  local unique_pool_count=$((total_reqs + total_reqs / 5 + 10))

  # -------------------------------------------------------------------------
  # run_one_arm <arm> <results_dir_label> <pool_count> [extra presign args...]
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
    local arm="$1" label="$2" pool_count="$3"; shift 3
    local dir pool start_ms summary deadlocks_before deadlocks_after extra_manifest

    f3_reset_queue "$CONN_IDS"
    guard_queue_empty "$CONN_IDS"

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
    run_post_guards "$dir" "$CONN_IDS" "$(date -u -d "@$WINDOW_START_EPOCH" +%Y-%m-%dT%H:%M:%SZ)" \
      "$WINDOW_START_EPOCH" "$WINDOW_STOP_EPOCH" ""

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

    printf '%s' "$dir"
  }

  local unique_dir
  unique_dir="$(run_one_arm unique "${run_group}-unique" "$unique_pool_count")"

  # Ids this arm actually committed - "already committed by unique" (§3.3) -
  # read straight back off ITS OWN pool rather than re-derived, so the set
  # the replay-committed arm reuses is exactly what was sent, not what was
  # merely intended.
  python3 -c "
import json
pool = json.load(open('$unique_dir/pool.json'))
ids = [e['eventId'] for gen in pool['generations'] for e in gen['entries']]
open('$unique_dir/committed-ids.json', 'w').write(json.dumps({'eventIds': ids}))
"

  local rc_dir
  rc_dir="$(run_one_arm replay-committed "${run_group}-replay-committed" "$total_reqs" \
    --reuse-ids-file "$unique_dir/committed-ids.json")"

  local cc_dir
  cc_dir="$(run_one_arm replay-concurrent "${run_group}-replay-concurrent" "$total_reqs" \
    --distinct-ids "$REPLAY_CONCURRENT_DISTINCT_IDS")"

  write_dated_report "$run_group" "$probes_dir" "$unique_dir" "$rc_dir" "$cc_dir"
}

# ---------------------------------------------------------------------------
# write_dated_report <run_group> <probes_dir> <unique_dir> <replay_committed_dir> <replay_concurrent_dir>
# Results contract §4.6: percentiles labelled with their within-run n, both
# replay arms reported separately, and a "what this did not establish"
# section (plan §6 - this stand cannot pass guard_build/guard_runner_state,
# so if this function is ever reached it is on a stand where it could).
# ---------------------------------------------------------------------------
write_dated_report() {
  local run_group="$1" probes_dir="$2" unique_dir="$3" rc_dir="$4" cc_dir="$5"
  local report="$RESULTS_ROOT/results-F3-$(date -u +%Y-%m-%d).md"
  {
    printf '# F3 - webhook ingress burst throughput\n\n'
    printf '_generated %s, run group %s_\n\n' "$(iso_now)" "$run_group"
    printf '## Differential probes (P1-P4)\n\n'
    printf '```\n'
    cat "$probes_dir/probes.csv"
    printf '```\n\n'
    printf '## Arms\n\n'
    local d
    for d in "$unique_dir:unique" "$rc_dir:replay-committed" "$cc_dir:replay-concurrent"; do
      local dir="${d%%:*}" arm="${d##*:}"
      printf '### %s\n\n' "$arm"
      printf '- verdict: `%s`\n' "$(verdict_read "$dir" | head -1)"
      if [ -f "$dir/k6-summary.json" ]; then
        read -r reqs non2xx ratio <<< "$(k6_non2xx_ratio "$dir/k6-summary.json")"
        printf '- requests (measured, n=%s): %s total, %s non-2xx (ratio %s)\n' "$reqs" "$reqs" "$non2xx" "$ratio"
      fi
      if [ -f "$dir/pg-deadlocks.json" ]; then
        printf '- deadlocks delta (measured): %s\n' "$(jq -r '.deadlocksDelta' "$dir/pg-deadlocks.json")"
      fi
      printf '\n'
    done
    printf '## What this did not establish\n\n'
    printf -- '- No pg_stat_statements per-statement breakdown unless the stand preloads it (see manifest.json `environment.postgres.shared_preload_libraries`).\n'
    printf -- '- No cross-run repeat/agreement check (#2845 owns that policy).\n'
  } > "$report"
  log "wrote $report"
}

case "$MODE" in
  smoke) run_smoke ;;
  strict) run_strict ;;
esac
