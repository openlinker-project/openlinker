#!/usr/bin/env bash
# A1a variant - measure one sweep tick at an ARBITRARY offset into the catalogue.
#
# `run-a1a.sh` clears the sweep cursor before every run, so it always measures the
# FIRST page. On a large catalogue the question worth asking is whether a LATE page
# costs more: the enumeration pages by offset, and an offset scan is not free in
# every store engine. This seeds the cursor to a chosen offset and runs one tick.
#
# Usage: ./run-a1a-at-offset.sh <offset> [label]
set -euo pipefail
OFFSET="${1:?offset required}"
LABEL="${2:-a1a-off$OFFSET}"

API="${API:-http://localhost:3000}"
CONN="${CONNECTION_ID:-44bb1f3f-17ae-4038-ab48-413ce54a71c7}"
PS_CONTAINER="${PS_CONTAINER:-ol-demo-fresh-prestashop}"
PG="${PG_CONTAINER:-ol-demo-fresh-postgres}"
OUT="${OUT:-./results}"
CURSOR="master.product.sweep:connection:${CONN}"
mkdir -p "$OUT"

pg() { docker exec -i "$PG" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<< "$1"; }
token() {
  curl -s -X POST "$API/v1/auth/login" -H 'content-type: application/json' \
    -d "{\"username\":\"${OL_ADMIN_USER:-admin}\",\"password\":\"${OL_ADMIN_PASSWORD:-admin}\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("access_token") or d.get("accessToken") or "")'
}

n=$(pg "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$CONN' AND status IN ('queued','running','dead');")
echo "queue purge: $n rows for connection $CONN"
[ "${PURGE_QUEUE:-0}" = "1" ] || { echo "FATAL: refusing; re-run with PURGE_QUEUE=1" >&2; exit 1; }
pg "DELETE FROM sync_jobs WHERE \"connectionId\"='$CONN' AND status IN ('queued','running','dead');" >/dev/null

# Seed the cursor. The value is composite (#2218): {cycleId}:{offset}.
CYCLE="offsetprobe-$(date +%s)"
pg "DELETE FROM connection_cursors WHERE \"connectionId\"='$CONN' AND \"cursorKey\"='$CURSOR';" >/dev/null
# The column is `value`, not `cursorValue`. NOT silenced: a failed seed here would
# make the probe measure offset 0 while claiming to measure a late page, which is
# worse than no measurement at all. The read-back is the proof, not the write.
pg "INSERT INTO connection_cursors (\"connectionId\", \"cursorKey\", value, \"createdAt\", \"updatedAt\") VALUES ('$CONN','$CURSOR','$CYCLE:$OFFSET', now(), now());"
SEEDED=$(pg "SELECT value FROM connection_cursors WHERE \"connectionId\"='$CONN' AND \"cursorKey\"='$CURSOR';")
[ "$SEEDED" = "$CYCLE:$OFFSET" ] || { echo "FATAL: cursor seed failed (read back '"'"'$SEEDED'"'"')" >&2; exit 1; }
echo "cursor seeded and verified: $SEEDED"

JOBS_BEFORE=$(pg "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$CONN';")
ATT_BEFORE=$(pg "SELECT COALESCE(SUM(attempts),0) FROM sync_jobs WHERE \"connectionId\"='$CONN';")
MARK=$(date +%s); START=$MARK
TOKEN=$(token)
curl -s -X POST "$API/v1/sync/jobs" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"jobType\":\"master.product.syncAll\",\"connectionId\":\"$CONN\",\"payload\":{},\"idempotencyKey\":\"$LABEL:$(date +%s)\"}" \
  -o "$OUT/$LABEL.enqueue.json" -w "enqueue_http=%{http_code}\n"

quiet=0
while [ "$quiet" -lt 5 ]; do
  sleep 5
  inflight=$(pg "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$CONN' AND status IN ('queued','running');")
  if [ "$inflight" = "0" ]; then quiet=$((quiet+1)); else quiet=0; fi
done
ELAPSED=$(( $(date +%s) - START - 25 ))
ATT_AFTER=$(pg "SELECT COALESCE(SUM(attempts),0) FROM sync_jobs WHERE \"connectionId\"='$CONN';")
COVERED=$(pg "SELECT COALESCE(SUM(CASE WHEN \"jobType\"='master.product.syncBatch' THEN jsonb_array_length(\"payloadJson\"->'externalIds') ELSE 1 END),0) FROM sync_jobs WHERE \"connectionId\"='$CONN' AND \"jobType\" IN ('master.product.syncBatch','master.product.syncFromSweep') AND \"createdAt\" >= to_timestamp($MARK);")
CURSOR_AFTER=$(pg "SELECT COALESCE(value,'(cleared)') FROM connection_cursors WHERE \"connectionId\"='$CONN' AND \"cursorKey\"='$CURSOR';")

docker logs --since "$MARK" "$PS_CONTAINER" > "$OUT/$LABEL.access.log" 2>&1
{
  echo "label=$LABEL start_offset=$OFFSET"
  echo "elapsed_seconds=$ELAPSED"
  echo "attempts_delta=$((ATT_AFTER - ATT_BEFORE))"
  echo "products_covered=$COVERED"
  echo "cursor_after=$CURSOR_AFTER"
  echo
  python3 "$(dirname "$0")/analyze-log.py" < "$OUT/$LABEL.access.log"
} | tee "$OUT/$LABEL.summary.txt"
