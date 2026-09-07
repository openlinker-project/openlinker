#!/usr/bin/env bash
# Run 3 of the #2840 clean-window retest: does adding worker replicas raise
# throughput once the limiter's Redis client is unshared?
#
# WHY THE ANSWER IS NOT OBVIOUS, AND WHAT EACH ARM DECIDES
#
# The limiter's registry is Redis-backed and shared cross-process since #2015,
# and `libs/plugin-sdk/src/rate-limit.module.ts:78` builds the transport with
# no `replicas` argument ON PURPOSE - the module's own header says the old
# static cap-division "is gone", because dividing an already-shared cap would
# only shrink the operator's configured rate. So the DESIGN intent is that N
# replicas share ONE per-connection bucket and the fleet never exceeds the
# configured rate.
#
# The prior campaign measured 3 replicas pushing 158 req/min against a 60/min
# limit (F7, itself DISCARDED). If the shared bucket held, that is impossible.
# The available explanation is the degradation: when the pace `EVAL` times out,
# each process falls back to its OWN per-process in-memory limiter
# (`redis-rate-limiter.adapter.ts:355-359`), so three replicas become three
# independent 60/min buckets. That predicts the breach DISAPPEARS once the
# client is unshared - and predicts scaling then buys little at a fixed rate
# limit, because the fleet is back to sharing one bucket.
#
#   D3  (60 req/min, 3 replicas)  - decides the SAFETY question: does the fleet
#                                    still exceed the shop's configured limit?
#   BD3 (600 req/min, 3 replicas) - decides the THROUGHPUT question: at a limit
#                                    the bucket is not saturating, do more
#                                    replicas extract more of it?
#
# Both are the shipped realtime lane (4/2). Lane caps are PER PROCESS, so three
# replicas triple the available slots without any lane change - which is part of
# what BD3 measures.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPLICAS="${REPLICAS:-3}"
LOG="${LOG:-/tmp/run3.log}"
OUT="${OUT:-/tmp/latency-during-3}"
PROBE_RPS="${PROBE_RPS:-0.5}"

# The stand's compose project is DISCOVERED from the running worker's own
# compose labels, never assumed to be this checkout. The worker service carries
# a relative bind mount to a generated, untracked TLS certificate, and from the
# wrong directory compose creates a DIRECTORY where the certificate should be
# and recreates the worker against the wrong database - silently, both times.
STAND_DIR="${STAND_DIR:-$(docker inspect "$(docker ps --filter 'label=com.docker.compose.project=lab' \
  --filter 'label=com.docker.compose.service=worker' --format '{{.Names}}' | head -n1)" \
  --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')}"
[ -n "$STAND_DIR" ] && [ -d "$STAND_DIR" ] || {
  echo "run-retest-3.sh: could not discover the stand's compose working dir; set STAND_DIR" >&2; exit 1; }
echo "[run3] stand dir: $STAND_DIR"

STAND_IDS="${STAND_IDS_FILE:-$SCRIPT_DIR/stand-ids.env}"
[ -f "$STAND_IDS" ] || { echo "run-retest-3.sh: stand ids not found at $STAND_IDS" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$STAND_IDS"
set +a
: "${PS_WEBSERVICE_KEY:?run-retest-3.sh: PS_WEBSERVICE_KEY missing from $STAND_IDS}"
export PS_WEBSERVICE_KEY

mkdir -p "$OUT"
: > "$LOG"

# The compose project is entered by `cd`, and the env file is passed
# explicitly. Both are load-bearing: the worker service carries a RELATIVE bind
# mount to a generated, untracked TLS certificate, and from the wrong directory
# compose creates a DIRECTORY where the certificate should be and recreates the
# worker against the wrong database - silently, both times.
echo "[run3] scaling worker to $REPLICAS replica(s)"
( cd "$STAND_DIR" && docker compose -f docker-compose.lab.yml --env-file .env.lab -p lab \
    up -d --no-deps --scale "worker=$REPLICAS" worker )

# Read the replica count BACK rather than trusting the request.
found="$(docker ps --filter 'label=com.docker.compose.project=lab' \
                   --filter 'label=com.docker.compose.service=worker' \
                   --format '{{.Names}}' | wc -l | tr -d ' ')"
[ "$found" -eq "$REPLICAS" ] || { echo "[run3] expected $REPLICAS worker(s), found $found" >&2; exit 1; }
echo "[run3] workers: $(docker ps --filter 'label=com.docker.compose.project=lab' --filter 'label=com.docker.compose.service=worker' --format '{{.Names}}' | tr '\n' ' ')"

"$SCRIPT_DIR/probes/ps-latency-during-window.sh" "$LOG" "$OUT" "$PROBE_RPS" 300 \
  > "$OUT/watcher.log" 2>&1 &
WATCHER=$!
trap 'kill "$WATCHER" 2>/dev/null || true; pkill -P "$WATCHER" 2>/dev/null || true' EXIT

# WORKER_CONTAINERS is left UNSET so lib.sh discovers all three; naming one
# would make every per-worker guard (the degradation count included) inspect a
# third of the fleet and report a third of the truth.
REPEATS=2 ARM_SPECS="" DRIFT_CONTROL="" \
  RECREATE_ARM_SPECS="D3:60:4:::true BD3:600:4:::true" \
  WORKER_CONTAINERS="" \
  "$SCRIPT_DIR/run-retest.sh" limiter-ab.sh >> "$LOG" 2>&1 || echo "[run3] scenario exited non-zero" >&2

echo "[run3] scaling worker back to 1"
( cd "$STAND_DIR" && docker compose -f docker-compose.lab.yml --env-file .env.lab -p lab \
    up -d --no-deps --scale worker=1 worker )
echo "[run3] done - scenario log $LOG, probe output under $OUT"
