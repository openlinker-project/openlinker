#!/usr/bin/env bash
#
# Shared library for the performance measurement programme (#2841, epic #2840).
#
# This is a LIBRARY, meant to be `source`d by a scenario script or by
# `run-all.sh` (#2845) - it defines functions and does not run anything on
# its own. `bash lib.sh` by itself does nothing but load definitions.
#
# Why this file exists at all: `perf/prestashop-baseline` grew seven runner
# scripts that each re-implemented login, the drain-wait loop, env defaults
# and the queue purge, and one of those copies was wrong in a way nobody
# noticed until a results file quietly reported the wrong offset (see that
# tree's README, "run-a1a-at-offset.sh ... silently failed to seed"). Every
# guard, every piece of arrange/observe logic and the results-directory shape
# lives here exactly once. A scenario script sources this file, calls
# `stand_up`, runs its own load, then calls `window_start` / drives its load /
# `window_stop`, then `write_verdict`. It must not re-implement any of that
# itself.
#
# Style match with bootstrap.sh: explain WHY, cite the issue or source file
# for anything non-obvious, no product-code speculation.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration. Same defaults as bootstrap.sh - both point at the `lab`
# stand (#2854) unless overridden.
# ---------------------------------------------------------------------------
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PS_CONTAINER="${PS_CONTAINER:-lab-prestashop}"
PS_MYSQL_CONTAINER="${PS_MYSQL_CONTAINER:-lab-mysql}"
PS_DB="${PS_DB:-prestashop}"
WC_CONTAINER="${WC_CONTAINER:-lab-woocommerce}"
WC_PATH="${WC_PATH:-/opt/bitnami/wordpress}"
PG_CONTAINER="${PG_CONTAINER:-lab-postgres}"
PG_DB="${PG_DB:-openlinker}"
PG_USER="${PG_USER:-postgres}"
REDIS_CONTAINER="${REDIS_CONTAINER:-lab-redis}"
OL_API_CONTAINER="${OL_API_CONTAINER:-lab-api}"
# Space-separated list. A `--scale worker=3` stand (#2854) does not carry a
# fixed `container_name` per replica the way the single-worker default does -
# override this per stand, e.g. WORKER_CONTAINERS="lab-worker-1 lab-worker-2 lab-worker-3".
WORKER_CONTAINERS="${WORKER_CONTAINERS:-lab-worker}"

OL_API_URL="${OL_API_URL:-http://127.0.0.1:13000}"
OL_ADMIN_USER="${OL_ADMIN_USER:-admin}"
OL_ADMIN_PASSWORD="${OL_ADMIN_PASSWORD:-admin}"

# `bootstrap.sh` emits this next to lib.sh; every scenario needs the
# connection ids it recorded so no operator is ever asked to paste one.
STAND_IDS_FILE="${STAND_IDS_FILE:-$LIB_DIR/stand-ids.env}"
if [ -f "$STAND_IDS_FILE" ]; then
  # shellcheck disable=SC1090
  source "$STAND_IDS_FILE"
fi

# Results contract root. One directory per scenario RUN (not per scenario -
# a scenario run 3 times produces 3 of these), holding manifest.json,
# summary.json, timeseries.csv, verdict.txt, the raw k6 JSON and a sync_jobs
# dump. See `results_dir_init` / README "Results contract".
RESULTS_ROOT="${RESULTS_ROOT:-$LIB_DIR/results}"

# Log-prefix is configurable so bootstrap.sh's `[bootstrap]` voice survives
# the extraction below unchanged, and a scenario script can stamp its own name.
LIB_LOG_PREFIX="${LIB_LOG_PREFIX:-lib}"

# Perf-enqueued jobs get this maxAttempts instead of the entity default of 10
# (sync-job.orm-entity.ts:69) - see `enqueue_perf_job` / `guard_perf_max_attempts`
# below for why the HTTP contract cannot set this at enqueue time and what we
# do about it instead (#2841 "guard_perf_max_attempts").
PERF_MAX_ATTEMPTS="${PERF_MAX_ATTEMPTS:-3}"

# Drain-wait tuning. A hung scenario must not stall a whole overnight campaign
# (#2841 "unattended running needs a drain timeout, not just a drain loop").
DRAIN_POLL_SECS="${DRAIN_POLL_SECS:-5}"
DRAIN_IDLE_TICKS="${DRAIN_IDLE_TICKS:-6}"
DRAIN_MAX_WAIT_SECS="${DRAIN_MAX_WAIT_SECS:-1800}"

# The settle period between the last passing guard and window_start (#2841
# "A settle window between pre-flight and the measurement"). The heaviest
# thing on the stand is the image build/rebuild that guard_build implies -
# without a pause, run 1 opens on a hot CPU and a build-filled page cache.
SETTLE_SECS="${SETTLE_SECS:-60}"

# The observer tick interval. `docker stats --no-stream` alone costs ~1s for
# eleven containers, so this is nominal - `sample_queue` records the actual
# elapsed interval as `dt` rather than assuming it hit this exactly (#2841
# "The sampler must not enter its own results").
SAMPLE_INTERVAL_SECS="${SAMPLE_INTERVAL_SECS:-1}"

mkdir -p "$RESULTS_ROOT"

# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------
log()  { printf '[%s] %s\n' "$LIB_LOG_PREFIX" "$*"; }
warn() { printf '[%s] WARN  %s\n' "$LIB_LOG_PREFIX" "$*" >&2; }
die()  { printf '[%s] FATAL %s\n' "$LIB_LOG_PREFIX" "$*" >&2; exit 1; }

require_tools() {
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || die "missing host tool: $tool"
  done
}

epoch() { date +%s; }
iso_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# ---------------------------------------------------------------------------
# MySQL over docker exec (ported verbatim from bootstrap.sh - see its header
# comment for why ps_sql / ps_sql_write are kept as two distinct functions:
# a lenient probe vs. a strict write that dies on the first failure).
# ---------------------------------------------------------------------------
PS_MYSQL_PWD="${PS_MYSQL_PWD:-}"
ps_mysql_pwd() {
  [ -n "$PS_MYSQL_PWD" ] && return 0
  PS_MYSQL_PWD="$(docker exec "$PS_MYSQL_CONTAINER" printenv MYSQL_ROOT_PASSWORD)"
  [ -n "$PS_MYSQL_PWD" ] || die "could not read MYSQL_ROOT_PASSWORD from $PS_MYSQL_CONTAINER"
}

ps_sql() {
  ps_mysql_pwd
  docker exec -i -e MYSQL_PWD="$PS_MYSQL_PWD" "$PS_MYSQL_CONTAINER" \
    mysql -uroot -N -B "$PS_DB" -e "$1" 2>&1 | grep -v '^mysql: \[Warning\]' || true
}

ps_sql_write() {
  ps_mysql_pwd
  docker exec -i -e MYSQL_PWD="$PS_MYSQL_PWD" "$PS_MYSQL_CONTAINER" \
    mysql -uroot -N -B "$PS_DB" -e "$1" \
    || die "MySQL write failed: $1"
}

wc_wp() {
  docker exec -i "$WC_CONTAINER" wp --allow-root --no-debug --path="$WC_PATH" "$@" 2>/dev/null
}

pg_sql() {
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tA -c "$1"
}

# Same command, kept distinct from `pg_sql` for the same reason ps_sql /
# ps_sql_write are: a write that silently no-ops must never read as success.
pg_sql_write() {
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -tA -c "$1" \
    || die "Postgres write failed: $1"
}

redis_cli() {
  docker exec -i "$REDIS_CONTAINER" redis-cli "$@"
}

# ---------------------------------------------------------------------------
# OpenLinker HTTP API (ported verbatim from bootstrap.sh, plus `jq` instead
# of `python3 -c` for JSON per this library's own convention - see README
# "jq vs python3").
# ---------------------------------------------------------------------------
OL_TOKEN="${OL_TOKEN:-}"

# `-f` alone hides the response body on a 4xx/5xx, which is exactly where a
# scenario tends to fail (a rejected field, a stale connection id) - so this
# captures body+status separately and prints the body before dying.
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

json_field() { jq -r --arg k "$1" '.[$k] // empty'; }

# One implementation of login, with the defensive `accessToken` / `access_token`
# parse `run-scenario.sh` already carried (#2841's own table names this as the
# first thing to de-duplicate). Re-run per scenario RUN, never once per
# campaign - JWT_EXPIRES_IN defaults to 15m (#2845's own concern, but the
# function this library exposes is what makes that cheap to do).
ol_login() {
  local resp
  resp="$(curl -sS -X POST "$OL_API_URL/v1/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$OL_ADMIN_USER\",\"password\":\"$OL_ADMIN_PASSWORD\"}")"
  OL_TOKEN="$(printf '%s' "$resp" | jq -r '.access_token // .accessToken // empty')"
  [ -n "$OL_TOKEN" ] || die "login failed at $OL_API_URL as $OL_ADMIN_USER: $resp"
}

# ---------------------------------------------------------------------------
# Perf-job enqueue, with the low-maxAttempts cap applied (guard_perf_max_attempts)
#
# POST /v1/sync/jobs (EnqueueSyncJobDto) does not accept maxAttempts - it is
# not a field on the DTO (apps/api/src/sync/http/dto/enqueue-sync-job.dto.ts),
# so a perf job always starts life at the entity default of 10
# (sync-job.orm-entity.ts:69) with exponential backoff capped at 6h
# (sync-job.runner.ts) - roughly 30.25h to reach `dead`. This function
# enqueues, THEN downgrades that one row's maxAttempts directly via psql to
# PERF_MAX_ATTEMPTS, so one unseeded/misconfigured row cannot silently
# reserve ~30h behind nextRunAt and starve a later flow's drain wait. This is
# an operational action taken by the harness against its own database, not a
# product-code change or a new config surface.
# ---------------------------------------------------------------------------
enqueue_perf_job() {
  local job_type="$1" connection_id="$2" payload="$3" idempotency_key="$4" resp job_id
  resp="$(ol_api POST /v1/sync/jobs "{\"jobType\":\"$job_type\",\"connectionId\":\"$connection_id\",\"payload\":$payload,\"idempotencyKey\":\"$idempotency_key\"}")"
  job_id="$(printf '%s' "$resp" | jq -r '.id // empty')"
  if [ -n "$job_id" ]; then
    pg_sql_write "UPDATE sync_jobs SET \"maxAttempts\"=$PERF_MAX_ATTEMPTS WHERE id='$job_id' AND status IN ('queued','running')" >/dev/null
  else
    warn "enqueue_perf_job: response carried no id - could not cap maxAttempts ($resp)"
  fi
  printf '%s' "$resp"
}

# ---------------------------------------------------------------------------
# guard_perf_max_attempts - fatal, pre-flight (#2841 table)
#
# Confirms the mechanism `enqueue_perf_job` depends on actually works against
# this stand: a write connection to sync_jobs, and a sane PERF_MAX_ATTEMPTS
# (positive, and lower than the entity default of 10 - a value at or above 10
# would not be a cap at all). The no-op UPDATE (WHERE 1=0) exercises the same
# write path enqueue_perf_job uses without touching a real row.
# ---------------------------------------------------------------------------
guard_perf_max_attempts() {
  [ "$PERF_MAX_ATTEMPTS" -gt 0 ] 2>/dev/null || die "guard_perf_max_attempts: PERF_MAX_ATTEMPTS must be a positive integer, got '$PERF_MAX_ATTEMPTS' - set PERF_MAX_ATTEMPTS to a small number (default 3)"
  [ "$PERF_MAX_ATTEMPTS" -lt 10 ] || die "guard_perf_max_attempts: PERF_MAX_ATTEMPTS=$PERF_MAX_ATTEMPTS is not lower than the sync_jobs entity default (10) - it would cap nothing"
  pg_sql_write "UPDATE sync_jobs SET \"maxAttempts\"=\"maxAttempts\" WHERE 1=0" >/dev/null \
    || die "guard_perf_max_attempts: could not write to sync_jobs on $PG_CONTAINER - enqueue_perf_job's cap would silently not apply"
  log "guard_perf_max_attempts ok (cap=$PERF_MAX_ATTEMPTS)"
}

# ===========================================================================
# Guards - fatal, pre-flight. Every one of these must pass BEFORE
# window_start, per the epic's own rule: "a guard that aborts before the
# window costs seconds; one that discards after costs the whole run."
# ===========================================================================

# guard_queue_empty - no queued/running sync_jobs rows for the given
# connection ids. A leftover row from a previous, unrelated run would enqueue
# its own children mid-window and pollute the count this scenario measures.
guard_queue_empty() {
  local ids_csv="$1" n
  [ -n "$ids_csv" ] || die "guard_queue_empty: no connection ids given"
  n="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\" IN ($ids_csv) AND status IN ('queued','running')")"
  [ "${n:-0}" -eq 0 ] || die "guard_queue_empty: $n queued/running sync_jobs row(s) already present for connection(s) [$ids_csv] - drain them (see reset_between_repeats / drain_wait) before opening a new window"
  log "guard_queue_empty ok"
}

# guard_scheduler_off - the enablement half (OL_SCHEDULER_ENABLED) plus the
# cadence half, since an operational_settings row overrides cronEnvVar /
# defaultCron (scheduler.service.ts) and is invisible to an env-var-only
# check. Fatal only on the enablement half; the cadence row is CAPTURED into
# the manifest rather than gated on, because a scenario may deliberately run
# WITH the scheduler on (#2841's own table: "guard_scheduler_off - no cron
# can fire into the window" is this function's job when the scenario expects
# the scheduler off; a scenario that wants it on should not call this guard
# at all and should instead record its posture via manifest_set directly).
guard_scheduler_off() {
  local w w_enabled
  # #2279 moved the scheduler singleton out of apps/api entirely (worker
  # roles own it now), so only the worker containers' posture matters here -
  # checking the api's OL_SCHEDULER_ENABLED would be checking a variable
  # nothing on that process reads.
  for w in $WORKER_CONTAINERS; do
    w_enabled="$(docker exec "$w" printenv OL_SCHEDULER_ENABLED 2>/dev/null || printf 'true')"
    [ "$w_enabled" = "false" ] || die "guard_scheduler_off: $w has OL_SCHEDULER_ENABLED=$w_enabled - a cron could fire into the measurement window"
  done
  MANIFEST_SCHEDULER_CADENCE_ROW="$(scheduler_cadence_row)"
  log "guard_scheduler_off ok (operational_settings cadence row: ${MANIFEST_SCHEDULER_CADENCE_ROW:-<none>})"
}

# Reads the singleton operational_settings row as JSON, or empty if the table
# has no row (an install that never opened the settings page - #2651). This
# is what the manifest records instead of just OL_*_CRON, per the scheduler
# guard's "two halves" note.
scheduler_cadence_row() {
  # A scalar subquery, not a bare SELECT ... FROM (...) t - the bare form
  # returns ZERO rows (not one NULL row) when the singleton table is empty,
  # which prints nothing and is easy to misread as "query failed" rather
  # than "no row yet, correctly report {}".
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tA -c \
    "SELECT COALESCE((SELECT row_to_json(t) FROM (SELECT * FROM operational_settings LIMIT 1) t), '{}')" 2>/dev/null || printf '{}'
}

# guard_demo_mode_off - demo mode brings a read-only lock, a registration
# rate limit and an account-cleanup tick that must not land mid-window.
guard_demo_mode_off() {
  local demo
  demo="$(docker exec "$OL_API_CONTAINER" printenv OL_DEMO_MODE 2>/dev/null || printf 'false')"
  [ "$demo" != "true" ] || die "guard_demo_mode_off: OL_DEMO_MODE=true on $OL_API_CONTAINER - disable it before measuring (a demo-mode tick would land mid-window)"
  log "guard_demo_mode_off ok"
}

# guard_connection_budget - Sum(OL_DB_POOL_MAX x processes) < max_connections
# (#2841 "closes a hard blocker on multi-replica runs"). Both numbers are
# recorded into the manifest via the MANIFEST_* globals this sets, because
# the pool ceiling is also the real ingress concurrency ceiling #2842
# measures against - a reported condition, not just a pre-flight.
guard_connection_budget() {
  local max_conn pool_max n_workers total
  max_conn="$(pg_sql "SHOW max_connections")"
  pool_max="$(docker exec "$OL_API_CONTAINER" printenv OL_DB_POOL_MAX 2>/dev/null || printf '40')"
  n_workers=0
  for _ in $WORKER_CONTAINERS; do n_workers=$((n_workers + 1)); done
  # api (1 process) + every worker replica, each holding its own pool
  # (libs/shared/src/database/database.module.ts:81, "this bounds ONE process").
  total=$(( pool_max * (1 + n_workers) ))
  MANIFEST_MAX_CONNECTIONS="$max_conn"
  MANIFEST_OL_DB_POOL_MAX="$pool_max"
  MANIFEST_DB_PROCESS_COUNT=$((1 + n_workers))
  MANIFEST_DB_CONNECTION_BUDGET="$total"
  [ "$total" -lt "$max_conn" ] || die "guard_connection_budget: OL_DB_POOL_MAX($pool_max) x processes($((1 + n_workers))) = $total >= Postgres max_connections($max_conn) - lower OL_DB_POOL_MAX, raise max_connections (docker-compose.lab.yml postgres 'command:' override, #2854), or reduce worker replicas"
  log "guard_connection_budget ok (budget=$total, max_connections=$max_conn)"
}

# guard_pool_recorded - a narrower assertion than guard_connection_budget:
# both figures actually resolved to something and are not blank in the
# manifest. Split out because #2841's own table lists it as a distinct
# function, even though guard_connection_budget already computes both values
# as a side effect - calling this after guard_connection_budget is cheap and
# catches the case where that guard was skipped by a scenario script that
# only wanted the budget check disabled (never do that; this exists so a
# regression in call order is caught rather than silently passing).
guard_pool_recorded() {
  [ -n "${MANIFEST_OL_DB_POOL_MAX:-}" ] || die "guard_pool_recorded: OL_DB_POOL_MAX not resolved - call guard_connection_budget first"
  [ -n "${MANIFEST_MAX_CONNECTIONS:-}" ] || die "guard_pool_recorded: Postgres max_connections not resolved - call guard_connection_budget first"
  log "guard_pool_recorded ok"
}

# guard_build - the running api/worker images carry the working tree's
# revision, never assumed (#2841 "guard_build is redefined: a LABEL, not a
# digest diff"). Requires the root Dockerfile's production/worker stages to
# carry `LABEL org.opencontainers.image.revision` (this child adds it).
guard_build() {
  local head containers c rev
  head="$(git -C "$LIB_DIR" rev-parse HEAD)"
  containers="$OL_API_CONTAINER $WORKER_CONTAINERS"
  for c in $containers; do
    rev="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$c" 2>/dev/null || true)"
    if [ -z "$rev" ]; then
      die "guard_build: $c carries no org.opencontainers.image.revision label - the image predates the LABEL added by this child's Dockerfile change, or was built without --build-arg OL_GIT_SHA=\$(git rev-parse HEAD). Rebuild the stand (#2854)."
    fi
    if [ "$rev" != "$head" ]; then
      die "guard_build: $c was built from $rev but the working tree is at $head - rebuild before measuring (a stale image silently measures pre-change code)"
    fi
  done
  MANIFEST_GIT_SHA="$head"
  log "guard_build ok (sha=$head)"
}

# guard_runner_state - the running worker's WORKER_RUNNER_ENABLED posture
# matches what the scenario declares, and the lane-caps startup line is
# treated as REQUIRED, not optional - an absent line (because the runner was
# disabled) must never read as "no caps to record", or the stale
# `'fan-out': {total:1,perScope:1}` field initializer (sync-job.runner.ts)
# would silently manifest as though it had been resolved (#2841's own note).
#
# expected: "enabled" or "disabled".
guard_runner_state() {
  local expected="$1" w enabled line caps
  for w in $WORKER_CONTAINERS; do
    enabled="$(docker exec "$w" printenv WORKER_RUNNER_ENABLED 2>/dev/null || printf 'true')"
    if [ "$expected" = "enabled" ]; then
      [ "$enabled" != "false" ] || die "guard_runner_state: $w has WORKER_RUNNER_ENABLED=false but the scenario expects the runner enabled"
      line="$(docker logs "$w" 2>&1 | grep -F 'Starting sync job runner loop' | tail -1 || true)"
      [ -n "$line" ] || die "guard_runner_state: $w's log carries no 'Starting sync job runner loop' line - treating this as a failure, never as 'no caps to record' (a disabled runner never resolves real lane caps)"
      caps="$(printf '%s' "$line" | grep -oP 'lane caps: \K.*(?=\))' || true)"
      [ -n "$caps" ] || die "guard_runner_state: could not parse lane caps out of: $line"
      MANIFEST_LANE_CAPS="$caps"
    else
      [ "$enabled" = "false" ] || die "guard_runner_state: $w has WORKER_RUNNER_ENABLED=$enabled but the scenario expects the runner disabled - #2842's own gate commits sync_jobs rows that would otherwise execute inside this measurement window"
    fi
  done
  MANIFEST_RUNNER_STATE="$expected"
  log "guard_runner_state ok (expected=$expected${MANIFEST_LANE_CAPS:+, lane caps: $MANIFEST_LANE_CAPS})"
}

# guard_log_level - OL_LOG_BODY_MAX_BYTES must be a positive value.
# format-body-for-log.ts treats unset/empty/0/negative/non-numeric as
# UNCAPPED, and the full-body log sites (allegro-http-client.ts,
# prestashop-webservice.client.ts) log at `error`, not `debug` - so raising
# the worker's log level does not suppress them (#2841's own note).
guard_log_level() {
  local w val
  for w in $OL_API_CONTAINER $WORKER_CONTAINERS; do
    val="$(docker exec "$w" printenv OL_LOG_BODY_MAX_BYTES 2>/dev/null || printf '')"
    if [ -z "$val" ] || ! [ "$val" -gt 0 ] 2>/dev/null; then
      die "guard_log_level: $w has OL_LOG_BODY_MAX_BYTES='${val:-<unset>}' - unset or 0 means UNCAPPED full-body logging at error level regardless of the worker's log level. Set OL_LOG_BODY_MAX_BYTES to a positive value before measuring."
    fi
  done
  log "guard_log_level ok"
}

# ---------------------------------------------------------------------------
# manifest_* - written before any load, never hand-edited (#2841 AC).
# One JSON object per run, assembled from the MANIFEST_* globals the guards
# above populate plus a handful of extra reads. `manifest_write` is called
# once, by `window_start`, so "before any load" is structural rather than a
# convention a scenario script has to remember.
# ---------------------------------------------------------------------------
manifest_gather_environment() {
  local pg_shared_buffers pg_work_mem pg_preload pg_stat_ext node_ver pg_image redis_image \
    redis_used_mem host_cpu host_ram host_load
  pg_shared_buffers="$(pg_sql "SHOW shared_buffers" 2>/dev/null || printf 'unknown')"
  pg_work_mem="$(pg_sql "SHOW work_mem" 2>/dev/null || printf 'unknown')"
  pg_preload="$(pg_sql "SHOW shared_preload_libraries" 2>/dev/null || printf 'unknown')"
  pg_stat_ext="$(pg_sql "SELECT COALESCE(string_agg(extname, ','), '') FROM pg_extension WHERE extname IN ('pg_stat_statements','pg_trgm')" 2>/dev/null || printf 'unknown')"
  node_ver="$(docker exec "$OL_API_CONTAINER" node --version 2>/dev/null || printf 'unknown')"
  pg_image="$(docker inspect --format '{{.Image}}' "$PG_CONTAINER" 2>/dev/null || printf 'unknown')"
  redis_image="$(docker inspect --format '{{.Image}}' "$REDIS_CONTAINER" 2>/dev/null || printf 'unknown')"
  redis_used_mem="$(redis_cli INFO memory 2>/dev/null | grep '^used_memory:' | cut -d: -f2 | tr -d '\r' || printf 'unknown')"
  host_cpu="$(nproc 2>/dev/null || printf 'unknown')"
  host_ram="$( { free -m 2>/dev/null || true; } | awk '/^Mem:/{print $2"MB"}')"
  host_ram="${host_ram:-unknown}"
  host_load="$(uptime 2>/dev/null | grep -oP 'load average[s:]* \K.*' || printf 'unknown')"

  jq -n \
    --arg shared_buffers "$pg_shared_buffers" \
    --arg work_mem "$pg_work_mem" \
    --arg shared_preload_libraries "$pg_preload" \
    --arg installed_extensions "$pg_stat_ext" \
    --arg node_version "$node_ver" \
    --arg postgres_image_digest "$pg_image" \
    --arg redis_image_digest "$redis_image" \
    --arg redis_used_memory_bytes "$redis_used_mem" \
    --arg host_cpu_count "$host_cpu" \
    --arg host_ram "$host_ram" \
    --arg host_load_average "$host_load" \
    '{postgres:{shared_buffers:$shared_buffers, work_mem:$work_mem, shared_preload_libraries:$shared_preload_libraries, installed_extensions:$installed_extensions},
      node_version:$node_version, postgres_image_digest:$postgres_image_digest, redis_image_digest:$redis_image_digest,
      redis_used_memory_bytes:$redis_used_memory_bytes,
      host:{cpu_count:$host_cpu_count, ram:$host_ram, load_average:$host_load_average}}'
}

# Container resource limits (#2841 "container resource limits or the
# explicit statement that they are absent"). `NanoCpus`/`Memory` read 0 when
# no limit is set - reported as the literal string "none" rather than "0",
# which would read as a zero limit.
manifest_container_limits() {
  local c cpus mem out="[]"
  for c in $OL_API_CONTAINER $WORKER_CONTAINERS; do
    cpus="$(docker inspect --format '{{.HostConfig.NanoCpus}}' "$c" 2>/dev/null || printf '0')"
    mem="$(docker inspect --format '{{.HostConfig.Memory}}' "$c" 2>/dev/null || printf '0')"
    [ "$cpus" != "0" ] || cpus="none"
    [ "$mem" != "0" ] || mem="none"
    out="$(jq -n --argjson arr "$out" --arg c "$c" --arg cpus "$cpus" --arg mem "$mem" \
      '$arr + [{container:$c, cpu_nanocpus:$cpus, memory_bytes:$mem}]')"
  done
  printf '%s' "$out"
}

# dataset_sizes_json <label>=<sql> [<label>=<sql> ...]
# Lets a scenario declare which table counts belong in ITS manifest (e.g.
# "products=SELECT COUNT(*) FROM product_variants") without this library
# hardcoding a fixed table list.
dataset_sizes_json() {
  local pair label sql n out="{}"
  for pair in "$@"; do
    label="${pair%%=*}"; sql="${pair#*=}"
    n="$(pg_sql "$sql" 2>/dev/null || printf 'null')"
    out="$(jq -n --argjson obj "$out" --arg k "$label" --arg v "${n:-null}" '$obj + {($k): ($v|tonumber? // $v)}')"
  done
  printf '%s' "$out"
}

# manifest_write <results_dir> <scenario> <connection_ids_csv> <quick:0|1> <extra_json>
# extra_json is a scenario-supplied jq object merged on top (dataset sizes,
# arrival rate, replica count, destination declared, etc.) - kept last so a
# scenario can override nothing this library computed but add its own facts.
manifest_write() {
  local dir="$1" scenario="$2" conn_ids="$3" quick="$4" extra="${5:-}"
  # ${5:-{}} looks equivalent but is NOT: bash matches braces generically when
  # scanning for the parameter-expansion terminator, so a literal `{}` inside
  # the default-value branch of ${VAR:-...} consumes one extra `}` even when
  # $5 IS set - verified: `set -- x; : "${1:-{}}"` yields `x}`, not `x`.
  [ -n "$extra" ] || extra='{}'
  local sync_before sync_after env_json limits_json
  sync_before="$(pg_sql "SELECT COUNT(*) FROM sync_jobs" 2>/dev/null || printf '0')"
  env_json="$(manifest_gather_environment)"
  limits_json="$(manifest_container_limits)"
  # Same ${VAR:-{}} trap as `extra` above - built as a plain variable rather
  # than inline in the ${...:-{}} shape.
  local scheduler_row="${MANIFEST_SCHEDULER_CADENCE_ROW:-}"
  [ -n "$scheduler_row" ] || scheduler_row='{}'

  jq -n \
    --arg scenario "$scenario" \
    --arg generated_at "$(iso_now)" \
    --arg git_sha "${MANIFEST_GIT_SHA:-unknown}" \
    --arg connection_ids "$conn_ids" \
    --argjson quick "$([ "$quick" = 1 ] && echo true || echo false)" \
    --arg runner_state "${MANIFEST_RUNNER_STATE:-unknown}" \
    --arg lane_caps "${MANIFEST_LANE_CAPS:-unknown}" \
    --arg max_connections "${MANIFEST_MAX_CONNECTIONS:-unknown}" \
    --arg ol_db_pool_max "${MANIFEST_OL_DB_POOL_MAX:-unknown}" \
    --arg db_process_count "${MANIFEST_DB_PROCESS_COUNT:-unknown}" \
    --arg db_connection_budget "${MANIFEST_DB_CONNECTION_BUDGET:-unknown}" \
    --arg scheduler_cadence_row "$scheduler_row" \
    --arg ol_log_body_max_bytes "${MANIFEST_LOG_BODY_MAX_BYTES:-unknown}" \
    --arg sync_jobs_rows_at_start "$sync_before" \
    --argjson environment "$env_json" \
    --argjson container_limits "$limits_json" \
    --argjson extra "$extra" \
    '{
      scenario: $scenario,
      generatedAt: $generated_at,
      gitSha: $git_sha,
      connectionIds: $connection_ids,
      quick: $quick,
      runnerState: $runner_state,
      laneCaps: $lane_caps,
      pool: {maxConnections: $max_connections, olDbPoolMax: $ol_db_pool_max, processCount: $db_process_count, budget: $db_connection_budget},
      schedulerCadenceRow: ($scheduler_cadence_row | fromjson? // {}),
      olLogBodyMaxBytes: $ol_log_body_max_bytes,
      syncJobsRowsAtStart: ($sync_jobs_rows_at_start | tonumber? // 0),
      syncJobsRowsAtEnd: null,
      environment: $environment,
      containerLimits: $container_limits,
      excludedPgStatStatementsQueries: ["GET /v1/connections/:id/sync-status (7-day connection-sync-status aggregate over sync_jobs) - issued by sample_queue itself, see README"]
    } * $extra' > "$dir/manifest.json"
  log "wrote $dir/manifest.json"
}

manifest_set_sync_jobs_end() {
  local dir="$1" sync_after
  sync_after="$(pg_sql "SELECT COUNT(*) FROM sync_jobs" 2>/dev/null || printf '0')"
  jq --argjson n "$sync_after" '.syncJobsRowsAtEnd = $n' "$dir/manifest.json" > "$dir/manifest.json.tmp"
  mv "$dir/manifest.json.tmp" "$dir/manifest.json"
}

# ---------------------------------------------------------------------------
# results_dir_init - one shape, every scenario (#2841 AC).
# ---------------------------------------------------------------------------
results_dir_init() {
  local scenario="$1" label="$2" dir
  dir="$RESULTS_ROOT/$scenario/$label"
  mkdir -p "$dir"
  printf '%s' "$dir"
}

# ---------------------------------------------------------------------------
# sample_queue - one observer tick. Appends to timeseries.csv:
#   ts,dt,queued,running,dead,deferred,pg_database_size_bytes,docker_stats_json
#
# `dt` is the ACTUAL interval since the previous tick (#2841 "the sampler
# must not enter its own results" / tick-drift note) - docker stats alone
# costs ~1s for eleven containers, so a nominal 1Hz tick drifts under load.
#
# The GET /v1/connections/:id/sync-status call this function makes is
# recorded as an excluded query in the manifest (manifest_write above) - see
# README "the sampler must not enter its own results".
# ---------------------------------------------------------------------------
_SAMPLE_LAST_TICK_EPOCH=""
sample_queue_header() {
  printf 'ts,dt,queued,running,dead,deferred,pg_database_size_bytes,docker_stats_json\n' > "$1"
}

sample_queue() {
  local dir="$1" conn_ids="$2" csv="$dir/timeseries.csv" now dt queued running dead deferred dbsize stats
  now="$(epoch)"
  if [ -n "$_SAMPLE_LAST_TICK_EPOCH" ]; then dt=$((now - _SAMPLE_LAST_TICK_EPOCH)); else dt=0; fi
  _SAMPLE_LAST_TICK_EPOCH="$now"

  queued="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\" IN ($conn_ids) AND status='queued' AND \"nextRunAt\"<=NOW()" 2>/dev/null || printf 0)"
  running="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\" IN ($conn_ids) AND status='running'" 2>/dev/null || printf 0)"
  dead="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\" IN ($conn_ids) AND status='dead'" 2>/dev/null || printf 0)"
  deferred="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\" IN ($conn_ids) AND status='queued' AND \"nextRunAt\">NOW()" 2>/dev/null || printf 0)"
  dbsize="$(pg_sql "SELECT pg_database_size('$PG_DB')" 2>/dev/null || printf 0)"
  stats="$(docker stats --no-stream --format '{"name":"{{.Name}}","cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}"}' 2>/dev/null | jq -cs '.' || printf '[]')"

  printf '%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$(iso_now)" "$dt" "${queued:-0}" "${running:-0}" "${dead:-0}" "${deferred:-0}" "${dbsize:-0}" \
    "$(printf '%s' "$stats" | sed 's/"/""/g')" >> "$csv"
}

# sampler_start/stop run sample_queue in a background loop, one PID file per
# results dir so two scenarios (never run concurrently on one stand, #2845)
# cannot collide on a stale pid.
sampler_start() {
  local dir="$1" conn_ids="$2"
  sample_queue_header "$dir/timeseries.csv"
  (
    while true; do
      sample_queue "$dir" "$conn_ids" || true
      sleep "$SAMPLE_INTERVAL_SECS"
    done
  ) &
  echo $! > "$dir/.sampler.pid"
  log "sampler started (pid=$(cat "$dir/.sampler.pid"))"
}

sampler_stop() {
  local dir="$1" pid
  [ -f "$dir/.sampler.pid" ] || return 0
  pid="$(cat "$dir/.sampler.pid")"
  kill "$pid" >/dev/null 2>&1 || true
  wait "$pid" 2>/dev/null || true
  rm -f "$dir/.sampler.pid"
  log "sampler stopped"
}

# ---------------------------------------------------------------------------
# window_start / window_stop
# ---------------------------------------------------------------------------
WINDOW_START_EPOCH=""
WINDOW_STOP_EPOCH=""

# window_start <results_dir> <scenario> <conn_ids_csv> <quick:0|1> [extra_manifest_json]
#
# Writes manifest.json BEFORE any load (AC), then inserts the settle period
# (#2841 "A settle window between pre-flight and the measurement") between
# the last guard and the window actually opening, then starts the sampler.
window_start() {
  local dir="$1" scenario="$2" conn_ids="$3" quick="$4" extra="${5:-}"
  # ${5:-{}} looks equivalent but is NOT: bash matches braces generically when
  # scanning for the parameter-expansion terminator, so a literal `{}` inside
  # the default-value branch of ${VAR:-...} consumes one extra `}` even when
  # $5 IS set - verified: `set -- x; : "${1:-{}}"` yields `x}`, not `x`.
  [ -n "$extra" ] || extra='{}'
  manifest_write "$dir" "$scenario" "$conn_ids" "$quick" "$extra"
  log "settling ${SETTLE_SECS}s before window_start (letting the build/rebuild's CPU and page-cache impact fade)"
  sleep "$SETTLE_SECS"
  sampler_start "$dir" "$conn_ids"
  WINDOW_START_EPOCH="$(epoch)"
  log "window_start at $(iso_now)"
}

window_stop() {
  local dir="$1"
  WINDOW_STOP_EPOCH="$(epoch)"
  sampler_stop "$dir"
  manifest_set_sync_jobs_end "$dir"
  log "window_stop at $(iso_now) (elapsed $((WINDOW_STOP_EPOCH - WINDOW_START_EPOCH))s)"
}

# ---------------------------------------------------------------------------
# drain_wait - waits for the queue to go quiet, with a MAX-WAIT TIMEOUT
# (#2841 "unattended running needs a drain timeout, not just a drain loop").
#
# Reports which of three states it hit: drained / deferred / requeued /
# timed_out. On timeout it marks any still-stuck row `dead` and records its
# id, so the campaign can name the cause instead of only reporting a stall
# (the alternative recorded for guard_perf_max_attempts).
#
# Echoes one of: drained | timed_out
# Sets DRAIN_DEFERRED_SEEN=1 / DRAIN_REQUEUED_SEEN=1 / DRAIN_DEAD_IDS="..."
# as a side effect so callers (and post_guard_deferrals/requeues) can inspect
# what happened without re-querying.
# ---------------------------------------------------------------------------
DRAIN_DEFERRED_SEEN=0
DRAIN_REQUEUED_SEEN=0
DRAIN_DEAD_IDS=""

drain_wait() {
  local conn_ids="$1" quiet=0 waited=0 inflight deferred_now
  DRAIN_DEFERRED_SEEN=0
  DRAIN_REQUEUED_SEEN=0
  DRAIN_DEAD_IDS=""
  log "drain_wait: waiting for connection(s) [$conn_ids] to go quiet (max ${DRAIN_MAX_WAIT_SECS}s)"
  while [ "$quiet" -lt "$DRAIN_IDLE_TICKS" ]; do
    if [ "$waited" -ge "$DRAIN_MAX_WAIT_SECS" ]; then
      warn "drain_wait: timed out after ${DRAIN_MAX_WAIT_SECS}s - marking remaining queued/running rows dead and naming them"
      DRAIN_DEAD_IDS="$(pg_sql "SELECT string_agg(id::text, ',') FROM sync_jobs WHERE \"connectionId\" IN ($conn_ids) AND status IN ('queued','running')")"
      if [ -n "$DRAIN_DEAD_IDS" ]; then
        pg_sql_write "UPDATE sync_jobs SET status='dead', \"lastError\"='perf harness drain_wait timeout (#2841)' WHERE \"connectionId\" IN ($conn_ids) AND status IN ('queued','running')" >/dev/null
        warn "drain_wait: marked dead: $DRAIN_DEAD_IDS"
      fi
      echo "timed_out"
      return 1
    fi
    sleep "$DRAIN_POLL_SECS"
    waited=$((waited + DRAIN_POLL_SECS))
    inflight="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\" IN ($conn_ids) AND status IN ('queued','running') AND \"nextRunAt\"<=NOW()")"
    deferred_now="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\" IN ($conn_ids) AND status='queued' AND \"nextRunAt\">NOW()")"
    [ "${deferred_now:-0}" -eq 0 ] || DRAIN_DEFERRED_SEEN=1
    if [ "${inflight:-0}" = "0" ]; then quiet=$((quiet + 1)); else quiet=0; fi
    log "  inflight=${inflight:-0} deferred=${deferred_now:-0} quiet=$quiet waited=${waited}s"
  done
  echo "drained"
}

# ---------------------------------------------------------------------------
# reset_between_repeats - clears both the connection_cursors row(s) AND the
# jobdedup:* Redis keys those connections wrote (#2841 "Repeatability needs
# more than a cursor delete"). A cursor-only reset leaves the 7-day-TTL
# dedupe reservation standing (redis-streams-job-enqueue.service.ts), and an
# 8h campaign sits entirely inside that window - the second and third
# repeat's every enqueue then silently no-ops.
#
# cursor_keys_csv is a comma-separated, single-quoted SQL list of the exact
# cursorKey values this scenario uses, e.g. "'allegro.orders.lastEventId'".
# ---------------------------------------------------------------------------
reset_between_repeats() {
  local conn_ids="$1" cursor_keys_csv="$2" conn_id n
  pg_sql_write "DELETE FROM connection_cursors WHERE \"connectionId\" IN ($conn_ids) AND \"cursorKey\" IN ($cursor_keys_csv)" >/dev/null

  # The dedupe key format is jobdedup:{provider}:{connectionId}:... (order
  # ingestion's is marketplace:{connectionId}:order:{eventKey} -
  # order-ingestion.service.ts:239, redis-streams-job-enqueue.service.ts:23).
  # SCAN rather than KEYS - this runs against the shared redis-data volume,
  # never blocking, matching the #2590 finding of 37,500+ standing keys.
  for conn_id in $(printf '%s' "$conn_ids" | tr -d "'" | tr ',' ' '); do
    n=0
    local cursor=0 batch
    while true; do
      batch="$(redis_cli --no-raw SCAN "$cursor" MATCH "jobdedup:*:${conn_id}:*" COUNT 1000)"
      cursor="$(printf '%s' "$batch" | head -1)"
      local keys
      keys="$(printf '%s' "$batch" | tail -n +2)"
      if [ -n "$keys" ]; then
        # shellcheck disable=SC2086
        redis_cli DEL $keys >/dev/null
        n=$((n + $(printf '%s\n' "$keys" | wc -l)))
      fi
      [ "$cursor" != "0" ] || break
    done
    [ "$n" -eq 0 ] || log "reset_between_repeats: deleted $n jobdedup:* key(s) for connection $conn_id"
  done
  log "reset_between_repeats ok"
}

# ===========================================================================
# Post-guards - run AFTER the window, mark the run DISCARDED rather than
# aborting the campaign (#2841 table).
# ===========================================================================

# post_guard_attempts - attempts delta > 1 per job created in the window.
# Echoes "ok" or "DISCARDED <reason>".
post_guard_attempts() {
  local conn_ids="$1" window_start_iso="$2" n
  n="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\" IN ($conn_ids) AND \"createdAt\">='$window_start_iso' AND attempts>1")"
  if [ "${n:-0}" -gt 0 ]; then
    echo "DISCARDED post_guard_attempts: $n job(s) in the window show attempts>1"
  else
    echo "ok"
  fi
}

# post_guard_deferrals - SUM(deferredTotalMs) delta over the window must be
# 0 (#2841 "the attempts post-guard alone cannot see a penalty-free
# requeue" - requeueWithoutPenalty deliberately does not touch attempts).
post_guard_deferrals() {
  local conn_ids="$1" window_start_iso="$2" n
  n="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\" IN ($conn_ids) AND \"createdAt\">='$window_start_iso' AND \"deferredTotalMs\" IS NOT NULL AND \"deferredTotalMs\">0")"
  if [ "${n:-0}" -gt 0 ] || [ "$DRAIN_DEFERRED_SEEN" = 1 ]; then
    echo "DISCARDED post_guard_deferrals: $n job(s) carry deferredTotalMs>0 (or drain_wait observed a deferred row) inside the window"
  else
    echo "ok"
  fi
}

# post_guard_requeues - StuckJobRecoveryService's requeueStuckJobs sets
# status='queued', lockedAt=NULL, lockedBy=NULL while touching neither
# attempts nor deferredTotalMs (sync-job.repository.ts requeueStuckJobs) -
# invisible to both guards above. Detected by comparing a BEFORE snapshot
# (taken by window_start_snapshot below) against the current state: same
# attempts, was 'running' with a lockedAt, now has lockedAt IS NULL.
#
# window_start MUST be preceded by a call to snapshot_jobs_before for this
# post-guard to have anything to compare against.
# ---------------------------------------------------------------------------
snapshot_jobs_before() {
  local conn_ids="$1"
  pg_sql_write "DROP TABLE IF EXISTS _perf_sync_jobs_snapshot" >/dev/null
  pg_sql_write "CREATE TABLE _perf_sync_jobs_snapshot AS
    SELECT id, attempts, status, \"lockedAt\" FROM sync_jobs WHERE \"connectionId\" IN ($conn_ids)" >/dev/null
}

post_guard_requeues() {
  local conn_ids="$1" n
  n="$(pg_sql "SELECT COUNT(*) FROM _perf_sync_jobs_snapshot s
    JOIN sync_jobs j ON j.id = s.id
    WHERE s.status='running' AND s.\"lockedAt\" IS NOT NULL
      AND j.\"lockedAt\" IS NULL AND j.attempts = s.attempts" 2>/dev/null || printf 0)"
  if [ "${n:-0}" -gt 0 ]; then
    echo "DISCARDED post_guard_requeues: $n job(s) show StuckJobRecoveryService's requeue signature (was running+locked, now unlocked, attempts unchanged)"
  else
    echo "ok"
  fi
  pg_sql_write "DROP TABLE IF EXISTS _perf_sync_jobs_snapshot" >/dev/null
}

# post_guard_destination_creates - the only guard that can see
# OrderSyncService.dispatchToDestinations swallowing a per-destination
# failure via Promise.allSettled (order-sync.service.ts) - the job itself
# still reports outcome='ok'. Any order_records row created in the window
# whose syncStatus carries status:'failed', or that lacks syncedAt on the
# scenario's declared destination, discards the run. Field names match
# OrderSyncStatus (order-sync.types.ts): `destinationConnectionId`,
# `status`, `syncedAt` - NOT `connectionId`.
#
# destination_conn_id is the syncStatus[].destinationConnectionId to check
# for syncedAt; pass empty to skip the "lacks syncedAt" half (a scenario
# with no single destination, e.g. a read-path-only flow).
post_guard_destination_creates() {
  local window_start_iso="$1" destination_conn_id="${2:-}" failed missing
  failed="$(pg_sql "SELECT COUNT(*) FROM order_records
    WHERE \"createdAt\">='$window_start_iso'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(\"syncStatus\") e WHERE e->>'status'='failed')")"
  if [ -n "$destination_conn_id" ]; then
    missing="$(pg_sql "SELECT COUNT(*) FROM order_records
      WHERE \"createdAt\">='$window_start_iso'
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(\"syncStatus\") e
                        WHERE e->>'destinationConnectionId'='$destination_conn_id' AND e->>'syncedAt' IS NOT NULL)")"
  else
    missing=0
  fi
  if [ "${failed:-0}" -gt 0 ] || [ "${missing:-0}" -gt 0 ]; then
    echo "DISCARDED post_guard_destination_creates: $failed order(s) carry a failed syncStatus entry, $missing lack syncedAt on the declared destination"
  else
    echo "ok"
  fi
}

# post_guard_limiter_degraded - greps the worker log for the Redis
# rate-limiter's degraded-mode message (redis-rate-limiter.adapter.ts:563).
# At three replicas a degraded episode turns a configured 60/min into an
# effective ~180/min for its length, invalidating a throughput comparison.
#
# window_start_epoch/window_stop_epoch bound the `docker logs --since/--until`
# read so an episode from a PREVIOUS scenario cannot discard this one.
post_guard_limiter_degraded() {
  local window_start_epoch="$1" window_stop_epoch="$2" w n=0 hit
  for w in $WORKER_CONTAINERS; do
    hit="$(docker logs --since "@$window_start_epoch" --until "@$window_stop_epoch" "$w" 2>&1 \
      | grep -c -F 'falling back to per-process in-memory limiting' || true)"
    n=$((n + hit))
  done
  if [ "$n" -gt 0 ]; then
    echo "DISCARDED post_guard_limiter_degraded: $n degraded-mode log line(s) inside the window"
  else
    echo "ok"
  fi
}

# ---------------------------------------------------------------------------
# verdict - VALID / DISCARDED + reason, with a documented, machine-parseable
# schema (--resume parses it, #2845). One `key=value` per line, LF-terminated,
# no embedded `=` in a key, reason lines may repeat.
#
#   status=VALID|DISCARDED
#   generatedAt=<ISO8601>
#   reason=<free text>            (repeated 0+ times, DISCARDED only)
# ---------------------------------------------------------------------------
verdict_write() {
  local dir="$1" status="$2"; shift 2
  {
    printf 'status=%s\n' "$status"
    printf 'generatedAt=%s\n' "$(iso_now)"
    local r
    for r in "$@"; do printf 'reason=%s\n' "$r"; done
  } > "$dir/verdict.txt"
  log "verdict: $status ($dir/verdict.txt)"
}

# Echoes VALID or DISCARDED; reasons print to stdout on subsequent lines
# (caller can `verdict_read "$dir" | tail -n +2` for just the reasons).
verdict_read() {
  local dir="$1"
  [ -f "$dir/verdict.txt" ] || { echo "MISSING"; return 1; }
  awk -F= '$1=="status"{print $2}' "$dir/verdict.txt"
  awk -F= '$1=="reason"{ $1=""; print substr($0,2) }' "$dir/verdict.txt"
}

# run_post_guards <dir> <conn_ids_csv> <window_start_iso> <window_start_epoch> <window_stop_epoch> [destination_conn_id]
# Runs every post-guard and writes verdict.txt: VALID if every one answered
# "ok", DISCARDED with every non-"ok" reason otherwise.
run_post_guards() {
  local dir="$1" conn_ids="$2" ws_iso="$3" ws_epoch="$4" we_epoch="$5" dest="${6:-}"
  local results=() r
  results+=("$(post_guard_attempts "$conn_ids" "$ws_iso")")
  results+=("$(post_guard_deferrals "$conn_ids" "$ws_iso")")
  results+=("$(post_guard_requeues "$conn_ids")")
  results+=("$(post_guard_destination_creates "$ws_iso" "$dest")")
  results+=("$(post_guard_limiter_degraded "$ws_epoch" "$we_epoch")")

  local reasons=()
  for r in "${results[@]}"; do
    [ "$r" = "ok" ] || reasons+=("$r")
  done
  if [ "${#reasons[@]}" -eq 0 ]; then
    verdict_write "$dir" VALID
  else
    verdict_write "$dir" DISCARDED "${reasons[@]}"
  fi
}

# ---------------------------------------------------------------------------
# compute_agreement - |r2 - r3| / median, the arithmetic #2845's
# publish_if_agreed needs (this library owns the arithmetic; #2845 owns the
# policy of what threshold to refuse above and the fourth-repeat retry).
# Echoes the ratio as a decimal (bc-free - awk).
# ---------------------------------------------------------------------------
compute_agreement() {
  local r2="$1" r3="$2"
  awk -v a="$r2" -v b="$r3" 'BEGIN {
    med = (a+b)/2;
    if (med == 0) { print "0"; exit }
    d = a-b; if (d<0) d=-d;
    printf "%.6f\n", d/med
  }'
}
