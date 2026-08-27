#!/usr/bin/env bash
# A2 — does synchronisation slow the storefront down?
#
# Three phases: idle, sweep running, idle. The storefront is driven at 2 req/s
# over localhost only (never a tunnel or VPN, which would measure the tunnel).
#
# The RESULT IS THE RATIO p95(B) / p95(A). The absolute p95 is a property of
# this machine and is comparable with nothing.
#
# Lane caps and the connection's rate limit stay at their defaults here,
# because concurrency is the very thing under test.
set -euo pipefail

# The worker container to pause for the idle phases. The campaign ran a
# scheduler-free `OL_WORKER_ROLE=jobs` container so no cron tick could enqueue
# into a measured window; override this to point at it.

SECS="${PHASE_SECS:-180}"
API="${API:-http://localhost:3000}"
CONN="${CONNECTION_ID:-44bb1f3f-17ae-4038-ab48-413ce54a71c7}"
PG="${PG_CONTAINER:-ol-demo-fresh-postgres}"
OUT="${OUT:-./results}"
mkdir -p "$OUT"

pg() { docker exec -i "$PG" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<< "$1"; }
token() {
  curl -s -X POST "$API/v1/auth/login" -H 'content-type: application/json' \
    -d '{"username":"admin","password":"admin"}' \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("access_token") or d.get("accessToken") or "")'
}

echo "== phase A1: idle (worker stopped) =="
docker stop "${WORKER_CONTAINER:-ol-demo-fresh-worker}" >/dev/null
./storefront-probe.sh "$SECS" ${LABEL_PREFIX:-}A2-idle1 | tee "$OUT/${LABEL_PREFIX:-}a2-idle1.txt"

echo "== phase B: sweep running =="
docker start "${WORKER_CONTAINER:-ol-demo-fresh-worker}" >/dev/null
# Give the worker time to boot before enqueueing, then wait for real load.
until curl -s -o /dev/null -m 3 "$API/v1/health"; do sleep 3; done
sleep 20
pg "DELETE FROM sync_jobs WHERE \"connectionId\"='$CONN' AND status IN ('queued','running','dead');" >/dev/null
pg "DELETE FROM connection_cursors WHERE \"connectionId\"='$CONN' AND \"cursorKey\"='master.product.sweep:connection:$CONN';" >/dev/null
TOKEN=$(token)
curl -s -X POST "$API/v1/sync/jobs" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"jobType\":\"master.product.syncAll\",\"connectionId\":\"$CONN\",\"payload\":{},\"idempotencyKey\":\"a2:$(date +%s)\"}" \
  -o /dev/null -w 'enqueue_http=%{http_code}\n'
# Wait until the fan-out is actually in flight, so phase B measures load.
until [ "$(pg "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$CONN' AND \"jobType\"='master.product.syncByExternalId' AND status IN ('queued','running');")" -gt 10 ]; do sleep 5; done
./storefront-probe.sh "$SECS" ${LABEL_PREFIX:-}A2-load | tee "$OUT/${LABEL_PREFIX:-}a2-load.txt"

echo "== phase A2: idle again (worker stopped) =="
docker stop "${WORKER_CONTAINER:-ol-demo-fresh-worker}" >/dev/null
./storefront-probe.sh "$SECS" ${LABEL_PREFIX:-}A2-idle2 | tee "$OUT/${LABEL_PREFIX:-}a2-idle2.txt"
docker start "${WORKER_CONTAINER:-ol-demo-fresh-worker}" >/dev/null

echo "== ratio =="
python3 - "$OUT" "${LABEL_PREFIX:-}" <<'PY'
import sys, re, statistics, pathlib
out = pathlib.Path(sys.argv[1])
prefix = sys.argv[2] if len(sys.argv) > 2 else ''
def p95(label):
    vals = sorted(float(x) for x in open(f'/tmp/probe.{label}') if x.strip())
    return vals[min(len(vals)-1, int(round(0.95*len(vals)))-1)]
a = (p95(f'{prefix}A2-idle1') + p95(f'{prefix}A2-idle2')) / 2
b = p95(f'{prefix}A2-load')
line = (f'p95_idle_mean={a:.4f}s p95_under_sweep={b:.4f}s '
        f'RATIO_B_over_A={b/a:.3f}')
print(line)
(out / f'{prefix}a2-ratio.txt').write_text(line + '\n')
PY
