#!/usr/bin/env bash
#
# limiter-ab - a controlled A/B of the outbound rate limiter (epic #2840).
#
# WHAT THIS EXISTS TO SETTLE
#
# F1 (results-F1-2026-09-07.md) measured 182 orders/h at the shipped defaults
# and 262-295 orders/h with the destination limit lifted - but that arm raised
# `requestsPerMinute` 60 -> 6000 AND `maxConcurrent` 4 -> 32 in one step, so it
# cannot say which of the two mattered. This scenario changes ONE variable per
# arm, so it can.
#
# The mechanism is already settled FROM CODE and is not re-derived here:
#
#   `libs/shared/src/rate-limit/rate-limiter.ts:198`
#     nextAvailableAt = Math.max(nextAvailableAt, nowMs) + 60_000 / requestsPerMinute
#
# One timestamp, no budget counter - idle time earns no credit. The Redis
# adapter CAS's the same arithmetic into `PACE_ADMIT_SCRIPT`
# (`redis-rate-limiter.adapter.ts:195-214`, called at :667). The pace gate and
# the concurrency gate are AND-ed on ONE bucket per connection
# (`rate-limiter.ts:168-199`), and the pace gate limits ADMISSION, not
# completion - so requests may overlap in flight but can only START one
# interval apart. `maxConcurrent` therefore cannot rescue the spacing.
#
# PrestaShop declares `{requestsPerMinute: 60, maxConcurrent: 4}`
# (`prestashop-plugin.ts:84`), wired through `host.http.forConnection` for every
# capability adapter. At the ~16 destination requests per order F1 measured,
# 60 admissions/min is a derived ceiling of ~3.75 orders/min = ~225 orders/h.
#
# ---------------------------------------------------------------------------
# ARM C IS THE FALSIFIER, AND ITS NULL RESULT IS OVER-DETERMINED
# ---------------------------------------------------------------------------
# Arm C raises `maxConcurrent` ALONE. If the spacing story is right the number
# barely moves, because the pace gate still admits 60/min. If it moves
# substantially the mechanism story is WRONG, and that is the finding - to be
# reported as such rather than explained away.
#
# But a null result on arm C has TWO available explanations and this scenario
# says so rather than claiming the stronger one:
#
#   (a) the pace gate binds regardless of concurrency  - the hypothesis, or
#   (b) `maxConcurrent: 4` was never the binding constraint in the first place,
#       because `OL_LANE_REALTIME_SCOPE_CAP` defaults to 2 (`sync-job.runner.ts`)
#       so at most ~2 order-sync jobs run concurrently per connection, and each
#       makes its destination calls sequentially. Two concurrent outbound
#       requests never reach a ceiling of four.
#
# The two are told apart by OBSERVATION, not assertion: every arm reports the
# maximum concurrently-`running` job count it saw. If that maximum is 2 at
# baseline, (b) holds and arm C's null is consistent-with but not evidence-for
# the hypothesis - and the arm that WOULD be decisive is the optional arm E
# below, which makes concurrency genuinely reachable by raising the lane cap
# alongside it. Note the occupancy figure is an UPPER BOUND: `sync_jobs.status`
# over-reads, because a handler that finished before its terminal write
# committed still reads `running`.
#
# ---------------------------------------------------------------------------
# ARM D IS A DIFFERENT QUESTION AND THE MORE ACTIONABLE ONE
# ---------------------------------------------------------------------------
# Every F1 window was DISCARDED on `post_guard_limiter_degraded` - 34-52
# "falling back to per-process in-memory limiting" lines per 300 s window,
# against a Redis whose server latency, slowlog, memory and key shapes were all
# measured and all clean. F1 localised the timeout to the worker and stopped.
#
# The candidate cause is in the wiring: `JobIntakeConsumer` blocks on
# `xReadGroup` with `BLOCK: 5000` in a loop (`job-intake.consumer.ts`) on the
# worker's shared `'REDIS_CLIENT'`, and `RateLimitModule` builds the limiter's
# registry on that SAME client (`libs/plugin-sdk/src/rate-limit.module.ts:70`,
# `inject: ['REDIS_CLIENT']`). Redis serves no further commands from a
# connection parked in a blocking read, so a pace `EVAL` queued behind an
# in-flight block waits out the residual - up to 5 s, against a 1000 ms
# timeout. `apps/worker/src/events/events-consumer.module.ts:23-26` already
# carries a comment describing exactly this hazard and gives its own consumer a
# dedicated client; the limiter never got that fix.
#
# Arm D flips `OL_JOB_INTAKE_DEDICATED_REDIS=true` - the seam added in the
# commit that introduced this scenario - and measures whether the degradation
# rate falls. It runs on the SAME IMAGE as every other arm, because the flag
# defaults to the shipped behaviour; putting an image difference inside an A/B
# comparison would add a confound this scenario exists to remove.
#
# ---------------------------------------------------------------------------
# WHY ARMS A/B/C NEED NO WORKER RECREATE
# ---------------------------------------------------------------------------
# `HttpTransportFactory` resolves the policy FRESH on every outbound call
# (`libs/shared/src/http/http-transport-factory.ts:148` -
# `connectionRef.current.config?.rateLimit ?? connectionRef.defaultRateLimit ??
# {}`) and passes it into `limiter.acquire(policy, ...)` per call, and the
# factory's own header states the invariant in those words. So a
# `config.rateLimit` PATCH takes effect on the next call with no restart. Arms
# A/B/C therefore share ONE worker process, which removes a process-restart
# confound between them; only arms D and E (which change worker ENV) recreate.
#
# ---------------------------------------------------------------------------
# ARM A WRITES AN EXPLICIT 60/4 RATHER THAN DELETING THE KEY
# ---------------------------------------------------------------------------
# F1's `set_rate_limit default` deletes `config.rateLimit`, on the sound
# grounds that an explicit value equalling the manifest default is a different
# PERSISTED state. It is not a different EFFECTIVE state: the resolution above
# is `?? defaultRateLimit`, and PrestaShop's manifest value is exactly
# `{requestsPerMinute: 60, maxConcurrent: 4}` - so both paths hand the same
# object to the same function. That is a code fact, not a hypothesis, and there
# is no behavioural difference left to measure.
#
# Writing it explicitly is what makes the experiment one-variable: A -> B then
# differs only in `requestsPerMinute` and A -> C only in `maxConcurrent`.
# Leaving A absent would put "absent versus explicit" inside every comparison.
# The persisted state of every arm is READ BACK and recorded in its manifest,
# never taken from what was requested.
#
# ---------------------------------------------------------------------------
# REPEATS ARE INTERLEAVED, NOT BLOCKED
# ---------------------------------------------------------------------------
# n >= 2 per arm, and the repeats run A B C / A B C rather than A A / B B / C C.
# This stand is a compose project on a contended developer workstation, so a
# slow period is a real hazard; interleaving spreads it across every arm
# instead of landing it entirely on one. Arms D and E cannot interleave with
# them - each needs a worker recreate, and alternating would reset the
# `line_prices` and currency/country caches between every window - so they run
# as consecutive blocks and a final drift-control repeat of arm A is run
# afterwards to show whether the stand moved underneath them.
#
# Sources lib.sh (#2841), drivers/order-feed.sh and scenarios/f1-order-ingestion.sh
# (#2847), whose `arm_throughput` body this follows deliberately closely.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LIB_LOG_PREFIX="ab"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../drivers/order-feed.sh"

# ---------------------------------------------------------------------------
# THE STAND'S COMPOSE PROJECT IS DISCOVERED, NEVER ASSUMED TO BE THIS CHECKOUT
# ---------------------------------------------------------------------------
# A scenario can legitimately be run from a different working tree than the one
# the stand was brought up from - this one was. Compose must then be invoked
# from the STAND's directory, not this checkout's, for two reasons that both
# fail silently:
#
#   - the worker service carries a RELATIVE bind mount
#     (`./perf/openlinker-throughput/stand/wc-tls/certs/ca.pem`) which is a
#     generated, untracked artefact. From a checkout that never ran
#     `bootstrap.sh` the path does not exist and compose creates a DIRECTORY
#     there, so `NODE_EXTRA_CA_CERTS` points at a directory and every outbound
#     TLS call to the local WooCommerce fails.
#   - `.env.lab` is untracked too, and it carries the ports, passwords and the
#     credentials encryption key. A different tree's copy - or its absence -
#     recreates the worker against the wrong database.
#
# So it is read out of the running container's own compose labels, which is the
# only authority on where the stand came from. `STAND_DIR` overrides it.
resolve_stand_dir() {
  local first wd
  first="$(discover_worker_containers 2>/dev/null | awk '{print $1}')"
  [ -n "$first" ] || return 1
  wd="$(docker inspect "$first" \
    --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>/dev/null || printf '')"
  [ -n "$wd" ] || return 1
  printf '%s' "$wd"
}

STAND_DIR="${STAND_DIR:-}"
if [ -z "$STAND_DIR" ]; then
  STAND_DIR="$(resolve_stand_dir || printf '')"
  [ -n "$STAND_DIR" ] || die "could not resolve the stand's compose working_dir from the running worker's labels - export STAND_DIR by hand"
fi
[ -d "$STAND_DIR" ] || die "STAND_DIR=$STAND_DIR is not a directory"
COMPOSE_FILE="${COMPOSE_FILE:-$STAND_DIR/docker-compose.lab.yml}"
ENV_FILE="${ENV_FILE:-$STAND_DIR/.env.lab}"
[ -f "$COMPOSE_FILE" ] || die "COMPOSE_FILE=$COMPOSE_FILE not found"
[ -f "$ENV_FILE" ] || die "ENV_FILE=$ENV_FILE not found - this scenario recreates the worker service, which needs the stand's own env file"

# ---------------------------------------------------------------------------
# Configuration (env-overridable, same convention as lib.sh/bootstrap.sh)
# ---------------------------------------------------------------------------
SOURCE_TENANT="${SOURCE_TENANT:-perf-allegro-a}"

# 300 s matches F1's window exactly, so this scenario's baseline is directly
# comparable to the 182 orders/h it reported rather than only to itself.
WINDOW_SECS="${WINDOW_SECS:-300}"
# Must outlast the window at the highest rate any arm might reach, or
# post_guard_feed_starved discards the run - which is the guard working. F1's
# fastest arm reached 295 orders/h, so 900 is ~3.7x the deepest a window can
# consume even if an arm doubled that.
BACKLOG="${BACKLOG:-900}"
POLL_CADENCE_SECS="${POLL_CADENCE_SECS:-10}"
PROGRESS_TICK_SECS="${PROGRESS_TICK_SECS:-5}"
REPEATS="${REPEATS:-2}"

# Two per replica, not one: the first excludes the `line_prices` cold start (27
# requests versus 7 for the first order after any worker restart,
# `prestashop-openlinker-module.client.ts`) and the second keeps the FIRST
# measured order from carrying the tail of the currency/country/order-state
# cache fills.
WARMUP_ORDERS_PER_REPLICA="${WARMUP_ORDERS_PER_REPLICA:-2}"

# How much of a rate change counts as "the number moved". Two runs of one arm
# on a contended workstation do not repeat exactly; F1 measured a 12.6% spread
# between two windows of the SAME configuration, so the threshold has to sit
# above that and well below the several-fold change a genuinely-binding limiter
# would produce.
MOVED_THRESHOLD_PCT="${MOVED_THRESHOLD_PCT:-15}"

# ---------------------------------------------------------------------------
# The arm table. `name:rpm:maxConcurrent:laneScopeCap:laneCap:dedicatedRedis`
#
# Empty lane caps mean the RUNNER's own defaults - never a number this script
# invents, because the runner is the authority on its defaults and asserting a
# literal is how F1 produced a manifest that contradicted itself.
#
# Arms are DATA rather than code so a fifth one is a config line, not an edit.
# ---------------------------------------------------------------------------
ARM_SPECS="${ARM_SPECS:-A:60:4:::false B:600:4:::false C:60:32:::false}"
# Arms needing a worker recreate, run as consecutive blocks after the
# interleaved set above. Arm E is the decisive concurrency falsifier (see the
# header) and is off by default because it costs two more windows.
RECREATE_ARM_SPECS="${RECREATE_ARM_SPECS:-D:60:4:::true}"
# One extra repeat of the first interleaved arm, run last, purely to show
# whether the stand drifted under the consecutive blocks.
DRIFT_CONTROL="${DRIFT_CONTROL:-A:60:4:::false}"

MODE="strict"
for arg in "$@"; do
  case "$arg" in
    --smoke) MODE="smoke" ;;
    -h|--help)
      cat <<'USAGE'
Usage: limiter-ab.sh [--smoke]

  (no flag)  strict measurement - every applicable #2841 guard, the interleaved
             ARM_SPECS repeated REPEATS times, then each RECREATE_ARM_SPECS arm
             repeated REPEATS times, then one DRIFT_CONTROL repeat. A CSV per
             arm-run under results/ and a cross-arm summary at the family root.
  --smoke    rig self-test: resolves the stand, reads the connection's live
             rate limit, proves post_guard_limiter_degraded can SEE a degraded
             line, and exits. Opens no window and writes nothing under results/.

Every knob is an env var - see the Configuration block at the top of this file.
USAGE
      exit 0
      ;;
    *) die "unknown argument: $arg (use --smoke, --help, or nothing)" ;;
  esac
done

require_tools docker jq curl python3

[ -n "${ALLEGRO_A_CONNECTION_ID:-}" ] || die "ALLEGRO_A_CONNECTION_ID is not set - source stand-ids.env (bootstrap.sh) or export it by hand"
[ -n "${PS_CONNECTION_ID:-}" ] || die "PS_CONNECTION_ID is not set - source stand-ids.env"
[ -n "${WC_CONNECTION_ID:-}" ] || die "WC_CONNECTION_ID is not set - source stand-ids.env"
SOURCE_CONNECTION_ID="${SOURCE_CONNECTION_ID:-$ALLEGRO_A_CONNECTION_ID}"
CONN_IDS="'$SOURCE_CONNECTION_ID'"

# Claimed BEFORE any arrange step, not merely before the first window: this
# scenario mutates shared stand state (both destinations' capabilities, the
# PrestaShop connection's rate limit, the worker's own env) well before a
# window opens, and a peer racing any of it is the failure the lock exists to
# prevent (#2842/#2848).
guard_stand_exclusive "limiter-ab"

ol_login

# ===========================================================================
# Posture captured for restore, and the ONE exit trap
#
# bash's EXIT trap is a single slot, so a second `trap ... EXIT` REPLACES
# guard_stand_exclusive's own release and would leave the stand locked for the
# whole TTL after any `die`. F7 found that the hard way and F4 records the fix.
# Everything undone is undone from this one function.
# ===========================================================================
ORIGINAL_REPLICAS="$(discover_worker_containers | wc -w | tr -d ' ')"
[ "$ORIGINAL_REPLICAS" -ge 1 ] || ORIGINAL_REPLICAS=1
# Read from the RUNNING container, not from .env.lab: the file is a request and
# the container's environment is what is in force, and a peer may have changed
# one without the other.
FIRST_WORKER="$(discover_worker_containers | awk '{print $1}')"
ORIGINAL_RUNNER_ENABLED="$(docker exec "$FIRST_WORKER" printenv WORKER_RUNNER_ENABLED 2>/dev/null || printf '')"
[ -n "$ORIGINAL_RUNNER_ENABLED" ] || ORIGINAL_RUNNER_ENABLED=false

connection_json() { ol_api GET "/v1/connections/$1"; }

ORIGINAL_PS_CAPS="$(connection_json "$PS_CONNECTION_ID" | jq -c '.enabledCapabilities // []')"
ORIGINAL_WC_CAPS="$(connection_json "$WC_CONNECTION_ID" | jq -c '.enabledCapabilities // []')"
ORIGINAL_PS_CONFIG="$(connection_json "$PS_CONNECTION_ID" | jq -c '.config // {}')"
ORIGINAL_WC_CONFIG="$(connection_json "$WC_CONNECTION_ID" | jq -c '.config // {}')"
log "stand: $STAND_DIR"
log "posture at start: replicas=$ORIGINAL_REPLICAS runner=$ORIGINAL_RUNNER_ENABLED"
log "  perf-prestashop caps=$ORIGINAL_PS_CAPS rateLimit=$(printf '%s' "$ORIGINAL_PS_CONFIG" | jq -c '.rateLimit // null')"
log "  perf-woocommerce caps=$ORIGINAL_WC_CAPS rateLimit=$(printf '%s' "$ORIGINAL_WC_CONFIG" | jq -c '.rateLimit // null')"

# A restore that CANNOT abort itself. Every lib.sh helper reaches `die`, and
# `die` calls `exit` - so `ol_login || true` does NOT contain it, the `||` sees
# a return code and there is none, the shell is already leaving. Inside an EXIT
# trap that skips every later line, which here is `release_stand_exclusive`,
# and the stand would stay locked for the full hour. The cleanup path therefore
# uses raw curl and every call ends in `|| true`.
restore_curl() {
  local method="$1" path="$2" body="${3:-}"
  [ -n "${RESTORE_TOKEN:-}" ] || return 0
  curl -sS -o /dev/null -X "$method" "$OL_API_URL$path" \
    -H "Authorization: Bearer $RESTORE_TOKEN" -H 'Content-Type: application/json' \
    ${body:+-d "$body"} 2>/dev/null || true
}

# A RUN THAT CHANGED NOTHING MUST RESTORE NOTHING. The restore PATCHes two
# connections and recreates the worker; firing that on a run refused at
# `guard_stand_exclusive` - the common case on a contended stand - would
# recreate the worker underneath the scenario that legitimately holds the
# stand, killing its in-flight jobs. That is the exact cross-contamination the
# lock exists to prevent, arriving through the refused run's own cleanup path.
CONNECTIONS_TOUCHED=0
WORKER_TOUCHED=0
WORKER_OVERRIDE_FILE="${WORKER_OVERRIDE_FILE:-$STAND_DIR/.limiter-ab-worker-override.yml}"

ab_on_exit() {
  local rc=$?
  stop_background 2>/dev/null || true
  if [ "$CONNECTIONS_TOUCHED" = "0" ] && [ "$WORKER_TOUCHED" = "0" ]; then
    log "nothing was changed on the stand - no restore needed"
    release_stand_exclusive
    return $rc
  fi
  log "restoring stand posture"
  RESTORE_TOKEN="$(curl -sS -X POST "$OL_API_URL/v1/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$OL_ADMIN_USER\",\"password\":\"$OL_ADMIN_PASSWORD\"}" 2>/dev/null \
    | jq -r '.access_token // .accessToken // empty' 2>/dev/null || printf '')"
  [ -n "$RESTORE_TOKEN" ] || warn "could not log in to restore the connections - their capabilities/rateLimit are left as the last arm set them"
  if [ "$CONNECTIONS_TOUCHED" = "1" ]; then
    restore_curl PATCH "/v1/connections/$PS_CONNECTION_ID" \
      "$(jq -n --argjson c "$ORIGINAL_PS_CAPS" --argjson g "$ORIGINAL_PS_CONFIG" '{enabledCapabilities:$c, config:$g}' 2>/dev/null || printf '')"
    restore_curl PATCH "/v1/connections/$WC_CONNECTION_ID" \
      "$(jq -n --argjson c "$ORIGINAL_WC_CAPS" --argjson g "$ORIGINAL_WC_CONFIG" '{enabledCapabilities:$c, config:$g}' 2>/dev/null || printf '')"
  fi
  if [ "$WORKER_TOUCHED" = "1" ]; then
    sed -i "s/^WORKER_RUNNER_ENABLED=.*/WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED/" "$ENV_FILE" 2>/dev/null || true
    # The override must go BEFORE the recreate, or the restored worker keeps
    # whatever env the last arm asked for.
    rm -f "$WORKER_OVERRIDE_FILE"
    ( cd "$STAND_DIR" && docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" -p lab \
        up -d --no-deps --scale "worker=$ORIGINAL_REPLICAS" worker >/dev/null 2>&1 ) \
      || warn "could not restore the worker posture - the stand is left at whatever the last arm set (replicas: [$(discover_worker_containers)])"
  fi
  release_stand_exclusive
  return $rc
}
trap ab_on_exit EXIT

# ===========================================================================
# Arrange helpers
# ===========================================================================

# set_destination <connection_id> <on|off>
#
# Toggles `OrderProcessorManager` in `enabledCapabilities` rather than flipping
# the connection's `status`. Both would work - `resolveDestinations` reads
# `listCapabilityAdapters`, which is active-only AND capability-filtered - but a
# status flip has a side effect this scenario does not want: transitioning back
# INTO `active` fires `ConnectionService`'s taxonomy-sync bootstrap
# (#2084/#2085), enqueueing a `destination.taxonomy.sync` job into a stand this
# run is trying to keep quiet. A capability edit has no such hook.
set_destination() {
  local conn="$1" state="$2" caps
  caps="$(connection_json "$conn" | jq -c '.enabledCapabilities // []')"
  if [ "$state" = "on" ]; then
    caps="$(printf '%s' "$caps" | jq -c '. + ["OrderProcessorManager"] | unique')"
  else
    caps="$(printf '%s' "$caps" | jq -c 'map(select(. != "OrderProcessorManager"))')"
  fi
  CONNECTIONS_TOUCHED=1
  ol_api PATCH "/v1/connections/$conn" "$(jq -n --argjson c "$caps" '{enabledCapabilities:$c}')" >/dev/null
  log "set_destination $conn -> $state (caps now $caps)"
}

# set_rate_limit <connection_id> <rpm> <max_concurrent>
#
# `config` is patched as a WHOLE object, never as a partial: `ConnectionService`
# shallow-spreads it (the #2016 note), so sending `{rateLimit: ...}` alone would
# drop `baseUrl`/`shopId` and leave the connection unusable. The current config
# is therefore read back and merged.
#
# AND IT VERIFIES, by reading the persisted value back and refusing to continue
# on a mismatch. A PATCH is a request; only a read is evidence, and an arm that
# silently measures the configuration it was supposed to be varying against is
# the worst failure this harness has (#2229's reported-versus-enforced rule -
# and F1 hit exactly that with its lane caps).
EFFECTIVE_RATE_LIMIT=""
set_rate_limit() {
  local conn="$1" rpm="$2" concurrent="$3" cfg got
  cfg="$(connection_json "$conn" | jq -c '.config // {}')"
  cfg="$(printf '%s' "$cfg" | jq -c --argjson r "$rpm" --argjson c "$concurrent" \
    '.rateLimit = {requestsPerMinute:$r, maxConcurrent:$c}')"
  CONNECTIONS_TOUCHED=1
  ol_api PATCH "/v1/connections/$conn" "$(jq -n --argjson g "$cfg" '{config:$g}')" >/dev/null
  # Compared FIELD BY FIELD, never as two JSON strings. `jq -c` preserves
  # insertion order and the API answers its own, so the very first arm read
  # back `{"maxConcurrent":4,"requestsPerMinute":60}` against an expected
  # `{"requestsPerMinute":60,"maxConcurrent":4}` and this guard refused a
  # configuration that had in fact applied perfectly. Semantically identical
  # objects must compare equal, or the guard blocks correct runs - which is
  # worse than no guard, because the next person deletes it.
  got="$(connection_json "$conn" | jq -c '.config.rateLimit // null')"
  local got_rpm got_conc
  got_rpm="$(printf '%s' "$got" | jq -r '.requestsPerMinute // "absent"')"
  got_conc="$(printf '%s' "$got" | jq -r '.maxConcurrent // "absent"')"
  { [ "$got_rpm" = "$rpm" ] && [ "$got_conc" = "$concurrent" ]; } \
    || die "set_rate_limit: asked for ${rpm}/min, $concurrent concurrent but the connection reads back requestsPerMinute=$got_rpm maxConcurrent=$got_conc ($got) - refusing to measure a configuration that was not applied"
  EFFECTIVE_RATE_LIMIT="$got"
  log "set_rate_limit $conn -> $got (read back from the API, not from the request)"
}

# recreate_worker <runner:true|false> <dedicated_redis:true|false> [lane_scope_cap] [lane_cap]
#
# WHY AN OVERRIDE FILE AND NOT `.env.lab` ALONE (#2847, found the hard way)
#
# An entry in an env-file is available for `${VAR}` INTERPOLATION inside the
# compose file; it is NOT passed to the container unless the service's own
# `environment:` block names it. F1's first version wrote a lane cap into
# `.env.lab`, recreated the worker, and measured the default at every point of
# a sweep whose whole purpose was to vary it - `docker exec printenv` was
# empty. The stand's compose file names neither the lane variables nor
# `OL_JOB_INTAKE_DEDICATED_REDIS`, so an override file declares them on the
# service. It lives in the STAND's directory (compose resolves `-f` paths
# independently, but keeping both files together is what makes the temporary
# one obvious) and is removed on restore.
recreate_worker() {
  local runner="$1" dedicated="$2" scope_cap="${3:-}" lane_cap="${4:-}"
  local compose_args w tries hits found
  WORKER_TOUCHED=1
  if grep -q '^WORKER_RUNNER_ENABLED=' "$ENV_FILE"; then
    sed -i "s/^WORKER_RUNNER_ENABLED=.*/WORKER_RUNNER_ENABLED=$runner/" "$ENV_FILE"
  else
    printf 'WORKER_RUNNER_ENABLED=%s\n' "$runner" >> "$ENV_FILE"
  fi

  rm -f "$WORKER_OVERRIDE_FILE"
  {
    printf '# Written by scenarios/limiter-ab.sh (#2840). Removed when the scenario\n'
    printf '# restores the worker. Declares the variables under test ON the worker\n'
    printf '# service, because compose forwards only the keys a service names.\n'
    printf 'services:\n  worker:\n    environment:\n'
    printf "      OL_JOB_INTAKE_DEDICATED_REDIS: '%s'\n" "$dedicated"
    if [ -n "$scope_cap" ]; then
      printf "      OL_LANE_REALTIME_SCOPE_CAP: '%s'\n" "$scope_cap"
      printf "      OL_LANE_REALTIME_CAP: '%s'\n" "${lane_cap:-$scope_cap}"
    fi
  } > "$WORKER_OVERRIDE_FILE"
  compose_args="-f $COMPOSE_FILE -f $WORKER_OVERRIDE_FILE"

  # shellcheck disable=SC2086
  ( cd "$STAND_DIR" && docker compose $compose_args --env-file "$ENV_FILE" -p lab \
      up -d --no-deps --scale "worker=$ORIGINAL_REPLICAS" worker >/dev/null 2>&1 ) \
    || die "recreate_worker: compose refused to recreate the worker service"

  # The discovery cache in lib.sh is stale by construction after a recreate.
  WORKER_CONTAINERS=""
  WORKER_CONTAINERS_RESOLVED=0
  _ensure_worker_containers
  found="$(discover_worker_containers | wc -w | tr -d ' ')"
  [ "$found" -eq "$ORIGINAL_REPLICAS" ] || die "recreate_worker: expected $ORIGINAL_REPLICAS replica(s), discovery found $found"

  if [ "$runner" = "true" ]; then
    for w in $WORKER_CONTAINERS; do
      tries=0
      while true; do
        # `grep -c`, never `grep -q`: `-q` closes the pipe and `set -o pipefail`
        # then fails the whole pipeline even though the line matched.
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
  assert_intake_client "$dedicated"
  assert_lane_caps "$scope_cap" "${lane_cap:-$scope_cap}"
  log "worker recreated: runner=$runner dedicatedRedis=$dedicated lane scope cap=${scope_cap:-<runner default>}"
}

# assert_intake_client <expected:true|false>
#
# Reads which client the WORKER ITSELF resolved for `JobIntakeConsumer` and
# refuses to continue unless it is the one requested. The env var is checked
# too, but the log line is the one that matters: `printenv` proves the request
# reached the container, and only the worker's own line proves the code took
# the branch. Arm D's entire value rests on that distinction.
assert_intake_client() {
  local want="$1" w line got env_got
  local want_word='SHARED'
  [ "$want" != "true" ] || want_word='DEDICATED'
  for w in $WORKER_CONTAINERS; do
    env_got="$(docker exec "$w" printenv OL_JOB_INTAKE_DEDICATED_REDIS 2>/dev/null || printf '<unset>')"
    line="$(docker logs "$w" 2>&1 | grep -F 'Job intake Redis client:' | tail -1 || true)"
    [ -n "$line" ] || die \
"assert_intake_client: $w's log carries no 'Job intake Redis client:' line.
  The image predates the JOB_INTAKE_REDIS_CLIENT_TOKEN provider (#2840) - it cannot
  have the flag either, so arm D would measure the shared client while claiming the
  dedicated one. Rebuild the stand's ol-perf:worker image from a tree that has it."
    # ANCHORED on the prefix, never a bare `grep -oE 'SHARED|DEDICATED'`. The
    # SHARED line reads "... client: SHARED (OL_JOB_INTAKE_DEDICATED_REDIS is
    # not true)", so an unanchored alternation matches SHARED *and* the
    # DEDICATED inside the variable's own name - and a `tail -1` then picks the
    # wrong one and refuses a correctly-configured arm. Caught by this guard
    # firing on its own first real run, which is the argument for having it.
    got="$(printf '%s' "$line" | grep -oP 'Job intake Redis client: \K(SHARED|DEDICATED)' | tail -1 || true)"
    [ "$got" = "$want_word" ] || die \
"assert_intake_client: asked for OL_JOB_INTAKE_DEDICATED_REDIS=$want but $w reports $got
  (printenv says [$env_got]). Refusing to measure a configuration that was not applied."
    log "assert_intake_client: $w reports $got (env [$env_got])"
  done
}

# assert_lane_caps <expected_scope_cap|""> <expected_lane_cap|"">
#
# Empty expectations mean the runner's own defaults, which cannot be asserted
# against a number this script invents - so that case only RECORDS what was
# found. `caps` is rendered `total/perScope`.
assert_lane_caps() {
  local want_scope="$1" want_lane="$2" w line caps got_total got_scope
  for w in $WORKER_CONTAINERS; do
    line="$(docker logs "$w" 2>&1 | grep -F 'Starting sync job runner loop' | tail -1 || true)"
    [ -n "$line" ] || { log "assert_lane_caps: $w has no runner startup line (runner disabled) - nothing to record"; continue; }
    caps="$(printf '%s' "$line" | grep -oP 'realtime=\K[0-9]+/[0-9]+' || true)"
    [ -n "$caps" ] || die "assert_lane_caps: could not parse realtime lane caps out of $w's startup line: $line"
    got_total="${caps%%/*}"; got_scope="${caps##*/}"
    if [ -n "$want_scope" ]; then
      [ "$got_scope" = "$want_scope" ] || die \
"assert_lane_caps: asked for OL_LANE_REALTIME_SCOPE_CAP=$want_scope but $w reports realtime=$caps.
  The request did not reach the container - an .env.lab entry alone does NOT forward a
  variable, the service's own \`environment:\` block must name it, which is what
  \$WORKER_OVERRIDE_FILE exists to do. Refusing to measure a configuration that was not applied."
      [ "$got_total" = "$want_lane" ] || die \
"assert_lane_caps: asked for OL_LANE_REALTIME_CAP=$want_lane but $w reports realtime=$caps"
    fi
    log "assert_lane_caps: $w reports realtime=$caps${want_scope:+ (requested $want_lane/$want_scope)}"
  done
}

# ===========================================================================
# Observation
# ===========================================================================
PROGRESS_HEADER='epoch,iso,due_queued,running,completed,oldest_due_age_s,feed_backlog,available_work'

# `available_work` is `feed_backlog + due_queued + running`, and it is the
# number post_guard_feed_starved consumes - NOT `feed_backlog` alone. The poll
# pump converts a 900-order stub backlog into queued children inside about 90
# seconds, so from then on the stub reads EMPTY while OpenLinker is at its
# busiest; passing the stub's backlog would discard every valid run. `running`
# is included because a tick can legitimately land with the queue momentarily
# drained and every slot busy - a saturated system, the opposite of a starved
# one.
progress_tick() {
  local out="$1" ws_iso="$2" due running completed oldest backlog available
  due="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$SOURCE_CONNECTION_ID' AND status='queued' AND \"nextRunAt\"<=NOW()" 2>/dev/null || printf 0)"
  running="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$SOURCE_CONNECTION_ID' AND status='running'" 2>/dev/null || printf 0)"
  completed="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"jobType\"='marketplace.order.sync' AND \"connectionId\"='$SOURCE_CONNECTION_ID' AND status='succeeded' AND \"createdAt\">='$ws_iso'" 2>/dev/null || printf 0)"
  oldest="$(pg_sql "SELECT COALESCE(ROUND(EXTRACT(EPOCH FROM (NOW() - MIN(\"createdAt\")))),0) FROM sync_jobs WHERE \"connectionId\"='$SOURCE_CONNECTION_ID' AND status='queued' AND \"nextRunAt\"<=NOW()" 2>/dev/null || printf 0)"
  backlog="$(of_backlog "$SOURCE_TENANT" "$SOURCE_CONNECTION_ID" 2>/dev/null || printf 'unknown')"
  # An unreadable upstream makes AVAILABLE WORK unknown too, never just the
  # queue depth: the guard's contract is that `unknown` DISCARDS rather than
  # being read around, and substituting the queue depth here would route around
  # it one layer down.
  if [ "$backlog" = "unknown" ]; then
    available="unknown"
  else
    available=$(( backlog + ${due:-0} + ${running:-0} ))
  fi
  printf '%s,%s,%s,%s,%s,%s,%s,%s\n' "$(epoch)" "$(iso_now)" "${due:-0}" "${running:-0}" "${completed:-0}" "${oldest:-0}" "${backlog:-unknown}" "$available" >> "$out"
}

PUMP_PID=""
SAMPLER_PID=""

start_pump() {
  local tag="$1"
  ( while true; do
      # Called inside a COMMAND SUBSTITUTION, which is what contains a `die`.
      # `of_enqueue_poll` reaches `ol_api`, and `ol_api` dies on any non-2xx; a
      # direct call would take the pump's own subshell down with it and the
      # window would silently stop offering load from that moment on - which
      # post_guard_feed_starved would then correctly, but confusingly, discard.
      # A substitution keeps the failure to one tick.
      : "$(of_enqueue_poll "$SOURCE_CONNECTION_ID" "$tag" 2>/dev/null || printf '')"
      sleep "$POLL_CADENCE_SECS"
    done ) &
  PUMP_PID=$!
  log "poll pump started (pid=$PUMP_PID, every ${POLL_CADENCE_SECS}s)"
}

start_progress() {
  local out="$1" ws_iso="$2"
  printf '%s\n' "$PROGRESS_HEADER" > "$out"
  ( while true; do
      progress_tick "$out" "$ws_iso" || true
      sleep "$PROGRESS_TICK_SECS"
    done ) &
  SAMPLER_PID=$!
  log "progress sampler started (pid=$SAMPLER_PID, every ${PROGRESS_TICK_SECS}s)"
}

stop_background() {
  local p
  for p in "${PUMP_PID:-}" "${SAMPLER_PID:-}"; do
    [ -n "$p" ] || continue
    kill "$p" >/dev/null 2>&1 || true
    wait "$p" 2>/dev/null || true
  done
  PUMP_PID=""; SAMPLER_PID=""
}

# The minimum AVAILABLE WORK across the window (column 8), or `unknown` if ANY
# tick could not establish it. `unknown` wins over every number deliberately: a
# single unreadable tick means the run cannot show its instrument kept offering
# load, and the guard treats that as a discard rather than reading around it.
min_available_work() {
  awk -F, 'NR>1 { v=$8; if (v=="unknown" || v=="") { print "unknown"; exit }
                  if (m=="" || v+0 < m) m=v+0 }
           END { if (m=="") print "unknown"; else printf "%d\n", m }' "$1"
}

# The MAXIMUM concurrently-running job count seen (column 4). An UPPER BOUND,
# not a measurement: `sync_jobs.status` over-reads, because a handler that
# finished before its terminal write committed still reads `running`. That
# direction is the useful one here - it is what tells arm C's null result apart
# from an unreachable concurrency ceiling (see the header).
max_running() {
  awk -F, 'NR>1 { if ($4+0 > m) m=$4+0 } END { printf "%d\n", m+0 }' "$1"
}

# ---------------------------------------------------------------------------
# ps_requests_in_window <start_epoch> <stop_epoch> - the DESTINATION's own
# request count, read from PrestaShop's access log.
#
# The stub's `requestCounts` are the SOURCE side and say nothing about what the
# create path costs at the shop. PrestaShop's apache access log is symlinked to
# /dev/stdout, so `docker logs` is the log - and `--since`/`--until` take a
# BARE epoch, never `@epoch` (the `@` form is accepted without error and
# returns NOTHING on Docker 29.5.2 - the same trap post_guard_limiter_degraded
# carried from the day it was written).
#
# Echoes `<api_requests> <module_requests>`. Both are counted because they are
# separately paced: every `/api/` call and every `POST /index.php` module call
# goes through the same per-connection limiter bucket, so the per-order figure
# the derived ceiling divides by is their SUM.
# ---------------------------------------------------------------------------
ps_requests_in_window() {
  local from="$1" to="$2" logs api mod
  logs="$(docker logs --since "$from" --until "$to" "$PS_CONTAINER" 2>&1 || true)"
  api="$(printf '%s\n' "$logs" | grep -cE '"(GET|POST|PUT|DELETE|PATCH) /api/' || true)"
  mod="$(printf '%s\n' "$logs" | grep -cE '"POST /index\.php' || true)"
  printf '%s %s' "${api:-0}" "${mod:-0}"
}

# ---------------------------------------------------------------------------
# degraded_count_from_verdict <dir> - how many degraded-limiter lines the
# post-guard COUNTED, taken from the verdict it wrote rather than re-grepped.
#
# Re-grepping would be a second, independently-wrong implementation of the
# window bounds; reading the guard's own sentence keeps exactly one. `0` is
# only reported when the verdict carries no limiter reason at all, which for a
# verdict this scenario wrote means the guard ran and answered "ok" - and that
# guard was proved able to FAIL before this run trusted a zero (see --smoke).
# ---------------------------------------------------------------------------
degraded_count_from_verdict() {
  local dir="$1" n
  n="$(grep -oP 'post_guard_limiter_degraded: \K[0-9]+' "$dir/verdict.txt" 2>/dev/null | tail -1 || true)"
  printf '%s' "${n:-0}"
}

# ===========================================================================
# --smoke
# ===========================================================================
run_smoke() {
  log "=== --smoke: rig self-test, no window, nothing written under results/ ==="
  log "stand dir      : $STAND_DIR"
  log "compose file   : $COMPOSE_FILE"
  log "env file       : $ENV_FILE"
  log "worker replicas: $ORIGINAL_REPLICAS [$(discover_worker_containers)]"
  log "stub health    : $(of_health | jq -c .)"
  log "PS rateLimit   : $(connection_json "$PS_CONNECTION_ID" | jq -c '.config.rateLimit // "absent (falls back to the plugin manifest default)"')"
  log "PS caps        : $(connection_json "$PS_CONNECTION_ID" | jq -c '.enabledCapabilities')"

  # A guard that cannot see reads exactly like a clean run, so it is PROVED
  # able to fail before any zero it reports is believed. Against real Docker,
  # not a stub: a throwaway container emitting one degraded-mode line at a
  # known instant, checked inside its window and outside it.
  local probe=ab-limiter-probe t0 t1 inside outside
  docker rm -f "$probe" >/dev/null 2>&1 || true
  t0="$(epoch)"
  sleep 2
  docker run -d --name "$probe" alpine:3.20 sh -c \
    'sleep 1; echo "Redis rate-limiter call checkPace timed out after 1000ms - falling back to per-process in-memory limiting"; sleep 3' >/dev/null
  sleep 6
  t1="$(epoch)"
  local saved="$WORKER_CONTAINERS" saved_resolved="$WORKER_CONTAINERS_RESOLVED"
  WORKER_CONTAINERS="$probe"; WORKER_CONTAINERS_RESOLVED=1
  inside="$(post_guard_limiter_degraded "$t0" "$t1")"
  outside="$(post_guard_limiter_degraded "$((t0 - 60))" "$((t0 + 1))")"
  WORKER_CONTAINERS="$saved"; WORKER_CONTAINERS_RESOLVED="$saved_resolved"
  docker rm -f "$probe" >/dev/null 2>&1 || true

  log "limiter guard, line inside the window : $inside"
  log "limiter guard, line outside the window: $outside"
  case "$inside" in
    DISCARDED*) : ;;
    *) die "--smoke: post_guard_limiter_degraded did NOT see a degraded line inside a window that contains one. Every zero it reports would be meaningless, so no arm may run." ;;
  esac
  [ "$outside" = "ok" ] || die "--smoke: post_guard_limiter_degraded reported a line OUTSIDE its window - the bounds are wrong and a peer's episode could discard this run"
  log "=== --smoke ok ==="
}

# ===========================================================================
# One arm-run
#
# Reports through the GLOBALS `ARM_*`, deliberately, rather than by echoing for
# the caller to capture. A dozen lib.sh calls in this body write to stdout
# through `log`, and a `$(...)` capture would swallow all of it into the
# "rate" - silently, since a `read -r` simply takes the first words of whatever
# arrives. Redirecting each of those to stderr one by one is a list that goes
# stale the first time a line is added, and f8's own first run lost both its
# arms to exactly this.
# ===========================================================================
ARM_RATE=""
ARM_DIR=""
ARM_VERDICT=""
ARM_DEGRADED=""
ARM_REQ_PER_ORDER=""
ARM_ORDERS=""
ARM_MAX_RUNNING=""

arm_run() {
  local arm="$1" rpm="$2" concurrent="$3" repeat="$4"
  local dir progress rate orders api mod verdict
  ARM_RATE=""; ARM_DIR=""; ARM_VERDICT=""; ARM_DEGRADED=""
  ARM_REQ_PER_ORDER=""; ARM_ORDERS=""; ARM_MAX_RUNNING=""

  log "=== arm $arm repeat $repeat: rpm=$rpm maxConcurrent=$concurrent window=${WINDOW_SECS}s backlog=$BACKLOG ==="
  set_rate_limit "$PS_CONNECTION_ID" "$rpm" "$concurrent"

  of_new_run >/dev/null
  reset_between_repeats "$CONN_IDS" "'$OF_CURSOR_KEY'"
  # Only this source connection's rows, never a blanket delete, which would
  # take a peer's rows with it.
  pg_sql_write "DELETE FROM sync_jobs WHERE \"connectionId\"='$SOURCE_CONNECTION_ID' AND status IN ('queued','running')" >/dev/null
  # drain BEFORE the assertion, in that order: asserting first would refuse
  # every arm after the first. And never `guard_queue_empty ... || true` - `die`
  # calls `exit`, so `|| true` does not tolerate it.
  drain_wait "$CONN_IDS" >/dev/null || warn "arm $arm/$repeat: pre-arm drain did not settle cleanly"
  guard_queue_empty "$CONN_IDS"

  local warm=$((WARMUP_ORDERS_PER_REPLICA * ORIGINAL_REPLICAS))
  log "warm-up: $warm order(s) ($WARMUP_ORDERS_PER_REPLICA per replica x $ORIGINAL_REPLICAS)"
  of_push_orders "$SOURCE_TENANT" "$warm" >/dev/null
  of_enqueue_poll "$SOURCE_CONNECTION_ID" "warm-$arm-$repeat" >/dev/null
  cap_perf_job_attempts
  drain_wait "$CONN_IDS" >/dev/null || warn "arm $arm/$repeat: warm-up drain did not settle cleanly"

  of_push_orders "$SOURCE_TENANT" "$BACKLOG" >/dev/null
  log "pushed $BACKLOG order(s); stub backlog now $(of_backlog "$SOURCE_TENANT" "$SOURCE_CONNECTION_ID")"

  dir="$(results_dir_init limiter-ab "$RUN_GROUP-$arm-r$repeat")"
  progress="$dir/progress.csv"

  snapshot_jobs_before "$CONN_IDS"
  window_start "$dir" limiter-ab "$CONN_IDS" 0 "$(manifest_extra_json "$arm" "$repeat" "$rpm" "$concurrent")"
  local ws_iso; ws_iso="$(date -u -d "@$WINDOW_START_EPOCH" +%Y-%m-%dT%H:%M:%SZ)"

  local stub_before; stub_before="$(of_stats "$SOURCE_TENANT")"
  start_progress "$progress" "$ws_iso"
  start_pump "$arm-$repeat"
  sleep "$WINDOW_SECS"
  stop_background
  window_stop "$dir"
  printf '%s' "$stub_before" > "$dir/stub-stats-before.json"
  of_stats "$SOURCE_TENANT" > "$dir/stub-stats-after.json"

  local mb; mb="$(min_available_work "$progress")"
  run_post_guards "$dir" "$CONN_IDS" "$ws_iso" "$WINDOW_START_EPOCH" "$WINDOW_STOP_EPOCH" "$PS_CONNECTION_ID" "" "" "$mb"
  # `awk 'NR==1'`, never `head -1`: under `set -o pipefail` a `head` that closes
  # the pipe makes the whole pipeline report failure ON SUCCESS via SIGPIPE, and
  # f7 lost a 17-minute arm to exactly that.
  verdict="$(verdict_read "$dir" | awk 'NR==1')"

  # DISCARD the undrained remainder rather than draining it. The backlog is
  # deliberately sized to outlast the window - that is what
  # post_guard_feed_starved requires - so a window that ends with the system
  # still busy leaves hundreds of queued children behind BY DESIGN, and
  # draining them would cost longer than the window itself for work that is
  # outside every measurement. Deleting a QUEUED row is safe: it was never
  # claimed, so nothing partially happened for it. `running` rows are left to
  # finish and then waited on - killing a claimed job mid-flight would abandon
  # a destination create halfway, a real side effect on a real shop.
  local discarded
  discarded="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$SOURCE_CONNECTION_ID' AND status='queued'" 2>/dev/null || printf 0)"
  pg_sql_write "DELETE FROM sync_jobs WHERE \"connectionId\"='$SOURCE_CONNECTION_ID' AND status='queued'" >/dev/null
  log "arm $arm/$repeat: discarded ${discarded:-0} queued child job(s) the window did not reach"
  pg_sql_write "UPDATE sync_jobs SET \"maxAttempts\"=$PERF_MAX_ATTEMPTS WHERE \"connectionId\"='$SOURCE_CONNECTION_ID' AND status='running'" >/dev/null
  drain_wait "$CONN_IDS" >/dev/null || warn "arm $arm/$repeat: drain timed out waiting for in-flight jobs"

  {
    printf '=== arm %s repeat %s (rpm=%s maxConcurrent=%s) ===\n' "$arm" "$repeat" "$rpm" "$concurrent"
    python3 "$SCRIPT_DIR/../drivers/f1-summarize.py" throughput "$progress"
  } > "$dir/summary.txt"
  cat "$dir/summary.txt"

  rate="$(awk -F'= *' '/orders\/hour/ {gsub(/ orders\/hour/,"",$2); print $2; exit}' "$dir/summary.txt")"
  [ -n "$rate" ] || rate=0
  # Orders COMPLETED inside the window, from the last progress tick's own
  # counter - the same column the rate is derived from, so the two cannot
  # disagree about which orders they describe.
  orders="$(awk -F, 'NR>1 { c=$5 } END { printf "%d\n", c+0 }' "$progress")"
  read -r api mod <<< "$(ps_requests_in_window "$WINDOW_START_EPOCH" "$WINDOW_STOP_EPOCH")"

  ARM_RATE="$rate"
  ARM_DIR="$dir"
  ARM_VERDICT="$verdict"
  ARM_DEGRADED="$(degraded_count_from_verdict "$dir")"
  ARM_ORDERS="$orders"
  ARM_MAX_RUNNING="$(max_running "$progress")"
  ARM_REQ_PER_ORDER="$(awk -v a="$api" -v m="$mod" -v o="$orders" \
    'BEGIN { if (o+0 <= 0) { print "unknown" } else { printf "%.2f", (a+m)/o } }')"

  {
    printf '\ndestination requests inside the window (PrestaShop access log):\n'
    printf '  /api/            %s\n' "$api"
    printf '  POST /index.php  %s\n' "$mod"
    printf '  orders completed %s\n' "$orders"
    printf '  per order        %s\n' "$ARM_REQ_PER_ORDER"
    printf '  max concurrently-running jobs (UPPER BOUND) %s\n' "$ARM_MAX_RUNNING"
    printf '  degraded-limiter lines in window            %s\n' "$ARM_DEGRADED"
    printf '  verdict          %s\n' "$ARM_VERDICT"
  } | tee -a "$dir/summary.txt"

  log "arm $arm/$repeat result: $ARM_RATE orders/hour, ${ARM_REQ_PER_ORDER} req/order, degraded=$ARM_DEGRADED, maxRunning=$ARM_MAX_RUNNING, verdict=$ARM_VERDICT ($ARM_DIR)"
  # Appended AS THE ARM FINISHES, not accumulated in memory and written at the
  # end. A run of nine windows is over an hour of wall clock on this stand, and
  # an in-memory table is lost entirely if the run is interrupted in the ninth -
  # taking eight completed measurements with it. The per-arm directories would
  # survive, but reconstructing the table from them by hand is exactly the step
  # a tired reader gets wrong.
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$arm" "$repeat" "$rpm" "$concurrent" "$ARM_RATE" "$ARM_ORDERS" \
    "$ARM_REQ_PER_ORDER" "$ARM_MAX_RUNNING" "$ARM_DEGRADED" "$ARM_VERDICT" \
    "$(basename "$ARM_DIR")" >> "$SUMMARY_CSV"
}

# Everything a window needs that lib.sh does not already record. The effective
# rate limit is the value READ BACK from the API by `set_rate_limit`, never the
# one this script requested - a label is a claim, only a reading is evidence.
manifest_extra_json() {
  local arm="$1" repeat="$2" rpm="$3" concurrent="$4" stub_cfg intake
  stub_cfg="$(of_config)"
  intake="$(docker exec "$(discover_worker_containers | awk '{print $1}')" printenv OL_JOB_INTAKE_DEDICATED_REDIS 2>/dev/null || printf '<unset>')"
  jq -n \
    --arg arm "$arm" \
    --arg source_tenant "$SOURCE_TENANT" \
    --arg source_conn "$SOURCE_CONNECTION_ID" \
    --arg dest_conn "$PS_CONNECTION_ID" \
    --arg intake "$intake" \
    --argjson repeat "$repeat" \
    --argjson requested_rpm "$rpm" \
    --argjson requested_concurrent "$concurrent" \
    --argjson effective "${EFFECTIVE_RATE_LIMIT:-null}" \
    --argjson replicas "$ORIGINAL_REPLICAS" \
    --argjson backlog "$BACKLOG" \
    --argjson window "$WINDOW_SECS" \
    --argjson poll_cadence "$POLL_CADENCE_SECS" \
    --argjson poll_limit "$OF_POLL_LIMIT" \
    --argjson warmup_per_replica "$WARMUP_ORDERS_PER_REPLICA" \
    --argjson stub "$stub_cfg" \
    '{
      arm: $arm,
      repeat: $repeat,
      orderSource: {tenant: $source_tenant, connectionId: $source_conn},
      destination: {label: "real PrestaShop (#2860)", connectionId: $dest_conn},
      rateLimit: {
        requested: {requestsPerMinute: $requested_rpm, maxConcurrent: $requested_concurrent},
        effective: $effective,
        provenance: "effective is READ BACK from GET /v1/connections/:id after the PATCH, never the requested value",
        note: "an explicit 60/4 is behaviourally identical to an absent config.rateLimit on this connection - http-transport-factory.ts:148 resolves config.rateLimit ?? defaultRateLimit, and prestashop-plugin.ts:84 declares exactly {requestsPerMinute:60, maxConcurrent:4}. Written explicitly so that A->B varies only rpm and A->C only maxConcurrent."
      },
      jobIntakeDedicatedRedis: {
        workerEnv: $intake,
        note: "asserted against the worker log line [Job intake Redis client:] by assert_intake_client, not taken from this env read - printenv proves the request arrived, only the log line proves the code took the branch"
      },
      arrivalRate: {
        note: "the INDEPENDENT VARIABLE is the offered order rate: min(pollPageLimit, feedBacklog) / pollCadenceSeconds. The pre-seeded order_records rows on this stand are a fixed dataset size, never an arrival rate.",
        pollCadenceSecondsHarnessChosen: $poll_cadence,
        pollPageLimit: $poll_limit,
        feedBacklogPushed: $backlog,
        windowSeconds: $window
      },
      warmupOrders: {perReplica: $warmup_per_replica, replicas: $replicas, reason: "excludes the line_prices cold start (27 requests versus 7 for the first order after any worker restart, prestashop-openlinker-module.client.ts) and warms the currency/country/order-state caches"},
      stub: $stub,
      buyerWarmth: "every arm calls of_new_run, so its buyer external ids are fresh and every order in every window mints a NEW destination customer. That makes the arms comparable to each other and makes requests-per-order the ALL-COLD figure, which is the upper end of the range - a warm-buyer deployment pays ~4 fewer webservice requests per order.",
      fanOutCoTenancy: "controlled - the scheduler is OFF, so no master sweep parent shares the fan-out lane with marketplace.orders.poll during any window",
      knownStructuralDiscard: "post_guard_destination_creates fires on ANY saturation window: the point of one is to end with work in flight, so orders created inside the window and still mid-create when it closes lack syncedAt. F1 recorded this as a guard gap rather than a fault of the run."
    }'
}

# ===========================================================================
# strict
# ===========================================================================
run_strict() {
  mkdir -p "$(dirname "$SUMMARY_CSV")"
  printf 'arm,repeat,requestsPerMinute,maxConcurrent,ordersPerHour,ordersCompleted,destRequestsPerOrder,maxRunningUpperBound,degradedLimiterLines,verdict,dir\n' > "$SUMMARY_CSV"

  log "=== pre-flight guards ==="
  guard_scheduler_off
  guard_demo_mode_off
  guard_log_level
  guard_perf_max_attempts
  guard_build

  # The runner must be ON - nothing is observable otherwise. This stand's own
  # default is OFF, so it is flipped here and restored by the EXIT trap. Arms
  # A/B/C then share this one worker process, which is what removes a
  # process-restart confound from the comparison that matters most.
  recreate_worker true false
  guard_connection_budget
  guard_pool_recorded
  guard_runner_state enabled

  # WooCommerce is disabled for every arm so the unfiltered destination fan-out
  # cannot reach both shops and bias the measurement toward the slower.
  set_destination "$WC_CONNECTION_ID" off
  set_destination "$PS_CONNECTION_ID" on

  local spec arm rpm concurrent scope_cap lane_cap dedicated r
  local base_first="" base_rate=""

  # --- the interleaved block: A B C / A B C, one worker process throughout ---
  for r in $(seq 1 "$REPEATS"); do
    for spec in $ARM_SPECS; do
      IFS=: read -r arm rpm concurrent scope_cap lane_cap dedicated <<< "$spec"
      [ -z "$scope_cap" ] || die "ARM_SPECS arm $arm asks for a lane cap - a lane change needs a worker recreate, so it belongs in RECREATE_ARM_SPECS"
      [ "$dedicated" = "false" ] || die "ARM_SPECS arm $arm asks for a dedicated intake client - that needs a worker recreate, so it belongs in RECREATE_ARM_SPECS"
      arm_run "$arm" "$rpm" "$concurrent" "$r"
      [ -n "$base_first" ] || { base_first="$arm"; base_rate="$ARM_RATE"; }
    done
  done

  # --- the recreate block: each arm consecutively, one recreate per arm ---
  for spec in $RECREATE_ARM_SPECS; do
    IFS=: read -r arm rpm concurrent scope_cap lane_cap dedicated <<< "$spec"
    log "=== arm $arm needs a worker recreate (dedicatedRedis=$dedicated laneScopeCap=${scope_cap:-<default>}) ==="
    recreate_worker true "$dedicated" "$scope_cap" "$lane_cap"
    guard_runner_state enabled
    for r in $(seq 1 "$REPEATS"); do
      arm_run "$arm" "$rpm" "$concurrent" "$r"
    done
  done

  # --- the drift control: one more repeat of the baseline, back on the
  # --- shipped worker posture, run LAST. If it lands on the interleaved
  # --- block's figures the stand did not move underneath the consecutive
  # --- blocks; if it does not, every cross-block comparison above is
  # --- suspect and the report has to say so.
  if [ -n "$DRIFT_CONTROL" ]; then
    IFS=: read -r arm rpm concurrent scope_cap lane_cap dedicated <<< "$DRIFT_CONTROL"
    log "=== drift control: one more repeat of arm $arm on the shipped worker posture ==="
    recreate_worker true false
    guard_runner_state enabled
    arm_run "$arm" "$rpm" "$concurrent" "drift"
  fi

  log "=== every arm complete ==="
  column -s, -t < "$SUMMARY_CSV" 2>/dev/null || cat "$SUMMARY_CSV"
  log "summary: $SUMMARY_CSV"
  log "baseline arm was $base_first at $base_rate orders/hour; 'the number moved' threshold is ${MOVED_THRESHOLD_PCT}% (see the header for why a threshold is needed at all)"
}

RUN_GROUP="${RUN_GROUP:-run$(epoch)}"
SUMMARY_CSV="$RESULTS_ROOT/limiter-ab/$RUN_GROUP-summary.csv"

if [ "$MODE" = "smoke" ]; then
  run_smoke
else
  run_strict
fi
