#!/usr/bin/env bash
#
# Retries the F10 run until it wins `guard_stand_exclusive` (#2978).
#
# A peer on this stand cycles the lock in short holds - take, run a profile,
# release, repeat - so a single-shot launch loses the race more often than it
# wins it. This retries rather than working around the guard: it never deletes
# the lock, never passes a force flag, and never starts while somebody else
# holds it. It simply asks again.
#
# It distinguishes the two ways the scenario can stop early, because they need
# opposite responses:
#
#   refused by the lock   ->  retry, this is expected contention
#   anything else         ->  stop and surface it, because a real failure
#                             retried in a loop is a real failure repeated
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ATTEMPTS="${ATTEMPTS:-40}"
RETRY_SECS="${RETRY_SECS:-20}"
PROFILE="${1:-all}"
LOG_BASE="${LOG_BASE:-$HERE/results/f10-run}"

for i in $(seq 1 "$ATTEMPTS"); do
  log="${LOG_BASE}-attempt${i}.log"
  printf '[launcher] attempt %s/%s -> %s\n' "$i" "$ATTEMPTS" "$log"
  set +e
  bash "$HERE/run-f10.sh" "$PROFILE" > "$log" 2>&1
  rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    printf '[launcher] run completed (attempt %s)\n' "$i"
    exit 0
  fi
  if grep -qF 'guard_stand_exclusive: the stand is already being measured' "$log"; then
    printf '[launcher] refused by the stand lock; retrying in %ss\n' "$RETRY_SECS"
    rm -f "$log"
    sleep "$RETRY_SECS"
    continue
  fi
  printf '[launcher] attempt %s failed for a reason that is NOT lock contention (rc=%s) - stopping so it is not retried into the ground:\n' "$i" "$rc"
  tail -25 "$log"
  exit "$rc"
done

printf '[launcher] gave up after %s attempts - the stand was never free\n' "$ATTEMPTS"
exit 1
