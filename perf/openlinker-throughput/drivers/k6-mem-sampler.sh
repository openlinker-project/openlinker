#!/usr/bin/env bash
# Samples the k6 container's cgroup RSS and host MemAvailable.
#
# #2931 criterion 1 asks that a 1000/s run completes WITHOUT BEING OOM-KILLED
# and that the report say what peak container memory was; criterion 2 asks that
# memory does not scale with VU count. Neither is answerable from the harness:
# the F3 scenario samples no memory of its own, `docker stats` MemUsage
# includes page cache, and the k6 container is `docker run --rm` with a
# generated name and no --memory limit.
#
# So: find any running container from the k6 image each tick, read its cgroup
# anonymous RSS from inside it, and record host MemAvailable beside it. RSS is
# the figure that can OOM a host; page cache is not.
#
# SEVENTH INSTANCE OF THE FAMILY FAILURE, and it was this file. The first
# version had no stop condition at all: it identified its subject by PRESENCE
# ("is a k6 container up right now?") rather than by the WINDOW, so when the
# rung ended it could not tell "the run is over" from "the run is quiet". It
# ran for 2 h 35 m past the end of a 14-minute window and wrote 2 884 rows
# with every k6 column blank against 175 real ones - and its own empty-row
# count grew between two readings of the same file. `host_mem_available_kb` is
# populated on every row, so any host-memory conclusion drawn over the whole
# file would have been contaminated even though the k6 columns are visibly
# blank. That is arm A's RSS sampler exactly, one campaign later.
#
# Two remedies, because one is not enough:
#   MAX_SECS   a hard backstop so an orphaned sampler cannot outlive its
#              window even if nobody kills it;
#   and the caller kills it by PID at the end of the rung (see
#   f3-rate-ladder.sh), which is the primary mechanism - a probe should be
#   bounded by the thing it is probing, not by its own patience.
#
# Rows with no k6 container are still written (host memory is worth having as
# a baseline) but they are trivially filterable on an empty k6_container, and
# every figure quoted from this file MUST be computed over rows where
# k6_rss_bytes > 0.
#
# Usage: k6-mem-sampler.sh <out.csv> [interval_secs] [max_secs]
set -uo pipefail
OUT="${1:?k6-mem-sampler.sh <out.csv> [interval] [max_secs]}"
INTERVAL="${2:-3}"
MAX_SECS="${3:-3600}"
STARTED="$(date +%s)"

printf 'ts,k6_container,k6_rss_bytes,k6_vus_hint,host_mem_available_kb\n' > "$OUT"

while [ "$(( $(date +%s) - STARTED ))" -lt "$MAX_SECS" ]; do
  host_avail="$(awk '/^MemAvailable:/{print $2}' /proc/meminfo 2>/dev/null || printf -- -1)"
  # One line per running k6 container (normally zero or one).
  found=0
  while read -r cid name; do
    [ -n "$cid" ] || continue
    found=1
    stat="$(docker exec "$cid" cat /sys/fs/cgroup/memory/memory.stat 2>/dev/null \
            || docker exec "$cid" cat /sys/fs/cgroup/memory.stat 2>/dev/null || true)"
    rss="$(printf '%s\n' "$stat" | awk '$1=="total_rss"||$1=="anon"{print $2; exit}')"
    printf '%s,%s,%s,,%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" "${rss:--1}" "$host_avail" >> "$OUT"
  done < <(docker ps --filter "ancestor=grafana/k6:1.0.0" --format '{{.ID}} {{.Names}}' 2>/dev/null)
  if [ "$found" = "0" ]; then
    # No k6 in flight: still record host memory so the baseline is visible.
    printf '%s,,,,%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$host_avail" >> "$OUT"
  fi
  sleep "$INTERVAL"
done
printf '%s,,,,BACKSTOP_MAX_SECS_REACHED\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT"
