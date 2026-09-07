#!/usr/bin/env bash
#
# ps-latency-ramp.sh - how PrestaShop's own response time moves with the
# request rate OpenLinker offers it (#2840).
#
# WHY A RAMP AND NOT ONE MEASUREMENT
#
# F1 measured the shop answering create-path calls in 11-20 ms and concluded
# the shop is responsible for almost none of the order latency. That was taken
# at roughly ONE request per second. The limiter A/B then sustained ~385
# requests/minute (~6.4/s) at `requestsPerMinute: 600`, and the honest position
# is that nobody has checked the shop at that rate - so "raise the limit" is a
# recommendation with an unmeasured ceiling behind it.
#
# A single loaded measurement cannot answer "how far may it be raised": a flat
# reading at 6.4/s says the shop tolerated 6.4/s and nothing about 15/s. A ramp
# finds the KNEE, which is the number an operator needs.
#
# THE RAMP IS NOT THE WHOLE ANSWER, AND SAYS SO
#
# Two limits, both stated in the report rather than left for a reader to infer:
#
#   * It is GET-only (`ps-latency-probe.mjs` explains why - the create path's
#     POSTs mint real rows), so it under-represents a write-heavy create path.
#     A flat curve here is necessary, not sufficient.
#   * It drives the shop DIRECTLY, so it measures the shop's own capacity, not
#     what OpenLinker can extract from it. The companion measurement - the
#     probe running DURING a real arm BD window - is what ties the curve to
#     OpenLinker's actual traffic.
#
# A DRIFT CONTROL, FOR THE SAME REASON THE THROUGHPUT ARMS HAVE ONE
#
# The lowest rate is repeated LAST. If the shop answers at the ramp's end the
# way it did at the start, the ramp measured rate and not cumulative damage
# (a warmed opcache, a filled MySQL buffer pool, or a shop left degraded by the
# highest step would all show up here). Without it a rising curve cannot be
# told from a shop that simply got slower as the run went on.
#
# Usage:
#   ps-latency-ramp.sh <outdir> [rates...]     # default rates below
#
set -euo pipefail

OUTDIR="${1:?usage: ps-latency-ramp.sh <outdir> [rates...]}"
shift || true

# Default ladder. 6.4/s is not a round number on purpose - it is the rate arm
# BD was MEASURED to sustain (382.8-388.7 requests/min), so one step of this
# ramp sits exactly where the question is asked. The steps above it are what
# turn "the shop survived 10x" into "and here is where it stops surviving".
RATES=("$@")
if [ "${#RATES[@]}" -eq 0 ]; then
  RATES=(0.5 1 2 4 6.4 10 16 24)
fi

STEP_SECS="${STEP_SECS:-60}"
SETTLE_SECS="${SETTLE_SECS:-20}"
PS_BASE_URL="${PS_BASE_URL:-http://prestashop}"
PS_NETWORK="${PS_NETWORK:-lab_default}"
NODE_IMAGE="${NODE_IMAGE:-node:20-alpine}"
: "${PS_WEBSERVICE_KEY:?ps-latency-ramp.sh: PS_WEBSERVICE_KEY required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRIVERS_DIR="$(cd "$SCRIPT_DIR/../drivers" && pwd)"

mkdir -p "$OUTDIR"
log() { printf '[ramp] %s\n' "$*" >&2; }

run_step() {
  local label="$1" rate="$2"
  log "step $label: offering ${rate} req/s for ${STEP_SECS}s"
  docker run --rm --network "$PS_NETWORK" \
    -v "$DRIVERS_DIR:/d:ro" \
    -e PS_BASE_URL="$PS_BASE_URL" \
    -e PS_WS_KEY="$PS_WEBSERVICE_KEY" \
    -e DURATION_SECS="$STEP_SECS" \
    -e TARGET_RPS="$rate" \
    -e LABEL="$label" \
    "$NODE_IMAGE" node /d/ps-latency-probe.mjs \
    >"$OUTDIR/step-$label.csv" 2>"$OUTDIR/step-$label.summary"
  sed 's/^/  /' "$OUTDIR/step-$label.summary" >&2
}

for rate in "${RATES[@]}"; do
  run_step "rate-$rate" "$rate"
  log "settling ${SETTLE_SECS}s"
  sleep "$SETTLE_SECS"
done

# The drift control: the FIRST rate again, last.
run_step "drift-${RATES[0]}" "${RATES[0]}"

log "wrote $(ls -1 "$OUTDIR"/step-*.csv | wc -l) step file(s) under $OUTDIR"
