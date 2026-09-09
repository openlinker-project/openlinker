#!/usr/bin/env python3
"""
F13 summarizer (#3001, epic #2840). Reads the three CSVs
scenarios/f13-writeback.sh writes and prints n/min/p50/p90/max per leg (and,
for legs 2/3, per arm within the leg - `m` for leg 2, `volume` for leg 3).

Never fabricates a number: a row whose duration column could not be parsed
(job never reached a terminal status inside POLL_MAX_WAIT_SECS, or the
column was NULL) is excluded from that arm's sample and counted separately
as "unresolved", rather than being coerced to zero or silently dropped from
the reported n.
"""
import csv
import sys


def percentile(values, p):
    if not values:
        return None
    s = sorted(values)
    k = (len(s) - 1) * p
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return s[f]
    return s[f] + (s[c] - s[f]) * (k - f)


def report(label, values, unresolved=0):
    n = len(values)
    if n == 0:
        print(f"{label}: n=0 (never observed)" + (f", {unresolved} unresolved" if unresolved else ""))
        return
    p50 = percentile(values, 0.50)
    p90 = percentile(values, 0.90) if n >= 3 else None
    line = f"{label}: n={n} min={min(values):.0f}ms p50={p50:.0f}ms max={max(values):.0f}ms"
    if p90 is not None:
        line += f" p90={p90:.0f}ms"
    else:
        line += " p90=<n<3, not reported>"
    if unresolved:
        line += f" ({unresolved} unresolved - excluded from n)"
    print(line)


def to_int(s):
    try:
        return int(s)
    except (TypeError, ValueError):
        return None


def summarize_leg1(path):
    print("LEG1 waybill/tracking write-back (event-driven, notify-dispatched)")
    rows = list(csv.DictReader(open(path)))
    print(f"total cycles: {len(rows)}")
    ms_values = []
    unresolved = 0
    outcome_counts = {}
    source_counts = {}
    status_counts = {}
    for r in rows:
        v = to_int(r.get("ms"))
        if v is None:
            unresolved += 1
        else:
            ms_values.append(v)
        outcome_counts[r.get("outcome", "")] = outcome_counts.get(r.get("outcome", ""), 0) + 1
        source_counts[r.get("source", "")] = source_counts.get(r.get("source", ""), 0) + 1
        status_counts[r.get("http_status", "")] = status_counts.get(r.get("http_status", ""), 0) + 1
    report("notify-dispatched call", ms_values, unresolved)
    print(f"HTTP status distribution: {status_counts}")
    print(f"outcome distribution: {outcome_counts}")
    print(f"source (mark-sent) distribution: {source_counts}")
    print()


def summarize_leg2(path):
    print("LEG2 shipment-status scan (marketplace.shipment.statusSync, READ half only)")
    rows = list(csv.DictReader(open(path)))
    print(f"total runs: {len(rows)}")
    by_m = {}
    for r in rows:
        m = r.get("m", "?")
        by_m.setdefault(m, {"values": [], "unresolved": 0, "outcomes": {}, "statuses": {}})
        v = to_int(r.get("last_attempt_duration_ms"))
        if v is None:
            by_m[m]["unresolved"] += 1
        else:
            by_m[m]["values"].append(v)
        by_m[m]["outcomes"][r.get("outcome", "")] = by_m[m]["outcomes"].get(r.get("outcome", ""), 0) + 1
        by_m[m]["statuses"][r.get("status", "")] = by_m[m]["statuses"].get(r.get("status", ""), 0) + 1
    for m in sorted(by_m, key=lambda x: (len(x), x)):
        d = by_m[m]
        report(f"m={m} shipments per scan", d["values"], d["unresolved"])
        print(f"  m={m} job status distribution: {d['statuses']}  outcome distribution: {d['outcomes']}")
    print()


def summarize_leg3(path):
    print("LEG3 fulfillment-status read-back (marketplace.fulfillment.statusSync)")
    rows = list(csv.DictReader(open(path)))
    print(f"total runs: {len(rows)}")
    by_vol = {}
    for r in rows:
        vol = r.get("volume", "?")
        by_vol.setdefault(vol, {"values": [], "unresolved": 0, "total_rows": [], "outcomes": {}, "statuses": {}})
        v = to_int(r.get("last_attempt_duration_ms"))
        if v is None:
            by_vol[vol]["unresolved"] += 1
        else:
            by_vol[vol]["values"].append(v)
        tr = to_int(r.get("total_order_records_rows"))
        if tr is not None:
            by_vol[vol]["total_rows"].append(tr)
        by_vol[vol]["outcomes"][r.get("outcome", "")] = by_vol[vol]["outcomes"].get(r.get("outcome", ""), 0) + 1
        by_vol[vol]["statuses"][r.get("status", "")] = by_vol[vol]["statuses"].get(r.get("status", ""), 0) + 1
    for vol in ("small", "large"):
        if vol not in by_vol:
            continue
        d = by_vol[vol]
        tr_desc = f"~{max(d['total_rows'])} rows" if d["total_rows"] else "unknown row count"
        report(f"volume={vol} ({tr_desc} in order_records at run time)", d["values"], d["unresolved"])
        print(f"  volume={vol} job status distribution: {d['statuses']}  outcome distribution: {d['outcomes']}")
    if "small" in by_vol and "large" in by_vol and by_vol["small"]["values"] and by_vol["large"]["values"]:
        small_p50 = percentile(by_vol["small"]["values"], 0.50)
        large_p50 = percentile(by_vol["large"]["values"], 0.50)
        ratio = (large_p50 / small_p50) if small_p50 else None
        print(f"  large/small p50 ratio: {ratio:.2f}x" if ratio is not None else "  large/small p50 ratio: n/a (small p50 is 0)")
    print()


def main():
    leg1_path, leg2_path, leg3_path = sys.argv[1], sys.argv[2], sys.argv[3]
    summarize_leg1(leg1_path)
    summarize_leg2(leg2_path)
    summarize_leg3(leg3_path)


if __name__ == "__main__":
    main()
