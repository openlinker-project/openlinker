#!/usr/bin/env bash
# F3 rate ladder, one rung per invocation of the scenario (it has no internal
# ladder - TARGET_RATE is a scalar).
#
# PRE_ALLOCATED_VUS, NOT MAX_VUS. Under ramping-arrival-rate k6 grows the
# allocated pool lazily from preAllocatedVUs toward maxVUs, and
# post_guard_generator_saturated divides by the GROWN figure
# (.metrics.vus_max.max). The 2026-09-06 arms ran preAllocated=50 against a
# default maxVUs=300 and reported pools of 137/154/156 - a lazily grown pool
# sits permanently at ~100% utilisation, so raising the ceiling cannot move
# the ratio by a single point.
#
# Sizing rule, per rung, from the PREVIOUS rung's observation rather than fitted:
#   guard needs   vus.max / vus_max.max <= 0.90
#   demand is     concurrency ~= offered_rate x response_time
#   therefore     PRE_ALLOCATED_VUS >= ceil(rate x observed_p99_seconds / 0.90)
#
# Rung 1 is sized from the 2026-09-06 record: at 1000/s offered the run reached
# vus.max=132 in a grown pool of 137 (96%), achieved 601.8/s, p99 217.8ms, and
# dropped 19.6% of intended iterations - so it wanted materially more
# concurrency than it had. 4x the grown pool (137 -> 548) rounded to 600, with
# maxVUs 900 left as headroom that should stay untouched on a healthy run.
#
# The ceiling on this ladder is MEMORY, not the guard: k6 VUs cost RAM, the k6
# container runs with no --memory, and an OOM-killed k6 is #2931's own shape.
# So each rung records k6 container RSS and host MemAvailable, and the ladder
# stops where something refuses - reporting WHICH.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
R="$(pwd)/results"

export PS_CONTAINER=lab-prestashop PS_MYSQL_CONTAINER=lab-mysql WC_CONTAINER=lab-woocommerce \
       PG_CONTAINER=lab-postgres REDIS_CONTAINER=lab-redis OL_API_CONTAINER=lab-api \
       OL_API_URL=http://127.0.0.1:19000 OL_ADMIN_USER=admin OL_ADMIN_PASSWORD=admin
export WEBHOOK_CONNECTION_ID=c9f4c835-0238-458d-b402-9089adab7950
unset WORKER_CONTAINERS
export OL_STAND_LOCK_TTL_SECS=10800
export SETTLE_SECS=60
# Held CONSTANT across every rung so the rungs are comparable to each other.
# Both are below the 2026-09-06 run's settings (300 probe samples, 4 sweep
# steps); neither feeds the arrival-rate figure the ladder is about, and the
# reduction is what makes a multi-rung ladder fit one window.
export PROBE_TIMING_SAMPLES=60
export CONCURRENT_VUS_STEPS="2 32"
export CONCURRENT_VUS_DURATION_SECS=20
export RAMP_UP_SECS=30 PLATEAU_SECS=120 RAMP_DOWN_SECS=15

log() { printf '[ladder] %s %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }

rung() { # rung <rate> <preallocated> <maxvus>
  # Two statements on purpose: `local a="$1" b="${a}"` expands every word
  # BEFORE performing any assignment, so ${a} is still unset when b is
  # expanded - which under `set -u` aborts the script. It did, on the first
  # launch, and cost nothing because it failed closed before taking the stand.
  local rate="$1" pre="$2" mx="$3"
  local tag="r${rate}" rc=0
  log "=== rung $rate/s  PRE_ALLOCATED_VUS=$pre  MAX_VUS=$mx ==="

  # guard_queue_empty is scoped to the F3 connection; drain install-wide so a
  # cron or a prior rung cannot refuse the next rung.
  docker exec -i lab-postgres psql -U postgres -d openlinker -tAc \
    "WITH d AS (DELETE FROM sync_jobs WHERE status IN ('queued','running') RETURNING 1) SELECT COUNT(*) FROM d" \
    | sed 's/^/[ladder] drained /'

  TARGET_RATE="$rate" PRE_ALLOCATED_VUS="$pre" MAX_VUS="$mx" \
    bash scenarios/f3-webhook-burst.sh > "$R/f3-$tag.log" 2>&1 || rc=$?
  # NOT `local rc=$?` after the command: `local` is itself a command and
  # resets $?, so that form records local's own status and always reads 0.
  log "rung $rate/s scenario exit=$rc"

  # write_dated_report writes results-F3-<UTC date>.md and a ladder is N
  # invocations, so rung N-1's report is DESTROYED by rung N with no warning.
  # Copied aside per rung rather than changing the harness mid-ladder: a report
  # writer whose behaviour changed between rungs would make the rungs
  # incomparable, which is the one property a ladder must have.
  if [ -f "results-F3-$(date -u +%Y-%m-%d).md" ]; then
    cp "results-F3-$(date -u +%Y-%m-%d).md" "$R/f3-report-$tag.md"
    log "saved rung report aside -> results/f3-report-$tag.md"
  fi
  return $rc
}

log "ladder start"
rung 1000 600 900
log "ladder finished the scheduled rungs"
