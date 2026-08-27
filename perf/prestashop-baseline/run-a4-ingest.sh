#!/usr/bin/env bash
# A4 variant - measure what ONE order dispatch costs the destination shop, driven
# by ingesting the order rather than by retrying a failed destination entry.
#
# `run-a4.sh` posts to `/orders/:id/destinations/:conn/retry`, which answers 404
# unless that destination entry is already `failed`. A freshly ingested order
# auto-dispatches through OrderSyncService instead, and that first dispatch IS the
# event worth counting - so this runner marks the window, enqueues the source sync,
# and waits for the destination write to land.
#
# Counts EVERY request, including the OL module's own front controllers, which do
# not live under /api/ and are invisible to analyze-log.py.
#
# Usage: ./run-a4-ingest.sh <sourceConnectionId> <externalOrderId> <label>
set -euo pipefail

SRC_CONN="${1:?source connection id required}"
EXT_ORDER="${2:?external order id required}"
LABEL="${3:-a4-$(date +%H%M%S)}"

API="${API:-http://localhost:3000}"
PS_CONTAINER="${PS_CONTAINER:-ol-demo-fresh-prestashop}"
PG="${PG_CONTAINER:-ol-demo-fresh-postgres}"
DEST_CONN="${CONNECTION_ID:-44bb1f3f-17ae-4038-ab48-413ce54a71c7}"
OUT="${OUT:-./results}"
WAIT_SECS="${WAIT_SECS:-600}"
mkdir -p "$OUT"

pg() { docker exec -i "$PG" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<< "$1"; }
token() {
  curl -s -X POST "$API/v1/auth/login" -H 'content-type: application/json' \
    -d "{\"username\":\"${OL_ADMIN_USER:-admin}\",\"password\":\"${OL_ADMIN_PASSWORD:-admin}\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("access_token") or d.get("accessToken") or "")'
}

TOKEN=$(token); [ -n "$TOKEN" ] || { echo "FATAL: login failed" >&2; exit 1; }

PS_ORDERS_BEFORE=$(docker exec -i ol-demo-fresh-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" prestashop -N -B -e "SELECT COUNT(*) FROM ps_orders;"' 2>/dev/null | tail -1)
ATT_BEFORE=$(pg "SELECT COALESCE(SUM(attempts),0) FROM sync_jobs WHERE \"connectionId\" IN ('$SRC_CONN','$DEST_CONN');")

MARK=$(date +%s)   # epoch: a bare --since is read in the DAEMON's local time

curl -s -X POST "$API/v1/sync/jobs" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"jobType\":\"marketplace.order.sync\",\"connectionId\":\"$SRC_CONN\",\"payload\":{\"schemaVersion\":1,\"externalOrderId\":\"$EXT_ORDER\"},\"idempotencyKey\":\"a4:$LABEL:$(date +%s)\"}" \
  -o "$OUT/$LABEL.enqueue.json" -w "enqueue_http=%{http_code}\n"

echo "waiting for the dispatch to land (<= ${WAIT_SECS}s)..."
deadline=$(( $(date +%s) + WAIT_SECS ))
while :; do
  sleep 5
  inflight=$(pg "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\" IN ('$SRC_CONN','$DEST_CONN') AND status IN ('queued','running');")
  ps_now=$(docker exec -i ol-demo-fresh-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" prestashop -N -B -e "SELECT COUNT(*) FROM ps_orders;"' 2>/dev/null | tail -1)
  if [ "$inflight" = "0" ] && [ "$ps_now" -gt "$PS_ORDERS_BEFORE" ]; then break; fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "FATAL: no new PrestaShop order after ${WAIT_SECS}s (ps_orders $PS_ORDERS_BEFORE -> $ps_now, inflight=$inflight)" >&2
    docker logs --since "$MARK" "$PS_CONTAINER" > "$OUT/$LABEL.access.log" 2>&1
    exit 1
  fi
done

ELAPSED=$(( $(date +%s) - MARK ))
ATT_AFTER=$(pg "SELECT COALESCE(SUM(attempts),0) FROM sync_jobs WHERE \"connectionId\" IN ('$SRC_CONN','$DEST_CONN');")
PS_ORDERS_AFTER=$(docker exec -i ol-demo-fresh-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" prestashop -N -B -e "SELECT COUNT(*) FROM ps_orders;"' 2>/dev/null | tail -1)
NEW_PS_ORDER=$(docker exec -i ol-demo-fresh-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" prestashop -N -B -e "SELECT CONCAT(id_order,\":\",reference) FROM ps_orders ORDER BY id_order DESC LIMIT 1;"' 2>/dev/null | tail -1)

docker logs --since "$MARK" "$PS_CONTAINER" > "$OUT/$LABEL.access.log" 2>&1

{
  echo "label=$LABEL source_connection=$SRC_CONN external_order=$EXT_ORDER"
  echo "elapsed_seconds=$ELAPSED"
  echo "attempts_delta=$((ATT_AFTER - ATT_BEFORE))"
  echo "ps_orders_before=$PS_ORDERS_BEFORE ps_orders_after=$PS_ORDERS_AFTER"
  echo "new_prestashop_order=$NEW_PS_ORDER   # a NEW id proves a create, not a re-attach"
  echo
  echo "-- every request in the window, module front controllers included --"
  grep -v ' 127.0.0.1' "$OUT/$LABEL.access.log" 2>/dev/null \
    | grep -oE '"(GET|POST|PUT|DELETE) [^ ]+' | sed 's/^"//' \
    | sed -E 's/\?.*$//; s#/api/([a-z_]+)/[0-9]+#/api/\1/<id>#' \
    | sort | uniq -c | sort -rn
  echo
  echo -n "total_requests="
  grep -v ' 127.0.0.1' "$OUT/$LABEL.access.log" 2>/dev/null | grep -cE '"(GET|POST|PUT|DELETE) '
  echo -n "statuses="
  grep -v ' 127.0.0.1' "$OUT/$LABEL.access.log" 2>/dev/null \
    | grep -oE '" [0-9]{3} ' | tr -d '" ' | sort | uniq -c | tr '\n' ' '
  echo
} | tee "$OUT/$LABEL.summary.txt"
