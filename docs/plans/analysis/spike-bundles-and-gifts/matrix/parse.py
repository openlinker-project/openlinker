"""Extract competitor coverage ratings from spike reports (rounds 1-4) into matrix.json.

Usage: python3 -I parse.py <spike-folder> <out.json>
"""
import json, os, re, sys

BASE, OUT = sys.argv[1], sys.argv[2]
COMP = {
    'baselinker': 'BaseLinker', 'apilo': 'Apilo', 'sellasist': 'Sellasist', 'linnworks': 'Linnworks',
    'shopify': 'Shopify', 'cin7': 'Cin7', 'brightpearl': 'Brightpearl',
}
RATING = re.compile(r'^\W*(Full|Partial|None|Unknown|F|P|N|U)\b', re.I)
NORM = {'full': 'F', 'partial': 'P', 'none': 'N', 'unknown': 'U', 'f': 'F', 'p': 'P', 'n': 'N', 'u': 'U'}
ID = re.compile(r'([BGX])-(\d{2})')


def expand(cell):
    ids = []
    # ranges: "B-18 to B-21" / "B-18..B-21" / "B-18-B-21"
    for m in re.finditer(r'([BGX])-(\d{2})\s*(?:to|\.\.|–|-)\s*([BGX])-(\d{2})', cell):
        if m.group(1) == m.group(3):
            for n in range(int(m.group(2)), int(m.group(4)) + 1):
                ids.append(f'{m.group(1)}-{n:02d}')
    for m in ID.finditer(cell):
        i = f'{m.group(1)}-{m.group(2)}'
        if i not in ids:
            ids.append(i)
    return ids


def rate(text):
    m = RATING.match(text.strip())
    return NORM[m.group(1).lower()] if m else None


def parse_file(path):
    out = {}
    for line in open(path, encoding='utf-8'):
        s = line.strip()
        ids, r = [], None
        bold = re.match(r'^\*\*([BGX]-\d{2}[^*]*?)\s[-–]\s([^*]+)\*\*', s)
        if bold:
            ids = expand(bold.group(1)[:40])
            r = rate(bold.group(2))
        elif '|' in s:
            cells = [c.strip() for c in s.strip('|').split('|')]
            if len(cells) < 2:
                continue
            head = cells[0].replace('*', '')
            if not re.match(r'^[BGX]-\d{2}', head):
                continue
            ids = expand(head[:60])
            for c in cells[1:3]:
                r = rate(c.replace('*', ''))
                if r:
                    break
        if ids and r:
            for i in ids:
                out.setdefault(i, r)
    return out


result = {}  # round -> competitor -> id -> rating
for rnd in ['r1', 'r2', 'r3', 'r4']:
    d = os.path.join(BASE, rnd, 'phase2')
    if not os.path.isdir(d):
        continue
    for f in sorted(os.listdir(d)):
        if not f.endswith('.md'):
            continue
        comp = next((v for k, v in COMP.items() if k in f.lower()), None)
        if not comp:
            continue
        ratings = parse_file(os.path.join(d, f))
        bucket = result.setdefault(rnd, {}).setdefault(comp, {})
        for k, v in ratings.items():
            bucket.setdefault(k, v)
json.dump(result, open(OUT, 'w'), indent=1, sort_keys=True)
for rnd, comps in result.items():
    print(rnd, {c: len(v) for c, v in comps.items()})
