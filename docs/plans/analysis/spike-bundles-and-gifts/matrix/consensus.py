"""Combine round ratings (matrix.json) with R5 red-team verdicts into a consensus matrix.

Usage: python3 -I consensus.py <spike-folder> <matrix.json> <out.json>
Rule: R5 verdict wins where one exists; otherwise the most frequent rating across
rounds 1-4, ties broken by the later round (R4 = primary sources only).
"""
import json, re, sys
from collections import Counter

BASE, MATRIX, OUT = sys.argv[1:4]
m = json.load(open(MATRIX))
ROUNDS = ['r1', 'r2', 'r3', 'r4']
COMPS = ['BaseLinker', 'Apilo', 'Sellasist', 'Linnworks', 'Shopify', 'Cin7', 'Brightpearl']

r5 = {}
for line in open(f'{BASE}/r5/4-competitors-pl.md', encoding='utf-8'):
    cells = [c.strip() for c in line.strip().strip('|').split('|')]
    if len(cells) < 6 or not re.match(r'^[BGX]-\d{2}', cells[0]):
        continue
    mm = re.search(r'\*\*([FPNU])\b', cells[4])
    if mm and cells[1] in COMPS:
        r5[(cells[0][:4], cells[1])] = mm.group(1)
# r5/5-competitors-global.md disputed-cell verdicts (from its summary list).
R5_GLOBAL = {
    ('B-02', 'Shopify'): 'P', ('B-03', 'Shopify'): 'N', ('B-12', 'Shopify'): 'P', ('B-14', 'Shopify'): 'F',
    ('B-16', 'Shopify'): 'P', ('G-05', 'Shopify'): 'P', ('G-07', 'Shopify'): 'P', ('G-08', 'Shopify'): 'P',
    ('G-11', 'Shopify'): 'P', ('B-09', 'Linnworks'): 'N', ('B-11', 'Linnworks'): 'F', ('B-18', 'Linnworks'): 'P',
    ('G-07', 'Linnworks'): 'P', ('G-12', 'Linnworks'): 'P', ('B-05', 'Cin7'): 'U', ('B-14', 'Cin7'): 'P',
    ('G-07', 'Cin7'): 'P', ('B-15', 'Brightpearl'): 'P', ('G-05', 'Brightpearl'): 'F', ('G-06', 'Brightpearl'): 'F',
    ('G-09', 'Brightpearl'): 'P',
}
r5.update(R5_GLOBAL)

ids = sorted({i for rnd in m.values() for c in rnd.values() for i in c}, key=lambda s: (s[0] != 'B', s[0] != 'G', s))
cells, unanimous, disputed = [], 0, []
for i in ids:
    for c in COMPS:
        vals = {r: m.get(r, {}).get(c, {}).get(i) for r in ROUNDS}
        present = [v for v in vals.values() if v]
        if not present:
            continue
        cnt = Counter(present)
        top = max(cnt.values())
        cand = [v for v in cnt if cnt[v] == top]
        majority = next((vals[r] for r in reversed(ROUNDS) if vals[r] in cand), cand[0])
        final = r5.get((i, c), majority)
        same = len(set(present)) == 1
        unanimous += same
        cell = {'id': i, 'competitor': c, **vals, 'r5': r5.get((i, c)), 'final': final,
                'roundsSeen': len(present), 'unanimous': same}
        cells.append(cell)
        if not same:
            disputed.append(cell)
pairs = agree = 0
for a in range(4):
    for b in range(a + 1, 4):
        for cell in cells:
            x, y = cell[ROUNDS[a]], cell[ROUNDS[b]]
            if x and y:
                pairs += 1
                agree += x == y
json.dump({'cells': cells, 'r5Overrides': len(r5)}, open(OUT, 'w'), indent=1)
print(f'cells={len(cells)} unanimous={unanimous} ({unanimous*100//len(cells)}%) '
      f'pairwise agreement={agree}/{pairs} ({agree*100//pairs}%) r5 verdicts={len(r5)}')
four = [x for x in cells if x['roundsSeen'] == 4]
print('cells seen in all 4 rounds:', len(four), 'unanimous:', sum(x['unanimous'] for x in four))
fin = Counter(x['final'] for x in cells)
print('final distribution', dict(fin))
for c in COMPS:
    cc = Counter(x['final'] for x in cells if x['competitor'] == c)
    print(c, dict(cc))
