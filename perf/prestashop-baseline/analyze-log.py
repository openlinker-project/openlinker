#!/usr/bin/env python3
"""Turn a PrestaShop Apache access-log window into request counts.

Reads combined-log lines on stdin, ignores the container healthcheck
(loopback GET /) and reports:
  * total /api/ requests
  * a breakdown per webservice resource
  * how many times each individual /api/products/<id> was re-fetched
  * requests per wall-clock minute, to expose a rate-limit ceiling
"""
import sys, re, collections

LINE = re.compile(r'^(\S+) \S+ \S+ \[([^\]]+)\] "(\w+) ([^" ]+)[^"]*" (\d{3})')
RES = re.compile(r'^/api/([a-z_]+)(?:/(\d+))?')

rows = []
total_lines = 0
unparsed = 0
for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue
    total_lines += 1
    m = LINE.match(raw)
    if not m:
        # A truncated capture or a changed log format lands here. Counted and
        # printed, because "no /api/ requests" and "the format moved under us"
        # must not look the same.
        unparsed += 1
        continue
    ip, ts, verb, path, status = m.groups()
    if ip.startswith('127.0.0.1'):
        continue          # container healthcheck
    if not path.startswith('/api/'):
        continue
    rows.append((ts, verb, path, status))

print(f'log_lines={total_lines} unparsed_lines={unparsed}')
if unparsed:
    pct_unparsed = 100 * unparsed / total_lines if total_lines else 0
    print(f'WARNING: {unparsed} of {total_lines} lines ({pct_unparsed:.1f}%) did '
          'not match the combined-log pattern; the counts below are incomplete')

if not rows:
    print('no /api/ requests in window')
    sys.exit(0)

print(f'total_api_requests={len(rows)}')

by_res = collections.Counter()
by_verb_res = collections.Counter()
prod_hits = collections.Counter()
for ts, verb, path, status in rows:
    base = path.split('?', 1)[0]
    m = RES.match(base)
    res, ident = (m.group(1), m.group(2)) if m else ('<other>', None)
    by_res[res] += 1
    by_verb_res[f'{verb} /api/{res}' + ('/<id>' if ident else '')] += 1
    if res == 'products' and ident:
        prod_hits[ident] += 1

print('\n-- per resource --')
for res, n in by_res.most_common():
    print(f'{n:6d}  {res}')

print('\n-- per verb+shape --')
for k, n in by_verb_res.most_common():
    print(f'{n:6d}  {k}')

if prod_hits:
    dist = collections.Counter(prod_hits.values())
    print('\n-- GET /api/products/<id> repeat distribution --')
    print(f'distinct_ids={len(prod_hits)} total_fetches={sum(prod_hits.values())} '
          f'mean={sum(prod_hits.values())/len(prod_hits):.2f}')
    for times in sorted(dist):
        print(f'  {dist[times]:5d} ids fetched {times}x')

per_min = collections.Counter(ts[:17] for ts, *_ in rows)   # dd/Mon/yyyy:HH:MM
print('\n-- requests per minute --')
vals = sorted(per_min.values())
for minute in sorted(per_min):
    print(f'  {minute}  {per_min[minute]}')
print(f'peak_per_minute={max(vals)} median_per_minute={vals[len(vals)//2]}')

status_ct = collections.Counter(s for *_, s in rows)
print('\n-- statuses --', dict(status_ct))
