#!/usr/bin/env python3
"""
F2 summarizer (#2848, epic #2840). Reads scenarios/f2-stock-propagation.sh's
cycles.csv and prints, per hop, n / min / p50 / p95 / max in milliseconds.

Never fabricates a number: a row missing either endpoint of a hop is simply
excluded from that hop's sample (and its own n reflects that), rather than
being coerced to zero or dropped from every hop uniformly.

Timestamp handling: `outbox_delivered_utc` is a bare MySQL `NOW()` value,
verified live against this stand to run UTC (matches Postgres NOW() and the
host's own `date -u`) - so it is parsed as naive-UTC. Every OL-side
timestamp (`webhook_delivery_created_utc`, `inv_job_created_utc`,
`inventory_items_max_updated_utc`, `propagate_job_created_utc`,
`offer_child_created_utc`) is a Postgres `timestamptz` string and carries
its own `+00` offset. `outbox_created_local` (PHP `date()`) is Europe/Paris
and is NOT used for any hop math here - see the scenario script's own
header for why comparing it against the UTC columns without correction
would be off by the DST offset.
"""
import csv
import sys
from datetime import datetime, timezone

def parse_pg_ts(s):
    """
    Parses BOTH `timestamptz` text ("...+00", carries its own offset) AND
    plain `timestamp` text ("...", no offset - e.g. inventory_items.updatedAt,
    verified `timestamp without time zone` via `\\d inventory_items`) columns.
    A naive result (no offset in the source string) is stamped UTC explicitly
    - the column's own values ARE UTC (this stand's Postgres session runs
    UTC, matched against `date -u`/MySQL NOW() independently), only the type
    omits the designator. Getting this wrong is not a rounding error: Python's
    `datetime.timestamp()` on a naive object assumes the INTERPRETING
    process's OWN local timezone, and that process is this script, whose host
    reports CEST (UTC+2) - so a naive datetime silently mis-converts by
    exactly 7 200 000 ms. Found live: this exact bug produced Hop D/E figures
    of roughly -7 197 000 ms / +7 200 000 ms in an earlier draft of this
    summarizer, on the same data this fix now reports correctly in
    milliseconds.
    """
    if not s:
        return None
    s = s.strip()
    if not s:
        return None
    # Postgres timestamptz text output: "2026-09-05 23:14:24.91788+00"
    s = s.replace(' ', 'T', 1)
    has_offset = len(s) >= 3 and (s[-3] == '+' or s[-3] == '-') and s[-2:].isdigit()
    # Normalise a bare +00 / -05 offset to +00:00 / -05:00 for fromisoformat.
    if has_offset:
        s = s + ':00'
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt

def parse_mysql_utc(s):
    if not s:
        return None
    s = s.strip()
    if not s:
        return None
    try:
        dt = datetime.strptime(s, '%Y-%m-%d %H:%M:%S')
        return dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None

def ms(dt):
    return int(dt.timestamp() * 1000)

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

def report_hop(name, deltas):
    n = len(deltas)
    if n == 0:
        print(f"{name}: n=0 (never observed)")
        return
    p50 = percentile(deltas, 0.50)
    p95 = percentile(deltas, 0.95) if n >= 5 else None
    line = f"{name}: n={n} min={min(deltas):.0f}ms p50={p50:.0f}ms max={max(deltas):.0f}ms"
    if p95 is not None:
        line += f" p95={p95:.0f}ms"
    else:
        line += " p95=<n<5, not reported>"
    print(line)

def main():
    path = sys.argv[1]
    rows = list(csv.DictReader(open(path)))
    print(f"total rows: {len(rows)}")

    no_outbox = sum(1 for r in rows if r.get('outbox_created_local') == 'NO_OUTBOX_ROW')
    print(f"rows with NO outbox row at all (guard/dedup swallowed the write, or hook did not fire): {no_outbox} / {len(rows)}")

    def _children(r):
        try:
            return int(r['offer_children_count']) if r.get('offer_children_count') else None
        except ValueError:
            return None
    contaminated_rows = [(r['product'], r['cycle'], _children(r)) for r in rows if _children(r) not in (None, 2)]
    if contaminated_rows:
        print(f"rows EXCLUDED from Hop F / enqueue-total (offer_children_count != 2, a window-overlap artifact - see report): {len(contaminated_rows)} / {len(rows)}")
        for product, cycle, count in contaminated_rows:
            print(f"  product={product} cycle={cycle} offer_children_count={count}")

    hopA, hopB, hopC, hopD, hopE, hopF, total_to_ol, total_to_enqueue = [], [], [], [], [], [], [], []
    inv_counts = []
    offer_children = []
    inv_job_terminal = {}
    offer_last_errors = {}

    for r in rows:
        try:
            t0 = int(r['t0_ms']) if r.get('t0_ms') else None
            t1 = int(r['t1_ms']) if r.get('t1_ms') else None
        except ValueError:
            t0 = t1 = None
        delivered = parse_mysql_utc(r.get('outbox_delivered_utc'))
        wd_created = parse_pg_ts(r.get('webhook_delivery_created_utc'))
        inv_job_created = parse_pg_ts(r.get('inv_job_created_utc'))
        inv_max_updated = parse_pg_ts(r.get('inventory_items_max_updated_utc'))
        prop_created = parse_pg_ts(r.get('propagate_job_created_utc'))
        offer_created = parse_pg_ts(r.get('offer_child_created_utc'))

        if t0 is not None and t1 is not None:
            hopA.append(t1 - t0)
        if t1 is not None and delivered is not None:
            hopB.append(ms(delivered) - t1)
        if delivered is not None and wd_created is not None:
            hopC.append(ms(wd_created) - ms(delivered))
        if wd_created is not None and inv_max_updated is not None:
            hopD.append(ms(inv_max_updated) - ms(wd_created))
        if inv_max_updated is not None and prop_created is not None:
            hopE.append(ms(prop_created) - ms(inv_max_updated))
        # A row whose own offer_children_count != 2 (the expected count on
        # this stand's topology: exactly one Allegro connection pair per
        # changed variant) had its bounded query catch a NEIGHBOUR cycle's
        # children too - the scenario's PROP_WINDOW_SECS (30s) can still
        # overlap two back-to-back cycles that finish faster than that.
        # offer_created for such a row can therefore be an EARLIER cycle's
        # child, producing a nonsensical negative Hop F. Excluded from Hop F
        # and the enqueue-total rather than silently averaged in; reported
        # as a named count instead.
        contaminated = False
        try:
            contaminated = r.get('offer_children_count') and int(r['offer_children_count']) != 2
        except ValueError:
            pass
        if contaminated:
            offer_created = None

        if prop_created is not None and offer_created is not None:
            hopF.append(ms(offer_created) - ms(prop_created))
        if t0 is not None and inv_max_updated is not None:
            total_to_ol.append(ms(inv_max_updated) - t0)
        if t0 is not None and offer_created is not None:
            total_to_enqueue.append(ms(offer_created) - t0)

        if r.get('inventory_items_updated_count'):
            try:
                inv_counts.append(int(r['inventory_items_updated_count']))
            except ValueError:
                pass
        if r.get('offer_children_count'):
            try:
                offer_children.append(int(r['offer_children_count']))
            except ValueError:
                pass
        status = r.get('inv_job_status') or ''
        inv_job_terminal[status] = inv_job_terminal.get(status, 0) + 1
        err = (r.get('offer_child_last_error') or '').strip()
        if err:
            offer_last_errors[err] = offer_last_errors.get(err, 0) + 1

    print()
    report_hop("Hop A  write (StockAvailable::setQuantity) -> outbox row inserted (same PHP call)", hopA)
    report_hop("Hop B  outbox created -> outbox delivered (cron-drain call, harness-controlled cadence)", hopB)
    report_hop("Hop C  outbox delivered -> OL commits webhook_deliveries+sync_jobs (#2280 gate)", hopC)
    report_hop("Hop D  OL commit -> inventory_items updated (job pickup + PS webservice re-read + write)", hopD)
    report_hop("Hop E  inventory_items updated -> inventory.propagateToMarketplaces enqueued", hopE)
    report_hop("Hop F  propagate enqueued -> marketplace.offerQuantity.update child enqueued", hopF)
    print()
    report_hop("TOTAL  stock write -> landed in OL's own inventory_items", total_to_ol)
    report_hop("TOTAL  stock write -> marketplace.offerQuantity.update child enqueued (NOT delivered - see Hop 5 section)", total_to_enqueue)
    print()
    if inv_counts:
        print(f"inventory_items rows touched per event: n={len(inv_counts)} min={min(inv_counts)} max={max(inv_counts)} (1 for simple products, up to the combination count for 22/23/24)")
    if offer_children:
        print(f"offerQuantity.update children enqueued per event: n={len(offer_children)} min={min(offer_children)} max={max(offer_children)} (see report's amplification section)")
    print(f"master.inventory.syncByExternalId terminal status distribution: {inv_job_terminal}")
    if offer_last_errors:
        print("marketplace.offerQuantity.update lastError distribution (destination hop - never counted as a latency):")
        for err, count in offer_last_errors.items():
            print(f"  {count}x: {err[:160]}")

if __name__ == '__main__':
    main()
