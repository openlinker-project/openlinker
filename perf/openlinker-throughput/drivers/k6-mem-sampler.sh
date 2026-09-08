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
# Usage: k6-mem-sampler.sh <out.csv> [interval_secs] [k6_image_substring]
set -uo pipefail
OUT="${1:?k6-mem-sampler.sh <out.csv> [interval] [image]}"
INTERVAL="${2:-3}"
IMG="${3:-k6}"

printf 'ts,k6_container,k6_rss_bytes,k6_vus_hint,host_mem_available_kb\n' > "$OUT"

while true; do
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
