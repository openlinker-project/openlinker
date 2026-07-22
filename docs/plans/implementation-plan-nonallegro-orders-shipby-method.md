# Implementation Plan — Non-Allegro orders: ship-by + delivery-method label (#1776)

## 1. Task

Orders list/detail show a blank delivery-method label and blank ship-by for some
orders. Root cause (verified in the issue by two code traces): both fields are
produced by the **source** adapter at ingestion, not by the shipping carrier.

Resolution (expanded scope): always show the delivery-method label with a
shipment-derived fallback; DERIVE an Erli ship-by from the connection's default
dispatch time (working-day math); keep WooCommerce blank by design.

- `order.dispatchByAt` (ship-by) is derived from `IncomingOrder.dispatchTime.to`
  (`order-record.service.ts` `deriveDispatchByAt`). Allegro maps `dispatchTime`
  from the per-order window; Erli now DERIVES one from the connection default
  (see §3); WooCommerce still maps none.
- `orderSnapshot.shipping.methodName` was rendered present-only on the FE, so the
  Method row went blank when the source order carried no delivery line.

**Layer**: Integration (Erli order mapper/adapter/factory — functional) + CORE
(orders record service, doc only) + Frontend (orders detail + list — functional).

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
2. **Erli derived ship-by**: `dispatchTime = { from: purchasedAt, to: purchasedAt
   + defaultDispatchTime }`, emitted by the Erli order mapper so core's
   `deriveDispatchByAt` + `slaState` pipeline lights up with ZERO core change. The
   connection's `defaultDispatchTime` is threaded factory → order-source adapter →
   mapper. Working-day math for `unit: 'day'` (weekends skipped; PL public holidays
   OUT OF SCOPE for v1); calendar hours/months for the other units. Never
   fabricated — when `purchasedAt` or `defaultDispatchTime` is missing the window
   is absent and ship-by stays blank. Surfaced UNLABELED (same as Allegro's
   server-computed window). This REVISES the earlier "blank by design for Erli"
   conclusion.
3. **WooCommerce stays blank by design** (UNCHANGED): no per-order SLA, no
   placedAt-equivalent handling time OL owns → genuinely underivable. Its
   docs/tests are left as-is.

No new ports, tokens, ORM entities, DTOs, or contract-surface changes. No core
type change (`OrderShipping.methodId` stays required — it is the fulfillment
routing key; the `typeId` guard in Erli's `mapShipping` is intentional). The
derived window reuses the existing neutral `OrderDispatchWindow` shape.

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
5. `libs/integrations/erli/.../erli-order.mapper.ts` — pure `resolveDispatchTime`
   + `addWorkingDays` helpers; emit `dispatchTime` present-only; revise header doc.
6. `libs/integrations/erli/.../erli-order-source.adapter.ts` — `defaultDispatchTime`
   ctor field, threaded into the mapper call.
7. `libs/integrations/erli/.../erli-adapter.factory.ts` — pass
   `config.defaultDispatchTime` into `ErliOrderSourceAdapter`.
8. `libs/integrations/erli/.../erli-order.mapper.spec.ts` — derived ship-by tests
   (working days, weekend-spanning, hour/month, absent-input).
9. `libs/core/src/orders/application/services/order-record.service.ts` — revise the
   `deriveDispatchByAt` doc note (Erli now derives; WC still blank).
10. `libs/integrations/erli/docs/runbook.md` — revise the ship-by quirk to
    "estimated ship-by from the connection default".
11. WooCommerce mapper/adapter + tests: LEFT UNCHANGED (blank by design holds).

## 5. Validation

- Scoped: `pnpm --filter @openlinker/integrations-erli test`; `apps/web` tests for
  the changed order components; scoped `lint` + `type-check`. Core untouched
  functionally (doc note only).
- Architecture: no boundary changes; reuses the neutral `OrderDispatchWindow`.
  Pre-implement gate unnecessary (no new abstractions / contract surface).
