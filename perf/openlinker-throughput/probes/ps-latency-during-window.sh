#!/usr/bin/env bash
#
# ps-latency-during-window.sh <scenario_log> <outdir> [probe_rps] [window_secs]
#
# Watches a running scenario's log and, each time it opens a measurement
# window, samples PrestaShop's own response time FOR THE LENGTH OF THAT WINDOW.
#
# WHY DURING, AND NOT BEFORE OR AFTER
#
# The question is whether the shop still answers in F1's 11-20 ms while
# OpenLinker sustains ten times the shipped request rate against it. A
# measurement taken on an idle shop cannot answer that - the rate is what is
# under test - and one taken afterwards measures a shop that has stopped being
# busy. So the probe has to overlap the window.
#
# WHAT THE OVERLAP COSTS, AND WHY IT IS CORRECTED RATHER THAN IGNORED
#
# The probe's requests land in the same access log the scenario counts to
# derive requests-per-order, and they are real load on the shop. Both
# consequences are handled rather than hoped away:
#
#   * The COUNT is corrected exactly, never estimated. Every probe request
#     carries a fixed unique User-Agent, so `probes/ps-request-mix.sh`
#     subtracts a MEASURED number.
#   * The LOAD is kept small and reported as a share. At the default 0.5 req/s
#     the probe adds ~150 requests to a 300 s window against the ~1 900 arm
#     BD's own traffic produces there - a few per cent. On a SLOW arm those
#     same 150 requests would be a large fraction of the total, which is
#     exactly why this must not be pointed at one: the throughput baseline has
#     to stay uncontaminated. Point it at the raised-rate arm.
#
set -euo pipefail

LOGFILE="${1:?usage: ps-latency-during-window.sh <scenario_log> <outdir> [probe_rps] [window_secs]}"
OUTDIR="${2:?usage: ps-latency-during-window.sh <scenario_log> <outdir> [probe_rps] [window_secs]}"
PROBE_RPS="${3:-0.5}"
WINDOW_SECS="${4:-300}"

PS_BASE_URL="${PS_BASE_URL:-http://prestashop}"
PS_NETWORK="${PS_NETWORK:-lab_default}"
NODE_IMAGE="${NODE_IMAGE:-node:20-alpine}"
: "${PS_WEBSERVICE_KEY:?ps-latency-during-window.sh: PS_WEBSERVICE_KEY required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRIVERS_DIR="$(cd "$SCRIPT_DIR/../drivers" && pwd)"

mkdir -p "$OUTDIR"
log() { printf '[during] %s\n' "$*" >&2; }

log "watching $LOGFILE for window_start (probe ${PROBE_RPS} req/s x ${WINDOW_SECS}s per window)"

# `--line-buffered`, or the match sits in grep's buffer and the probe starts
# after the window it was meant to overlap has already closed.
seen=0
tail -n0 -F "$LOGFILE" 2>/dev/null | grep --line-buffered -F 'window_start at ' | while read -r _line; do
  seen=$((seen + 1))
  label="w$seen"
  log "window $seen opened - starting probe"
  # Deliberately sequential: the scenario's windows never overlap, so a
  # sequential probe cannot miss one, while a backgrounded one would double the
  # probe's own load if a log line were ever seen twice.
  #
  # `</dev/null` is load-bearing. A command inside a `while read` loop that
  # inherits the loop's stdin CONSUMES the pipe it is being fed from, so the
  # loop silently processes one iteration and exits. The campaign has been
  # bitten by exactly this twice with `docker exec -i`, and `docker run` is the
  # same hazard - a probe that runs for the first window and then never fires
  # again reads, from the output, like a scenario that only opened one window.
  docker run --rm --network "$PS_NETWORK" \
    -v "$DRIVERS_DIR:/d:ro" \
    -e PS_BASE_URL="$PS_BASE_URL" \
    -e PS_WS_KEY="$PS_WEBSERVICE_KEY" \
    -e DURATION_SECS="$WINDOW_SECS" \
    -e TARGET_RPS="$PROBE_RPS" \
    -e LABEL="$label" \
    "$NODE_IMAGE" node /d/ps-latency-probe.mjs \
    </dev/null \
    >"$OUTDIR/during-$label.csv" 2>"$OUTDIR/during-$label.summary" || log "window $seen probe FAILED"
  sed 's/^/  /' "$OUTDIR/during-$label.summary" >&2 || true
  log "window $seen probe done"
done
