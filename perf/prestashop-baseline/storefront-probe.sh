#!/usr/bin/env bash
# Sample the storefront's response time for N seconds and report percentiles.
# Used to compare the shop under sync load (phase B) against idle (phase A).
# Usage: ./storefront-probe.sh <seconds> <label>
set -euo pipefail
SECS="${1:-60}"; LABEL="${2:-probe}"
URL="${URL:-http://localhost:8080/}"
END=$(( $(date +%s) + SECS ))
: > "/tmp/probe.$LABEL"
while [ "$(date +%s)" -lt "$END" ]; do
  curl -s -o /dev/null -w '%{time_total}\n' -m 20 "$URL" >> "/tmp/probe.$LABEL" || echo 20 >> "/tmp/probe.$LABEL"
  sleep 0.5
done
python3 - "$LABEL" <<'PY'
import sys, statistics
label = sys.argv[1]
vals = sorted(float(x) for x in open(f'/tmp/probe.{label}') if x.strip())
if not vals:
    print(f'{label}: no samples'); raise SystemExit
def pct(p):
    return vals[min(len(vals)-1, int(round(p/100*len(vals)))-1)]
print(f'{label}: n={len(vals)} median={statistics.median(vals):.3f}s p95={pct(95):.3f}s max={max(vals):.3f}s')
PY
