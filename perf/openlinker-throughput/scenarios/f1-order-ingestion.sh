#!/usr/bin/env bash
#
# F1 - order ingestion latency and throughput (#2847, epic #2840).
#
# Answers the two questions an adopter asks first, and answers them
# separately because they are different questions:
#
#   LATENCY     how long does ONE order take to get from the marketplace into
#               a real shop, broken down hop by hop, on an idle system?
#   THROUGHPUT  how many orders per hour can OpenLinker sustain, and what
#               binds first?
#
# The chain measured, and where each timestamp comes from:
#
#   t0  an order exists at the source            harness clock, at the stub push
#   t1  a poll job is enqueued                   sync_jobs.createdAt   (poll)
#   t2  the runner claims the poll               sync_jobs.lockedAt    (poll)
#   t3  a marketplace.order.sync child exists    sync_jobs.createdAt   (child)
#   t4  the runner claims the child              sync_jobs.lockedAt    (child)
#   t5  the order snapshot is persisted          order_records.createdAt
#   t6  the destination order is created         order_records.syncStatus[].syncedAt
#
# ---------------------------------------------------------------------------
# THE FOUR-POINT LATENCY IS A DOCUMENTED CROSS-TABLE RECONSTRUCTION
# ---------------------------------------------------------------------------
# #2847 requires this choice to be declared rather than made silently: either
# real instrumentation (#2850) or a reconstruction carrying its caveats
# explicitly. #2850 does not exist, so this is the reconstruction - and each
# of the three caveats it names is handled here rather than restated:
#
#  - `lockedAt` is rewritten every 3 minutes by the runner's heartbeat
#    (`sync-job.runner.ts` JOB_HEARTBEAT_INTERVAL_MS), so it is the CLAIM
#    instant only for a job that finished inside that window. Not assumed:
#    the summarizer COUNTS how many sampled jobs ran >= 180s and prints the
#    figure beside the hops that depend on it.
#
#  - `lastAttemptDurationMs` is reset to `null` on every enqueue
#    (`sync-job.repository.ts`) and reports the LAST attempt only. Again
#    counted rather than assumed: the summarizer prints how many sampled
#    children took more than one attempt.
#
#  - `syncStatus[].syncedAt` is stamped inside a `Promise.allSettled` over
#    EVERY destination (`order-ingestion.service.ts`), so it is biased late -
#    it records whichever destination finished last. This scenario removes
#    the bias STRUCTURALLY rather than caveating it: each arm disables the
#    other destination connection before its window opens, so the fan-out
#    has exactly one member and "the slowest of N" is the one destination.
#    That is also #2847's own acceptance criterion, met for two reasons at
#    once.
#
# One point in the issue's own table has no proxy at all and is therefore NOT
# reported: "the poll observed it". Nothing persists it. The two hops either
# side of it (t1->t2 and t2->t3) are reported instead, which brackets it.
#
# ---------------------------------------------------------------------------
# POLL WAIT IS EXCLUDED BY CONSTRUCTION, NOT MEASURED AS FAST
# ---------------------------------------------------------------------------
# The scheduler is OFF for this run and the harness enqueues every
# `marketplace.orders.poll` itself (see drivers/order-feed.sh's
# `of_enqueue_poll` for the full reasoning). So hop A below - "order pushed at
# the stub -> poll enqueued" - is a cadence this script chose. It is NOT a
# figure any deployment experiences, and the report says so in those words,
# the way F2 reports its own shop-cron hop.
#
# The real cadences are recorded in the manifest separately, as DERIVED
# values: Allegro's `*/1 * * * *` (`allegro-scheduler-tasks.ts`, tunable via
# `OL_ALLEGRO_POLL_INTERVAL_CRON` on the WORKER since #2279) gives a 30s mean
# poll wait; WooCommerce and Erli hardcode `*/5` string literals and are NOT
# retunable without a code change. Because the scheduler is off, those are
# read from the plugin defaults and the worker's own environment - never
# claimed to be "read from a running scheduler", because there isn't one.
#
# Turning the scheduler on instead would have fired every other default-on
# task with it, including the PrestaShop master sweeps whose parents share
# the `fan-out` lane with `marketplace.orders.poll` itself
# (`handler-registration.service.ts`, 8 total / 4 per scope) - the exact
# co-tenancy #2847 names as a contaminant to control for.
#
# ---------------------------------------------------------------------------
# THE HYPOTHESIS THIS RUN FALSIFIES
# ---------------------------------------------------------------------------
# #2847 argues the destination's own rate limit, not the lane cap, may be the
# real ceiling - and that raising `OL_LANE_REALTIME_SCOPE_CAP` would then do
# nothing, the opposite of what anyone tries first. The crossover arithmetic
# it states:
#
#   lane ceiling per source connection = 120 / D orders/min   (perScope = 2)
#   destination ceiling                = 60/min / ~7 req per order = ~8.6/min
#   crossover                          = D ~= 14s
#
# Above D = 14s the lane binds whatever the destination allows; below it, the
# destination can. This scenario runs three throughput arms in order and
# reports which moved the number:
#
#   1. baseline                 defaults on both
#   2. destination raised       config.rateLimit lifted well past 60/min
#   3. lane raised              OL_LANE_REALTIME_SCOPE_CAP lifted too
#
# All three run, unconditionally. Arms 1 and 2 alone complete the
# falsification (moved => the destination was binding; did not move => the
# lane was), but they cannot answer the question that follows it - with the
# destination lifted, what binds NEXT? Arm 3 either moves the number again,
# naming the lane cap as the new ceiling, or it does not, in which case the
# report has to name whatever else is. Each arm's settings are recorded in
# its own manifest.
#
# Sources lib.sh (#2841) and drivers/order-feed.sh (this issue).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LIB_LOG_PREFIX="f1"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../drivers/order-feed.sh"

ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.lab}"

# ---------------------------------------------------------------------------
# Configuration (env-overridable, same convention as lib.sh/bootstrap.sh)
# ---------------------------------------------------------------------------
SOURCE_TENANT="${SOURCE_TENANT:-perf-allegro-a}"

# Serial latency arm: one order in flight at a time, so no hop is contaminated
# by queue wait behind another order. n is bounded by wall clock rather than
# by choice - see the summarizer's header for why every percentile it prints
# carries the rank it resolved to at this n.
LATENCY_SAMPLES="${LATENCY_SAMPLES:-25}"

# ---------------------------------------------------------------------------
# Scheduler-ON mode (#2840): hop A becomes a MEASUREMENT of the running
# scheduler instead of a cadence this script chose.
#
# Default OFF, so every existing F1 invocation is byte-identical to its
# pre-#2840 self. When ON:
#   - guard_scheduler_off is deliberately WAIVED and the waiver recorded;
#   - the three master sweeps are disabled, because their parents share the
#     `fan-out` lane with `marketplace.orders.poll` itself and that co-tenancy
#     is the contaminant #2847 names;
#   - every scheduler fact is read back from the worker's own startup log, and
#     the sample loop attributes a SCHEDULER-minted poll (never one of ours).
# ---------------------------------------------------------------------------
F1_SCHEDULER_ON="${F1_SCHEDULER_ON:-0}"
# The summarizer mode follows the flag, so hop A's label can never say
# "HARNESS-CHOSEN" on a run where it was measured, or vice versa.
if [ "$F1_SCHEDULER_ON" = "1" ]; then
  F1_SUMMARY_MODE=latency-scheduler-on
else
  F1_SUMMARY_MODE=latency
fi

# Throughput arms. The backlog is pushed in ONE request before the window
# opens, so the pusher can never be the bottleneck; the offered rate is then
# `min(OF_POLL_LIMIT, backlog) / POLL_CADENCE_SECS`.
#
# The backlog must outlast the window at the highest rate any arm might reach,
# or post_guard_feed_starved discards the run - which is the guard working,
# not an obstacle. Raise THROUGHPUT_BACKLOG and re-run if it fires.
THROUGHPUT_BACKLOG="${THROUGHPUT_BACKLOG:-900}"
THROUGHPUT_WINDOW_SECS="${THROUGHPUT_WINDOW_SECS:-300}"
POLL_CADENCE_SECS="${POLL_CADENCE_SECS:-10}"
PROGRESS_TICK_SECS="${PROGRESS_TICK_SECS:-5}"

# The WooCommerce arm is a REAL-SHOP measurement, not a throughput figure
# (#2847's own words), so it is deliberately small and serial - bounded by a
# sample COUNT rather than by a window, exactly like the latency arm. There is
# deliberately no WC_ARM_WINDOW_SECS knob: a knob that configures nothing is a
# false statement about what an operator can change.
WC_ARM_ORDERS="${WC_ARM_ORDERS:-12}"

# At least one successful order per worker PROCESS before any measured window,
# so the `line_prices` cold start is excluded. `PrestashopOpenlinkerModuleClient`
# learns that capability from a previous `importorder` response into a
# module-level Map keyed by connection id, so the first order after a worker
# restart takes the 27-request legacy `specific_prices` path instead of the
# 7-request one - a 3.4x difference, once per process
# (`prestashop-openlinker-module.client.ts`, and the adapter's own comment).
# Two per replica rather than one: the first also warms the currency, country
# and order-state caches, so a single warm-up would leave the FIRST measured
# order carrying the tail of that.
WARMUP_ORDERS_PER_REPLICA="${WARMUP_ORDERS_PER_REPLICA:-2}"

# The raised destination limit for the falsification arm. 6000/min and 32
# concurrent sit just inside `ConnectionService.validateRateLimitConfig`'s
# own bounds (1..6000 and 1..64) - deliberately far past anything the
# destination can absorb, because the question is whether the limiter binds
# at all, not where a second knee is.
RAISED_RPM="${RAISED_RPM:-6000}"
RAISED_CONCURRENT="${RAISED_CONCURRENT:-32}"
# The raised lane cap for arm 3. `OL_LANE_REALTIME_SCOPE_CAP` defaults to 2
# (`sync-job.runner.ts`); `OL_LANE_REALTIME_CAP` must rise with it or the
# lane-wide cap of 4 becomes the new binding constraint one level up.
RAISED_LANE_SCOPE_CAP="${RAISED_LANE_SCOPE_CAP:-16}"
RAISED_LANE_CAP="${RAISED_LANE_CAP:-16}"

# How much of a rate change counts as "the number moved". Two runs of the same
# arm on a contended workstation do not repeat exactly, so a threshold is
# needed; 15% is well outside the run-to-run spread this stand shows and well
# inside the several-fold change a genuinely-binding limiter would produce.
MOVED_THRESHOLD_PCT="${MOVED_THRESHOLD_PCT:-15}"

MODE="strict"
ARMS="all"
for arg in "$@"; do
  case "$arg" in
    --smoke) MODE="smoke" ;;
    --latency-only) ARMS="latency" ;;
    --throughput-only) ARMS="throughput" ;;
    -h|--help)
      cat <<'USAGE'
Usage: f1-order-ingestion.sh [--smoke | --latency-only | --throughput-only]

  (no flag)          strict measurement - every applicable #2841 guard runs,
                     the serial latency arm, three PrestaShop throughput arms
                     (the third only if the second did not move the rate), a
                     real-WooCommerce arm, and a dated report under results/.
  --latency-only     the serial latency arm alone.
  --throughput-only  the throughput arms alone.
  --smoke            driver self-test: one order end to end, the reconstructed
                     hops printed, the feed-backlog sensor exercised against
                     the live stub. No manifest, no verdict, nothing written
                     under results/.

Every knob is an env var - see the Configuration block at the top of this file.
USAGE
      exit 0
      ;;
    *) die "unknown argument: $arg (use --smoke, --latency-only, --throughput-only, --help, or nothing)" ;;
  esac
done

require_tools docker jq curl python3

[ -n "${ALLEGRO_A_CONNECTION_ID:-}" ] || die "ALLEGRO_A_CONNECTION_ID is not set - source stand-ids.env (bootstrap.sh) or export it by hand"
[ -n "${PS_CONNECTION_ID:-}" ] || die "PS_CONNECTION_ID is not set - source stand-ids.env"
[ -n "${WC_CONNECTION_ID:-}" ] || die "WC_CONNECTION_ID is not set - source stand-ids.env"
SOURCE_CONNECTION_ID="${SOURCE_CONNECTION_ID:-$ALLEGRO_A_CONNECTION_ID}"
CONN_IDS="'$SOURCE_CONNECTION_ID'"

# Claimed BEFORE any arrange step, not just before window_start: this scenario
# mutates shared stand state (both destinations' enabledCapabilities, the
# PrestaShop connection's rate limit, the worker's own runner posture and lane
# caps) well before the first window opens, and a peer racing any of it is
# exactly the failure guard_stand_exclusive exists to prevent (#2842/#2848).
guard_stand_exclusive "f1-order-ingestion"

ol_login

# ===========================================================================
# Stand posture captured for restore, and the single EXIT trap
#
# bash's EXIT trap is ONE slot, so a second `trap ... EXIT` REPLACES
# guard_stand_exclusive's own release and leaves the stand locked for the full
# TTL after any `die` - F7 found that the hard way and F4 records the fix.
# Everything that must be undone is undone from this one function.
# ===========================================================================
ORIGINAL_REPLICAS="$(discover_worker_containers | wc -w | tr -d ' ')"
[ "$ORIGINAL_REPLICAS" -ge 1 ] || ORIGINAL_REPLICAS=1
# Read from the RUNNING container, not from .env.lab: the file is a request,
# the container's environment is what is in force, and a peer may have flipped
# one without the other.
ORIGINAL_RUNNER_ENABLED="$(docker exec "$(discover_worker_containers | awk '{print $1}')" printenv WORKER_RUNNER_ENABLED 2>/dev/null || printf '')"
[ -n "$ORIGINAL_RUNNER_ENABLED" ] || ORIGINAL_RUNNER_ENABLED=false
ORIGINAL_SCHEDULER_ENABLED="$(docker exec "$(discover_worker_containers | awk '{print $1}')" printenv OL_SCHEDULER_ENABLED 2>/dev/null || printf '')"
[ -n "$ORIGINAL_SCHEDULER_ENABLED" ] || ORIGINAL_SCHEDULER_ENABLED=false

connection_json() { ol_api GET "/v1/connections/$1"; }

ORIGINAL_PS_CAPS="$(connection_json "$PS_CONNECTION_ID" | jq -c '.enabledCapabilities // []')"
ORIGINAL_WC_CAPS="$(connection_json "$WC_CONNECTION_ID" | jq -c '.enabledCapabilities // []')"
ORIGINAL_PS_CONFIG="$(connection_json "$PS_CONNECTION_ID" | jq -c '.config // {}')"
ORIGINAL_WC_CONFIG="$(connection_json "$WC_CONNECTION_ID" | jq -c '.config // {}')"
log "posture at start: replicas=$ORIGINAL_REPLICAS runner=$ORIGINAL_RUNNER_ENABLED"
log "  perf-prestashop caps=$ORIGINAL_PS_CAPS rateLimit=$(printf '%s' "$ORIGINAL_PS_CONFIG" | jq -c '.rateLimit // null')"
log "  perf-woocommerce caps=$ORIGINAL_WC_CAPS rateLimit=$(printf '%s' "$ORIGINAL_WC_CONFIG" | jq -c '.rateLimit // null')"

# A restore that CANNOT abort itself.
#
# Every helper in lib.sh reaches `die` on failure, and `die` calls `exit` - so
# `ol_login || true` does NOT contain it: the `||` sees a return code, and
# there is none, the shell is already leaving. Inside an EXIT trap that skips
# every later line, which here would be `release_stand_exclusive` and the
# stand would stay locked for the full hour. So the cleanup path uses raw
# curl, never `ol_login`/`ol_api`, and every call ends in `|| true`.
restore_curl() {
  local method="$1" path="$2" body="${3:-}"
  [ -n "${RESTORE_TOKEN:-}" ] || return 0
  curl -sS -o /dev/null -X "$method" "$OL_API_URL$path" \
    -H "Authorization: Bearer $RESTORE_TOKEN" -H 'Content-Type: application/json' \
    ${body:+-d "$body"} 2>/dev/null || true
}

# A RUN THAT CHANGED NOTHING MUST RESTORE NOTHING.
#
# These two flags exist because the restore below is not free: it PATCHes both
# connections and runs `docker compose up --no-deps worker`, which RECREATES
# the worker container. On a run that never got past `guard_stand_exclusive` -
# the common case on a contended stand, where a peer holds the lock - firing
# that would recreate the worker UNDERNEATH the scenario that legitimately
# holds the stand, killing its in-flight jobs and resetting its runner. That
# is precisely the cross-contamination the lock exists to prevent, arriving
# through the refused run's own cleanup path.
#
# Learned the hard way on this stand: an earlier F1 attempt recreated `api` and
# `worker` while a peer's F7 window was open.
CONNECTIONS_TOUCHED=0
WORKER_TOUCHED=0
SCHEDULER_TOUCHED=0

# Upsert one key into the stand's env file. Needed because compose substitutes
# `${VAR}` only for keys the worker service lists - the trap recorded on
# OL_JOB_INTAKE_DEDICATED_REDIS and on the lane caps. The three sweep keys were
# added to docker-compose.lab.yml by #2840 for exactly this reason; writing
# them here without that change would have set nothing.
f1_set_env_key() {
  local k="$1" v="$2"
  [ -f "$ENV_FILE" ] || die "f1_set_env_key: $ENV_FILE not found"
  if grep -q "^$k=" "$ENV_FILE"; then
    sed -i "s|^$k=.*|$k=$v|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"
  fi
}

f1_on_exit() {
  local rc=$?
  # FIRST, before anything that can block or fail: a leaked sampler keeps
  # querying Postgres and appending samples forever (#2840).
  sampler_stop_if_running || true
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
    if [ -f "$ENV_FILE" ]; then
      sed -i "s/^WORKER_RUNNER_ENABLED=.*/WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED/" "$ENV_FILE" 2>/dev/null || true
      # Left over from the pre-#2847 mechanism, which wrote the caps here and
      # achieved nothing. Cleared so a stand never carries a dead knob that
      # looks live.
      sed -i '/^OL_LANE_REALTIME_CAP=/d; /^OL_LANE_REALTIME_SCOPE_CAP=/d' "$ENV_FILE" 2>/dev/null || true
      # #2840: put the scheduler back where it was and REMOVE the sweep keys
      # entirely rather than writing 'true' into them. They were absent before
      # this run, and a stand left carrying an explicit knob a peer did not set
      # is the same class of contamination as leaving the scheduler on.
      if [ "$SCHEDULER_TOUCHED" = "1" ]; then
        sed -i "s/^OL_SCHEDULER_ENABLED=.*/OL_SCHEDULER_ENABLED=$ORIGINAL_SCHEDULER_ENABLED/" "$ENV_FILE" 2>/dev/null || true
        sed -i '/^OL_PRODUCT_SYNC_ENABLED=/d; /^OL_INVENTORY_SYNC_ENABLED=/d; /^OL_MASTER_PRODUCT_RECONCILE_ENABLED=/d' "$ENV_FILE" 2>/dev/null || true
      fi
    fi
    # The override must go BEFORE the recreate, or the restored worker keeps
    # whatever lane caps the last arm asked for.
    rm -f "$LANE_OVERRIDE_FILE"
    ( cd "$REPO_ROOT" && docker compose -f docker-compose.lab.yml --env-file .env.lab -p lab \
        up -d --no-deps --scale "worker=$ORIGINAL_REPLICAS" worker >/dev/null 2>&1 ) \
      || warn "could not restore the worker posture - the stand is left at whatever the last arm set (replicas: [$(discover_worker_containers)])"
  fi
  release_stand_exclusive
  return $rc
}
trap f1_on_exit EXIT

# ===========================================================================
# Arrange helpers
# ===========================================================================

# set_destination <connection_id> <on|off>
#
# Toggles `OrderProcessorManager` in `enabledCapabilities` rather than flipping
# the connection's `status`. Both would work - `resolveDestinations` reads
# `listCapabilityAdapters`, which is active-only AND capability-filtered - but
# a status flip has a side effect this scenario does not want: transitioning a
# connection back INTO `active` fires `ConnectionService`'s taxonomy-sync
# bootstrap (#2084/#2085), enqueueing a `destination.taxonomy.sync` job into a
# stand this run is trying to keep quiet. A capability edit has no such hook.
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

# set_rate_limit <connection_id> <rpm|"default"> [max_concurrent]
#
# `config` is patched as a WHOLE object, never as a partial: `ConnectionService`
# shallow-spreads it (the #2016 note), so sending `{rateLimit: ...}` alone
# would drop `baseUrl`/`shopId`/`siteUrl` and leave the connection unusable.
# The current config is therefore read back and merged.
#
# "default" DELETES the key rather than writing some number that happens to
# match the manifest's - the resolution order is `config.rateLimit ??
# manifest.defaultRateLimit ?? {}` (`http-transport-factory.ts`), and an
# explicit value that equals the default is a different persisted state from
# an absent one, which is exactly the distinction the falsification depends on.
set_rate_limit() {
  local conn="$1" rpm="$2" concurrent="${3:-$RAISED_CONCURRENT}" cfg
  cfg="$(connection_json "$conn" | jq -c '.config // {}')"
  if [ "$rpm" = "default" ]; then
    cfg="$(printf '%s' "$cfg" | jq -c 'del(.rateLimit)')"
  else
    cfg="$(printf '%s' "$cfg" | jq -c --argjson r "$rpm" --argjson c "$concurrent" \
      '.rateLimit = {requestsPerMinute:$r, maxConcurrent:$c}')"
  fi
  CONNECTIONS_TOUCHED=1
  ol_api PATCH "/v1/connections/$conn" "$(jq -n --argjson g "$cfg" '{config:$g}')" >/dev/null
  log "set_rate_limit $conn -> $(printf '%s' "$cfg" | jq -c '.rateLimit // "manifest default"')"
}

# The compose override this scenario writes to carry lane-cap changes.
#
# WHY AN OVERRIDE FILE AND NOT `.env.lab` (#2847, found the hard way)
#
# The first version of `recreate_worker` wrote `OL_LANE_REALTIME_SCOPE_CAP=16`
# into `.env.lab` and recreated the worker. That does NOTHING. An entry in an
# env-file is available for `${VAR}` INTERPOLATION inside the compose file; it
# is not passed to the container unless the service's own `environment:` block
# names it, and `docker-compose.lab.yml`'s worker service does not name either
# lane variable. Verified live: `docker exec lab-worker-1 printenv
# OL_LANE_REALTIME_SCOPE_CAP` was empty and the runner's own startup line still
# read `realtime=4/2` for an arm whose whole purpose was to raise it. The arm
# silently measured the configuration it was supposed to be varying against.
#
# An override file declares the variables on the service, which is what
# actually forwards them - and it lives in this scenario rather than in
# `docker-compose.lab.yml`, so #2854's shared stand file is untouched and a
# stand that never runs F1 never carries the knobs.
LANE_OVERRIDE_FILE="${LANE_OVERRIDE_FILE:-$REPO_ROOT/.f1-lane-override.yml}"

# recreate_worker <runner:true|false> [lane_scope_cap] [lane_cap]
#
# Same shape as F4's `scale_workers` (and for the same reasons - `--no-deps`
# keeps the blast radius to the worker; the discovery cache in lib.sh is stale
# by construction afterwards and must be re-resolved; `grep -c` not `grep -q`
# on the startup line, because `-q` closes the pipe and `set -o pipefail` then
# fails the whole pipeline even though the line matched).
#
# Passing an empty cap removes the override entirely, restoring the runner's
# own defaults rather than pinning them to whatever this script believes they
# are - the runner is the authority on its defaults.
#
# AND IT VERIFIES. See `assert_lane_caps` below: a scenario that silently
# measures a configuration it did not request is the worst failure this
# harness has, and it is exactly the reported-versus-enforced gap the rest of
# the programme keeps closing (#2229's rule). Asking is not the same as
# getting, so the runner's own reported caps are read back and compared.
recreate_worker() {
  local runner="$1" scope_cap="${2:-}" lane_cap="${3:-}" tries w hits found
  WORKER_TOUCHED=1
  [ -f "$ENV_FILE" ] || die "recreate_worker: $ENV_FILE not found - this scenario recreates the worker service, which needs the stand's own env file"
  if grep -q '^WORKER_RUNNER_ENABLED=' "$ENV_FILE"; then
    sed -i "s/^WORKER_RUNNER_ENABLED=.*/WORKER_RUNNER_ENABLED=$runner/" "$ENV_FILE"
  else
    printf 'WORKER_RUNNER_ENABLED=%s\n' "$runner" >> "$ENV_FILE"
  fi

  local compose_args=(-f docker-compose.lab.yml)
  rm -f "$LANE_OVERRIDE_FILE"
  if [ -n "$scope_cap" ]; then
    cat > "$LANE_OVERRIDE_FILE" <<YAML
# Written by scenarios/f1-order-ingestion.sh (#2847). Removed when the
# scenario restores the worker. Declares the lane-cap variables on the worker
# service so compose actually forwards them - an .env.lab entry alone does not.
services:
  worker:
    environment:
      OL_LANE_REALTIME_SCOPE_CAP: '$scope_cap'
      OL_LANE_REALTIME_CAP: '${lane_cap:-$scope_cap}'
YAML
    compose_args+=(-f "$LANE_OVERRIDE_FILE")
  fi

  ( cd "$REPO_ROOT" && docker compose "${compose_args[@]}" --env-file .env.lab -p lab \
      up -d --no-deps --scale "worker=$ORIGINAL_REPLICAS" worker >/dev/null 2>&1 ) \
    || die "recreate_worker: compose refused to recreate the worker service"

  WORKER_CONTAINERS=""
  WORKER_CONTAINERS_RESOLVED=0
  _ensure_worker_containers
  found="$(discover_worker_containers | wc -w | tr -d ' ')"
  [ "$found" -eq "$ORIGINAL_REPLICAS" ] || die "recreate_worker: expected $ORIGINAL_REPLICAS replica(s), discovery found $found"

  if [ "$runner" = "true" ]; then
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
    assert_lane_caps "$scope_cap" "${lane_cap:-$scope_cap}"
  else
    sleep 5
  fi
  log "worker recreated: runner=$runner replicas=$ORIGINAL_REPLICAS lane scope cap=${scope_cap:-<runner default>}"
}

# assert_lane_caps <expected_scope_cap|""> <expected_lane_cap|"">
#
# Reads the caps the RUNNER ITSELF reports on its startup line and refuses to
# continue unless they are the caps that were requested. Empty expectations
# mean "the runner's own defaults", which cannot be asserted against a number
# this script invents - so that case only records what was found.
assert_lane_caps() {
  local want_scope="$1" want_lane="$2" w line caps got_total got_scope
  for w in $WORKER_CONTAINERS; do
    line="$(docker logs "$w" 2>&1 | grep -F 'Starting sync job runner loop' | tail -1 || true)"
    caps="$(printf '%s' "$line" | grep -oP 'realtime=\K[0-9]+/[0-9]+' || true)"
    [ -n "$caps" ] || die "assert_lane_caps: could not parse realtime lane caps out of $w's startup line: $line"
    got_total="${caps%%/*}"; got_scope="${caps##*/}"
    if [ -n "$want_scope" ]; then
      [ "$got_scope" = "$want_scope" ] || die \
"assert_lane_caps: asked for OL_LANE_REALTIME_SCOPE_CAP=$want_scope but $w reports realtime=$caps.
  The request did not reach the container. An .env.lab entry alone does NOT forward a
  variable - the service's own \`environment:\` block must name it, which is what
  \$LANE_OVERRIDE_FILE exists to do. Refusing to measure a configuration that was not applied."
      [ "$got_total" = "$want_lane" ] || die \
"assert_lane_caps: asked for OL_LANE_REALTIME_CAP=$want_lane but $w reports realtime=$caps"
    fi
    log "assert_lane_caps: $w reports realtime=$caps${want_scope:+ (requested $want_lane/$want_scope)}"
  done
}

# ===========================================================================
# Observation helpers - every one reads persisted state, never a log line
# ===========================================================================

# The sync_jobs projection every sample reads.
#
# No COALESCE on the nullable columns, deliberately: `psql -tA` renders NULL
# as an EMPTY FIELD by default, which is exactly what the CSV and the
# summarizer already treat as "not observed". An earlier draft wrapped each
# one in `COALESCE(..., \x27\x27)` inside a single-quoted bash string, where
# `\x27` is six literal characters rather than a quote - the SQL was malformed,
# psql printed nothing, and every sample reported NO_POLL_ROW for a poll job
# that had in fact succeeded. Fewer quotes is the fix, not better escaping.
#
# ---------------------------------------------------------------------------
# `lockedAt` MUST BE LATCHED WHILE THE JOB RUNS - IT IS GONE AFTERWARDS
# ---------------------------------------------------------------------------
# `SyncJobRepository.markSucceeded` sets `lockedAt: null, lockedBy: null`
# alongside `status: 'succeeded'`. So a job read after it finishes - which is
# every job a latency sample cares about - carries NO claim instant at all.
# #2847's own caveat table names the heartbeat rewrite as `lockedAt`'s problem
# and does not mention this one, which is the larger of the two: a
# reconstruction that read the column at the end would report hops B, D, E and
# G as "never observed" on every single sample, and the run would look like a
# rig fault rather than a wrong column.
#
# Two independent sources are therefore captured, and the summarizer reports
# which one answered for each row:
#
#  (1) LATCHED - the sample's own poll loops record the first non-empty
#      `lockedAt` they see while the job is still `running`. A real
#      observation, but it can be missed entirely when a job starts and
#      finishes inside one 1-second poll tick (the poll job, at ~300ms, often
#      does).
#  (2) DERIVED - `updatedAt - lastAttemptDurationMs`. `lastAttemptDurationMs`
#      is the RUNNER's own measurement of the attempt (`Date.now() -
#      attemptStartedAt`, stamped by the same UPDATE that sets `updatedAt`),
#      so for a single-attempt job this is exact and, unlike `lockedAt`,
#      immune to the 3-minute heartbeat rewrite as well.
JOB_COLS='"createdAt", "lockedAt", "updatedAt", status, outcome, attempts, "lastAttemptDurationMs"'

job_row_by_key() {
  pg_sql "SELECT $JOB_COLS FROM sync_jobs WHERE \"idempotencyKey\"='$1'"
}

# The payload column is `payloadJson` (jsonb), NOT `payload` - there is no
# column of that name and psql answers `ERROR: column "payload" does not
# exist`. `pg_sql` does not die on a query error, so the row read simply came
# back EMPTY and every sample reported NO_CHILD for a child job that existed
# and had already created its order at the shop. A wrong column name is
# indistinguishable from a missing row through this seam, which is why the
# --smoke path exists.
child_row_for_order() {
  pg_sql "SELECT $JOB_COLS FROM sync_jobs
          WHERE \"jobType\"='marketplace.order.sync'
            AND \"connectionId\"='$SOURCE_CONNECTION_ID'
            AND \"payloadJson\"->>'externalOrderId'='$1'
          ORDER BY \"createdAt\" DESC LIMIT 1"
}

# The internal order id OpenLinker minted for a source-native checkout-form id.
# Read through identifier_mappings rather than guessed - the mapping IS how
# every other consumer resolves it.
internal_order_id() {
  pg_sql "SELECT \"internalId\" FROM identifier_mappings
          WHERE \"entityType\"='Order' AND \"connectionId\"='$SOURCE_CONNECTION_ID' AND \"externalId\"='$1'"
}

# order_records.createdAt plus the declared destination's own syncedAt.
# The syncStatus element is selected BY destinationConnectionId, never by
# array position: `updateSyncStatus` rebuilds the array drop-then-append, so
# position is not stable across destinations.
record_row() {
  local internal_id="$1" dest="$2"
  pg_sql "SELECT \"createdAt\",
                 COALESCE((SELECT e->>'syncedAt' FROM jsonb_array_elements(\"syncStatus\") e
                           WHERE e->>'destinationConnectionId'='$dest' LIMIT 1),''),
                 COALESCE((SELECT e->>'status' FROM jsonb_array_elements(\"syncStatus\") e
                           WHERE e->>'destinationConnectionId'='$dest' LIMIT 1),''),
                 \"recordStatus\"
          FROM order_records WHERE \"internalOrderId\"='$internal_id'"
}

poll_until() {
  local desc="$1" max_wait="$2"; shift 2
  local waited=0 out
  while [ "$waited" -lt "$max_wait" ]; do
    out="$("$@" 2>/dev/null || true)"
    if [ -n "$out" ]; then printf '%s' "$out"; return 0; fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

# ===========================================================================
# The serial latency arm
# ===========================================================================
# The POLL job carries its own attempts/duration columns for the same reason
# the child does: without them the summarizer cannot DERIVE a claim instant
# for it (`updatedAt - lastAttemptDurationMs`), and since `markSucceeded`
# nulls `lockedAt`, a poll job whose ~300ms run slipped between two 1-second
# latch polls would have no claim instant at all - leaving hops B and C
# permanently n=0. Found by running the summarizer against a synthetic sample
# set before the real run, which is exactly what that dry run was for.
LATENCY_HEADER='sample,checkout_form_id,pushed_at_utc,poll_key,poll_created_utc,poll_locked_utc,poll_updated_utc,poll_status,poll_outcome,poll_attempts,poll_attempt_duration_ms,child_created_utc,child_locked_utc,child_updated_utc,child_status,child_outcome,child_attempts,child_attempt_duration_ms,internal_order_id,record_created_utc,record_status,synced_at_utc,dest_sync_status'

SAMPLE_MAX_WAIT_SECS="${SAMPLE_MAX_WAIT_SECS:-120}"

# ---------------------------------------------------------------------------
# Scheduler readback (#2840). Copied in shape from
# scenarios/sustained-mixed-load.sh's mixed_wait_for_scheduler: the resolved
# task inventory is read out of the worker's OWN startup log, never inferred
# from the code's defaults or from the env, because "a scenario that silently
# measures a configuration it did not request is the worst failure mode this
# harness has" (this file's own header).
#
# `grep -c`, never `grep -q`: grep -q exits at its first match and closes the
# pipe while `docker logs` is still writing, so docker logs dies of SIGPIPE and
# `set -o pipefail` reports the pipeline failed even though the line matched -
# length-dependent, so it passes on a short log and starts failing once the
# worker has been up a while (#2851).
# ---------------------------------------------------------------------------
F1_SCHED_TASKS=""
F1_POLL_CRON=""
F1_POLL_PERIOD_SECS=60

f1_wait_for_scheduler() {
  local w tries hits
  for w in $WORKER_CONTAINERS; do
    tries=0
    while :; do
      hits="$(docker logs "$w" 2>&1 | grep -c -F 'Registered scheduler task:' || true)"
      [ "${hits:-0}" -eq 0 ] || break
      tries=$((tries + 1))
      [ "$tries" -lt 30 ] || die "f1_wait_for_scheduler: no 'Registered scheduler task:' line on [$w] within 150s.
  This mode's entire premise is that the scheduler is ON, so a run whose
  scheduler registered nothing measures the opposite of what it claims.
  The scheduler is a fleet singleton behind a Redis lease; check:
    docker exec -i \$REDIS_CONTAINER redis-cli GET singleton:scheduler"
      sleep 5
    done
  done
  F1_SCHED_TASKS="$(for w in $WORKER_CONTAINERS; do
      docker logs "$w" 2>&1 | grep -F 'Registered scheduler task:' \
        | sed 's/.*Registered scheduler task: //' | sed 's/\x1b\[[0-9;]*m//g'
    done | sort -u)"
  printf '%s' "$F1_SCHED_TASKS"
}

# AC2, enforced in code. Returns non-zero (die) rather than warning, because a
# window that ran with the catalogue sweeps live is DISCARDED for co-tenancy -
# it must never be quietly reported as if the sweeps were off.
f1_assert_scheduler_inventory() {
  local tasks="$1" poll_line cron bad=""
  poll_line="$(printf '%s\n' "$tasks" | grep -F 'jobType: marketplace.orders.poll' | head -1 || true)"
  [ -n "$poll_line" ] || die "f1_assert_scheduler_inventory (AC2): the scheduler registered no marketplace.orders.poll task at all.
  Registered inventory was:
$tasks"
  # Keep the RAW expression for the report (it is quoted there verbatim) and
  # compare against a whitespace-stripped copy, so "*/1 * * * *" does not get
  # reported as "*/1****".
  cron="$(printf '%s' "$poll_line" | sed -n 's/.*cron: \([^)]*\)).*/\1/p')"
  local cron_cmp; cron_cmp="$(printf '%s' "$cron" | tr -d '[:space:]')"
  {
    case "$cron_cmp" in
      '*/1'*) : ;;
      *) die "f1_assert_scheduler_inventory (AC2): marketplace.orders.poll resolved cron [$cron], not */1. AC3's [0s,60s] hop-A band is void at any other cadence.
  Line was: $poll_line" ;;
    esac
  }
  local jt
  for jt in master.product.syncAll master.inventory.syncAll master.product.reconcile; do
    if printf '%s\n' "$tasks" | grep -qF "jobType: $jt"; then
      bad="$bad $jt"
    fi
  done
  [ -z "$bad" ] || die "f1_assert_scheduler_inventory (AC2): these master sweeps are STILL REGISTERED despite being disabled:$bad
  Their parents share the fan-out lane with marketplace.orders.poll, so this
  window would measure uncontrolled co-tenancy. DISCARDED rather than reported.
  If the env keys were set but did not take, check that docker-compose.lab.yml's
  worker service LISTS them - compose substitutes \${VAR} only for keys the
  service itself carries, which is why #2840 had to add them."
  F1_POLL_CRON="$cron"
  # The period, derived from the cron's minute field, is what the push jitter
  # below is drawn from. Derived rather than hardcoded to 60 so the jitter
  # cannot silently stop covering the period if the cadence is ever changed.
  local minute_field; minute_field="$(printf '%s' "$cron" | awk '{print $1}')"
  case "$minute_field" in
    '*/'[0-9]*) F1_POLL_PERIOD_SECS=$(( ${minute_field#*/} * 60 )) ;;
    '*')        F1_POLL_PERIOD_SECS=60 ;;
    *)          F1_POLL_PERIOD_SECS=60
                warn "could not derive a poll period from cron minute field [$minute_field]; jitter falls back to 60s" ;;
  esac
  log "AC2 ok: marketplace.orders.poll at cron [$cron]; none of master.product.syncAll / master.inventory.syncAll / master.product.reconcile registered"
}

# The scheduler-minted poll for this connection, as opposed to one of ours.
#
# The scheduler's key is `marketplace:{connId}:orders:poll:{timestamp}` where
# `timestamp` is scheduler.service.ts:702's `YYYY-MM-DD-HH-mm` - a FORMATTED
# DATE, not an epoch. Ours (of_enqueue_poll) is
# `marketplace:{connId}:orders:poll:{tag}:{epoch_ms}`.
#
# The first version of this matched `[0-9]+$` on the assumption that the
# scheduler's tail was an epoch. It matched ZERO rows while the scheduler was
# minting a poll every minute, and the run spent 150s per sample waiting for a
# poll that was already there - the "reads with a time format that silently
# matches nothing" failure this campaign has already recorded once. It is
# pinned in both directions before use (a real scheduler key must match, and
# all 353 harness keys on this stand must not), because a regex that matches
# nothing is indistinguishable from a scheduler that is not running.
F1_SCHED_POLL_RE=""
f1_sched_poll_re() {
  printf '^marketplace:%s:orders:poll:[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}$' "$SOURCE_CONNECTION_ID"
}

# First scheduler poll enqueued at or after an instant.
f1_first_sched_poll_key_since() {
  pg_sql "SELECT \"idempotencyKey\" FROM sync_jobs
          WHERE \"jobType\"='marketplace.orders.poll'
            AND \"connectionId\"='$SOURCE_CONNECTION_ID'
            AND \"idempotencyKey\" ~ '$F1_SCHED_POLL_RE'
            AND \"createdAt\" >= '$1'
          ORDER BY \"createdAt\" ASC LIMIT 1"
}

# The poll that actually DISCOVERED a child: the newest scheduler poll enqueued
# at or before the child's own createdAt. The child is created inside the poll
# handler's run, so this is the true discoverer even in the ~0.5%-of-a-minute
# edge case where an already-running poll picks the order up and the "next tick"
# poll is not the one that found it.
f1_discovering_poll_key() {
  pg_sql "SELECT \"idempotencyKey\" FROM sync_jobs
          WHERE \"jobType\"='marketplace.orders.poll'
            AND \"connectionId\"='$SOURCE_CONNECTION_ID'
            AND \"idempotencyKey\" ~ '$F1_SCHED_POLL_RE'
            AND \"createdAt\" <= '$1'
          ORDER BY \"createdAt\" DESC LIMIT 1"
}

# run_one_sample <n> <dest_connection_id> <out_csv>
run_one_sample() {
  local n="$1" dest="$2" out="$3"
  local pushed_at cf_id poll_key
  local poll_created poll_locked poll_updated poll_status poll_outcome poll_attempts poll_dur
  local child_created child_locked child_updated child_status child_outcome child_attempts child_dur
  local internal_id rec_created synced_at dest_status rec_status

  # ---------------------------------------------------------------------
  # PUSH JITTER (#2840). Without it this arm's hop A is a CONSTANT, not a
  # sample of the poll wait, and the constant is the wrong number.
  #
  # A serial sample pushed at offset t within the cron period waits (P - t)
  # for the next poll, then spends L in the ladder, so the NEXT push lands at
  # offset (t + (P - t) + L) mod P = L - independent of t. The loop therefore
  # locks onto offset L after a single sample and every hop A afterwards is
  # (P - L), forever.
  #
  # Measured, before this existed: samples 2, 3 and 4 pushed at :06, :06 and
  # :06 and waited 53.7s, 53.6s and 53.6s. Reporting that median as the poll
  # wait would have overstated it by ~24s against the true uniform-arrival
  # mean of P/2, and a buyer's order does not arrive in step with our cron.
  #
  # Drawing the delay uniformly from [0, P) breaks the lock and makes the
  # sample an actual sample. $RANDOM is 0..32767 so `% P` carries ~0.2% modulo
  # bias at P=60, which is far below the resolution of anything reported here.
  # ---------------------------------------------------------------------
  if [ "$F1_SCHEDULER_ON" = "1" ]; then
    local jitter=$(( RANDOM % F1_POLL_PERIOD_SECS ))
    log "sample $n: jittering ${jitter}s before the push (uniform over the ${F1_POLL_PERIOD_SECS}s poll period, to decorrelate the push from the cron)"
    sleep "$jitter"
  fi

  # Push ONE order and take the source-side instant from the stub's own
  # response, not from before the call: the order does not exist until the
  # stub says it minted it.
  local resp
  resp="$(of_curl POST "/__stub/tenants/$SOURCE_TENANT/orders" '{"count":1,"lineItemsPerOrder":1,"eventsPerOrder":1}')"
  pushed_at="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
  cf_id="$(printf '%s' "$resp" | jq -r '.minted[0].checkoutFormId // empty')"
  [ -n "$cf_id" ] || { warn "sample $n: stub minted no checkout form: $resp"; return 0; }

  local row
  if [ "$F1_SCHEDULER_ON" = "1" ]; then
    # HOP A IS THE MEASUREMENT HERE. We enqueue nothing; we wait for the
    # scheduler's own next `marketplace.orders.poll` to be minted, which is the
    # wait a real deployment's buyer experiences.
    #
    # The 0.2s cadence is not politeness: the poll runs in ~300ms, and lockedAt
    # exists only while it runs (markSucceeded nulls it), so a 1s loop would
    # miss the latch on nearly every sample and push every claim-instant onto
    # the derived path. Both paths are supported and the summarizer prints the
    # split, but observing it is strictly better than reconstructing it.
    # Bounded by WALL CLOCK, not by an iteration count. The first version
    # counted 750 iterations of `sleep 0.2` and called it 150s, but each
    # iteration also runs a `docker exec` psql (~100ms), so the real bound was
    # ~225s and the timeout took half again as long as advertised to surface.
    # A deadline cannot drift when the cost of the loop body changes.
    local poll_deadline=$(( $(epoch) + ${F1_POLL_WAIT_MAX_SECS:-150} ))
    poll_key=""
    while [ "$(epoch)" -lt "$poll_deadline" ]; do
      poll_key="$(f1_first_sched_poll_key_since "$pushed_at" 2>/dev/null | tr -d '[:space:]')"
      [ -z "$poll_key" ] || break
      sleep 0.5
    done
    if [ -z "$poll_key" ]; then
      # Reports the OBSERVATION, not a diagnosis. The first version said "the
      # scheduler is not firing", which was a cause it could not know and in
      # fact the wrong one - the scheduler was firing every minute and the
      # matcher was broken.
      warn "sample $n: no poll row matching the scheduler key shape [$F1_SCHED_POLL_RE] was created in the ${F1_POLL_WAIT_MAX_SECS:-150}s after the push. Either the scheduler is not minting polls for this connection, or the key shape above no longer matches the one it mints."
      printf '%s,%s,%s,,,,,NO_SCHED_POLL,,,,,,,,,,,,,,,\n' "$n" "$cf_id" "$pushed_at" >> "$out"
      return 0
    fi
    row="$(job_row_by_key "$poll_key")"
  else
  poll_key="$(of_enqueue_poll "$SOURCE_CONNECTION_ID" "lat$n")"

  row="$(poll_until "poll job row for $poll_key" 30 job_row_by_key "$poll_key")" || {
    warn "sample $n: the poll job never produced a sync_jobs row (slow intake?)"
    # 23 columns: 4 written, cols 5-7 empty, col 8 the marker, cols 9-23 empty.
    printf '%s,%s,%s,%s,,,,NO_POLL_ROW,,,,,,,,,,,,,,,\n' "$n" "$cf_id" "$pushed_at" "$poll_key" >> "$out"
    return 0
  }
  fi
  IFS='|' read -r poll_created poll_locked poll_updated poll_status poll_outcome poll_attempts poll_dur <<< "$row"
  # LATCH: `markSucceeded` nulls lockedAt, so the value only exists while the
  # job is running. First non-empty reading wins and is never overwritten -
  # both because a later reading is a heartbeat rewrite rather than the claim,
  # and because the terminal reading is NULL and would erase it.
  local poll_locked_latched="$poll_locked"

  # Wait for the poll to finish before reading its updatedAt - a read that
  # lands while it is still `running` would report an unfinished hop C.
  local waited=0
  while [ "$waited" -lt 30 ] && [ "$poll_status" != "succeeded" ] && [ "$poll_status" != "dead" ]; do
    sleep 1; waited=$((waited + 1))
    row="$(job_row_by_key "$poll_key" 2>/dev/null || true)"
    IFS='|' read -r poll_created poll_locked poll_updated poll_status poll_outcome poll_attempts poll_dur <<< "$row"
    [ -n "$poll_locked_latched" ] || poll_locked_latched="$poll_locked"
  done

  row="$(poll_until "child job for $cf_id" 30 child_row_for_order "$cf_id")" || {
    warn "sample $n: no marketplace.order.sync child for $cf_id - the poll did not discover it (a stale cursor, or the per-connection poll lock skipped this tick)"
    # 23 columns: 11 written, cols 12-14 empty, col 15 the marker, 16-23 empty.
    printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,,,,NO_CHILD,,,,,,,,\n' \
      "$n" "$cf_id" "$pushed_at" "$poll_key" "$poll_created" "$poll_locked_latched" "$poll_updated" \
      "$poll_status" "$poll_outcome" "$poll_attempts" "$poll_dur" >> "$out"
    return 0
  }
  IFS='|' read -r child_created child_locked child_updated child_status child_outcome child_attempts child_dur <<< "$row"
  local child_locked_latched="$child_locked"

  # The poll that actually discovered this order need not be the first one
  # minted after the push: an already-running poll can pick an order up if it
  # reads the feed after the stub minted it. Re-attribute from the child's own
  # createdAt and record when the two disagree, rather than assuming they
  # cannot - the disagreement is a real (small) fraction of a */1 minute, and
  # reporting a hop A measured against the wrong poll would be a quiet lie.
  if [ "$F1_SCHEDULER_ON" = "1" ] && [ -n "$child_created" ]; then
    local disc_key
    disc_key="$(f1_discovering_poll_key "$child_created" 2>/dev/null | tr -d '[:space:]')"
    if [ -n "$disc_key" ] && [ "$disc_key" != "$poll_key" ]; then
      printf '%s\t%s\t%s\treattributed\n' "$n" "$poll_key" "$disc_key" >> "$(dirname "$out")/poll-attribution.tsv"
      poll_key="$disc_key"
      local prow; prow="$(job_row_by_key "$poll_key")"
      IFS='|' read -r poll_created poll_locked poll_updated poll_status poll_outcome poll_attempts poll_dur <<< "$prow"
      poll_locked_latched="$poll_locked"
    else
      printf '%s\t%s\t%s\tnext-tick\n' "$n" "$poll_key" "${disc_key:-none}" >> "$(dirname "$out")/poll-attribution.tsv"
    fi
  fi

  waited=0
  while [ "$waited" -lt "$SAMPLE_MAX_WAIT_SECS" ] && [ "$child_status" != "succeeded" ] && [ "$child_status" != "dead" ]; do
    sleep 1; waited=$((waited + 1))
    row="$(child_row_for_order "$cf_id" 2>/dev/null || true)"
    IFS='|' read -r child_created child_locked child_updated child_status child_outcome child_attempts child_dur <<< "$row"
    [ -n "$child_locked_latched" ] || child_locked_latched="$child_locked"
  done

  internal_id="$(internal_order_id "$cf_id" 2>/dev/null || true)"
  rec_created=""; synced_at=""; dest_status=""; rec_status=""
  if [ -n "$internal_id" ]; then
    row="$(record_row "$internal_id" "$dest" 2>/dev/null || true)"
    IFS='|' read -r rec_created synced_at dest_status rec_status <<< "$row"
  fi

  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$n" "$cf_id" "$pushed_at" "$poll_key" \
    "$poll_created" "$poll_locked_latched" "$poll_updated" "$poll_status" "$poll_outcome" "$poll_attempts" "$poll_dur" \
    "$child_created" "$child_locked_latched" "$child_updated" "$child_status" "$child_outcome" "$child_attempts" "$child_dur" \
    "${internal_id:-}" "${rec_created:-}" "${rec_status:-}" "${synced_at:-}" "${dest_status:-}" >> "$out"

  log "sample $n: cf=$cf_id child=$child_status/$child_outcome att=$child_attempts dur=${child_dur:-?}ms synced=${synced_at:-NONE}"
}

# ===========================================================================
# The throughput arms
# ===========================================================================
PROGRESS_HEADER='epoch,iso,due_queued,running,completed,oldest_due_age_s,feed_backlog,available_work'

# progress_tick <out_csv> <window_start_iso>
#
# `available_work` is `feed_backlog + due_queued + running`, and it is the
# number post_guard_feed_starved consumes - NOT `feed_backlog` alone.
#
# The distinction is the guard's correctness, not bookkeeping. The poll pump
# reads a page of 100 every POLL_CADENCE_SECS, so a 900-order stub backlog is
# fully converted into queued child jobs inside about 90 seconds; from then on
# the stub reads EMPTY while OpenLinker is at its busiest. Passing the stub's
# backlog would discard every valid throughput run. `running` is included
# because a tick can legitimately land with the queue momentarily drained and
# every slot busy - that is a saturated system, the opposite of a starved one.
progress_tick() {
  local out="$1" ws_iso="$2" due running completed oldest backlog available
  due="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$SOURCE_CONNECTION_ID' AND status='queued' AND \"nextRunAt\"<=NOW()" 2>/dev/null || printf 0)"
  running="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$SOURCE_CONNECTION_ID' AND status='running'" 2>/dev/null || printf 0)"
  completed="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"jobType\"='marketplace.order.sync' AND \"connectionId\"='$SOURCE_CONNECTION_ID' AND status='succeeded' AND \"createdAt\">='$ws_iso'" 2>/dev/null || printf 0)"
  oldest="$(pg_sql "SELECT COALESCE(ROUND(EXTRACT(EPOCH FROM (NOW() - MIN(\"createdAt\")))),0) FROM sync_jobs WHERE \"connectionId\"='$SOURCE_CONNECTION_ID' AND status='queued' AND \"nextRunAt\"<=NOW()" 2>/dev/null || printf 0)"
  backlog="$(of_backlog "$SOURCE_TENANT" "$SOURCE_CONNECTION_ID" 2>/dev/null || printf 'unknown')"
  # An unreadable upstream makes AVAILABLE WORK unknown too, never just the
  # queue depth: the guard's contract is that `unknown` discards rather than
  # being read around, and silently substituting the queue depth here would
  # route around it one layer down.
  if [ "$backlog" = "unknown" ]; then
    available="unknown"
  else
    available=$(( backlog + ${due:-0} + ${running:-0} ))
  fi
  printf '%s,%s,%s,%s,%s,%s,%s,%s\n' "$(epoch)" "$(iso_now)" "${due:-0}" "${running:-0}" "${completed:-0}" "${oldest:-0}" "${backlog:-unknown}" "$available" >> "$out"
}

# The two background loops a throughput arm runs. Kept as separate PIDs rather
# than one interleaved loop because their cadences are independent - the poll
# pump's interval is the OFFERED-RATE knob and the sampler's is observation
# resolution, and folding them together would silently tie one to the other.
PUMP_PID=""
SAMPLER_PID=""

start_pump() {
  local tag="$1"
  ( while true; do
      # Called inside a COMMAND SUBSTITUTION, which is what contains a `die`.
      # `of_enqueue_poll` reaches `ol_api`, and `ol_api` dies on any non-2xx;
      # a direct call would take the pump's own subshell down with it and the
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
  for p in "$PUMP_PID" "$SAMPLER_PID"; do
    [ -n "$p" ] || continue
    kill "$p" >/dev/null 2>&1 || true
    wait "$p" 2>/dev/null || true
  done
  PUMP_PID=""; SAMPLER_PID=""
}

# min_available_work <progress_csv>
#
# The minimum AVAILABLE WORK observed across the window (column 8), or
# `unknown` if ANY tick could not establish it. `unknown` wins over every
# number deliberately: a single unreadable tick means the run cannot show its
# instrument kept offering load, and post_guard_feed_starved treats that as a
# discard rather than reading around it.
min_available_work() {
  awk -F, 'NR>1 { v=$8; if (v=="unknown" || v=="") { print "unknown"; exit }
                  if (m=="" || v+0 < m) m=v+0 }
           END { if (m=="") print "unknown"; else printf "%d\n", m }' "$1"
}

# ===========================================================================
# --smoke
# ===========================================================================
run_smoke() {
  log "=== --smoke: one order end to end against the real PrestaShop destination ==="
  of_health | jq -c .
  log "stub config: $(of_config | jq -c '{runId, offerPoolSize, buyerPoolSize, latency}')"

  # The runner must be on for anything to happen. --smoke deliberately does
  # NOT recreate the worker: it is a rig self-test, and a smoke run that
  # rebuilds containers is not cheap enough to reach for casually.
  local runner
  runner="$(docker exec "$(discover_worker_containers | awk '{print $1}')" printenv WORKER_RUNNER_ENABLED 2>/dev/null || printf 'true')"
  [ "$runner" != "false" ] || die "--smoke needs the runner ENABLED; this stand has WORKER_RUNNER_ENABLED=false.
  Bring it up first:
    sed -i 's/^WORKER_RUNNER_ENABLED=.*/WORKER_RUNNER_ENABLED=true/' $ENV_FILE
    (cd $REPO_ROOT && docker compose -f docker-compose.lab.yml --env-file .env.lab -p lab up -d --no-deps worker)"

  of_new_run >/dev/null
  # RESETTING THE STUB'S RUN IS ONLY HALF OF IT - OL's own cursor must go too.
  #
  # `POST /__stub/run` restarts the stub's per-tenant sequence at 0 under a new
  # run id, but `connection_cursors` still holds the LAST run's head. The stub
  # cannot place a cursor from a run it no longer has, and its documented
  # behaviour for an unplaceable `from` is to treat the caller as already
  # caught up - so it answers with NO events and echoes the current head back.
  # The poll then succeeds with `fetched=0, enqueued=0` and the sample reports
  # NO_CHILD, which reads like a broken pipeline and is in fact a stale cursor.
  # Observed live before this line existed.
  reset_between_repeats "$CONN_IDS" "'$OF_CURSOR_KEY'"
  local tmp
  tmp="$(mktemp)"
  printf '%s\n' "$LATENCY_HEADER" > "$tmp"
  run_one_sample 0 "$PS_CONNECTION_ID" "$tmp"
  log "=== sample row ==="
  cat "$tmp"
  log "=== reconstructed hops ==="
  python3 "$SCRIPT_DIR/../drivers/f1-summarize.py" "$F1_SUMMARY_MODE" "$tmp" || true

  # THE FEED-BACKLOG SENSOR IS EXERCISED HERE, ON PURPOSE.
  # post_guard_feed_starved is a pure function of a number, so lib-test.sh can
  # prove the guard; only a live stand can prove the SENSOR that feeds it is
  # not structurally blind - which is this harness's other recurring failure
  # (post_guard_limiter_degraded answered "ok" on every run of this campaign
  # while unable to match a line, #2851). A sensor that reports a positive
  # backlog after a push and a smaller one after a drain is one that can see.
  log "=== feed-backlog sensor check ==="
  local before after
  before="$(of_backlog "$SOURCE_TENANT" "$SOURCE_CONNECTION_ID")"
  of_push_orders "$SOURCE_TENANT" 5 >/dev/null
  after="$(of_backlog "$SOURCE_TENANT" "$SOURCE_CONNECTION_ID")"
  log "backlog before pushing 5: $before   after: $after"
  case "$after" in
    unknown) die "of_backlog answered 'unknown' after a push - the sensor post_guard_feed_starved depends on cannot see, and every throughput arm would discard" ;;
  esac
  [ "$after" -gt "${before:-0}" ] 2>/dev/null \
    || die "of_backlog did not rise after pushing 5 orders ($before -> $after) - the sensor is blind, so post_guard_feed_starved would pass a starved run"
  log "feed-backlog sensor OK (rose by $((after - before)) after a 5-order push)"

  rm -f "$tmp"
  log "--smoke complete. Nothing was written under $RESULTS_ROOT."
}

# ===========================================================================
# strict
# ===========================================================================

# Everything a window needs that is not lib.sh's: the resolved poll cadences,
# the stub's own config, the identity mode, and the destination posture.
#
# The Allegro cadence is DERIVED, and labelled so. The scheduler is off, so
# nothing is "read from a running scheduler"; what is read is the worker's own
# environment (where #2279 moved the scheduler, and therefore the only process
# whose value would matter) falling back to the plugin's literal default.
manifest_extra_json() {
  local arm="$1" dest="$2" dest_label="$3" rate_limit="$4" extra="${5:-{\}}"
  local allegro_cron warmup_total stub_cfg identity resolvable_variants resolvable_products
  # What the offers can ACTUALLY reach at the destination, read from the
  # database rather than taken from the stub's advertised pool size.
  resolvable_variants="$(pg_sql "SELECT COUNT(DISTINCT im.\"internalId\") FROM identifier_mappings im
    JOIN product_variants pv ON pv.id = im.\"internalId\"
    WHERE im.\"entityType\"='Offer' AND im.\"connectionId\"='$SOURCE_CONNECTION_ID' AND pv.\"isStale\" = false" 2>/dev/null || printf 0)"
  resolvable_products="$(pg_sql "SELECT COUNT(DISTINCT pv.\"productId\") FROM identifier_mappings im
    JOIN product_variants pv ON pv.id = im.\"internalId\"
    WHERE im.\"entityType\"='Offer' AND im.\"connectionId\"='$SOURCE_CONNECTION_ID' AND pv.\"isStale\" = false" 2>/dev/null || printf 0)"
  allegro_cron="$(docker exec "$(discover_worker_containers | awk '{print $1}')" printenv OL_ALLEGRO_POLL_INTERVAL_CRON 2>/dev/null || printf '')"
  local allegro_cron_source="worker environment"
  [ -n "$allegro_cron" ] || { allegro_cron='*/1 * * * *'; allegro_cron_source="allegro-scheduler-tasks.ts default (unset on the worker)"; }
  identity="$(docker exec "$(discover_worker_containers | awk '{print $1}')" printenv OL_CUSTOMER_IDENTITY_MODE 2>/dev/null || printf '')"
  [ -n "$identity" ] || identity='email_fallback (unset - core default)'
  warmup_total=$((WARMUP_ORDERS_PER_REPLICA * ORIGINAL_REPLICAS))
  stub_cfg="$(of_config)"

  jq -n \
    --arg arm "$arm" \
    --arg dest "$dest" \
    --arg dest_label "$dest_label" \
    --arg rate_limit "$rate_limit" \
    --arg source_tenant "$SOURCE_TENANT" \
    --arg source_conn "$SOURCE_CONNECTION_ID" \
    --arg allegro_cron "$allegro_cron" \
    --arg allegro_cron_source "$allegro_cron_source" \
    --arg identity "$identity" \
    --argjson warmup "$warmup_total" \
    --argjson warmup_per_replica "$WARMUP_ORDERS_PER_REPLICA" \
    --argjson replicas "$ORIGINAL_REPLICAS" \
    --argjson poll_cadence "$POLL_CADENCE_SECS" \
    --argjson poll_limit "$OF_POLL_LIMIT" \
    --argjson stub "$stub_cfg" \
    --argjson resolvable_variants "${resolvable_variants:-0}" \
    --argjson resolvable_products "${resolvable_products:-0}" \
    --argjson extra "$extra" \
    '{
      arm: $arm,
      orderSource: {tenant: $source_tenant, connectionId: $source_conn},
      destination: {label: $dest_label, connectionId: $dest, rateLimitInForce: $rate_limit},
      arrivalRate: {
        note: "the INDEPENDENT VARIABLE is the offered order rate, kept separate from any seeded row count: min(pollPageLimit, feedBacklog) / pollCadenceSeconds. The 1,000,000 pre-seeded order_records rows on this stand are a fixed dataset size, never an arrival rate.",
        pollCadenceSecondsHarnessChosen: $poll_cadence,
        pollPageLimit: $poll_limit
      },
      pollCadenceResolved: {
        note: "DERIVED, not read from a running scheduler - the scheduler is OFF for this run and the harness enqueues every poll itself. #2279 moved the scheduler into the worker, so the worker environment is the only place a cron override would take effect.",
        allegro: {cron: $allegro_cron, source: $allegro_cron_source, meanPollWaitSeconds: 30, retunable: true, envVar: "OL_ALLEGRO_POLL_INTERVAL_CRON"},
        woocommerce: {cron: "*/5 * * * *", source: "woocommerce-scheduler-tasks.ts string literal", retunable: false},
        erli: {cron: "*/5 * * * *", source: "erli-scheduler-tasks.ts string literal", retunable: false},
        prestashop: {cron: "0 */10 * * * *", source: "prestashop-scheduler-tasks.ts", retunable: true, envVar: "OL_PRESTASHOP_POLL_INTERVAL_CRON", note: "webhook-primary; the poll is the backstop"}
      },
      buyerIdentityMode: $identity,
      warmupOrders: {perReplica: $warmup_per_replica, replicas: $replicas, total: $warmup, reason: "excludes the line_prices cold start (27 requests vs 7 for the first order after any worker restart, prestashop-openlinker-module.client.ts) and warms the currency/country/order-state caches"},
      stub: $stub,
      stubOfferPoolSize: ($stub.offerPoolSize),
      destinationResolvableVariants: $resolvable_variants,
      destinationResolvableProducts: $resolvable_products,
      productPoolNote: "THREE DIFFERENT NUMBERS, and the #2856 seeded-mapping contract (the offer pool and the distinct-product count being the same number) CANNOT hold on this stand. The stub mints stubOfferPoolSize distinct offer ids, but seed-catalogue.sh seeds mappings rather than real shop products, so only destinationResolvableProducts products actually exist at the destination and every offer round-robins onto destinationResolvableVariants variants. The PrestaShop tax chain caches 24h per connection+product+country, so it decays against the RESOLVABLE count - a small pool warms almost immediately and understates per-order destination cost for a real catalogue.",
      fanOutCoTenancy: "controlled - the scheduler is OFF, so no master sweep parent shares the fan-out lane with marketplace.orders.poll during any window",
      latencyPointProvenance: "documented cross-table reconstruction, NOT #2850 instrumentation. See the scenario header; the summarizer counts the heartbeat-rewrite and multi-attempt cases rather than assuming them away, and the single-destination arrange removes the syncedAt late-bias structurally."
    } * $extra'
}

# arm_throughput <arm_name> <dest_conn> <dest_label> <rate_limit_label> <backlog> <window_secs>
#
# Reports through the GLOBALS `ARM_RATE` / `ARM_DIR`, deliberately, rather than
# by echoing on stdout for the caller to capture. Half a dozen lib.sh calls in
# this function's body (window_start, window_stop, manifest_write,
# results_dir_init, reset_between_repeats, the sampler starts) write to stdout
# through `log`, and a `$(...)` capture would swallow all of it into the
# "rate" - silently, since `read -r rate dir` simply takes the first two words
# of whatever arrives. Redirecting each of those to stderr one by one is a list
# that goes stale the first time a line is added.
ARM_RATE=""
ARM_DIR=""

arm_throughput() {
  local arm="$1" dest="$2" dest_label="$3" rl_label="$4" backlog="$5" window="$6"
  local dir run_group progress rate
  ARM_RATE=""; ARM_DIR=""

  log "=== arm $arm: backlog=$backlog window=${window}s destination=$dest_label rateLimit=$rl_label ==="

  of_new_run >/dev/null
  reset_between_repeats "$CONN_IDS" "'$OF_CURSOR_KEY'"
  pg_sql_write "DELETE FROM sync_jobs WHERE \"connectionId\"='$SOURCE_CONNECTION_ID' AND status IN ('queued','running')" >/dev/null
  guard_queue_empty "$CONN_IDS"

  # Warm-up BEFORE the window, so the line_prices cold start and the
  # currency/country/order-state caches are all warm when it opens.
  local warm=$((WARMUP_ORDERS_PER_REPLICA * ORIGINAL_REPLICAS))
  log "warm-up: $warm order(s) ($WARMUP_ORDERS_PER_REPLICA per replica x $ORIGINAL_REPLICAS)"
  of_push_orders "$SOURCE_TENANT" "$warm" >/dev/null
  of_enqueue_poll "$SOURCE_CONNECTION_ID" "warm-$arm" >/dev/null
  cap_perf_job_attempts
  drain_wait "$CONN_IDS" >/dev/null || warn "warm-up drain did not settle cleanly"

  # Then the measured backlog, pushed in ONE request before the window opens.
  of_push_orders "$SOURCE_TENANT" "$backlog" >/dev/null
  log "pushed $backlog order(s); stub backlog now $(of_backlog "$SOURCE_TENANT" "$SOURCE_CONNECTION_ID")"

  run_group="$arm-run$(date +%s)"
  dir="$(results_dir_init f1-order-ingestion "$run_group")"
  progress="$dir/progress.csv"

  snapshot_jobs_before "$CONN_IDS"
  window_start "$dir" f1-order-ingestion "$CONN_IDS" 0 \
    "$(manifest_extra_json "$arm" "$dest" "$dest_label" "$rl_label" \
       "$(jq -n --argjson b "$backlog" --argjson w "$window" '{feedBacklogPushed:$b, windowSeconds:$w}')")"
  local ws_iso; ws_iso="$(date -u -d "@$WINDOW_START_EPOCH" +%Y-%m-%dT%H:%M:%SZ)"

  local stub_before; stub_before="$(of_stats "$SOURCE_TENANT")"
  start_progress "$progress" "$ws_iso"
  start_pump "$arm"
  sleep "$window"
  stop_background
  window_stop "$dir"
  local stub_after; stub_after="$(of_stats "$SOURCE_TENANT")"

  printf '%s' "$stub_before" > "$dir/stub-stats-before.json"
  printf '%s' "$stub_after"  > "$dir/stub-stats-after.json"

  local mb; mb="$(min_available_work "$progress")"
  run_post_guards "$dir" "$CONN_IDS" "$ws_iso" "$WINDOW_START_EPOCH" "$WINDOW_STOP_EPOCH" "$dest" "" "" "$mb"

  # DISCARD the undrained remainder rather than draining it.
  #
  # The backlog is deliberately sized to outlast the window (that is what
  # post_guard_feed_starved requires), so a window that ends with the system
  # still busy leaves hundreds of queued children behind BY DESIGN. Draining
  # them would cost, at the rates this arm just measured, longer than the
  # window itself - three arms of that is most of an hour spent executing work
  # that is outside every measurement and contributes to none of them.
  #
  # Deleting a QUEUED row is safe: it was never claimed, so nothing partially
  # happened for it, and the orders it would have created are the ones this
  # arm already declined to count. `running` rows are left to finish and then
  # waited on - killing a claimed job mid-flight would abandon a destination
  # create halfway, which is a real side effect on a real shop.
  local discarded
  discarded="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$SOURCE_CONNECTION_ID' AND status='queued'" 2>/dev/null || printf 0)"
  pg_sql_write "DELETE FROM sync_jobs WHERE \"connectionId\"='$SOURCE_CONNECTION_ID' AND status='queued'" >/dev/null
  log "arm $arm: discarded ${discarded:-0} queued child job(s) that the window did not reach (never claimed, so nothing partially happened)"
  pg_sql_write "UPDATE sync_jobs SET \"maxAttempts\"=$PERF_MAX_ATTEMPTS WHERE \"connectionId\"='$SOURCE_CONNECTION_ID' AND status='running'" >/dev/null
  drain_wait "$CONN_IDS" >/dev/null || warn "arm $arm: drain timed out waiting for in-flight jobs"

  {
    printf '=== arm %s ===\n' "$arm"
    python3 "$SCRIPT_DIR/../drivers/f1-summarize.py" throughput "$progress"
    printf '\nstub upstream requests over the window:\n'
    jq -n --argjson a "$stub_after" --argjson b "$stub_before" \
      '($a.requestCounts // {}) as $A | ($b.requestCounts // {}) as $B
       | [$A | keys[]] | map({key:., value: (($A[.] // 0) - ($B[.] // 0))}) | from_entries'
  } > "$dir/summary.txt"
  cat "$dir/summary.txt"

  rate="$(awk -F'= *' '/orders\/hour/ {gsub(/ orders\/hour/,"",$2); print $2; exit}' "$dir/summary.txt")"
  [ -n "$rate" ] || rate=0
  ARM_RATE="$rate"
  ARM_DIR="$dir"
  log "arm $arm result: $ARM_RATE orders/hour ($ARM_DIR)"
}

run_strict() {
  log "=== pre-flight guards ==="
  if [ "$F1_SCHEDULER_ON" = "1" ]; then
    # DELIBERATE WAIVER (#2840). guard_scheduler_off's own docblock authorises
    # a scenario that wants the scheduler on to skip it, provided it records
    # the resolved task inventory and every cadence it could read - which
    # f1_wait_for_scheduler / f1_assert_scheduler_inventory do below, and the
    # manifest carries. The cadence row the guard would have captured is
    # captured here explicitly so the manifest is not silently thinner.
    MANIFEST_SCHEDULER_CADENCE_ROW="$(scheduler_cadence_row)"
    log "guard_scheduler_off DELIBERATELY WAIVED - scheduler-ON mode (operational_settings cadence row: ${MANIFEST_SCHEDULER_CADENCE_ROW:-<none>})"
  else
    guard_scheduler_off
  fi
  guard_demo_mode_off
  guard_log_level
  guard_perf_max_attempts
  guard_build

  # The runner must be ON for F1 - the whole chain is unobservable otherwise.
  # This stand's own default is OFF, so it is flipped here and restored by the
  # EXIT trap. guard_runner_state then verifies the flip took AND captures the
  # lane caps the runner actually resolved, which is what the falsification
  # arms compare against.
  if [ "$F1_SCHEDULER_ON" = "1" ]; then
    # Set BEFORE the recreate, or the recreated worker carries the old posture.
    # These reach the container only because #2840 added the three sweep keys
    # to the worker service in docker-compose.lab.yml; before that, writing
    # them here set nothing at all.
    SCHEDULER_TOUCHED=1
    WORKER_TOUCHED=1
    f1_set_env_key OL_SCHEDULER_ENABLED true
    f1_set_env_key OL_PRODUCT_SYNC_ENABLED false
    f1_set_env_key OL_INVENTORY_SYNC_ENABLED false
    f1_set_env_key OL_MASTER_PRODUCT_RECONCILE_ENABLED false
    F1_SCHED_POLL_RE="$(f1_sched_poll_re)"
    log "scheduler-ON mode: scheduler=true, master sweeps disabled (product/inventory/reconcile)"
  fi
  recreate_worker true
  if [ "$F1_SCHEDULER_ON" = "1" ]; then
    log "waiting for the scheduler singleton to acquire its lease and register"
    F1_SCHED_TASKS="$(f1_wait_for_scheduler)"
    log "scheduler registered $(printf '%s\n' "$F1_SCHED_TASKS" | grep -c . || true) task(s)"
    printf '%s\n' "$F1_SCHED_TASKS" | sed 's/^/  task: /'
    f1_assert_scheduler_inventory "$F1_SCHED_TASKS"
  fi
  guard_connection_budget
  guard_pool_recorded
  guard_runner_state enabled

  local built_sha; built_sha="${MANIFEST_GIT_SHA}"
  local report="$RESULTS_ROOT/results-F1-$(date -u +%Y-%m-%d).md"
  local baseline_caps="$MANIFEST_LANE_CAPS"

  local lat_dir="" lat_csv=""
  local base_rate="" base_dir="" raised_rate="" raised_dir="" lane_rate="" lane_dir=""
  local wc_dir="" wc_csv=""

  # -------------------------------------------------------------------------
  # PrestaShop is the headline destination (#2847: the REAL local shop, never
  # the #2846 stub). WooCommerce is disabled for every PrestaShop arm so the
  # unfiltered fan-out cannot reach both and bias syncedAt toward the slower.
  # -------------------------------------------------------------------------
  set_destination "$WC_CONNECTION_ID" off
  set_destination "$PS_CONNECTION_ID" on
  set_rate_limit  "$PS_CONNECTION_ID" default

  if [ "$ARMS" = "all" ] || [ "$ARMS" = "latency" ]; then
    log "=== arm latency: $LATENCY_SAMPLES serial samples, real PrestaShop destination ==="
    of_new_run >/dev/null
    reset_between_repeats "$CONN_IDS" "'$OF_CURSOR_KEY'"
    pg_sql_write "DELETE FROM sync_jobs WHERE \"connectionId\"='$SOURCE_CONNECTION_ID' AND status IN ('queued','running')" >/dev/null
    guard_queue_empty "$CONN_IDS"

    local warm=$((WARMUP_ORDERS_PER_REPLICA * ORIGINAL_REPLICAS))
    of_push_orders "$SOURCE_TENANT" "$warm" >/dev/null
    of_enqueue_poll "$SOURCE_CONNECTION_ID" "warm-lat" >/dev/null
    cap_perf_job_attempts
    drain_wait "$CONN_IDS" >/dev/null || warn "latency warm-up drain did not settle cleanly"

    lat_dir="$(results_dir_init f1-order-ingestion "latency-run$(date +%s)")"
    lat_csv="$lat_dir/samples.csv"
    printf '%s\n' "$LATENCY_HEADER" > "$lat_csv"

    snapshot_jobs_before "$CONN_IDS"
    window_start "$lat_dir" f1-order-ingestion "$CONN_IDS" 0 \
      "$(manifest_extra_json latency "$PS_CONNECTION_ID" "real PrestaShop (#2860)" "manifest default (60/min, 4 concurrent)" \
         "$(jq -n --argjson n "$LATENCY_SAMPLES" '{samples:$n, shape:"serial - one order in flight at a time, so no hop carries queue wait behind another order"}')")"
    local lat_ws_iso; lat_ws_iso="$(date -u -d "@$WINDOW_START_EPOCH" +%Y-%m-%dT%H:%M:%SZ)"
    local lat_stub_before; lat_stub_before="$(of_stats "$SOURCE_TENANT")"

    local i
    for i in $(seq 1 "$LATENCY_SAMPLES"); do
      run_one_sample "$i" "$PS_CONNECTION_ID" "$lat_csv"
    done

    window_stop "$lat_dir"
    printf '%s' "$lat_stub_before"        > "$lat_dir/stub-stats-before.json"
    printf '%s' "$(of_stats "$SOURCE_TENANT")" > "$lat_dir/stub-stats-after.json"
    # No feed backlog to starve here, deliberately: the arm drains the stub by
    # design, one order at a time. That is post_guard_feed_starved's own
    # "not applicable" case, and passing a number would discard every run.
    run_post_guards "$lat_dir" "$CONN_IDS" "$lat_ws_iso" "$WINDOW_START_EPOCH" "$WINDOW_STOP_EPOCH" "$PS_CONNECTION_ID" "" "" ""
    python3 "$SCRIPT_DIR/../drivers/f1-summarize.py" "$F1_SUMMARY_MODE" "$lat_csv" > "$lat_dir/summary.txt"
    cat "$lat_dir/summary.txt"
    drain_wait "$CONN_IDS" >/dev/null || true
  fi

  if [ "$ARMS" = "all" ] || [ "$ARMS" = "throughput" ]; then
    arm_throughput throughput-baseline "$PS_CONNECTION_ID" \
      "real PrestaShop (#2860)" "manifest default (60/min, 4 concurrent)" "$THROUGHPUT_BACKLOG" "$THROUGHPUT_WINDOW_SECS"
    base_rate="$ARM_RATE"; base_dir="$ARM_DIR"

    set_rate_limit "$PS_CONNECTION_ID" "$RAISED_RPM" "$RAISED_CONCURRENT"
    arm_throughput throughput-destination-raised "$PS_CONNECTION_ID" \
      "real PrestaShop (#2860)" "config.rateLimit $RAISED_RPM/min, $RAISED_CONCURRENT concurrent" "$THROUGHPUT_BACKLOG" "$THROUGHPUT_WINDOW_SECS"
    raised_rate="$ARM_RATE"; raised_dir="$ARM_DIR"

    # The falsification #2847 asks for is complete at this point either way:
    # if the rate moved, the destination limit was binding at baseline; if it
    # did not, the lane cap was.
    local moved
    moved="$(awk -v a="$base_rate" -v b="$raised_rate" -v t="$MOVED_THRESHOLD_PCT" \
      'BEGIN { if (a <= 0) { print "unknown"; exit } d = (b - a) / a * 100; if (d < 0) d = -d; print (d > t) ? "yes" : "no" }')"
    log "destination-limit falsification: baseline=$base_rate/h raised=$raised_rate/h -> moved=$moved (threshold ${MOVED_THRESHOLD_PCT}%)"

    # Arm 3 runs UNCONDITIONALLY, and that is a change of mind worth recording.
    # An earlier draft skipped it whenever arm 2 moved the number, on the
    # grounds that the falsification was already answered. It is - but the
    # question an operator actually has is "what binds NEXT", and a two-point
    # ladder cannot answer it: with the destination lifted, either the lane cap
    # is the new ceiling (arm 3 moves the number again) or something else
    # entirely is (arm 3 does not, and the report has to name what). Skipping
    # it saves one window and throws away the only measurement that tells those
    # two apart.
    log "raising OL_LANE_REALTIME_SCOPE_CAP to $RAISED_LANE_SCOPE_CAP on top of the raised destination limit"
    recreate_worker true "$RAISED_LANE_SCOPE_CAP" "$RAISED_LANE_CAP"
    guard_runner_state enabled
    # The label is DERIVED from what the runner reported, never from what was
    # requested. An earlier version asserted "+ lane scope cap 16" as a
    # literal while the runner was in fact still on 4/2, producing a manifest
    # that contradicted itself - honest in `laneCaps` (read from the runner)
    # and false in the label (written by hand). A label is a claim; only a
    # reading is evidence.
    arm_throughput throughput-lane-raised "$PS_CONNECTION_ID" \
      "real PrestaShop (#2860)" "config.rateLimit $RAISED_RPM/min, $RAISED_CONCURRENT concurrent + lane caps as reported by the runner: $MANIFEST_LANE_CAPS" \
      "$THROUGHPUT_BACKLOG" "$THROUGHPUT_WINDOW_SECS"
    lane_rate="$ARM_RATE"; lane_dir="$ARM_DIR"
    recreate_worker true
    guard_runner_state enabled

    set_rate_limit "$PS_CONNECTION_ID" default
  fi

  # -------------------------------------------------------------------------
  # The real-WooCommerce arm. Reported separately and labelled a real-shop
  # measurement, never a throughput figure (#2847's own words): a real
  # WooCommerce install carries its own unmeasured latency the way a sandbox
  # would. PrestaShop is disabled for it, for the same single-destination
  # reason the PrestaShop arms disable WooCommerce.
  # -------------------------------------------------------------------------
  # A DESTINATION ARM WITH NO REAL PRODUCTS BEHIND IT IS REFUSED, NOT RUN.
  #
  # `seed-catalogue.sh` writes 10 000 WooCommerce `Product` identifier
  # mappings whose external ids are synthetic strings
  # (`PERFSEED-EXT-PROD-wc-*`), and zero actual WooCommerce products - it was
  # built for the read-path scenarios, where nothing crosses to a shop.
  # `WooCommerceOrderProcessorAdapter.resolveLineItems` needs a numeric WC
  # product id, so every order on this arm fails with
  # `Corrupted mapping: "PERFSEED-EXT-PROD-wc-N" is not a valid positive
  # integer WC ID`.
  #
  # Running it anyway would burn a window to produce a DISCARDED verdict and a
  # table of failures, and - worse - would invite a reader to mistake a stand
  # gap for a WooCommerce performance result. The refusal names what is
  # missing and what would fix it.
  local wc_real_products=0
  if [ "$ARMS" = "all" ]; then
    wc_real_products="$(pg_sql "SELECT COUNT(*) FROM identifier_mappings
      WHERE \"entityType\"='Product' AND \"connectionId\"='$WC_CONNECTION_ID'
        AND \"externalId\" ~ '^[0-9]+\$'" 2>/dev/null || printf 0)"
  fi
  if [ "$ARMS" = "all" ] && [ "${wc_real_products:-0}" -eq 0 ]; then
    warn "SKIPPING the WooCommerce arm: the stand carries $(pg_sql "SELECT COUNT(*) FROM identifier_mappings WHERE \"entityType\"='Product' AND \"connectionId\"='$WC_CONNECTION_ID'" 2>/dev/null || printf '?') WooCommerce Product mappings and NONE of them names a numeric WC product id, so no order can resolve a line item there. seed-catalogue.sh seeds mappings, never real WooCommerce products - creating some (wp post create --post_type=product) and re-pointing those mappings is what this arm needs. Reported as not-run rather than run-and-discarded."
  elif [ "$ARMS" = "all" ]; then
    log "=== arm woocommerce: $WC_ARM_ORDERS serial samples against the real local WooCommerce ==="
    set_destination "$PS_CONNECTION_ID" off
    set_destination "$WC_CONNECTION_ID" on
    of_new_run >/dev/null
    reset_between_repeats "$CONN_IDS" "'$OF_CURSOR_KEY'"
    pg_sql_write "DELETE FROM sync_jobs WHERE \"connectionId\"='$SOURCE_CONNECTION_ID' AND status IN ('queued','running')" >/dev/null
    guard_queue_empty "$CONN_IDS"

    of_push_orders "$SOURCE_TENANT" "$((WARMUP_ORDERS_PER_REPLICA * ORIGINAL_REPLICAS))" >/dev/null
    of_enqueue_poll "$SOURCE_CONNECTION_ID" warm-wc >/dev/null
    cap_perf_job_attempts
    drain_wait "$CONN_IDS" >/dev/null || warn "woocommerce warm-up drain did not settle cleanly"

    wc_dir="$(results_dir_init f1-order-ingestion "woocommerce-run$(date +%s)")"
    wc_csv="$wc_dir/samples.csv"
    printf '%s\n' "$LATENCY_HEADER" > "$wc_csv"
    snapshot_jobs_before "$CONN_IDS"
    window_start "$wc_dir" f1-order-ingestion "$CONN_IDS" 0 \
      "$(manifest_extra_json woocommerce "$WC_CONNECTION_ID" "real WooCommerce behind wc-tls (#2854)" "manifest default (60/min, 4 concurrent)" \
         "$(jq -n --argjson n "$WC_ARM_ORDERS" '{samples:$n, shape:"serial, low rate - a REAL-SHOP measurement, never a throughput figure"}')")"
    local wc_ws_iso; wc_ws_iso="$(date -u -d "@$WINDOW_START_EPOCH" +%Y-%m-%dT%H:%M:%SZ)"
    local j
    for j in $(seq 1 "$WC_ARM_ORDERS"); do
      run_one_sample "$j" "$WC_CONNECTION_ID" "$wc_csv"
    done
    window_stop "$wc_dir"
    run_post_guards "$wc_dir" "$CONN_IDS" "$wc_ws_iso" "$WINDOW_START_EPOCH" "$WINDOW_STOP_EPOCH" "$WC_CONNECTION_ID" "" "" ""
    python3 "$SCRIPT_DIR/../drivers/f1-summarize.py" latency "$wc_csv" > "$wc_dir/summary.txt"
    cat "$wc_dir/summary.txt"
    drain_wait "$CONN_IDS" >/dev/null || true
  fi

  log "=== every arm complete ==="
  log "latency:                    ${lat_dir:-<not run>}"
  log "throughput baseline:        ${base_dir:-<not run>} (${base_rate:-?} orders/h)"
  log "throughput dest-raised:     ${raised_dir:-<not run>} (${raised_rate:-?} orders/h)"
  log "throughput lane-raised:     ${lane_dir:-<not run>} (${lane_rate:-?} orders/h)"
  log "woocommerce:                ${wc_dir:-<not run>}"
  log "baseline lane caps:         $baseline_caps"
  log "image revision:             $built_sha"
  log "write the dated report at:  $report"
}

case "$MODE" in
  smoke) run_smoke ;;
  strict) run_strict ;;
esac
