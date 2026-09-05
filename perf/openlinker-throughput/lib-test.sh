#!/usr/bin/env bash
#
# Unit tests for lib.sh (#2841) - everything that can be exercised WITHOUT a
# live stand: guard argument handling, the verdict schema round-trip, the
# manifest assembly, the agreement-rule arithmetic, and --dry-run behavior.
#
# No bash test framework exists anywhere in this tree, so this follows the
# repo's own house style for a shell script: plain assertions, a running
# pass/fail tally, `set -euo pipefail`-safe. Run with `bash lib-test.sh`.
#
# How faking works: lib.sh's guards call `docker`, `pg_sql`, `pg_sql_write`,
# `ol_api` and `redis_cli` directly rather than through a mockable seam, so
# this file sources lib.sh once and then REDEFINES those functions - bash
# resolves a function call by its CURRENT definition at call time, so a
# guard written against `docker exec ...` calls this file's fake `docker`
# with zero changes to lib.sh itself. Real containers are never touched.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PASS=0
FAIL=0
FAILURES=()

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc: expected [$expected] got [$actual]")
  fi
}

assert_contains() {
  local desc="$1" haystack="$2" needle="$3"
  case "$haystack" in
    *"$needle"*) PASS=$((PASS + 1)) ;;
    *) FAIL=$((FAIL + 1)); FAILURES+=("$desc: expected haystack to contain [$needle], got [$haystack]") ;;
  esac
}

# Runs $2.. in a subshell and asserts it exits non-zero (die/exit 1). $1 is
# the test description. Subshell so a `die` (which calls `exit 1`) cannot
# kill this whole test run.
assert_dies() {
  local desc="$1"; shift
  if ( "$@" ) >/dev/null 2>&1; then
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc: expected to die/exit non-zero, but it succeeded")
  else
    PASS=$((PASS + 1))
  fi
}

assert_ok() {
  local desc="$1"; shift
  if ( "$@" ) >/dev/null 2>&1; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc: expected to succeed, but it exited non-zero")
  fi
}

# ---------------------------------------------------------------------------
# Source the library under test.
# ---------------------------------------------------------------------------
LIB_LOG_PREFIX="test"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh" >/dev/null

# Redirect the results root into a scratch directory so this test run never
# touches (or is confused by) a real campaign's results/.
RESULTS_ROOT="$(mktemp -d)"
trap 'rm -rf "$RESULTS_ROOT"' EXIT

# ---------------------------------------------------------------------------
# Fakes. Every one of these OVERRIDES a function lib.sh calls directly, so
# no test below reaches a real container, database or HTTP endpoint.
# ---------------------------------------------------------------------------
declare -A FAKE_PG
FAKE_PG_WRITE_CALLS=()
pg_sql() {
  local sql="$1"
  case "$sql" in
    *"SHOW max_connections"*) echo "${FAKE_PG[max_connections]:-100}" ;;
    *"SHOW shared_buffers"*) echo "128MB" ;;
    *"SHOW work_mem"*) echo "4MB" ;;
    *"SHOW shared_preload_libraries"*) echo "pg_stat_statements,auto_explain" ;;
    *"pg_extension"*) echo "pg_stat_statements,pg_trgm" ;;
    *"operational_settings"*) echo "${FAKE_PG[operational_settings]:-{\}}" ;;
    *"COUNT(*)"*) echo "${FAKE_PG[count]:-0}" ;;
    *"pg_database_size"*) echo "${FAKE_PG[db_size]:-123456}" ;;
    *"string_agg"*) echo "${FAKE_PG[agg]:-}" ;;
    *) echo "" ;;
  esac
}
pg_sql_write() {
  FAKE_PG_WRITE_CALLS+=("$1")
  return 0
}

# Keyed lookup tables a test populates before calling a guard, rather than
# magic container names baked into a case statement - `docker exec <c>
# printenv <VAR>` puts the container at $2, NOT last (that trap bit the
# first draft of this fake: `${*: -1}` on an `exec ... printenv VAR` call
# returns VAR, the true last argument, never the container in the middle).
declare -A FAKE_ENV        # key "container:VAR" -> value
declare -A FAKE_REVISION   # key "container" -> org.opencontainers.image.revision label
declare -A FAKE_LOG        # key "container" -> full canned log text

docker() {
  case "$1" in
    exec)
      local container="$2" cmd="$3"
      case "$cmd" in
        printenv) echo "${FAKE_ENV["$container:$4"]:-}" ;;
        node) echo "v22.99.0" ;;
        *) echo "" ;;
      esac
      ;;
    inspect)
      local last="${@: -1}"
      case "$*" in
        *'index .Config.Labels "org.opencontainers.image.revision"'*)
          # Unset means "container never registered in FAKE_REVISION", the
          # empty-string case (`guard_build` must die on absence, never
          # silently pass); ${FAKE_REVISION[$last]-x} distinguishes "key
          # absent" (default: matches HEAD) from "key set to empty".
          if [ -z "${FAKE_REVISION[$last]+set}" ]; then echo "$FAKE_HEAD_SHA"; else echo "${FAKE_REVISION[$last]}"; fi ;;
        *'{{.Image}}'*) echo "sha256:0000fakeimage0000" ;;
        *'{{.HostConfig.NanoCpus}}'*) echo "0" ;;
        *'{{.HostConfig.Memory}}'*) echo "0" ;;
        *) echo "" ;;
      esac
      ;;
    logs)
      local last="${@: -1}"
      echo "${FAKE_LOG["$last"]:-}"
      ;;
    stats) : ;; # no lines - jq -cs '.' on empty input yields []
    *) : ;;
  esac
}

git() {
  # guard_build's ONLY real-git call is `git -C <dir> rev-parse HEAD` - fake
  # it so the test's expectation of "the working tree's head" is a fixed,
  # known value rather than whatever this checkout's actual HEAD happens to be.
  echo "$FAKE_HEAD_SHA"
}

FAKE_HEAD_SHA="cafef00dcafef00dcafef00dcafef00dcafef00"

# ===========================================================================
# guard argument handling
# ===========================================================================
echo "--- guard_perf_max_attempts ---"
PERF_MAX_ATTEMPTS=3 assert_ok "cap=3 (valid, below the entity default of 10)" guard_perf_max_attempts
PERF_MAX_ATTEMPTS=0 assert_dies "cap=0 (non-positive) must die" guard_perf_max_attempts
PERF_MAX_ATTEMPTS=-1 assert_dies "cap=-1 (negative) must die" guard_perf_max_attempts
PERF_MAX_ATTEMPTS=abc assert_dies "cap=abc (non-numeric) must die" guard_perf_max_attempts
PERF_MAX_ATTEMPTS=10 assert_dies "cap=10 (== entity default, not a cap) must die" guard_perf_max_attempts
PERF_MAX_ATTEMPTS=15 assert_dies "cap=15 (above entity default) must die" guard_perf_max_attempts

echo "--- guard_queue_empty ---"
FAKE_PG[count]=0
assert_ok "empty queue passes" guard_queue_empty "'conn-1'"
FAKE_PG[count]=3
assert_dies "non-empty queue dies" guard_queue_empty "'conn-1'"
assert_dies "no connection ids given dies" guard_queue_empty ""
FAKE_PG[count]=0

echo "--- guard_demo_mode_off ---"
OL_API_CONTAINER="demo-container"
FAKE_ENV["demo-container:OL_DEMO_MODE"]="false"
assert_ok "demo mode off passes" guard_demo_mode_off
FAKE_ENV["demo-container:OL_DEMO_MODE"]="true"
assert_dies "demo mode on dies" guard_demo_mode_off
OL_API_CONTAINER="lab-api"

echo "--- guard_scheduler_off ---"
WORKER_CONTAINERS="worker-sched-off"
FAKE_ENV["worker-sched-off:OL_SCHEDULER_ENABLED"]="false"
assert_ok "scheduler off on every worker passes" guard_scheduler_off
WORKER_CONTAINERS="worker-sched-on"
FAKE_ENV["worker-sched-on:OL_SCHEDULER_ENABLED"]="true"
assert_dies "scheduler on on any worker dies" guard_scheduler_off
WORKER_CONTAINERS="lab-worker"

echo "--- guard_connection_budget ---"
FAKE_PG[max_connections]=100
OL_API_CONTAINER="pool-container"
FAKE_ENV["pool-container:OL_DB_POOL_MAX"]=40
WORKER_CONTAINERS="w1 w2 w3"
# 40 * (1 api + 3 workers) = 160 >= 100 -> must die (the #2854 "too many
# clients already" scenario the guard exists to catch).
assert_dies "40 x 4 processes >= max_connections(100) dies" guard_connection_budget
FAKE_ENV["pool-container:OL_DB_POOL_MAX"]=10
# 10 * 4 = 40 < 100 -> passes, and both numbers must be recorded.
guard_connection_budget
assert_eq "budget recorded" "40" "$MANIFEST_DB_CONNECTION_BUDGET"
assert_eq "max_connections recorded" "100" "$MANIFEST_MAX_CONNECTIONS"
assert_eq "pool max recorded" "10" "$MANIFEST_OL_DB_POOL_MAX"
assert_ok "guard_pool_recorded passes once the budget guard populated the globals" guard_pool_recorded
unset MANIFEST_OL_DB_POOL_MAX MANIFEST_MAX_CONNECTIONS
assert_dies "guard_pool_recorded dies if called before guard_connection_budget" guard_pool_recorded
WORKER_CONTAINERS="lab-worker"
OL_API_CONTAINER="lab-api"

echo "--- guard_build ---"
FAKE_REVISION["up-to-date-container"]="$FAKE_HEAD_SHA"
FAKE_REVISION["stale-container"]="0000000000000000000000000000000000dead"
FAKE_REVISION["no-label-container"]=""
OL_API_CONTAINER="up-to-date-container"; WORKER_CONTAINERS="up-to-date-container"
assert_ok "image label matches HEAD passes" guard_build
OL_API_CONTAINER="stale-container"; WORKER_CONTAINERS="up-to-date-container"
assert_dies "image label mismatching HEAD dies" guard_build
OL_API_CONTAINER="no-label-container"; WORKER_CONTAINERS="up-to-date-container"
assert_dies "absent label dies (never treated as 'unknown, skip')" guard_build
OL_API_CONTAINER="lab-api"; WORKER_CONTAINERS="lab-worker"

echo "--- guard_runner_state ---"
FAKE_ENV["worker-runner-off:WORKER_RUNNER_ENABLED"]="false"
WORKER_CONTAINERS="worker-runner-off"
assert_dies "expected enabled but WORKER_RUNNER_ENABLED=false dies" guard_runner_state enabled
assert_ok "expected disabled and WORKER_RUNNER_ENABLED=false passes" guard_runner_state disabled
FAKE_ENV["runner-ok-container:WORKER_RUNNER_ENABLED"]="true"
FAKE_LOG["runner-ok-container"]="Starting sync job runner loop (worker: w1, poll interval: 1000ms, lane caps: realtime=4/2 bulk=12/8 fiscal=2/1 fan-out=8/4)"
WORKER_CONTAINERS="runner-ok-container"
guard_runner_state enabled
assert_eq "lane caps parsed off the startup line" "realtime=4/2 bulk=12/8 fiscal=2/1 fan-out=8/4" "$MANIFEST_LANE_CAPS"
FAKE_ENV["runner-nocaps-container:WORKER_RUNNER_ENABLED"]="true"
FAKE_LOG["runner-nocaps-container"]="worker booted, nothing about a runner loop here"
WORKER_CONTAINERS="runner-nocaps-container"
assert_dies "absent lane-caps line is a failure, never 'nothing to record'" guard_runner_state enabled
WORKER_CONTAINERS="lab-worker"

echo "--- guard_log_level ---"
FAKE_ENV["ok-container:OL_LOG_BODY_MAX_BYTES"]="4096"
OL_API_CONTAINER="ok-container"; WORKER_CONTAINERS="ok-container"
assert_ok "positive OL_LOG_BODY_MAX_BYTES passes" guard_log_level
FAKE_ENV["bad-log-container:OL_LOG_BODY_MAX_BYTES"]=""
OL_API_CONTAINER="bad-log-container"; WORKER_CONTAINERS="ok-container"
assert_dies "unset OL_LOG_BODY_MAX_BYTES dies" guard_log_level
FAKE_ENV["zero-log-container:OL_LOG_BODY_MAX_BYTES"]="0"
OL_API_CONTAINER="zero-log-container"; WORKER_CONTAINERS="ok-container"
assert_dies "OL_LOG_BODY_MAX_BYTES=0 dies (uncapped, not 'no cap wanted')" guard_log_level
OL_API_CONTAINER="lab-api"; WORKER_CONTAINERS="lab-worker"

# ===========================================================================
# post-guards
# ===========================================================================
echo "--- post_guard_attempts / post_guard_deferrals / post_guard_requeues ---"
FAKE_PG[count]=0
assert_eq "post_guard_attempts ok when nothing shows attempts>1" "ok" "$(post_guard_attempts "'c1'" '2026-01-01T00:00:00Z')"
FAKE_PG[count]=2
assert_contains "post_guard_attempts DISCARDED when something does" "$(post_guard_attempts "'c1'" '2026-01-01T00:00:00Z')" "DISCARDED"
FAKE_PG[count]=0
assert_eq "post_guard_deferrals ok when nothing deferred" "ok" "$(post_guard_deferrals "'c1'" '2026-01-01T00:00:00Z')"
DRAIN_DEFERRED_SEEN=1
assert_contains "post_guard_deferrals DISCARDED when drain_wait saw a deferral" "$(post_guard_deferrals "'c1'" '2026-01-01T00:00:00Z')" "DISCARDED"
DRAIN_DEFERRED_SEEN=0

echo "--- post_guard_destination_creates ---"
FAKE_PG[count]=0
assert_eq "ok when nothing failed and nothing missing syncedAt" "ok" "$(post_guard_destination_creates '2026-01-01T00:00:00Z' '')"
FAKE_PG[count]=1
assert_contains "DISCARDED when a failed syncStatus entry exists" "$(post_guard_destination_creates '2026-01-01T00:00:00Z' '')" "DISCARDED"
FAKE_PG[count]=0

echo "--- post_guard_limiter_degraded ---"
FAKE_LOG["degraded-container"]="Redis rate limiter unavailable for connection abc — falling back to per-process in-memory limiting (degraded, not unthrottled). timeout"
WORKER_CONTAINERS="degraded-container"
assert_contains "DISCARDED when the degraded-mode message is in the log" "$(post_guard_limiter_degraded 0 9999999999)" "DISCARDED"
WORKER_CONTAINERS="lab-worker"
assert_eq "ok when the log carries no degraded-mode message" "ok" "$(post_guard_limiter_degraded 0 9999999999)"

# ===========================================================================
# verdict schema round-trip
# ===========================================================================
echo "--- verdict schema round-trip ---"
VDIR="$(mktemp -d)"
verdict_write "$VDIR" VALID
assert_eq "VALID round-trips as the first line" "VALID" "$(verdict_read "$VDIR" | head -1)"
assert_eq "VALID carries no reason lines" "" "$(verdict_read "$VDIR" | tail -n +2)"

verdict_write "$VDIR" DISCARDED "reason one" "reason two"
assert_eq "DISCARDED round-trips as the first line" "DISCARDED" "$(verdict_read "$VDIR" | head -1)"
assert_eq "both reasons round-trip, in order" "$(printf 'reason one\nreason two')" "$(verdict_read "$VDIR" | tail -n +2)"
assert_contains "verdict.txt carries a generatedAt line" "$(cat "$VDIR/verdict.txt")" "generatedAt="
rm -rf "$VDIR"

VDIR2="$(mktemp -d)"
assert_dies "verdict_read on a directory with no verdict.txt reports MISSING and fails" verdict_read "$VDIR2"
rm -rf "$VDIR2"

# run_post_guards end-to-end wiring: every post-guard "ok" -> VALID
echo "--- run_post_guards wiring ---"
FAKE_PG[count]=0
DRAIN_DEFERRED_SEEN=0
WORKER_CONTAINERS="lab-worker"
RPGDIR="$(mktemp -d)"
run_post_guards "$RPGDIR" "'c1'" '2026-01-01T00:00:00Z' 0 9999999999 ''
assert_eq "every post-guard ok -> VALID" "VALID" "$(verdict_read "$RPGDIR" | head -1)"
rm -rf "$RPGDIR"

FAKE_PG[count]=1
RPGDIR2="$(mktemp -d)"
run_post_guards "$RPGDIR2" "'c1'" '2026-01-01T00:00:00Z' 0 9999999999 ''
assert_eq "any post-guard failing -> DISCARDED" "DISCARDED" "$(verdict_read "$RPGDIR2" | head -1)"
rm -rf "$RPGDIR2"
FAKE_PG[count]=0

# ===========================================================================
# manifest assembly
# ===========================================================================
echo "--- manifest_write ---"
FAKE_PG[max_connections]=100
MANIFEST_GIT_SHA="$FAKE_HEAD_SHA"
MANIFEST_RUNNER_STATE="enabled"
MANIFEST_LANE_CAPS="realtime=4/2 bulk=12/8 fiscal=2/1 fan-out=8/4"
MANIFEST_MAX_CONNECTIONS=100
MANIFEST_OL_DB_POOL_MAX=40
MANIFEST_DB_PROCESS_COUNT=4
MANIFEST_DB_CONNECTION_BUDGET=160
OL_API_CONTAINER="lab-api"; WORKER_CONTAINERS="lab-worker"
MDIR="$(mktemp -d)"
manifest_write "$MDIR" "test-scenario" "conn-1,conn-2" 1 '{"foo":"bar"}'
assert_eq "manifest.json exists" "1" "$([ -f "$MDIR/manifest.json" ] && echo 1 || echo 0)"
assert_eq "scenario name recorded" "test-scenario" "$(jq -r .scenario "$MDIR/manifest.json")"
assert_eq "quick flag recorded as JSON true" "true" "$(jq -r .quick "$MDIR/manifest.json")"
assert_eq "gitSha recorded" "$FAKE_HEAD_SHA" "$(jq -r .gitSha "$MDIR/manifest.json")"
assert_eq "pool.budget recorded" "160" "$(jq -r .pool.budget "$MDIR/manifest.json")"
assert_eq "extra_json is merged in" "bar" "$(jq -r .foo "$MDIR/manifest.json")"
assert_eq "excludedPgStatStatementsQueries is a non-empty array" "true" "$(jq '.excludedPgStatStatementsQueries | length > 0' "$MDIR/manifest.json")"
assert_eq "syncJobsRowsAtEnd starts null" "null" "$(jq -r .syncJobsRowsAtEnd "$MDIR/manifest.json")"
FAKE_PG[count]=42
manifest_set_sync_jobs_end "$MDIR"
assert_eq "syncJobsRowsAtEnd is set after window_stop" "42" "$(jq -r .syncJobsRowsAtEnd "$MDIR/manifest.json")"
FAKE_PG[count]=0
rm -rf "$MDIR"

# ===========================================================================
# agreement-rule arithmetic
# ===========================================================================
echo "--- compute_agreement ---"
assert_eq "identical values agree exactly (ratio 0)" "0.000000" "$(compute_agreement 100 100)"
assert_eq "10 vs 12: |10-12|/11 = 0.181818" "0.181818" "$(compute_agreement 10 12)"
assert_eq "a deliberately deduped n=0 pair (0 vs 0) reports ratio 0 - the ZERO agreement trap #2845's publish_if_agreed must refuse on its own (a minimum-n check), never here" "0" "$(compute_agreement 0 0)"

# ===========================================================================
# results_dir_init / --dry-run (would()) behavior
# ===========================================================================
echo "--- results_dir_init ---"
D1="$(results_dir_init test-scenario run1)"
assert_eq "results_dir_init creates the directory" "1" "$([ -d "$D1" ] && echo 1 || echo 0)"
assert_contains "results_dir_init nests under scenario/label" "$D1" "test-scenario/run1"

echo "--- bootstrap.sh --dry-run / --verify-only / --help argument parsing ---"
# bootstrap.sh guards `main` behind `[ "${BASH_SOURCE[0]}" = "${0}" ]`
# specifically so this can source it (getting `would()`, arg parsing) without
# running a single docker command against a real stand.
(
  set -euo pipefail
  cd "$SCRIPT_DIR"
  # shellcheck disable=SC1091
  source ./bootstrap.sh --dry-run
  [ "$DRY_RUN" = 1 ] || { echo "DRY_RUN not set by --dry-run" >&2; exit 1; }
  would "some destructive action" || { echo "would() should return 0 under --dry-run" >&2; exit 1; }
)
assert_eq "sourcing with --dry-run sets DRY_RUN=1 and would() returns 0" "0" "$?"

(
  set -euo pipefail
  cd "$SCRIPT_DIR"
  # shellcheck disable=SC1091
  source ./bootstrap.sh
  [ "$DRY_RUN" = 0 ] || exit 1
  would "some destructive action" && exit 1
  exit 0
)
assert_eq "sourcing with no args leaves DRY_RUN=0 and would() returns 1" "0" "$?"

(
  set -euo pipefail
  cd "$SCRIPT_DIR"
  # shellcheck disable=SC1091
  source ./bootstrap.sh --verify-only
  [ "$VERIFY_ONLY" = 1 ] || exit 1
)
assert_eq "sourcing with --verify-only sets VERIFY_ONLY=1" "0" "$?"

assert_dies "an unrecognised argument is rejected rather than silently ignored" \
  bash -c "cd '$SCRIPT_DIR' && source ./bootstrap.sh --bogus-flag-that-does-not-exist"

# ---------------------------------------------------------------------------
echo
echo "=== $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  printf 'FAILURES:\n'
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
exit 0
