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

# Worker-replica discovery (#2851) is latched OFF for the guard tests below.
# Those tests set WORKER_CONTAINERS directly to names that suit each case
# ("worker-sched-off", "w1 w2", ...), and `_ensure_worker_containers` would
# otherwise verify each of them against `docker inspect` on its first call and
# refuse. Discovery itself is tested separately, in its own section, which
# un-latches this in a subshell so the flag can never leak between tests.
WORKER_CONTAINERS_RESOLVED=1

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
    *"pg_db_role_setting"*) echo "${FAKE_PG[pg_overrides]:-}" ;;
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

# What `docker ps --filter label=com.docker.compose.service=worker` answers
# (#2851's worker-replica discovery). Newline-separated, deliberately NOT
# pre-sorted - discover_worker_containers' own `sort` is part of what is under
# test, since a manifest diff between two runs is only meaningful if the
# container list reads the same way every time.
FAKE_WORKER_PS="lab-worker-2
lab-worker-1
lab-worker-3"
# Which container names `docker inspect` will admit to knowing. Discovery
# VERIFIES an explicitly-exported WORKER_CONTAINERS against this, which is the
# whole point of the check (`WORKER_CONTAINERS=lab-worker` was the documented
# export until the rename).
FAKE_EXISTING_CONTAINERS="lab-worker-1 lab-worker-2 lab-worker-3 lab-api"

docker() {
  case "$1" in
    ps) printf '%s\n' "$FAKE_WORKER_PS" ;;
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
        *'{{.Id}}'*)
          # _ensure_worker_containers' existence probe. Answering for every
          # name would make the "explicit but stale" test unreachable.
          case " $FAKE_EXISTING_CONTAINERS " in
            *" $last "*) echo "fake-container-id-$last" ;;
            *) return 1 ;;
          esac ;;
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

# guard_build makes four kinds of real-git call now, so the fake dispatches on
# the subcommand rather than answering everything with one string. An
# always-answer fake made the guard's own dirty-tree check see the sha as
# "uncommitted output" and die - a fake too blunt for the code it stands in
# for is a test that fails for a reason the code does not have.
FAKE_HEAD_SHA="cafef00dcafef00dcafef00dcafef00dcafef00"
FAKE_DIRTY=""                 # `git status --porcelain -- <paths>` output
declare -A FAKE_TREE          # "<sha>:<path>" -> tree hash
FAKE_KNOWN_COMMITS="$FAKE_HEAD_SHA"

git() {
  # Strip the leading `-C <dir>` the library always passes.
  if [ "${1:-}" = "-C" ]; then shift 2; fi
  case "${1:-}" in
    rev-parse)
      case "${2:-}" in
        HEAD) echo "$FAKE_HEAD_SHA" ;;
        *:*)
          local key="${2}"
          # Default: a path resolves identically at HEAD and at any known
          # commit, i.e. "the product code did not change".
          echo "${FAKE_TREE[$key]-tree-of-${key#*:}}" ;;
        *) echo "$FAKE_HEAD_SHA" ;;
      esac ;;
    status) printf '%s' "$FAKE_DIRTY" ;;
    cat-file)
      # `cat-file -e <sha>^{commit}` - exit 0 iff the commit is "in the repo".
      local want="${3:-}"; want="${want%%^*}"
      case " $FAKE_KNOWN_COMMITS " in *" $want "*) return 0 ;; *) return 1 ;; esac ;;
    *) echo "$FAKE_HEAD_SHA" ;;
  esac
}

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

echo "--- guard_build tree comparison ---"
OL_API_CONTAINER="lab-api"; WORKER_CONTAINERS="lab-worker"
FAKE_REVISION=(); FAKE_DIRTY=""

# The case this change exists for: the image was built from an EARLIER commit
# whose product paths are byte-identical, because the commits since touched
# only the harness. Under the old sha comparison this was refused and forced a
# full rebuild for no behavioural difference.
harness_only_commit="beefbeefbeefbeefbeefbeefbeefbeefbeefbeef"
FAKE_KNOWN_COMMITS="$FAKE_HEAD_SHA $harness_only_commit"
FAKE_REVISION[lab-api]="$harness_only_commit"
FAKE_REVISION[lab-worker]="$harness_only_commit"
# Called directly rather than through assert_ok, which runs its argument in a
# subshell - the MANIFEST_* assignment would be discarded there and the second
# assertion would read an unset variable rather than the guard's output.
MANIFEST_GIT_SHA=""
guard_build >/dev/null 2>&1
build_status=$?
assert_eq "accepts an image whose product paths match, on an earlier commit" "0" "$build_status"
assert_eq "manifest records the IMAGE's sha, not HEAD" "$harness_only_commit" "$MANIFEST_GIT_SHA"

# ...and it must still refuse when the product code genuinely differs.
FAKE_TREE["$harness_only_commit:libs"]="a-different-libs-tree"
assert_dies "refuses an image whose libs tree differs" guard_build
unset 'FAKE_TREE[$harness_only_commit:libs]'

# An image built somewhere else cannot be verified against this tree at all,
# and must not be waved through just because its label is non-empty.
FAKE_REVISION[lab-api]="0123456789012345678901234567890123456789"
assert_dies "refuses an image whose commit is not in this repository" guard_build
FAKE_REVISION[lab-api]="$harness_only_commit"

# Uncommitted product-code changes cannot be in any image, whatever the label
# says. The pre-change guard missed this entirely.
FAKE_DIRTY=" M libs/core/src/something.ts"
assert_dies "refuses uncommitted changes under the product paths" guard_build
FAKE_DIRTY=""

FAKE_REVISION=(); FAKE_KNOWN_COMMITS="$FAKE_HEAD_SHA"

echo "--- guard_stand_exclusive ---"
# A fake Redis with just enough SET NX / GET / DEL to exercise the claim. The
# guard must never read-then-decide, so the fake makes SET NX the only thing
# that can grant the lock.
#
# State lives in a FILE, not a variable: `guard_stand_exclusive` calls
# `redis_cli SET ...` inside a command substitution, which bash runs in a
# subshell, so a variable the fake assigned there would be discarded the
# instant the substitution closed - the claim would appear to succeed while
# leaving no lock behind, and the refusal test would then pass vacuously.
FAKE_REDIS_FILE="$(mktemp)"
fake_redis_get() { cat "$FAKE_REDIS_FILE" 2>/dev/null || printf ''; }
fake_redis_set() { printf '%s' "$1" > "$FAKE_REDIS_FILE"; }
redis_cli() {
  case "$1" in
    SET)
      # SET <key> <value> NX EX <ttl>
      if [ -n "$(fake_redis_get)" ]; then printf ''; else fake_redis_set "$3"; printf 'OK'; fi ;;
    GET) fake_redis_get ;;
    DEL) fake_redis_set ""; printf '1' ;;
    *) printf '' ;;
  esac
}

fake_redis_set ""
STAND_LOCK_HELD=0
# Called directly, NOT through assert_ok: that helper runs its argument in a
# subshell so a `die` cannot kill the suite, which also means the function's
# writes to STAND_LOCK_HELD and the fake Redis would be discarded. The claim
# has to happen in this shell for the refusal test below to have a lock to
# collide with.
guard_stand_exclusive f3-webhook-burst >/dev/null 2>&1
claim_status=$?
trap - EXIT   # the guard registers its own EXIT trap; the suite owns its exit
assert_eq "claims a free stand" "0" "$claim_status"
assert_eq "records that it holds the lock" "1" "$STAND_LOCK_HELD"
assert_contains "lock value names the scenario" "$(fake_redis_get)" "f3-webhook-burst"

# The whole point: a second scenario must be refused, not queued and not
# allowed through with a warning. This is the case that silently invalidated
# two real measurement arms before the guard existed.
assert_dies "refuses a stand another scenario already holds" guard_stand_exclusive f2-stock-propagation

# Releasing must be owner-scoped. A scenario whose lock expired must not
# delete the key a different, legitimately-running scenario has since taken -
# that would hand the stand to two holders at once, which is the exact failure
# the lock exists to prevent.
fake_redis_set "someone-else:pid999999@other-host:2026-09-06T00:00:00Z"
STAND_LOCK_HELD=1
release_stand_exclusive >/dev/null 2>&1
assert_eq "does not delete a lock held by another process" \
  "someone-else:pid999999@other-host:2026-09-06T00:00:00Z" "$(fake_redis_get)"

# And a release with nothing held is a no-op rather than an error, so the EXIT
# trap is safe on every abort path.
fake_redis_set ""
STAND_LOCK_HELD=0
assert_ok "release with no lock held is a no-op" release_stand_exclusive

fake_redis_set ""
STAND_LOCK_HELD=0

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

# A guard that CHECKS a value and does not RECORD it lets the manifest print
# "unknown" for something the run verified - which is the reported-versus-
# enforced gap the whole harness exists to close, one level in. The three
# assertions above all passed while that was true (found on the first real F3
# run, #2842), so the shape is asserted here rather than left to the next
# reader to notice.
FAKE_ENV["ok-container:OL_LOG_BODY_MAX_BYTES"]="4096"
FAKE_ENV["second-container:OL_LOG_BODY_MAX_BYTES"]="8192"
OL_API_CONTAINER="ok-container"; WORKER_CONTAINERS="second-container"
MANIFEST_LOG_BODY_MAX_BYTES=""
guard_log_level >/dev/null 2>&1
assert_eq "guard_log_level records what it verified" \
  "ok-container=4096 second-container=8192" "$MANIFEST_LOG_BODY_MAX_BYTES"

OL_API_CONTAINER="lab-api"; WORKER_CONTAINERS="lab-worker"

echo "--- post_guard_generator_saturated ---"
# Writes a k6-shaped summary to $1 with the metrics given, so each case differs
# in exactly the field it is about.
write_k6_summary() {
  local out="$1" used="$2" cfg="$3" dropped="$4" reqs="$5" extra=""
  [ "$dropped" = "none" ] || extra=",\"dropped_iterations\":{\"count\":$dropped}"
  cat > "$out" <<JSON
{"metrics":{"vus":{"max":$used},"vus_max":{"max":$cfg},
 "http_reqs":{"count":$reqs}$extra}}
JSON
}

sat_dir="$(mktemp -d)"

write_k6_summary "$sat_dir/healthy.json" 12 300 0 10000
assert_eq "a generator with headroom passes" "ok" \
  "$(post_guard_generator_saturated "$sat_dir/healthy.json")"

# The case this guard exists for: F3's ~600/s runs sat at 92-97% of their VU
# ceiling and their numbers were nearly published as a system ceiling.
write_k6_summary "$sat_dir/vu-bound.json" 132 137 0 18100
assert_contains "a generator at 96% of its VU ceiling is discarded" \
  "$(post_guard_generator_saturated "$sat_dir/vu-bound.json")" "DISCARDED"
assert_contains "the refusal names the remedy, not just the fault" \
  "$(post_guard_generator_saturated "$sat_dir/vu-bound.json")" "MAX_VUS"

write_k6_summary "$sat_dir/dropped.json" 20 300 4400 18100
assert_contains "a high dropped-iteration fraction is discarded" \
  "$(post_guard_generator_saturated "$sat_dir/dropped.json")" "DISCARDED"

# constant-vus has no arrival rate to fall behind, so k6 emits no
# dropped_iterations at all. Absent must mean NOT APPLICABLE - reading it as
# zero would silently pass the check it belongs to.
write_k6_summary "$sat_dir/no-drop-metric.json" 20 300 none 18100
assert_eq "an absent dropped_iterations metric is not applicable, not zero" "ok" \
  "$(post_guard_generator_saturated "$sat_dir/no-drop-metric.json")"

# A scenario with no load generator at all (F2) is not applicable...
assert_eq "no summary path means no generator, which passes" "ok" \
  "$(post_guard_generator_saturated "")"
# ...but one that CLAIMED a generator and produced nothing is the OOM shape.
# Asserted on the SPECIFIC message, not merely on the word DISCARDED: without
# the missing-file branch the function falls through to jq, which fails on a
# nonexistent path and hits the could-not-parse fallback - which also says
# DISCARDED. A weaker assertion passed against the broken code (found red-first).
assert_contains "a claimed-but-missing summary is discarded, never skipped" \
  "$(post_guard_generator_saturated "$sat_dir/never-written.json")" "wrote no summary at"

# A summary that cannot show its instrument was healthy is not reportable.
printf '{"metrics":{"http_reqs":{"count":100}}}\n' > "$sat_dir/no-vus.json"
assert_contains "a summary carrying no vus/vus_max is discarded" \
  "$(post_guard_generator_saturated "$sat_dir/no-vus.json")" "DISCARDED"

# #2930 - constant-vus holds a FIXED pool, so vus.max == vus_max.max by
# design (the executor never grows the pool to chase a rate). The default
# (ramping-arrival-rate) reading of that as "used its whole ceiling" would
# discard every single constant-vus run - the executor param exists so the
# guard can tell "fully in use because that's the deliberate configuration"
# apart from "fully in use because the generator ran out of headroom".
write_k6_summary "$sat_dir/constant-vus-full.json" 32 32 none 5000
assert_eq "constant-vus at vus==vus_max is NOT discarded" "ok" \
  "$(post_guard_generator_saturated "$sat_dir/constant-vus-full.json" constant-vus)"
# Same summary, no executor hint (i.e. the default) - still discarded, so
# the new arm is additive and does not weaken the existing ramping-arrival-rate
# check for any caller that omits the hint.
assert_contains "the same summary WITHOUT the hint still discards (default unchanged)" \
  "$(post_guard_generator_saturated "$sat_dir/constant-vus-full.json")" "DISCARDED"

rm -rf "$sat_dir"

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

echo "--- reset_between_repeats SCAN loop (#2847) ---"
# This function shipped with NO CALLER in any scenario, so its SCAN loop had
# never executed. It used `redis-cli --no-raw`, whose reply renders as
# `1) "8192"` - `head -1` then fed `1) "8192"` back as the cursor, Redis
# answered `ERR invalid cursor`, that string is never `0`, and the loop spun
# for ever. Observed live before the fix: a scenario stuck at 0% with a
# `SCAN (error) ERR invalid cursor` child process.
#
# Both directions are asserted: a well-behaved raw reply terminates, and a
# malformed cursor DIES rather than looping. The second is the one that
# matters - the original failure was survivable only because it was silent.
RESET_SCAN_CALLS_FILE="$(mktemp)"
RESET_SCAN_MODE=raw
# Only `redis_cli` is faked here. `pg_sql_write`'s own fake RECORDS the SQL it
# was handed and a later cap_perf_job_attempts test asserts against those
# recordings - replacing it with a no-op made three unrelated assertions fail
# with an empty haystack.
redis_cli() {
  case "$1" in
    SCAN)
      printf '1\n' >> "$RESET_SCAN_CALLS_FILE"
      if [ "$RESET_SCAN_MODE" = "noraw" ]; then
        # Exactly what `--no-raw` produced, which is what caused the hang.
        printf '1) "8192"\n2) 1) "jobdedup:x:conn-1:y"\n'
      else
        # Raw: bare cursor on line 1, one key per line after. Terminates on
        # the second call by answering cursor 0.
        if [ "$(wc -l < "$RESET_SCAN_CALLS_FILE")" -lt 2 ]; then
          printf '8192\njobdedup:a:conn-1:1\njobdedup:a:conn-1:2\n'
        else
          printf '0\njobdedup:a:conn-1:3\n'
        fi
      fi ;;
    DEL) printf '1' ;;
    *) printf '' ;;
  esac
}
assert_ok "a raw SCAN reply terminates the loop" \
  reset_between_repeats "'conn-1'" "'allegro.orders.lastEventId'"
assert_eq "and it issued exactly the two SCAN calls the fake scripted" "2" \
  "$(wc -l < "$RESET_SCAN_CALLS_FILE" | tr -d ' ')"

: > "$RESET_SCAN_CALLS_FILE"
RESET_SCAN_MODE=noraw
# Without the guard this call never returns, so a regression here hangs the
# test suite rather than failing it - which is itself the signal.
assert_dies "a non-numeric cursor dies instead of looping for ever" \
  reset_between_repeats "'conn-1'" "'allegro.orders.lastEventId'"
rm -f "$RESET_SCAN_CALLS_FILE"
# Restore the stand-lock fake the later guard tests rely on.
redis_cli() {
  case "$1" in
    SET) if [ -n "$(fake_redis_get)" ]; then printf ''; else fake_redis_set "$3"; printf 'OK'; fi ;;
    GET) fake_redis_get ;;
    DEL) fake_redis_set ""; printf '1' ;;
    *) printf '' ;;
  esac
}

echo "--- post_guard_feed_starved ---"
# The counterpart to post_guard_generator_saturated for a scenario whose load
# is a standing supply of work rather than an HTTP generator (#2847/F1).
# Both answer "was the instrument, not the system, the ceiling?" and both
# reach the same wrong conclusion when they cannot: an achieved rate reported
# as a ceiling when it is a floor on what the instrument offered.
#
# The input is AVAILABLE WORK - upstream supply PLUS the due queue - not an
# upstream backlog alone. A poll pump that drains its upstream into queued
# child jobs empties the upstream while the system is at its busiest, so a
# backlog-only reading would discard every valid run. See the guard's own
# docblock; these assertions are worded in those terms so a later edit cannot
# quietly narrow the input back.
assert_eq "no standing supply is not applicable, and passes" "ok" \
  "$(post_guard_feed_starved "")"
assert_eq "work that was always available passes" "ok" \
  "$(post_guard_feed_starved "137")"
assert_eq "exactly 1 unit of available work still passes - it never ran dry" "ok" \
  "$(post_guard_feed_starved "1")"
assert_contains "available work reaching zero is discarded" \
  "$(post_guard_feed_starved "0")" "DISCARDED"
# Asserted on the SPECIFIC wording, not merely on DISCARDED: the refusal has
# to say that the number is a floor on the OFFERED rate, or a reader takes the
# discarded run's figure at face value anyway - which is exactly what nearly
# happened to F3's ~600/s (#2933).
assert_contains "the zero refusal names what the number actually is" \
  "$(post_guard_feed_starved "0")" "floor on the OFFERED rate"
assert_contains "the zero refusal names the remedy" \
  "$(post_guard_feed_starved "0")" "deeper backlog"
# It must name BOTH halves of the sum, or the next reader repeats the mistake
# this guard's own first draft made and passes an upstream backlog alone.
assert_contains "the zero refusal names both halves of available work" \
  "$(post_guard_feed_starved "0")" "the due queue were BOTH empty"
# `unknown` must never be read as "fine". A run that cannot show its
# instrument kept offering load is not a run whose instrument behaved - the
# same rule the generator guard applies to a missing k6 summary.
assert_contains "unestablished available work is discarded, never skipped" \
  "$(post_guard_feed_starved "unknown")" "DISCARDED"
assert_contains "the unknown refusal says it could not be established" \
  "$(post_guard_feed_starved "unknown")" "could not be established"
# A malformed value must not fall through to the zero branch (which would give
# the right verdict for the wrong reason) nor to "ok" (which would be silent).
assert_contains "a non-numeric value is discarded as unreadable" \
  "$(post_guard_feed_starved "3 orders")" "unreadable available-work value"
assert_contains "a negative value is discarded as unreadable" \
  "$(post_guard_feed_starved "-1")" "unreadable available-work value"

echo "--- run_post_guards threads the feed guard through ---"
# The 9th positional argument is the one a scenario can silently forget, which
# is the failure mode the k6-summary argument already has a warning about in
# run_post_guards' own docblock. These two assertions pin both directions.
FAKE_PG[count]=0
RPG_DIR="$(mktemp -d)"
run_post_guards "$RPG_DIR" "'c1'" '2026-01-01T00:00:00Z' 0 9999999999 '' '' '' '' >/dev/null 2>&1 || true
assert_eq "omitting the feed argument leaves the verdict VALID (not applicable)" \
  "VALID" "$(verdict_read "$RPG_DIR" | head -1)"
run_post_guards "$RPG_DIR" "'c1'" '2026-01-01T00:00:00Z' 0 9999999999 '' '' '' '0' >/dev/null 2>&1 || true
assert_eq "a starved feed reaches the verdict as DISCARDED" \
  "DISCARDED" "$(verdict_read "$RPG_DIR" | head -1)"
assert_contains "and the verdict carries the feed guard's own reason" \
  "$(verdict_read "$RPG_DIR")" "post_guard_feed_starved"
rm -rf "$RPG_DIR"

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
# window_start would have captured this; these tests call run_post_guards
# directly, so they must establish the same baseline or
# post_guard_containers_stable correctly refuses to certify a window it has no
# "before" reading for.
capture_container_starts "$RPGDIR"
run_post_guards "$RPGDIR" "'c1'" '2026-01-01T00:00:00Z' 0 9999999999 ''
assert_eq "every post-guard ok -> VALID" "VALID" "$(verdict_read "$RPGDIR" | head -1)"
rm -rf "$RPGDIR"

FAKE_PG[count]=1
RPGDIR2="$(mktemp -d)"
capture_container_starts "$RPGDIR2"
run_post_guards "$RPGDIR2" "'c1'" '2026-01-01T00:00:00Z' 0 9999999999 ''
assert_eq "any post-guard failing -> DISCARDED" "DISCARDED" "$(verdict_read "$RPGDIR2" | head -1)"
rm -rf "$RPGDIR2"
FAKE_PG[count]=0

# #2930 - the optional 8th (executor) arg threads through to
# post_guard_generator_saturated: a fixed-pool-at-ceiling summary passed with
# the constant-vus hint must still resolve VALID, never DISCARDED.
RPGDIR3="$(mktemp -d)"
capture_container_starts "$RPGDIR3"
write_k6_summary "$RPGDIR3/k6-summary.json" 16 16 none 2000
run_post_guards "$RPGDIR3" "'c1'" '2026-01-01T00:00:00Z' 0 9999999999 '' "$RPGDIR3/k6-summary.json" constant-vus
assert_eq "run_post_guards threads the executor hint through to the generator guard" "VALID" \
  "$(verdict_read "$RPGDIR3" | head -1)"
rm -rf "$RPGDIR3"

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

echo "--- manifest_pg_non_default_settings (#2934) ---"
FAKE_PG[pg_overrides]='{"liveSettingsSourceNotDefault":{"statement_timeout":{"setting":"30000","source":"user"}},"roleConfig":{"postgres":["statement_timeout=30000ms"]},"databaseRoleConfig":[]}'
assert_eq "returns the live query's JSON verbatim" \
  "${FAKE_PG[pg_overrides]}" "$(manifest_pg_non_default_settings)"

MDIR2="$(mktemp -d)"
manifest_write "$MDIR2" "test-scenario" "conn-1" 1 '{}'
assert_eq "a role-level ALTER ROLE ... SET reaches the manifest" \
  '["statement_timeout=30000ms"]' "$(jq -c '.environment.postgres.nonDefaultSettings.roleConfig.postgres' "$MDIR2/manifest.json")"
assert_eq "a non-default live pg_settings row's source is recorded too - what a SHOW from a DIFFERENT role would miss is exactly why roleConfig exists alongside this" \
  "user" "$(jq -r '.environment.postgres.nonDefaultSettings.liveSettingsSourceNotDefault.statement_timeout.source' "$MDIR2/manifest.json")"
rm -rf "$MDIR2"

# A stand with no ALTER ROLE/DATABASE override and no non-default
# pg_settings row at all must still round-trip as an empty, VALID object -
# never as a blank string that would break the manifest's own JSON.
FAKE_PG[pg_overrides]=""
assert_eq "empty query result degrades to an empty JSON object, not a blank string" \
  "{}" "$(manifest_pg_non_default_settings)"

# A malformed/garbage answer (a psql error message slipping through the
# `2>/dev/null`, a truncated query) must not silently produce an invalid
# manifest.json - it degrades to a JSON object NAMING the failure, so the
# rest of the manifest (which the run genuinely needs) still writes. This is
# the "recording beats refusing" rule applied to the recorder's own failure
# mode: a broken read must be visible in the manifest, not swallowed into a
# manifest that merely looks complete.
FAKE_PG[pg_overrides]='ERROR: relation "pg_db_role_setting" does not exist'
MDIR3="$(mktemp -d)"
manifest_write "$MDIR3" "test-scenario" "conn-1" 1 '{}'
assert_eq "manifest.json is still valid JSON when the pg-overrides query answers garbage" \
  "1" "$(jq -e . "$MDIR3/manifest.json" >/dev/null 2>&1 && echo 1 || echo 0)"
assert_contains "the garbage is recorded as an error field, not silently dropped" \
  "$(jq -r '.environment.postgres.nonDefaultSettings.error' "$MDIR3/manifest.json")" "non-JSON"
rm -rf "$MDIR3"
FAKE_PG[pg_overrides]=""

echo "--- reassert_volatile_guards (#2932) ---"
# Neither volatile guard was ever declared by this "scenario" - a no-op,
# even though the live environment would fail either check outright. This is
# F5's own shape: read-only, never calls guard_runner_state at all, and
# reassert must not invent a posture for it.
GUARD_RUNNER_STATE_EXPECTED=""
GUARD_SCHEDULER_OFF_ACTIVE=0
WORKER_CONTAINERS="reassert-worker"
FAKE_ENV["reassert-worker:WORKER_RUNNER_ENABLED"]="true"
FAKE_ENV["reassert-worker:OL_SCHEDULER_ENABLED"]="true"
assert_ok "neither volatile guard declared -> reassert is a no-op" reassert_volatile_guards

# guard_runner_state disabled was declared and the runner is STILL disabled
# -> reassert re-verifies and passes silently.
FAKE_ENV["reassert-worker:WORKER_RUNNER_ENABLED"]="false"
guard_runner_state disabled
assert_ok "runner still disabled at the next window -> reassert passes" reassert_volatile_guards

# THE CASE #2932 IS ABOUT: a peer (or an operator, or a force-recreate)
# flips the runner BETWEEN windows. guard_runner_state disabled passed once,
# at pre-flight; the runner is enabled by the time a later window opens.
# reassert must catch this and abort - never record the stale "disabled" as
# though it still held.
FAKE_ENV["reassert-worker:WORKER_RUNNER_ENABLED"]="true"
assert_dies "runner flipped enabled after guard_runner_state disabled passed -> reassert dies" reassert_volatile_guards

# Same shape for the scheduler, independently of the runner.
GUARD_RUNNER_STATE_EXPECTED=""
FAKE_ENV["reassert-worker:WORKER_RUNNER_ENABLED"]="false"
guard_runner_state disabled
FAKE_ENV["reassert-worker:OL_SCHEDULER_ENABLED"]="false"
guard_scheduler_off
assert_ok "scheduler still off at the next window -> reassert passes" reassert_volatile_guards
FAKE_ENV["reassert-worker:OL_SCHEDULER_ENABLED"]="true"
assert_dies "scheduler flipped on after guard_scheduler_off passed -> reassert dies" reassert_volatile_guards

GUARD_RUNNER_STATE_EXPECTED=""
GUARD_SCHEDULER_OFF_ACTIVE=0
WORKER_CONTAINERS="lab-worker"

echo "--- window_start re-asserts before any side effect (#2932) ---"
# window_start must die on the identical flip, and must die BEFORE
# manifest_write/sampler_start ever run - proven by asserting no
# manifest.json was written on the aborted call (the AC's own wording: "a
# mid-run change aborts the run rather than being recorded as the
# start-of-script value").
WORKER_CONTAINERS="reassert-worker"
FAKE_ENV["reassert-worker:WORKER_RUNNER_ENABLED"]="false"
guard_runner_state disabled
FAKE_ENV["reassert-worker:WORKER_RUNNER_ENABLED"]="true"
WSDIR="$(mktemp -d)"
SETTLE_SECS=0
assert_dies "window_start dies when a volatile guard flips between windows" \
  window_start "$WSDIR" test-scenario "'conn-1'" 1 '{}'
assert_eq "no manifest.json was written on the aborted window_start" \
  "0" "$([ -f "$WSDIR/manifest.json" ] && echo 1 || echo 0)"
rm -rf "$WSDIR"
GUARD_RUNNER_STATE_EXPECTED=""
GUARD_SCHEDULER_OFF_ACTIVE=0
WORKER_CONTAINERS="lab-worker"

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

echo "--- worker-replica discovery (#2851) ---"

# `docker ps` answers out of order on purpose (see FAKE_WORKER_PS); the sort is
# what makes two runs' manifests comparable.
assert_eq "discover_worker_containers returns every replica, sorted" \
  "lab-worker-1 lab-worker-2 lab-worker-3" \
  "$(discover_worker_containers)"

# Each case runs in a subshell so WORKER_CONTAINERS_RESOLVED / WORKER_CONTAINERS
# cannot leak into the guard tests above (or into each other).
assert_eq "unset WORKER_CONTAINERS is filled in from discovery" \
  "lab-worker-1 lab-worker-2 lab-worker-3" \
  "$( ( WORKER_CONTAINERS=""; WORKER_CONTAINERS_RESOLVED=0
       _ensure_worker_containers >/dev/null 2>&1
       printf '%s' "$WORKER_CONTAINERS" ) )"

assert_eq "discovery records the replica count for the manifest" \
  "3" \
  "$( ( WORKER_CONTAINERS=""; WORKER_CONTAINERS_RESOLVED=0
       _ensure_worker_containers >/dev/null 2>&1
       printf '%s' "$MANIFEST_WORKER_REPLICAS" ) )"

# An explicit list is honoured rather than overwritten - a stand compose does
# not own still needs one.
assert_eq "an explicit, existing WORKER_CONTAINERS is left alone" \
  "lab-worker-2" \
  "$( ( WORKER_CONTAINERS="lab-worker-2"; WORKER_CONTAINERS_RESOLVED=0
       _ensure_worker_containers >/dev/null 2>&1
       printf '%s' "$WORKER_CONTAINERS" ) )"

# The case this check exists for: `WORKER_CONTAINERS=lab-worker` was the
# documented export until the worker lost its fixed container_name, so a stale
# one is the most likely way a scenario reaches this code.
assert_dies "an explicit WORKER_CONTAINERS naming a container that does not exist dies" \
  eval 'WORKER_CONTAINERS=lab-worker; WORKER_CONTAINERS_RESOLVED=0; _ensure_worker_containers'
FAKE_WORKER_PS_SAVED="$FAKE_WORKER_PS"
FAKE_WORKER_PS=""
assert_dies "no running worker replica at all dies rather than proceeding with an empty list" \
  eval 'WORKER_CONTAINERS=""; WORKER_CONTAINERS_RESOLVED=0; _ensure_worker_containers'
FAKE_WORKER_PS="$FAKE_WORKER_PS_SAVED"

echo "--- enqueue_perf_job / cap_perf_job_attempts (#2851, the F7 defect) ---"

# The defect: the old implementation read `.id` off the enqueue response, which
# EnqueueSyncJobResponseDto does not have, so no perf job on any run before this
# ever carried the maxAttempts cap. The cap is now applied by idempotencyKey.
ol_api() { printf '%s' '{"jobId":"1788690321451-0","jobType":"t","connectionId":"c","isExisting":false}'; }
PERF_ENQUEUED_KEYS_FILE="$(mktemp)"
enqueue_perf_job "master.product.syncFromSweep" "conn-1" '{}' 'f4:probe:1' >/dev/null
enqueue_perf_job "master.product.syncFromSweep" "conn-1" '{}' 'f4:probe:2' >/dev/null
assert_eq "enqueue_perf_job records each idempotency key" \
  "f4:probe:1 f4:probe:2" "$(tr '\n' ' ' < "$PERF_ENQUEUED_KEYS_FILE" | sed 's/ $//')"

FAKE_PG[count]=2
FAKE_PG_WRITE_CALLS=()
cap_perf_job_attempts >/dev/null 2>&1
assert_contains "cap_perf_job_attempts caps by idempotencyKey, never by a response id" \
  "${FAKE_PG_WRITE_CALLS[0]:-}" 'WHERE "idempotencyKey" IN'
assert_contains "the cap UPDATE names every recorded key" \
  "${FAKE_PG_WRITE_CALLS[0]:-}" "'f4:probe:1','f4:probe:2'"
assert_eq "the key file is cleared so a second batch is not re-capped" \
  "0" "$(wc -c < "$PERF_ENQUEUED_KEYS_FILE" | tr -d ' ')"

# A shortfall must WARN and still apply the cap to whatever did land - a
# scenario decides for itself whether a missing row is fatal to what it
# measures. Bounded wait, so a broken intake is a slow test and not a hang.
enqueue_perf_job "master.product.syncFromSweep" "conn-1" '{}' 'f4:probe:3' >/dev/null
FAKE_PG[count]=0
FAKE_PG_WRITE_CALLS=()
# Redirected to a file rather than captured with $( ), which would run the
# function in a SUBSHELL and lose its FAKE_PG_WRITE_CALLS mutations.
CAP_LOG="$(mktemp)"
PERF_CAP_WAIT_SECS=0 cap_perf_job_attempts >"$CAP_LOG" 2>&1
CAP_OUT="$(cat "$CAP_LOG")"; rm -f "$CAP_LOG"
assert_contains "a shortfall is reported rather than passed over" "$CAP_OUT" "capped 0 of 1"
assert_eq "the cap is still applied to whatever rows exist" "1" "${#FAKE_PG_WRITE_CALLS[@]}"
rm -f "$PERF_ENQUEUED_KEYS_FILE"
PERF_ENQUEUED_KEYS_FILE=""
unset -f ol_api

echo "--- post_guard_limiter_degraded passes a window docker actually honours (#2851) ---"

# The bug this pins: `docker logs --since "@1788734474"` is accepted without
# error and returns NOTHING. Verified live on Docker 29.5.2 - the same window
# returns 180 matching lines with a BARE epoch, an RFC3339 timestamp, or a
# relative `25m`, and 0 with the `@` form. The guard shipped with the `@`
# form, so it answered "ok" on every scenario in the campaign while being
# structurally unable to see a degraded-limiter line.
#
# Asserted on the ARGUMENTS the guard hands docker, not on a count: a fake
# that returns lines regardless of the window would pass however the window
# was spelled, which is exactly how the defect survived in the first place.
# Recorded to a FILE, not a variable: the guard runs its `docker logs`
# inside `$( ... )`, a subshell, so an assignment would never reach us.
DOCKER_LOGS_ARGS_FILE="$(mktemp)"
docker() {
  case "$1" in
    logs) printf '%s' "$*" > "$DOCKER_LOGS_ARGS_FILE"; echo "falling back to per-process in-memory limiting" ;;
    ps) printf '%s\n' "$FAKE_WORKER_PS" ;;
    *) : ;;
  esac
}
WORKER_CONTAINERS="lab-worker-1"
WORKER_CONTAINERS_RESOLVED=1
LIMITER_OUT="$(post_guard_limiter_degraded 1788730000 1788734000)"
DOCKER_LOGS_ARGS="$(cat "$DOCKER_LOGS_ARGS_FILE")"

assert_contains "the degraded post-guard passes a BARE epoch to --since" \
  "$DOCKER_LOGS_ARGS" "--since 1788730000"
assert_contains "the degraded post-guard passes a BARE epoch to --until" \
  "$DOCKER_LOGS_ARGS" "--until 1788734000"
case "$DOCKER_LOGS_ARGS" in
  *'@'*) FAIL=$((FAIL + 1)); FAILURES+=("the degraded post-guard must not use docker's unsupported @epoch form: [$DOCKER_LOGS_ARGS]") ;;
  *) PASS=$((PASS + 1)) ;;
esac
assert_contains "a degraded line inside the window DISCARDS the run" \
  "$LIMITER_OUT" "DISCARDED post_guard_limiter_degraded"

# And the negative: no degraded line means ok, so the guard is not simply
# always-discarding once it can see the log at all.
docker() {
  case "$1" in
    logs) printf '%s' "$*" > "$DOCKER_LOGS_ARGS_FILE"; : ;;
    ps) printf '%s\n' "$FAKE_WORKER_PS" ;;
    *) : ;;
  esac
}
assert_eq "no degraded line inside the window passes" \
  "ok" "$(post_guard_limiter_degraded 1788730000 1788734000)"
rm -f "$DOCKER_LOGS_ARGS_FILE"

# ---------------------------------------------------------------------------
echo "--- post_guard_containers_stable (#2852) ---"
# The stand lock arbitrates scenarios, not `docker compose up` typed by hand.
# A recreate inside the window kills in-flight jobs (leaving phantom `running`
# rows that inflate the lane-occupancy proxy) and resets `docker logs`, so
# every log-derived guard silently measures only the tail of the window. This
# was observed live and tripped NOTHING; these assertions exist so the failing
# case is proved to fail, not merely hoped to.
CS_DIR="$(mktemp -d)"
declare -A FAKE_STARTED
docker() {
  case "$1" in
    ps) printf '%s\n' "$FAKE_WORKER_PS" ;;
    inspect)
      local last="${@: -1}"
      case "$*" in
        *'{{.State.StartedAt}}'*)
          if [ -z "${FAKE_STARTED[$last]+set}" ]; then return 1; fi
          echo "${FAKE_STARTED[$last]}" ;;
        *'{{.Id}}'*) echo "fake-id-$last" ;;
        *) echo "" ;;
      esac ;;
    *) : ;;
  esac
}
OL_API_CONTAINER="lab-api"
PG_CONTAINER="lab-postgres"; REDIS_CONTAINER=""; PS_CONTAINER=""; WC_CONTAINER=""
WORKER_CONTAINERS="lab-worker-1"; WORKER_CONTAINERS_RESOLVED=1
FAKE_STARTED["lab-api"]="2026-09-07T00:33:00Z"
FAKE_STARTED["lab-worker-1"]="2026-09-07T00:33:01Z"
FAKE_STARTED["lab-postgres"]="2026-09-07T00:10:00Z"

capture_container_starts "$CS_DIR"
assert_eq "a stand nobody touched passes" "ok" "$(post_guard_containers_stable "$CS_DIR")"

# THE case this guard exists for: a peer recreates the worker mid-window.
FAKE_STARTED["lab-worker-1"]="2026-09-07T00:41:21Z"
CS_OUT="$(post_guard_containers_stable "$CS_DIR")"
assert_contains "a worker recreated mid-window DISCARDS the run" "$CS_OUT" "DISCARDED post_guard_containers_stable"
assert_contains "the refusal names the offending container" "$CS_OUT" "lab-worker-1"
assert_contains "the refusal quotes the before/after start times" "$CS_OUT" "was=2026-09-07T00:33:01Z"

# The api half of the same recreate - F7's live incident restarted BOTH, and a
# guard watching only the worker would have called that stand stable.
FAKE_STARTED["lab-worker-1"]="2026-09-07T00:33:01Z"
FAKE_STARTED["lab-api"]="2026-09-07T00:41:21Z"
assert_contains "an api recreated mid-window DISCARDS the run" \
  "$(post_guard_containers_stable "$CS_DIR")" "lab-api"

# A container that vanished entirely must not read as stable.
FAKE_STARTED["lab-api"]="2026-09-07T00:33:00Z"
unset 'FAKE_STARTED[lab-postgres]'
assert_contains "a container that disappeared DISCARDS the run" \
  "$(post_guard_containers_stable "$CS_DIR")" "lab-postgres"

# An absent baseline is a REFUSAL, never a pass: it means the run cannot answer
# the question, and "stable" would be exactly the confident-but-blind reading
# the degraded-limiter defect taught us to distrust.
assert_contains "a missing baseline DISCARDS rather than passing" \
  "$(post_guard_containers_stable "$(mktemp -d)")" "no container baseline"

# measured_containers' STDOUT is its return value, and _ensure_worker_containers
# logs "worker replicas: ..." on its FIRST call. Unredirected, every word of
# that log line becomes a "container" - the guard then records rubbish like
# `[lib]` and `(explicit)` as things to watch, and reports them as MISSING for
# ever after. Caught by the real-docker red-first check, not by the stubbed
# assertions above (which run with discovery already memoised, so nothing
# logs). This resets the memo so the log path is actually exercised.
FAKE_WORKER_PS="lab-worker-1"
WORKER_CONTAINERS="lab-worker-1"; WORKER_CONTAINERS_RESOLVED=0
FAKE_EXISTING_CONTAINERS="lab-worker-1"
MC_OUT="$(measured_containers)"
case "$MC_OUT" in
  *'['*|*'('*|*'replicas'*)
    FAIL=$((FAIL + 1))
    FAILURES+=("measured_containers leaked _ensure_worker_containers' log into its return value: [$MC_OUT]") ;;
  *) PASS=$((PASS + 1)) ;;
esac
assert_eq "measured_containers returns only the container names" \
  "lab-api lab-worker-1 lab-postgres" "$MC_OUT"
rm -rf "$CS_DIR"

# ---------------------------------------------------------------------------
echo
echo "--- lane caps are reachable from a scenario at all (#2867) ---"
# The failure this defends against is silent and total. Compose substitutes
# `${VAR}` only for keys the service actually LISTS, so before #2867 exporting
# OL_LANE_* around `docker compose up` changed nothing - and a cap sweep would
# have produced a perfectly clean curve of the SAME cap measured at every
# point, which is indistinguishable from "this lane does not respond to its
# cap". That is a conclusion, so it must not be reachable by accident.
F8_COMPOSE="$SCRIPT_DIR/../../docker-compose.lab.yml"
if [ -f "$F8_COMPOSE" ]; then
  F8_WORKER_ENV="$(awk '/^  worker:/{inw=1} inw && /^  [a-z]/ && !/^  worker:/{inw=0} inw' "$F8_COMPOSE")"
  for f8_stem in REALTIME BULK FISCAL FANOUT; do
    for f8_suffix in CAP SCOPE_CAP; do
      assert_contains "docker-compose.lab.yml passes OL_LANE_${f8_stem}_${f8_suffix} through to the worker" \
        "$F8_WORKER_ENV" "OL_LANE_${f8_stem}_${f8_suffix}:"
      # Default must be EMPTY, never a literal number: resolveLaneCaps reads ''
      # as "use the code default", so an empty default keeps an untouched stand
      # byte-identical to its pre-#2867 self. A number here would silently pin
      # every lab stand to a cap the code no longer owns.
      assert_contains "OL_LANE_${f8_stem}_${f8_suffix} defaults to empty (unset == code default)" \
        "$F8_WORKER_ENV" "OL_LANE_${f8_stem}_${f8_suffix}: '\${OL_LANE_${f8_stem}_${f8_suffix}:-}'"
    done
  done
else
  FAIL=$((FAIL + 1)); FAILURES+=("docker-compose.lab.yml not found at $F8_COMPOSE")
fi

F8_SCENARIO="$SCRIPT_DIR/scenarios/f8-lane-caps.sh"
if [ -f "$F8_SCENARIO" ]; then
  F8_SRC="$(cat "$F8_SCENARIO")"
  # `fan-out` is the one lane whose env stem is not its own name. Getting it
  # wrong sets nothing, every arm runs at the same cap, and the run looks fine.
  assert_contains "f8 maps the fan-out lane to the FANOUT env stem, not 'FAN-OUT'" \
    "$F8_SRC" 'fan-out)  LANE_ENV_STEM="FANOUT"'
  # The cap must be read back out of the worker's own startup line. Trusting
  # the env write is exactly the silent-failure mode above.
  assert_contains "f8 verifies the applied cap against the worker's startup line" \
    "$F8_SRC" 'assert_caps_applied'
  assert_contains "f8 refuses an arm whose cap did not apply" \
    "$F8_SRC" 'The cap did NOT apply'
  # Occupancy over-reads (F4 § 2) and is a larger fraction of a small cap than
  # of bulk's 12. Every cap f8 sweeps is smaller than 12, so the script must
  # say so where a reader of its output will see it.
  assert_contains "f8 labels the occupancy figures as an over-reading proxy" \
    "$F8_SRC" 'PROXY and OVER-READ'
  # #2617 takes a per-(connection, offer) lock. A pool at or below the widest
  # cap would serialise the arm on the lock and the curve would be the lock's.
  assert_contains "f8 refuses a realtime sweep whose offer pool is not wider than the widest cap" \
    "$F8_SRC" 'curve of the lock, not of the lane'
  # The fiscal arm exercises a handler that returns before any adapter, lock or
  # provider. It measures the runner's floor and must never be quoted as a cap.
  assert_contains "f8 states the fiscal arm is not a cap measurement" \
    "$F8_SRC" 'NOT a cap measurement'
  # A command substitution runs the function in a SUBSHELL, so every ARMS_CSV
  # append is discarded and every log line is swallowed into the substitution's
  # value. The first run of f8 did exactly that: both arms executed against the
  # stand and the summary came out with a header and no rows.
  case "$F8_SRC" in
    *'$(run_arm'*) FAIL=$((FAIL + 1)); FAILURES+=("f8 must not call run_arm in a command substitution - the subshell discards ARMS_CSV") ;;
    *) PASS=$((PASS + 1)) ;;
  esac
  # An oversized TOTAL turns every refill into a claim-and-release of
  # (free - 1) rows, because claimAndStartForLane claims `total - inFlight` and
  # only then drops what exceeds perScope.
  assert_contains "f8 derives TOTAL from perScope x scopes rather than pinning it high" \
    "$F8_SRC" 'total=$(( cap * SCOPES ))'
else
  FAIL=$((FAIL + 1)); FAILURES+=("f8-lane-caps.sh not found at $F8_SCENARIO")
fi

# ---------------------------------------------------------------------------
echo
echo "=== $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  printf 'FAILURES:\n'
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
exit 0
