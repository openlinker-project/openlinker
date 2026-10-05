# Implementation plan - Shoper fulfillment writeback (#3643)

Branch `3643-shoper-fulfillment-writeback`, stacked on `3702-shoper-guided-setup-ui` (carries #3701 incl. its review fixes).

## 1. Goal

When a parcel is bought/dispatched in OpenLinker for an order that was pushed into Shoper, write the tracking number back to the Shoper order (`POST /parcels`), so Shoper's own status advances. The same `dispatched` fact must still reach the originating marketplace through the existing relay.

**Layer:** Integration / Infrastructure (adapter). **No CORE change in the MVP.**

## 2. Corrections to the issue text (found while researching)

1. **The parcel write is not a trigger for the relay.** Direction is the other way round: OL dispatch -> `OrderLifecycleRelayService` -> `OrderStatusWriteback.write(event)` on every order participant (ADR-027). Shoper is a *destination participant*, so its job is to implement `OrderStatusWriteback`; the Allegro side already works through the same relay. No relay wiring is needed, and the issue's "wire parcel-create as the trigger" has nothing to wire.
2. **`OrderFulfillmentUpdater` is not the relay contract.** Its docblock says it is retained only for order *provisioning* outside the relay path. The relay dispatches through `OrderStatusWriteback.write`. Implement that one (WooCommerce / PrestaShop do both; only `write` is required here).
3. **Partial shipment is not expressible by the current event.** `OrderLifecycleEvent` `dispatched` carries `externalOrderId`, `trackingNumber`, `carrier` and no lines. The issue's assumption "the relay needs no changes" holds for the full-shipment path only.
4. **The line -> `order_product_id` mapping does not exist.** The issue says it is "persisted at order-create time in mini-epic #4". `ShoperOrderProcessorAdapter.createOrder` does not persist it (it only keeps the header id). Partial shipment therefore needs new bookkeeping, not just a read.

## 3. Scope

### In (this PR)
- `ShoperOrderProcessorAdapter` implements `OrderStatusWriteback`:
  - `dispatched` -> `POST /parcels { order_id, shipping_id, shipping_code, sent: true }` with **no `products[]`**: Shoper ships exactly the remaining unshipped quantity per line (confirmed in #3638), which is the whole order in the common case.
  - `shipping_id` is read from the Shoper order (`GET /orders/:id`), not from config, so it matches the method the order was created with.
  - Idempotent: before posting, `GET /parcels?filters[order_id]=` and treat an existing parcel with the same `shipping_code` as `applied` (a re-delivered event must not create a second parcel). A dispatch without tracking once a parcel exists is also a no-op, and a late tracking number is attached to the single untracked parcel with `PUT /parcels/:id` rather than creating a second parcel (whose remainder would be zero).
  - `cancelled` -> `{ outcome: 'unsupported' }` with a detail (no Shoper cancel capability; consistent with the #3701 known gap).
  - Invalid / non-numeric `externalOrderId` -> `rejected` (path-traversal defence, as in WooCommerce).
  - A missing tracking number still creates the parcel (`shipping_code` omitted), matching the late-waybill backfill (#1947) that re-relays when the number arrives.
- Unit specs: happy path, idempotent replay, 404 on the order, `cancelled` unsupported, invalid id, missing tracking, API failure -> `rejected` with detail.
- A plugin spec asserting the adapter resolved as `OrderProcessorManager` passes `isOrderStatusWriteback`, which is exactly how the relay reaches a destination. (Changed from "a fixture spec driving the relay": the relay's fan-out is core's and already tested there; reproducing it inside the plugin package would test core, not Shoper.)
- README + `docs/architecture-overview.md` Shoper notes updated.

### Out (follow-ups, to be filed)
- **Partial shipment**: needs (a) optional `lines` on the `dispatched` event (non-breaking widening, `OrderLifecycleEvent` union members unchanged) fed from `shipment_lines` (#2727), and (b) persisting `order_product_id` per OL line at `createOrder`. Both are new surfaces and deserve their own issue.
- Status-only writeback (issue Assumption: deferred).
- Live integration test against a real shop.

## 4. Steps

1. `libs/integrations/shoper/src/domain/types/shoper-api.types.ts` - add `ShoperParcel`, `ShoperParcelCreateRequest`, and `shipping_id` on the order read shape.
2. `libs/integrations/shoper/src/infrastructure/mappers/shoper-parcel.mapper.ts` - pure: build the create request, detect an existing parcel by `shipping_code`.
3. `shoper-order-processor.adapter.ts` - `implements OrderStatusWriteback`; `write()` with an exhaustive `switch (event.type)` and the `never`/`unsupported` default (ADR-055 forward-compat, #2286).
4. Specs next to each file; extend the existing adapter spec harness.
5. Docs.

## 5. Risks / open questions

- **Parcel semantics rest on the #3638 spike**, which is not in the repo. Field names (`shipping_code`, `sent`) and the auto status advance come from the issue text; they were not re-verified live from this branch.
- Shoper's `GET /parcels` filter syntax (`filters[order_id]`) is assumed to match `/order-products` (verified there); confirm before relying on idempotency.
- If the shop's `shopping_parcel_send_status_id` is unset, the order status will not advance; that is shop config, not an adapter error, and is worth a log line.
- `OrderProcessorManager` is opt-in per connection, so this is inert until the operator enables it.

## 6. Validation

- Hexagonal: adapter only; CORE untouched. Boundary respected (no domain logic in the integration).
- Naming: `*.mapper.ts`, `*.types.ts`, specs `*.spec.ts`.
- No `any`, no `console.log`, no secrets. Input validated at the adapter boundary.
- Tests: unit + the fixture relay spec. Quality gate: `pnpm lint`, `pnpm type-check`, `pnpm test`.
