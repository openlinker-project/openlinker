# Implementation Plan — Non-Allegro orders: ship-by + delivery-method label (#1776)

## 1. Task

Orders list/detail show a blank delivery-method label and blank ship-by for some
orders. Root cause (verified in the issue by two code traces): both fields are
produced by the **source** adapter at ingestion, not by the shipping carrier.

- `order.dispatchByAt` (ship-by) is derived from `IncomingOrder.dispatchTime.to`
  (`order-record.service.ts` `deriveDispatchByAt`). Only the Allegro adapter maps
  `dispatchTime`; Erli and WooCommerce map none.
- `orderSnapshot.shipping.methodName` is present-only; blank when the source order
  carried no delivery line.

**Layer**: Integration (Erli, WooCommerce order mappers) + CORE (orders record
service, doc only) + Frontend (orders detail, doc only).

## 2. Investigation findings (what the source payloads actually expose)

- **Erli order resource** (`erli-order.types.ts`, verified against the #992 live
  spike): carries `status`, `user`, `items`, `delivery`, `totalPrice`,
  `created`/`updated`/`purchasedAt`. It exposes **no per-order dispatch deadline**.
  Erli's dispatch/handling time (`ErliDispatchTime` = `{ period, unit }`) is a
  **connection-level** `defaultDispatchTime` OL applies **outbound** to offers on
  create — not a value Erli returns per order. Deriving a ship-by from
  `purchasedAt + handlingTime(working days)` would be fabrication (explicitly
  ruled out by the issue) and requires a business-calendar OL does not own.
- **WooCommerce order** (WC REST v3): exposes `date_created`, `date_modified`,
  `date_paid`, `date_completed` — **no dispatch/ship-by SLA** concept exists in WC
  core. Nothing to map.
- **Delivery-method**: both adapters already populate `shipping.methodName` when
  the source carries delivery info — Erli from `delivery.name` (guarded on
  `delivery.typeId`, the routing key, #1738), WooCommerce from
  `shipping_lines[0].method_title`. The demo Erli orders had `delivery` with no
  `typeId`, so the routing-valid `shipping` was intentionally absent.
- **Carrier** (`order-detail-page.tsx`): the resolved shipment carrier feeds only
  the separate "Carrier" row (#1617), which always renders with a `-` fallback and
  never gates Method or ship-by.

## 3. Design decision

Map only what the source really provides.

1. **Ship-by**: Erli and WooCommerce order payloads carry no per-order dispatch
   deadline → ship-by stays blank **by design**. Do not fabricate. The FE already
   renders the ship-by row present-only, so absence is already graceful. Document
   the decision in both mappers and near `deriveDispatchByAt`, and lock it with
   regression tests asserting no `dispatchTime` is emitted.
2. **Delivery-method**: already mapped whenever the source carries a method
   (Erli #1738, WC `method_title`) — AC2's primary branch. Add regression tests
   asserting `methodName` is populated. For source orders that genuinely carry no
   delivery method, the order-detail **Carrier row (#1617)** is the documented UI
   fallback (AC2's "or" branch) — clarify this in the panel doc comment; the
   Carrier row already surfaces the booked shipment's carrier.
3. **Carrier independence** (AC3): keep the carrier feeding only the Carrier row;
   assert in tests that the mappers never populate `dispatchTime` from carrier data
   (carrier is not part of the source order payload at all).

No new ports, tokens, ORM entities, DTOs, or contract-surface changes. No core
type change (`OrderShipping.methodId` stays required — it is the fulfillment
routing key; the `typeId` guard in Erli's `mapShipping` is intentional).

## 4. Steps

1. `libs/integrations/erli/src/infrastructure/adapters/erli-order.mapper.ts` —
   header doc note: Erli exposes no per-order dispatch deadline; ship-by blank by
   design (#1776).
2. `libs/integrations/erli/.../erli-order.mapper.spec.ts` — tests: mapped order has
   no `dispatchTime`; `methodName` mapped from `delivery.name`.
3. `libs/integrations/woocommerce/src/infrastructure/adapters/woocommerce-order-source.adapter.ts`
   — doc note: WC exposes no dispatch SLA; ship-by blank by design (#1776).
4. `libs/integrations/woocommerce/.../woocommerce-order-source.adapter.spec.ts` —
   tests: `getOrder` maps `shipping.methodName` from `method_title`; no
   `dispatchTime`.
5. `libs/core/src/orders/application/services/order-record.service.ts` — doc note
   near `deriveDispatchByAt` referencing #1776 (only per-order-window sources
   populate ship-by).
6. `apps/web/src/features/orders/components/order-delivery-panel.tsx` — doc note:
   Carrier row is the #1776 delivery-method fallback for sources without a
   source-stated method.
7. Docs: `libs/integrations/erli/docs/setup-guide.md` (or runbook) — note ship-by
   is populated only for sources exposing a per-order dispatch deadline (Allegro);
   Erli orders show no ship-by.

## 5. Validation

- Scoped: `pnpm --filter @openlinker/integrations-erli test`,
  `--filter @openlinker/integrations-woocommerce test`,
  `--filter @openlinker/core test`; scoped `lint` + `type-check`.
- Architecture: no boundary changes; docs + tests only. Pre-implement gate
  unnecessary (no new abstractions / contract surface) — skipped explicitly.
