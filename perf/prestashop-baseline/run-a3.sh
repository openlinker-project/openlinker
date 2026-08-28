#!/usr/bin/env bash
# A3 — cost per stock position for one inventory sweep tick, repeated.
#
# Each run starts from a clean queue and a cleared sweep cursor, so every run
# enqueues a full budget of children from the start of a fresh cycle. The
# shop's own access log is the instrument (docker logs; the image symlinks
# access.log -> /dev/stdout).
#
# Contamination is reported, never hidden: the scheduler fires its own
# master.product.syncAll every 20 min and master.inventory.syncAll every 15 min,
# so a run can catch a tick. `jobs_created` and `attempts_delta` make that
# visible, and a polluted run is repeated.
#
# Usage: ./run-a3.sh [runs]   (default 3; run 1 is the cold run, discarded)
set -euo pipefail

RUNS="${1:-3}"
API="${API:-http://localhost:3000}"
CONN="${CONNECTION_ID:-44bb1f3f-17ae-4038-ab48-413ce54a71c7}"
PS_CONTAINER="${PS_CONTAINER:-ol-demo-fresh-prestashop}"
PG="${PG_CONTAINER:-ol-demo-fresh-postgres}"
OUT="${OUT:-./results}"
CURSOR="master.inventory.sweep:connection:${CONN}"
# Every job type that represents inventory work done FOR a product, across the
# #2594 rename and the #2648 batching. Shared by the coverage and breakdown reads.
TYPES="('master.inventory.syncBatch','master.inventory.syncFromSweep','master.inventory.syncByExternalId')"
mkdir -p "$OUT"

pg() { docker exec -i "$PG" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<< "$1"; }
token() {
  curl -s -X POST "$API/v1/auth/login" -H 'content-type: application/json' \
    -d "{\"username\":\"${OL_ADMIN_USER:-admin}\",\"password\":\"${OL_ADMIN_PASSWORD:-admin}\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("access_token") or d.get("accessToken") or "")'
}

# Purging is destructive: it deletes real pending work if CONNECTION_ID points
# at a live connection. Print what is about to go and require an explicit
# opt-in (PURGE_QUEUE=1).
purge_queue() {
  local n
  n=$(pg "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$CONN' AND status IN ('queued','running','dead');")
  echo "queue purge: $n queued/running/dead sync_jobs rows for connection $CONN"
  if [ "${PURGE_QUEUE:-0}" != "1" ]; then
    echo "FATAL: refusing to delete them. A measured window needs a clean queue," >&2
    echo "       so re-run with PURGE_QUEUE=1 once you are sure this connection" >&2
    echo "       carries no real pending work." >&2
    exit 1
  fi
  pg "DELETE FROM sync_jobs WHERE \"connectionId\"='$CONN' AND status IN ('queued','running','dead');" >/dev/null
  echo "queue purge: deleted $n rows"
}

for i in $(seq 1 "$RUNS"); do
  LABEL="${LABEL_PREFIX:-}a3-run$i"
  echo "=================== $LABEL ==================="
  date +%T

  # Clean slate: no leftover children, and a cycle that starts at offset 0.
  purge_queue
  pg "DELETE FROM connection_cursors WHERE \"connectionId\"='$CONN' AND \"cursorKey\"='$CURSOR';" >/dev/null

  JOBS_BEFORE=$(pg "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$CONN';")
  ATT_BEFORE=$(pg "SELECT COALESCE(SUM(attempts),0) FROM sync_jobs WHERE \"connectionId\"='$CONN';")

  MARK=$(date +%s)   # epoch: a bare timestamp is read as the DAEMON local time, not UTC
  START=$(date +%s)
  TOKEN=$(token)
  curl -s -X POST "$API/v1/sync/jobs" -H "authorization: Bearer $TOKEN" \
    -H 'content-type: application/json' \
    -d "{\"jobType\":\"master.inventory.syncAll\",\"connectionId\":\"$CONN\",\"payload\":{},\"idempotencyKey\":\"a3:$i:$(date +%s)\"}" \
    -o "$OUT/$LABEL.enqueue.json" -w "enqueue_http=%{http_code}\n"

  # Drain: quiet for 5 consecutive polls (25 s) with nothing queued or running.
  quiet=0
  while [ "$quiet" -lt 5 ]; do
    sleep 5
    inflight=$(pg "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$CONN' AND status IN ('queued','running');")
    if [ "$inflight" = "0" ]; then quiet=$((quiet+1)); else quiet=0; fi
  done

  ELAPSED=$(( $(date +%s) - START - 25 ))
  JOBS_AFTER=$(pg "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$CONN';")
  ATT_AFTER=$(pg "SELECT COALESCE(SUM(attempts),0) FROM sync_jobs WHERE \"connectionId\"='$CONN';")
  # #2594 renamed the sweep-triggered child to `master.inventory.syncFromSweep`
  # (same handler, `bulk` lane instead of `realtime`); #2648 then replaced the
  # one-child-per-product fan-out with `master.inventory.syncBatch`, whose single
  # child carries a whole page of ids in `payloadJson->'externalIds'`. All three
  # names are counted, and coverage sums the batch payload lengths, so the
  # harness reads the same figure on either side of both changes.
  # A batch child covers many products, a per-product child covers exactly one.
  COVERED=$(pg "SELECT COALESCE(SUM(CASE WHEN \"jobType\"='master.inventory.syncBatch' THEN COALESCE(jsonb_array_length(\"payloadJson\"->'externalIds'),0) ELSE 1 END),0) FROM sync_jobs WHERE \"connectionId\"='$CONN' AND \"jobType\" IN $TYPES AND \"createdAt\" >= to_timestamp($MARK);")
  CHILDREN=$(pg "SELECT COALESCE(string_agg(t || ':' || c::text, ' '),'none') FROM (SELECT \"jobType\" t, COUNT(*) c FROM sync_jobs WHERE \"connectionId\"='$CONN' AND \"jobType\" IN $TYPES AND \"createdAt\" >= to_timestamp($MARK) GROUP BY 1) s;")
  OTHER=$(pg "SELECT COALESCE(string_agg(t || ':' || c::text, ' '),'none') FROM (SELECT \"jobType\" t, COUNT(*) c FROM sync_jobs WHERE \"connectionId\"='$CONN' AND \"jobType\" NOT IN ('master.inventory.syncAll','master.inventory.syncByExternalId','master.inventory.syncFromSweep','master.inventory.syncBatch') AND \"createdAt\" >= to_timestamp($MARK) GROUP BY 1) s;")

  docker logs --since "$MARK" "$PS_CONTAINER" > "$OUT/$LABEL.access.log" 2>&1

  {
    echo "label=$LABEL"
    echo "elapsed_seconds=$ELAPSED"
    echo "jobs_created=$((JOBS_AFTER - JOBS_BEFORE))"
    echo "attempts_delta=$((ATT_AFTER - ATT_BEFORE))"
    echo "products_covered=$COVERED"
    echo "child_jobs=$CHILDREN"
    echo "contaminating_jobs=$OTHER"
    echo
    python3 "$(dirname "$0")/analyze-log.py" < "$OUT/$LABEL.access.log"
  } | tee "$OUT/$LABEL.summary.txt"
  date +%T
done
