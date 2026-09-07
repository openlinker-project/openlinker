#!/usr/bin/env bash
#
# ps-request-mix.sh <window_start_epoch> <window_stop_epoch> [ps_container]
#
# Breaks PrestaShop's own access log for one measurement window down by
# resource and status, and reports two things the throughput scenarios do not:
#
#   1. HOW the per-connection rate-limit budget was actually spent - which
#      resource took what share - so "reduce requests per order" can be aimed
#      at a specific call rather than at the total.
#
#   2. The share spent on a call that CANNOT SUCCEED. OpenLinker reads
#      `GET /api/configurations` (PS_CURRENCY_DEFAULT, PS_PACK_STOCK_TYPE) with
#      a webservice key that is not permitted on that resource, so it answers
#      401 every time, and the negative result is cached on a 60 s TTL
#      (`prestashop-shop-currency.resolver.ts`, UNRESOLVED_CACHE_TTL_MS) - so
#      it recurs for the life of the connection. Every one of those requests
#      is paced by the same limiter as a real one.
#
# It also subtracts the latency probe's own requests. `drivers/ps-latency-probe.mjs`
# sends a fixed, unique User-Agent precisely so this subtraction is a MEASURED
# count and not an estimate - a probe running during a window would otherwise
# inflate the very requests-per-order figure the derived ceilings divide by.
#
# `docker logs --since/--until` take a BARE epoch, never `@epoch`: the `@` form
# is accepted without error and returns NOTHING on Docker 29.5.2. That trap
# cost this campaign every degradation count it reported before #2851, so it is
# repeated here rather than assumed to be remembered.
#
set -euo pipefail

WS="${1:?usage: ps-request-mix.sh <window_start_epoch> <window_stop_epoch> [ps_container]}"
WE="${2:?usage: ps-request-mix.sh <window_start_epoch> <window_stop_epoch> [ps_container]}"
PS="${3:-${PS_CONTAINER:-lab-prestashop}}"
PROBE_UA="${PROBE_UA:-olperf-latency-probe}"

LOGS="$(docker logs --since "$WS" --until "$WE" "$PS" 2>&1 || true)"

# Split the probe's own lines out FIRST, so every figure below is OpenLinker's.
probe_lines="$(printf '%s\n' "$LOGS" | grep -F -c "$PROBE_UA" || true)"
ol="$(printf '%s\n' "$LOGS" | grep -F -v "$PROBE_UA" || true)"

api_total="$(printf '%s\n' "$ol" | grep -cE '"(GET|POST|PUT|DELETE|PATCH) /api/' || true)"
mod_total="$(printf '%s\n' "$ol" | grep -cE '"POST /index\.php' || true)"

printf 'window            : %s .. %s (%ss)\n' "$WS" "$WE" "$((WE - WS))"
printf 'container         : %s\n' "$PS"
printf 'probe requests    : %s (excluded from every figure below)\n' "${probe_lines:-0}"
printf 'OL /api/ requests : %s\n' "${api_total:-0}"
printf 'OL module POSTs   : %s\n' "${mod_total:-0}"
printf 'OL total (paced)  : %s\n' "$(( ${api_total:-0} + ${mod_total:-0} ))"
printf '\nper resource (method resource -> count, status mix):\n'

# `resource` is the first path segment after /api/, with the query string and
# any numeric id folded away, so `products/24` and `products?filter[...]` land
# in one row - the limiter does not care which of the two it paced.
# The request line and its status are separated by ` HTTP/1.1"`, so the
# pattern has to span that: matching `[^ "]*"` straight after the path finds
# nothing at all, which reads exactly like a window with no requests. Caught
# on this script's own first run against a live window.
printf '%s\n' "$ol" \
  | sed -nE 's#.*"([A-Z]+) /api/([a-z_]+)[^"]*" ([0-9]{3}).*#\1 \2 \3#p' \
  | sort | uniq -c | sort -rn \
  | awk '{printf "  %6d  %-6s %-18s %s\n", $1, $2, $3, $4}'

printf '\nmodule endpoints:\n'
# No `| head -N` anywhere in this file. Under `set -o pipefail` a `head` that
# closes early SIGPIPEs its upstream `sort` and fails the whole pipeline - on
# SUCCESS - which is a trap this campaign has already paid for twice. The
# module endpoints are a closed set of two, so there is nothing to truncate;
# `awk` does the limiting if that ever changes.
printf '%s\n' "$ol" \
  | sed -nE 's#.*"POST (/index\.php[^"]*) HTTP[^"]*" ([0-9]{3}).*#\1 \2#p' \
  | sed -E 's#(controller=[a-z]+).*#\1#' \
  | sort | uniq -c | sort -rn \
  | awk 'NR<=10 {printf "  %6d  %s %s\n", $1, $2, $3}'

# The wasted share, computed rather than asserted. `|| true` on the grep so a
# window with no such call reports 0 instead of aborting under `pipefail`.
cfg="$(printf '%s\n' "$ol" | grep -cE '"GET /api/configurations' || true)"
cfg401="$(printf '%s\n' "$ol" | grep -cE '"GET /api/configurations[^"]*" 401' || true)"
total=$(( ${api_total:-0} + ${mod_total:-0} ))
printf '\nbudget spent on a call that cannot succeed:\n'
printf '  GET configurations       : %s\n' "${cfg:-0}"
printf '  of which 401             : %s\n' "${cfg401:-0}"
if [ "$total" -gt 0 ]; then
  printf '  401 share of paced total : %s%%\n' \
    "$(awk -v a="${cfg401:-0}" -v b="$total" 'BEGIN{printf "%.2f", (a*100)/b}')"
  printf '  401 per minute           : %s\n' \
    "$(awk -v a="${cfg401:-0}" -v s="$((WE - WS))" 'BEGIN{printf "%.2f", (a*60)/s}')"
fi
