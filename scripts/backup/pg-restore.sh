#!/bin/bash
# Restore a `pg_dump -Fc` dump (as produced by pg-backup-once.sh) into a
# target database. Part of #3618/#3537 — the documented restore path, and
# the exact command `.github/workflows/backup-restore.yml` runs against an
# empty database to prove a restore actually works rather than being assumed.
#
# Usage:
#   pg-restore.sh <dump-file> [target-database]
#
# Reads connection info from the standard `PG*` environment variables
# (PGHOST/PGPORT/PGUSER/PGPASSWORD) exactly like pg-backup-once.sh. The
# target database name defaults to $PGDATABASE but may be overridden by the
# second argument — restoring into a FRESH database (never the live one) is
# the documented, safe default; see docs/operations/backup-and-restore.md.
#
# This script does NOT create the target database — it must already exist
# (empty or otherwise) and carry no `uuid-ossp` assumption of its own: a
# restored dump created the extension when IT ran `migration:run` (#2684),
# and `pg_restore` replays that same `CREATE EXTENSION` statement, so a
# restore into a genuinely empty database does not additionally need the
# #2684 bootstrap run first — the dump already contains it.
set -euo pipefail

DUMP_FILE="${1:?usage: pg-restore.sh <dump-file> [target-database]}"
TARGET_DB="${2:-${PGDATABASE:-openlinker}}"

if [ ! -f "$DUMP_FILE" ]; then
  echo "[pg-restore] dump file not found: $DUMP_FILE" >&2
  exit 1
fi

echo "[pg-restore] $(date -u +%FT%TZ) restoring $DUMP_FILE into database '$TARGET_DB'"

# --clean --if-exists: safe to re-run against a database that already holds
# a previous (possibly partial) restore attempt. --no-owner/--no-privileges
# mirrors the dump's own --no-owner/--no-privileges (#3618) — a restoring
# role that doesn't match the source's role names must not fail on GRANT/
# OWNER statements the dump was never going to carry meaningfully anyway.
pg_restore \
  --dbname="$TARGET_DB" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  "$DUMP_FILE"

echo "[pg-restore] $(date -u +%FT%TZ) restore complete"
