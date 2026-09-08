#!/usr/bin/env bash
#
# F10 - behaviour under dependency failure (#2978, epic #2840).
#
# Every other flow in this campaign ran against a stand where nothing ever
# failed: PrestaShop answered every call, the Allegro stub answered every
# call, Redis stayed up, the worker stayed up. This scenario is the one that
# breaks things on purpose and reads what OpenLinker did about it.
#
# ---------------------------------------------------------------------------
# THE QUESTION, AND WHY IT IS NOT A THROUGHPUT QUESTION
# ---------------------------------------------------------------------------
# For each injected fault, exactly one thing has to be established and it is
# not a rate:
#
#     is the order LOST, RETRIED, or SILENTLY MARKED DONE?
#
# The third is the finding. This campaign has already met it twice, both
# times by accident: the Allegro stub's digit-bearing buyer names, which
# PrestaShop's Validate::isName rejected on every order while the job still
# recorded outcome='ok' because Promise.allSettled swallowed it; and
# MarketplaceOfferQuantityUpdateHandler dropping the original exception's
# statusCode, so a deterministic 404 walks the full ten-attempt ladder. There
# is no reason to think those are the only two, and looking for them by
# accident a third time is not a method.
#
# So the windows here are short and the offered load is modest. The numbers
# that matter are counts of rows in four ledgers, not orders per hour.
#
# ---------------------------------------------------------------------------
# GROUND TRUTH IS THE SHOP, NOT OPENLINKER
# ---------------------------------------------------------------------------
# "Silently marked done" cannot be established from OpenLinker's own tables,
# because a system that believes it succeeded says so consistently everywhere
# it writes. The only witness that is not the accused is PrestaShop's own
# database:
#
#   sync_jobs             what the job says happened
#   order_records         what the order snapshot says happened
#   syncStatus[]          what the destination fan-out says happened, and
#                         the destination-native order id it CLAIMS to have
#                         created
#   ps_orders / ps_cart   whether that order actually exists
#
# The sharp test is the last two read together: for every syncStatus entry
# with status='synced', does its externalOrderId name a row in ps_orders? A
# claimed id with no row behind it is a success report over a failure, and it
# is stated as a count rather than inferred from a rate that looks low.
#
# ---------------------------------------------------------------------------
# WHY THE STANDARD POST-GUARD SET IS NOT USED WHOLESALE
# ---------------------------------------------------------------------------
# `run_post_guards` is right for every other scenario and wrong for this one,
# because three of its members are INVERTED here:
#
#   post_guard_destination_creates   a failed syncStatus entry is the
#                                    measurement, not a contaminant. Under a
#                                    destination fault, zero of them would
#                                    mean the fault never reached the
#                                    destination path and the window is
#                                    worthless.
#   post_guard_attempts              attempts>1 is the RETRY COST this issue
#                                    asks for ("a deterministic 404 burning
#                                    ten attempts is measurable waste").
#   post_guard_deferrals             a 429 carrying Retry-After is SUPPOSED
#                                    to produce a penalty-free deferral.
#
# Skipping them silently would be the campaign sin. Instead every guard is
# run individually by `run_f10_guards` and its answer is routed to one of two
# places: a STAND guard still discards the window, and a FAULT guard's answer
# is written to fault-observations.txt as a measurement. Both sets are
# printed. Nothing is dropped.
#
# Of `run_post_guards`'s eight members, six run here - four as STAND or FAULT
# guards above plus `post_guard_limiter_degraded`. The two that do not run,
# and why, stated rather than left as an absence:
#
#   post_guard_generator_saturated   there is no k6 generator on this path.
#                                    The same is true of F2, which is why the
#                                    argument is optional in the first place.
#   post_guard_feed_starved          it protects a SATURATION measurement -
#                                    it asks whether a standing supply ever
#                                    ran dry, because a throughput figure
#                                    taken while the generator was empty
#                                    measures the generator. F10 offers a
#                                    FIXED BATCH on purpose, so a drained feed
#                                    is the expected end state and that guard
#                                    would flag every window for doing what it
#                                    was told. The property that DOES matter
#                                    here is checked instead, and it is a
#                                    different one: did every order pushed at
#                                    the stub become a child job? If not, every
#                                    per-order figure in the window is against
#                                    the wrong denominator. See the
#                                    offered_work observation in
#                                    run_f10_guards.
#
# The two stand guards keep their full force, and they are the ones that
# matter for trusting a window at all: `post_guard_containers_stable` (a peer
# recreated a container underneath the window) and `post_guard_requeues` (the
# stuck-job recovery pass moved rows we are about to count). Note the ONE
# deliberate exception: the I3 window kills the worker itself, so a container
# restart there is the injected fault and is declared as such in the manifest
# rather than discarding the window.
#
# ---------------------------------------------------------------------------
# EVERY FAULT IS DECLARED, AND ITS DELIVERY IS COUNTED
# ---------------------------------------------------------------------------
# #2978's first acceptance criterion. `manifest.json` carries a
# `faultInjection` object for every window, baseline included - the baseline's
# says `injected: false`, so "no fault" is a positive statement rather than an
# absent key. A reader six weeks from now can tell an injected 500 from a real
# one without reading this file.
#
# The rule as INSTALLED is read back from the injector rather than echoed from
# what this script asked for, and the DELIVERED fault count is read back after
# the window. Both matter: a fractional rule's delivered count is not its
# requested fraction, and a rule that installed but never matched would
# otherwise look identical to a system that shrugged off the fault.
#
# ---------------------------------------------------------------------------
# THE TWO INJECTORS
# ---------------------------------------------------------------------------
#   ps-fault-proxy   a transparent reverse proxy in front of the REAL local
#                    PrestaShop, started by this script as a plain
#                    `docker run` on the lab network and torn down on exit.
#                    Nothing in docker-compose.lab.yml changes and no existing
#                    container is recreated, so `post_guard_containers_stable`
#                    still means what it means everywhere else. The
#                    `perf-prestashop` connection's `config.baseUrl` is
#                    PATCHed to point at it and PATCHed back on exit; a fresh
#                    adapter is built per capability resolution
#                    (`integrations.service.ts`), so that takes effect on the
#                    next job with no restart.
#   allegro-stub     already on the stand. #2978 extended its fault surface
#                    with per-endpoint targeting, a fraction and three new
#                    modes; see stubs/allegro/server.mjs applyFault.
#
# Infrastructure faults use neither - Redis is paused with CLIENT PAUSE
# (DEBUG SLEEP is disabled on Redis 7+ by default, verified on this stand) and
# stopped with `docker stop`; the worker is killed with SIGKILL and started
# again.
#
# ---------------------------------------------------------------------------
# WHAT THIS SCENARIO DOES NOT DO
# ---------------------------------------------------------------------------
# It does not fix anything it finds. A fix landing in the window that scores
# it is how a campaign stops being believable (#2977 §2). Findings are
# reported with a reproduction and nothing else.
#
# Sources lib.sh (#2841) and drivers/order-feed.sh (#2847).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LIB_LOG_PREFIX="f10"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../drivers/order-feed.sh"

ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.lab}"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SOURCE_TENANT="${SOURCE_TENANT:-perf-allegro-a}"

# Short by design - see the header. A fault window has to be long enough for
# the fault to be delivered many times and for the retry ladder to take at
# least one visible step, and no longer.
FAULT_WINDOW_SECS="${FAULT_WINDOW_SECS:-90}"
POLL_CADENCE_SECS="${POLL_CADENCE_SECS:-10}"

# THIS SCENARIO OFFERS A FIXED BATCH, NOT A STANDING SUPPLY, AND THE SIZE IS
# CHOSEN AGAINST THE RECOVERY QUESTION RATHER THAN AGAINST SATURATION.
#
# The first calibration run used 120, on the saturation reasoning every other
# scenario in this campaign uses: offer more than the window can consume so the
# feed can never run dry. That is the right rule for a throughput measurement
# and the wrong one here. This stand's measured baseline is ~207 orders/h -
# roughly five orders in a 90 s window - so a batch of 120 leaves ~115 children
# queued when the window closes, and NO window can then observe its own
# recovery: every one reports "still not drained" whether the system healed or
# not. The single most important question after "was the order lost" would have
# been unanswerable in all thirteen windows.
#
# A batch is sized instead so that a HEALTHY window finishes inside the window
# plus the recovery observation, which is what makes "did it recover on its
# own, and how late" a readable number. 12 orders against ~3.3 orders/min over
# 90 s + 240 s is comfortable at baseline and merely late under a fault - and
# late is exactly the answer this run wants to be able to give.
#
# It is still far more than enough fault deliveries: the baseline window
# measured ~11 PrestaShop requests per order, so 12 orders is ~130 requests and
# a fraction of 0.3 delivers ~40 faults.
WINDOW_BACKLOG="${WINDOW_BACKLOG:-12}"

# The retry ladder is capped so a window's cost is bounded and comparable
# across faults. `enqueue_perf_job` + `cap_perf_job_attempts` apply it. THIS
# IS A MEASUREMENT INPUT, not a detail: the "ten attempts on a deterministic
# failure" cost #2978 asks about is reported as observed-attempts against
# THIS cap, and extrapolated to the shipped 10 explicitly rather than
# silently.
PERF_MAX_ATTEMPTS="${PERF_MAX_ATTEMPTS:-3}"
export PERF_MAX_ATTEMPTS

# How long to wait for the queue to settle after a window before reading the
# ledger. Bounded: a fault window legitimately leaves rows behind (that IS the
# finding), so a drain that runs to its timeout is an expected outcome here
# rather than an error, and its result is recorded per window.
DRAIN_MAX_WAIT_SECS="${DRAIN_MAX_WAIT_SECS:-180}"
export DRAIN_MAX_WAIT_SECS

# After the fault is cleared, how long to give the system to finish the work
# it was struggling with. This is the "does recovery happen without a human,
# and how late" measurement.
RECOVERY_WAIT_SECS="${RECOVERY_WAIT_SECS:-240}"

# Thirteen windows in one lock hold. The library default TTL (3600s) is a
# CRASH bound, not a run bound - it is the longest a dead holder can block the
# stand - and thirteen settle-plus-window-plus-drain cycles do not fit inside
# it. Raised here rather than left to expire mid-run, which would let a peer
# take the stand underneath an open window.
OL_STAND_LOCK_TTL_SECS="${OL_STAND_LOCK_TTL_SECS:-9000}"
export OL_STAND_LOCK_TTL_SECS
STAND_LOCK_TTL_SECS="$OL_STAND_LOCK_TTL_SECS"

# The library default is 60s, sized to let a REBUILD's CPU and page-cache
# impact fade. Nothing is rebuilt between these windows and the load is
# modest, so 60s x 13 would be thirteen minutes of the lock spent waiting for
# an effect that is not present. 30s still covers the previous window's drain
# tail, which is the only carry-over this scenario actually has. Declared as a
# deviation rather than silently taken - it is recorded in every manifest by
# manifest_gather_environment.
SETTLE_SECS="${SETTLE_SECS:-30}"

PROXY_CONTAINER="${PROXY_CONTAINER:-lab-ps-fault-proxy}"
PROXY_IMAGE="${PROXY_IMAGE:-ol-perf:ps-fault-proxy}"
PROXY_NETWORK="${PROXY_NETWORK:-lab_default}"
PROXY_SERVICE_HOST="${PROXY_SERVICE_HOST:-ps-fault-proxy}"
PROXY_HOST_PORT="${PROXY_HOST_PORT:-19083}"
PROXY_URL="http://127.0.0.1:$PROXY_HOST_PORT"

# The offer the M3 quantity-write arm targets. A seeded mapping on
# perf-allegro-a (bootstrap.sh's ALLEGRO_OFFER_POOL_SIZE pool); resolved live
# rather than hardcoded, because the internal id is a bootstrap artefact.
QUANTITY_JOBS="${QUANTITY_JOBS:-12}"

# ---------------------------------------------------------------------------
# The fault catalogue. One row per #2978 fault class.
#
# Format: id|class|injector|description
# The rule itself lives in `install_fault`, which is the single place a rule
# is built - so what the manifest records and what the injector was told
# cannot come from two different expressions.
# ---------------------------------------------------------------------------
ALL_FAULTS="baseline D1 D2a D2b D3 D4 M1 M2 M2t M3 I1 I2 I3"

fault_class() {
  case "$1" in
    baseline) printf 'none (reference window - the proxy is in the path and transparent)' ;;
    D1)  printf 'destination: PrestaShop returns 500 on a fraction of calls' ;;
    D2a) printf 'destination: PrestaShop returns 429 WITH Retry-After' ;;
    D2b) printf 'destination: PrestaShop returns 429 WITHOUT Retry-After' ;;
    D3)  printf 'destination: PrestaShop stops responding mid-order (connection held open past the client timeout)' ;;
    D4)  printf 'destination: partial create - the cart succeeds and importorder fails' ;;
    M1)  printf 'marketplace: the source times out during hydration' ;;
    M2)  printf 'marketplace: the source returns a malformed payload' ;;
    M2t) printf 'marketplace: the source returns a truncated payload' ;;
    M3)  printf 'marketplace: the source rejects the offer-quantity write' ;;
    I1)  printf 'infrastructure: Redis becomes slow (a blocked client, not an outage)' ;;
    I2)  printf 'infrastructure: Redis drops entirely mid-window' ;;
    I3)  printf 'infrastructure: the worker is killed mid-job' ;;
    *)   printf 'unknown' ;;
  esac
}

fault_load() {
  # Which load path a fault is exercised under. Only M3 uses the quantity
  # write; everything else uses order ingestion, which is the only path that
  # touches both a source and a destination.
  case "$1" in
    M3) printf 'quantity' ;;
    *)  printf 'order' ;;
  esac
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
FAULTS="$ALL_FAULTS"
MODE="strict"
for arg in "$@"; do
  case "$arg" in
    --smoke) MODE="smoke" ;;
    --list)
      for f in $ALL_FAULTS; do printf '%-8s %s\n' "$f" "$(fault_class "$f")"; done
      exit 0
      ;;
    --faults=*) FAULTS="${arg#--faults=}"; FAULTS="${FAULTS//,/ }" ;;
    -h|--help)
      cat <<'USAGE'
Usage: f10-dependency-failure.sh [--faults=ID[,ID...]] [--smoke] [--list]

  (no flag)      every fault in the catalogue, in order, each in its own
                 declared window, with a dated report under results/.
  --faults=D1,M1 only these faults (the baseline is NOT added implicitly -
                 name it if you want it).
  --list         print the catalogue and exit.
  --smoke        bring the proxy up, prove it is transparent against the real
                 PrestaShop, install and clear one rule of every mode, tear
                 everything down. No window, no manifest, nothing written
                 under results/. Takes the stand lock, because it repoints a
                 shared connection.

Every knob is an env var - see the Configuration block at the top of this file.
USAGE
      exit 0
      ;;
    *) die "unknown argument: $arg (use --faults=..., --smoke, --list, --help, or nothing)" ;;
  esac
done

require_tools docker jq curl python3

[ -n "${ALLEGRO_A_CONNECTION_ID:-}" ] || die "ALLEGRO_A_CONNECTION_ID is not set - source stand-ids.env (bootstrap.sh) or export it by hand"
[ -n "${PS_CONNECTION_ID:-}" ] || die "PS_CONNECTION_ID is not set - source stand-ids.env"
[ -n "${WC_CONNECTION_ID:-}" ] || die "WC_CONNECTION_ID is not set - source stand-ids.env"
SOURCE_CONNECTION_ID="${SOURCE_CONNECTION_ID:-$ALLEGRO_A_CONNECTION_ID}"
CONN_IDS="'$SOURCE_CONNECTION_ID'"

for f in $FAULTS; do
  case " $ALL_FAULTS " in
    *" $f "*) ;;
    *) die "unknown fault id '$f' - run --list for the catalogue" ;;
  esac
done

# Claimed before ANY side effect. This scenario repoints a shared connection,
# starts a container on the shared network, pauses the shared Redis and kills
# the shared worker - every one of which would silently invalidate a peer's
# window (#2842/#2848).
guard_stand_exclusive "f10-dependency-failure"

ol_login

# ===========================================================================
# Posture captured for restore, and the SINGLE EXIT trap
#
# bash's EXIT trap is one slot, so a second `trap ... EXIT` REPLACES
# guard_stand_exclusive's own release and leaves the stand locked for the full
# TTL after any `die` (F7 found that the hard way; F1 records the fix).
# Everything this scenario changes is undone from this one function.
# ===========================================================================
connection_json() { ol_api GET "/v1/connections/$1"; }

ORIGINAL_PS_CONFIG="$(connection_json "$PS_CONNECTION_ID" | jq -c '.config // {}')"
ORIGINAL_PS_BASE_URL="$(printf '%s' "$ORIGINAL_PS_CONFIG" | jq -r '.baseUrl // empty')"
[ -n "$ORIGINAL_PS_BASE_URL" ] || die "perf-prestashop carries no config.baseUrl - nothing to repoint, and nothing to restore"
ORIGINAL_ALLEGRO_CAPS="$(connection_json "$SOURCE_CONNECTION_ID" | jq -c '.enabledCapabilities // []')"
ORIGINAL_WC_CAPS="$(connection_json "$WC_CONNECTION_ID" | jq -c '.enabledCapabilities // []')"

ORIGINAL_REPLICAS="$(discover_worker_containers | wc -w | tr -d ' ')"
[ "$ORIGINAL_REPLICAS" -ge 1 ] || ORIGINAL_REPLICAS=1
# Read from the RUNNING container, never from an env file: the file is a
# request, the container's environment is what is in force, and on a
# multi-worktree checkout the file that was used may not even be this one.
ORIGINAL_RUNNER_ENABLED="$(docker exec "$(discover_worker_containers | awk '{print $1}')" printenv WORKER_RUNNER_ENABLED 2>/dev/null || printf '')"
[ -n "$ORIGINAL_RUNNER_ENABLED" ] || ORIGINAL_RUNNER_ENABLED=false

log "posture at start: perf-prestashop baseUrl=$ORIGINAL_PS_BASE_URL"
log "                  perf-allegro-a caps=$ORIGINAL_ALLEGRO_CAPS"
log "                  worker replicas=$ORIGINAL_REPLICAS runner=$ORIGINAL_RUNNER_ENABLED"

# A restore that CANNOT abort itself. Every lib.sh helper reaches `die` on
# failure and `die` calls `exit`; inside an EXIT trap that skips every later
# line, which here would be `release_stand_exclusive`. So the cleanup path
# uses raw curl and every call ends in `|| true`.
restore_curl() {
  local method="$1" path="$2" body="${3:-}"
  [ -n "${RESTORE_TOKEN:-}" ] || return 0
  curl -sS -o /dev/null -X "$method" "$OL_API_URL$path" \
    -H "Authorization: Bearer $RESTORE_TOKEN" -H 'Content-Type: application/json' \
    ${body:+-d "$body"} 2>/dev/null || true
}

# A run that changed nothing must restore nothing - a refused run's own
# cleanup path must never recreate or repoint anything underneath the peer
# that legitimately holds the stand (the F1 lesson).
CONNECTION_TOUCHED=0
PROXY_STARTED=0
WORKER_TOUCHED=0
WC_TOUCHED=0

# Declared HERE, above the trap, and not beside the function that fills them
# in. `set -u` is on, and an unset variable read inside an EXIT trap aborts
# the trap - which would skip `release_stand_exclusive` and leave the stand
# locked for the whole TTL after any early `die`. The trap must be able to run
# at every point after it is installed, including before any of this is
# resolved.
COMPOSE_WORKDIR=""
COMPOSE_FILE=""
COMPOSE_ENV_FILE=""
COMPOSE_PROJECT=""

f10_on_exit() {
  local rc=$?
  # Clear injector state first: it is cheap, idempotent, and leaving a fault
  # armed on a shared stub is the single worst thing this script could leave
  # behind - a peer's next window would measure OUR fault as their result.
  clear_all_faults || true

  if [ "$CONNECTION_TOUCHED" = "0" ] && [ "$PROXY_STARTED" = "0" ] && [ "$WORKER_TOUCHED" = "0" ] && [ "$WC_TOUCHED" = "0" ]; then
    log "nothing was changed on the stand - no restore needed"
    release_stand_exclusive
    return $rc
  fi

  log "restoring stand posture"
  RESTORE_TOKEN="$(curl -sS -X POST "$OL_API_URL/v1/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$OL_ADMIN_USER\",\"password\":\"$OL_ADMIN_PASSWORD\"}" 2>/dev/null \
    | jq -r '.access_token // .accessToken // empty' 2>/dev/null || printf '')"
  [ -n "$RESTORE_TOKEN" ] || warn "could not log in to restore perf-prestashop - its config.baseUrl is left pointing at the proxy. Restore by hand: PATCH /v1/connections/$PS_CONNECTION_ID with config=$ORIGINAL_PS_CONFIG"

  if [ "$CONNECTION_TOUCHED" = "1" ]; then
    restore_curl PATCH "/v1/connections/$PS_CONNECTION_ID" "$(jq -n --argjson c "$ORIGINAL_PS_CONFIG" '{config:$c}')"
    log "  perf-prestashop config restored to baseUrl=$ORIGINAL_PS_BASE_URL"
  fi

  if [ "$WC_TOUCHED" = "1" ]; then
    restore_curl PATCH "/v1/connections/$WC_CONNECTION_ID" "$(jq -n --argjson c "$ORIGINAL_WC_CAPS" '{enabledCapabilities:$c}')"
    log "  perf-woocommerce enabledCapabilities restored to $ORIGINAL_WC_CAPS"
  fi

  # The proxy container is removed LAST, after the connection has been
  # repointed away from it - the other order leaves a window in which
  # OpenLinker is pointed at a host that no longer resolves.
  if [ "$PROXY_STARTED" = "1" ]; then
    docker rm -f "$PROXY_CONTAINER" >/dev/null 2>&1 || true
    log "  $PROXY_CONTAINER removed"
  fi

  # The runner posture is put back the way it was found. A stand left with the
  # runner ENABLED that shipped it disabled is a changed stand, and the next
  # scenario's `guard_runner_state disabled` would refuse against a state this
  # run created.
  if [ "$WORKER_TOUCHED" = "1" ] && [ "$ORIGINAL_RUNNER_ENABLED" != "true" ]; then
    log "  restoring WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED"
    local args=(-f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT")
    [ -z "$COMPOSE_ENV_FILE" ] || args+=(--env-file "$COMPOSE_ENV_FILE")
    ( cd "$COMPOSE_WORKDIR" && WORKER_RUNNER_ENABLED="$ORIGINAL_RUNNER_ENABLED" \
        docker compose "${args[@]}" up -d --no-deps --scale "worker=$ORIGINAL_REPLICAS" worker >/dev/null 2>&1 ) || true
  fi

  # Redis and the worker are restored inside their own arms rather than here,
  # because a window that stopped them must not run its ledger read against a
  # stopped stand. This is the belt-and-braces pass for an abort mid-arm.
  if [ "$(docker inspect -f '{{.State.Running}}' "$REDIS_CONTAINER" 2>/dev/null || printf true)" != "true" ]; then
    warn "  $REDIS_CONTAINER is not running - starting it"
    docker start "$REDIS_CONTAINER" >/dev/null 2>&1 || true
  fi
  local w
  for w in $WORKER_CONTAINERS; do
    if [ "$(docker inspect -f '{{.State.Running}}' "$w" 2>/dev/null || printf true)" != "true" ]; then
      warn "  $w is not running - starting it"
      docker start "$w" >/dev/null 2>&1 || true
    fi
  done

  release_stand_exclusive
  return $rc
}
trap 'f10_on_exit' EXIT

# ===========================================================================
# The worker's runner posture
#
# The lab stand ships WORKER_RUNNER_ENABLED=false (docker-compose.lab.yml's
# own default), so a scenario that needs jobs to actually execute has to
# recreate the worker - the variable is read at boot. F1 and F4 do the same.
#
# WHERE THE RECREATE IS RUN FROM IS A CORRECTNESS QUESTION, NOT A DETAIL.
#
# This repository is checked out as several worktrees, and the running stack
# was brought up from ONE of them - not necessarily this one. Two things
# differ between worktrees and both would silently change the container:
#
#   - docker-compose.lab.yml itself. The tree that launched this stand is on
#     an older commit whose worker service does not carry the #2867 lane-cap
#     passthrough keys; recreating from here would add eight of them.
#   - the wc-tls certificate the worker bind-mounts. `certs/` is gitignored,
#     so it exists only in the worktree that generated it. Recreating from a
#     worktree without it makes docker CREATE AN EMPTY DIRECTORY at the
#     bind-mount path, and the worker then starts with a directory where
#     NODE_EXTRA_CA_CERTS expects a file.
#
# So the compose context is READ BACK from the running container's own
# labels rather than assumed to be this checkout - the same
# verify-what-is-in-force rule the rest of this harness applies to
# configuration. The recreated worker is then byte-identical to the running
# one except for the single variable being changed.
#
# That variable is passed in the SHELL ENVIRONMENT, not by editing the
# stand's .env.lab: compose's interpolation precedence puts the shell above
# --env-file, and a scenario has no business rewriting a file that belongs to
# another worktree. It is verified rather than trusted - the value is read
# back out of the recreated container before anything is measured.
# ===========================================================================
resolve_compose_context() {
  _ensure_worker_containers
  local w
  w="$(printf '%s' "$WORKER_CONTAINERS" | awk '{print $1}')"
  COMPOSE_WORKDIR="$(docker inspect "$w" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>/dev/null || printf '')"
  COMPOSE_FILE="$(docker inspect "$w" --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' 2>/dev/null || printf '')"
  COMPOSE_ENV_FILE="$(docker inspect "$w" --format '{{index .Config.Labels "com.docker.compose.project.environment_file"}}' 2>/dev/null || printf '')"
  COMPOSE_PROJECT="$(docker inspect "$w" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || printf 'lab')"
  [ -n "$COMPOSE_WORKDIR" ] && [ -d "$COMPOSE_WORKDIR" ] \
    || die "resolve_compose_context: $w carries no usable com.docker.compose.project.working_dir label (got '$COMPOSE_WORKDIR') - this stand was not brought up by compose, and recreating the worker from a guess would change more than the runner flag"
  [ -f "$COMPOSE_FILE" ] \
    || die "resolve_compose_context: the compose file this stand was brought up with ($COMPOSE_FILE) does not exist"
  log "compose context (read from $w's own labels, never assumed to be this checkout):"
  log "  workdir=$COMPOSE_WORKDIR"
  log "  file=$COMPOSE_FILE"
  log "  envFile=${COMPOSE_ENV_FILE:-<none>} project=$COMPOSE_PROJECT"
}

# recreate_worker <runner:true|false>
recreate_worker() {
  local runner="$1" tries hits w found
  WORKER_TOUCHED=1
  local args=(-f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT")
  [ -z "$COMPOSE_ENV_FILE" ] || args+=(--env-file "$COMPOSE_ENV_FILE")
  ( cd "$COMPOSE_WORKDIR" && WORKER_RUNNER_ENABLED="$runner" \
      docker compose "${args[@]}" up -d --no-deps --scale "worker=$ORIGINAL_REPLICAS" worker >/dev/null 2>&1 ) \
    || die "recreate_worker: compose refused to recreate the worker service from $COMPOSE_WORKDIR"

  # The discovery cache in lib.sh is stale by construction after a recreate.
  WORKER_CONTAINERS=""
  WORKER_CONTAINERS_RESOLVED=0
  _ensure_worker_containers
  found="$(discover_worker_containers | wc -w | tr -d ' ')"
  [ "$found" -eq "$ORIGINAL_REPLICAS" ] || die "recreate_worker: expected $ORIGINAL_REPLICAS replica(s), discovery found $found"

  # ASKED IS NOT GOT. The shell-over-env-file interpolation precedence this
  # relies on is read back out of the container rather than trusted - a
  # scenario that measured a runner posture it did not get would be the
  # reported-versus-enforced gap this campaign keeps closing.
  for w in $WORKER_CONTAINERS; do
    local got
    got="$(docker exec "$w" printenv WORKER_RUNNER_ENABLED 2>/dev/null || printf '<unset>')"
    [ "$got" = "$runner" ] \
      || die "recreate_worker: asked for WORKER_RUNNER_ENABLED=$runner, $w reports '$got' - compose did not take the shell override, so this run would have measured the wrong posture"
  done

  if [ "$runner" = "true" ]; then
    for w in $WORKER_CONTAINERS; do
      tries=0
      while true; do
        # `grep -c`, never `grep -q`: -q closes the pipe on the first match
        # and `set -o pipefail` then fails the pipeline on the very reading
        # that succeeded.
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
  log "worker recreated: runner=$runner (verified from the container), replicas=$ORIGINAL_REPLICAS"
}

# ===========================================================================
# Injector control surfaces
# ===========================================================================

# --- the PrestaShop fault proxy -------------------------------------------
pfp_curl() {
  local method="$1" path="$2" body="${3:-}" resp status resp_body
  if [ -n "$body" ]; then
    resp="$(curl -sS -w '\n%{http_code}' -X "$method" "$PROXY_URL$path" \
      -H 'Content-Type: application/json' -d "$body")"
  else
    resp="$(curl -sS -w '\n%{http_code}' -X "$method" "$PROXY_URL$path")"
  fi
  status="${resp##*$'\n'}"
  resp_body="${resp%$'\n'*}"
  if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
    die "ps-fault-proxy $method $path -> HTTP $status: $resp_body"
  fi
  printf '%s' "$resp_body"
}

pfp_start() {
  docker rm -f "$PROXY_CONTAINER" >/dev/null 2>&1 || true
  docker image inspect "$PROXY_IMAGE" >/dev/null 2>&1 \
    || die "image $PROXY_IMAGE does not exist - build it first:
  cd $SCRIPT_DIR/../stubs/ps-fault-proxy && docker build -t $PROXY_IMAGE --build-arg PROXY_GIT_SHA=\$(git rev-parse HEAD) ."
  docker run -d --name "$PROXY_CONTAINER" \
    --network "$PROXY_NETWORK" --network-alias "$PROXY_SERVICE_HOST" \
    -p "127.0.0.1:$PROXY_HOST_PORT:8080" \
    -e PROXY_UPSTREAM_HOST=prestashop -e PROXY_UPSTREAM_PORT=80 \
    -e PROXY_UPSTREAM_HOST_HEADER=prestashop \
    "$PROXY_IMAGE" >/dev/null \
    || die "could not start $PROXY_CONTAINER on network $PROXY_NETWORK"
  PROXY_STARTED=1
  local waited=0
  while [ "$waited" -lt 30 ]; do
    if curl -sSf "$PROXY_URL/__fault/health" >/dev/null 2>&1; then
      log "$PROXY_CONTAINER up: $(pfp_curl GET /__fault/health | jq -c .)"
      return 0
    fi
    sleep 1; waited=$((waited + 1))
  done
  die "$PROXY_CONTAINER did not answer /__fault/health within 30s
$(docker logs "$PROXY_CONTAINER" 2>&1 | tail -20)"
}

pfp_rule_clear() { pfp_curl DELETE /__fault >/dev/null; }
pfp_stats_reset() { pfp_curl POST /__fault/reset '{}' >/dev/null; }
pfp_stats() { pfp_curl GET /__fault/stats; }

# --- the Allegro stub ------------------------------------------------------
stub_fault_set() { of_curl POST "/__stub/tenants/$SOURCE_TENANT/fault" "$1"; }
stub_fault_clear() { of_curl DELETE "/__stub/tenants/$SOURCE_TENANT/fault" >/dev/null; }
stub_stats() { of_curl GET "/__stub/tenants/$SOURCE_TENANT/stats"; }

clear_all_faults() {
  curl -sS -X DELETE "$PROXY_URL/__fault" >/dev/null 2>&1 || true
  curl -sS -X DELETE "$OF_STUB_URL/__stub/tenants/$SOURCE_TENANT/fault" >/dev/null 2>&1 || true
}

# ===========================================================================
# install_fault <id> - installs the rule and ECHOES the rule as the injector
# stored it, as a JSON object. The single place a rule is expressed.
#
# The echoed value is read back from the injector, never echoed from what was
# asked for: the two can differ (a default resolved at install time, a field
# the injector normalised) and the manifest must record what is in force.
# ===========================================================================
install_fault() {
  local id="$1"
  case "$id" in
    baseline)
      jq -n '{injected:false, note:"no rule installed; the proxy is in the request path and transparent"}'
      ;;
    D1)
      # A fraction rather than every call: a shop that 500s on everything is
      # an outage, and an outage is a less interesting question than a shop
      # that hiccups - the hiccup is what produces a PARTIALLY completed
      # order, which is where a swallowed failure hides.
      jq -n --argjson r "$(pfp_curl POST /__fault '{"mode":"500","fraction":0.3}')" \
        '{injected:true, injector:"ps-fault-proxy", rule:$r.rule}'
      ;;
    D2a)
      jq -n --argjson r "$(pfp_curl POST /__fault '{"mode":"429","fraction":0.5,"retryAfterSeconds":5}')" \
        '{injected:true, injector:"ps-fault-proxy", rule:$r.rule}'
      ;;
    D2b)
      # An explicit null, not an omitted field - the stored rule must say
      # "send no Retry-After", which is a different measurement from the
      # arm above and not merely an unset default.
      jq -n --argjson r "$(pfp_curl POST /__fault '{"mode":"429","fraction":0.5,"retryAfterSeconds":null}')" \
        '{injected:true, injector:"ps-fault-proxy", rule:$r.rule}'
      ;;
    D3)
      # 45s exceeds the webservice client's own 30s per-attempt AbortController
      # timeout (prestashop-webservice.client.ts) and stays under the module
      # HMAC's +/-5 minute skew window, so a held request fails as a timeout
      # rather than as a signature rejection.
      jq -n --argjson r "$(pfp_curl POST /__fault '{"mode":"hang","fraction":0.3,"hangMs":45000}')" \
        '{injected:true, injector:"ps-fault-proxy", rule:$r.rule}'
      ;;
    D4)
      # The partial create. `controller=importorder` is the OL module's own
      # front-controller path (prestashop-openlinker-module.client.ts's
      # IMPORTORDER_PATH); every webservice call that builds the cart before
      # it passes through untouched, and the proxy's per-bucket counters
      # prove that rather than assuming it.
      jq -n --argjson r "$(pfp_curl POST /__fault '{"mode":"500","fraction":1,"pathIncludes":"controller=importorder"}')" \
        '{injected:true, injector:"ps-fault-proxy", rule:$r.rule}'
      ;;
    M1)
      # `checkout` only. A tenant-wide timeout would stop the FEED being read
      # too, so no order would ever be hydrated and the window would measure
      # nothing about hydration at all.
      jq -n --argjson r "$(stub_fault_set '{"mode":"timeout","endpoints":["checkout"],"holdMs":35000}')" \
        '{injected:true, injector:"allegro-stub", rule:$r.fault}'
      ;;
    M2)
      jq -n --argjson r "$(stub_fault_set '{"mode":"malformed","endpoints":["checkout"],"fraction":0.5}')" \
        '{injected:true, injector:"allegro-stub", rule:$r.fault}'
      ;;
    M2t)
      jq -n --argjson r "$(stub_fault_set '{"mode":"truncated","endpoints":["events"],"fraction":0.5}')" \
        '{injected:true, injector:"allegro-stub", rule:$r.fault}'
      ;;
    M3)
      jq -n --argjson r "$(stub_fault_set '{"mode":"reject-quantity","endpoints":["quantity"]}')" \
        '{injected:true, injector:"allegro-stub", rule:$r.fault}'
      ;;
    I1)
      # CLIENT PAUSE, not DEBUG SLEEP: DEBUG is disabled by default on Redis
      # 7+ (verified refused on this stand). PAUSE stalls command processing
      # for every client, which is the blocked-client shape #2975 found -
      # the shared 'REDIS_CLIENT' occupied while the rate limiter waits on
      # its own 1000ms budget - rather than a server that is merely slower.
      jq -n --arg ms "$REDIS_PAUSE_MS" --arg every "$REDIS_PAUSE_EVERY_SECS" \
        '{injected:true, injector:"redis:CLIENT PAUSE",
          rule:{pauseMs:($ms|tonumber), everySecs:($every|tonumber), scope:"ALL"}}'
      ;;
    I2)
      jq -n --arg at "$MIDWINDOW_AT_SECS" \
        '{injected:true, injector:"docker stop/start",
          rule:{target:"redis", atSecondsIntoWindow:($at|tonumber), action:"docker stop, then docker start"}}'
      ;;
    I3)
      jq -n --arg at "$MIDWINDOW_AT_SECS" \
        '{injected:true, injector:"docker kill -s KILL / docker start",
          rule:{target:"worker", atSecondsIntoWindow:($at|tonumber), signal:"SIGKILL"}}'
      ;;
    *) die "install_fault: unknown fault id $id" ;;
  esac
}

REDIS_PAUSE_MS="${REDIS_PAUSE_MS:-3000}"
REDIS_PAUSE_EVERY_SECS="${REDIS_PAUSE_EVERY_SECS:-6}"
MIDWINDOW_AT_SECS="${MIDWINDOW_AT_SECS:-35}"
WORKER_RUNNER_LINES_BEFORE_KILL=0

# ===========================================================================
# The mid-window infrastructure actions. Each runs as a background job whose
# pid is recorded, so a window can always stop it.
# ===========================================================================
MIDWINDOW_PID=""

start_midwindow_action() {
  local id="$1"
  case "$id" in
    I1)
      ( while true; do
          docker exec -i "$REDIS_CONTAINER" redis-cli CLIENT PAUSE "$REDIS_PAUSE_MS" ALL >/dev/null 2>&1 || true
          sleep "$REDIS_PAUSE_EVERY_SECS"
        done ) &
      MIDWINDOW_PID=$!
      log "  redis CLIENT PAUSE ${REDIS_PAUSE_MS}ms every ${REDIS_PAUSE_EVERY_SECS}s (pid=$MIDWINDOW_PID)"
      ;;
    I2)
      ( sleep "$MIDWINDOW_AT_SECS"
        docker stop "$REDIS_CONTAINER" >/dev/null 2>&1 || true
        sleep 20
        docker start "$REDIS_CONTAINER" >/dev/null 2>&1 || true ) &
      MIDWINDOW_PID=$!
      log "  redis will be stopped ${MIDWINDOW_AT_SECS}s into the window and started again 20s later (pid=$MIDWINDOW_PID)"
      ;;
    I3)
      # Counted BEFORE the kill so `restore_infrastructure` can wait for a NEW
      # runner-loop line rather than for the presence of one - `docker start`
      # preserves the log, so the old line is still there and a mere `grep -q`
      # would answer "ready" the instant the container was started.
      WORKER_RUNNER_LINES_BEFORE_KILL=0
      local wc
      for wc in $WORKER_CONTAINERS; do
        WORKER_RUNNER_LINES_BEFORE_KILL=$(( WORKER_RUNNER_LINES_BEFORE_KILL + $(docker logs "$wc" 2>&1 | grep -cF 'Starting sync job runner loop' || true) ))
      done
      ( sleep "$MIDWINDOW_AT_SECS"
        local w
        for w in $WORKER_CONTAINERS; do docker kill -s KILL "$w" >/dev/null 2>&1 || true; done
        sleep 10
        for w in $WORKER_CONTAINERS; do docker start "$w" >/dev/null 2>&1 || true; done ) &
      MIDWINDOW_PID=$!
      log "  worker(s) [$WORKER_CONTAINERS] will be SIGKILLed ${MIDWINDOW_AT_SECS}s into the window and started again 10s later (pid=$MIDWINDOW_PID)"
      ;;
    *) MIDWINDOW_PID="" ;;
  esac
}

stop_midwindow_action() {
  [ -n "$MIDWINDOW_PID" ] || return 0
  kill "$MIDWINDOW_PID" >/dev/null 2>&1 || true
  wait "$MIDWINDOW_PID" 2>/dev/null || true
  MIDWINDOW_PID=""
}

# Brings the stand back after an infrastructure arm, and RE-ASSERTS the stand
# lock. Redis holds that lock, so stopping Redis can lose it - and a lost lock
# on a shared stand means a peer can start measuring on top of this run.
# Re-taking it is not optional housekeeping.
restore_infrastructure() {
  local id="$1" waited=0
  case "$id" in
    I2)
      docker start "$REDIS_CONTAINER" >/dev/null 2>&1 || true
      local pong
      while [ "$waited" -lt 60 ]; do
        # Captured into a variable and then tested, never piped into
        # `grep -q`: `grep -q` closes the pipe on its first match, the slow
        # `docker exec` producer takes SIGPIPE, and under `pipefail` the
        # pipeline then reports FAILURE on the very reading that succeeded.
        # This campaign has been bitten by that shape already.
        pong="$(docker exec -i "$REDIS_CONTAINER" redis-cli PING 2>/dev/null || printf '')"
        case "$pong" in *PONG*) break ;; esac
        sleep 1; waited=$((waited + 1))
      done
      log "  redis answered PING after ${waited}s"
      local holder
      holder="$(redis_cli GET "$STAND_LOCK_KEY" 2>/dev/null || printf '')"
      if [ -z "$holder" ]; then
        warn "  the stand lock did not survive the redis restart - re-taking it"
        redis_cli SET "$STAND_LOCK_KEY" "f10-dependency-failure:pid$$@$(hostname):$(iso_now)" NX EX "$STAND_LOCK_TTL_SECS" >/dev/null 2>&1 || true
      fi
      ;;
    I3)
      local w
      for w in $WORKER_CONTAINERS; do docker start "$w" >/dev/null 2>&1 || true; done
      # Waited for by its own startup line, never by a fixed sleep. The NEXT
      # window's `window_start` calls `reassert_volatile_guards`, which runs
      # `guard_runner_state enabled` and DIES if the runner loop line is not
      # in the log - so a worker that is merely `Running` but has not booted
      # yet would abort the whole remaining run at the next window rather
      # than at this one. `docker start` preserves the log, so the line this
      # greps for may be the previous boot's; it is the readiness of the
      # PROCESS that the count below establishes.
      local want_lines have_lines
      want_lines="$WORKER_RUNNER_LINES_BEFORE_KILL"
      while [ "$waited" -lt 120 ]; do
        have_lines=0
        for w in $WORKER_CONTAINERS; do
          have_lines=$(( have_lines + $(docker logs "$w" 2>&1 | grep -cF 'Starting sync job runner loop' || true) ))
        done
        [ "$have_lines" -le "${want_lines:-0}" ] || break
        sleep 2; waited=$((waited + 2))
      done
      log "  worker(s) started again and re-announced the runner loop after ${waited}s (runner lines ${want_lines:-0} -> ${have_lines:-0})"
      ;;
  esac
}

# ===========================================================================
# Load
# ===========================================================================
PUMP_PID=""

start_order_pump() {
  local tag="$1"
  ( while true; do
      # Inside a command substitution: of_enqueue_poll reaches ol_api, which
      # dies on any non-2xx, and a direct call would take the pump's subshell
      # down with it - so the window would silently stop offering load from
      # that moment on. Under an infrastructure fault a non-2xx from the API
      # is EXPECTED, which makes this containment load-bearing here rather
      # than merely defensive.
      : "$(of_enqueue_poll "$SOURCE_CONNECTION_ID" "$tag" 2>/dev/null || printf '')"
      sleep "$POLL_CADENCE_SECS"
    done ) &
  PUMP_PID=$!
}

stop_order_pump() {
  [ -n "$PUMP_PID" ] || return 0
  kill "$PUMP_PID" >/dev/null 2>&1 || true
  wait "$PUMP_PID" 2>/dev/null || true
  PUMP_PID=""
}

resolve_quantity_offer_ids() {
  pg_sql "SELECT \"internalId\" FROM identifier_mappings
          WHERE \"entityType\"='Offer' AND \"connectionId\"='$SOURCE_CONNECTION_ID'
          ORDER BY \"externalId\" LIMIT $QUANTITY_JOBS"
}

enqueue_quantity_jobs() {
  local tag="$1" n=0 offer
  while IFS= read -r offer; do
    [ -n "$offer" ] || continue
    n=$((n + 1))
    : "$(enqueue_perf_job 'marketplace.offerQuantity.update' "$SOURCE_CONNECTION_ID" \
        "$(jq -n --arg o "$offer" --argjson q $((10 + n)) '{schemaVersion:1, offerId:$o, quantity:$q}')" \
        "f10:$tag:qty:$offer:$(date +%s%3N)" 2>/dev/null || printf '')"
    # `docker exec -i` inside a `while read` loop drains the loop's own stdin
    # and silently reduces a multi-row iteration to ONE row - this campaign
    # has been bitten by it twice. `resolve_quantity_offer_ids` is therefore
    # materialised into a here-string BEFORE the loop (see the caller) and
    # nothing inside the body reads stdin.
  done <<< "$QUANTITY_OFFER_IDS"
  printf '%s' "$n"
}

# ===========================================================================
# The ledger read - four tables, one JSON document, per window.
# ===========================================================================

# ps_max_ids - PrestaShop's own highest order and cart ids, so the window's
# creates can be counted without trusting a clock shared across two engines.
ps_max_order_id() { ps_sql "SELECT COALESCE(MAX(id_order),0) FROM ps_orders" | tr -d '[:space:]'; }
ps_max_cart_id()  { ps_sql "SELECT COALESCE(MAX(id_cart),0)  FROM ps_cart"   | tr -d '[:space:]'; }

read_ledger() {
  local dir="$1" ws_iso="$2" ps_order_before="$3" ps_cart_before="$4" load="$5"
  local jobs_json orders_json ss_json claimed_total claimed_missing
  local ps_order_after ps_cart_after

  ps_order_after="$(ps_max_order_id)"
  ps_cart_after="$(ps_max_cart_id)"

  # 1. sync_jobs, grouped exactly as the runner writes them. `outcome` and
  #    `outcomeReason` are read, never derived from `status`: ADR-007 splits
  #    them precisely because a succeeded job can carry a business failure.
  jobs_json="$(pg_sql "SELECT COALESCE(jsonb_agg(r), '[]'::jsonb) FROM (
      SELECT \"jobType\" AS job_type, status, outcome, \"outcomeReason\" AS outcome_reason,
             COUNT(*)::int AS n,
             SUM(attempts)::int AS attempts_total,
             MAX(attempts)::int AS attempts_max,
             -- A `dead` row the HARNESS produced must never read as one the
             -- system dead-lettered. drain_wait stamps its own lastError when
             -- it times out; the ledger below is read before that runs, so
             -- this should be 0 everywhere - it is carried so that if the
             -- ordering is ever broken, the contamination is visible in the
             -- data rather than only in a comment.
             COUNT(*) FILTER (WHERE \"lastError\" LIKE '%perf harness drain_wait timeout%')::int AS killed_by_harness,
             COUNT(*) FILTER (WHERE COALESCE(\"deferredTotalMs\",0) > 0)::int AS deferred_rows,
             COALESCE(SUM(\"deferredTotalMs\"),0)::bigint AS deferred_ms_total,
             COALESCE(SUM(\"lastAttemptDurationMs\"),0)::bigint AS attempt_ms_total,
             COUNT(*) FILTER (WHERE \"lastAttemptDurationMs\" IS NOT NULL)::int AS attempt_ms_rows
      FROM sync_jobs
      WHERE \"connectionId\" IN ($CONN_IDS) AND \"createdAt\" >= '$ws_iso'
      GROUP BY 1,2,3,4 ORDER BY 1,2,3,4) r" 2>/dev/null || printf '[]')"

  # A sample of the distinct error texts, so the report can quote what the
  # system actually said rather than paraphrase it.
  local errors_json
  errors_json="$(pg_sql "SELECT COALESCE(jsonb_agg(r), '[]'::jsonb) FROM (
      SELECT left(\"lastError\", 300) AS last_error, COUNT(*)::int AS n
      FROM sync_jobs
      WHERE \"connectionId\" IN ($CONN_IDS) AND \"createdAt\" >= '$ws_iso' AND \"lastError\" IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC LIMIT 8) r" 2>/dev/null || printf '[]')"

  if [ "$load" = "order" ]; then
    # 2. order_records created in the window.
    # `SUM(c)`, not `COUNT(*)`. The first calibration run had `COUNT(*)` here,
    # which counts the rows of the SUBQUERY - the number of distinct
    # recordStatus values - and duly reported `created: 1` beside four orders
    # claimed synced.
    orders_json="$(pg_sql "SELECT jsonb_build_object(
        'created', COALESCE(SUM(c),0)::int,
        'recordStatus', COALESCE(jsonb_object_agg(rs, c) FILTER (WHERE rs IS NOT NULL), '{}'::jsonb))
      FROM (SELECT \"recordStatus\" AS rs, COUNT(*)::int AS c
            FROM order_records
            WHERE \"sourceConnectionId\"='$SOURCE_CONNECTION_ID' AND \"createdAt\" >= '$ws_iso'
            GROUP BY 1) s" 2>/dev/null || printf '{}')"

    # 3. the destination fan-out, per status. An order with an EMPTY
    #    syncStatus is counted separately from one carrying a 'failed' entry:
    #    they are different failures (never attempted vs attempted and
    #    refused) and collapsing them would hide the first.
    ss_json="$(pg_sql "SELECT jsonb_build_object(
        'ordersWithNoSyncStatus', COUNT(*) FILTER (WHERE jsonb_array_length(\"syncStatus\") = 0)::int,
        'entriesSynced', COALESCE(SUM((SELECT COUNT(*) FROM jsonb_array_elements(\"syncStatus\") e WHERE e->>'status'='synced')),0)::int,
        'entriesFailed', COALESCE(SUM((SELECT COUNT(*) FROM jsonb_array_elements(\"syncStatus\") e WHERE e->>'status'='failed')),0)::int,
        'entriesOther',  COALESCE(SUM((SELECT COUNT(*) FROM jsonb_array_elements(\"syncStatus\") e WHERE e->>'status' NOT IN ('synced','failed'))),0)::int)
      FROM order_records
      WHERE \"sourceConnectionId\"='$SOURCE_CONNECTION_ID' AND \"createdAt\" >= '$ws_iso'" 2>/dev/null || printf '{}')"

    # 4. GROUND TRUTH. Every destination-native order id OpenLinker CLAIMS to
    #    have created in this window, checked against PrestaShop's own table.
    #    This is the only reconciliation in the campaign whose witness is not
    #    OpenLinker, and it is the whole answer to "does any surface report
    #    success on a failed path".
    #
    #    PROVEN ABLE TO FIRE before the run, against live data on this stand,
    #    rather than assumed: three genuinely-claimed ids answered 3 present
    #    (missing 0), and the same query with one id replaced by a fabricated
    #    999999 answered 2 present (missing 1). A detector nobody has seen go
    #    red is a detector that reports zero for the wrong reason.
    local claimed_ids
    claimed_ids="$(pg_sql "SELECT string_agg(DISTINCT e->>'externalOrderId', ',')
      FROM order_records o, jsonb_array_elements(o.\"syncStatus\") e
      WHERE o.\"sourceConnectionId\"='$SOURCE_CONNECTION_ID' AND o.\"createdAt\" >= '$ws_iso'
        AND e->>'status'='synced' AND e->>'destinationConnectionId'='$PS_CONNECTION_ID'
        AND e->>'externalOrderId' IS NOT NULL" 2>/dev/null | tr -d '[:space:]' || printf '')"
    if [ -n "$claimed_ids" ]; then
      claimed_total="$(printf '%s' "$claimed_ids" | tr ',' '\n' | grep -c . || true)"
      # `grep -c` under `pipefail` returns 1 when it matches nothing, which
      # would abort the run on a legitimately empty set - hence `|| true`
      # above, and hence reading the count rather than testing the exit code.
      local present
      present="$(ps_sql "SELECT COUNT(DISTINCT id_order) FROM ps_orders WHERE id_order IN ($claimed_ids)" | tr -d '[:space:]')"
      claimed_missing=$(( ${claimed_total:-0} - ${present:-0} ))
    else
      claimed_total=0
      claimed_missing=0
    fi
  else
    orders_json='{"created":0,"recordStatus":{},"note":"quantity-write load path - no orders are ingested"}'
    ss_json='{"note":"quantity-write load path - no destination fan-out"}'
    claimed_total=0
    claimed_missing=0
  fi

  jq -n \
    --argjson jobs "$jobs_json" \
    --argjson errors "$errors_json" \
    --argjson orders "$orders_json" \
    --argjson syncStatus "$ss_json" \
    --argjson claimedSynced "${claimed_total:-0}" \
    --argjson claimedMissingAtDestination "${claimed_missing:-0}" \
    --argjson psOrdersCreated "$(( ${ps_order_after:-0} - ${ps_order_before:-0} ))" \
    --argjson psCartsCreated "$(( ${ps_cart_after:-0} - ${ps_cart_before:-0} ))" \
    '{
      syncJobs: $jobs,
      lastErrors: $errors,
      orderRecords: $orders,
      destinationFanOut: $syncStatus,
      groundTruth: {
        psOrdersCreated: $psOrdersCreated,
        psCartsCreated: $psCartsCreated,
        claimedSyncedToPrestashop: $claimedSynced,
        claimedButAbsentFromPsOrders: $claimedMissingAtDestination,
        note: "claimedButAbsentFromPsOrders > 0 is a success report over a failure: OpenLinker recorded syncStatus.status=synced with an externalOrderId that names no row in the shop.\nA nonzero psCartsCreated alongside a zero psOrdersCreated is an orphaned cart - work done at the destination that produced no order."
      }
    }' > "$dir/ledger.json"
  log "  ledger: $(jq -c '{orders:.orderRecords.created, psOrders:.groundTruth.psOrdersCreated, psCarts:.groundTruth.psCartsCreated, claimedSynced:.groundTruth.claimedSyncedToPrestashop, claimedMissing:.groundTruth.claimedButAbsentFromPsOrders}' "$dir/ledger.json")"
}

# ===========================================================================
# The verdict, split by guard ROLE - see the header for why the standard set
# is not used wholesale.
# ===========================================================================
run_f10_guards() {
  local dir="$1" ws_iso="$2" ws_epoch="$3" we_epoch="$4" fault_id="$5" load="$6"
  local stand_reasons=() observations=() answer

  # --- STAND guards: these still discard --------------------------------
  #
  # A NARROWED post_guard_requeues, and the narrowing is a correction rather
  # than a relaxation.
  #
  # lib.sh's version matches "was running+locked in the snapshot, is unlocked
  # now, attempts unchanged". It has no filter on the job's CURRENT status -
  # and `SyncJobRepository.markSucceeded` sets `lockedAt: null` while leaving
  # `attempts` alone, so an ordinary job that was simply RUNNING when the
  # snapshot was taken and has since SUCCEEDED matches the signature exactly.
  #
  # Every other scenario snapshots a quiet queue, so it never sees this. F10
  # cannot: its windows run back to back, and one order on this path spawns
  # roughly three downstream jobs (master.inventory.syncByExternalId ->
  # inventory.propagateToMarketplaces -> one marketplace.offerQuantity.update
  # per marketplace connection), so there is essentially always something
  # running when the next window's snapshot is taken. The first measured
  # baseline was DISCARDED on four such rows, all of which had merely
  # finished.
  #
  # Adding `j.status IN ('queued','running')` keeps the case the guard exists
  # to catch - a row the recovery pass moved that this window is about to
  # count - and drops the case it cannot distinguish and does not care about,
  # a row that completed. It is deliberately still imperfect and says so: a
  # requeue followed by a success is invisible to both versions, because
  # `requeueStuckJobs` touches neither `attempts` nor anything else that
  # would separate it from an ordinary completion. Fixing the shared guard is
  # a follow-up, not something to do inside the run it would score.
  answer="$(pg_sql "SELECT COUNT(*) FROM _perf_sync_jobs_snapshot s
      JOIN sync_jobs j ON j.id = s.id
      WHERE s.status='running' AND s.\"lockedAt\" IS NOT NULL
        AND j.\"lockedAt\" IS NULL AND j.attempts = s.attempts
        AND j.status IN ('queued','running')" 2>/dev/null || printf 0)"
  if [ "${answer:-0}" -gt 0 ]; then
    stand_reasons+=("DISCARDED f10_post_guard_requeues: $answer non-terminal job(s) show StuckJobRecoveryService's requeue signature")
  fi
  pg_sql_write "DROP TABLE IF EXISTS _perf_sync_jobs_snapshot" >/dev/null

  answer="$(post_guard_containers_stable "$dir")"
  if [ "$answer" != "ok" ]; then
    if [ "$fault_id" = "I3" ] || [ "$fault_id" = "I2" ]; then
      # The restart IS the declared fault. Recorded as an observation so the
      # window is not silently exempted from a guard it genuinely tripped.
      observations+=("EXPECTED-BY-FAULT $answer")
    else
      stand_reasons+=("$answer")
    fi
  fi

  # --- FAULT guards: their answers ARE the measurement -------------------
  observations+=("$(post_guard_attempts "$CONN_IDS" "$ws_iso")")
  observations+=("$(post_guard_deferrals "$CONN_IDS" "$ws_iso")")
  observations+=("$(post_guard_destination_creates "$ws_iso" "$PS_CONNECTION_ID")")
  observations+=("$(post_guard_limiter_degraded "$ws_epoch" "$we_epoch")")

  # WAS THE INTENDED LOAD ACTUALLY OFFERED?
  #
  # This replaces `post_guard_feed_starved`, and it is a different question
  # rather than a cheaper version of the same one. That guard protects a
  # SATURATION measurement: it asks whether a standing supply ever ran dry,
  # because a throughput figure taken while the generator was empty measures
  # the generator. F10 offers a FIXED BATCH on purpose (see WINDOW_BACKLOG), so
  # the upstream feed draining is the expected and desired end state - the
  # first calibration run's check would have flagged STARVED on every window
  # for doing exactly what it was told to do.
  #
  # What has to be true here instead is that every order pushed at the stub
  # became a child job. If it did not, the window offered less work than it
  # claims and every count below is against the wrong denominator.
  if [ "$load" = "order" ]; then
    local children
    children="$(pg_sql "SELECT COUNT(*) FROM sync_jobs
      WHERE \"jobType\" IN ('marketplace.order.sync')
        AND \"connectionId\" IN ($CONN_IDS) AND \"createdAt\" >= '$ws_iso'" 2>/dev/null || printf 'unknown')"
    case "$children" in
      unknown) observations+=("UNKNOWN offered_work: the child-job count could not be read, so this window cannot show the intended load was offered") ;;
      *)
        if [ "${children:-0}" -lt "$WINDOW_BACKLOG" ]; then
          observations+=("UNDER-OFFERED offered_work: $children of $WINDOW_BACKLOG pushed order(s) became a marketplace.order.sync child - every per-order figure in this window is against a smaller denominator than the manifest's offeredBacklog")
        else
          observations+=("ok offered_work: $children child job(s) for $WINDOW_BACKLOG pushed order(s) - the intended load reached the queue")
        fi
        ;;
    esac
  else
    observations+=("n/a offered_work: the quantity-write path enqueues its jobs directly and pushes nothing at the stub")
  fi

  printf '%s\n' "${observations[@]}" > "$dir/fault-observations.txt"
  log "  fault observations:"
  local o; for o in "${observations[@]}"; do log "    $o"; done

  if [ "${#stand_reasons[@]}" -eq 0 ]; then
    verdict_write "$dir" VALID
  else
    verdict_write "$dir" DISCARDED "${stand_reasons[@]}"
  fi
}

# ===========================================================================
# One fault, one window.
# ===========================================================================
run_fault() {
  local id="$1" load dir ws_iso ps_order_before ps_cart_before fault_json
  load="$(fault_load "$id")"
  dir="$(results_dir_init f10-dependency-failure "$RUN_LABEL/$id")"
  log "=== $id - $(fault_class "$id") ==="
  log "  load path: $load, window ${FAULT_WINDOW_SECS}s"

  # Clean slate: a fresh stub run id (the jobdedup 7-day TTL would otherwise
  # silently no-op every enqueue in a repeated campaign), the cursor cleared,
  # and both injectors' counters zeroed.
  of_new_run "f10-$id-$(date +%s)" >/dev/null
  reset_between_repeats "$CONN_IDS" "'$OF_CURSOR_KEY'"
  pfp_stats_reset
  clear_all_faults

  if [ "$load" = "order" ]; then
    local minted
    minted="$(of_push_orders "$SOURCE_TENANT" "$WINDOW_BACKLOG")"
    log "  pushed $minted order(s) at the stub"
  fi

  ps_order_before="$(ps_max_order_id)"
  ps_cart_before="$(ps_max_cart_id)"
  snapshot_jobs_before "$CONN_IDS"

  # Installed BEFORE window_start, so no request inside the window ever
  # reaches an un-faulted dependency and the manifest describes the whole
  # window rather than most of it.
  fault_json="$(install_fault "$id")"
  log "  fault installed: $(printf '%s' "$fault_json" | jq -c .)"

  window_start "$dir" "f10-dependency-failure" "$CONN_IDS" 0 \
    "$(jq -n --arg id "$id" --arg cls "$(fault_class "$id")" --arg load "$load" \
       --argjson fault "$fault_json" \
       --argjson window "$FAULT_WINDOW_SECS" --argjson backlog "$WINDOW_BACKLOG" \
       --argjson maxAttempts "$PERF_MAX_ATTEMPTS" \
       --arg psBaseUrl "http://$PROXY_SERVICE_HOST:8080" \
       '{
          faultId: $id,
          faultClass: $cls,
          faultInjection: $fault,
          loadPath: $load,
          windowSecs: $window,
          offeredBacklog: $backlog,
          perfMaxAttempts: $maxAttempts,
          perfMaxAttemptsNote: "The shipped default is 10 (sync_jobs entity). This run caps it so a window is bounded and comparable; a retry-cost figure here must be read against THIS cap and extrapolated explicitly, never quoted as the shipped cost.",
          prestashopBaseUrlDuringWindow: $psBaseUrl,
          prestashopBaseUrlNote: "Every window in this scenario, baseline included, routes PrestaShop traffic through the ps-fault-proxy container. The baseline window measures that proxy overhead so no fault window is credited with it."
        }')"
  ws_iso="$(date -u -d "@$WINDOW_START_EPOCH" +%Y-%m-%dT%H:%M:%SZ)"

  start_midwindow_action "$id"
  if [ "$load" = "order" ]; then
    start_order_pump "$id"
  else
    # Assigned, not interpolated into a `log` argument. `enqueue_quantity_jobs`
    # calls `enqueue_perf_job`, which RECORDS each key it enqueued into
    # `PERF_ENQUEUED_KEYS_FILE` - and `cap_perf_job_attempts` reads that file
    # to apply the attempt cap. Running the whole loop inside a command
    # substitution would keep the file path (it is exported from main below)
    # but would lose any assignment the helper made to the variable itself,
    # so the path is minted once in main rather than lazily in a subshell.
    local qn
    qn="$(enqueue_quantity_jobs "$id")"
    log "  enqueued $qn quantity job(s)"
    cap_perf_job_attempts
  fi

  local waited=0
  while [ "$waited" -lt "$FAULT_WINDOW_SECS" ]; do
    sleep 10; waited=$((waited + 10))
    log "  t+${waited}s queued=$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\" IN ($CONN_IDS) AND status='queued'" 2>/dev/null || printf '?') running=$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\" IN ($CONN_IDS) AND status='running'" 2>/dev/null || printf '?') dead=$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\" IN ($CONN_IDS) AND status='dead' AND \"createdAt\">='$ws_iso'" 2>/dev/null || printf '?')"
  done

  stop_order_pump
  stop_midwindow_action

  window_stop "$dir"

  # The delivered fault count, read back from the injector. A rule that
  # installed and never matched must not read the same as a system that
  # absorbed the fault.
  local delivered='{}'
  case "$id" in
    D1|D2a|D2b|D3|D4) delivered="$(pfp_stats | jq -c '{proxyCounters: .counters}')" ;;
    M1|M2|M2t|M3)     delivered="$(stub_stats | jq -c '{stubFaultsApplied: .faultsApplied, stubRequestCounts: .requestCounts}')" ;;
    baseline)         delivered="$(pfp_stats | jq -c '{proxyCounters: .counters}')" ;;
    I1|I2|I3)         delivered="$(jq -n '{note:"an infrastructure fault has no per-request delivery count; its delivery is the container action itself, recorded in faultInjection.rule"}')" ;;
  esac
  jq --argjson d "$delivered" '.faultInjection = (.faultInjection + {delivered: $d})' "$dir/manifest.json" > "$dir/manifest.json.tmp"
  mv "$dir/manifest.json.tmp" "$dir/manifest.json"
  log "  delivered: $(printf '%s' "$delivered" | jq -c .)"

  # --- the ledger read, at three points ---------------------------------
  # (a) with the fault still in force, immediately after the window
  read_ledger "$dir" "$ws_iso" "$ps_order_before" "$ps_cart_before" "$load"
  mv "$dir/ledger.json" "$dir/ledger-at-window-stop.json"

  # (b) after the fault is cleared and the system is given time to recover on
  #     its own. This is #2978's "does recovery happen without a human, and
  #     how late" - measured as the delta between (a) and (c), never asserted.
  clear_all_faults
  restore_infrastructure "$id"
  log "  fault cleared; waiting up to ${RECOVERY_WAIT_SECS}s for unattended recovery"

  # THE RECOVERY WAIT RUNS BEFORE `drain_wait`, AND THE ORDER IS LOAD-BEARING.
  #
  # `drain_wait` is not a passive observer: on timeout it marks every
  # still-queued or still-running row `dead` with its own `lastError`
  # (lib.sh). Running it first would make a job the HARNESS killed
  # indistinguishable from one the system dead-lettered - and a fault window
  # is exactly the window where leftover rows are the finding. It would also
  # make the recovery loop that followed it read zero still-in-flight jobs and
  # report a clean recovery that never happened.
  #
  # So: observe recovery, read the settled ledger, and only then let
  # `drain_wait` clean up for the next window. Its answer is still recorded.
  local recovered_at="" still
  waited=0
  while [ "$waited" -lt "$RECOVERY_WAIT_SECS" ]; do
    still="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\" IN ($CONN_IDS) AND status IN ('queued','running') AND \"createdAt\">='$ws_iso'" 2>/dev/null || printf 0)"
    log "    recovery t+${waited}s: ${still:-?} job(s) from this window still queued/running"
    if [ "${still:-1}" -eq 0 ]; then recovered_at="$waited"; break; fi
    sleep 15; waited=$((waited + 15))
  done

  # (c) the settled state, read BEFORE any harness cleanup touches a row.
  read_ledger "$dir" "$ws_iso" "$ps_order_before" "$ps_cart_before" "$load"
  mv "$dir/ledger.json" "$dir/ledger-after-recovery.json"

  local drain_result
  drain_result="$(drain_wait "$CONN_IDS" || true)"
  log "  drain_wait (cleanup for the next window, AFTER the ledger was read): $drain_result"

  jq -n --arg d "$drain_result" --argjson w "$waited" \
    --arg r "${recovered_at:-never}" --argjson still "${still:-0}" \
    --arg killed "${DRAIN_DEAD_IDS:-}" \
    '{
       recoveredWithoutAHumanAfterSecs: (if $r == "never" then null else ($r|tonumber) end),
       recoveryObservedForSecs: $w,
       jobsStillInFlightWhenObservationEnded: $still,
       drainResult: $d,
       rowsTheHARNESSMarkedDeadDuringCleanup: $killed,
       note: "recoveredWithoutAHumanAfterSecs is null when this window still had queued/running jobs when the observation window ended - that is NOT a claim that recovery never happens, only that it had not happened within recoveryObservedForSecs. rowsTheHARNESSMarkedDeadDuringCleanup names rows drain_wait killed AFTER the ledger above was read, so they are absent from it."
     }' > "$dir/recovery.json"

  run_f10_guards "$dir" "$ws_iso" "$WINDOW_START_EPOCH" "$WINDOW_STOP_EPOCH" "$id" "$load"
  log "  verdict: $(verdict_read "$dir" 2>/dev/null | head -1 || true)"
}

# ===========================================================================
# --smoke
# ===========================================================================
run_smoke() {
  log "=== --smoke: proxy transparency and every injector mode, no window ==="
  pfp_start
  log "pointing perf-prestashop at the proxy"
  ol_api PATCH "/v1/connections/$PS_CONNECTION_ID" \
    "$(jq -n --argjson c "$ORIGINAL_PS_CONFIG" --arg u "http://$PROXY_SERVICE_HOST:8080" '{config: ($c + {baseUrl:$u})}')" >/dev/null
  CONNECTION_TOUCHED=1

  log "connection test through the proxy (a real PrestaShop round trip):"
  ol_api POST "/v1/connections/$PS_CONNECTION_ID/test" '{}' | jq -c '{success, message}'
  log "proxy counters after the test: $(pfp_stats | jq -c '.counters')"

  local m
  for m in '{"mode":"500","fraction":0.5}' '{"mode":"429","retryAfterSeconds":5}' '{"mode":"429","retryAfterSeconds":null}' '{"mode":"hang","hangMs":1000}' '{"mode":"reset"}'; do
    log "  proxy rule $m -> $(pfp_curl POST /__fault "$m" | jq -c '.rule')"
  done
  pfp_rule_clear

  for m in '{"mode":"503","endpoints":["checkout"]}' '{"mode":"timeout","endpoints":["checkout"],"holdMs":1000}' '{"mode":"malformed","endpoints":["checkout"]}' '{"mode":"truncated","endpoints":["events"]}' '{"mode":"reject-quantity"}'; do
    log "  stub rule $m -> $(stub_fault_set "$m" | jq -c '.fault')"
  done
  stub_fault_clear

  log "redis CLIENT PAUSE probe: $(docker exec -i "$REDIS_CONTAINER" redis-cli CLIENT PAUSE 1 2>&1)"
  log "smoke ok - every injector answered; nothing was measured"
}

# ===========================================================================
# Main
# ===========================================================================
RUN_LABEL="${RUN_LABEL:-run$(epoch)}"

log "F10 - behaviour under dependency failure (#2978)"
log "faults: $FAULTS"

guard_build
guard_demo_mode_off
guard_log_level
guard_perf_max_attempts
guard_connection_budget
guard_pool_recorded
guard_scheduler_off

# The runner has to be ON for any of this to mean anything - a fault injected
# into a system that executes no jobs measures the injector. The lab stand
# ships it OFF, so it is turned on here rather than declared as a
# precondition an operator has to arrange, and turned back off on exit if
# that is how it was found.
resolve_compose_context
if [ "$ORIGINAL_RUNNER_ENABLED" = "true" ]; then
  log "the runner is already enabled - not recreating the worker"
else
  log "the runner is disabled on this stand; recreating the worker with it enabled"
  recreate_worker true
fi
guard_runner_state enabled

of_health >/dev/null || die "the Allegro stub is not answering at $OF_STUB_URL"
log "stub config: $(of_config | jq -c '{runId, gitSha, latency}')"

if [ "$MODE" = "smoke" ]; then
  run_smoke
  exit 0
fi

pfp_start
log "pointing perf-prestashop config.baseUrl at http://$PROXY_SERVICE_HOST:8080 (was $ORIGINAL_PS_BASE_URL)"
ol_api PATCH "/v1/connections/$PS_CONNECTION_ID" \
  "$(jq -n --argjson c "$ORIGINAL_PS_CONFIG" --arg u "http://$PROXY_SERVICE_HOST:8080" '{config: ($c + {baseUrl:$u})}')" >/dev/null
CONNECTION_TOUCHED=1

# Proved, not assumed: a connection test through the proxy must reach the real
# PrestaShop before any window opens. A proxy that silently could not reach
# upstream would make every window read as a total destination outage and the
# whole run would report a fault that was never injected.
# THE DESTINATION FAN-OUT IS NARROWED TO ONE MEMBER, STRUCTURALLY.
#
# `perf-woocommerce` also carries `OrderProcessorManager`, so every ingested
# order fans out to it as well - and on this stand it fails EVERY time, with
# "No WC product mapping for OL product ...", because the WC connection has no
# product mappings seeded. The first measured baseline showed it plainly: 12
# orders, 12 synced entries against PrestaShop, and 12 FAILED entries against
# WooCommerce, in a window with no fault injected at all.
#
# That is fatal to this scenario's primary signal rather than merely noisy. The
# question every destination window asks is "did the injected fault produce a
# failed syncStatus entry", and it cannot be asked while a second destination
# contributes one to every order unconditionally. It also puts a doomed HTTP
# call on the critical path of each order.
#
# F1 removes the same contaminant the same way and for a related reason (its
# `syncedAt` is stamped after the slowest of N destinations). Removing it
# structurally beats caveating it: with one member in the fan-out, a failed
# entry means the fault did it.
log "narrowing the destination fan-out: disabling OrderProcessorManager on perf-woocommerce for the run"
WC_CAPS_WITHOUT_ORDERS="$(printf '%s' "$ORIGINAL_WC_CAPS" | jq -c '[.[] | select(. != "OrderProcessorManager")]')"
ol_api PATCH "/v1/connections/$WC_CONNECTION_ID" \
  "$(jq -n --argjson c "$WC_CAPS_WITHOUT_ORDERS" '{enabledCapabilities:$c}')" >/dev/null
WC_TOUCHED=1
log "  perf-woocommerce caps $ORIGINAL_WC_CAPS -> $WC_CAPS_WITHOUT_ORDERS"

log "verifying the proxy reaches the real PrestaShop before any window opens"
PROXY_TEST="$(ol_api POST "/v1/connections/$PS_CONNECTION_ID/test" '{}' | jq -c '{success, message}')"
log "  connection test through the proxy: $PROXY_TEST"
printf '%s' "$PROXY_TEST" | jq -e '.success == true' >/dev/null \
  || die "the connection test through the proxy did not succeed: $PROXY_TEST
  Every window would have measured a destination outage that this scenario did not inject."

# The quantity arm's targets, materialised BEFORE any loop that runs
# `docker exec` - see enqueue_quantity_jobs for why.
QUANTITY_OFFER_IDS="$(resolve_quantity_offer_ids)"
[ -n "$QUANTITY_OFFER_IDS" ] || warn "no seeded Offer mappings on $SOURCE_CONNECTION_ID - the M3 quantity arm will enqueue nothing and must be recorded as NOT EXERCISED"

# Minted in THIS shell, not lazily inside `enqueue_perf_job`'s first call: that
# call happens inside a command substitution for the quantity arm, and a
# variable assigned in a subshell does not survive it - so the cap would then
# read an unset path and silently cap nothing.
PERF_ENQUEUED_KEYS_FILE="$(mktemp)"
export PERF_ENQUEUED_KEYS_FILE

for f in $FAULTS; do
  run_fault "$f"
done

# ===========================================================================
# Summary
# ===========================================================================
SUMMARY_DIR="$RESULTS_ROOT/f10-dependency-failure/$RUN_LABEL"
{
  printf 'fault\tclass\tverdict\tps_orders\tclaimed_synced\tclaimed_missing\tps_carts\tdead\n'
  for f in $FAULTS; do
    d="$SUMMARY_DIR/$f"
    [ -d "$d" ] || continue
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$f" "$(fault_class "$f" | cut -c1-40)" \
      "$(verdict_read "$d" 2>/dev/null | head -1 || true)" \
      "$(jq -r '.groundTruth.psOrdersCreated' "$d/ledger-after-recovery.json" 2>/dev/null || printf '?')" \
      "$(jq -r '.groundTruth.claimedSyncedToPrestashop' "$d/ledger-after-recovery.json" 2>/dev/null || printf '?')" \
      "$(jq -r '.groundTruth.claimedButAbsentFromPsOrders' "$d/ledger-after-recovery.json" 2>/dev/null || printf '?')" \
      "$(jq -r '.groundTruth.psCartsCreated' "$d/ledger-after-recovery.json" 2>/dev/null || printf '?')" \
      "$(jq -r '[.syncJobs[] | select(.status=="dead") | .n] | add // 0' "$d/ledger-after-recovery.json" 2>/dev/null || printf '?')"
  done
} | column -t -s $'\t' | tee "$SUMMARY_DIR/summary.txt"

log "done - $SUMMARY_DIR"
