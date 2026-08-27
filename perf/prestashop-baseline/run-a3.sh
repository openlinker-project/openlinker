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
# Usage: ./run-a1a.sh [runs]   (default 3; run 1 is the cold run, discarded)
set -euo pipefail

RUNS="${1:-3}"
API="${API:-http://localhost:3000}"
CONN="${CONNECTION_ID:-44bb1f3f-17ae-4038-ab48-413ce54a71c7}"
PS_CONTAINER="${PS_CONTAINER:-ol-demo-fresh-prestashop}"
PG="${PG_CONTAINER:-ol-demo-fresh-postgres}"
OUT="${OUT:-./results}"
CURSOR="master.inventory.sweep:connection:${CONN}"
mkdir -p "$OUT"

pg() { docker exec -i "$PG" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<< "$1"; }
token() {
  curl -s -X POST "$API/v1/auth/login" -H 'content-type: application/json' \
    -d "{\"username\":\"${OL_ADMIN_USER:-admin}\",\"password\":\"${OL_ADMIN_PASSWORD:-admin}\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("access_token") or d.get("accessToken") or "")'
}

for i in $(seq 1 "$RUNS"); do
  LABEL="${LABEL_PREFIX:-}a3-run$i"
  echo "=================== $LABEL ==================="
  date +%T

  # Clean slate: no leftover children, and a cycle that starts at offset 0.
  pg "DELETE FROM sync_jobs WHERE \"connectionId\"='$CONN' AND status IN ('queued','running','dead');" >/dev/null
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
  CHILDREN=$(pg "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$CONN' AND \"jobType\"='master.inventory.syncByExternalId' AND \"createdAt\" >= now() - interval '90 minutes';")
  OTHER=$(pg "SELECT COALESCE(string_agg(t || ':' || c::text, ' '),'none') FROM (SELECT \"jobType\" t, COUNT(*) c FROM sync_jobs WHERE \"connectionId\"='$CONN' AND \"jobType\" NOT IN ('master.inventory.syncAll','master.inventory.syncByExternalId') AND \"createdAt\" >= now() - interval '90 minutes' GROUP BY 1) s;")

  docker logs --since "$MARK" "$PS_CONTAINER" > "$OUT/$LABEL.access.log" 2>&1

  {
    echo "label=$LABEL"
    echo "elapsed_seconds=$ELAPSED"
    echo "jobs_created=$((JOBS_AFTER - JOBS_BEFORE))"
    echo "attempts_delta=$((ATT_AFTER - ATT_BEFORE))"
    echo "stock_children=$CHILDREN"
    echo "contaminating_jobs=$OTHER"
    echo
    python3 ./analyze-log.py < "$OUT/$LABEL.access.log"
  } | tee "$OUT/$LABEL.summary.txt"
  date +%T
done
