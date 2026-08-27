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
    -d '{"username":"admin","password":"admin"}' \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("access_token") or d.get("accessToken") or "")'
}

# A clean window: nothing else of this connection's may run alongside.
pg "DELETE FROM sync_jobs WHERE \"connectionId\"='$CONN' AND status IN ('queued','running','dead');" >/dev/null

MARK=$(date +%s)   # epoch: a bare timestamp is read as the DAEMON local time, not UTC
START=$(date +%s)
TOKEN=$(token)
curl -s -X POST "$API/v1/orders/$ORDER/destinations/$CONN/retry" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}' \
  -o "$OUT/$LABEL.retry.json" -w "retry_http=%{http_code}\n"

# Wait for the order to leave 'pending' — the record, not the job, is the signal.
until pg "SELECT left(\"syncStatus\"::text,20) FROM order_records WHERE \"internalOrderId\"='$ORDER';" | grep -qv pending; do sleep 4; done
until [ "$(pg "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$CONN' AND status IN ('queued','running');")" = "0" ]; do sleep 4; done
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
