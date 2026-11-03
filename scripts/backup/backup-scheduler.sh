#!/bin/bash
# Long-running scheduler for the docker-compose `backup` service (#3618).
#
# Sleeps until OL_BACKUP_TIME (HH:MM, UTC, default 03:00) every day, then
# runs pg-backup-once.sh. Deliberately never EXITS on a failed dump — a
# crash-looped container produces zero future backups, which is worse than
# one missed night; the failure is instead logged loudly (`docker compose
# logs backup` is the surface an operator or an alert reads), matching the
# acceptance criterion that a failed dump "exits non-zero and is visible in
# the service logs" — that is a property of the DUMP RUN, not of this
# container's own process.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
TARGET_TIME="${OL_BACKUP_TIME:-03:00}"

log() {
  echo "[pg-backup-scheduler] $(date -u +%FT%TZ) $*"
}

# Seconds from now until the next occurrence of TARGET_TIME (UTC). Computed
# with plain arithmetic on epoch seconds rather than relying on GNU date's
# "today"/"tomorrow" relative-date parsing, which BusyBox date (the actual
# runtime here — postgres:*-alpine ships BusyBox coreutils, verified 2026-09)
# does not support; BusyBox `date -d "YYYY-MM-DD HH:MM"` (an absolute string)
# does work and is what this relies on instead.
seconds_until_next_run() {
  local now_epoch today_epoch target_epoch
  now_epoch="$(date -u +%s)"
  today_epoch="$(date -u -d "$(date -u +%Y-%m-%d) ${TARGET_TIME}" +%s)"
  target_epoch="$today_epoch"
  if [ "$target_epoch" -le "$now_epoch" ]; then
    target_epoch=$((today_epoch + 86400))
  fi
  echo $((target_epoch - now_epoch))
}

log "starting — runs daily at ${TARGET_TIME} UTC, dumps kept under ${OL_BACKUP_DIR:-/backups}"

while true; do
  wait_s="$(seconds_until_next_run)"
  log "next run in ${wait_s}s"
  sleep "$wait_s"

  if "$SCRIPT_DIR/pg-backup-once.sh"; then
    log "backup run succeeded"
  else
    log "BACKUP RUN FAILED (exit $?) — will retry at the next scheduled time"
  fi

  # Guard against a dump finishing inside the same minute as its own target
  # re-triggering the loop immediately on the next `seconds_until_next_run`
  # rounding down to 0.
  sleep 60
done
