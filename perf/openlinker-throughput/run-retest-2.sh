#!/usr/bin/env bash
# Run 2 of the #2840 clean-window retest: arm BD only, with the PrestaShop
# latency probe overlapping each window.
#
# Arm A is deliberately NOT in this run. At 0.5 req/s the probe adds ~150
# requests to a 300 s window - a few per cent of arm BD's own ~1 900, but most
# of the way to arm A's ~200. Arm A's throughput baseline is measured in run 1
# with no probe at all so it stays comparable to the prior campaign's arm A.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="${LOG:-/tmp/run2.log}"
OUT="${OUT:-/tmp/latency-during}"
PROBE_RPS="${PROBE_RPS:-0.5}"

# The probe needs the shop's webservice key. Read from the generated
# `stand-ids.env`, never hard-coded - it is a stand credential and it changes
# on every re-bootstrap.
STAND_IDS="${STAND_IDS_FILE:-$SCRIPT_DIR/stand-ids.env}"
[ -f "$STAND_IDS" ] || { echo "run-retest-2.sh: stand ids not found at $STAND_IDS" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$STAND_IDS"
set +a
: "${PS_WEBSERVICE_KEY:?run-retest-2.sh: PS_WEBSERVICE_KEY missing from $STAND_IDS}"
export PS_WEBSERVICE_KEY

mkdir -p "$OUT"
: > "$LOG"

"$SCRIPT_DIR/probes/ps-latency-during-window.sh" "$LOG" "$OUT" "$PROBE_RPS" 300 \
  > "$OUT/watcher.log" 2>&1 &
WATCHER=$!
# The watcher's own `tail -F` child outlives a plain kill of the pipeline head,
# so its children are signalled too rather than left tailing a finished run.
trap 'kill "$WATCHER" 2>/dev/null || true; pkill -P "$WATCHER" 2>/dev/null || true' EXIT

REPEATS=2 ARM_SPECS="" DRIFT_CONTROL="" RECREATE_ARM_SPECS="BD:600:4:::true" \
  "$SCRIPT_DIR/run-retest.sh" limiter-ab.sh >> "$LOG" 2>&1

echo "run 2 done - scenario log $LOG, probe output under $OUT"
