#!/usr/bin/env bash
#
# Waits until BOTH the stand lock is free AND no peer has enqueued anything on
# the shared stand for a quiet period (#2978).
#
# The lock alone is not a sufficient signal, and this run learned that the
# expensive way: a peer scenario wrote `inventory.propagateToMarketplaces`
# fan-out children onto `perf-allegro-a` throughout an F10 window that was
# holding `guard_stand_exclusive` at the time. Those children share the
# `realtime` lane's per-scope slots with the order path being measured, so the
# window was contaminated in a way no guard in lib.sh looks for - the lock
# arbitrates scenarios that TAKE it, and cannot see one that does not.
#
# The quiet signal is therefore an absence of new rows, not an absence of a
# lock holder.
set -euo pipefail

QUIET_MINUTES="${QUIET_MINUTES:-4}"
POLL_SECS="${POLL_SECS:-30}"

recent_peer_writes() {
  docker exec -i lab-postgres psql -U postgres -d openlinker -qtAX \
    -c "SELECT COUNT(*) FROM sync_jobs WHERE \"createdAt\" > NOW() - interval '${QUIET_MINUTES} minutes'" \
    2>/dev/null | tr -d '[:space:]'
}

lock_holder() {
  docker exec -i lab-redis redis-cli GET perf:stand:exclusive 2>/dev/null | tr -d '[:space:]'
}

while true; do
  holder="$(lock_holder || printf '')"
  writes="$(recent_peer_writes || printf 'unknown')"
  if [ -z "$holder" ] && [ "$writes" = "0" ]; then
    printf 'STAND QUIET at %s - lock free and no sync_jobs row created in the last %s minutes\n' \
      "$(date -u +%H:%M:%SZ)" "$QUIET_MINUTES"
    exit 0
  fi
  printf '  waiting: lock=[%s] rows_last_%smin=%s\n' "${holder:-free}" "$QUIET_MINUTES" "$writes"
  sleep "$POLL_SECS"
done
