# Allegro sandbox latency baseline - 2026-09-05

Issue: #2861 (child of epic #2840). Probe: `perf/openlinker-throughput/probes/allegro-latency.sh`.
Raw samples: `perf/openlinker-throughput/allegro-latency-samples-2026-09-05.json`.

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
| Date / window | 2026-09-05, 13:54:06 -> 21:53:08 (local container clock, UTC+2) - approximately 8 hours |
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
`vals_sorted[min(len-1, round(p/100*len)) - 1]`.

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

## Result 2 - `GET /order/checkout-forms/{id}` - **NOT SAFELY MEASURED**

**No active-probe sample set exists for this endpoint on this stand, and none was
forced through.** This section explains why, in full, because the reason is a
real incident during this investigation and the honesty rules this issue is
run under require it to be stated rather than smoothed over.

### What happened

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

### The fix - a safety gate, now built into the script

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

None of the three was exercised in this run (option 1 had no eligible
data, option 2's stand does not exist yet, option 3 was declined as
disproportionate risk for a repeat measurement). **`GET /order/checkout-forms/{id}`
is therefore unmeasured on this stand as a percentile.**

### One incidental data point (not a percentile)

The single real, successful call made during the smoke test above:

| | |
|---|---|
| n | 1 |
| latency | 1157 ms |
| status | 200 |

This is **not** reported as a p50/p95 - a sample of one supports neither.
It is noted only because it falls squarely inside the *slow* cluster of the
`/order/events` distribution above (the 1000-1400 ms hump), which is weak,
single-point corroboration that the two endpoints are of the same order of
magnitude on this sandbox rather than wildly different - nothing stronger
should be read into it.

## What this did not establish

- **Production latency.** Everything above is sandbox (`api.allegro.pl.allegrosandbox.pl`).
  Production latency is unmeasured and this probe makes no claim about it.
- **Concurrency behaviour.** Every sample here is sequential; nothing was
  measured about what happens to latency (or to Allegro's own rate limiting)
  under concurrent requests.
- **Rate-limit response.** No 429 was provoked or observed. Allegro's
  documented budget (9000 req/min/client-id) was never approached.
- **`GET /order/checkout-forms/{id}` as a percentile**, for the reasons
  above - only n=1 exists, and it is not reported as one.
- **Why `/order/events` is two clusters instead of one.** Reported as an
  observation. One candidate mechanism (cold vs. warm connection reuse) was
  tested and ruled out (there is exactly one call per minute, so nothing is
  ever "warm" by that theory); no other mechanism was tested, and none is
  offered here.
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
because the two-point redesign is deferred), the value to use is **p50,
276 ms - never the mean**. The mean (655 ms) was considered and refused: it
falls in the empty gap between the two clusters and would pace every stub
response as "half-cold," a request shape that never actually occurred in
480 real samples. p50 at least reproduces one real, observed mode (the fast
cluster) rather than a value between two poles that neither corresponds to
anything Allegro ever returned.

```yaml
# perf/openlinker-throughput/docker-compose.lab.yml (or wherever #2854 lands
# the allegro-stub service definition)
environment:
  STUB_PORT: '8080'
  # Measured against the Allegro sandbox, 2026-09-05, n=480, sequential -
  # see perf/openlinker-throughput/results-allegro-latency-2026-09-05.md.
  # The real distribution is TWO CLUSTERS (90-338ms, 51.5%; 1059-1374ms,
  # 48.3%) with almost nothing between them - a single constant cannot
  # reproduce that shape (see the report's "Hand-off" section: this may be
  # a finding that the stub needs a two-point distribution, not one knob).
  # This value is p50 across all real /order/events samples, chosen
  # because it lands inside a real cluster; the mean (655ms) was
  # considered and refused because it falls in the gap between the two
  # clusters and matches no request ever actually observed. checkout-forms
  # itself is UNMEASURED (only one incidental 1157ms sample exists); this
  # default is order/events' own figure, applied to both endpoints for
  # want of a measured second one.
  STUB_PER_REQUEST_LATENCY_MS: '276'
```

Whoever picks this up should also replace #2854's current placeholder
comment (*"Placeholder - see #2856's separately-filed sandbox latency
baseline"*) with a citation of this report's path, per this issue's own
acceptance criterion.

## Acceptance criteria - status

- [x] p50 and p95 recorded for `/order/events`, with sample size, date, and
      sandbox host.
- [ ] p50 and p95 recorded for `/order/checkout-forms/{id}` - **not
      satisfied**; see "Result 2" above for the full reason. One incidental
      n=1 sample is reported instead of a percentile.
- [~] The measured value becomes `STUB_PER_REQUEST_LATENCY_MS`'s default in
      #2856 - **cannot be satisfied directly**, since neither #2854 nor
      #2856 exist on `main` yet (both are open, unmerged PRs against this
      same directory - see the epic's own conflict-avoidance note on this
      issue). See "Hand-off" above for the exact value and citation to carry
      over once either PR lands.
- [x] The report states explicitly that this is sandbox latency and
      production is unmeasured.
- [x] The report states that a stub answering instantly measures only
      OpenLinker's local overhead, so this constant is what makes #2847 and
      #2848 externally meaningful rather than merely self-consistent - see
      the paragraph immediately below.
- [x] Labelled **measured** (order/events) in the honesty ledger, with a
      "what this did not establish" section.
- [x] No load applied beyond a sequential probe - order/events used **zero**
      additional load (pure passive harvest of traffic the deployment
      already generates every minute); the checkout-forms attempt used
      exactly one active request before being aborted.

**On the "mock is now the model" point directly**: a stub configured with
`STUB_PER_REQUEST_LATENCY_MS: '0'` (or any value far below what was measured
here) would make every downstream throughput figure (#2847, #2848) a
measurement of OpenLinker's own per-request overhead alone, with no
connection to what a real marketplace round-trip actually costs. The 480
real, sandbox-sourced samples above are what makes that stub's number stand
for something outside OpenLinker, even though the constant itself is
necessarily a flattened, single-value stand-in for a distribution that is
demonstrably not flat.
