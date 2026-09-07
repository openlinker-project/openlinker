#!/usr/bin/env bash
# Chains the remaining #2840 retest phases so they run back to back without a
# human (or an agent) sitting on the wall clock between them.
#
# The ORDER is not arbitrary:
#
#   1. the latency RAMP runs with no measurement window open, because it drives
#      the shop to 24 req/s and would destroy any throughput figure it
#      overlapped;
#   2. run 2 (arm BD, latency probe overlapping each window) needs the stand
#      lock, so it cannot start until run 1's exit trap has released it;
#   3. run 3 (3 replicas) recreates the worker service, so it must be last -
#      it is the phase that leaves the stand's posture changed, and it restores
#      the replica count itself.
#
# Every phase's own script takes the stand lock through `guard_stand_exclusive`;
# this wrapper only sequences them.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN1_PID="${RUN1_PID:-}"

# From the generated `stand-ids.env`, never hard-coded (see run-retest.sh).
STAND_IDS="${STAND_IDS_FILE:-$SCRIPT_DIR/stand-ids.env}"
[ -f "$STAND_IDS" ] || { echo "run-retest-chain.sh: stand ids not found at $STAND_IDS" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$STAND_IDS"
set +a
: "${PS_WEBSERVICE_KEY:?run-retest-chain.sh: PS_WEBSERVICE_KEY missing from $STAND_IDS}"
export PS_WEBSERVICE_KEY

log() { printf '[chain] %s %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }

if [ -n "$RUN1_PID" ]; then
  log "waiting for run 1 (pid $RUN1_PID) to exit"
  while kill -0 "$RUN1_PID" 2>/dev/null; do sleep 20; done
  log "run 1 exited"
fi

# The lock is released by run 1's exit trap, which runs after the process is
# gone from `kill -0`'s point of view on some shells, so it is WAITED for
# rather than assumed. A stale lock would otherwise abort phase 2 immediately.
log "waiting for the stand lock to clear"
for _ in $(seq 1 60); do
  holder="$(docker exec lab-redis redis-cli GET perf:stand:exclusive 2>/dev/null | tr -d '\r')"
  [ -n "$holder" ] || break
  sleep 5
done
log "stand lock: ${holder:-<free>}"

log "=== phase 1: latency ramp (no window open) ==="
"$SCRIPT_DIR/probes/ps-latency-ramp.sh" /tmp/latency-ramp 2>&1 | tail -80 || log "ramp exited non-zero"

log "=== phase 2: run 2 - arm BD x2 with the latency probe overlapping ==="
"$SCRIPT_DIR/run-retest-2.sh" || log "run 2 exited non-zero"

log "=== phase 3: run 3 - 3 replicas, arms D3 and BD3 ==="
"$SCRIPT_DIR/run-retest-3.sh" || log "run 3 exited non-zero"

log "=== chain complete ==="
