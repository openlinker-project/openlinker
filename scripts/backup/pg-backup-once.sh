#!/bin/bash
# Single Postgres backup run: pg_dump (custom format) + daily/weekly retention
# prune. Part of #3618 (automated nightly backup service, D36).
#
# Reads connection info from the standard `PG*` environment variables
# (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE) that `pg_dump`/`psql` read
# natively — the docker-compose `backup` service is given the SAME
# POSTGRES_PASSWORD the `api`/`migrate` services already read from `.env`.
# Nothing here reads a committed file for credentials.
#
# Runs standalone (no scheduler dependency), so it is also what
# `.github/workflows/backup-restore.yml` calls directly to produce the dump
# CI restores into an empty database — one script, two callers, so the CI
# path can never drift from what actually runs at 03:00 in production.
#
# Exit status: non-zero on ANY failure. A failed dump must be visible in the
# service's own logs and must never be silently swallowed — `set -euo
# pipefail` is load-bearing, not decoration.
set -euo pipefail

BACKUP_ROOT="${OL_BACKUP_DIR:-/backups}"
DAILY_DIR="$BACKUP_ROOT/daily"
WEEKLY_DIR="$BACKUP_ROOT/weekly"
DAILY_RETENTION="${OL_BACKUP_DAILY_RETENTION:-7}"
WEEKLY_RETENTION="${OL_BACKUP_WEEKLY_RETENTION:-4}"
# date(1) `%u`: ISO weekday, 1=Monday .. 7=Sunday. Default Sunday.
WEEKLY_DAY="${OL_BACKUP_WEEKLY_DAY:-7}"

log() {
  echo "[pg-backup] $(date -u +%FT%TZ) $*"
}

mkdir -p "$DAILY_DIR" "$WEEKLY_DIR"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILENAME="openlinker-${STAMP}.dump"
DEST="$DAILY_DIR/$FILENAME"
# Written under a `.partial` name first: a container killed mid-dump must
# never leave a file that LOOKS like a complete backup at the real name —
# the retention prune below only ever sees genuinely finished dumps.
TMP_DEST="$DEST.partial"

log "starting dump of ${PGDATABASE:-openlinker} to $DEST"

# -Fc (custom format): compressed, and the only format pg_restore can target
# selectively or in parallel. --no-owner/--no-privileges: a restore target
# rarely shares the source's exact role names, and GRANT/OWNER statements
# failing mid-restore is a worse failure mode than a restore that just
# doesn't reapply ownership (the restoring role owns everything it creates).
pg_dump -Fc --no-owner --no-privileges -f "$TMP_DEST"
mv "$TMP_DEST" "$DEST"

DUMP_SIZE="$(du -h "$DEST" 2>/dev/null | cut -f1 || echo '?')"
log "dump complete: $DEST ($DUMP_SIZE)"

TODAY_DOW="$(date -u +%u)"
if [ "$TODAY_DOW" = "$WEEKLY_DAY" ]; then
  cp "$DEST" "$WEEKLY_DIR/$FILENAME"
  log "also retained as this week's weekly dump: $WEEKLY_DIR/$FILENAME"
fi

# Prune oldest-first, keeping the newest $2 files. `ls -1t` (newest-first,
# one per line) is a portable choice under BusyBox (`postgres:*-alpine`'s
# actual shell environment, verified 2026-09) — BusyBox `find` has no
# `-printf`, so mtime-sorting can't go through `find` here.
prune_dir() {
  local dir="$1"
  local keep="$2"
  local i=0
  local f
  # A glob that matches nothing expands to itself under bash without
  # nullglob; guard with `2>/dev/null` + the loop's own emptiness check.
  for f in $(cd "$dir" && ls -1t openlinker-*.dump 2>/dev/null || true); do
    i=$((i + 1))
    if [ "$i" -gt "$keep" ]; then
      log "pruning old dump: $dir/$f"
      rm -f "$dir/$f"
    fi
  done
}

prune_dir "$DAILY_DIR" "$DAILY_RETENTION"
prune_dir "$WEEKLY_DIR" "$WEEKLY_RETENTION"

log "done"
