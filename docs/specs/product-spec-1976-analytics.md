# Product Spec — Business analytics surface (`/analytics`)

- **Product Design issue:** [#1976](https://github.com/openlinker-project/openlinker/issues/1976)
- **Status:** phase D complete — Gate D = YES, implementation issues spawned
- **Started:** 2026-08-03

---

## 1. Problem

OpenLinker can tell an operator whether the plumbing is broken. It cannot tell them anything about the business running through it.

The `/` landing route (`apps/web/src/pages/dashboard/dashboard-page.tsx`) is operational triage: integration health, dead sync-job groups, connection status, infra nodes, recent jobs. Every aggregate endpoint in the backend has the same flavour — order *health* buckets (`GET /orders/status-summary`), *SLA* buckets (`GET /orders/sla-summary`), grouped sync jobs (`GET /sync/jobs/grouped`), webhook status, dev-stack health. Not one of them reports a business quantity.

A seller running Allegro plus a shop through OpenLinker therefore opens Allegro's seller panel for the Allegro half, the shop's own stats for the shop half, and reconciles the two by hand — despite OpenLinker being the only system that already holds both sides of that picture, plus the destination pricing rule and the stock position behind it.

**Why now:** the multichannel precondition is newly true. Until recently OL was effectively a one-marketplace pipe; with WooCommerce as a master shop (#872), Erli (#978), shop-publish (#1042/#1831) and the offer/shop status snapshots (#816/#1845), a real operator now plausibly runs ≥2 selling channels through one OL instance. The cross-channel view has no meaning before that; it has meaning now.

### 1a. What the data actually supports — findings that reshape this problem

A probe of the orders/products/inventory contexts (2026-08-03) found the analytical substrate is substantially thinner than the issue body assumed. These are facts, not risks:

| Finding | Evidence | Consequence |
|---|---|---|
| **No money columns exist.** Totals, currency and per-line prices live only inside `order_records.orderSnapshot` (JSONB). | `order-record.orm-entity.ts:58-59`; `order.types.ts:281-296` | Every revenue query is a JSONB path expression over an unindexed blob. |
| **Order item lines are not rows.** No `order_items` table, no item entity — items are a JSON array inside the snapshot. | no migration in `apps/api/src/migrations`; `orderSnapshot->'items'` | "Top products by units/revenue" requires `jsonb_array_elements` expansion per query. |
| **No `placedAt` column.** Only `createdAt` (ingestion time) and `updatedAt`. | `order-record.orm-entity.ts:109-113` | A date-range filter on *when the order was placed* also hits JSONB. Ingestion time ≠ order time, and diverges on backfill or a poll catch-up. |
| **Cancellation is not represented.** No cancelled/refunded column; `recordStatus` is only `ready \| awaiting_mapping \| source_deleted`. A source cancellation event writes **nothing** to the record — it only relays to destinations. | `order-record.types.ts:32`; `order-ingestion.service.ts:485-536` | Cancelled state is visible only as `orderSnapshot.status`, and only if a later poll happens to re-ingest the order. A naive revenue sum silently counts cancelled orders. |
| **No cost basis exists anywhere.** Products and variants store a selling `price` only. No cost/purchase/wholesale price on any entity. | `product.orm-entity.ts:24-27`; `product-variant.orm-entity.ts:45-46`; inventory items carry no money | **Margin cannot be computed.** The proposed "margin after pricing rules" pillar is not buildable from stored data. |
| **Multi-currency is permitted; no FX anywhere.** Currency is a free string in the snapshot; no conversion code exists. | `order.types.ts:287`; no `exchangeRate`/`convert` code in `libs/core` | Revenue can only be reported per-currency, or the number is meaningless. |

**The honest re-framing this forces:** this initiative is not mostly a charting exercise. It is mostly *"make orders analytically queryable, and decide what OL is willing to assert as true"*. The UI is the small half.

Two of the four proposed layer-2 pillars are directly affected:

- **Margin after pricing rules — not buildable.** #1843 derives a *destination price* from the master *selling* price. With no cost basis, the most OL can honestly show is **price uplift vs. the master price**, which is a different and much weaker claim. Either the pillar is dropped, or it expands to include "let the operator record a cost basis" — a real feature in its own right, adjacent to the open PIM question (#1029).
- **Revenue itself is a correctness problem before it is a display problem.** Cancellations, currency mixing and placed-vs-ingested time each independently make a headline revenue number wrong. A quietly-wrong revenue figure is worse than no figure, because an operator will act on it.

The other two pillars are comparatively sound: **per-channel split for the same product** and **listing-coverage vs. sales** both rest on mappings and item lines, need no cost basis, and are unaffected by FX if reported in units alongside money.

---

## 2. Affected persona

**Primary — the owner-operator of a small PL multichannel retail business.**

| Axis | Value |
|---|---|
| Company size | Solo merchant to small SMB (1–5 people); the person reading this page is often the same person who packs the boxes |
| Sophistication | Non-technical operator. Comfortable in the OL admin UI. Not a BI or SQL user; will not build a report |
| Volume | 50–1000 SKUs; 10–100 orders/day; **≥2 selling channels connected to OL** (this is the qualifying condition, not the SKU count) |
| Geography | PL-first — Allegro plus a PrestaShop or WooCommerce shop, PLN-denominated |

**Secondary — the agency operator** running several client shops on one OL instance. Same page, different question ("which client account needs attention this week"), and a strong pull toward per-connection scoping. Explicitly *not* being designed for in v1, but noted because it argues against hard-coding a single-tenant framing.

**Explicit non-persona:** the analyst/finance user who wants exports, custom dimensions and pivot tables. OL should lose that user to a real BI tool rather than chase them.

### The persona-level open question

Does this persona actually turn to OpenLinker for a business question — or is "how are sales doing" so firmly Allegro's job in their head that a `/analytics` page goes unvisited after week one? OL has never held their attention for a non-operational task. **This is the single assumption most likely to sink the feature, and Phase B must attack it directly.**

---

## 3. Evidence & user research

_Deferred. The maintainer chose to enumerate the desired metric surface first, then derive backend work, then frontend work. Evidence gathering (competitor comparison, seller signal) folds into the selection pass over § 4._

---

## 4. Metric catalogue — candidate surface

Every candidate metric, chart and datapoint considered for `/analytics`. **This is a menu, not a plan.** Selection happens in the next pass; backend issues are derived from the selected rows, frontend issues from the agreed layout.

**Feasibility legend**

| Flag | Meaning |
|---|---|
| 🟢 | Computable from data OL already stores. Cost is query work only. |
| 🟡 | Needs backend groundwork first — new columns, an item-line table, backfill, or a correctness decision (cancellations / currency / placed-at). |
| 🔴 | Not computable. OL does not hold the required data at all; would need a new data-capture feature first. |

**Correctness dependencies** referenced below (each is a decision, not a task):
- **[C]** cancelled/refunded orders must be excludable — today cancellation is only a string inside the snapshot and is not reliably written (`order-ingestion.service.ts:485-536`)
- **[T]** placed-at vs. ingested-at — `createdAt` is ingestion time; true order time lives in the snapshot only
- **[X]** currency — mixed-currency sums are meaningless; needs per-currency grouping or an explicit single-currency assumption
- **[L]** order item lines are JSON, not rows — any per-product number needs expansion or a real table
- **[$]** requires a cost basis, which does not exist on any entity
- **[G]** **gross-vs-net mixing** — `OrderTotals.taxTreatment` is per-order and source-uniform: Allegro reports buyer-paid **gross** (`inclusive`), a shop like PrestaShop prices **net** (`exclusive`), and the field is *optional* ("not asserted by the source"). Summing or comparing revenue across channels without normalising tax treatment compares gross against net — a channel-mix chart would systematically overstate the marketplace. This is a silent, plausible-looking wrong answer, and it affects every money metric in groups A, A′, B and C

---

### A. Sales headline — "how did we do?"

| # | Metric | Answers | Feasibility |
|---|---|---|---|
| A1 | Revenue (GMV) for a date range | Top-line trade | 🟡 [C][T][X] |
| A2 | Order count for a date range | Volume independent of price | 🟡 [C][T] |
| A3 | Average order value | Basket health | 🟡 [C][T][X] |
| A4 | Units sold | Volume independent of basket size | 🟡 [C][T][L] |
| A5 | Revenue over time (line/bar, day/week/month buckets) | Trend and seasonality | 🟡 [C][T][X] |
| A6 | Period-over-period delta (vs. previous period, vs. same period last year) | Is it up or down | 🟡 same as A1 + needs ≥1 prior period of history |
| A7 | Cancellation rate / cancelled value | Quality of demand; trust in A1 | 🟡 [C] — and the strongest argument for fixing [C] |
| A8 | Shipping revenue vs. product revenue split | Is shipping subsidised | 🟡 [C][T][X] — `totals.shipping` is in the snapshot |
| A9 | Tax total / net vs. gross toggle | Talking to an accountant | 🟡 `totals.tax` + `taxTreatment` exist in the snapshot |
| A10 | Discount total | Promo impact | 🔴 no discount field on `OrderTotals` |
| A11 | Refunded value | True net revenue | 🔴 `refunded` is an unwritten enum member; no refund amount stored anywhere |

### A′. Basket economics — "what does a typical order look like?"

> **Naming note.** Sellers say *"average cart value"*; the computable quantity is **average order value**. OL ingests completed orders only — it sits downstream of checkout and never observes a cart. Anything requiring a pre-purchase cart is structurally invisible here, not merely unbuilt (A′10–A′12).

| # | Metric | Answers | Feasibility |
|---|---|---|---|
| A′1 | Average order value, system-wide | The headline basket number (= A3) | 🟡 [C][T][X] |
| A′2 | AOV by channel | Do Allegro buyers spend more or less than shop buyers (= B3) | 🟡 [C][T][X] |
| A′3 | AOV over time | Is basket value drifting up or down | 🟡 [C][T][X] |
| A′4 | AOV by channel over time (multi-series) | Is one channel's basket decaying while another grows | 🟡 [C][T][X] |
| A′5 | **Median order value** (alongside the mean) | Guards against one PLN 40 000 order making the mean a lie — at 10–100 orders/day, the mean is genuinely fragile | 🟡 [C][T][X] |
| A′6 | Order value distribution (histogram / bucket counts) | Is there one buyer type or several | 🟡 [C][T][X] |
| A′7 | Average items per order (basket size in units) | Is AOV moved by price or by quantity — the two have opposite responses | 🟡 [C][T][L] |
| A′8 | Single-item vs. multi-item order share | Is cross-selling happening at all | 🟡 [C][T][L] |
| A′9 | Average line price (AOV ÷ items per order) | Separates "sells expensive things" from "sells many things" | 🟡 [C][T][L][X] |
| A′10 | Abandoned-cart value | — | 🔴 OL never sees a cart |
| A′11 | Cart-to-order conversion rate | — | 🔴 as above |
| A′12 | AOV excluding shipping | Product-only basket | 🟡 [C][T][X] — `totals.shipping` is in the snapshot, so this is a subtraction, not new data |

**Note on A′5–A′6.** Median and distribution are unusual for a v1, but this persona's volume (10–100 orders/day) is exactly the range where a mean is unstable and a single outlier order visibly moves it. If we show only a mean, expect "why did my average jump?" — and the honest answer will be "one big order".

### B. Channel performance — "where is it coming from?"

| # | Metric | Answers | Feasibility |
|---|---|---|---|
| B1 | Revenue by channel (source connection) | Channel mix | 🟡 [C][T][X] — `sourceConnectionId` **is** a real indexed column |
| B2 | Order count by channel | Volume mix | 🟡 [C][T] |
| B3 | AOV by channel | Do buyers spend more on Allegro or the shop | 🟡 [C][T][X] |
| B4 | Channel mix over time (stacked area) | Is a channel growing or dying | 🟡 [C][T][X] |
| B5 | New-channel ramp ("first 90 days of connection X") | Did adding Erli pay off | 🟡 as B1 + connection created-at |
| B6 | Channel share of units vs. share of revenue | Which channel sells cheap volume vs. high value | 🟡 [C][T][L][X] |
| B7 | Marketplace commission / fee by channel | True channel profitability | 🔴 OL does not ingest marketplace fees |

### C. Product performance — "what is selling?"

| # | Metric | Answers | Feasibility |
|---|---|---|---|
| C1 | Top products by revenue | Where the money is | 🟡 [L][C][T][X] |
| C2 | Top products by units | What moves | 🟡 [L][C][T] |
| C3 | Top variants (size/colour level) | Which variant axis actually sells | 🟡 [L] — needs item→variant resolution |
| C4 | Bottom performers / zero-sales SKUs in range | Dead stock candidates | 🟡 [L] + needs the full catalogue as the denominator |
| C5 | Product sales trend (sparkline per row) | Rising or fading | 🟡 [L][T] |
| C6 | Category-level sales roll-up | Which part of the catalogue works | 🟡 [L] + category data is per-destination, not master-owned |
| C7 | Product profitability ranking | What is actually worth selling | 🔴 [$] |

### D. Cross-channel — the OL-exclusive layer

*Nothing in this group is available from any single marketplace's own analytics. This is the differentiator.*

| # | Metric | Answers | Feasibility |
|---|---|---|---|
| D1 | **Per-product channel split** — one row, N channel columns ("SKU-123: Allegro 12, shop 3") | Where each product actually sells | 🟡 [L][C][T] — the flagship metric |
| D2 | **Coverage vs. sales gap** — variants selling on channel A but not listed on channel B | Concrete, actionable revenue left on the table | 🟡 [L] + reads existing offer/shop-product mappings (`PublishedVariantsService` already unions both, #1837) |
| D3 | Channel-exclusive winners — products that sell on exactly one channel | Is a channel carrying unique demand | 🟡 [L] |
| D4 | Price dispersion per product across channels | Am I undercutting myself | 🟢 destination prices are resolvable from offers/pricing rules |
| D5 | Price uplift vs. master price, by channel | What the pricing rule (#1843) is actually doing | 🟢 — *note: this is uplift, **not** margin* |
| D6 | Listing coverage % (variants listed / variants sellable, per channel) | How complete is my distribution | 🟢 mapping counts only, no order data needed — **cheapest useful row in the whole catalogue** |
| D7 | Time-to-first-sale after listing, by channel | Is publishing to channel X worth the effort | 🟡 [L][T] + listing creation timestamps |
| D8 | Margin per channel after pricing rules | True channel economics | 🔴 [$] |

### E. Inventory-linked — "what will I run out of?"

| # | Metric | Answers | Feasibility |
|---|---|---|---|
| E1 | **Stock at risk** — fast movers whose master stock minus the safety buffer (#1844) won't survive to the next sync | Prevents overselling and stockouts | 🟡 [L] for velocity + 🟢 for the stock read |
| E2 | Out-of-stock / low-stock counts | Immediate shortage picture | 🟢 inventory items are real rows |
| E3 | Sell-through rate (units sold ÷ stock on hand) | Is inventory turning | 🟡 [L] |
| E4 | Days of cover at current velocity | When do I reorder | 🟡 [L] |
| E5 | Stock value on hand | Capital tied up | 🔴 [$] (needs cost) — or 🟡 at *selling* price, which is a different and misleading number |
| E6 | Stale/deleted-variant exposure (#1689) still carrying offers | Cleanup surface | 🟢 `isStale` is a real indexed column |

### F. Fulfilment & operations, business-framed

*Distinct from `/`'s triage view: these are trend/quality questions, not "fix this now" questions.*

| # | Metric | Answers | Feasibility |
|---|---|---|---|
| F1 | Orders dispatched per day/week | Throughput | 🟢 `fulfillmentState` + shipments are real columns |
| F2 | Median time from order to dispatch | Service quality trend | 🟡 [T] + dispatch timestamps |
| F3 | SLA breach rate over time | Is fulfilment degrading | 🟢 `dispatchByAt` is a real indexed column; SLA buckets already exist |
| F4 | Delivery success / failure rate by carrier | Which carrier to keep | 🟢 shipment states are real rows |
| F5 | Orders stuck unmapped, as a trend | Is the catalogue drifting | 🟢 `recordStatus` is a real indexed column |

### G. Customer

*Flagged as outside the stated persona — listed so the exclusion is a decision, not an oversight.*

| # | Metric | Answers | Feasibility |
|---|---|---|---|
| G1 | New vs. returning customer split | Loyalty | 🟡 `customerId` is a real column, but marketplace buyer identity is weak/masked (Allegro masked emails) |
| G2 | Repeat purchase rate | Retention | 🟡 as G1 |
| G3 | Customer LTV / cohorts / RFM | Retention economics | 🟡 heavy — and firmly the analyst persona we chose not to serve |
| G4 | Geographic sales distribution | Where buyers are | 🟡 addresses exist but are PII-gated (`OL_STORE_PII=false` stores hashes only) |

### H. Financial operations

| # | Metric | Answers | Feasibility |
|---|---|---|---|
| H1 | Invoiced vs. uninvoiced order value | Compliance exposure | 🟡 invoice records exist; no aggregate endpoint |
| H2 | Invoice status counts (issued / failed / rejected clearance) | KSeF/inFakt health | 🟢 real columns on invoice records |
| H3 | Outstanding (unpaid) invoice value | Cash position | 🟡 payment state exists per invoice (#1354) |

---

### I. Commerce mix — how buyers buy (PL-market signals)

*Discovered by reading the snapshot shape rather than assuming it: `Order` already carries `codToCollect`, `paymentStatus`, `pickupPoint`, `shipping.methodId` and `deliverySmart`. These are real, populated, PL-relevant fields that no group above touched — and `deliverySmart`'s own doc comment names analytics as its intended future consumer (`order.types.ts`).*

| # | Metric | Answers | Feasibility |
|---|---|---|---|
| I1 | **COD vs. prepaid share** (orders and value) | Cash-on-delivery is a defining PL commerce fact — it drives working capital, dispatch risk and refusal losses | 🟡 [T] — `codToCollect` is present on COD orders (#1435) |
| I2 | COD share by channel | Marketplace buyers COD far more than shop buyers; the mix explains a lot of channel economics | 🟡 [T] |
| I3 | **Pickup-point (Paczkomat) vs. courier-to-address share** | The single biggest PL delivery-preference signal; informs which carrier contracts matter | 🟡 [T] — `pickupPoint` is a first-class field |
| I4 | Delivery-method mix (by `shipping.methodId` / label) | Which shipping options buyers actually choose | 🟡 [T] |
| I5 | Delivery-method mix by channel | Should this channel's offers even carry that method | 🟡 [T] |
| I6 | **Allegro Smart! order share** | How much of Allegro volume depends on Smart! free delivery — i.e. exposure to that programme | 🟡 [T] — `deliverySmart` exists precisely for this |
| I7 | Smart! vs. non-Smart! AOV | Does Smart! buy volume at the cost of basket size | 🟡 [T][X][G] |
| I8 | Payment-status mix (awaiting payment / paid) | Unpaid-order exposure | 🟡 [T] — `paymentStatus` (#928) |
| I9 | COD refusal / undelivered-return rate | Real cost of COD | 🔴 no return or refusal representation exists |

### J. Timing & demand shape

| # | Metric | Answers | Feasibility |
|---|---|---|---|
| J1 | Orders by day of week | Staffing and dispatch planning | 🟡 [T] |
| J2 | Orders by hour of day | When to be at the desk; when the cutoff really bites | 🟡 [T] |
| J3 | Order arrival vs. dispatch-deadline pressure | Which days generate SLA risk | 🟢 `dispatchByAt` is a real indexed column |
| J4 | Seasonality view (month over month, year over year) | Planning | 🟡 [T] + needs ≥1 year of history OL will not have for a long time |

### K. Lost and leaked revenue

*The counterfactual group. Weaker evidentially — every row is an estimate — but this is where an operator's attention converts directly into money.*

| # | Metric | Answers | Feasibility |
|---|---|---|---|
| K1 | Estimated lost sales from stockouts (days out of stock × prior velocity) | What running dry actually cost | 🟡 [L] + requires stock *history*, which is not retained |
| K2 | Sales lost to paused/stale offers (#1689) | Cost of a catalogue defect | 🟡 [L] + offer-status history |
| K3 | Revenue concentration (share from top 10 SKUs / top channel) | Fragility — how exposed am I if one thing stops | 🟡 [L][C][T][X][G] |
| K4 | Orders that failed to reach a destination (business value, not job count) | Money stuck in broken plumbing — the bridge between `/` and `/analytics` | 🟢 `syncStatus` is a real column |

### L. Data trust — not metrics, but preconditions for believing any of the above

*Missing from the original catalogue entirely, and arguably the highest-value rows in it: analytics computed over **ingested** data must disclose the limits of that ingestion, or every number is an unqualified assertion.*

| # | Surface | Why it matters | Feasibility |
|---|---|---|---|
| L1 | "Data current as of X" freshness indicator | If the Allegro poll has been dead for two days, every chart is quietly wrong — and `/` already knows this | 🟢 sync jobs + cursors are real rows |
| L2 | Per-channel coverage window ("Erli connected 6 days ago") | A channel-comparison chart is unfair when one channel has 6 days of history and another has 8 months. Without this, the chart actively misleads | 🟢 connection `createdAt` |
| L3 | Ingestion-gap warning (a channel with a stalled cursor or dead poll) | Distinguishes "sales dropped" from "ingestion stopped" — the single most dangerous ambiguity on the page | 🟢 reuses existing job/cursor state |
| L4 | Explicit empty/new-instance state | A day-one instance has no history; the page must say so rather than render zeros that look like failure | 🟢 |

---

### Cross-cutting controls (apply to most of the above)

| Control | Note |
|---|---|
| Date range picker | Presets (today / 7d / 30d / quarter / custom). Interacts with [T] |
| Channel filter | Free — `sourceConnectionId` is indexed |
| Currency handling | Either group by currency or declare a single reporting currency. Must be decided, not defaulted |
| Comparison mode | vs. previous period / vs. last year. Needs history to exist |
| Empty/new-instance state | A freshly-connected instance has no history. What the page says on day one is a real design question |

### Observations from laying the catalogue out

1. **The cheap wins are not the headline ones.** D6 (listing coverage %), E2, E6, F3, F4, F5, H2 are all 🟢 — they need no order-money work at all. A genuinely useful page could exist before revenue is ever computed correctly.
2. **One backend decision unlocks the most rows.** Making order item lines queryable ([L]) is a precondition for ~15 of the candidates, including the flagship D1 and D2.
3. **Three metrics are permanently blocked without new data capture**: anything needing cost ([$] — A/C/D/E rows), marketplace fees (B7), and refunds (A11).
4. **Fixing cancellations ([C]) buys correctness for the entire A and B groups at once**, and turns A7 from a gap into a feature.
5. **Gross-vs-net ([G]) is the most dangerous item in this document.** Every other correctness gap produces a number that is obviously missing or obviously zero. This one produces a *plausible* number that is wrong in a consistent direction — overstating whichever channel reports gross. A channel-mix chart is the headline cross-channel artefact, and it is exactly the chart this breaks.
6. **The data-trust group (L) may outrank half the metrics.** Analytics over ingested data is only as true as the ingestion. "Sales dropped 40%" and "the Allegro poll died on Tuesday" render identically without L1–L3 — and OL already holds everything needed to tell them apart. These are 🟢 and cheap.
7. **Reading the actual snapshot shape beat reasoning about it.** Group I did not come from a metrics framework; it came from opening `order.types.ts` and finding `codToCollect`, `pickupPoint`, `deliverySmart` and `paymentStatus` already populated — PL-specific commerce signals with no analytical consumer today. `deliverySmart`'s doc comment even names analytics as its intended future reader.

### Known true gaps — things a seller may want that OL cannot answer

Stated so their absence is a recorded decision rather than an oversight. Each needs a *data-capture* feature before any chart is possible:

| Gap | Blocker |
|---|---|
| Returns / exchanges / withdrawal rate | No return entity anywhere. PL's 14-day right of withdrawal makes this a real operational cost that OL is blind to |
| Refunded value | `refunded` exists as an unwritten enum member only |
| Marketplace commissions and fees | Not ingested from any marketplace |
| Shipping cost vs. shipping charged | Shipments carry no cost column, so shipping margin is unknowable |
| Product cost / profitability / stock value | No cost basis on any entity |
| Price-change impact over time | No price history is retained — only the current price |
| Abandoned carts and conversion | OL sits downstream of checkout and never observes one |
| Frequently-bought-together / basket affinity | Computable in principle once item lines are rows ([L]), but heavy, and squarely the analyst persona we chose not to serve |

---

## 5. Layout candidates

Three candidate page structures, designed as a **selection device**: choosing one collapses the ~100-row catalogue into a shippable set. Wireframes are structural, not visual.

### Design constraints discovered (these are binding, not preferences)

Source: `docs/frontend-ui-style-guide.md`, `apps/web/package.json`, `apps/web/src/shared/ui/`.

| Constraint | Consequence for this page |
|---|---|
| **No charting library is installed.** Deps are Radix, TanStack, cmdk, RHF, zod, router, posthog. The precedent is hand-rolled inline SVG (`shared/ui/sparkline.tsx`: *"No charting library — just a polyline fit to values"*) | Either hand-roll each chart form, or negotiate a library adoption (guide requires written rationale + a wrapping primitive under `shared/ui/` + a guide update). **A decision, not an assumption** |
| Guide: *"prefer tables and structured lists over dashboard-style card grids… introduce tables early instead of relying on summary cards alone"*; *"do not center the app on decorative dashboards"* | A wall-of-charts page would violate house style. Table-first is the native idiom |
| Status hues are reserved for status meaning — **never decorative or series tinting** | A multi-series channel chart cannot colour channels with success/warning/error. Series need a neutral ramp or non-colour encoding (position, label, direct annotation) |
| Primary content must appear within ≤120px of viewport top; no empty workspace strip | The date-range control cannot occupy a tall hero band |
| All numerics require `font-variant-numeric: tabular-nums` (`.tabular`) | Every figure on this page |
| Existing primitives: `PageLayout`, `.status-strip` + `KpiCard` (sparkline slot, `to` link, tone), `DataTable` (sortable, `hideBelow`, card view, virtualize ≥500), `SegmentedControl`, `Chip`, `Tabs`, `EmptyState`/`ErrorState`/`LoadingState`, `Sparkline`, `TimeDisplay` | Most of the page is assemblable from stock parts |
| **No `DateRangePicker` and no `FilterBar` exist.** De-facto pattern is `.toolbar` + native `<input type="date">` + `Chip` row, URL-param driven (`orders-list-page.tsx:1094-1155`) | This page either reuses that pattern or is the place that finally extracts a shared component. Either way it is real FE work |

---

### Design 1 — "Ledger" (table-first, maximally guide-native)

Treats analytics as dense operational tables with inline sparklines. Almost no bespoke charting.

```
┌────────────────────────────────────────────────────────────────────┐
│ Analytics · Business overview            [7d][30d][90d][Custom ▾]  │
│ Data current to 14:32 · Allegro 8mo · Shop 8mo · Erli 6d      (L1-L3)│
├────────────────────────────────────────────────────────────────────┤
│ ┌─Revenue────┐┌─Orders─────┐┌─AOV────────┐┌─Units──────┐           │
│ │ 48 210 PLN ││ 412        ││ 117 PLN    ││ 689        │  status-  │
│ │ ▁▂▃▅▇ +12% ││ ▁▂▂▃▄ +4%  ││ med. 89    ││ ▁▃▄▄▅ +9%  │  strip    │
│ └────────────┘└────────────┘└────────────┘└────────────┘  KpiCard  │
├────────────────────────────────────────────────────────────────────┤
│ BY CHANNEL                                          DataTable      │
│ Channel    Revenue   Share  Orders   AOV   Units   Trend           │
│ Allegro    31 400    65%    268      117   445     ▁▂▃▅▇           │
│ Shop       14 900    31%    121      123   198     ▁▂▂▃▄           │
│ Erli        1 910     4%     23       83    46     ▁▃▂  (6d only)  │
├────────────────────────────────────────────────────────────────────┤
│ TOP PRODUCTS                            [by revenue|units] toggle  │
│ Product      SKU      Units  Revenue  Allegro Shop Erli  Trend     │
│ Widget A     WA-1      142   8 400     120    22   —     ▁▃▅▇      │
│ Widget B     WB-7       98   6 100      31    67   —     ▁▂▃▃      │
│   ↑ per-product channel split inline = D1 flagship, no extra page  │
├────────────────────────────────────────────────────────────────────┤
│ NEEDS ATTENTION                                                    │
│ • 12 variants selling on Allegro, not listed in Shop      (D2)     │
│ • 4 fast movers below safety buffer                       (E1)     │
│ • 3 400 PLN of orders failed to reach a destination       (K4)     │
└────────────────────────────────────────────────────────────────────┘
```

**Covers:** A1–A5, A′1–A′5, B1–B3, C1–C3, D1, D2, E1, K4, L1–L3
**Charting needed:** sparklines only — **already built**
**Strengths:** ships fastest; house-native; D1 flagship arrives free as inline table columns; scales to many rows without redesign
**Weaknesses:** no trend chart at all — "how did the last 30 days look?" is answered by a 5-point sparkline; reads as a report, not a dashboard, and may underwhelm a seller expecting visuals

---

### Design 2 — "Two tabs: Sales / Cross-channel"

Separates the familiar layer from the OL-exclusive layer so each can be judged — and shipped — on its own.

```
┌────────────────────────────────────────────────────────────────────┐
│ Analytics                                [7d][30d][90d][Custom ▾]  │
│ ┌──────────┬────────────────┐                                      │
│ │ Sales    │ Cross-channel  │   ← Tabs (existing primitive)        │
│ └──────────┴────────────────┘                                      │
├─ TAB: SALES ───────────────────────────────────────────────────────┤
│ [Revenue][Orders][AOV + median][Units]              status-strip   │
│                                                                    │
│ ┌── Revenue over time ─────────────────────────┐  ← THE hero chart │
│ │     ╱╲      ╱╲                               │    (bespoke SVG)  │
│ │ ╱╲╱   ╲╱╲╱╱   ╲╱╲                            │  stacked by chan. │
│ └──────────────────────────────────────────────┘                   │
│ BY CHANNEL table · TOP PRODUCTS table · COMMERCE MIX (COD/Paczko)  │
├─ TAB: CROSS-CHANNEL ───────────────────────────────────────────────┤
│ Coverage: Allegro 92% · Shop 61% · Erli 12%          (D6, cheap)   │
│                                                                    │
│ PRODUCT × CHANNEL MATRIX                            (D1 flagship)  │
│ Product    Allegro   Shop    Erli    Total   Gap                   │
│ Widget A     120      22      —       142    not listed: Erli      │
│ Widget B      31      67      —        98    not listed: Erli      │
│                                                                    │
│ COVERAGE GAPS (D2) · PRICE DISPERSION (D4) · STOCK AT RISK (E1)    │
└────────────────────────────────────────────────────────────────────┘
```

**Covers:** Design 1's set, plus A6, B4, D3–D6, I1–I6
**Charting needed:** one hero time-series (stacked area or grouped bars) — bespoke SVG or a library
**Strengths:** the two layers ship independently (cross-channel tab needs no revenue correctness at all — it can go first); the matrix is the clearest expression of the flagship; each tab stays within one screen
**Weaknesses:** tabs hide half the value behind a click, and the cross-channel tab is the half a first-time visitor won't find; two tabs invites two half-finished pages

---

### Design 3 — "Question-led" (narrative scroll)

Organised by the operator's questions in the order they'd ask them, with trust state promoted to the top.

```
┌────────────────────────────────────────────────────────────────────┐
│ Analytics                                [7d][30d][90d][Custom ▾]  │
├────────────────────────────────────────────────────────────────────┤
│ ⚠ Allegro orders last ingested 2 days ago — figures below may be   │
│   incomplete.                          [View sync]   ← L3, banner  │
├────────────────────────────────────────────────────────────────────┤
│ HOW DID WE DO?          [Revenue][Orders][AOV][Units] + trend chart │
├────────────────────────────────────────────────────────────────────┤
│ WHERE IS IT COMING FROM?   channel table + mix-over-time            │
│                            COD 61% · Paczkomat 74% · Smart! 38%    │
├────────────────────────────────────────────────────────────────────┤
│ WHAT IS SELLING?           top products w/ inline channel split     │
├────────────────────────────────────────────────────────────────────┤
│ WHAT AM I LEAVING ON THE TABLE?                                     │
│   12 variants sell on Allegro but aren't listed in Shop  →[Publish] │
│   4 fast movers will hit the safety buffer in ~3 days    →[View]    │
│   3 400 PLN stuck in failed destination syncs            →[Fix]     │
└────────────────────────────────────────────────────────────────────┘
```

**Covers:** the widest set — A, A′, B, C, D, E, I, K, L
**Charting needed:** 1–2 bespoke charts
**Strengths:** every section answers a sentence an operator would actually say; the closing section converts insight into action with links into existing OL flows — the strongest argument that this page belongs *inside* OL rather than in a BI tool; degrades gracefully (any section can ship empty or later)
**Weaknesses:** longest page, most scroll; widest scope, so the highest risk of a sprawling v1; section order is an opinion that may not survive contact with users

---

### Comparison

| | D1 Ledger | D2 Two tabs | D3 Question-led |
|---|---|---|---|
| Catalogue rows covered | ~20 | ~30 | ~40 |
| New chart forms | 0 | 1 | 1–2 |
| Charting-library decision forced? | **No** | Yes | Yes |
| Can ship before revenue is correct? | Partly | **Yes — whole cross-channel tab** | Partly (sections) |
| Guide-native | **Highest** | High | Medium (banner + narrative sections are new) |
| Risk of sprawling v1 | Low | Medium | **High** |
| Feels like "analytics" to a seller | Low | Medium | **High** |

### The charting-library question (independent of layout)

Designs 2 and 3 need at least one real time-series chart. Three ways to get it:

1. **Hand-rolled inline SVG**, extending the `Sparkline` precedent. No new dependency, full token control, matches house style. Costs real FE time per chart form and re-solves axes, ticks, tooltips and responsiveness by hand.
2. **Adopt a headless/light library** (the guide permits this with written rationale + a `shared/ui/` wrapping primitive + a guide update). Faster to many chart forms; adds a dependency and a styling-conformance burden, and the series-colour constraint still applies.
3. **Avoid charts entirely** (Design 1). Zero cost, and the least "analytics-feeling" result.

**Recommendation.** Ship **Design 1's structure as the v1 skeleton, sequenced toward Design 3.** Design 1 is the only candidate that needs no new chart primitive and no library decision, so it converts backend progress into visible product immediately; Design 3's sections are additive to it rather than a rewrite. Design 2's genuinely good idea — that the cross-channel half can ship *before* revenue correctness lands — should be kept as a **sequencing** insight without paying for tabs: in Design 1 that half is simply the sections that render first.

---

## 6. Selected shape and v1 metric cut

**Chosen:** Design 1 ("Ledger") as the v1 skeleton, sequenced toward Design 3 ("Question-led"). Design 3's closing *"what am I leaving on the table"* section is pulled into v1 — it is a list, not a chart, so it is cheap, and it is the strongest argument for this page living inside OL rather than in a BI tool: each row ends in an action OL can perform.

**Charting:** deferred. The v1 cut needs no chart form beyond the existing `Sparkline` primitive. The library-vs-hand-rolled decision is made when the first real time-series is scheduled, not before.

### The v1 cut

| Section | Rows from § 4 | Depends on |
|---|---|---|
| **Trust header** — data-current-as-of, per-channel coverage window, stalled-ingestion warning | L1, L2, L3, L4 | nothing new 🟢 |
| **KPI strip** — Revenue, Orders, AOV (with median), Units | A1, A2, A′1, A′5, A4 | analytics substrate [C][T][X][G][L] |
| **By channel** — revenue, share, orders, AOV, units, trend sparkline | B1, B2, B3, B6 | substrate |
| **Top products** — units, revenue, **inline per-channel split**, trend | C1, C2, D1 | substrate |
| **Needs attention** — coverage gaps, stock at risk, value stuck in failed syncs | D2, E1, K4 | mappings + inventory + sync only 🟢 |

**Deliberately deferred to v2** (in the catalogue, not in v1): all of group I (commerce mix — COD, Paczkomat, Smart!), group J (timing), the revenue time-series chart (A5) and channel-mix-over-time (B4), price dispersion (D4/D5), and every 🔴 row.

### Shipping order — and why

The cut splits cleanly along a correctness boundary:

1. **Trust header + Needs attention first.** Neither touches order money. Both are 🟢 against data OL already holds. This puts a genuinely useful, *honest* page on screen before any revenue work lands — and if revenue correctness proves harder than expected, this half still stands on its own.
2. **Analytics substrate second.** The single largest piece: making order lines queryable and resolving [C] cancellations, [T] placed-at, [X] currency and [G] gross-vs-net. Nothing money-shaped can be trusted before it.
3. **Money sections last.** KPI strip, by-channel and top-products all read from the substrate and are comparatively thin once it exists.

---

## 7. User stories & acceptance criteria

**S1 — As an operator, I want to see how sales are doing across all my channels in one place, so that I don't reconcile Allegro and my shop by hand.**
- Selecting a date range shows revenue, order count, average order value and units for that range
- Every figure is attributed to a currency; mixed-currency data never silently sums into one number
- Cancelled orders are excluded from revenue, and the operator can see how much was cancelled
- The average order value is shown with a median beside it

**S2 — As an operator, I want to see which channel my sales come from, so that I can decide where to invest effort.**
- A table lists each connected channel with its revenue, share, orders, AOV and units for the range
- Gross-reporting and net-reporting channels are compared on the same basis, or the page states that it cannot compare them
- A channel with less history than the selected range is visibly marked as such

**S3 — As an operator, I want to see what's selling and where, so that I can spot a product doing well on one channel and not another.**
- A top-products table ranks by revenue or units (operator's choice)
- Each row breaks the product's sales down per channel, in the same row
- A product selling on one channel but not listed on another is visibly flagged

**S4 — As an operator, I want to know what I'm leaving on the table, so that the page tells me what to do, not just what happened.**
- The page lists variants selling on one channel that aren't listed on another, and links into the publish flow
- It lists fast-moving variants at risk of running out given the connection's stock safety buffer
- It reports the value of orders that failed to reach a destination, and links to the failures
- Each item links into the existing OL flow that resolves it

**S5 — As an operator, I want to know whether to believe the numbers, so that I don't mistake a broken sync for a sales drop.**
- The page states how current the data is
- A channel whose ingestion has stalled is called out explicitly, with a link to the sync detail
- Each channel's available history window is shown, so a short-history channel isn't misread as underperforming
- A new instance with no history shows an explanatory empty state, not zeros

**S6 — As an operator on a phone, I want the page to remain usable, so that I can check it away from the desk.**
- KPI strip reflows; tables switch to card view; no horizontal page scroll

---

## 8. Out of scope

- **The `/` operational dashboard** — unchanged; triage stays there
- **Exports, scheduled reports, emailed digests** — if an operator needs a spreadsheet, they have a real BI tool
- **Customer analytics** (LTV, cohorts, retention) — outside the chosen persona, and marketplace buyer identity is too weak to support it
- **Anything requiring a cost basis** — margin, profitability ranking, stock value. Blocked until a cost basis exists; likely alongside #1029
- **Marketplace fees, refunds, returns** — OL does not ingest them; each needs a data-capture feature first
- **Forecasting and replenishment suggestions** — a different product
- **History backfill from before OL was connected** — the page reports what OL ingested; § 5's coverage-window disclosure exists precisely to make that limit visible rather than hidden

---

## 9. Definition of done

- An operator running ≥2 channels opens `/analytics` and answers "how are we doing and where is it coming from" without opening Allegro or the shop
- The numbers survive scrutiny: a maintainer can reconcile a day's revenue against the source marketplace and explain any difference from the page itself
- No figure on the page is knowingly wrong — where OL cannot assert something (mixed currency, short history, stalled ingestion), the page says so rather than rendering a confident number
- The "needs attention" section produces at least one action an operator actually takes in the first weeks of use
- 2–3 real deployments keep the page in use beyond the first week — it is not visited once out of curiosity and abandoned

---

## 10. Risks

| # | Risk | Why it matters |
|---|---|---|
| R1 | **Sellers don't come to OL for business questions.** The habit is Allegro's panel; a page nobody revisits is a maintenance liability | The core persona bet. Mitigated by the cross-channel and "needs attention" sections, which have no equivalent elsewhere — but not eliminated |
| R2 | **A quietly-wrong number is worse than none.** Gross-vs-net [G] especially: it produces a plausible figure wrong in a consistent direction | Directly attacked by shipping the trust half first and by the DoD's "no knowingly wrong figure" rule |
| R3 | **The substrate work is the majority of the epic** and is invisible to the user. Momentum may erode before anything ships | Mitigated by the shipping order — the 🟢 half reaches screen first |
| R4 | **Scope creep from a 100-row catalogue.** Every deferred row is a plausible "just add" request | The catalogue is explicitly a menu; § 6 records the cut |
| R5 | **Empty-page problem.** A newly-connected instance has no history, so the first impression of a brand-new install is a page of dashes | L4's empty state is in v1 scope for exactly this reason |

---

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-08-03 | Framed as one destination with two layers (familiar sales + cross-channel), not a generic BI page | A generic sales dashboard duplicates what Allegro and the shop already show; the cross-channel view is the only defensible part. The sales layer earns its place as the legible entry point, not as the value |
| 2026-08-03 | `/` operational dashboard stays untouched; `/analytics` is a separate destination | Two audiences and two time-horizons (triage-now vs. review-weekly); mixing them serves neither |
| 2026-08-03 | Enumerate the full metric catalogue (§ 4) before designing endpoints or UI | Maintainer's call. Vindicated: reading `order.types.ts` rather than reasoning about it surfaced group I (COD, Paczkomat, Smart!) and the [G] gross-vs-net landmine, neither of which a top-down metrics framework would have produced |
| 2026-08-03 | Margin pillar dropped from the epic | No cost basis exists on any entity. #1843 derives a destination price from a *selling* price, so the honest claim is price-uplift, not margin. Revisit alongside #1029 |
| 2026-08-03 | Layout chosen: Design 1 skeleton sequenced toward Design 3; Design 3's actionable closing section pulled into v1 | Design 1 is the only candidate needing no new chart primitive, so backend progress becomes visible product immediately, and Design 3 is additive rather than a rewrite. The actionable section is a list, not a chart — cheap, and the strongest reason the page belongs inside OL |
| 2026-08-03 | Charting-library decision deferred | The v1 cut needs nothing beyond the existing `Sparkline`. Deciding now would be speculative; the guide requires a written rationale we don't yet have |
| 2026-08-03 | Ship the trust + needs-attention half **before** any revenue work | Neither touches order money; both are 🟢 today. Puts an honest, useful page on screen early and de-risks the substrate work (R3) |
