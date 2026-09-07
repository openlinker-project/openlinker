#!/usr/bin/env bash
#
# ps-latency-table.sh <outdir> - collapse a directory of latency-probe runs
# into one table.
#
# Reads the `#` summary block each `drivers/ps-latency-probe.mjs` run writes to
# stderr (the scenario wrappers save it beside the CSV), so this never
# re-derives a percentile the probe already computed - one implementation of
# the arithmetic, not two.
#
# It prints the OFFERED and the ACHIEVED rate side by side, and the status mix,
# on purpose. A latency curve is only readable if you can see that the rate on
# the x-axis was actually delivered and that the samples behind each point were
# successes: a probe that could not keep up, or a shop shedding load with fast
# errors, both produce a flattering curve and this is where that shows.
#
# Works on a ramp directory (`step-*.summary`) and on a during-window directory
# (`during-*.summary`) alike.
set -euo pipefail

DIR="${1:?usage: ps-latency-table.sh <outdir>}"
shopt -s nullglob
files=("$DIR"/step-*.summary "$DIR"/during-*.summary)
[ "${#files[@]}" -gt 0 ] || { echo "ps-latency-table.sh: no probe summaries under $DIR" >&2; exit 1; }

printf '%-16s %8s %9s %10s %8s %8s %8s %8s  %s\n' \
  label offered achieved 'ok/total' p50 p90 p99 max 'status mix'
for f in "${files[@]}"; do
  base=$(basename "$f" .summary)
  off=$(sed -nE 's/^# offered rps *: (.*)/\1/p' "$f")
  ach=$(sed -nE 's/^# achieved rps *: ([0-9.]+).*/\1/p' "$f")
  okn=$(sed -nE 's/^# samples ok *: (.*)/\1/p' "$f" | tr -d ' ')
  lat=$(sed -nE '/^# latency ok/p' "$f")
  p50=$(printf '%s' "$lat" | sed -nE 's/.*p50 ([0-9.]+).*/\1/p')
  p90=$(printf '%s' "$lat" | sed -nE 's/.*p90 ([0-9.]+).*/\1/p')
  p99=$(printf '%s' "$lat" | sed -nE 's/.*p99 ([0-9.]+).*/\1/p')
  mx=$(printf '%s' "$lat"  | sed -nE 's/.*max ([0-9.]+).*/\1/p')
  st=$(sed -nE 's/^# status mix *: (.*)/\1/p' "$f")
  printf '%-16s %8s %9s %10s %8s %8s %8s %8s  %s\n' \
    "$base" "${off:-?}" "${ach:-?}" "${okn:-?}" "${p50:-?}" "${p90:-?}" "${p99:-?}" "${mx:-?}" "${st:-?}"
done
