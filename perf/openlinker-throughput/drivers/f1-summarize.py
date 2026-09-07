#!/usr/bin/env python3
"""
F1 summarizer (#2847, epic #2840).

Two modes, because F1 measures two different things and reporting them with
one shape would misdescribe both:

  latency <samples.csv>     per-hop order statistics for the serial arm
  throughput <progress.csv> completion rate + queue-growth verdict for one
                            throughput arm

WHY THIS REPORTS ORDER STATISTICS AND NAMES THEIR RANK
------------------------------------------------------
#2847's own acceptance criteria refuse "p50/p95/p99" as a reporting shape at
this sample size, and say so in terms worth restating: at n in the tens,
"p99" IS the maximum observation and "p95" is the second-highest - there is
no distribution, only a handful of points. So every percentile printed here
carries the 1-based RANK it actually resolved to, out of n. A reader can then
see for themselves that a "p95" over 20 samples is the 19th of 20, and
discount it accordingly, rather than being handed a number whose name implies
a tail it cannot have.

The rank rule is nearest-rank (ceil(p * n)), which is the only definition
under which the printed rank is an actual observation rather than an
interpolation between two of them. An interpolated percentile at n=20 would
be a number that was never measured, presented beside numbers that were.

TIMESTAMP HANDLING
------------------
Every column consumed here is Postgres text. `sync_jobs.createdAt` /
`updatedAt` / `lockedAt` and `order_records.createdAt` are all declared
`timestamptz` and carry their own `+00`. A value WITHOUT an offset is stamped
UTC explicitly rather than left naive - F2's summarizer records the live bug
this prevents: `datetime.timestamp()` on a naive object assumes the
interpreting PROCESS's local timezone, which on this host is CEST, so a naive
value mis-converts by exactly 7 200 000 ms and produces plausible-looking
hop figures that are two hours wrong.
"""
import csv
import datetime as _dt
import math
import sys
from datetime import datetime, timezone


def parse_pg_ts(s):
    if s is None:
        return None
    s = s.strip()
    if not s:
        return None
    s = s.replace(' ', 'T', 1)
    # Postgres prints a 2-digit offset ("+00"); fromisoformat wants "+00:00"
    # on older Pythons and tolerates it on newer ones either way.
    if len(s) >= 3 and (s[-3] in '+-') and s[-3:] not in ('', None):
        s = s + ':00'
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def ms_between(a, b):
    """Milliseconds from a to b, or None if either endpoint is missing.

    A missing endpoint yields None and the row is EXCLUDED from that hop's
    sample - never coerced to zero, which would silently report a hop that
    was not observed as one that took no time.
    """
    ta, tb = parse_pg_ts(a), parse_pg_ts(b)
    if ta is None or tb is None:
        return None
    return (tb - ta).total_seconds() * 1000.0


def nearest_rank(values, p):
    """(value, rank) at percentile p (0..1), nearest-rank. values must be sorted."""
    n = len(values)
    if n == 0:
        return (None, None)
    rank = max(1, min(n, math.ceil(p * n)))
    return (values[rank - 1], rank)


def stats_line(label, values, note=''):
    vals = sorted(v for v in values if v is not None)
    n = len(vals)
    if n == 0:
        return f'{label:<46} n=0    (never observed){("  " + note) if note else ""}'
    p50, r50 = nearest_rank(vals, 0.50)
    p95, r95 = nearest_rank(vals, 0.95)
    return (
        f'{label:<46} n={n:<4} '
        f'min={vals[0]:>9.1f}  p50={p50:>9.1f} (rank {r50}/{n})  '
        f'p95={p95:>9.1f} (rank {r95}/{n})  max={vals[-1]:>9.1f}'
        + (f'  {note}' if note else '')
    )


# ---------------------------------------------------------------------------
# latency
# ---------------------------------------------------------------------------
#
# THE CLAIM INSTANT HAS TWO SOURCES, AND THIS SAYS WHICH ONE ANSWERED
#
# `SyncJobRepository.markSucceeded` sets `lockedAt: null` alongside
# `status: 'succeeded'`, so the column is EMPTY on every job a completed
# sample reads. The scenario therefore latches `lockedAt` while the job is
# still running - a real observation, but one a job shorter than the 1-second
# poll tick can slip past entirely.
#
# The fallback is `updatedAt - lastAttemptDurationMs`: the runner measures the
# attempt itself (`Date.now() - attemptStartedAt`) and stamps it by the same
# UPDATE that moves `updatedAt`, so on a single-attempt job this is exact and,
# unlike the latch, immune to the 3-minute heartbeat rewrite as well. It is
# NOT valid for a multi-attempt job, where the duration describes only the
# last attempt - such rows are excluded from the derived path and counted.
#
# Every hop that depends on a claim instant reports the SPLIT, so a reader can
# see how much of the figure is observed and how much reconstructed.


def claim_instant(row, prefix):
    """(datetime, source) for a job's claim instant, or (None, 'missing')."""
    latched = parse_pg_ts(row.get(f'{prefix}_locked_utc'))
    if latched is not None:
        return (latched, 'latched')
    updated = parse_pg_ts(row.get(f'{prefix}_updated_utc'))
    dur = row.get(f'{prefix}_attempt_duration_ms')
    attempts = row.get(f'{prefix}_attempts') or '1'
    if updated is None or dur in (None, '', 'NULL'):
        return (None, 'missing')
    if attempts.isdigit() and int(attempts) > 1:
        # lastAttemptDurationMs describes the LAST attempt only, so subtracting
        # it from updatedAt lands inside the final retry rather than at the
        # original claim. Reporting that as a claim instant would understate
        # every hop it feeds.
        return (None, 'multi-attempt')
    try:
        return (updated - _dt.timedelta(milliseconds=float(dur)), 'derived')
    except ValueError:
        return (None, 'missing')


def hop_ms(row, frm, to):
    """Milliseconds for one hop, where an endpoint may be a claim instant."""
    def endpoint(name):
        if name == 'poll_claim':
            return claim_instant(row, 'poll')[0]
        if name == 'child_claim':
            return claim_instant(row, 'child')[0]
        return parse_pg_ts(row.get(name))
    a, b = endpoint(frm), endpoint(to)
    if a is None or b is None:
        return None
    return (b - a).total_seconds() * 1000.0


HOPS = [
    # (label, from, to, note)
    ('A  order pushed at stub -> poll enqueued',
     'pushed_at_utc', 'poll_created_utc',
     'HARNESS-CHOSEN, see report'),
    ('B  poll enqueued -> poll claimed',
     'poll_created_utc', 'poll_claim', ''),
    ('C  poll claimed -> child enqueued',
     'poll_claim', 'child_created_utc', ''),
    ('D  child enqueued -> child claimed',
     'child_created_utc', 'child_claim', ''),
    ('E  child claimed -> order_records row written',
     'child_claim', 'record_created_utc', ''),
    ('F  order_records written -> destination syncedAt',
     'record_created_utc', 'synced_at_utc', ''),
    ('G  child claimed -> child terminal',
     'child_claim', 'child_updated_utc', ''),
    ('TOTAL  poll enqueued -> destination syncedAt',
     'poll_created_utc', 'synced_at_utc',
     'excludes hop A'),
    ('TOTAL  order pushed -> destination syncedAt',
     'pushed_at_utc', 'synced_at_utc',
     'includes the harness-chosen hop A'),
]


def summarize_latency(path):
    rows = []
    with open(path, newline='') as f:
        for row in csv.DictReader(f):
            rows.append(row)

    print(f'samples in file: {len(rows)}')
    complete = [r for r in rows if r.get('synced_at_utc')]
    print(f'samples reaching a destination create: {len(complete)}')
    print()

    for label, a, b, note in HOPS:
        print(stats_line(label, [hop_ms(r, a, b) for r in rows], note))

    # How much of the above is observed and how much reconstructed.
    print()
    for prefix, name in (('poll', 'poll job'), ('child', 'child job')):
        counts = {}
        for r in rows:
            counts[claim_instant(r, prefix)[1]] = counts.get(claim_instant(r, prefix)[1], 0) + 1
        parts = ', '.join(f'{k}={v}' for k, v in sorted(counts.items()))
        print(f'{name} claim-instant source: {parts}   '
              f'(latched = observed while running; derived = updatedAt - '
              f'lastAttemptDurationMs; missing/multi-attempt rows are EXCLUDED '
              f'from every hop that needs a claim)')

    print()
    # lastAttemptDurationMs is the runner's OWN measurement of the attempt
    # (sync-job.runner.ts stamps Date.now() - attemptStartedAt on success), so
    # it is the one figure here that is not a difference of two DB columns.
    # It is what the lane-vs-destination crossover arithmetic in #2847 calls D.
    durations = []
    for r in rows:
        v = r.get('child_attempt_duration_ms')
        if v not in (None, '', 'NULL'):
            try:
                durations.append(float(v))
            except ValueError:
                pass
    print(stats_line('D  child job duration (runner-measured)', durations,
                     'sync_jobs.lastAttemptDurationMs'))

    # The heartbeat rewrites lockedAt every 3 minutes (sync-job.runner.ts
    # JOB_HEARTBEAT_INTERVAL_MS), so lockedAt is only the CLAIM instant for a
    # job that finished inside that window. Rather than assert that, count it.
    over = 0
    checked = 0
    for r in rows:
        d = hop_ms(r, 'child_claim', 'child_updated_utc')
        if d is None:
            continue
        checked += 1
        if d >= 180_000:
            over += 1
    print()
    print(f'heartbeat caveat: {over} of {checked} child jobs ran >= 180s, so a '
          f'LATCHED lockedAt for them could be a heartbeat rewrite rather than '
          f'the claim instant (0 means the caveat does not bite on this run; '
          f'the DERIVED source is immune to it either way)')

    attempts_over = sum(1 for r in rows
                        if (r.get('child_attempts') or '1').isdigit()
                        and int(r.get('child_attempts') or '1') > 1)
    print(f'retry caveat:     {attempts_over} of {len(rows)} child jobs took more than one '
          f'attempt (lastAttemptDurationMs reports the LAST attempt only)')


# ---------------------------------------------------------------------------
# throughput
# ---------------------------------------------------------------------------
def summarize_throughput(path):
    rows = []
    with open(path, newline='') as f:
        for row in csv.DictReader(f):
            rows.append(row)
    if len(rows) < 2:
        print('progress.csv carries fewer than 2 ticks - nothing to report')
        return

    def num(r, k, default=None):
        v = r.get(k)
        if v in (None, '', 'unknown'):
            return default
        try:
            return float(v)
        except ValueError:
            return default

    t0 = float(rows[0]['epoch'])
    t1 = float(rows[-1]['epoch'])
    elapsed = t1 - t0
    done0 = num(rows[0], 'completed', 0.0)
    done1 = num(rows[-1], 'completed', 0.0)
    completed = done1 - done0

    print(f'window elapsed:        {elapsed:.0f}s')
    print(f'orders completed:      {int(completed)}')
    if elapsed > 0:
        print(f'sustained rate:        {completed / elapsed:.3f} orders/s '
              f'= {completed / elapsed * 3600:.0f} orders/hour')

    # QUEUE GROWTH, AND WHY IT IS NOT ITSELF THE KNEE ON A SATURATION ARM
    #
    # #2847 asks for "the orders/hour at which oldest-job age begins growing
    # monotonically". On an arm that deliberately offers MORE than the system
    # can take - which is what every throughput arm here does, because that is
    # the only way to measure the service rate - the age grows by
    # construction, on every run, at every rate. Reporting that as "past the
    # knee" would be true and useless: it says the arm was configured the way
    # it was configured.
    #
    # So this reports the OBSERVATION (did the age grow, and how steadily) and
    # leaves the knee to be read off the SUSTAINED RATE above, which is the
    # service rate mu. The knee is mu by definition: an arrival rate below it
    # leaves the queue flat, one above it grows the queue without bound. A run
    # whose age did NOT grow while saturated is the interesting case - it means
    # the offered load never exceeded the system, so the sustained rate is a
    # floor rather than the ceiling.
    #
    # Growth is measured over the SECOND HALF only: the first half is the ramp
    # from an empty queue to steady state on any arm whose backlog was pushed
    # before the window opened.
    ages = [(float(r['epoch']), num(r, 'oldest_due_age_s')) for r in rows]
    ages = [(t, a) for t, a in ages if a is not None]
    half = len(ages) // 2
    tail = ages[half:]
    if len(tail) >= 4:
        first_a = tail[0][1]
        last_a = tail[-1][1]
        rises = sum(1 for i in range(1, len(tail)) if tail[i][1] > tail[i - 1][1])
        frac_rising = rises / (len(tail) - 1)
        print(f'oldest due-job age:    {first_a:.0f}s -> {last_a:.0f}s over the window\'s '
              f'second half ({frac_rising * 100:.0f}% of ticks rising)')
        # Deliberately two conditions, not one: a queue can rise on most ticks
        # while ending lower than it started (a sawtooth around a poll
        # cadence), and it can end higher after a single spike without being
        # unbounded. Both must hold before this reports growth.
        growing = last_a > first_a and frac_rising > 0.6
        if growing:
            print('queue growth:          YES - the system was offered more than it took, '
                  'so the sustained rate above IS the service rate, and therefore the knee')
        else:
            print('queue growth:          NO - the offered load did not exceed the system, '
                  'so the sustained rate above is a FLOOR on the ceiling, not the knee. '
                  'Offer more (deeper backlog or a faster poll cadence) and re-run')
    else:
        print('oldest due-job age:    too few ticks to judge growth')

    backlogs = [num(r, 'feed_backlog') for r in rows]
    known = [b for b in backlogs if b is not None]
    if known:
        print(f'stub feed backlog:     min={min(known):.0f} max={max(known):.0f} '
              f'(reaching 0 here is NORMAL and not starvation - the poll pump '
              f'converts upstream events into queued child jobs faster than '
              f'they drain, so the upstream empties while the system is busiest)')
    else:
        print('stub feed backlog:     unknown on every tick')

    # This, not the line above, is what post_guard_feed_starved consumes.
    avail = [num(r, 'available_work') for r in rows]
    known_avail = [a for a in avail if a is not None]
    if known_avail:
        m = min(known_avail)
        print(f'available work:        min={m:.0f} max={max(known_avail):.0f} '
              f'(upstream + due queue + running; min 0 means the system was IDLE '
              f'for part of the window, so the achieved rate is a floor on the '
              f'offered load rather than the system\'s ceiling)')
    else:
        print('available work:        unknown on every tick - the run cannot show '
              'its instrument kept offering load')

    peaks = [num(r, 'due_queued', 0.0) for r in rows]
    print(f'due-queued peak:       {max(p for p in peaks if p is not None):.0f}')


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('latency', 'throughput'):
        print(__doc__)
        sys.exit(2)
    if sys.argv[1] == 'latency':
        summarize_latency(sys.argv[2])
    else:
        summarize_throughput(sys.argv[2])
