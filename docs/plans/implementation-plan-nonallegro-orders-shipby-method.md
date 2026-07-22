# Implementation Plan — Non-Allegro orders: ship-by + delivery-method label (#1776)

## 1. Task

Orders list/detail show a blank delivery-method label and blank ship-by for some
orders. Root cause (verified in the issue by two code traces): both fields are
produced by the **source** adapter at ingestion, not by the shipping carrier.

Resolution (expanded scope): always show the delivery-method label with a
shipment-derived fallback; DERIVE an Erli ship-by from the per-offer handling time
(falling back to the connection default) as a Polish working-day estimate with PL
public holidays, marked `estimated`; keep WooCommerce blank by design.

- `order.dispatchByAt` (ship-by) is derived from `IncomingOrder.dispatchTime.to`
  (`order-record.service.ts` `deriveDispatchByAt`). Allegro maps `dispatchTime`
  from the per-order window; Erli now DERIVES one in the order-source adapter from
  the per-offer handling time / connection default (see §3), flagged `estimated`;
  WooCommerce still maps none.
- `orderSnapshot.shipping.methodName` was rendered present-only on the FE, so the
  Method row went blank when the source order carried no delivery line.

**Layer**: Integration (Erli order adapter/factory + product types — functional) +
Shared (pure `pl-working-days` date helper) + CORE (`OrderDispatchWindow.estimated`
+ record-service doc) + API (derived `dispatchByEstimated`) + Frontend (orders
detail + list — functional).

## 2. Investigation findings (what the source payloads actually expose)

- **Erli order resource** (`erli-order.types.ts`, verified against the #992 live
  spike): carries `status`, `user`, `items`, `delivery`, `totalPrice`,
  `created`/`updated`/`purchasedAt`. It exposes **no per-order dispatch deadline
  field**. Erli's dispatch/handling time (`ErliDispatchTime` = `{ period, unit }`)
  is a **connection-level** `defaultDispatchTime` OL applies **outbound** to offers
  on create. Because that default IS the seller's committed handling time, it is a
  legitimate best-effort basis for a per-order ship-by: `purchasedAt +
  defaultDispatchTime` (see §3). This REVISES the earlier "blank by design"
  conclusion for Erli — a derived estimate off the connection default is not
  fabrication (it reflects the seller's own configured handling time), it is only
  imprecise when a per-offer override diverges from the default (that override is
  not visible on the order).
- **WooCommerce order** (WC REST v3): exposes `date_created`, `date_modified`,
  `date_paid`, `date_completed` — **no dispatch/ship-by SLA** concept exists in WC
  core, and OL owns no WC handling time to derive from. Ship-by stays genuinely
  underivable → blank by design (UNCHANGED).
- **Delivery-method**: both adapters already populate `shipping.methodName` when
  the source carries delivery info — Erli from `delivery.name` (guarded on
  `delivery.typeId`, the routing key, #1738), WooCommerce from
  `shipping_lines[0].method_title`. The demo Erli orders had `delivery` with no
  `typeId`, so the routing-valid `shipping` was intentionally absent.
- **Carrier** (`order-detail-page.tsx`): the resolved shipment carrier feeds only
  the separate "Carrier" row (#1617), which always renders with a `-` fallback and
  never gates Method or ship-by.

## 3. Design decision

Three functional changes.

1. **Always show the delivery-method label (FE)**: the order-detail Method row and
   the orders-list carrier cell must not blank out when the snapshot carried no
   shipping line. Precedence: `snapshot.shipping.methodName → methodId → (detail
   only) shipment-derived carrier/method → snapshot.pickupPoint.name → "-"`. The
   list can't fetch per-row shipments, so snapshot-only (method name → method id →
   pickup name) is its ceiling. `OrderDeliveryPanel` gains a `methodFallback` prop
   the detail page fills from the booked shipment (`activeShipment.carrier` /
   `SHIPPING_METHOD_LABEL[activeShipment.shippingMethod]`), and the Method row is
   now always rendered.
2. **Erli derived ship-by** (v2, fuller): the window is derived in
   `ErliOrderSourceAdapter.getOrder` (post-mapping, NOT in the pure mapper —
   deriving it needs per-offer I/O). Per line, handling time = the **per-offer**
   `dispatchTime` read back from `GET /products/{externalId}`, falling back to the
   connection's `defaultDispatchTime` when the read carries none (defensive:
   behaviour degrades to the connection-default derivation with no regression if
   Erli never echoes the field). Each line's deadline is `purchasedAt +
   handlingTime`; the window takes the **soonest (MIN)** deadline across lines (first
   breachable obligation, matching the list's soonest-first SLA sort). For `unit:
   'day'` the math is **Polish working days** — weekends AND PL public holidays
   skipped, day boundaries at **Europe/Warsaw** — via the pure, tested
   `@openlinker/shared/date` helper (`addWorkingDays` + Easter computus); calendar
   hours/months for the other units. The window is flagged **`estimated: true`**
   (new optional field on `OrderDispatchWindow`), surfaced by the API as a derived
   `dispatchByEstimated` boolean and rendered as a subtle `~` / `est.` qualifier
   next to the ship-by badge (Allegro leaves it absent → authoritative, no
   qualifier). Never fabricated — when `purchasedAt` is missing, or ANY line has no
   resolvable handling time, the window is absent and ship-by stays blank; a failed
   per-offer GET degrades that line to the connection default rather than failing
   ingestion. Core's `deriveDispatchByAt` + `slaState` pipeline lights up unchanged.
   This REVISES the earlier "blank by design for Erli" conclusion.
3. **WooCommerce stays blank by design** (UNCHANGED): no per-order SLA, no
   placedAt-equivalent handling time OL owns → genuinely underivable. Its
   docs/tests are left as-is.

No new ports, tokens, ORM entities, or migrations. One additive contract change:
`OrderDispatchWindow` gains an optional `estimated?: boolean` (rides the JSONB
snapshot verbatim — no core-service change, no column) and the order-record
response DTO gains a derived `dispatchByEstimated: boolean`. `OrderShipping.methodId`
stays required — it is the fulfillment routing key; the `typeId` guard in Erli's
`mapShipping` is intentional. A new pure `@openlinker/shared/date` helper
(`pl-working-days`) hosts the working-day + PL-holiday + Warsaw-offset math.

## 4. Steps

1. `apps/web/src/features/orders/components/order-delivery-panel.tsx` — add
   `methodFallback` prop; render the Method row always with chain `methodName ??
   methodId ?? methodFallback ?? '-'`.
2. `apps/web/src/pages/orders/order-detail-page.tsx` — compute a shipment-derived
   `methodFallback` (`getCarrierDisplayName(activeShipment.carrier)` →
   `SHIPPING_METHOD_LABEL[activeShipment.shippingMethod]`) and pass it; extend the
   Carrier chain with `?? snapshot.pickupPoint?.name`.
3. `apps/web/src/pages/orders/orders-list-page.tsx` — add the `methodId` rung to
   the row + mobile carrier cells (snapshot-only).
4. `order-delivery-panel.test.tsx` — fallback-chain tests.
5. `libs/shared/src/date/pl-working-days.ts` (+ `index.ts`, `__tests__`, package
   `./date` export) — pure `addWorkingDays` / `isPlPublicHoliday` / `easterSunday`
   with Europe/Warsaw anchoring; weekend + fixed + computus-holiday + DST tests.
6. `libs/core/src/orders/domain/types/order.types.ts` — add optional
   `estimated?: boolean` to `OrderDispatchWindow`.
7. `libs/integrations/erli/.../erli-order.mapper.ts` — REMOVE the ship-by
   derivation (mapper stays pure; no `dispatchTime`, no `defaultDispatchTime` arg);
   revise header doc.
8. `libs/integrations/erli/.../erli-product.types.ts` — add optional
   `dispatchTime?: ErliDispatchTime` to the read-side `ErliProductResource`.
9. `libs/integrations/erli/.../erli-order-source.adapter.ts` — derive the window in
   `getOrder`: per-offer `GET /products/{externalId}` (cached, guarded, degrade on
   failure) → fallback to connection default → MIN across lines → `estimated: true`.
10. `libs/integrations/erli/.../erli-adapter.factory.ts` — pass
    `config.defaultDispatchTime` into `ErliOrderSourceAdapter` (unchanged from v1).
11. `apps/api/.../orders.controller.ts` + `dto/order-record-response.dto.ts` — emit
    derived `dispatchByEstimated` off the snapshot dispatch window.
12. FE: `orders.types.ts` (`dispatchByEstimated?`), `orders-list-page.tsx`
    (desktop + mobile badges), `order-detail-page.tsx`, `order-row-detail.tsx` —
    render the `~` / `est.` qualifier when estimated.
13. Tests: erli mapper spec (mapper no longer sets dispatchTime), erli order-source
    spec (per-offer + MIN + estimated + graceful-degrade), API controller spec
    (`dispatchByEstimated`), FE row-detail spec (est. qualifier).
14. `libs/core/.../order-record.service.ts` + `libs/integrations/erli/docs/runbook.md`
    — revise the ship-by doc notes to the v2 per-offer working-day estimate.
15. WooCommerce mapper/adapter + tests: LEFT UNCHANGED (blank by design holds).

## 5. Validation

- Scoped: `pnpm --filter @openlinker/integrations-erli test`; `apps/web` tests for
  the changed order components; scoped `lint` + `type-check`. Core untouched
  functionally (doc note only).
- Architecture: no boundary changes; reuses the neutral `OrderDispatchWindow`.
  Pre-implement gate unnecessary (no new abstractions / contract surface).
