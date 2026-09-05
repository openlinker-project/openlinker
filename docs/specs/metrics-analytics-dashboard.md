# Analytics Dashboard — Metric Definitions

**Status:** canonical source
**Scope:** every figure rendered on the `/analytics` dashboard
**Related:** [#2003](https://github.com/openlinker-project/openlinker/issues/2003) (Ledger mockup), [#1990](https://github.com/openlinker-project/openlinker/issues/1990) (KPI strip), [#1983](https://github.com/openlinker-project/openlinker/issues/1983) (aggregate computation)
**Last updated:** 2026-08-14

This file is the **single source of truth** for what each analytics figure means and how it is
computed. The mockup at `docs/plans/mockups/analytics-ledger-2003.html` quotes these definitions in
its ⓘ popovers; the mockup is a copy, this is the original. On any divergence between a rendered
label, an issue body and this file, **this file wins** — and the divergence is a bug worth raising,
not a wording preference to resolve locally.

Do not invent, extend or paraphrase a definition. If a figure is needed that this file does not
cover, it needs a decision from product before it is built.

## UI label ↔ metric name

The dashboard cards are narrow, so three figures render under a shorter label than their metric
name. The mapping is deliberate; neither side is a typo.

| Label on the card | Metric in this file |
|---|---|
| Refunded value | Returns Value |
| Cancelled value | Cancellations Value |
| Units per order | Units per Order |

Every other figure uses its metric name verbatim.

---

## Rules common to all metrics:

- Net – amount excluding VAT.
- **Where the VAT rate comes from** (added 2026-08-14, after the call — not part of the originally
  agreed text) – the rate is supplied by the **ProductMaster** per (product, delivery country) and
  **OpenLinker never computes it** ([#2054](https://github.com/openlinker-project/openlinker/issues/2054)).
  Where a metric below says "VAT calculated by country of delivery", the delivery country is the axis
  the rate is resolved on — it does not make OpenLinker the owner of the arithmetic. Until the rate
  reaches the order snapshot, an order with no rate — or one whose master and channel rates disagree —
  is excluded from every net figure and the excluded count is reported with it, never counted at gross.
- All amounts converted to a single currency (PLN/EUR) at the exchange rate from the day preceding the order (agreed on the call).
- An order is assigned to a period based on the **order placement date** (not the payment/shipment date).
- **Net Order Value (NOV)** – the sum of the net value after line-item discounts (excluding shipping) of orders placed in the period, excluding cancelled orders. This is the base figure for Net Sales, AOV and Median Order Value.
- **Partially cancelled orders** (added 2026-08-14, after the call — not part of the originally
  agreed text) – an order in which some but not all line items were cancelled is **not** a cancelled
  order. It counts as one order in Number of Orders, and its surviving line items count normally in
  GMV, Units Sold and every figure derived from them. Its **cancelled** line items are excluded from
  GMV and Units Sold. Wherever a metric below says "excluding cancelled orders", it means orders
  cancelled in full; line-item-level cancellations are handled by this rule.
- **Net / Gross view toggle** (added, shipped with #2895/#2903 — an operator-facing addition, not
  part of the originally agreed text) – the dashboard offers a page-level Net/Gross basis toggle.
  **Every metric below is defined NET by default**, exactly as written; the toggle's Gross setting
  is a secondary VIEW of the same underlying order/line population, substituting GMV for Net Sales
  and the gross (VAT-inclusive) value field for AOV/Median's net value field, with every other rule
  on this page (cohort, exclusions, currency conversion) unchanged. It does not introduce a second
  metric definition — GMV and Net Sales each already have their own definition below, and Gross-mode
  AOV/Median simply reuse GMV's value field the same way Net-mode AOV/Median reuse Net Sales'.

## List of metrics:

### Gross Merchandise Value (GMV)

**Definition:** the total value of orders placed in the period (excluding cancelled orders), at gross selling prices (incl. VAT), before deducting discounts, commissions and returns. Covers the merchandise portion only – excluding shipping costs.

**Formula:** `SUM(gross_unit_price before discount × quantity, for all line items of orders placed in the period, excluding cancelled)`

**Source:** Orders API – sum of the order's gross value field; without any adjustments. Do not convert to net.

### Net Sales

**Definition:** the net value (excluding VAT) of orders placed in the given period (excluding cancelled orders), reduced by discounts and the net value of returns. Does not include: cancelled orders, costs (commissions, advertising, goods) or shipping revenue.

**Formula:** `SUM(net value after line-item discounts of orders placed in the period, excluding cancelled) − Returns Value (same period)`

**Source:** orders API/report from each platform — order value field after discounts; VAT calculated by country of delivery; returns from the returns module.

### Number of Orders

**Definition:** the number of orders placed in the period (excluding cancelled orders).

**Formula:** `COUNT(orders placed in the period, excluding cancelled)`

**Source:** Orders API, counted by order ID.

### Average Order Value (AOV)

**Definition:** the average value of a single order, net, after discounts, before accounting for returns. Calculated on orders placed in the period, excluding cancelled orders. Orders in which a return occurred are included at their full original value.

**Formula:** SUM(net value after discounts of orders placed in the period, excluding cancelled) ÷ Number of Orders (same period, same definition)

**Source:** calculated by us. The numerator and denominator must operate on exactly the same set of orders as Number of Orders and Median Order Value.
**Interpretation note:** AOV does not multiply back to Net Sales, because Net Sales is reduced by returns. The difference between (AOV × Number of Orders) and Net Sales is exactly the Returns Value.

### Median Order Value

**Definition:** the value of the middle order (excluding cancelled) after ranking all orders in the period from cheapest to most expensive; 50% of orders are cheaper, 50% more expensive.

**Formula:** `MEDIAN(net values after discounts of orders placed in the period, excluding cancelled)` – the same set of orders and the same value field as in AOV, so that the two figures are comparable.

**Source:** calculated from individual order records.

### Average Daily Orders

**Definition:** the average number of orders placed per calendar day over the analyzed period. We include orders placed in the period by order placement date, excluding cancelled orders.

**Formula:** `number of orders placed in the period (excluding cancelled) ÷ number of calendar days included in the period`

**Source:** calculated from the Number of Orders metric.

We divide by **calendar** days, not business days.

- For a completed period we use the full number of calendar days of that period.
- For the current period, e.g. an ongoing month, we include only the days from the start of the period **up to and including the current day**.
- The numerator and denominator must cover exactly the same date range. If the numerator includes orders from the current day, the current day must also be included in the denominator.
- We do not divide by the full number of days in the month (30/31) if the month is still ongoing, as this would artificially deflate the metric.

### Units Sold

**Definition:** the total number of product units sold in the period (the sum of quantities across all line items of placed orders, excluding cancelled).

**Formula:** `SUM(quantity across all line items of orders placed in the period, excluding cancelled)`

**Source:** order lines / line items from the platforms' API – quantity field on the line item. Note: this is a different data level than orders – one order has multiple line items, and one line item has quantity ≥ 1.

### Units per Order

**Definition:** the average number of product units in a single order (excluding cancelled).

**Formula:** `Units Sold ÷ number of orders placed in the period (excluding cancelled)`

**Source:** calculated by us, not from the platform.

### Return Rate

**Definition:** the share of placed orders (excluding cancelled) from the given period for which at least one refund was issued (full or partial return). What counts is the refund event — not the return request itself, nor the physical receipt of goods.

**Formula:** `number of orders from the given period for which at least one refund was issued ÷ number of orders placed in the same period (excluding cancelled) × 100%`

**Source:** the platform's returns/RMA module. We count unique order IDs for which at least one refund was issued (status of the type "return processed"). The denominator and numerator must operate on exactly the same cohort of orders (the same start date). The trigger point must be identical to that in Returns Value, so that both metrics describe the same set of returns.

### Returns Value

**Definition:** the total amount refunded to customers, net (excluding VAT), for orders placed in the analyzed period, excluding cancelled orders. We count only completed refunds and only from the merchandise portion, excluding refunded shipping costs.

**Formula:** `SUM(net refunded amounts for orders placed in the analyzed period)`

**Source:** the platform's refunds/returns API – refund amount field. **Important rule:** We convert the refund amount to PLN/EUR at exactly the same exchange rate as the original order (from the day preceding the order).

### Cancellation Rate

**Definition:** the share of orders placed in the analyzed period (by placement date) that were cancelled — regardless of when the cancellation itself occurred.

**Formula:** `number of cancelled orders among those placed in the period ÷ total number of orders placed in the period (including cancelled) × 100%`

**Source:** Orders API – "cancelled" status + no shipment event. The cohort is defined by order placement date, consistent with Return Rate and the other metrics.

### Cancellations Value

**Definition:** the total net value of orders **placed in the analyzed period** (by placement date) that were cancelled before shipment – revenue that was "in the basket" but did not proceed to fulfillment.

**Formula:** `SUM(net value of orders placed in the period with cancelled status)`

**Source:** Orders API – order value for cancelled records; VAT deducted by country of delivery. Cohort by order placement date, consistent with Cancellation Rate.

**Scope note (decided 2026-08-14):** this figure covers **fully** cancelled orders only, so that it
describes the same set of orders as Cancellation Rate. The consequence is deliberate and worth
stating, because it looks like a bug from the outside: the value of individual line items cancelled
out of an order that still shipped is reported **nowhere** — it drops out of GMV under the
partially-cancelled rule above, and it does not enter Cancellations Value. Reporting it needs a
separate figure, not a widening of this one.
