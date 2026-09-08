#!/usr/bin/env bash
#
# Sustained mixed load - orders, catalogue sweeps and crons together, for
# hours (#2983, epic #2840).
#
# ---------------------------------------------------------------------------
# WHY THIS SCENARIO EXISTS, AND WHY IT BREAKS THE HARNESS'S OWN PRECONDITIONS
# ---------------------------------------------------------------------------
# Every flow measured so far drove exactly ONE thing, in a 300-second window,
# with the scheduler OFF. That is the right way to measure a hop and the wrong
# way to answer "what does a Tuesday look like". Two properties of a real
# install are missing from every figure in this tree:
#
#   CO-TENANCY   F1's own header states it: "Turning the scheduler on instead
#                would have fired every other default-on task with it,
#                including the PrestaShop master sweeps whose parents share
#                the `fan-out` lane with `marketplace.orders.poll` itself" -
#                and calls that co-tenancy "the exact contaminant #2847 names
#                to control for". Controlling for it was correct for F1. It
#                also means nothing in this campaign has ever measured it.
#
#   DURATION     `results-weak-shop-2026-09-07.md` § 3.3 is the only
#                accumulation-detection design in the tree, and its sentence
#                generalises: "A 60 s step cannot see an accumulating problem,
#                and the condition this whole question is about is
#                accumulating by nature." A leak, an unbounded queue and a
#                connection-pool creep are all invisible in 300 seconds.
#
# So this scenario deliberately runs WITH the scheduler on and WITHOUT
# `guard_scheduler_off`, which is the one guard whose contract it inverts.
# `guard_scheduler_off`'s own docblock authorises that: "a scenario that wants
# it on should not call this guard at all and should instead record its posture
# via manifest_set directly". This script records the posture, the whole
# resolved task inventory, and every cadence it could read.
#
# A NOTE ON PROVENANCE, because it is easy to get wrong when quoting this run:
# the commissioning task described a mixed-workload run as "the only run whose
# orders/hour figure an operator can apply to their own Tuesday". That framing
# is the TASK's, not a quotation from `campaign-2026-09-06.md`. What the
# campaign doc actually says, in § 7, is narrower and should be quoted instead:
# "Any ceiling. No flow was driven to failure on hardware that could be
# described as representative. Every figure here is a floor." and
# "Cross-lane starvation. ADR-050's lane model is not validated by any run
# here." `results-retest-2026-09-07.md` § 5.3 names the lane-starvation window
# as "the natural next window". This run is that window widened, not a
# requirement the campaign doc set.
#
# ---------------------------------------------------------------------------
# WHAT IS DRIVEN, AND WHAT DRIVES ITSELF
# ---------------------------------------------------------------------------
#   1. ORDERS      pushed into the Allegro stub at a fixed arrival rate. The
#                  harness does NOT enqueue the poll - the real
#                  `allegro-orders-poll` cron does, at its shipped `*/1`
#                  cadence. That is the whole point: F1 owned the poll cadence
#                  and said so; here the poll wait is a REAL figure for the
#                  first time in this campaign.
#   2. SWEEPS      `master.product.syncAll` (*/20) and
#                  `master.inventory.syncAll` (*/15) against a 50 006-product
#                  PrestaShop, fired by the scheduler, unassisted.
#   3. EVERYTHING  every other default-on task the scheduler resolves for the
#      ELSE        stand's five connections, unfiltered. Disabling the
#                  inconvenient ones would reproduce the isolation this run
#                  exists to remove.
#
# ---------------------------------------------------------------------------
# THE ARRIVAL RATE IS CHOSEN TO SATURATE, AND THAT IS A METHOD CHOICE
# ---------------------------------------------------------------------------
# Under a standing backlog, achieved throughput IS the service rate - which is
# both the "orders/hour under mixed load" figure and the convergence
# threshold, since an offered rate below it converges and above it diverges.
# One saturating rate therefore answers both questions, and answers them from
# a single continuous window rather than from a step ladder whose segments
# each carry their own settle and their own noise.
#
# The rate must be above the plausible ceiling to guarantee saturation. The
# governing arithmetic `results-retest-2026-09-07.md` establishes is
# `orders/hour ceiling = requestsPerMinute / requests-per-order x 60`; at the
# newly-shipped PrestaShop default of 300 req/min (prestashop-plugin.ts:125)
# and the measured ~11 requests/order that is ~1 636 orders/h. The default
# below is 60 orders/min = 3 600/h, which clears it about 2.2x.
#
# It is DELIBERATELY not higher. The Allegro poll takes up to 100 events per
# tick, so an arrival rate under 100/min keeps the stub's own backlog near
# zero and moves the whole backlog into `sync_jobs`, where it is observable;
# a rate above 100/min would bank an unobserved backlog inside the stub's
# memory instead, which is both less useful and a real OOM risk over hours.
#
# ---------------------------------------------------------------------------
# WHICH POST-GUARDS WILL FIRE BY CONSTRUCTION, AND WHY THEY ARE STILL RUN
# ---------------------------------------------------------------------------
# A saturating multi-hour window at shipped defaults trips several guards
# structurally. Each one is still run, because the COUNT is the finding:
#
#   post_guard_limiter_degraded    Fires with near-certainty. The shared
#     intake-client defect (`OL_JOB_INTAKE_DEDICATED_REDIS` still defaults
#     `'false'` - sync-worker.module.ts:149) produced 40-49 fallback lines per
#     300 s arm A window in the retest. Extrapolating that to hours is one of
#     the questions this run was commissioned to check, so the guard's DISCARD
#     is the expected answer and not a reason to change configuration.
#   post_guard_destination_creates  Fires on any window that ends with work in
#     flight; it has no in-flight allowance and no upper time bound. The
#     health signal inside its message is the `failed` count, not the
#     `missing` one (retest § 3).
#   post_guard_attempts / post_guard_deferrals  Fire on any run long enough to
#     contain a retry or a rate-limit deferral. `PERF_MAX_ATTEMPTS` is
#     deliberately NOT applied here: the jobs are minted by the real
#     scheduler, not by `enqueue_perf_job`, so they carry the entity default
#     of 10 attempts - which is what a deployment carries.
#
# The verdict this scenario writes is therefore expected to read DISCARDED,
# and `verdict.txt` will name each reason. A reader must not take that as
# "the run failed"; § "Which figures may travel" in the report draws the line
# explicitly, the way F7 § 8 does.
#
# ---------------------------------------------------------------------------
# THE SAMPLER IS SLOWED DOWN ON PURPOSE
# ---------------------------------------------------------------------------
# `SAMPLE_INTERVAL_SECS` defaults to 1 in lib.sh, which is right for a
# 300-second window and wrong for a four-hour one: `sample_queue` shells out to
# `docker stats --no-stream` on every tick, and at 1 Hz over four hours that is
# ~14 400 invocations of a command that takes on the order of a second - a
# material, self-inflicted load on the very thing being measured. This
# scenario raises the interval (see MIXED_SAMPLE_INTERVAL_SECS below) and
# records what it used, so the sampling cost is a stated condition rather than
# a hidden one.
#
# ---------------------------------------------------------------------------
# WHAT THE SUPPLEMENTARY SAMPLER ADDS, AND WHY IT IS NOT IN lib.sh
# ---------------------------------------------------------------------------
# `sample_queue` records the queue scoped to the scenario's connection ids
# plus `pg_database_size` and a `docker stats` blob. A soak needs four things
# it does not carry: an INSTALL-WIDE queue count (the all-zero system
# connection id owns `marketplace.offer.pauseStale` jobs and is in no
# scenario's id list), the Postgres backend count against `max_connections`,
# a per-jobType breakdown of what the queue is actually made of, and an
# INCREMENTAL limiter-degradation count.
#
# Those go into a second CSV rather than into `sample_queue`, because changing
# that function's header would change the file every existing consumer parses
# (`drivers/f1-summarize.py`, `drivers/f2-summarize.py`) for the benefit of one
# scenario. The cost is two sampler loops; the alternative is a schema change
# under four shipped scenarios.
#
# The degradation count is sampled as a PER-INTERVAL delta, never as a
# window-to-date grep. A cumulative grep re-reads the whole log on every tick,
# which is O(n^2) over a four-hour log, and `results-retest-2026-09-07.md`
# records that a degradation count cannot be re-derived after the fact anyway.
# Both `docker logs` bounds are BARE epochs - the `@epoch` form is accepted
# and matches nothing on Docker 29.5.2 (#2851), which is the bug that silenced
# this exact measurement across the whole campaign.
#
# ---------------------------------------------------------------------------
# USAGE
# ---------------------------------------------------------------------------
#   export PS_CONTAINER=lab-prestashop PS_MYSQL_CONTAINER=lab-mysql \
#          PG_CONTAINER=lab-postgres REDIS_CONTAINER=lab-redis \
#          OL_API_CONTAINER=lab-api OL_API_URL=http://127.0.0.1:19000 \
#          OL_ADMIN_USER=admin OL_ADMIN_PASSWORD=admin
#   export OL_STAND_LOCK_TTL_SECS=21600          # MUST cover the whole run
#   bash scenarios/sustained-mixed-load.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib.sh
source "$SCRIPT_DIR/../lib.sh"
# shellcheck source=../drivers/order-feed.sh
source "$SCRIPT_DIR/../drivers/order-feed.sh"

LIB_LOG_PREFIX="mixed"

require_tools docker jq curl awk

# ---------------------------------------------------------------------------
# Knobs. Every one is named `MIXED_*` rather than reusing a lib.sh name -
# `results-retest-2026-09-07.md` records a scenario-local `X="${X:-10}"`
# written AFTER sourcing lib.sh silently losing to the library's own
# `X="${X:-60}"`, so the script said 10 and did 60. A distinct name cannot
# lose that way.
# ---------------------------------------------------------------------------

# Total measured window, seconds. 4 hours by default: long enough for four
# firings of every hourly cron, twelve catalogue-sweep ticks, sixteen
# inventory-sweep ticks and ~240 order polls.
MIXED_DURATION_SECS="${MIXED_DURATION_SECS:-14400}"

# Orders pushed into the stub per minute. See "THE ARRIVAL RATE" above.
MIXED_ORDERS_PER_MIN="${MIXED_ORDERS_PER_MIN:-60}"

# Sampling cadence for BOTH samplers. See "THE SAMPLER IS SLOWED DOWN".
MIXED_SAMPLE_INTERVAL_SECS="${MIXED_SAMPLE_INTERVAL_SECS:-30}"

# Destination fault injection. `docker pause` on the shop, at
# MIXED_FAULT_AT_SECS into the window, for MIXED_FAULT_SECS. Set
# MIXED_FAULT_AT_SECS to 0 to skip it entirely.
#
# `pause` rather than `stop`: it leaves `.State.StartedAt` untouched, so
# `post_guard_containers_stable` still means what it means, and it produces
# the shape #2978 measured at 12 orders - a destination that accepts the TCP
# connection and never answers - rather than a connection refusal.
MIXED_FAULT_AT_SECS="${MIXED_FAULT_AT_SECS:-9000}"
MIXED_FAULT_SECS="${MIXED_FAULT_SECS:-300}"

# Restore the destination's `config.rateLimit` to the shipped default (i.e.
# remove the connection-level override so the plugin manifest's own
# `defaultRateLimit` applies). The stand currently carries an explicit
# `{maxConcurrent: 4, requestsPerMinute: 60}` left behind by the weak-shop
# ramp, which is NOT the shipped default any more - #2982 moved the manifest
# to 300/4. A run that claims "shipped defaults" must not inherit that.
MIXED_RESET_DEST_RATE_LIMIT="${MIXED_RESET_DEST_RATE_LIMIT:-1}"

# The stub tenant and its OpenLinker connection.
MIXED_TENANT="${MIXED_TENANT:-perf-allegro-a}"

# ---------------------------------------------------------------------------
# The stand lock, claimed BEFORE any arrange step (the F1 rule): this script
# rewrites the destination's rate limit and recreates the worker, and both are
# changes a peer scenario would silently measure.
#
# The TTL is the one knob a multi-hour run MUST set. The lock carries no
# heartbeat, so a TTL shorter than the window would expire mid-run and let a
# peer take a stand that is under load.
# ---------------------------------------------------------------------------
MIXED_MIN_LOCK_TTL=$(( MIXED_DURATION_SECS + SETTLE_SECS + 1800 ))
[ "$STAND_LOCK_TTL_SECS" -ge "$MIXED_MIN_LOCK_TTL" ] || die \
"the stand lock TTL (${STAND_LOCK_TTL_SECS}s) is shorter than this run needs (${MIXED_MIN_LOCK_TTL}s
  = ${MIXED_DURATION_SECS}s window + ${SETTLE_SECS}s settle + 1800s for arrange/teardown).
  The lock has no heartbeat, so it would expire mid-window and hand a loaded
  stand to a peer. Re-run with:
    export OL_STAND_LOCK_TTL_SECS=$(( MIXED_MIN_LOCK_TTL + 1800 ))"

guard_stand_exclusive "sustained-mixed-load"

# ---------------------------------------------------------------------------
# Connection ids.
#
# `stand-ids.env` is absent on this stand (bootstrap.sh deletes it on any run
# that found a gap, and it is gitignored, so a stand bootstrapped from another
# worktree may simply not have one). Rather than re-running bootstrap - which
# rotates the PrestaShop webservice key and reseeds offer mappings, i.e.
# changes the thing under measurement - the ids are resolved from the database
# by NAME, which is what bootstrap itself keys on.
#
# Resolved rather than hardcoded so this script survives a reseed, and each
# one is asserted non-empty: an empty id silently widens every `IN (...)`
# predicate below to `IN ('')`, which matches nothing and would report a
# perfectly busy queue as empty.
# ---------------------------------------------------------------------------
conn_id_by_name() {
  local name="$1" id
  id="$(pg_sql "SELECT id FROM connections WHERE name='$name' LIMIT 1")"
  [ -n "$id" ] || die "conn_id_by_name: no connection named '$name' on this stand - run bootstrap.sh, or set the id explicitly"
  printf '%s' "$id"
}

PS_CONNECTION_ID="${PS_CONNECTION_ID:-$(conn_id_by_name perf-prestashop)}"
ALLEGRO_A_CONNECTION_ID="${ALLEGRO_A_CONNECTION_ID:-$(conn_id_by_name "$MIXED_TENANT")}"

# EVERY active connection, not just the two this script drives. With the
# scheduler on, the resolver fires each capability task for every active
# connection that carries the capability, so a queue scoped to two ids would
# under-report the install's real depth - which is the headline figure.
ALL_CONN_IDS_CSV="$(pg_sql "SELECT string_agg(quote_literal(id), ',' ORDER BY \"createdAt\") FROM connections WHERE status='active'")"
[ -n "$ALL_CONN_IDS_CSV" ] || die "no active connections on this stand"
CONN_IDS="$ALL_CONN_IDS_CSV"
log "connections under measurement: $CONN_IDS"
log "orders source: $MIXED_TENANT ($ALLEGRO_A_CONNECTION_ID); destination: perf-prestashop ($PS_CONNECTION_ID)"

# ---------------------------------------------------------------------------
# Which compose file and env file is the RUNNING stand using? Resolved from
# the container's own labels, verbatim from f7-lane-starvation.sh - on a
# multi-worktree checkout the stand is routinely brought up from a DIFFERENT
# worktree, and a hardcoded `$SCRIPT_DIR/../../../.env.lab` does not exist
# there. Verified again on this host: the `lab` project's working_dir points
# at a sibling agent worktree.
# ---------------------------------------------------------------------------
_compose_label() {
  local w
  w="$(discover_worker_containers | awk '{print $1}')"
  [ -n "$w" ] || return 0
  docker inspect --format "{{index .Config.Labels \"$1\"}}" "$w" 2>/dev/null || true
}
LAB_ENV_FILE="${LAB_ENV_FILE:-$(_compose_label com.docker.compose.project.environment_file)}"
[ -n "$LAB_ENV_FILE" ] || LAB_ENV_FILE="$SCRIPT_DIR/../../../.env.lab"
LAB_COMPOSE_FILE="${LAB_COMPOSE_FILE:-$(_compose_label com.docker.compose.project.config_files)}"
[ -n "$LAB_COMPOSE_FILE" ] || LAB_COMPOSE_FILE="$SCRIPT_DIR/../../../docker-compose.lab.yml"
case "$LAB_COMPOSE_FILE" in
  *,*) die "LAB_COMPOSE_FILE resolved to a multi-file compose project [$LAB_COMPOSE_FILE] - set LAB_COMPOSE_FILE explicitly to the file carrying the 'worker' service" ;;
esac
[ -f "$LAB_ENV_FILE" ] || die "LAB_ENV_FILE [$LAB_ENV_FILE] not found - set it to the .env.lab the running stand was created from"
log "stand config: compose=$LAB_COMPOSE_FILE env=$LAB_ENV_FILE project=$LAB_COMPOSE_PROJECT"

# ---------------------------------------------------------------------------
# Capture, then restore, everything this run changes. Read from the RUNNING
# replica first and fall back to the env file (the F7/F4 pattern); an
# unreadable value is fatal rather than guessed, because the whole point is to
# hand the stand back in the posture it was found in.
# ---------------------------------------------------------------------------
_read_worker_env() {
  local key="$1" w val
  w="$(discover_worker_containers | awk '{print $1}')"
  if [ -n "$w" ]; then
    val="$(docker exec "$w" printenv "$key" 2>/dev/null || printf '')"
    [ -z "$val" ] || { printf '%s' "$val"; return 0; }
  fi
  val="$(awk -F= -v k="^$key=" '$0 ~ k {print $2; exit}' "$LAB_ENV_FILE" 2>/dev/null || printf '')"
  [ -n "$val" ] || die "_read_worker_env: could not read $key from any running worker replica [$(discover_worker_containers)] or from $LAB_ENV_FILE - refusing to guess a posture this run must restore"
  printf '%s' "$val"
}

ORIGINAL_RUNNER_ENABLED="$(_read_worker_env WORKER_RUNNER_ENABLED)"
ORIGINAL_SCHEDULER_ENABLED="$(_read_worker_env OL_SCHEDULER_ENABLED)"
# `config->'rateLimit'` as text, or the literal string `null` when the key is
# absent. Kept as raw JSON so the restore is byte-exact - reconstructing it
# from parsed fields would silently normalise `{"maxConcurrent": 4}` key order
# and drop any field this script does not know about.
ORIGINAL_DEST_RATE_LIMIT="$(pg_sql "SELECT COALESCE(config->'rateLimit', 'null'::jsonb)::text FROM connections WHERE id='$PS_CONNECTION_ID'")"
log "posture at scenario start: WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED OL_SCHEDULER_ENABLED=$ORIGINAL_SCHEDULER_ENABLED destRateLimit=$ORIGINAL_DEST_RATE_LIMIT"

MIXED_SAMPLER_PID=""
MIXED_FAULT_ACTIVE=0

# ---------------------------------------------------------------------------
# Every restore step is defined BEFORE the trap that calls them, and that
# ordering is load-bearing rather than tidy: bash resolves a function name at
# CALL time, so a `die` between installing the trap and executing a later
# definition would run an EXIT handler whose body does not exist yet. On a
# four-hour run the handler is the only thing that hands the stand back, so it
# must be complete from the moment it is armed.
# ---------------------------------------------------------------------------
mixed_supp_sampler_stop() {
  [ -n "$MIXED_SAMPLER_PID" ] || return 0
  kill "$MIXED_SAMPLER_PID" >/dev/null 2>&1 || true
  wait "$MIXED_SAMPLER_PID" 2>/dev/null || true
  MIXED_SAMPLER_PID=""
  log "supplementary sampler stopped"
}

mixed_restore_dest_rate_limit() {
  local current
  current="$(pg_sql "SELECT COALESCE(config->'rateLimit', 'null'::jsonb)::text FROM connections WHERE id='$PS_CONNECTION_ID'" 2>/dev/null || printf '')"
  [ -n "$current" ] || { warn "restore: could not read the destination's current rateLimit - leaving it as-is"; return 0; }
  [ "$current" != "$ORIGINAL_DEST_RATE_LIMIT" ] || return 0
  log "restoring destination config.rateLimit to $ORIGINAL_DEST_RATE_LIMIT (was $current)"
  if [ "$ORIGINAL_DEST_RATE_LIMIT" = "null" ]; then
    pg_sql_write "UPDATE connections SET config = config - 'rateLimit' WHERE id='$PS_CONNECTION_ID'" >/dev/null
  else
    pg_sql_write "UPDATE connections SET config = jsonb_set(config, '{rateLimit}', '$ORIGINAL_DEST_RATE_LIMIT'::jsonb) WHERE id='$PS_CONNECTION_ID'" >/dev/null
  fi
}

mixed_restore_worker_posture() {
  local cur_runner cur_sched
  cur_runner="$(_read_worker_env WORKER_RUNNER_ENABLED 2>/dev/null || printf '')"
  cur_sched="$(_read_worker_env OL_SCHEDULER_ENABLED 2>/dev/null || printf '')"
  if [ -z "$cur_runner" ] || [ -z "$cur_sched" ]; then
    warn "restore: could not read the current worker posture - leaving the stand as-is"
    return 0
  fi
  if [ "$cur_runner" = "$ORIGINAL_RUNNER_ENABLED" ] && [ "$cur_sched" = "$ORIGINAL_SCHEDULER_ENABLED" ]; then
    return 0
  fi
  log "restoring WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED OL_SCHEDULER_ENABLED=$ORIGINAL_SCHEDULER_ENABLED (were $cur_runner / $cur_sched)"
  mixed_set_worker_posture "$ORIGINAL_RUNNER_ENABLED" "$ORIGINAL_SCHEDULER_ENABLED" skip-wait
}

# ---------------------------------------------------------------------------
# mixed_set_worker_posture <runner:true|false> <scheduler:true|false> [skip-wait]
#
# Flips both keys in .env.lab and recreates ONLY the `worker` service.
# `-p lab` is REQUIRED: the worker service carries no `container_name` since
# #2851, so without an explicit project name compose derives one from the
# directory and brings up a SECOND, parallel worker against this same
# database. `--no-deps` plus an explicit service name bounds the blast radius
# to `worker` even though this run holds the stand lock.
# ---------------------------------------------------------------------------
mixed_set_env_key() {
  local key="$1" want="$2" env_file="$LAB_ENV_FILE"
  # `grep -q` on a plain FILE argument is safe. The SIGPIPE/pipefail trap
  # docs/lessons.md records applies only when grep terminates a PIPE.
  if grep -q "^$key=" "$env_file"; then
    sed -i "s/^$key=.*/$key=$want/" "$env_file"
  else
    printf '%s=%s\n' "$key" "$want" >> "$env_file"
  fi
}

mixed_set_worker_posture() {
  local runner="$1" sched="$2" mode="${3:-wait}"
  mixed_set_env_key WORKER_RUNNER_ENABLED "$runner"
  mixed_set_env_key OL_SCHEDULER_ENABLED "$sched"
  ( cd "$(dirname "$LAB_COMPOSE_FILE")" \
    && docker compose -f "$LAB_COMPOSE_FILE" --env-file "$LAB_ENV_FILE" -p "$LAB_COMPOSE_PROJECT" \
         up -d --no-deps worker >/dev/null )
  sleep 5
  # The recreate mints a NEW container, so lib.sh's memoised list is stale.
  WORKER_CONTAINERS=""
  WORKER_CONTAINERS_RESOLVED=0
  _ensure_worker_containers
  [ "$mode" = "wait" ] || return 0
  [ "$runner" = "true" ] || return 0

  # Wait for the runner's own startup line. `grep -c`, never `grep -q`:
  # `grep -q` exits at its first match, closing the pipe while `docker logs`
  # is still writing, so `docker logs` dies of SIGPIPE (141) and
  # `set -o pipefail` reports the pipeline FAILED even though the line
  # matched. It is length-dependent, so it passes while the log is short and
  # starts failing once the worker has been up a while (#2851).
  local w tries hits
  for w in $WORKER_CONTAINERS; do
    tries=0
    while :; do
      hits="$(docker logs "$w" 2>&1 | grep -c -F 'Starting sync job runner loop' || true)"
      [ "${hits:-0}" -eq 0 ] || break
      tries=$((tries + 1))
      [ "$tries" -lt 24 ] || die "mixed_set_worker_posture: $w never printed 'Starting sync job runner loop' within 120s of the recreate"
      sleep 5
    done
  done
}

# ---------------------------------------------------------------------------
# ARM THE TEARDOWN. Placed here, immediately after the last function it calls,
# for the reason stated above the restore helpers: bash resolves a function
# name at call time, so a trap armed earlier would run a handler whose body
# had not been executed yet.
#
# `trap ... EXIT` is a SINGLE slot in bash, not a stack, so this REPLACES
# guard_stand_exclusive's own `trap release_stand_exclusive EXIT` - which is
# why the release is the last thing this handler does. Getting that wrong
# leaves the stand locked for the whole TTL after any `die`, the bug
# f7-lane-starvation.sh documents having been caught.
#
# INT and TERM are trapped explicitly as well: a default-disposition SIGTERM
# does NOT run an EXIT trap, and a four-hour window is exactly the kind of run
# a human interrupts. Both re-enter through `exit`, so the EXIT handler is
# what actually performs the restore, once, from one place.
# ---------------------------------------------------------------------------
mixed_on_exit() {
  local rc=$?
  set +e
  mixed_supp_sampler_stop
  # Unpause FIRST - a paused destination makes several of the restore steps
  # below wait on a shop call they do not need to make.
  if [ "$MIXED_FAULT_ACTIVE" = "1" ]; then
    warn "unpausing $PS_CONTAINER (fault injection was still active at exit)"
    docker unpause "$PS_CONTAINER" >/dev/null 2>&1 || true
    MIXED_FAULT_ACTIVE=0
  fi
  mixed_restore_dest_rate_limit
  mixed_restore_worker_posture
  release_stand_exclusive
  return $rc
}
trap mixed_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
log "teardown armed (restores runner/scheduler posture, destination rate limit, stand lock)"

# ---------------------------------------------------------------------------
# Which scheduler tasks did the worker ACTUALLY register? Read out of the
# worker's own startup log, never inferred from the code, for the same reason
# f8-lane-caps.sh reads its lane caps back rather than trusting `printenv`:
# compose forwards an env-file key only if the service's own `environment:`
# block names it, so a cadence "set" in .env.lab may change nothing at all.
#
# One line per registered task, and this is the run's own record of what
# "unfiltered crons" resolved to on this stand.
# ---------------------------------------------------------------------------
mixed_registered_tasks() {
  local w out=""
  for w in $WORKER_CONTAINERS; do
    # `sed 's/\x1b\[[0-9;]*m//g'` strips the Nest logger's ANSI colour codes,
    # which wrap the message on both sides - harmless for the `grep -F` that
    # finds the line, fatal for the trailing `)[39m` that would otherwise end
    # up inside every recorded task description.
    out="$out$(docker logs "$w" 2>&1 \
      | grep -F 'Registered scheduler task:' \
      | sed 's/\x1b\[[0-9;]*m//g' \
      | sed 's/.*Registered scheduler task: //' | sort -u || true)"$'\n'
  done
  printf '%s' "$out" | sed '/^$/d' | sort -u
}

# ---------------------------------------------------------------------------
# Wait for the scheduler to actually REGISTER, then refuse a run where it did
# not. Both halves are load-bearing and the first smoke run of this scenario
# is why they exist.
#
# The wait: the scheduler is a fleet singleton behind a Redis lease
# (`SchedulerLeaseCoordinator`, #2279), so registration happens only after
# `SingletonRoleLease` acquires `singleton:scheduler` - measured at ~5s after
# boot on this stand, and up to a full lease TTL (`OL_SCHEDULER_LEASE_TTL_MS`,
# default 60s) if a previous holder died without releasing. The runner's own
# `Starting sync job runner loop` line lands well before that, so a scenario
# that reads the log as soon as `guard_runner_state` passes reads it too
# early. That is exactly what happened: 27 tasks were registered and the
# scenario recorded "0 task(s)".
#
# The refusal: a mixed-workload run whose scheduler registered nothing is not
# a mixed-workload run - it is an order-only run wearing the wrong label, and
# every co-tenancy figure it produced would be a statement about a condition
# that never existed. Recording 0 and continuing is the reported-versus-
# enforced gap this harness exists to close.
# ---------------------------------------------------------------------------
mixed_wait_for_scheduler() {
  local tries=0 n tasks
  while :; do
    tasks="$(mixed_registered_tasks)"
    n="$(printf '%s\n' "$tasks" | sed '/^$/d' | wc -l | tr -d ' ')"
    [ "${n:-0}" -eq 0 ] || { printf '%s' "$tasks"; return 0; }
    tries=$((tries + 1))
    if [ "$tries" -ge 30 ]; then
      die "mixed_wait_for_scheduler: no 'Registered scheduler task:' line appeared on [$WORKER_CONTAINERS] within 150s of the recreate.
  This scenario's entire premise is that the scheduler is ON, so a run with
  zero registered tasks must abort rather than measure an order-only window
  and label it mixed. Check that OL_SCHEDULER_ENABLED=true really reached the
  container (docker exec $WORKER_CONTAINERS printenv OL_SCHEDULER_ENABLED) and
  that the singleton lease is free:
    docker exec -i $REDIS_CONTAINER redis-cli GET singleton:scheduler"
    fi
    sleep 5
  done
}

# SHARED or DEDICATED, read from the worker's own startup line
# (sync-worker.module.ts:156 / :175) and never from `printenv` - an env var
# read from outside the container is a request, not a reading, and this one is
# the difference between 207 and 2 233 orders/h in the retest campaign. The
# module logs on BOTH branches precisely so a harness can assert it.
#
# THE VALUE IS THE TOKEN IMMEDIATELY AFTER THE COLON, and nothing else.
# Substring-matching the line is wrong in a way that inverts the answer: the
# SHARED message reads
#   "Job intake Redis client: SHARED (OL_JOB_INTAKE_DEDICATED_REDIS is not true)"
# which CONTAINS the string `DEDICATED` inside the variable's own name. A
# `case "$line" in *DEDICATED*)` test therefore reports DEDICATED for a
# worker that logged SHARED - caught on this scenario's first smoke run,
# where the log said SHARED and the scenario recorded DEDICATED. Publishing
# that would have inverted the single most consequential configuration fact
# in this campaign.
#
# `unknown` is reported rather than defaulted: a worker that printed neither
# line is a worker whose intake wiring this run cannot describe, and guessing
# `SHARED` would put an unverified condition into the manifest.
mixed_intake_client() {
  local w tok answer="unknown"
  for w in $WORKER_CONTAINERS; do
    # ANSI-stripped first (the Nest logger colours the message), then the one
    # word following the colon.
    tok="$(docker logs "$w" 2>&1 \
      | grep -F 'Job intake Redis client:' \
      | sed 's/\x1b\[[0-9;]*m//g' \
      | sed -n 's/.*Job intake Redis client: \([A-Z]*\).*/\1/p' \
      | tail -1 || true)"
    case "$tok" in
      DEDICATED|SHARED) answer="$tok" ;;
    esac
  done
  printf '%s' "$answer"
}

# ===========================================================================
# Supplementary sampler - see the header block for why this is not in lib.sh.
# ===========================================================================
MIXED_SUPP_CSV=""
MIXED_PHASE_FILE=""

mixed_phase_set() {
  [ -n "$MIXED_PHASE_FILE" ] || return 0
  printf '%s' "$1" > "$MIXED_PHASE_FILE"
}

mixed_supp_header() {
  printf 'ts,epoch,elapsed,phase,g_queued_due,g_queued_deferred,g_running,g_dead,ord_sync_queued,ord_sync_succeeded,ord_sync_dead,orders_ingested,pg_backends,pg_backends_active,pg_max_conn,limiter_degraded_delta,stub_backlog,mem_json,queue_by_type_json\n' > "$1"
}

# One sample. Every query is chosen to be servable by an existing index:
# `sync_jobs` by (status, nextRunAt) / (connectionId, jobType, status,
# updatedAt), `order_records` by IDX_order_records_createdAt. The
# `syncStatus @> ...` containment count is DELIBERATELY absent - F5 measured
# it at 141.9 ms and ~540 MB of buffer traffic per execution at 1M rows, so
# sampling it every 30 s for four hours would be a self-inflicted load larger
# than several of the flows under measurement. It is computed once, at the
# end, in the summary.
mixed_supp_sample() {
  local csv="$1" ws_epoch="$2" ws_iso="$3" prev_epoch="$4" now phase
  now="$(epoch)"
  phase="$(cat "$MIXED_PHASE_FILE" 2>/dev/null || printf 'unknown')"

  local gq gd gr gdead
  gq="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE status='queued' AND \"nextRunAt\"<=NOW()" 2>/dev/null || printf -1)"
  gd="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE status='queued' AND \"nextRunAt\">NOW()" 2>/dev/null || printf -1)"
  gr="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE status='running'" 2>/dev/null || printf -1)"
  gdead="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE status='dead' AND \"createdAt\">='$ws_iso'" 2>/dev/null || printf -1)"

  local osq oss osd
  osq="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"jobType\"='marketplace.order.sync' AND status='queued' AND \"createdAt\">='$ws_iso'" 2>/dev/null || printf -1)"
  oss="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"jobType\"='marketplace.order.sync' AND status='succeeded' AND \"createdAt\">='$ws_iso'" 2>/dev/null || printf -1)"
  osd="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"jobType\"='marketplace.order.sync' AND status='dead' AND \"createdAt\">='$ws_iso'" 2>/dev/null || printf -1)"

  local ing
  ing="$(pg_sql "SELECT COUNT(*) FROM order_records WHERE \"createdAt\">='$ws_iso' AND \"sourceConnectionId\"='$ALLEGRO_A_CONNECTION_ID'" 2>/dev/null || printf -1)"

  local be bea mx
  be="$(pg_sql "SELECT COUNT(*) FROM pg_stat_activity" 2>/dev/null || printf -1)"
  bea="$(pg_sql "SELECT COUNT(*) FROM pg_stat_activity WHERE state='active'" 2>/dev/null || printf -1)"
  mx="$(pg_sql "SHOW max_connections" 2>/dev/null || printf -1)"

  # Degradation lines inside THIS interval only. Both bounds are BARE epochs:
  # `--since "@$epoch"` is accepted and matches nothing (#2851). `grep -c`
  # reads to EOF, so there is no SIGPIPE hazard here.
  local deg=0 w hit
  for w in $WORKER_CONTAINERS; do
    hit="$(docker logs --since "$prev_epoch" --until "$now" "$w" 2>&1 \
      | grep -c -F 'falling back to per-process in-memory limiting' || true)"
    deg=$((deg + ${hit:-0}))
  done

  local backlog
  backlog="$(of_backlog "$MIXED_TENANT" "$ALLEGRO_A_CONNECTION_ID" 2>/dev/null || printf 'unknown')"

  # Memory from the host's own cgroup view via `docker stats`. One invocation
  # per sample, at the slowed cadence - see the header note.
  local mem
  mem="$(docker stats --no-stream --format '{"name":"{{.Name}}","mem":"{{.MemUsage}}","cpu":"{{.CPUPerc}}"}' 2>/dev/null | jq -cs '.' || printf '[]')"

  # What the queue is MADE of. Bounded to the ten deepest types so one
  # pathological type cannot make the CSV row unbounded.
  local bytype
  bytype="$(pg_sql "SELECT COALESCE(jsonb_object_agg(t.\"jobType\", t.n)::text,'{}') FROM (
      SELECT \"jobType\", COUNT(*) AS n FROM sync_jobs
      WHERE status='queued' GROUP BY \"jobType\" ORDER BY n DESC LIMIT 10) t" 2>/dev/null || printf '{}')"

  # Both JSON columns are RFC4180-quoted (wrapped in a literal `"..."` pair
  # with internal `"` doubled). #2930 records a naive reader silently
  # comma-splitting an unquoted JSON column into extra fields instead of
  # erroring - the internal escaping was right and the outer quote pair was
  # the missing half.
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"%s","%s"\n' \
    "$(iso_now)" "$now" "$((now - ws_epoch))" "$phase" \
    "$gq" "$gd" "$gr" "$gdead" \
    "$osq" "$oss" "$osd" "$ing" \
    "$be" "$bea" "$mx" "$deg" "$backlog" \
    "$(printf '%s' "$mem" | sed 's/"/""/g')" \
    "$(printf '%s' "$bytype" | sed 's/"/""/g')" >> "$csv"
}

mixed_supp_sampler_start() {
  local dir="$1" ws_epoch="$2" ws_iso="$3"
  MIXED_SUPP_CSV="$dir/mixed-timeseries.csv"
  MIXED_PHASE_FILE="$dir/.phase"
  mixed_phase_set "starting"
  mixed_supp_header "$MIXED_SUPP_CSV"
  (
    local prev="$ws_epoch"
    while :; do
      mixed_supp_sample "$MIXED_SUPP_CSV" "$ws_epoch" "$ws_iso" "$prev" || true
      prev="$(epoch)"
      sleep "$MIXED_SAMPLE_INTERVAL_SECS"
    done
  ) &
  MIXED_SAMPLER_PID=$!
  echo "$MIXED_SAMPLER_PID" > "$dir/.mixed-sampler.pid"
  log "supplementary sampler started (pid=$MIXED_SAMPLER_PID, interval=${MIXED_SAMPLE_INTERVAL_SECS}s) -> $MIXED_SUPP_CSV"
}

# (mixed_supp_sampler_stop is defined above, beside the other teardown steps,
# because the EXIT trap calls it.)

# ===========================================================================
# Pre-flight
# ===========================================================================
log "=== pre-flight ==="
guard_demo_mode_off
guard_log_level
guard_build
guard_connection_budget
guard_pool_recorded
guard_queue_empty "$CONN_IDS"
# guard_scheduler_off is DELIBERATELY NOT CALLED - see the header. Its cadence
# half is still recorded, because an operational_settings row overrides
# cronEnvVar/defaultCron and is invisible to an env-var-only reading.
MANIFEST_SCHEDULER_CADENCE_ROW="$(scheduler_cadence_row)"
log "operational_settings cadence row: ${MANIFEST_SCHEDULER_CADENCE_ROW:-<none>}"

# The stub must be reachable and must be able to mint. A run whose upstream is
# blind offers no load and would report the harness rather than the system.
of_health >/dev/null || die "the Allegro stub did not answer /__stub/health - bring up lab-allegro-stub"
log "stub health ok"

# The stub's own RUNNING configuration, read from the stub rather than
# restated from docker-compose.lab.yml - which is the whole point of that
# endpoint. It matters more here than in a single-flow scenario: the pinned
# upstream latencies (`GET /order/events`, `GET /order/checkout-forms/{id}`)
# are a direct multiplier on order throughput, the stub image on this stand
# was built by a peer campaign rather than from this branch, and a figure
# taken against a differently-configured stub is not comparable with F1's.
MIXED_STUB_CONFIG="$(of_config)"
MIXED_STUB_IMAGE="$(docker inspect lab-allegro-stub --format '{{.Config.Image}}' 2>/dev/null || printf 'unknown')"
log "stub image: $MIXED_STUB_IMAGE"
log "stub config: $MIXED_STUB_CONFIG"

# ===========================================================================
# Arrange
# ===========================================================================
log "=== arrange ==="

if [ "$MIXED_RESET_DEST_RATE_LIMIT" = "1" ]; then
  if [ "$ORIGINAL_DEST_RATE_LIMIT" = "null" ]; then
    log "destination carries no config.rateLimit override - the manifest default already applies"
  else
    log "removing the destination's config.rateLimit override ($ORIGINAL_DEST_RATE_LIMIT) so the plugin manifest default applies"
    pg_sql_write "UPDATE connections SET config = config - 'rateLimit' WHERE id='$PS_CONNECTION_ID'" >/dev/null
  fi
fi
MIXED_DEST_RATE_LIMIT_IN_WINDOW="$(pg_sql "SELECT COALESCE(config->'rateLimit', 'null'::jsonb)::text FROM connections WHERE id='$PS_CONNECTION_ID'")"
log "destination config.rateLimit for this window: $MIXED_DEST_RATE_LIMIT_IN_WINDOW (null => plugin manifest defaultRateLimit)"

# A fresh stub run, and the matching cursor reset. Both halves are required
# and neither is optional housekeeping: the child job's dedupe key is
# `marketplace:{connectionId}:order:{eventKey}` with a 7-day TTL and
# `eventKey` is the stub's own event id, so repeating inside that window
# without a new run id re-mints keys the previous run already reserved and
# every enqueue silently no-ops. And OpenLinker's persisted
# `allegro.orders.lastEventId` still names the PREVIOUS run's sequence, which
# compares meaninglessly against a restarted one.
MIXED_RUN_ID="mixed-$(epoch)"
of_new_run "$MIXED_RUN_ID" >/dev/null
log "stub run id: $MIXED_RUN_ID"
reset_between_repeats "'$ALLEGRO_A_CONNECTION_ID'" "'$OF_CURSOR_KEY'"

# Prime the feed so the first poll tick has something to take, then bring the
# worker up with BOTH the runner and the scheduler on.
MIXED_PRIME_ORDERS="${MIXED_PRIME_ORDERS:-$MIXED_ORDERS_PER_MIN}"
log "priming the stub with $MIXED_PRIME_ORDERS order(s)"
of_push_orders "$MIXED_TENANT" "$MIXED_PRIME_ORDERS" >/dev/null

log "flipping the worker to runner=true scheduler=true"
mixed_set_worker_posture true true
guard_runner_state enabled
log "lane caps in force: ${MANIFEST_LANE_CAPS:-<unread>}"

MIXED_INTAKE_CLIENT="$(mixed_intake_client)"
log "job intake Redis client: $MIXED_INTAKE_CLIENT (env OL_JOB_INTAKE_DEDICATED_REDIS=$(docker exec "$(printf '%s' "$WORKER_CONTAINERS" | awk '{print $1}')" printenv OL_JOB_INTAKE_DEDICATED_REDIS 2>/dev/null || printf '<unset>'))"
[ "$MIXED_INTAKE_CLIENT" != "unknown" ] || warn "could not read the worker's 'Job intake Redis client:' line - the manifest will say unknown rather than guess"

log "waiting for the scheduler singleton to acquire its lease and register"
MIXED_TASKS="$(mixed_wait_for_scheduler)"
MIXED_TASK_COUNT="$(printf '%s\n' "$MIXED_TASKS" | sed '/^$/d' | wc -l | tr -d ' ')"
log "scheduler registered $MIXED_TASK_COUNT task(s)"
printf '%s\n' "$MIXED_TASKS" | sed 's/^/    /'

snapshot_jobs_before "$CONN_IDS"

# ===========================================================================
# Window
# ===========================================================================
RESULTS_DIR="$(results_dir_init sustained-mixed-load "run$(epoch)")"

MIXED_EXTRA="$(jq -n \
  --arg dur "$MIXED_DURATION_SECS" \
  --arg opm "$MIXED_ORDERS_PER_MIN" \
  --arg si "$MIXED_SAMPLE_INTERVAL_SECS" \
  --arg rl "$MIXED_DEST_RATE_LIMIT_IN_WINDOW" \
  --arg rl0 "$ORIGINAL_DEST_RATE_LIMIT" \
  --arg runid "$MIXED_RUN_ID" \
  --arg tenant "$MIXED_TENANT" \
  --arg src "$ALLEGRO_A_CONNECTION_ID" \
  --arg dst "$PS_CONNECTION_ID" \
  --arg faultAt "$MIXED_FAULT_AT_SECS" \
  --arg faultFor "$MIXED_FAULT_SECS" \
  --arg tasks "$MIXED_TASKS" \
  --arg taskCount "$MIXED_TASK_COUNT" \
  --arg cadence "${MANIFEST_SCHEDULER_CADENCE_ROW:-}" \
  --arg intake "$MIXED_INTAKE_CLIENT" \
  --arg stubImage "$MIXED_STUB_IMAGE" \
  --argjson stubConfig "$MIXED_STUB_CONFIG" \
  '{
     jobIntakeRedisClient: $intake,
     stubImage: $stubImage,
     stubConfig: $stubConfig,
     scenarioKind: "sustained-mixed-load",
     schedulerPosture: "ON (guard_scheduler_off deliberately not called)",
     runnerPosture: "enabled",
     durationSecs: ($dur|tonumber),
     ordersPerMin: ($opm|tonumber),
     sampleIntervalSecs: ($si|tonumber),
     destRateLimitInWindow: $rl,
     destRateLimitBeforeRun: $rl0,
     stubRunId: $runid,
     stubTenant: $tenant,
     sourceConnectionId: $src,
     destinationConnectionId: $dst,
     faultInjectAtSecs: ($faultAt|tonumber),
     faultInjectForSecs: ($faultFor|tonumber),
     registeredSchedulerTaskCount: ($taskCount|tonumber),
     registeredSchedulerTasks: ($tasks | split("\n") | map(select(length>0))),
     operationalSettingsCadenceRow: $cadence
   }')"

# lib.sh's own sampler runs at the slowed cadence too - see the header note on
# why 1 Hz is wrong for a four-hour window.
SAMPLE_INTERVAL_SECS="$MIXED_SAMPLE_INTERVAL_SECS"

window_start "$RESULTS_DIR" sustained-mixed-load "$CONN_IDS" 0 "$MIXED_EXTRA"
WS_ISO="$(date -u -d "@$WINDOW_START_EPOCH" +%Y-%m-%dT%H:%M:%SZ)"
mixed_supp_sampler_start "$RESULTS_DIR" "$WINDOW_START_EPOCH" "$WS_ISO"

# The arrival-rate driver. Pushes in one-minute ticks so the rate is a rate
# and not a burst, and records what it actually pushed - `of_push_orders`
# reports the stub's own minted count rather than echoing the request back, so
# a stub that quietly minted fewer is visible here rather than assumed away.
MIXED_PUSH_LOG="$RESULTS_DIR/pushes.csv"
printf 'ts,epoch,elapsed,phase,asked,minted,total\n' > "$MIXED_PUSH_LOG"
MIXED_PUSHED_TOTAL=0

mixed_push_tick() {
  local phase="$1" asked="$MIXED_ORDERS_PER_MIN" minted now
  minted="$(of_push_orders "$MIXED_TENANT" "$asked" 2>/dev/null || printf 0)"
  MIXED_PUSHED_TOTAL=$((MIXED_PUSHED_TOTAL + ${minted:-0}))
  now="$(epoch)"
  printf '%s,%s,%s,%s,%s,%s,%s\n' \
    "$(iso_now)" "$now" "$((now - WINDOW_START_EPOCH))" "$phase" \
    "$asked" "${minted:-0}" "$MIXED_PUSHED_TOTAL" >> "$MIXED_PUSH_LOG"
}

# MIN_AVAILABLE_WORK for post_guard_feed_starved. The number that guard wants
# is upstream supply PLUS the due queue, never the upstream backlog alone -
# on this run the backlog lives in `sync_jobs` by design (the poll drains the
# stub within a tick or two), so a stub-only reading would report a starved
# feed on a run carrying thousands of queued children.
MIXED_MIN_AVAILABLE_WORK=""

mixed_track_available_work() {
  local backlog due total
  backlog="$(of_backlog "$MIXED_TENANT" "$ALLEGRO_A_CONNECTION_ID" 2>/dev/null || printf 'unknown')"
  due="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE status IN ('queued','running') AND \"nextRunAt\"<=NOW()" 2>/dev/null || printf 0)"
  case "$backlog" in
    ''|*[!0-9]*) total="${due:-0}" ;;   # unknown upstream -> count the queue only
    *)           total=$(( backlog + ${due:-0} )) ;;
  esac
  if [ -z "$MIXED_MIN_AVAILABLE_WORK" ] || [ "$total" -lt "$MIXED_MIN_AVAILABLE_WORK" ]; then
    MIXED_MIN_AVAILABLE_WORK="$total"
  fi
}

log "=== window open: ${MIXED_DURATION_SECS}s, ${MIXED_ORDERS_PER_MIN} orders/min offered ==="
mixed_phase_set "steady"

MIXED_TICK=0
while :; do
  MIXED_ELAPSED=$(( $(epoch) - WINDOW_START_EPOCH ))
  [ "$MIXED_ELAPSED" -lt "$MIXED_DURATION_SECS" ] || break

  # Fault window. Entered and left by elapsed time so a slow tick cannot skip
  # it, and the phase label is what lets the report separate the pre-fault
  # throughput from the recovery.
  if [ "$MIXED_FAULT_AT_SECS" -gt 0 ]; then
    if [ "$MIXED_FAULT_ACTIVE" = "0" ] \
       && [ "$MIXED_ELAPSED" -ge "$MIXED_FAULT_AT_SECS" ] \
       && [ "$MIXED_ELAPSED" -lt $(( MIXED_FAULT_AT_SECS + MIXED_FAULT_SECS )) ]; then
      log "injecting destination fault: docker pause $PS_CONTAINER (elapsed ${MIXED_ELAPSED}s)"
      docker pause "$PS_CONTAINER" >/dev/null
      MIXED_FAULT_ACTIVE=1
      mixed_phase_set "fault"
    elif [ "$MIXED_FAULT_ACTIVE" = "1" ] \
       && [ "$MIXED_ELAPSED" -ge $(( MIXED_FAULT_AT_SECS + MIXED_FAULT_SECS )) ]; then
      log "clearing destination fault: docker unpause $PS_CONTAINER (elapsed ${MIXED_ELAPSED}s)"
      docker unpause "$PS_CONTAINER" >/dev/null
      MIXED_FAULT_ACTIVE=0
      mixed_phase_set "recovery"
    fi
  fi

  mixed_push_tick "$(cat "$MIXED_PHASE_FILE" 2>/dev/null || printf 'steady')"
  mixed_track_available_work

  MIXED_TICK=$((MIXED_TICK + 1))
  if [ $(( MIXED_TICK % 10 )) -eq 0 ]; then
    log "t+${MIXED_ELAPSED}s phase=$(cat "$MIXED_PHASE_FILE" 2>/dev/null) pushed=$MIXED_PUSHED_TOTAL minAvailableWork=${MIXED_MIN_AVAILABLE_WORK:-?}"
  fi

  # One push per minute. `sleep` is computed against the wall clock rather
  # than a fixed 60 so a slow tick (a paused destination makes several of the
  # queries above wait) does not let the arrival rate drift downward
  # unnoticed - the offered rate is an independent variable and must stay one.
  MIXED_NEXT=$(( WINDOW_START_EPOCH + MIXED_TICK * 60 ))
  MIXED_SLEEP=$(( MIXED_NEXT - $(epoch) ))
  if [ "$MIXED_SLEEP" -gt 0 ]; then
    sleep "$MIXED_SLEEP"
  else
    warn "push tick $MIXED_TICK ran $(( -MIXED_SLEEP ))s late - the offered rate is drifting below ${MIXED_ORDERS_PER_MIN}/min"
  fi
done

if [ "$MIXED_FAULT_ACTIVE" = "1" ]; then
  log "clearing destination fault at window close"
  docker unpause "$PS_CONTAINER" >/dev/null
  MIXED_FAULT_ACTIVE=0
fi

mixed_phase_set "closing"
mixed_supp_sampler_stop
window_stop "$RESULTS_DIR"
log "=== window closed after $(( WINDOW_STOP_EPOCH - WINDOW_START_EPOCH ))s, pushed $MIXED_PUSHED_TOTAL order(s) ==="

# ===========================================================================
# Post-guards and summary
# ===========================================================================
run_post_guards "$RESULTS_DIR" "$CONN_IDS" "$WS_ISO" \
  "$WINDOW_START_EPOCH" "$WINDOW_STOP_EPOCH" "$PS_CONNECTION_ID" "" "" \
  "$MIXED_MIN_AVAILABLE_WORK"

log "=== summary ==="
bash "$SCRIPT_DIR/../drivers/mixed-summarize.sh" "$RESULTS_DIR" \
  "$WS_ISO" "$ALLEGRO_A_CONNECTION_ID" "$PS_CONNECTION_ID" "$MIXED_PUSHED_TOTAL" \
  | tee "$RESULTS_DIR/summary.txt"

# ---------------------------------------------------------------------------
# Hand the stand back. The runner goes off FIRST so nothing is mid-flight
# while the backlog is purged, and only then are this window's own leftovers
# removed - `guard_queue_empty` is the next scenario's first pre-flight check,
# and a saturating run leaves thousands of rows behind by construction.
#
# Rows are deleted rather than marked `dead`: a `dead` row is an operator-
# facing failure record, and these jobs did not fail - they were never
# reached. Bounded to rows created inside this window so nothing predating the
# run is touched.
# ---------------------------------------------------------------------------
log "=== teardown ==="
mixed_set_worker_posture "$ORIGINAL_RUNNER_ENABLED" "$ORIGINAL_SCHEDULER_ENABLED" skip-wait
MIXED_PURGED="$(pg_sql "WITH d AS (DELETE FROM sync_jobs WHERE \"createdAt\">='$WS_ISO' AND status IN ('queued','running') RETURNING 1) SELECT COUNT(*) FROM d")"
log "purged ${MIXED_PURGED:-0} unreached sync_jobs row(s) created inside the window"
mixed_restore_dest_rate_limit

log "results: $RESULTS_DIR"
verdict_read "$RESULTS_DIR" | sed 's/^/    /'
