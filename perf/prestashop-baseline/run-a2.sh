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
# into a measured window; override WORKER_CONTAINER to point at it. The
# fallback below is the stock all-roles worker, which does NOT reproduce the
# campaign's conditions - see the README.

SECS="${PHASE_SECS:-180}"
API="${API:-http://localhost:3000}"
CONN="${CONNECTION_ID:-44bb1f3f-17ae-4038-ab48-413ce54a71c7}"
PG="${PG_CONTAINER:-ol-demo-fresh-postgres}"
WORKER="${WORKER_CONTAINER:-ol-demo-fresh-worker}"
OUT="${OUT:-./results}"
API_WAIT_SECS="${API_WAIT_SECS:-180}"    # how long to wait for the api to answer
INFLIGHT_WAIT_SECS="${INFLIGHT_WAIT_SECS:-300}"  # how long to wait for real load
INFLIGHT_MIN="${INFLIGHT_MIN:-10}"       # in-flight children that count as load
mkdir -p "$OUT"

# The worker is stopped below. Restore it on ANY exit, including a failure in
# the probe, the login or the enqueue - leaving the stack with a dead worker and
# no message is worse than a failed measurement.
worker_started=1
restore_worker() {
  if [ "$worker_started" = "0" ]; then
    echo "restoring worker container $WORKER" >&2
    docker start "$WORKER" >/dev/null 2>&1 || \
      echo "WARNING: could not restart $WORKER - start it by hand" >&2
  fi
}
trap restore_worker EXIT

stop_worker() { docker stop "$WORKER" >/dev/null; worker_started=0; }
start_worker() { docker start "$WORKER" >/dev/null; worker_started=1; }

pg() { docker exec -i "$PG" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<< "$1"; }
token() {
  curl -s -X POST "$API/v1/auth/login" -H 'content-type: application/json' \
    -d "{\"username\":\"${OL_ADMIN_USER:-admin}\",\"password\":\"${OL_ADMIN_PASSWORD:-admin}\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("access_token") or d.get("accessToken") or "")'
}

# Purging is destructive: it deletes real pending work if CONNECTION_ID points
# at a live connection. Print what is about to go and require an explicit
# opt-in.
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

echo "== phase A1: idle (worker stopped) =="
stop_worker
./storefront-probe.sh "$SECS" "${LABEL_PREFIX:-}A2-idle1" > "$OUT/${LABEL_PREFIX:-}a2-idle1.txt"
cat "$OUT/${LABEL_PREFIX:-}a2-idle1.txt"

echo "== phase B: sweep running =="
start_worker
# Give the worker time to boot before enqueueing, then wait for real load.
deadline=$(( $(date +%s) + API_WAIT_SECS ))
until curl -s -o /dev/null -m 3 "$API/v1/health"; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "FATAL: api at $API did not answer within ${API_WAIT_SECS}s" >&2; exit 1
  fi
  sleep 3
done
sleep 20
purge_queue
pg "DELETE FROM connection_cursors WHERE \"connectionId\"='$CONN' AND \"cursorKey\"='master.product.sweep:connection:$CONN';" >/dev/null
TOKEN=$(token)
[ -n "$TOKEN" ] || { echo "FATAL: login failed" >&2; exit 1; }
curl -s -X POST "$API/v1/sync/jobs" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"jobType\":\"master.product.syncAll\",\"connectionId\":\"$CONN\",\"payload\":{},\"idempotencyKey\":\"a2:$(date +%s)\"}" \
  -o /dev/null -w 'enqueue_http=%{http_code}\n'
# Wait until the fan-out is actually in flight, so phase B measures load. On a
# store with fewer syncable products than INFLIGHT_MIN this threshold is never
# reached, so the wait is bounded and says so rather than hanging forever.
deadline=$(( $(date +%s) + INFLIGHT_WAIT_SECS ))
while :; do
  inflight=$(pg "SELECT COUNT(*) FROM sync_jobs WHERE \"connectionId\"='$CONN' AND \"jobType\"='master.product.syncByExternalId' AND status IN ('queued','running');")
  [ "$inflight" -gt "$INFLIGHT_MIN" ] && break
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "FATAL: only $inflight in-flight children after ${INFLIGHT_WAIT_SECS}s," >&2
    echo "       threshold is >${INFLIGHT_MIN}. Phase B would not measure load." >&2
    echo "       Either the catalogue is too small or the worker is not draining." >&2
    exit 1
  fi
  sleep 5
done
./storefront-probe.sh "$SECS" "${LABEL_PREFIX:-}A2-load" > "$OUT/${LABEL_PREFIX:-}a2-load.txt"
cat "$OUT/${LABEL_PREFIX:-}a2-load.txt"

echo "== phase A2: idle again (worker stopped) =="
stop_worker
./storefront-probe.sh "$SECS" "${LABEL_PREFIX:-}A2-idle2" > "$OUT/${LABEL_PREFIX:-}a2-idle2.txt"
cat "$OUT/${LABEL_PREFIX:-}a2-idle2.txt"
start_worker

echo "== ratio =="
python3 - "$OUT" "${LABEL_PREFIX:-}" <<'PY'
import sys, pathlib
out = pathlib.Path(sys.argv[1])
prefix = sys.argv[2] if len(sys.argv) > 2 else ''
def samples(label):
    """2xx samples only, matching storefront-probe.sh. A window that recorded
    any non-2xx is not a latency measurement and is refused here too."""
    ok, bad = [], 0
    for raw in open(f'/tmp/probe.{label}'):
        parts = raw.split()
        if len(parts) != 2:
            continue
        code, secs = parts
        if code.startswith('2'):
            ok.append(float(secs))
        else:
            bad += 1
    if bad:
        raise SystemExit(f'FATAL: {label} recorded {bad} non-2xx samples; '
                         'the ratio would be meaningless')
    if not ok:
        raise SystemExit(f'FATAL: {label} recorded no successful samples')
    return sorted(ok)
def p95(label):
    vals = samples(label)
    return vals[min(len(vals)-1, int(round(0.95*len(vals)))-1)]
a = (p95(f'{prefix}A2-idle1') + p95(f'{prefix}A2-idle2')) / 2
b = p95(f'{prefix}A2-load')
line = (f'p95_idle_mean={a:.4f}s p95_under_sweep={b:.4f}s '
        f'RATIO_B_over_A={b/a:.3f}')
print(line)
(out / f'{prefix}a2-ratio.txt').write_text(line + '\n')
PY
