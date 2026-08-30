#!/usr/bin/env bash
# Sample the storefront's response time for N seconds and report percentiles.
# Used to compare the shop under sync load (phase B) against idle (phase A).
#
# A sample counts ONLY if the shop answered 2xx. A fast error is not a fast
# page: without the status check a shop returning 500s in 3 ms under sync load
# would read as "unaffected". Non-2xx and transport failures are counted and
# printed separately, and the probe exits non-zero if any occurred, so a run
# that measured errors cannot be quoted as a clean latency measurement.
#
# Usage: ./storefront-probe.sh <seconds> <label>
set -euo pipefail
SECS="${1:-60}"; LABEL="${2:-probe}"
URL="${URL:-http://localhost:8080/}"
END=$(( $(date +%s) + SECS ))
: > "/tmp/probe.$LABEL"
while [ "$(date +%s)" -lt "$END" ]; do
  # One line per sample: "<http_code> <time_total>". 000 means curl itself failed
  # (timeout, connection refused); its timing is meaningless and is discarded.
  curl -s -o /dev/null -w '%{http_code} %{time_total}\n' -m 20 "$URL" \
    >> "/tmp/probe.$LABEL" || echo "000 0" >> "/tmp/probe.$LABEL"
  sleep 0.5
done
python3 - "$LABEL" <<'PY'
import sys, statistics
label = sys.argv[1]
ok, bad, malformed = [], [], 0
for raw in open(f'/tmp/probe.{label}'):
    raw = raw.strip()
    if not raw:
        continue
    parts = raw.split()
    if len(parts) != 2:
        malformed += 1
        continue
    code, secs = parts
    try:
        secs = float(secs)
    except ValueError:
        malformed += 1
        continue
    if code.startswith('2'):
        ok.append(secs)
    else:
        bad.append(code)
vals = sorted(ok)
if not vals:
    print(f'{label}: NO SUCCESSFUL SAMPLES (errors={len(bad)} malformed={malformed})')
    raise SystemExit(1)
def pct(p):
    return vals[min(len(vals)-1, int(round(p/100*len(vals)))-1)]
print(f'{label}: n={len(vals)} median={statistics.median(vals):.3f}s '
      f'p95={pct(95):.3f}s max={max(vals):.3f}s '
      f'errors={len(bad)} malformed={malformed}')
if bad:
    from collections import Counter
    print(f'{label}: NON-2XX RESPONSES, this window is not a clean latency '
          f'measurement: {dict(Counter(bad))}')
    raise SystemExit(1)
PY
