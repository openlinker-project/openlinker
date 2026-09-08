#!/usr/bin/env bash
# Out-of-band cgroup memory sampler.
#
# WHY IT EXISTS, AND WHY IT IS NOT IN THE SCENARIO
# ------------------------------------------------
# Both samplers inside the harness record `docker stats` MemUsage, which
# INCLUDES the page cache - so for any container that reads files it cannot be
# read as memory growth. The 2026-09-08 baseline measured lab-postgres at
# 1.412 GiB by docker stats against 17.4 MiB of anonymous RSS and 1.53 GiB of
# reclaimable cache, and nearly published a 7.7x "leak" that was not one.
#
# The baseline author started an equivalent sampler BY HAND, mid-window, at
# ~t+2900s. This one is started at window open instead, so the fixed-image run
# has RSS coverage over the whole window. That is an observation asymmetry
# between the two runs and is stated in the report; it changes no load (one
# `cat` of memory.stat per container per interval).
#
# It is deliberately NOT added to sustained-mixed-load.sh: this re-run's whole
# value is that exactly one variable changed, and editing the instrument
# between the two runs would forfeit that.
#
# Usage: cgroup-rss-sampler.sh <out.csv> [interval_secs] [container ...]
set -uo pipefail

OUT="${1:?cgroup-rss-sampler.sh <out.csv> [interval] [containers...]}"
INTERVAL="${2:-30}"
shift 2 || true
CONTAINERS=("$@")
if [ "${#CONTAINERS[@]}" -eq 0 ]; then
  CONTAINERS=(lab-worker-1 lab-api lab-postgres lab-redis lab-prestashop lab-mysql)
fi

printf 'ts,container,rss_bytes,cache_bytes,source\n' > "$OUT"

read_one() {
  local c="$1" stat rss cache src
  # cgroup v2 first, then v1. Read from INSIDE the container so the path does
  # not depend on the host's cgroup driver or on the container id.
  stat="$(docker exec "$c" cat /sys/fs/cgroup/memory.stat 2>/dev/null || true)"
  if [ -n "$stat" ]; then
    src=v2
    rss="$(printf '%s\n' "$stat" | awk '$1=="anon"{print $2; exit}')"
    cache="$(printf '%s\n' "$stat" | awk '$1=="file"{print $2; exit}')"
  else
    stat="$(docker exec "$c" cat /sys/fs/cgroup/memory/memory.stat 2>/dev/null || true)"
    [ -n "$stat" ] || return 0
    src=v1
    rss="$(printf '%s\n' "$stat" | awk '$1=="total_rss"{print $2; exit}')"
    cache="$(printf '%s\n' "$stat" | awk '$1=="total_cache"{print $2; exit}')"
  fi
  # An unreadable field is written as -1, never 0 - the harness's own rule, and
  # for the same reason: a 0 averaged in would flatter a flat curve.
  printf '%s,%s,%s,%s,%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$c" "${rss:--1}" "${cache:--1}" "$src" >> "$OUT"
}

while true; do
  for c in "${CONTAINERS[@]}"; do read_one "$c"; done
  sleep "$INTERVAL"
done
