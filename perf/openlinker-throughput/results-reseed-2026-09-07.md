# Re-measuring on a realistic dataset (epic #2840)

_Stand: `lab` (docker-compose.lab.yml, #2854). **Every figure here is measured unless
it is explicitly labelled `derived`** - there is exactly one derived conclusion in the
report (§ 7, why the catalogue was inserted rather than replicated) and nothing is
extrapolated. § 10 states what this pass did not establish._

---

## 0. Two corrections to figures already in circulation

**Read these first. Both are corrections to numbers from
`results-F5-2026-09-06.md` that have been quoted since, and both change a decision
somebody could be making now.**

### Correction 1: the sub-linear scaling was a one-off. Do not size on it.

F5 reported that 10x the rows cost only **3.6x** the time on the needs-attention
`COUNT`, and explained it as Postgres switching to a `Parallel Seq Scan` - real, and
correctly diagnosed. It has since been repeated as though it described the curve.

**It described a boundary, and the boundary has been crossed.** A fourth point at 2M
rows:

| Step | rows | filtered COUNT | ratio |
|---|---:|---:|---:|
| 100k -> 1M (previous pass) | 10x | 39.64 -> 141.89 ms | **3.58x** |
| **1M -> 2M (this pass)** | **2x** | 148.55 -> 273.18 ms | **1.84x** |

Fitting a power law to the first row gives an exponent of 0.55, predicting `2^0.55 =
1.47x` for a doubling. The measured figure is **1.84x** - the prediction is low by
about 25%, and the unfiltered `COUNT` on the same table behaves identically
(36.25 -> 64.61 ms, 1.78x). The parallel plan was already in use at 1M, so there was
no further plan change left to absorb the growth.

**Anyone sizing hardware past 1M orders should assume linear.** Detail in § 3.5.

### Correction 2: "`product_detail` is flat" is scoped to ORDER growth only

F5 states that *"`order_detail` and `product_detail` are flat across three orders of
magnitude ... both are primary-key point lookups, unaffected by table growth"*. The
claim is not wrong - it is **narrower than it reads**, because the only thing that
grew in that campaign was `order_records`.

Grow the **catalogue** instead, holding orders and their distribution fixed:

| Route | 10 006 products | 60 006 products | |
|---|---:|---:|---:|
| `product_detail` | 5.58 ms | **14.49 ms** | **2.60x** |
| `products_list` | 9.53 ms | **36.21 ms** | **3.80x** |
| `order_detail` (control) | 5.07 ms | 5.28 ms | 1.04 |

`product_detail` is not a lone point lookup: it fans out to the product's variants,
its inventory positions and its identifier mappings. `order_detail` has no such
fan-out and stays flat, so the original claim holds for it. **Quote the claim with
its axis, or it becomes a wrong decision.** Detail in § 3.4.

---

## 0b. And two things about method that carried the rest

**A prediction failed, and the reason is the finding.** § 6.1 predicted the order path
would slow down on a diverse catalogue, because PrestaShop's tax-rate cache is
per-product. **Requests per order fell on both arms instead** - arm A 11.22 -> 11.09,
arm BD 10.16 -> 10.08 - even though a BD window now touches **92-94 distinct
products** where the old dataset's entire offer pool resolved to **six**.

The mechanism is the useful part: exactly **one line of the per-order request budget
is product-keyed**, about 9% of it, and everything else is per-order or per-buyer (a
new customer and address every order, carriers uncached, currencies, countries, order
states). **Catalogue size structurally cannot reach this flow** - a stronger statement
than the slowdown would have been, and arm BD is the clean test of it because its
cache is genuinely cold for most of a window (§ 6.5).

**The dataset is credible because of a control, not because of a row count.** The
seeded products resolve through the shop's own webservice (**200**) and the old
synthetic mappings do not (**404**). That pair only means something because the
control - an id nothing holds - 404s in the same run: two earlier versions of that
probe answered `000` and then `301` for **every** id, including known-good ones, and
either would have read as "the seeded data is broken" (§ 4).

_Everything here is measured on a contended single-workstation stand. These are
floors, not ceilings, and § 10 lists what the pass did not establish._

_One process note, so a reader is not surprised by the ordering: the repository gate
(`pnpm check:invariants`, `lib-test.sh`) was run **after** the measurement windows
closed, not before. That was deliberate - both walk the tree and would have added CPU
to the host during a window, and this report's whole subject is a stand whose figures
are already qualified by host contention. `bash -n` on the changed scripts ran
throughout._

**One more read-path conclusion was tested and SURVIVED**: "the page is fast, the
total is slow" holds at a realistic 0.591% needs-attention share, even though the old
seed had been flattering exactly the half that conclusion exonerated (§ 3.3).

---

## 1. Why this pass exists

The campaign's figures were taken against a dataset thin enough that a reader could
reasonably ask whether they meant anything. OpenLinker's own tables held ~10 000
products and ~1 000 000 orders, but **the shop behind them held six products**, and
the seeded order population put **27.7%** of all orders in the needs-attention bucket.

Both distortions are load-bearing rather than cosmetic, and they push in opposite
directions.

- **The six-product shop makes the order path look FASTER than it is.** PrestaShop's
  tax-rate resolution caches per `(connection, product, country)` for 24 h, so a
  window touching six products warms the cache after six orders and every later order
  pays a cheaper request count. `results-limiter-ab-2026-09-07.md` § 5 establishes
  that the order path's ceiling is `(requestsPerMinute / requests-per-order) x 60`
  orders per hour - so requests-per-order is not one input among many, it is a direct
  divisor of the throughput.
- **The 27.7% failure rate flatters the read path's PAGE query.** The needs-attention
  COUNT is a non-sargable full scan whose cost barely moves with selectivity, but the
  page beside it walks `IDX_order_records_createdAt` backwards applying the same
  filter until twenty rows pass - so its cost is inversely proportional to the match
  rate.

`bootstrap.sh` already knew about the first one. Its offer-mapping step points every
offer at a variant whose product carries a **numeric** PrestaShop external id, warns
that the 200-offer pool cannot hold on a six-product shop, and names the remedy in
its own comment: *"A numeric test rather than a hardcoded list, so a stand that later
grows a real catalogue picks it up automatically."* This pass grows that catalogue.

---

## 2. The dataset: what it is, and how each side was populated

**Read this before any figure below.** The provenance is what makes the numbers
interpretable, and its absence is what made the previous ones questionable.

| | Before | After |
|---|---:|---:|
| PrestaShop `ps_product` | **6** | **50 006** |
| PrestaShop `ps_product_attribute` (combinations) | 8 | 66 675 |
| PrestaShop `ps_stock_available` | 25 | 116 692 |
| PrestaShop distinct default categories | **1** | **7** (seeded set; 8 shop-wide) |
| PrestaShop distinct product prices | **6** | **50 000** (seeded set) |
| OL `products` | 10 006 | 60 006 |
| OL `product_variants` | 20 011 | 111 678 |
| OL `inventory_items` | 40 011 | 131 678 |
| OL `identifier_mappings` | 65 644 | 207 311 * |
| OL `order_records` | 1 002 561 | 2 002 561 |
| OL `order_line_items` | 2 501 874 | 5 001 312 |
| OL `sync_jobs` (held constant) | 137 708 | 137 708 |
| needs-attention share | **27.686%** | **0.591%** |
| 200-offer pool -> distinct destination-resolvable variants | **11** | **200** |
| 200-offer pool -> distinct destination-resolvable **products** | **6** | **110** |

\* **Every count in this table is as at the F5 runs (§ 3), which is when they were
taken and what they describe.** Two of them are not static afterwards: the order-path
scenario in § 6 creates real orders, so it adds a few hundred to `order_records` and a
handful of `identifier_mappings` per order. `identifier_mappings` in particular reads
207 406 mid-§ 6 against the 207 311 above; the figure is cross-checked against run C's
own plan (`Parallel Seq Scan`, 69 104 rows per worker x 3 = 207 312). The catalogue
counts and the needs-attention share are static throughout.

**How each side was populated, plainly:**

- **The PrestaShop catalogue was INSERTED, not replicated.** `seed-shop-catalogue.sh`
  writes MySQL rows directly, cloning round-robin from the six products the shop
  already had - three simple and three multi-variant - and then varying price,
  category, manufacturer, name and stock per row by deterministic arithmetic on the
  ordinal. So the seeded catalogue inherits the shop's own structural mix rather than
  one hand-picked shape, and re-running with the same count and template set
  reproduces it exactly.
- **The OpenLinker projection was INSERTED too, keyed to the shop's real ids.** It did
  **not** come through `master.product.syncAll`. The external ids are the adapter's
  own shapes - `String(id_product)` for a product, `String(id_product_attribute)` for
  a combination, and `'product:' || id_product` for a simple product's synthetic
  variant - so a mapping lookup lands on a row the shop can serve, which is the
  property the previous dataset lacked.
- **Why not replicate through the real sweeps** (derived, see § 7 for the arithmetic):
  the request cost is affordable but the sweep's own pacing is not - one full cycle
  over 50 000 products is **~33 hours** at the shipped budget and cadence.
- **The orders were inserted by `seed-orders.sh`** (the existing seeder), grown from
  1 000 000 to 2 000 000 seeded rows, the new generation at a realistic per-destination
  failure rate. The pre-existing 1 000 000 had their `syncStatus` rewritten in place by
  `rebalance-sync-status.sh`.
- **2 561 orders on the stand are real**, created by earlier order-path runs against
  the live PrestaShop. They are not seeded and `rebalance-sync-status.sh` does not
  rewrite them. They are the newest rows by `createdAt` and are almost all synced
  (7 failed of 2 561), which turns out to matter to exactly one measurement - § 3.3
  explains where, and why it is realistic rather than a stand artefact.

**The 0.591% needs-attention share is a CHOSEN stand-in, not a measured industry
figure.** The reasoning: a healthy install retries a failed destination create, so the
steady-state backlog of orders stuck failed is small; 27.7% describes an install in
the middle of an incident. Nothing in this report depends on 0.6% being the right
number - what it depends on is that it is a fraction of a percent rather than a third.

**Scale reasoning, and it is a judgement rather than a survey.** 50 000 products is
the size of a large specialist retailer or a mid-size distributor. It was chosen for
three reasons that can be checked: it is 8 333x the shop the campaign had been
measuring; it takes `identifier_mappings` to 207 311 rows, which is past the point
where the unindexed partition scan #2219 documents stops being free (§ 3.4 shows the
plan change it triggers); and it stays within a range a single PrestaShop install
plausibly serves, so the stand is a stress test rather than an outlier. Nobody
surveyed real installs for it.

2 000 000 orders is ~5.5 years of history at ~1 000 orders/day. It was chosen to add
a **fourth** point to the previous pass's 10k/100k/1M curve specifically to test
whether that curve's sub-linear step continues (§ 3.5 - it does not), not because
2M is a threshold anything special happens at.

**Cost (measured):** see § 7.

---

## 3. F5, the operator read path

Four runs, each changing **one** thing, so no figure below confounds two changes.
Every run VALID, zero non-2xx, same load shape (`TARGET_RATE=20`, 60 s plateau).

| Run | orders | needs-attention share | shop |
|---|---:|---:|---:|
| **A** baseline | 1 002 561 | 27.686% | 6 products |
| **B** distribution only | 1 002 561 | 0.591% | 6 products |
| **C** catalogue added | 1 002 561 | 0.591% | 50 000 products |
| **D** orders grown | 2 002 561 | 0.591% | 50 000 products |

### 3.1 The machine drifted, so read the ratios, not the wall clock

The stand itself moved between runs. The plain unfiltered
`COUNT(*) FROM order_records` - which touches no jsonb, no catalogue and no index -
went **29.24 -> 36.87 ms** between runs A and B, on an unchanged table. That is a
26% shift with no change under test.

So **no wall-clock delta across these runs is attributable on its own**, and every
claim below is carried either by a ratio against that unfiltered COUNT (the machine
control) or by a plan-level counter (`Rows Removed by Filter`, `Buffers`) that
machine drift cannot move. Where only a wall-clock figure exists, it is labelled as
such and not leaned on.

### 3.2 Per-route medians (measured, ms)

| Route | A | B | C | D |
|---|---:|---:|---:|---:|
| `orders_list` | 36.34 | 44.71 | 43.79 | 69.60 |
| `orders_list_needs_attention` | 141.73 | 164.57 | 164.18 | **286.15** |
| `order_detail` | 5.48 | 5.07 | 5.28 | 5.76 |
| **`products_list`** | **9.58** | **9.53** | **36.21** | 39.19 |
| **`product_detail`** | **5.87** | **5.58** | **14.49** | 15.89 |
| `sync_jobs_list` | 36.50 | 44.30 | 44.41 | 46.11 |
| `page_shell_total` | 55.00 | 62.00 | 56.00 | 84.00 |
| _machine control:_ unfiltered `COUNT(*)` | 29.24 | 36.87 | 36.25 | 64.61 |

Every run VALID with zero non-2xx responses.

### 3.3 The distribution fix (A -> B): the page's work doubled, and F5's conclusion survives

Taking the needs-attention share from 27.686% to 0.591% - a **47-fold** change in
selectivity - moves the two halves of that route in opposite directions once the
machine's own drift is divided out, exactly as the mechanism predicts.

| | A (27.686%) | B (0.591%) | ratio |
|---|---:|---:|---:|
| filtered `COUNT` mean, ms | 131.31 | 150.36 | 1.15 |
| _same, against the machine control_ | 4.49x | 4.08x | **0.91** |
| paged `SELECT`, mean ms | 2.85 | 4.68 | 1.64 |
| paged `SELECT`, `Rows Removed by Filter` | 2 589 | 5 728 | **2.21** |
| paged `SELECT`, `Buffers: shared hit` | 2 978 | 5 330 | **1.79** |

**The COUNT did not get cheaper when its filter became 47x more selective** - against
the machine control it is fractionally cheaper (4.49 -> 4.08 times an unfiltered
count of the same table), which is what a non-sargable full scan should do: it
evaluates the jsonb containment on every row either way and only the aggregate's
input shrinks.

**The page's work roughly doubled**, on two counters that machine drift cannot touch.
And it stayed a rounding error against the route: 2.0% of the route's median in A,
2.8% in B. **So F5's headline - "the page is fast, the total is slow" - holds on the
realistic distribution.** That is a robustness result rather than a null: the
conclusion was reached on a dataset that flattered exactly the half it exonerated,
and it survives when the flattery is removed.

**Why the page's cost grew only 2.2x when selectivity changed 47x**, and why that is
realistic rather than a stand artefact: the page walks `IDX_order_records_createdAt`
**backwards**, so it meets the newest rows first - and the newest 2 561 rows on this
stand are the real orders earlier runs created, of which only 7 are failed. That
block is a fixed floor of ~2 554 rows the scan crosses before it reaches any seeded
history. The arithmetic checks out almost exactly for A: 13 hits still needed after
the real block, at 27.686%, is ~34 further rows removed, for ~2 588 - **measured
2 589**. This is not a distortion to correct. On any real install the newest orders
are the ones most likely to have synced, so a needs-attention page always pays a
walk past recent healthy traffic; the stand reproduces that by accident.

### 3.4 The catalogue (B -> C): two routes the previous pass called flat are not

B -> C changed the catalogue only - orders, their distribution and the load shape
are identical, and the machine control barely moved (36.87 -> 36.25 ms). The three
order-side routes are correspondingly flat. Two catalogue routes are not:

| Route | B | C | ratio |
|---|---:|---:|---:|
| `products_list` | 9.53 | **36.21** | **3.80x** |
| `product_detail` | 5.58 | **14.49** | **2.60x** |
| `orders_list` | 44.71 | 43.79 | 0.98 |
| `orders_list_needs_attention` | 164.57 | 164.18 | 1.00 |
| `sync_jobs_list` | 44.30 | 44.41 | 1.00 |
| `order_detail` | 5.07 | 5.28 | 1.04 |

**This qualifies a claim the previous report made.** `results-F5-2026-09-06.md`
states that *"`order_detail` and `product_detail` are flat across three orders of
magnitude ... both are primary-key point lookups, unaffected by table growth"*. That
was true of the growth it measured, which was **orders only**. Grow the **catalogue**
and `product_detail` moves 2.6x, because it is not a lone point lookup - it fans out
to the product's variants, its inventory positions and its identifier mappings.
`order_detail`, which has no such fan-out, stays flat here and the claim holds for it.

Three plan-level mechanisms carry it (all measured, from `explain.txt`):

- **`products` list is a `Seq Scan` plus a top-N sort, with no index on
  `createdAt`**: 10 006 rows / 1.08 ms at A, **60 006 rows / 10.17 ms** at C, buffers
  191 -> 1 095. The `COUNT(*) FROM products` beside it went 0.78 -> 4.25 ms.
- **`identifier_mappings` paged by `externalId` is unindexed for that partition**
  (#2219's own accepted cost) and at 207 311 rows Postgres **switched it to a
  `Parallel Seq Scan` with two workers**: 8.81 ms -> 16.82 ms. The table grew 3.2x
  (65 644 -> 207 311) and the partition the query actually matches grew 6.0x
  (10 006 -> 60 006 `Product` rows on that connection), so 1.9x the time is well
  under either - the parallel plan is absorbing most of it. This is the same partial
  self-healing F5 documented for the order COUNT, and it carries the same caveat -
  it depends on workers being available, which is exactly what a loaded install does
  not guarantee.
- The `/products` list's per-row `getExternalIds` fan-out is unchanged in shape; it
  is the base scan underneath it that grew.

### 3.5 Orders 1M -> 2M (C -> D): the sub-linear scaling was a one-off, not a trend

The previous report's most quoted result is that naive linear extrapolation
**over-predicted** the needs-attention COUNT at 1M by 2.8x - 10x the rows cost only
3.6x the time, because Postgres switched that COUNT to a `Parallel Seq Scan` with two
workers somewhere between 100k and 1M rows.

The fourth point says that headroom is now spent:

| Step | rows | filtered COUNT | ratio | unfiltered COUNT | ratio |
|---|---:|---:|---:|---:|---:|
| 100k -> 1M (previous pass) | **10x** | 39.64 -> 141.89 ms | **3.58x** | 6.90 -> 30.52 ms | 4.42x |
| 1M -> 2M (this pass) | **2x** | 148.55 -> 273.18 ms | **1.84x** | 36.25 -> 64.61 ms | 1.78x |

**Past 1M it is linear again**, on both the filtered and the unfiltered count, and the
route follows: `orders_list_needs_attention` 164.18 -> **286.15 ms** for twice the
rows. The parallel plan was already in use at 1M, so there was no further plan change
left to absorb the growth - the sub-linear step was a **transition** between two
regimes, not a property of the curve.

This matters because the previous report's own framing invites the extrapolation it
warns against elsewhere. Fitting a power law to "3.6x for 10x rows" gives an exponent
of 0.55, which predicts `2^0.55 = 1.47x` for a doubling; the measured figure is
**1.84x**, so that prediction is low by about 25%. **The honest reading is that the
degradation is linear in row count except across the one plan boundary**, and that
the boundary has already been crossed - so a reader sizing for growth past 1M should
assume linear, not the flattering exponent.

The page query is unchanged by this step, as it should be - selectivity did not move,
so `Rows Removed by Filter` stayed flat (5 728 at C, 5 302 at D) even though the
table doubled.

---

## 4. The property that makes the rest of it meaningful: the mappings resolve

A row count proves nothing here. The defect being removed was a **full** mapping
table every one of whose external ids named a product that did not exist, so the
only check worth running is to take the ids OpenLinker holds and ask the shop's own
**webservice** - the same `GET products/{id}` the tax-rate chain issues.

Measured, from inside the stand, with the control run **first** so a probe that
cannot reach the shop at all is not mistaken for a pass:

| Probe | HTTP | |
|---|---|---|
| `products/999999` - **control, an id nothing holds** | **404** | the probe can fail |
| `products/20` - a pre-existing real product | **200** | |
| `products/200002` - **a seeded product** | **200** | `id_category_default: 6`, `manufacturer_name: "Studio Design"`, `type: simple` |
| `combinations/200002` - a seeded combination | **200** | `ean13: 6100000000001`, `reference: PERFSHOP-000002-V1` |
| `stock_availables?filter[id_product]=200002` | **200** | `quantity: 37` |
| `products/PERFSEED-EXT-PROD-ps-1` - **the OLD synthetic mapping** | **404** | the original defect, measured rather than asserted |

The control earned its place twice over. The first two attempts at this probe
returned `000` for **every** id including the known-good one (no `curl` in the api
container) and then `301` for every id (the shop redirects away from `localhost`);
without a control that must 404, both of those runs would have read as "the seeded
products do not resolve" and sent this pass chasing a data bug that did not exist.

The seeder asserts the same property structurally on every run - it samples 500
Product mappings and refuses to finish unless PrestaShop holds all 500 - and reported
`500 of a 500-mapping sample resolve to a real ps_product row`.

---

## 5. Diversity, quantified

"Realistic" is not only a row count. The previous catalogue had **one** distinct
default category and **six** distinct prices across the whole shop, so category
breadth, payload-size spread and cache-miss behaviour were not merely unmeasured -
they were unmeasurable.

| | Before | After |
|---|---:|---:|
| distinct default categories | 1 | **7** across the seeded set (8 shop-wide, adding the templates' own) |
| distinct product prices | 6 | **50 000** (5.06 - 3 004.95) |
| manufacturer slots assigned | not varied | 3 - the shop's 2, plus "none" |
| product name vocabulary | 6 fixed names | 120 adjective x noun pairs + ordinal |
| simple vs multi-variant products | 3 / 3 | **25 000 / 25 000** |
| combinations per multi-variant product | 2-3 | 2-3 (inherited from the templates) |
| per-variant stock values | 25 rows | 116 667 rows, varied per row |

The simple/multi-variant split is the one worth calling out: cloning a single
template - the shape the existing `perf/prestashop-baseline/seed-products.sh` uses -
would have produced a catalogue that is uniformly one or the other, leaving either
the synthetic-variant path or the real-combination path completely untouched.

---

## 6. The order path (limiter-ab arms A and BD)

### 6.1 What changed underneath it, and why it should matter

`bootstrap.sh` points each Allegro tenant's 200-offer pool at variants whose product
carries a numeric PrestaShop external id. On the six-product shop that collapsed the
pool onto **11 variants across 6 products**, and the bootstrap said so in a warning
rather than hiding it. Re-run against the grown catalogue - the same statement,
unchanged - the same 200 offers now span **200 distinct variants across 110 distinct
products**, an 18x increase on both axes.

The mechanism that makes this a throughput question rather than a tidiness one is
already established in `results-limiter-ab-2026-09-07.md` § 5: the order path's
ceiling is `(requestsPerMinute / requests-per-order) x 60` orders per hour, so
anything that changes requests-per-order changes the ceiling inversely and
proportionally. PrestaShop's tax-rate
resolution caches per `(connection, product, country)` for 24 h. With six products a
window warms that cache after six orders; with 110, an arm-A window that completes
~19 orders **never** warms it.

**Prediction stated before the run, so it can be wrong:** both arms slow down, and
requests-per-order rises.

### 6.2 The comparison, and how verdicts are handled

The baseline is the committed `results-limiter-ab-2026-09-07.md`, taken on the same
stand on the same day with the same script and the same arm specs
(`A:60:4:::false`, `BD:600:4:::true`, `REPEATS=2`, `WINDOW_SECS=300`, `BACKLOG=900`).
The only thing that differs is the dataset.

**Three of these four windows are labelled `DISCARDED`, as was every window in the
baseline** - that report's § 9 says so and explains why, and the same two causes
recur unchanged:

- `post_guard_destination_creates` fires structurally on any saturation window,
  because the point of one is to end with work in flight, so an order created inside
  the window and still mid-create at close necessarily lacks `syncedAt`.
- `post_guard_limiter_degraded` fires on arm A **by construction**: the shared Redis
  client's degradation is the very condition arm A exists to characterise, and the
  dedicated-client arms are the ones that answer zero.

So the discard label is not a difference between this run and the baseline, and the
comparison is like for like. It does mean **no figure in this section is a
publishable throughput number**, which was already true of the baseline.

The exception is **BD r2, which came back `VALID`** - the first valid window in this
scenario's history, since the baseline records all thirteen of its own as discarded.
It cleared both guards: zero degraded-limiter lines, and no order left mid-create when
the window closed.

### 6.3 First, the check that has to pass before any throughput number means anything

The campaign's own recorded trap: a `marketplace.order.sync` job reports
`outcome: 'ok'` **even when every destination create failed**, because
`OrderSyncService` fans out under `Promise.allSettled` and records
`syncStatus[].status = 'failed'` without failing the job. A throughput figure taken
on a dataset whose creates all 400 is a measurement of the failure path.

Sampled live part-way through the first arm-A window - a 30-minute lookback, so it
covers that window's warm-up orders as well as the first of its measured ones
(measured):

| Check | Result |
|---|---|
| PrestaShop `ps_orders` | 2 560 -> **2 569** - the shop really received them |
| `syncStatus` of the 9 orders ingested in that period | **9 synced, 0 failed** |
| destination `Order` identifier mappings written | **9** |
| **distinct PRODUCTS those 9 orders touched** | **9** |
| job outcomes | `marketplace.order.sync` 9 succeeded / `ok`, 0 dead |

The fourth row is the one that says the re-seed did its job: nine orders reached nine
**different** products. On the old dataset the entire 200-offer pool resolved to six.

The scenario's own `post_guard_destination_creates` then confirmed it independently
for every window it ran, not just the sampled one: **`0 order(s) carry a failed
syncStatus entry`** in each. The only thing that guard objected to was 1-2 orders
still mid-create at window close, which is the structural artefact of saturating a
window rather than a create failure.

### 6.4 Results

| Arm | dataset | orders/h | mean | vs thin | orders | **requests/order** | mean | degraded |
|---|---|---|---:|---:|---:|---|---:|---:|
| A | thin (n=3) | 218, 231, 230 | **226.3** | - | 18-19 | 11.28, 11.16 | 11.22 | 34-58 |
| **A** | **realistic (n=2)** | **221, 208** | **214.5** | **-5.2%** | 19, 18 | **11.00, 11.17** | **11.09** | 54, 40 |
| BD | thin (n=2) | 2 255, 2 303 | **2 279.0** | - | 186, 190 | 10.19, 10.13 | 10.16 | 0, 0 |
| **BD** | **realistic (n=2)** | **2 204, 2 174** | **2 189.0** | **-3.9%** | 191, 189 | **10.05, 10.11** | **10.08** | 0, 0 |

**And the diversity really was exercised** - measured per window, by joining each
window's orders through their `Offer` mappings to the products behind them:

| Window | orders created | **distinct products touched** |
|---|---:|---:|
| A r1 | 21 | **19** |
| A r2 | 20 | **15** |
| **BD r1** | **191** | **92** |
| **BD r2** | **191** | **94** |

On the old dataset the entire 200-offer pool resolved to **six** products, so a
191-order window touched at most six, most of them dozens of times. It now touches
**92-94 distinct products**, nearly all of them once. That is a ~15x increase in the
cache-miss surface within a single window - and **requests per order still went
DOWN**, on both arms.

**Neither arm moved in the direction predicted, and neither moved much at all.** Arm
A's 5.2% sits inside the 5.7% spread it shows against *itself* on the baseline: at
18-19 orders per window the instrument's resolution is one order, which is 5.4% of the
rate, so two windows differing by one completed order differ by more than this entire
effect. Arm BD's 3.9% is larger than that arm's own 2.1% baseline spread and so may
be real - but it is **not attributable to the catalogue through the request budget**,
because requests per order fell (10.16 -> 10.08) rather than rose. A slower, larger
Postgres (2M orders, 207k mappings) and ordinary host drift are both live candidates
and this pass separates neither.

**One window came back `VALID`** - BD r2, the first in this campaign's limiter-ab
history; the baseline report records all thirteen of its own windows as `DISCARDED`.
It cleared both post-guards: zero degraded-limiter lines *and* no order left
mid-create at window close.

Independent confirmation that the creates were real throughout: **0 orders with a
failed `syncStatus` entry in any window, 0 dead jobs, and PrestaShop's own order count
rose to 2 995.**

### 6.5 The prediction failed. Here is the mechanism, which is the better answer.

§ 6.1 predicted, before the run, that both arms would slow and requests-per-order
would rise. **Arm A did neither**, and the reason is more useful than the prediction
would have been, because it says *why catalogue size cannot reach this flow* rather
than *how much it costs*.

The prediction rests on the tax-rate cache being a material share of the order's
request budget. `results-F1-2026-09-07.md` measures that budget per resource, and it
does not support the premise:

| Resource | per order | keyed on |
|---|---:|---|
| `GET`+`POST customers`, `GET`+`POST addresses` | 4.00 | **the buyer** - a new one every order |
| `POST /index.php` (`cartshipping` + `importorder`) | 2.00 | the order |
| `GET order_states` / `currencies` / `countries` | 3.71 | small reference tables, per order |
| **`GET products`** | **1.41** | **the product** - tax chain + the cascade |
| `GET carriers` / `orders` / `carts` | 3.00 | per order ("`carriers` not cached") |
| `GET stock_availables` / `configurations` | 1.88 | the cascade / an always-401 waste |

Those lines sum to **16.0 requests per order**, which is F1's own accounting for its
own arm; limiter-ab counts 11.0-11.3 for this arm, over a narrower set (`/api/` plus
`POST /index.php` inside the window). The two totals are not the same measurement and
are not mixed here - what carries the argument is the **proportion**, which is a
property of the mix rather than of either total.

**Exactly one line in that table is product-keyed, and it is 1.41 of 16.0 - about
9%.** So even a total cache miss on every product can only add on the order of one
request per order. At arm A's resolution, where a window completes 18-19 orders and a
single order is 5.4% of the rate, an effect that size is at or below the noise floor
by construction - and the measured requests-per-order moved 1.2% the other way.

That is the honest read of the null: not "product diversity does not matter", but
**the order path's request cost is dominated by per-order and per-buyer lookups, and
the catalogue is a small term in it.** The six-product shop was flattering the
*catalogue-side read path* substantially (§ 3.4) and the order path barely at all.

The comparison that makes this drift-proof is the **fraction of the pace-gate ceiling
each window reached**, since the ceiling itself is computed from that window's own
measured requests-per-order:

| Window | req/order | ceiling = `60 / req-per-order x 60` | achieved | fraction |
|---|---:|---:|---:|---:|
| baseline A r1 (thin) | 11.28 | 319 /h | 218 | **68.3%** |
| baseline A r2 (thin) | 11.16 | 323 /h | 231 | **71.6%** |
| **this run, A r1 (realistic)** | **11.00** | **327 /h** | **221** | **67.5%** |
| **this run, A r2 (realistic)** | **11.17** | **322 /h** | **208** | **64.5%** |

Mean fraction 70.0% thin against 66.0% realistic. That difference is **not** claimed
as an effect: it is 4 percentage points on an instrument whose quantum is 5.4
points, from two windows per arm. What the table does support is the negative -
**the requests per order did not rise**, and since the ceiling is computed from that
number, the catalogue did not narrow the ceiling either.

Arm BD is the stronger version of the same test, and it is the one that settles it.
Its windows touch **92-94 distinct products** rather than arm A's 15-19, so the
tax-rate cache is genuinely cold for most of the window - the condition the prediction
needed. Requests per order there is **10.05 / 10.11 against a thin-catalogue 10.19 /
10.13**. If a per-product cache miss were a material term in that budget, this is
where it would show, and it does not.

---

## 7. What the dataset cost

| | Measured |
|---|---|
| PrestaShop catalogue, 50 000 products (MySQL, direct insert) | **9 s** |
| OpenLinker projection of it (Postgres, via `COPY`) | **6 s** |
| `rebalance-sync-status.sh` over 1 000 000 orders | **1 s** |
| Orders 1M -> 2M: 1 000 000 records + 2 499 438 line items | **95 s** |
| **Total seeding wall clock** | **under 2.5 minutes** |

Disk, by table, both sides measured (`pg_total_relation_size`, includes indexes):

| Table | Before | After |
|---|---:|---:|
| `order_line_items` | 1 183 MB | **2 359 MB** |
| `order_records` | 1 167 MB | **2 014 MB** |
| `identifier_mappings` | 51 MB | **147 MB** |
| `inventory_items` | 16 MB | **49 MB** |
| `product_variants` | 5.9 MB | **31 MB** |
| Postgres database total | not measured before | **4 801 MB** |
| PrestaShop MySQL schema total | not measured before | **211 MB** |

**~2.2 GB of growth across the tables measured on both sides**, against 848 GB free.

The whole dataset is cheap enough that its size was never the constraint - which is
worth saying plainly, because it means a future campaign has no reason to measure on
a thin one.

**Why the catalogue was inserted rather than replicated (derived).** The request cost
alone would have been affordable: at ADR-048's post-#2593/#2648 batched cost of
**0.058 requests/SKU**, 50 000 SKUs is ~2 900 platform requests, and at the ~277
req/min the #2594 lane-caps A/B sustained that is ~10.5 minutes of request time. What
makes it infeasible is the sweep's own **pacing**, not its request count:
`BATCHED_SWEEP_BUDGET_DEFAULT` is 500 items per run against a 20-minute cron, so one
full cycle over 50 000 products is `ceil(50000/500) = 100` ticks - **~33 hours**.

Both input figures (0.058 req/SKU, 277 req/min) are carried from earlier
measurements and were **not** re-taken here, which is why the conclusion is labelled
derived. Against 15 seconds of direct insert, the margin is wide enough that a
re-measurement could not change the decision.

The consequence is stated rather than hidden: **this dataset did not exercise the
replication path.** Nothing here says anything about how long a real catalogue sync
takes, and no figure in this report should be read as though it did.

---

## 8. What became measurable that was not before

Five things, each previously blocked by a specific absence rather than by a missing
scenario:

1. **Catalogue-side read degradation.** `products_list` and `product_detail` were
   flat across the previous campaign because only the order table ever grew. With a
   6x catalogue they move 3.8x and 2.6x, and `product_detail`'s movement contradicts
   a stated conclusion of the previous report (§ 3.4).
2. **The `identifier_mappings` unindexed partition scan at a realistic size.** The
   previous pass measured it at 65 644 rows and observed a plain `Seq Scan`. At
   273 481 rows Postgres switches it to a parallel plan - a plan change that could
   not be observed on the smaller table (§ 3.4).
3. **Order-path product diversity - and the answer is a NULL, which is itself the
   result.** With six products the tax-rate cache was warm after six orders, so the
   question "does catalogue size reach this flow?" could not be put. With 110
   products it could be, and the answer is no: requests-per-order is unchanged, and
   § 6.5 shows why from the request mix rather than leaving it as a bare null. A null
   you can explain is worth more than an unmeasurable.
4. **Inventory contention across distinct positions.** A 900-order window previously
   drove the post-sale `setInventory` cascade into **11** `inventory_items` rows; it
   now spreads across 200. **This pass did not isolate it** - it changed together
   with everything else in § 6 and no arm holds it fixed - so all that is claimed
   here is that the condition now exists to be measured, where before it did not.
5. **Whether the read-path conclusions were artefacts of the seed.** Two of them
   survive (§ 3.3), one needs qualifying (§ 3.4) and one must not be extrapolated
   (§ 3.5) - and none of those three answers was available on the old dataset.

---

## 9. Reproducing this dataset

Every step is a committed script under `perf/openlinker-throughput/seed/`, and every
one is deterministic - the RNG seed and the ordinal arithmetic are both fixed, so the
same invocations regenerate the identical dataset.

```bash
# 1. the shop, and the OpenLinker projection keyed to its real ids
SHOP_PRODUCT_COUNT=50000 ./seed/seed-shop-catalogue.sh

# 2. the orders, at a realistic per-destination failure rate
TARGET_ORDERS=2000000 SYNC_FAILED_RATE=0.003 ./seed/seed-orders.sh

# 3. only if an earlier generation was seeded at the old 0.15 rate
NEEDS_ATTENTION_PCT=0.6 ./seed/rebalance-sync-status.sh

# 4. re-point the offer pool at the grown catalogue (bootstrap is idempotent)
./bootstrap.sh

# and to undo all of it - matches only this seed family's own tags
./seed/cleanup.sh
```

Two properties are worth knowing before re-running. `seed-shop-catalogue.sh` refuses
a second generation under the same prefix unless given `FORCE_SEED=1` **and** a
`SHOP_SEED_OFFSET`, because a repeat would mint duplicate references and duplicate
`ean13` barcodes - and a duplicate barcode is exactly what offer linking refuses to
resolve. And `cleanup.sh` now removes both sides: the `PERFSHOP-` reference prefix in
MySQL and the prefix-tagged `internalId` in Postgres, the latter because
shop-aligned mappings carry the shop's own numeric external ids and no `externalId`
pattern could find them without risking a row this seed never wrote.

---

## 10. What this did not establish

- **The catalogue was inserted, not replicated.** See § 7. No figure here bears on
  `master.product.syncAll`, `master.inventory.syncAll` or the deletion audit.
- **10 006 of the 60 006 OpenLinker products still name nothing in either shop.**
  The pre-existing `seed-catalogue.sh` generation was left in place rather than
  deleted, so it still carries `PERFSEED-EXT-PROD-*` mappings that 404 - proven
  live, § 4. They cannot contaminate the order path, because `bootstrap.sh`'s offer
  seeder filters on a numeric external id and excludes them by construction, and they
  are legitimate load on the `identifier_mappings` scan. But "60 006 products" is not
  "60 006 resolvable products", and the resolvable figure is **50 000**.
- **WooCommerce is still empty and still capability-less.** `wp_posts` holds zero
  products and the `perf-woocommerce` connection carries `enabledCapabilities: []`,
  so nothing in this pass measures a WooCommerce destination or a second
  `InventoryMaster` scope. The WC-side mappings from the earlier seeder remain
  synthetic and dangling.
- **0.591% is a chosen stand-in.** No install was surveyed for it.
- **The order-path arm does not separate catalogue SIZE from product DIVERSITY.** A
  50 000-row PrestaShop is slower at its own reads than a six-row one, and the
  tax-rate cache misses more often; both changed together, deliberately, because both
  are what a realistic install has. Attributing the movement between them would need
  a third arm holding one fixed.
- **`offer_mappings` ILIKE search and `destination_categories` trigram search remain
  unmeasured**, unchanged from the previous pass - neither table has rows, and this
  pass did not seed them.
- **Product content is still a floor.** Seeded names are short synthetic strings and
  descriptions are cloned from six templates, so per-row payload sizes understate a
  real catalogue exactly as the previous pass's `orderSnapshot` did.
- **The stand is a contended developer workstation** sharing a host with two other
  OpenLinker stacks. Figures are floors, not ceilings.
- **No arrival rate is assumed**, so no "days until N orders" figure is derived.
- **`bootstrap.sh` was not re-run in full.** Only its offer-mapping step was reproduced
  (verbatim), because the same script also owns the PrestaShop module, the webservice
  account, the tax group and the WooCommerce setup - and WooCommerce here is empty
  with a capability-less connection, so a full run could legitimately have decided to
  repair it and changed the dataset mid-campaign.
