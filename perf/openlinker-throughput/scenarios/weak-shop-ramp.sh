#!/usr/bin/env bash
#
# weak-shop-ramp.sh - is 300 req/min safe on a WEAK PrestaShop? (epic #2840)
#
# ---------------------------------------------------------------------------
# THE QUESTION, AND WHY THE EXISTING ANSWER DOES NOT SETTLE IT
# ---------------------------------------------------------------------------
#
# `libs/integrations/prestashop/src/prestashop-plugin.ts` declares
# `defaultRateLimit: { requestsPerMinute: 60, maxConcurrent: 4 }` and says in
# its own comment: "Placeholder values pending the reporter's actual
# abuse-notice text". Somebody hit an abuse block on shared hosting; the
# details never arrived; 60 stayed.
#
# #2977 then measured the shop's latency against offered rate and found it
# free to ~6.5 req/s, with the tail moving at 10 req/s. 300 req/min is 5 req/s,
# comfortably inside that. But that measurement was taken on a 28-core host
# with an UNCONSTRAINED PrestaShop container, and the shop the original abuse
# block came from was on shared hosting. A default is for everyone, so the
# figure that decides it has to come from the weakest shop a real operator
# runs, not the strongest one we happen to own.
#
# `docs/lessons.md` (2026-09-06) names the failure in both directions: an
# uncalibrated `defaultRateLimit` is a silent throughput regression, and such a
# default should only exist with a documented quota to calibrate against.
# Raising it on one measurement from one well-resourced shop would repeat that
# mistake with the sign flipped.
#
# So: re-run #2977's ramp against a deliberately constrained shop, at several
# profiles, and find where 5 req/s stops being free.
#
# ---------------------------------------------------------------------------
# TWO MECHANISMS, AND WHY NEITHER ALONE IS ENOUGH
# ---------------------------------------------------------------------------
#
# The constraint is APPLIED with `docker update` and REMOVED with a compose
# recreate, and that split is a measured necessity rather than a preference.
#
#   * `docker update` keeps the container - and therefore PHP's opcache, the
#     Apache worker pool and every warm page - alive across the whole sweep, so
#     the ONLY thing that differs between two profiles is the cgroup quota. A
#     recreate per profile would hand every profile a cold shop and confound
#     the constraint with the warm-up.
#
#   * `docker update` cannot undo itself. Measured on this host (Docker 29.5.2,
#     cgroup v1), on a throwaway container:
#
#         docker update --cpus 0.25 --memory 512m --memory-swap 512m C
#         docker update --cpus 0     --memory 0    --memory-swap -1   C   # exit 0
#         -> HostConfig.NanoCpus  250000000   (unchanged)
#         -> HostConfig.Memory    536870912   (unchanged)
#         -> memory.limit_in_bytes 536870912  (unchanged)
#
#     `--cpu-quota -1` does clear the CPU cgroup, but leaves
#     `HostConfig.NanoCpus` stale - so `docker inspect` then REPORTS a limit the
#     container no longer has. Either way a stand "restored" with
#     `docker update` lies about itself, and the next scenario to read those
#     fields (`manifest_container_limits` reads exactly them) records the lie.
#     A fresh container from the unmodified compose spec is the only thing that
#     genuinely returns both to zero, and this script verifies that it did.
#
# Every applied profile is READ BACK from two independent places - the
# daemon's `HostConfig` and the container's own cgroup files - and a mismatch
# is fatal. One arm of this campaign silently measured the default under a
# label claiming a constraint; a set value is not an applied value.
#
# ---------------------------------------------------------------------------
# WHAT THIS DOES NOT ESTABLISH
# ---------------------------------------------------------------------------
#
# A CPU and memory cgroup is not shared hosting. A real provider applies
# concurrent-process caps, I/O throttling, per-account request accounting and
# an abuse rule that may trigger on request COUNT rather than on load - none of
# which a cgroup reproduces, and the last of which is precisely what the
# original reporter hit. This measures how a small box DEGRADES; it cannot
# measure whether a provider REFUSES. The report says so in those words.
#
# The mix is also GET-only, inherited from `drivers/ps-latency-probe.mjs` -
# see that file for why (the create path's POSTs mint real rows). A flat curve
# here is necessary, not sufficient.
#
# Usage:
#   weak-shop-ramp.sh <outdir> [profile ...]
#
# With no profiles named, runs the full table below. Profiles may be run in
# separate invocations (each takes and releases the stand lock) so a long sweep
# can be split across lock windows.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_LOG_PREFIX="weak-shop"
# shellcheck source=../lib.sh
source "$SCRIPT_DIR/../lib.sh"

OUTDIR="${1:?usage: weak-shop-ramp.sh <outdir> [profile ...]}"
shift || true

require_tools docker jq

PS_CONTAINER="${PS_CONTAINER:-lab-prestashop}"
PS_MYSQL_CONTAINER="${PS_MYSQL_CONTAINER:-lab-mysql}"
: "${PS_WEBSERVICE_KEY:?weak-shop-ramp.sh: PS_WEBSERVICE_KEY required}"

# ---------------------------------------------------------------------------
# THE PROFILE TABLE
#
#   id|ps_cpus|ps_mem|db_cpus|db_mem|what it is meant to represent
#
# `-` means "leave this container unconstrained". The database is squeezed
# only on the profiles that claim to be shared hosting: on a VPS a small but
# dedicated database is the realistic arrangement, and constraining it there
# would make the profile represent something nobody runs.
#
# The ladder BRACKETS what a customer runs rather than flattering the answer -
# it goes below the smallest plausible VPS, and its last rung is deliberately
# below any real hosting plan, because a sweep in which every profile passes
# has not located a boundary and cannot say where one is.
#
# CPU IS THE SWEPT VARIABLE; MEMORY IS HELD REALISTIC AND NON-BINDING, and
# that is a decision rather than an oversight. Measured on this stand before
# the sweep: the PrestaShop container's whole cgroup usage is 117 MiB and
# MySQL's is 416 MiB (`innodb_buffer_pool_size` 128 MiB), so a limit tight
# enough to bind would OOM-kill a container rather than slow it, and an
# OOM-kill is an artefact of the container, not a property of shared hosting -
# a real host that sells a 512 MB account does not also hand PHP a 512 MB
# per-request `memory_limit`, which this image does. The figures below are
# chosen to sit above measured usage with headroom. The consequence is stated
# in the report's "What this did not establish": memory pressure is NOT tested
# here, and no reading from this sweep may be quoted as evidence about it.
# ---------------------------------------------------------------------------
PROFILES=(
  'P0-baseline|-|-|-|-|control: unconstrained, i.e. #2977 conditions re-measured today against the 50k catalogue'
  'P1-vps2|2.0|2g|-|-|small dedicated VPS, 2 vCPU, dedicated database'
  'P2-vps1|1.0|1g|-|-|entry VPS, 1 vCPU - the smallest box PrestaShop 9 is normally put on'
  'P3-shared|0.5|1g|0.5|1g|shared hosting: half a core, PHP and database on the same squeezed box'
  'P4-shared-min|0.25|1g|0.25|1g|worst realistic shared hosting: a quarter core, PHP and database'
  'P5-boundary|0.1|1g|0.1|1g|BELOW any real hosting plan - included only to locate the boundary if the realistic profiles all pass'
)

# The rate ladder. 5 req/s IS the question (300 req/min); 6.4 is the rate
# #2977's arm BD was measured to sustain, so one step is directly comparable to
# that report; 10 is where #2977 saw the unconstrained shop's tail start to
# move, so it shows whether a weak shop has any headroom past the proposal.
RATES="${WEAK_SHOP_RATES:-1 2 5 6.4 10}"
STEP_SECS="${STEP_SECS:-60}"
# RAMP_SETTLE_SECS, deliberately NOT `SETTLE_SECS`. `lib.sh` already declares
# `SETTLE_SECS="${SETTLE_SECS:-60}"` at top level for an unrelated purpose (the
# settle between the last guard and `window_start`), and sourcing runs first -
# so a `SETTLE_SECS="${SETTLE_SECS:-10}"` here is already 60 by the time it
# executes and the `:-10` never applies. That is not hypothetical: the
# 2026-09-07 sweep ran with a ~60 s settle while this file said 10, verified
# from the child's own environment. Harmless there (a longer settle is more
# isolation between steps, not less) but the script must not say one thing and
# do another. See docs/lessons.md.
RAMP_SETTLE_SECS="${RAMP_SETTLE_SECS:-10}"
# Warm-up before each profile's ramp. The container survives `docker update`,
# so the shop is already warm - this re-warms after the quota change (the
# first requests under a new quota pay for scheduler adjustment) and, on the
# first profile, after a cold start.
# Note the ramp probe always appends its own drift step, so a warm-up costs
# 2 x WARMUP_SECS of traffic, not one.
WARMUP_SECS="${WARMUP_SECS:-30}"
WARMUP_RPS="${WARMUP_RPS:-2}"

# ---------------------------------------------------------------------------
# Stand discovery. The container is the authority on its own compose project:
# on this host the `lab` project was brought up from a sibling agent worktree,
# so the prestashop service's relative bind mounts resolve against THAT tree
# and recreating from any other checkout would change what is bound in.
# ---------------------------------------------------------------------------
_ps_label() { docker inspect --format "{{index .Config.Labels \"$1\"}}" "$PS_CONTAINER" 2>/dev/null || true; }
STAND_DIR="${STAND_DIR:-$(_ps_label com.docker.compose.project.working_dir)}"
STAND_COMPOSE="${STAND_COMPOSE:-$(_ps_label com.docker.compose.project.config_files)}"
STAND_ENV="${STAND_ENV:-$(_ps_label com.docker.compose.project.environment_file)}"
STAND_PROJECT="${STAND_PROJECT:-$(_ps_label com.docker.compose.project)}"
OVERRIDE_FILE="${OVERRIDE_FILE:-$SCRIPT_DIR/../stand/weak-shop.override.yml}"

[ -n "$STAND_DIR" ]     || die "could not resolve the stand's compose working_dir from $PS_CONTAINER's labels - export STAND_DIR"
[ -n "$STAND_COMPOSE" ] || die "could not resolve the stand's compose file from $PS_CONTAINER's labels - export STAND_COMPOSE"
[ -f "$STAND_COMPOSE" ] || die "stand compose file [$STAND_COMPOSE] does not exist"
[ -f "$OVERRIDE_FILE" ] || die "override file [$OVERRIDE_FILE] does not exist"
case "$STAND_COMPOSE" in
  *,*) die "the stand is a multi-file compose project [$STAND_COMPOSE]; set STAND_COMPOSE to the file carrying the prestashop service" ;;
esac
[ -n "$STAND_ENV" ] && [ -f "$STAND_ENV" ] || die "stand env file [$STAND_ENV] not found - export STAND_ENV"

log "stand: project=$STAND_PROJECT dir=$STAND_DIR compose=$STAND_COMPOSE env=$STAND_ENV"

# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------
guard_stand_exclusive weak-shop-ramp

# Refuse to start against an already-constrained container. If the stand is
# already carrying somebody else's limit then "restore" has no defined
# meaning: recreating would silently drop THEIR constraint, and leaving it
# would mix two profiles. This is also the check that catches a previous run
# of this script that died before restoring.
guard_shop_unconstrained() {
  local c cpus mem
  for c in "$PS_CONTAINER" "$PS_MYSQL_CONTAINER"; do
    cpus="$(docker inspect --format '{{.HostConfig.NanoCpus}}' "$c")"
    mem="$(docker inspect --format '{{.HostConfig.Memory}}' "$c")"
    if [ "$cpus" != "0" ] || [ "$mem" != "0" ]; then
      die "guard_shop_unconstrained: $c already carries a limit (NanoCpus=$cpus Memory=$mem).
  This script's restore path recreates from the unmodified compose spec, which
  would DROP that limit rather than put it back. Find out who set it. If it is
  a dead run of this script, restore it yourself with:
    cd $STAND_DIR && docker compose -f $STAND_COMPOSE --env-file $STAND_ENV -p $STAND_PROJECT up -d --no-deps --force-recreate ${c#lab-}"
    fi
  done
  log "guard_shop_unconstrained ok ($PS_CONTAINER and $PS_MYSQL_CONTAINER carry no cpu/memory limit)"
}
guard_shop_unconstrained

mkdir -p "$OUTDIR"
RESTORE_NEEDED=0

# The compose form of a profile, rendered and checked but not applied. This
# runs on EVERY invocation and touches no container: `docker compose config`
# only merges and prints. It exists because `stand/weak-shop.override.yml` is
# the declarative record a future run reproduces a profile from, and a
# declaration nothing exercises is a declaration nobody has checked - a typo
# in a key name would sit there, render as an unknown field, and be discovered
# by the person who needed it. Applying it for real is the separate
# WEAK_SHOP_VERIFY_OVERRIDE mode below; this is the cheap half that can run
# every time.
compose_with_override() {
  local ps_cpus="$1" ps_mem="$2" db_cpus="$3" db_mem="$4"
  shift 4
  ( cd "$STAND_DIR" && WEAK_SHOP_PS_CPUS="$ps_cpus" WEAK_SHOP_PS_MEM="$ps_mem" \
      WEAK_SHOP_DB_CPUS="$db_cpus" WEAK_SHOP_DB_MEM="$db_mem" \
      docker compose \
        --project-directory "$STAND_DIR" \
        -f "$STAND_COMPOSE" \
        -f "$OVERRIDE_FILE" \
        --env-file "$STAND_ENV" \
        -p "$STAND_PROJECT" "$@" )
}

validate_override_merge() {
  local rendered
  rendered="$(compose_with_override 0.25 1g 0.25 1g config 2>&1)" \
    || die "validate_override_merge: \`docker compose config\` failed with $OVERRIDE_FILE merged in:
$rendered"
  # Both services must carry all three keys at the values asked for. Grepping
  # the RENDERED spec, not the file, is the point: it proves compose parsed the
  # variables and placed them on the right services.
  local want_bytes k
  want_bytes="$(to_bytes 1g)"
  for k in "cpus: 0.25" "mem_limit: \"$want_bytes\"" "memswap_limit: \"$want_bytes\""; do
    [ "$(printf '%s\n' "$rendered" | grep -cF "$k")" -ge 2 ] \
      || die "validate_override_merge: the merged spec does not carry [$k] on both prestashop and mysql.
  Rendered spec written to $OUTDIR/override-merge.yml"
  done
  printf '%s\n' "$rendered" >"$OUTDIR/override-merge.yml"
  log "validate_override_merge ok ($OVERRIDE_FILE renders cpus/mem_limit/memswap_limit onto both services)"
}

# ---------------------------------------------------------------------------
# Apply / verify / restore
# ---------------------------------------------------------------------------

# to_bytes 768m -> 805306368. Only the suffixes the profile table uses.
to_bytes() {
  case "$1" in
    *g|*G) printf '%s' $(( ${1%[gG]} * 1024 * 1024 * 1024 )) ;;
    *m|*M) printf '%s' $(( ${1%[mM]} * 1024 * 1024 )) ;;
    *)     printf '%s' "$1" ;;
  esac
}

# cpus_to_nanocpus 0.25 -> 250000000, without bc (0.05 resolution is enough
# for this table and an integer expression cannot drift the way a float can).
cpus_to_nanocpus() {
  local whole frac
  whole="${1%%.*}"
  case "$1" in
    *.*) frac="${1#*.}" ;;
    *)   frac="" ;;
  esac
  frac="${frac}00"; frac="${frac:0:2}"
  printf '%s' $(( 10#$whole * 1000000000 + 10#$frac * 10000000 ))
}

apply_limit() {
  local container="$1" cpus="$2" mem="$3"
  [ "$cpus" = "-" ] && return 0
  log "applying to $container: cpus=$cpus mem=$mem (swap disabled)"
  docker update --cpus "$cpus" --memory "$mem" --memory-swap "$mem" "$container" >/dev/null
  RESTORE_NEEDED=1
}

# Reads the limit back from BOTH the daemon's view and the container's own
# cgroup, and dies on any disagreement with what was asked for. `docker update`
# exiting 0 is not evidence the kernel accepted the value.
verify_limit() {
  local container="$1" cpus="$2" mem="$3" want_nano want_bytes got_nano got_mem got_quota got_period got_limit
  if [ "$cpus" = "-" ]; then
    got_nano="$(docker inspect --format '{{.HostConfig.NanoCpus}}' "$container")"
    got_mem="$(docker inspect --format '{{.HostConfig.Memory}}' "$container")"
    [ "$got_nano" = "0" ] && [ "$got_mem" = "0" ] \
      || die "verify_limit: profile asks for $container UNCONSTRAINED but it reads NanoCpus=$got_nano Memory=$got_mem.
  \`docker update\` cannot remove a limit (see this file's header), so the
  profile table must only ever tighten within one invocation. Run the
  unconstrained profiles FIRST, or run them in a separate invocation after
  this one has restored the stand."
    log "verified $container: unconstrained (NanoCpus=0 Memory=0)"
    return 0
  fi

  want_nano="$(cpus_to_nanocpus "$cpus")"
  want_bytes="$(to_bytes "$mem")"

  got_nano="$(docker inspect --format '{{.HostConfig.NanoCpus}}' "$container")"
  got_mem="$(docker inspect --format '{{.HostConfig.Memory}}' "$container")"
  [ "$got_nano" = "$want_nano" ] || die "verify_limit: $container HostConfig.NanoCpus is $got_nano, asked for $want_nano ($cpus cpus)"
  [ "$got_mem" = "$want_bytes" ] || die "verify_limit: $container HostConfig.Memory is $got_mem, asked for $want_bytes ($mem)"

  # The daemon's own record is not the kernel's. cgroup v1 paths; a v2 host
  # would need cpu.max / memory.max and this would fail loudly rather than
  # silently skip the second opinion.
  got_quota="$(docker exec "$container" cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us 2>/dev/null </dev/null || printf 'unreadable')"
  got_period="$(docker exec "$container" cat /sys/fs/cgroup/cpu/cpu.cfs_period_us 2>/dev/null </dev/null || printf 'unreadable')"
  got_limit="$(docker exec "$container" cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null </dev/null || printf 'unreadable')"
  [ "$got_quota" != "unreadable" ] || die "verify_limit: could not read $container's own cpu cgroup - cannot confirm the limit was applied"
  # quota/period must equal the requested cpus, to the same 0.01 resolution.
  [ $(( got_nano / 10000000 )) -eq $(( 10#$got_quota * 100 / 10#$got_period )) ] \
    || die "verify_limit: $container cgroup says quota=$got_quota period=$got_period, which is not $cpus cpus"
  [ "$got_limit" = "$want_bytes" ] \
    || die "verify_limit: $container cgroup memory.limit_in_bytes is $got_limit, asked for $want_bytes"

  log "verified $container: HostConfig NanoCpus=$got_nano Memory=$got_mem; cgroup quota=$got_quota/$got_period limit=$got_limit"
}

# The ONLY thing that returns HostConfig to genuine zeros - see the header.
restore_stand() {
  [ "$RESTORE_NEEDED" = "1" ] || { log "restore: nothing was constrained, nothing to restore"; return 0; }
  local svc rc=0
  # MYSQL FIRST. `--no-deps` means compose will not restart prestashop for us,
  # so recreating the shop before the database it talks to leaves a live
  # PHP container pointed at a database that is mid-restart. Nothing is being
  # measured at this point so it is not a correctness problem, but the stand is
  # handed to the next scenario in a better state if the database is already up
  # when the shop comes back.
  log "restore: recreating mysql and prestashop from the UNMODIFIED compose spec"
  for svc in mysql prestashop; do
    ( cd "$STAND_DIR" && docker compose \
        --project-directory "$STAND_DIR" \
        -f "$STAND_COMPOSE" \
        --env-file "$STAND_ENV" \
        -p "$STAND_PROJECT" \
        up -d --no-deps --force-recreate "$svc" ) >>"$OUTDIR/restore.log" 2>&1 || rc=1
  done
  [ "$rc" = "0" ] || warn "restore: compose reported an error - see $OUTDIR/restore.log"

  # Verify, loudly. A restore that did not restore is the single worst thing
  # this script could leave behind, so it is checked rather than assumed.
  local c cpus mem bad=0
  for c in "$PS_CONTAINER" "$PS_MYSQL_CONTAINER"; do
    cpus="$(docker inspect --format '{{.HostConfig.NanoCpus}}' "$c" 2>/dev/null || printf 'ERR')"
    mem="$(docker inspect --format '{{.HostConfig.Memory}}' "$c" 2>/dev/null || printf 'ERR')"
    if [ "$cpus" = "0" ] && [ "$mem" = "0" ]; then
      log "restore verified: $c NanoCpus=0 Memory=0"
    else
      bad=1
      warn "RESTORE FAILED: $c still reads NanoCpus=$cpus Memory=$mem - THE STAND IS LEFT THROTTLED"
    fi
  done
  [ "$bad" = "0" ] && RESTORE_NEEDED=0
  printf 'restored_ok=%s\n' "$([ "$bad" = "0" ] && printf 'yes' || printf 'NO')" >>"$OUTDIR/restore.log"
}

# Restore runs on ANY exit, before the stand lock is released, so a crash mid
# sweep cannot leave a throttled shop behind for the next scenario. lib.sh's
# own EXIT trap releases the lock; this one is installed after it, and bash
# replaces rather than appends - so it calls the release explicitly.
#
# INT/TERM are trapped as well, and that is load-bearing rather than tidy:
# bash runs an EXIT trap when the script ends, but a default-disposition
# SIGTERM terminates the shell without running it. An operator (or an agent's
# task-stop) killing a long sweep is the MOST likely way this script ever
# ends early, and it is exactly the path that must not leave a throttled shop
# behind. The handler re-raises with the default disposition so the exit
# status still reports the signal.
on_exit() {
  local rc=$?
  trap - EXIT INT TERM
  restore_stand || true
  release_stand_exclusive || true
  exit "$rc"
}
on_signal() {
  local sig="$1"
  trap - EXIT INT TERM
  warn "caught SIG$sig - restoring the stand before exiting"
  restore_stand || true
  release_stand_exclusive || true
  trap - "$sig"
  kill "-$sig" $$
}
trap on_exit EXIT
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM

validate_override_merge

# ---------------------------------------------------------------------------
# WEAK_SHOP_VERIFY_OVERRIDE=1 - apply a profile the COMPOSE way, for real, and
# read it back. Not part of the sweep, because a recreate per profile would
# hand every profile a cold shop (see the header). Run once so the override
# file has evidence behind it and not only a rendered merge: a future run
# reproducing a profile from a clean boot uses this path, and "it renders" is
# weaker than "it applied".
# ---------------------------------------------------------------------------
if [ "${WEAK_SHOP_VERIFY_OVERRIDE:-0}" = "1" ]; then
  log "verify-override: recreating prestashop and mysql WITH the override at 0.25 cpu / 1g"
  compose_with_override 0.25 1g 0.25 1g up -d --no-deps --force-recreate prestashop mysql \
    >"$OUTDIR/override-apply.log" 2>&1 || die "verify-override: compose up failed - see $OUTDIR/override-apply.log"
  RESTORE_NEEDED=1
  verify_limit "$PS_CONTAINER" 0.25 1g
  verify_limit "$PS_MYSQL_CONTAINER" 0.25 1g
  docker inspect \
    --format '{{.Name}} NanoCpus={{.HostConfig.NanoCpus}} Memory={{.HostConfig.Memory}} MemorySwap={{.HostConfig.MemorySwap}}' \
    "$PS_CONTAINER" "$PS_MYSQL_CONTAINER" >"$OUTDIR/override-applied.txt" 2>&1
  log "verify-override: applied and read back; the EXIT trap now restores from the unmodified spec"
  exit 0
fi

# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------
warm_shop() {
  local label="$1"
  log "warming the shop for ${WARMUP_SECS}s at ${WARMUP_RPS} req/s ($label)"
  STEP_SECS="$WARMUP_SECS" SETTLE_SECS=0 \
    "$SCRIPT_DIR/../probes/ps-latency-ramp.sh" "$OUTDIR/warmup-$label" "$WARMUP_RPS" >/dev/null 2>&1 || true
  # The warm-up's own samples are kept but named so they can never be read as
  # a measurement step - ps-latency-table.sh globs step-*.summary, and these
  # live in their own directory.
}

run_profile() {
  local spec="$1"
  local id ps_cpus ps_mem db_cpus db_mem represents
  IFS='|' read -r id ps_cpus ps_mem db_cpus db_mem represents <<<"$spec"

  log "=============================================================="
  log "profile $id - $represents"
  log "  prestashop: cpus=$ps_cpus mem=$ps_mem   mysql: cpus=$db_cpus mem=$db_mem"
  log "=============================================================="

  apply_limit "$PS_CONTAINER" "$ps_cpus" "$ps_mem"
  apply_limit "$PS_MYSQL_CONTAINER" "$db_cpus" "$db_mem"
  verify_limit "$PS_CONTAINER" "$ps_cpus" "$ps_mem"
  verify_limit "$PS_MYSQL_CONTAINER" "$db_cpus" "$db_mem"

  # The applied constraint, recorded beside the samples rather than only in
  # this script's stdout, so a reader of the results directory can see what
  # each curve was measured under.
  docker inspect \
    --format '{{.Name}} NanoCpus={{.HostConfig.NanoCpus}} Memory={{.HostConfig.Memory}} MemorySwap={{.HostConfig.MemorySwap}}' \
    "$PS_CONTAINER" "$PS_MYSQL_CONTAINER" >"$OUTDIR/$id.applied" 2>&1

  warm_shop "$id"

  # WEAK_SHOP_HEAVY_ONLY=1 - skip the rate ramp and measure only the per-request
  # cost of a catalogue-sweep page at this profile. It is a separate mode rather
  # than an extra step because the two answer different questions and the ramp
  # is what makes a run take an hour: this mode exists so the heavy-read cost can
  # be bounded in a few minutes, reusing this scenario's guards, its two-place
  # constraint verification and - the reason it is not a standalone script - its
  # restore path.
  if [ "${WEAK_SHOP_HEAVY_ONLY:-0}" = "1" ]; then
    log "heavy-only: measuring catalogue-page cost at $id"
    HEAVY_SAMPLES="${HEAVY_SAMPLES:-6}" \
      "$SCRIPT_DIR/../probes/ps-heavy-request-cost.sh" "$OUTDIR" "$id"
    return 0
  fi

  # shellcheck disable=SC2086
  STEP_SECS="$STEP_SECS" SETTLE_SECS="$RAMP_SETTLE_SECS" \
    "$SCRIPT_DIR/../probes/ps-latency-ramp.sh" "$OUTDIR/$id" $RATES

  log "profile $id done - table:"
  "$SCRIPT_DIR/../probes/ps-latency-table.sh" "$OUTDIR/$id" | tee "$OUTDIR/$id.table"

  # A SUSTAINED window at the proposed rate, on the profile named by
  # WEAK_SHOP_SOAK_PROFILE. It runs here, inside the profile, because the
  # constraint can only ever tighten within one invocation (`docker update`
  # cannot loosen) - so a soak appended after the whole sweep could not get
  # back to a middle profile's quota.
  #
  # It exists because a 60 s step cannot see an accumulating problem, and the
  # condition this whole measurement is about - the reporter's abuse block - is
  # by nature accumulating: a host that counts requests per hour, a PHP-FPM
  # pool that fills, a connection table that grows. Two back-to-back windows at
  # the same rate (the probe's own drift step supplies the second) answer
  # "does the tenth minute look like the first", which one short step cannot.
  if [ "$id" = "${WEAK_SHOP_SOAK_PROFILE:-}" ]; then
    local soak_secs="${WEAK_SHOP_SOAK_SECS:-300}" soak_rps="${WEAK_SHOP_SOAK_RPS:-5}"
    log "soak: $id at ${soak_rps} req/s for 2 x ${soak_secs}s (the probe appends its own repeat)"
    STEP_SECS="$soak_secs" SETTLE_SECS="$RAMP_SETTLE_SECS" \
      "$SCRIPT_DIR/../probes/ps-latency-ramp.sh" "$OUTDIR/$id-soak" "$soak_rps"
    log "soak $id done - table:"
    "$SCRIPT_DIR/../probes/ps-latency-table.sh" "$OUTDIR/$id-soak" | tee "$OUTDIR/$id-soak.table"
  fi
}

# ---------------------------------------------------------------------------
# Sweep
# ---------------------------------------------------------------------------
WANTED=("$@")
ran=0
for spec in "${PROFILES[@]}"; do
  id="${spec%%|*}"
  if [ "${#WANTED[@]}" -gt 0 ]; then
    match=0
    for w in "${WANTED[@]}"; do [ "$w" = "$id" ] && match=1; done
    [ "$match" = "1" ] || continue
  fi
  run_profile "$spec"
  ran=$(( ran + 1 ))
done
[ "$ran" -gt 0 ] || die "no profile matched [${WANTED[*]}] - known ids: $(for s in "${PROFILES[@]}"; do printf '%s ' "${s%%|*}"; done)"

log "sweep complete: $ran profile(s) under $OUTDIR"
