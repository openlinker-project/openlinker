#!/usr/bin/env bash
# A1a — cost per SKU for one catalogue sweep tick, repeated.
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
# Usage: ./run-a1a.sh [runs]   (default 3; run 1 is the cold run, discarded)
set -euo pipefail

RUNS="${1:-3}"
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
  LABEL="${LABEL_PREFIX:-}a1a-run$i"
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
    -d "{\"jobType\":\"master.product.syncAll\",\"connectionId\":\"$CONN\",\"payload\":{},\"idempotencyKey\":\"a1a:$i:$(date +%s)\"}" \
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
  # Products COVERED by this tick, which is the per-SKU denominator.
  #
  # Since #2593 the sweep enqueues one `master.product.syncBatch` per page and
  # carries the page's ids in `payloadJson.externalIds`, so counting children
  # would divide by 5 where 500 products were read. A per-product child (the
  # pre-#2593 shape, `master.product.syncFromSweep` since #2594, and the per-id
  # re-enqueue a failed batch item takes) counts as one.
  COVERED=$(pg "SELECT COALESCE(SUM(CASE WHEN \"jobType\"='master.product.syncBatch' THEN jsonb_array_length(\"payloadJson\"->'externalIds') ELSE 1 END),0) FROM sync_jobs WHERE \"connectionId\"='$CONN' AND \"jobType\" IN ('master.product.syncBatch','master.product.syncFromSweep','master.product.syncByExternalId') AND \"createdAt\" >= to_timestamp($MARK);")
  CHILDREN=$(pg "SELECT COALESCE(string_agg(t || ':' || c::text, ' '),'none') FROM (SELECT \"jobType\" t, COUNT(*) c FROM sync_jobs WHERE \"connectionId\"='$CONN' AND \"jobType\" IN ('master.product.syncBatch','master.product.syncFromSweep','master.product.syncByExternalId') AND \"createdAt\" >= to_timestamp($MARK) GROUP BY 1) s;")
  OTHER=$(pg "SELECT COALESCE(string_agg(t || ':' || c::text, ' '),'none') FROM (SELECT \"jobType\" t, COUNT(*) c FROM sync_jobs WHERE \"connectionId\"='$CONN' AND \"jobType\" NOT IN ('master.product.syncAll','master.product.syncByExternalId','master.product.syncBatch','master.product.syncFromSweep') AND \"createdAt\" >= to_timestamp($MARK) GROUP BY 1) s;")

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
