# Allegro sandbox latency baseline - 2026-09-05

Issue: #2861 (child of epic #2840). Probe: `perf/openlinker-throughput/probes/allegro-latency.sh`.
Raw samples: `perf/openlinker-throughput/allegro-latency-samples-2026-09-05.json`.

**Updated 2026-09-06**: `GET /order/checkout-forms/{id}` moved from
"not safely measured" to measured (n=118 as of this update), once real sandbox purchases gave
it organic traffic. `/order/events`' numbers are unchanged from the
original 2026-09-05 measurement. See Result 2 below for the full account,
including the incident from the original version of this report, kept in
place rather than removed.

## What this is

A one-off **characterisation probe**, not a throughput run - no load beyond a small,
sequential sample. It measures the real per-request latency of the two Allegro
endpoints the #2856 stub is meant to reproduce, against the Allegro **sandbox**:

- `GET /order/events?from={cursor}&limit=100`
- `GET /order/checkout-forms/{id}`

## Environment

| | |
|---|---|
| Connection | `f0636f5f-de3a-4747-9b7f-1c18c0f24582` ("Allegro (sandbox)"), `status=active`, `config.environment=sandbox` |
| Sandbox host that answered | `https://api.allegro.pl.allegrosandbox.pl` (confirmed both from `allegro-hosts.ts`'s `SANDBOX_REST_API_BASE_URL` resolution for this connection's config, and directly in the worker's own error/request logs) |
| Stand | a local demo stack (`ol-demo-fresh-*` containers) - **not** the #2854 `lab` stand, which does not exist on `main` yet |
| Date / window | `/order/events`: 2026-09-05, 13:54:06 -> 21:53:08 (local container clock, UTC+2), approximately 8 hours. `/order/checkout-forms/{id}`: re-harvested 2026-09-06 over the worker container's full uptime (started 2026-09-05 13:38:09 UTC), which is when the operator's 25 sandbox purchases landed |
| Measurement method | see "Methodology" below - the worker's own `AllegroHttpClient` debug log line (`Response: <status> (<ms>ms) - <method> <path>`), which times only the `fetch()` round-trip, never OpenLinker's own downstream processing |

## Result 1 - `GET /order/events` - **MEASURED**

**Primary result: the distribution is TWO TIGHT CLUSTERS, not one number.**
This is the finding, and it is reported first because handing off a single
statistic (mean or otherwise) here would hide it:

| Cluster | n | % of sample | range |
|---|---|---|---|
| Fast | 247 | 51.5% | 90-338 ms |
| Slow | 232 | 48.3% | 1059-1374 ms |
| Outlier (see note below) | 1 | 0.2% | 11139 ms |

There is almost nothing between the two clusters (the gap between 338 ms and
1059 ms is empty). **The cause of the split is unestablished.** The obvious
candidate - two calls per poll tick, one paying a cold TLS handshake and one
reusing a warm connection - does not fit: the organic traffic sampled here is
exactly **one** `/order/events` call per minute (the `allegro-orders-poll`
scheduler cadence), roughly 60 s apart, so every call is equally cold by that
theory. No other mechanism was tested. The shape is measured; the cause is
not, and no mechanism is offered here beyond the one that was ruled out.

| Metric | Value |
|---|---|
| n | 480 |
| p50 | 276 ms |
| p90 | 1166 ms |
| p95 | 1194 ms |
| p99 | 1265 ms |
| min | 90 ms |
| max | 11139 ms (see outlier note below) |
| mean (all 480) | 655.1 ms |

Percentiles use the nearest-rank method already established in this repo's perf
tooling (`perf/prestashop-baseline/storefront-probe.sh`):
`vals_sorted[min(len-1, round(p/100*len)) - 1]`. Result 2 below uses the
same method and formula.

**The mean (655 ms) describes neither cluster and should not be read as "the"
latency.** A stub paced at the mean models every request as half-cold -
slower than every fast-cluster call and faster than every slow-cluster call,
which matches *no* request actually observed on this sandbox. p50 (276 ms)
at least lands inside a real cluster (the fast one); the mean lands in the
empty gap between them. See "Hand-off" below for what this means for
`STUB_PER_REQUEST_LATENCY_MS`.

**Outlier note.** One sample reads 11139 ms, well outside both clusters. The
log for that request shows a `RedisRateLimiterAdapter` warning - *"Redis
rate limiter for connection f0636f5f-... still degraded. Redis rate-limiter
call 'checkPace' timed out after 1000ms"* - inside the same measurement
window (the pacing gate runs *after* `startTime` is captured and *before*
the `fetch()` call, so its wait is included in the client's own duration
measurement). This sample is very likely dominated by OpenLinker's own
Redis contention on this shared demo stack, not by Allegro. It is **kept in
the reported set** rather than silently dropped (`perf/prestashop-baseline`'s
own discipline: *"the harness must not prune what it is measuring"*); it
moves `max` and the mean, and does not move `p95` at all (rank 456 of 480,
well below the single max).

Zero non-2xx responses were observed across all 480 samples.

## Result 2 - `GET /order/checkout-forms/{id}` - **MEASURED, n=118**

An operator purchased on 25 sandbox auctions after the first version of this
report shipped, which finally gave this endpoint real organic traffic. It was
re-harvested independently (not by trusting a hand-off sample file), the same
passive way as `/order/events`: `docker logs ol-demo-fresh-worker` since
container start, filtered to `Response: <status> (<ms>ms) - GET
/order/checkout-forms/` and correlated to this connection by trace id -
**zero added load**, same as Result 1.

| Metric | Value |
|---|---|
| n | 118 |
| p50 | 1106 ms |
| p90 | 1168 ms |
| p95 | 1217 ms |
| p99 | 2139 ms |
| min | 68 ms |
| max | 7960 ms (see outlier note below) |
| mean | 1062.1 ms |
| stdev (sample) | 718.3 ms |

Bucketed (200 ms):

| Bucket | Count | % of n |
|---|---|---|
| 0-199 ms | 4 | 3.4% |
| 200-399 ms | 5 | 4.2% |
| 400-599 ms | 6 | 5.1% |
| 600-799 ms | 6 | 5.1% |
| 800-999 ms | 3 | 2.5% |
| 1000-1199 ms | 87 | 73.7% |
| 1200-1399 ms | 4 | 3.4% |
| 2000-2199 ms | 2 | 1.7% |
| 7800-7999 ms | 1 | 0.8% |

Zero non-2xx responses.

**Outlier note.** One sample reads 7960 ms - visibly separate from the
1000-1199 ms mode and from the two ~2100 ms samples. Unlike `/order/events`'
11139 ms outlier, no `RedisRateLimiterAdapter` warning or other proximate
cause appears near this request in the worker log; it is reported as
unexplained, not attributed to anything. It moves `max`, `mean` and `stdev`
noticeably (this sample alone accounts for a large share of the jump in
`stdev` from an earlier, smaller harvest of this same endpoint - see the
"harvested at a moving target" note below); it does not move `p95` (rank
112 of 118).

**This sample set was harvested at a moving target, and that is stated
rather than hidden.** The `source_deleted` orders behind most of these
requests keep retrying in the background for as long as this report is
being written, so re-running the harvest minutes apart yields a growing
`n` and a growing spread - this table reflects one specific harvest,
`docker logs ol-demo-fresh-worker --since 700m`, taken 2026-09-05T22:56:55Z.
An earlier harvest of the same endpoint, taken about two minutes prior,
read n=98 with a materially smaller spread (p50=1084ms, max=2139ms,
stdev=334.3ms) - both are real, correct readings of the same live retry
ladder at two different instants, not a discrepancy to reconcile. Re-running
`probe_checkout_forms` later than this report's own timestamp will read a
larger `n` again, for the same reason.

**One sample was excluded from this set on purpose**: the smoke-test call
this report's first version already disclosed
(`externalOrderId=907b5790-9bbe-11f1-bd08-9328d2ed1733`, 1157 ms, the call
that produced the PrestaShop side effect described below) is a real HTTP
response but not part of the real-purchase burst this measurement is about,
so it is left out of the n=118 above rather than silently mixed in. Including
it would not move any statistic meaningfully (it falls inside the dominant
1000-1199 ms bucket), but the exclusion is stated because a mixed-provenance
sample set is the kind of thing that should never be silent.

**This endpoint is unimodal - unlike `/order/events`.** One dominant peak at
1000-1199 ms holds 73.7% of the sample, a thin, spread-out fast tail sits
below 1000 ms (20.3% combined across five buckets, none of them concentrated
the way `/order/events`' fast cluster was), and a handful of outliers sit
above 2000 ms. This is a real, measured contrast with Result 1's two tight
clusters, and it narrows what a bimodal `/order/events` could be down to -
**the split is a property of that endpoint, not of the client, the network,
or this connection**, since the same client, network and connection produce
one mode here. No mechanism for *why* either endpoint has the shape it does
is offered beyond that comparison.

**p50 here (1106 ms) is roughly four times `/order/events`' p50 (276 ms).**
On its face this is plausible - a checkout-forms fetch hydrates an entire
order body while an events-feed page returns references - but that is
stated as a plausible reading of two measured numbers, not as an explained
cause; nothing here confirms it.

**The 118 samples come from 23 distinct orders, not 23 the way one order =
one sample.** Fetch counts per order ranged from 1 to 10 (mean 5.13 fetches
per order at this harvest instant - see the "moving target" note above for
why that mean itself keeps climbing). That makes n=118 an honest count of
independent HTTP requests - which is what a *latency* figure measures - but
reading a *throughput* claim ("OpenLinker fetched 118 orders") off this
sample would be wrong; it fetched 23.

**Why the re-fetch count is uneven, and why that is itself a cost finding.**
Querying `order_records.recordStatus` for these 23 orders: **19 are
`source_deleted`** (the master-side variant behind at least one order line
has been deleted - a permanently unresolvable condition per the `#1599`
deletion-signal design) and **4 are `ready`** (fully resolved). The 4 `ready`
orders were fetched 1-2 times each; the 19 `source_deleted` orders were
fetched 5-10 times each at this harvest instant, and climbing - confirmed
against one of them directly, re-checked at the same instant as this
harvest (`sync_jobs`: `jobType=marketplace.order.sync`, `attempts=5`,
`status=queued` (still retrying), `lastError`:
*"Marketplace order sync failed: Missing mapping for order item productRef"*).
`OrderIngestionService.syncOrderFromSource` calls `getOrder()` unconditionally
on every attempt, above item resolution, so **each retry re-issues a full
`GET /order/checkout-forms/{id}` for zero forward progress** - the
underlying condition does not change between attempts. This is reported as
a **cost observation for the measurement programme**, not a claim that the
retry behaviour is wrong: a mapping can legitimately reappear later (which
is exactly why `MissingOrderItemMappingError` stays retryable rather than
terminal), so the repeated fetch is the correct price of keeping that door
open, not a bug. It does mean a stub or a throughput model that assumes "one
checkout-forms fetch per order" will undercount real cost on a connection
carrying any stale-variant backlog - #2856's own `1 + N` cost model
(§ "Proposed Solution") states the fetch is "1x per `marketplace.order.sync`
job", which is correct as read (one fetch per JOB) but silently assumes one
job per order, which this sample shows is not always true.

**The sampling-pattern caveat from Result 1 does not apply here.** This is a
genuine purchase burst (25 sandbox auctions in a short window), not a
once-a-minute poll - so nothing here should be read as "coldest possible
pattern" the way `/order/events`' figure is; see "What this did not
establish" below for what is still open.

### The earlier incident, kept for the record

The first version of this report measured this endpoint by actively
re-triggering it (there was no organic traffic yet), and that attempt is
preserved here in full because it caused a real side effect and the honesty
rules this issue runs under require it to be stated rather than removed once
superseded by a better measurement.

#### What happened

There is no organic traffic for this endpoint: `identifier_mappings` on this
connection carries Order rows going back to 2026-08-20, but **none of them
has ever had a second (destination) mapping** - meaning every Allegro order
ever ingested on this connection has never actually been pushed to a
destination shop. So, unlike `/order/events`, there was nothing to passively
harvest.

The natural way to trigger this endpoint through the running system is to
re-enqueue `marketplace.order.sync` for an already-known `externalOrderId` -
`OrderIngestionService.syncOrderFromSource` calls `getOrder()`
unconditionally as its first step, which is exactly the call this probe
wants to measure. A smoke test of this approach was run against one
pre-existing order (`externalOrderId=907b5790-9bbe-11f1-bd08-9328d2ed1733`),
expecting it to be a safe no-op re-sync: `OrderSyncService.createOrderIdempotently`
is documented to skip re-creating an order at a destination when a mapping
already exists for it.

**That assumption was wrong for this specific order.** Because no destination
mapping existed for it (see above), the re-sync's `getOrder()` call
succeeded - producing the one real sample below - but the pipeline then
continued past `getOrder()` into `OrderSyncService.syncOrder()`, which fans
out to every active `OrderProcessorManager`-capable connection. On this
stand that includes an active PrestaShop connection. **The re-sync created a
real order in the demo PrestaShop** (`ps_orders.id_order=28`, reference
`907b5790-9bbe-11f1-bd08-9328d2ed1733`, created 2026-09-05 23:50:07 local
container time, total 1009.95 PLN). No further samples were taken by this
method once this was discovered - repeating it 20 times as originally
planned would have created 20 real duplicate orders on a shared demo stack,
which is unacceptable.

**This was not cleaned up.** An attempted SQL cleanup (deleting the
`ps_orders` / `ps_order_detail` / `ps_order_carrier` / `ps_order_history` /
`ps_order_invoice` / `ps_order_invoice_payment` rows for `id_order=28`, and
restoring the one unit of stock the order likely decremented on
`ps_stock_available` for `id_product=21`) was refused by this environment's
own safety controls before it ran. **The order still exists on the demo
stand as of this writing** and needs an operator decision: leave it (it is
real but harmless test data - one extra order, one unit of stock
potentially off by one on product 21, "Handmade Ceramic Mug - Linen Glaze
300ml") or run the cleanup below by hand:

```sql
-- Run against the demo stand's PrestaShop MySQL database.
-- Restores stock BEFORE deleting the order rows.
UPDATE ps_stock_available SET quantity = quantity + 1
  WHERE id_product = 21 AND id_product_attribute = 0;
DELETE FROM ps_order_invoice_payment WHERE id_order = 28;
DELETE FROM ps_order_invoice WHERE id_order = 28;
DELETE FROM ps_order_history WHERE id_order = 28;
DELETE FROM ps_order_carrier WHERE id_order = 28;
DELETE FROM ps_order_detail WHERE id_order = 28;
DELETE FROM ps_orders WHERE id_order = 28;
```

The corresponding OpenLinker side needed **no cleanup**: `identifier_mappings`
never gained a new row for this order (the `persistDestinationMapping` write
apparently hit a pre-existing, unrelated stale mapping under the same
`externalId="28"` - a `prestashop` mapping from 2026-07-30 pointing at a
different, seemingly-deleted internal order - and did not persist a new
mapping row; PrestaShop's own `id_order` autoincrement had, separately,
already reset to a low value on this stand before this investigation
started). This is recorded as observed, not fully explained - a second,
unrelated pre-existing data inconsistency on this demo stand.

#### The fix - a safety gate, now built into the script

`perf/openlinker-throughput/probes/allegro-latency.sh` now refuses to run the
active checkout-forms probe by default whenever any *other* active
`OrderProcessorManager`-capable connection exists on the deployment (queried
via `GET /v1/connections?status=active`) - which is exactly the situation
above. It only proceeds if the operator sets
`FORCE_CHECKOUT_FORMS_PROBE=yes`, after first confirming (via the SQL query
in the script's own header) that every id in `ORDER_EXTERNAL_IDS` already
carries a destination mapping, so a re-sync is provably a no-op skip rather
than a real create. Running it again on this demo stand was refused by that
gate as expected:

```
[allegro-latency] WARN  active OrderProcessorManager-capable connection(s) found: PrestaShop (demo store) (...);WooCommerce (demo shop) (...)
[allegro-latency] WARN  re-syncing an externalOrderId with no existing destination mapping WILL create a real order there
[allegro-latency] WARN  refusing to run the checkout-forms probe (set FORCE_CHECKOUT_FORMS_PROBE=yes to override, only after confirming every ORDER_EXTERNAL_IDS value already has a destination mapping)
```

The safe way to take this measurement is one of:

1. Find `externalOrderId` values that already have a destination mapping
   (the query in the script header) and pass those via `ORDER_EXTERNAL_IDS`
   with `FORCE_CHECKOUT_FORMS_PROBE=yes` - this stand had **zero** such rows
   at the time of this run.
2. Run against a stand with no live destination connection at all (the
   future #2854 `lab` stand, once #2856's stub exists - that stand is built
   specifically so this class of side effect is a stub call, not a real
   shop write).
3. Temporarily disable every `OrderProcessorManager`-capable connection on
   the stand before running, so `resolveDestinations` finds nothing to fan
   out to (`getOrder()` still runs and is still measured; the destination
   fan-out step then fails cleanly with nothing written, instead of
   succeeding at a real destination). Not attempted here - disabling shared
   connections on a demo stand other work may be using at the same time was
   judged too disruptive for a one-off measurement, on top of the incident
   already caused.

None of the three was exercised at the time - option 1 had no eligible data
on this connection, option 2's stand does not exist yet, and option 3 was
declined as disproportionate risk for a repeat measurement. **This is why
the endpoint was reported unmeasured in the first version of this report.**
It has since become measurable for an unrelated reason (real purchases
happened), which is Result 2 above; the safety gate stays in the script
regardless, since the active path it guards is still the only way to
measure this endpoint on a stand with no organic order traffic at all.

The one real sample this incident produced (`externalOrderId=907b5790-...`,
1157 ms) is the sample excluded from Result 2's n=118 above, for the
provenance reason given there.

## What this did not establish

- **Production latency.** Everything above is sandbox (`api.allegro.pl.allegrosandbox.pl`).
  Production latency is unmeasured and this probe makes no claim about it.
- **Concurrency behaviour.** Every sample here is sequential; nothing was
  measured about what happens to latency (or to Allegro's own rate limiting)
  under concurrent requests.
- **Rate-limit response.** No 429 was provoked or observed. Allegro's
  documented budget (9000 req/min/client-id) was never approached.
- **Why `/order/events` is two clusters and `/order/checkout-forms/{id}` is
  one.** Reported as a comparison of two measured shapes, not diagnosed. One
  candidate mechanism for the events split (cold vs. warm connection reuse)
  was tested and ruled out (there is exactly one call per minute, so nothing
  is ever "warm" by that theory); no other mechanism was tested for either
  endpoint, and none is offered here.
- **Why 25 sandbox purchases produced 23 distinct order ids** in the
  harvested window. Not investigated - stated as observed, not explained.
- **Whether the `source_deleted` re-fetch pattern (19 of 23 orders, 4-9
  fetches each) is specific to this sandbox catalogue** or would recur on
  any connection with a similar rate of deleted master variants. One
  connection, one snapshot in time.
- **Whether this sampling pattern is representative of a sustained rate.**
  Every `/order/events` sample here was pulled from a **once-a-minute poll**
  - the coldest possible request pattern the client can produce, with
  roughly 60 seconds of idle time between every pair of calls. F1 and F2
  apply a **sustained ramp**, where the same connection is reused
  back-to-back at a real arrival rate. This probe cannot say whether the
  two clusters above still both occur under that pattern, whether one
  cluster dominates, or whether a warm/bursty path is faster than either -
  only that a once-a-minute poll produces this specific split. **This
  figure may systematically over-represent cold-path latency**, and a
  burst is plausibly faster; that is unmeasured here and should be treated
  as an open question for whoever runs F1/F2 against a stub paced from
  this report.

## Hand-off - the stub default this feeds

#2856 (the Allegro stub) and #2854 (the `docker-compose.lab.yml` service
definition carrying `STUB_PER_REQUEST_LATENCY_MS`) do not exist on `main` as
of this branch (`2861-allegro-latency-probe`, branched from `main` after
#2905) - both are still open PRs against `perf/openlinker-throughput/`. This
report cannot edit a file that is not there yet.

**A single-latency knob cannot express what was measured.** The real
distribution is two tight clusters roughly 51/49 (90-338 ms and 1059-1374
ms) with almost nothing between them - not a spread around a centre, and
not a long tail off a fast median either. `STUB_PER_REQUEST_LATENCY_MS`'s
own shape (`docker-compose.lab.yml` naming it a single scalar) cannot
reproduce that under any choice of value. **This is itself a finding for
#2856**: the stub may need a two-point (or weighted-random two-point)
distribution rather than one constant, if reproducing this shape matters to
what #2847/#2848 measure. That redesign is out of scope here; it is
recorded so #2856 does not silently absorb a single number as if it were
sufficient.

If #2856 must ship with one constant anyway (e.g. as a first cut, or
because the two-point redesign is deferred), the value to use for
`/order/events` is **p50, 276 ms - never the mean**. The mean (655 ms) was
considered and refused: it falls in the empty gap between the two clusters
and would pace every stub response as "half-cold," a request shape that
never actually occurred in 480 real samples. p50 at least reproduces one
real, observed mode (the fast cluster) rather than a value between two
poles that neither corresponds to anything Allegro ever returned.

**`GET /order/checkout-forms/{id}` is now measured too, and it makes the
single-constant problem worse, not better.** Its own p50 is 1106 ms - about
four times `/order/events`' 276 ms - and it is unimodal where events is
bimodal, so the two endpoints do not even share a shape, let alone a
number. `STUB_PER_REQUEST_LATENCY_MS` today applies to every stub request
regardless of which endpoint it answers (`docker-compose.lab.yml` carries
one env var, not one per endpoint). That means whichever single figure
#2856 picks, it is now a **known, measured** mismatch for at least one
endpoint's dominant mode - not an unmeasured gap being filled in for want
of a second sample, which is what the first version of this report said.
No blended number is offered in its place: averaging 276 ms and 1106 ms
would produce a number that matches neither endpoint's actual traffic, the
same objection that ruled out the events mean above.

**The recommendation is therefore to give the stub a per-endpoint
constant** (`STUB_ORDER_EVENTS_LATENCY_MS` / `STUB_CHECKOUT_FORMS_LATENCY_MS`,
or equivalent), each set from that endpoint's own p50, rather than one
`STUB_PER_REQUEST_LATENCY_MS` shared across both:

```yaml
# perf/openlinker-throughput/docker-compose.lab.yml (or wherever #2854 lands
# the allegro-stub service definition)
environment:
  STUB_PORT: '8080'
  # Measured against the Allegro sandbox, 2026-09-05 (events) and 2026-09-06
  # (checkout-forms, once real sandbox purchases gave it organic traffic) -
  # see perf/openlinker-throughput/results-allegro-latency-2026-09-05.md.
  #
  # /order/events is TWO CLUSTERS (90-338ms, 51.5%; 1059-1374ms, 48.3%);
  # /order/checkout-forms/{id} is ONE cluster (1000-1199ms, 73.7%) at
  # roughly 4x the events p50. A single shared constant is a known,
  # measured mismatch for whichever endpoint it is not tuned to - see the
  # report's "Hand-off" section. Each value below is that endpoint's own
  # measured p50 (never the mean - see the report for why the mean is
  # refused for events; checkout-forms' figure is itself a moving target -
  # its retry-ladder-driven samples keep accumulating for as long as
  # stale-variant orders keep retrying, see the report's outlier note - so
  # re-measure before trusting this value for long).
  STUB_ORDER_EVENTS_LATENCY_MS: '276'
  STUB_CHECKOUT_FORMS_LATENCY_MS: '1106'
  # If the stub cannot yet be split per endpoint, STUB_PER_REQUEST_LATENCY_MS
  # has no defensible single value - pick one endpoint's figure knowing it
  # misrepresents the other by roughly 4x.
```

Whoever picks this up should also replace #2854's current placeholder
comment (*"Placeholder - see #2856's separately-filed sandbox latency
baseline"*) with a citation of this report's path, per this issue's own
acceptance criterion.

## Acceptance criteria - status

- [x] p50 and p95 recorded for `/order/events`, with sample size, date, and
      sandbox host.
- [x] p50 and p95 recorded for `/order/checkout-forms/{id}`, with sample
      size, date, and sandbox host - satisfied on a second pass, once real
      sandbox purchases gave this endpoint organic traffic (n=118 at this
      report's own harvest instant, and growing as the sample is a moving
      target - see "Result 2" above for both why the sample keeps growing
      and why this endpoint's own n differs from the raw purchase count).
- [~] The measured value becomes `STUB_PER_REQUEST_LATENCY_MS`'s default in
      #2856 - **cannot be satisfied directly**, since neither #2854 nor
      #2856 exist on `main` yet (both are open, unmerged PRs against this
      same directory - see the epic's own conflict-avoidance note on this
      issue). See "Hand-off" above for both endpoints' values, the
      recommendation to split the knob per endpoint, and the citation to
      carry over once either PR lands.
- [x] The report states explicitly that this is sandbox latency and
      production is unmeasured.
- [x] The report states that a stub answering instantly measures only
      OpenLinker's local overhead, so this constant is what makes #2847 and
      #2848 externally meaningful rather than merely self-consistent - see
      the paragraph immediately below.
- [x] Labelled **measured** (both endpoints) in the honesty ledger, with a
      "what this did not establish" section.
- [x] No load applied beyond a sequential probe - both endpoints' measured
      figures used **zero** additional load (pure passive harvest of
      traffic the deployment/the operator's purchases already generated);
      the superseded active-probe attempt used exactly one active request
      before being aborted, per the incident account kept in Result 2.

**On the "mock is now the model" point directly**: a stub configured with
`STUB_PER_REQUEST_LATENCY_MS: '0'` (or any value far below what was measured
here) would make every downstream throughput figure (#2847, #2848) a
measurement of OpenLinker's own per-request overhead alone, with no
connection to what a real marketplace round-trip actually costs. The 598
real, sandbox-sourced samples above (480 for `/order/events`, 118 for
`/order/checkout-forms/{id}` at this report's harvest instant) are what
makes that stub's numbers stand for
something outside OpenLinker, even though a single constant per endpoint -
or worse, one constant shared across both - is necessarily a flattened
stand-in for two distributions that are demonstrably not flat and not even
shaped alike.
