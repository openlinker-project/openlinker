# Decision analysis — fulfilment grain for the OMS module

**Question:** does OpenLinker separate the *unit of purchase* from the *unit of work*, and if so, at what cost?
**Status:** **ADOPTED** as D17 in
[`ANALYSIS-1032-oms-module.md`](./ANALYSIS-1032-oms-module.md) — Wave 2
items 13–16, with `shipment_lines` keyed `(shipmentId, orderId, lineId)`, the PrestaShop mapper fix
as a prerequisite, the `fulfillment-rollup.ts` precedence fix in the same change, and backfill written
as ledger events.
**Date:** 2026-08-13

---

## Why this is being asked

An adversarial review found that `Shipment` carries `orderId` and **nothing line-level**, so the plan's
`shipped_quantity` / `delivered_quantity` counters have no derivable source — they would be exactly
the free-floating integers decision D2a exists to forbid. In parallel, a survey of the enterprise OMS
tier found that every serious system answers split authority by **decomposition, not reconciliation**:
Shopify's Fulfillment Orders, Fluent's Fulfilment Choice, Uber's per-entity statecharts.

The plan is built on reconciliation. So the question is whether that is the wrong foundation.

---

## Three positions

| | Model | Order status | Assignment |
|---|---|---|---|
| **A** | First-class fulfilment unit (Shopify FO shape) | rollup over units | per unit, persisted |
| **B** | Axis reconciliation (plan as written) | derived over axes + precedence | `processorKind`, derived per order |
| **C** | Shipments gain line references; no new aggregate | rollup over line coverage | unchanged |

---

## What the costing found

### The good news: the ports are already at the right grain

**`ShippingProviderManagerPort` and all five sub-capabilities need no change.** Every one is keyed on
`providerShipmentId` / `shipmentId` / `reference`. All three shipping adapters (InPost, DPD, Allegro
Delivery), both fakes and the InPost HTTP client were verified to never read order items. Carriers
already model "one label = one parcel"; a fulfilment unit maps onto labels *above* the port.

This is the single strongest signal that a grain change is tractable at all.

### The bad news, in four parts

**1. `shipment-dispatch.service.ts` (603 lines) is order-keyed in three safety-critical places** — the
Redis lock key, the `findActiveByOrderId` idempotency check, and the branch-1 row-reuse path. All
three exist to prevent double-paid labels. Its own comment is candid: *"at this grain the answer is
'this order is already shipping', not 'your carrier is'"* — which is precisely the assumption a
fulfilment unit invalidates.

**2. The frontend has one-shipment-per-order baked into ~4,000 lines** — `generate-label-form.tsx`
(839), `shipments-page.tsx` (626), `order-shipment-panel.tsx` (560), `bulk-dispatch-dialog.tsx` (510),
`dispatch-input.ts` (289), plus `pick-active-shipment.ts`, which loses its premise entirely.

**3. Historical line scope is unrecoverable.** No column, no dispatch-audit table, no persisted
`GenerateLabelCommand`. The only defensible backfill is "one unit per shipment, covering all lines" —
which **double-counts across every historical cancel-and-reissue pair**. Mitigation exists and must be
adopted explicitly: per D2a, if the backfill writes *ledger events* rather than counters, the
cancelled shipment's event is compensable. If it writes counters, the double-count is permanent.

**4. OMP-fulfilled routes can never express line-level fulfilment.** `FulfillmentStatusSnapshot` is
order-grain because PrestaShop and friends report one order state, and OL does not control those
contracts. Any unit model must tolerate **permanently order-grain units** for `omp_fulfilled` routes.

### The finding that reframes the whole question

**N shipments per order exist *sequentially*, never *concurrently*.** The multiplicity is designed-in
for cancel-and-reissue. Genuine parallel split fulfilment is blocked by two things: the
`findActiveByOrderId` idempotency check, and the partial unique index
`UQ_shipments_branch_one_per_order_conn` — one label-less shipment per `(order, connection)`.

And `processorKind` — the closest thing to an assignment — is keyed on
`(sourceConnectionId, sourceDeliveryMethodId)`. **One delivery method per order therefore resolves to
exactly one processor.** Splitting an order across two processors is not expressible today at any
layer, so option A would be introducing capability, not restoring it.

Meanwhile there is a live correctness bug waiting: `fulfillment-rollup.ts` uses "any `delivered` ⇒
`delivered`". Correct for cancel-and-reissue; **wrong the moment shipments become partial**, where one
delivered unit of three would report the whole order delivered.

---

## Recommendation: C now, A as a door left open

**Attribute lines to shipments. Do not introduce a fulfilment-unit aggregate yet.**

A `shipment_lines` join delivers the structural fix. **Key it on `(shipmentId, orderId, lineId)` —
including `orderId`.** That single extra column is the only thing that keeps *consolidated shipping*
(one parcel covering lines from two orders) expressible, and it costs nothing now on a table already
being backfilled lossily. Omitting it means a second migration on the same table. It is also the
useful half of "merge" without touching order identity — see plan § 6J.

- `shipped_quantity` and `delivered_quantity` become **derivable** — D2a becomes implementable, and
  the plan's own framing claim ("'3 of 5 shipped' is not a status") becomes true of OL for the first time.
- `partially_shipped` becomes expressible, and the rollup precedence bug gets fixed as part of the work
  rather than discovered later.
- **Sequential partial fulfilment already works.** Ship 3 of 5, dispatch it; the row is terminal, so the
  order-grain in-flight check does not block the second shipment. The lock only blocks *concurrent*
  dispatch, and real partial fulfilment is usually sequential.

What C deliberately does **not** buy: concurrent multi-processor split, and per-unit persisted
assignment. Neither is expressible today anyway (`processorKind` resolves once per order), so C forgoes
nothing OL currently has.

**C is forward-compatible with A.** A fulfilment unit needs a line-association table regardless; C
builds exactly that table and leaves the aggregate for when a real need appears — a seller shipping one
order from two locations, or a 3PL owning part of an order.

### Cost comparison

| | Change size | Risk | Migration | Buys |
|---|---|---|---|---|
| **A** | large — dispatch service, ~4k lines FE, schema + backfill, ~20 int-specs, invoicing | high — touches double-paid-label guards | lossy, irrecoverable line scope | full decomposition; permanently degraded for OMP routes |
| **B** | none now, 12 fixes later | medium — keeps the harder path forever | none | nothing new; `shipped_quantity` stays underivable |
| **C** | medium — join table, rollup, counters, backfill-as-events, FE line panel | low — dispatch grain untouched | same lossy backfill, but compensable via events | D2a implementable, partial states expressible, A stays open |

### Adopt with C

1. **Backfill writes ledger events, not counters** — otherwise cancel/reissue double-counts permanently.
2. **Fix `fulfillment-rollup.ts` precedence** in the same change; "any delivered ⇒ delivered" is wrong
   under partial coverage.
3. **`OrderItem.id` stability — verified, and PrestaShop fails.** Allegro (`lineItem.id`), Erli and
   WooCommerce pass through stable platform ids. **PrestaShop does not**:
   `prestashop-order.mapper.ts:53` is `String(row.id || index)` — an array-index fallback that is
   positional, plus `||` instead of `??` so a legitimate `row.id === 0` falls through too, and an
   index-derived id can collide with a real `row.id`. Fix the mapper or assign an OL-side surrogate
   before keying `shipment_lines` on it. Keep the denormalised `sku`/`ean`/`name` hedge regardless.
4. **PII — verified, no constraint.** `orderSnapshot.items` survives `OL_STORE_PII=false`
   **unconditionally**; only addresses (sanitised) and `customerEmail` (omitted) are gated. Backfill
   is viable for every order. Coherent rather than leaky — SKU and product name are marketplace data,
   not buyer data.
5. **State the OMP limit** — `omp_fulfilled` routes stay whole-order, permanently, by contract.

---

## What this does and does not fix

Of the twelve findings from the adversarial review, C resolves the **structural** one (D2a
unimplementable) and materially helps partial cancellation. It does **not** touch the SLA wall-clock
error, the `relayState` fan-out contradiction, the reservation unique key, the single-location
reservation model, or the idempotency NULL hole. Those remain and must be fixed on their own terms.

C is not an alternative to the twelve fixes. It is the one fix that cannot be done later cheaply.

---

## The honest case against C

B — leaving the model alone — is not obviously wrong. commercetools deliberately supports exactly OL's
posture: transition validation is **optional**, explicitly *"useful when external systems manage
workflows"*. It is the only vendor in the tier that designed for a system which is not the order
authority. If OL positions itself as the order *observer* rather than the order *authority*, much of
this machinery is unnecessary and B plus the twelve fixes is coherent.

The case for C is not that it is more correct in the abstract. It is that `shipped_quantity` is
currently a number the plan promises and the codebase cannot produce — and that gap does not close by
itself.
