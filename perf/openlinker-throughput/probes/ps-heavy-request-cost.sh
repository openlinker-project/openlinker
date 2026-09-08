#!/usr/bin/env bash
#
# ps-heavy-request-cost.sh <outdir> <label> - what ONE catalogue-sweep request
# costs on the shop, at whatever resource profile is currently in force.
#
# WHY THIS EXISTS BESIDE THE RAMP
#
# `drivers/ps-latency-probe.mjs` offers the create path's GET half - eight
# cheap, mostly single-row reads. That is the right mix for "can the shop take
# orders at this rate", and it is the WRONG mix for the biggest consumer of a
# raised rate limit, which is the catalogue and inventory sweeps. Those issue
# `display=full` pages of 100 products: #2593 measured one such page at 1.33 MB
# and roughly a third of a second on an unconstrained shop, against ~11 ms for
# a single-row read. A ramp built from cheap reads therefore says nothing
# directly about the rate at which heavy reads are safe.
#
# Running a full RATE ramp of heavy pages was rejected: at 5 req/s of 1.33 MB
# responses against a quarter-core shop the probe would simply saturate it, and
# "we saturated it" is a fact about the probe's chosen rate, not a bound anyone
# can use. What an operator needs instead is the per-request SERVICE COST at
# each profile, from which the safe rate follows arithmetically - a shop can
# sustain at most 1/service_time requests per second of a given shape, and the
# report can then say plainly whether 5 req/s of catalogue pages is inside or
# outside that, per profile, rather than leaving the heavy path unmeasured.
#
# So this is deliberately SEQUENTIAL and small: N requests one after another,
# no concurrency, no offered rate. It measures cost, not capacity.
#
# It status-checks every sample for the same reason the ramp does - the
# campaign has already withdrawn one figure to an instrument that did not
# (ADR-066 correction 1). A non-200 is counted, reported, and excluded from the
# timing aggregate rather than folded in as a fast sample.
#
# The offsets VARY per request. A repeated identical query would be answered
# increasingly from MySQL's buffer pool and the measurement would drift
# downwards for a reason that has nothing to do with the resource profile.
#
set -euo pipefail

OUTDIR="${1:?usage: ps-heavy-request-cost.sh <outdir> <label>}"
LABEL="${2:?label required}"
SAMPLES="${HEAVY_SAMPLES:-8}"
PAGE="${HEAVY_PAGE_SIZE:-100}"
PS_BASE_URL="${PS_BASE_URL:-http://prestashop}"
PS_NETWORK="${PS_NETWORK:-lab_default}"
CURL_IMAGE="${CURL_IMAGE:-curlimages/curl:8.11.1}"
: "${PS_WEBSERVICE_KEY:?ps-heavy-request-cost.sh: PS_WEBSERVICE_KEY required}"

mkdir -p "$OUTDIR"
OUT="$OUTDIR/heavy-$LABEL.csv"
printf 'label,shape,offset,status,expected,ok,latency_ms,bytes\n' >"$OUT"

log() { printf '[heavy] %s\n' "$*" >&2; }

# The three shapes a catalogue/inventory sweep really issues, read off
# PrestaShop's own access log and the adapter's query builder:
#   ids   - the enumeration `listExternalIds` pages through
#   full  - the batched product prefetch (#2593), the expensive one
#   stock - the batched inventory prefetch (#2648)
# `sort` is explicit on all three because an unsorted offset read has no tiling
# guarantee at all (#2593 property 4 / #2648).
shape_path() {
  local shape="$1" off="$2"
  case "$shape" in
    ids)   printf '/api/products?display=[id]&limit=%s&offset=%s&sort=[id_ASC]' "$PAGE" "$off" ;;
    full)  printf '/api/products?display=full&limit=%s&offset=%s&sort=[id_ASC]' "$PAGE" "$off" ;;
    stock) printf '/api/stock_availables?display=full&limit=%s&offset=%s&sort=[id_ASC]' "$PAGE" "$off" ;;
  esac
}

run_one() {
  local shape="$1" off="$2" path out status ms bytes ok
  path="$(shape_path "$shape" "$off")"
  # `-o /dev/null` would discard the body without measuring it; the sweep pays
  # for those bytes, so they are counted (`size_download`) and the body is
  # still fully drained by curl before `time_total` is reported.
  # Pinned, and pinned to a tag ALREADY PRESENT on this host - a probe that
  # pulls an image mid-measurement spends host bandwidth and CPU inside the
  # window it is measuring.
  # `-g` / --globoff is REQUIRED, not defensive. PrestaShop's webservice syntax
  # puts square brackets in the query string (`display=[id]`, `sort=[id_ASC]`,
  # `filter[id]=[1|2|3]`), and curl treats `[...]` as a glob RANGE - without
  # this every request dies with exit 3 "URL malformed" before a socket is
  # opened. That is how this probe first ran: 18 samples, all status `000`.
  # They were reported as non-ok rather than as fast successes, which is the
  # whole reason every sample carries its status.
  out="$(docker run --rm --network "$PS_NETWORK" "$CURL_IMAGE" \
        -s -g -o /dev/null \
        -u "$PS_WEBSERVICE_KEY:" \
        -H 'Accept: application/xml' \
        -H 'User-Agent: olperf-heavy-cost' \
        -w '%{http_code} %{time_total} %{size_download}' \
        "$PS_BASE_URL$path" 2>/dev/null || printf '000 0 0')"
  status="$(printf '%s' "$out" | awk '{print $1}')"
  ms="$(printf '%s' "$out" | awk '{printf "%.1f", $2*1000}')"
  bytes="$(printf '%s' "$out" | awk '{print $3}')"
  ok=0; [ "$status" = "200" ] && ok=1
  printf '%s,%s,%s,%s,200,%s,%s,%s\n' "$LABEL" "$shape" "$off" "$status" "$ok" "$ms" "$bytes" >>"$OUT"
}

for shape in ids full stock; do
  i=0
  while [ "$i" -lt "$SAMPLES" ]; do
    run_one "$shape" $(( i * PAGE * 7 ))
    i=$(( i + 1 ))
  done
done

log "wrote $OUT"
awk -F, 'NR>1 && $6==1 {n[$2]++; s[$2]+=$7; b[$2]+=$8; if($7>m[$2]) m[$2]=$7}
         NR>1 && $6!=1 {bad[$2]++}
         END{for (k in n) printf "  %-6s n=%d ok  mean %.1f ms  max %.1f ms  mean %.0f KiB  non-ok=%d\n",
             k, n[k], s[k]/n[k], m[k], (b[k]/n[k])/1024, bad[k]+0}' "$OUT" >&2
