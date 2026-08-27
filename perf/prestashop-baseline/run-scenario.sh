#!/usr/bin/env bash
# Run one OpenLinker sync job against PrestaShop and measure what it cost
# the shop, counted from PrestaShop's own Apache access log (which this
# image writes to stdout, hence `docker logs`).
#
# Usage: ./run-scenario.sh <jobType> [label]
#   e.g. ./run-scenario.sh master.product.syncAll run1
set -euo pipefail

JOB_TYPE="${1:?job type required}"
LABEL="${2:-$(date +%H%M%S)}"

API="${API:-http://localhost:3000}"
PS_CONTAINER="${PS_CONTAINER:-ol-demo-fresh-prestashop}"
PG_CONTAINER="${PG_CONTAINER:-ol-demo-fresh-postgres}"
CONNECTION_ID="${CONNECTION_ID:-44bb1f3f-17ae-4038-ab48-413ce54a71c7}"
OUT="${OUT:-./results}"
IDLE_TICKS="${IDLE_TICKS:-6}"   # consecutive quiet polls before we call it done
POLL_SECS="${POLL_SECS:-5}"

mkdir -p "$OUT"

token() {
  curl -s -X POST "$API/v1/auth/login" -H 'content-type: application/json' \
    -d '{"username":"admin","password":"admin"}' \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("access_token") or d.get("accessToken") or "")'
}

pg() { docker exec -i "$PG_CONTAINER" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<< "$1"; }

TOKEN=$(token)
[ -n "$TOKEN" ] || { echo "FATAL: login failed" >&2; exit 1; }

# sync_jobs attempt total before the run: a rise beyond one attempt per job
# means the run was polluted by retries and must be repeated.
ATTEMPTS_BEFORE=$(pg "SELECT COALESCE(SUM(attempts),0) FROM sync_jobs WHERE \"connectionId\"='$CONNECTION_ID';")
JOBS_BEFORE=$(pg "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$CONNECTION_ID';")

START_TS=$(date +%s)   # epoch: a bare timestamp is read as the DAEMON local time, not UTC
START_EPOCH=$(date +%s)

curl -s -X POST "$API/v1/sync/jobs" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"jobType\":\"$JOB_TYPE\",\"connectionId\":\"$CONNECTION_ID\",\"payload\":{},\"idempotencyKey\":\"perfbase:$LABEL:$(date +%s)\"}" \
  -o "$OUT/$LABEL.enqueue.json" -w 'enqueue_http=%{http_code}\n'

echo "waiting for the queue to drain (quiet for $((IDLE_TICKS*POLL_SECS))s)..."
quiet=0
while [ "$quiet" -lt "$IDLE_TICKS" ]; do
  sleep "$POLL_SECS"
  inflight=$(pg "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$CONNECTION_ID' AND status IN ('queued','running');")
  if [ "$inflight" = "0" ]; then quiet=$((quiet+1)); else quiet=0; fi
  printf '  inflight=%s quiet=%s\n' "$inflight" "$quiet"
done

END_EPOCH=$(date +%s)
ELAPSED=$((END_EPOCH - START_EPOCH - IDLE_TICKS*POLL_SECS))

ATTEMPTS_AFTER=$(pg "SELECT COALESCE(SUM(attempts),0) FROM sync_jobs WHERE \"connectionId\"='$CONNECTION_ID';")
JOBS_AFTER=$(pg "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$CONNECTION_ID';")

docker logs --since "$START_TS" "$PS_CONTAINER" > "$OUT/$LABEL.access.log" 2>&1

{
  echo "scenario=$JOB_TYPE label=$LABEL"
  echo "elapsed_seconds=$ELAPSED"
  echo "jobs_created=$((JOBS_AFTER - JOBS_BEFORE))"
  echo "attempts_delta=$((ATTEMPTS_AFTER - ATTEMPTS_BEFORE))"
  echo
  python3 ./analyze-log.py < "$OUT/$LABEL.access.log"
} | tee "$OUT/$LABEL.summary.txt"
