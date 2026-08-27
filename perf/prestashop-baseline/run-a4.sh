#!/usr/bin/env bash
# A4 — what one order costs the shop, and how that scales with line count.
#
# Counts EVERY request the order produces, including the OL module's own front
# controllers, which do not live under /api/ and are therefore invisible to the
# catalogue analyser.
#
# Usage: ./run-a4.sh <internalOrderId> <label>
set -euo pipefail

ORDER="${1:?internal order id required}"
LABEL="${2:-a4}"
API="${API:-http://localhost:3000}"
CONN="${CONNECTION_ID:-44bb1f3f-17ae-4038-ab48-413ce54a71c7}"
PS_CONTAINER="${PS_CONTAINER:-ol-demo-fresh-prestashop}"
PG="${PG_CONTAINER:-ol-demo-fresh-postgres}"
OUT="${OUT:-./results}"
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

# A clean window: nothing else of this connection's may run alongside.
purge_queue

MARK=$(date +%s)   # epoch: a bare timestamp is read as the DAEMON local time, not UTC
START=$(date +%s)
TOKEN=$(token)
curl -s -X POST "$API/v1/orders/$ORDER/destinations/$CONN/retry" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}' \
  -o "$OUT/$LABEL.retry.json" -w "retry_http=%{http_code}\n"

# Wait for the order to leave 'pending' - the record, not the job, is the signal.
#
# The status starts as the literal '[]' that make-8line-order.sh writes, and a
# wrong order id returns no row at all. Both used to be misread: a plain
# `grep -qv pending` succeeded on '[]' and exited the wait immediately, and on
# an empty result it returned 1 and the loop span forever. So test the value
# explicitly and bound the wait.
WAIT_SECS="${WAIT_SECS:-900}"
deadline=$(( $(date +%s) + WAIT_SECS ))
while :; do
  status=$(pg "SELECT left(\"syncStatus\"::text,200) FROM order_records WHERE \"internalOrderId\"='$ORDER';")
  if [ -z "$status" ]; then
    echo "FATAL: no order_records row for internalOrderId=$ORDER" >&2; exit 1
  fi
  # Not started yet ('[]') or still pending: keep waiting.
  case "$status" in
    '[]'|'') : ;;
    *pending*) : ;;
    *) break ;;
  esac
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "FATAL: order $ORDER still not dispatched after ${WAIT_SECS}s (syncStatus=$status)" >&2
    exit 1
  fi
  sleep 4
done
while [ "$(pg "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$CONN' AND status IN ('queued','running');")" != "0" ]; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "FATAL: connection queue did not drain within ${WAIT_SECS}s" >&2; exit 1
  fi
  sleep 4
done
ELAPSED=$(( $(date +%s) - START ))

docker logs --since "$MARK" "$PS_CONTAINER" > "$OUT/$LABEL.access.log" 2>&1

{
  echo "label=$LABEL order=$ORDER"
  echo "elapsed_seconds=$ELAPSED"
  echo "lines=$(pg "SELECT jsonb_array_length(\"orderSnapshot\"->'items') FROM order_records WHERE \"internalOrderId\"='$ORDER';")"
  echo "outcome=$(pg "SELECT left(\"syncStatus\"::text,300) FROM order_records WHERE \"internalOrderId\"='$ORDER';")"
  echo
  echo "-- every request in the window, module front controllers included --"
  grep -v '127.0.0.1' "$OUT/$LABEL.access.log" \
    | grep -oE '"(GET|POST|PUT|DELETE) [^ ]+' | sed 's/^"//' \
    | sed -E 's#\?fc=module&module=openlinker&controller=([a-z]+).*#[module:\1]#' \
    | sed -E 's#\?.*##' | sed -E 's#/[0-9]+$#/<id>#' \
    | sort | uniq -c | sort -rn
} | tee "$OUT/$LABEL.summary.txt"
