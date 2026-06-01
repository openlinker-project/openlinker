# Implementation Plan — persist delivery method + pickup point in the order snapshot (#952)

## 1. Goal & layer
Stop dropping the buyer's delivery method (`Order.shipping`) and pickup point (`Order.pickupPoint`) at the persistence boundary so they reach `order_records.orderSnapshot`. This makes the order-detail Delivery panel render the method/locker, restores the paczkomat pre-fill on Generate-Label, and — critically — gives fulfillment routing the `shipping.methodId` it keys on (today every Allegro order falls through to the `omp_fulfilled` default because the field is null; see #952 comment).

- **Layer: CORE / orders** — Application service only (`OrderRecordService`).
- **No migration** (JSONB snapshot). **No FE change** (the FE schema + parse + `ParsedOrderSnapshot` already handle `shipping`/`pickupPoint`).
- **Symmetric to #948** (same persist-boundary omission, same present-only conditional-spread fix).

## 2. Root cause (verified in this worktree)
- `Order` carries `shipping?: OrderShipping` + `pickupPoint?: OrderPickupPoint` (order.types.ts). ✅
- Allegro adapter populates them: `shipping: this.resolveShipping(lForm)` (from `delivery.method`), `pickupPoint: this.resolvePickupPoint(lForm)` (from `delivery.pickupPoint`) in `allegro-order-source.adapter.ts`. ✅
- `buildUnifiedOrder` maps `shipping: incoming.shipping` / `pickupPoint: incoming.pickupPoint` onto `Order` (order-ingestion.service.ts:380-381). ✅
- **`OrderRecordService.persistOrder` and `persistIncomingSnapshot` reference only `shippingAddress` — they omit `shipping` and `pickupPoint`.** ❌ ← the bug. DB-verified: `orderSnapshot->'shipping'` and `->'pickupPoint'` are null on a re-ingested Allegro order.

## 3. Steps

### 3.1 `order-record.service.ts` — `persistOrder` snapshot
Add two **present-only, NON-PII** spreads (these are a carrier method id/name and a public locker code — not PII; persist unconditionally like `deliverySmart`/`dispatchTime`, NOT gated on `storePii`). Place beside `deliverySmart`/`dispatchTime`:
```ts
// Source-side delivery method + pickup point (#952) — non-PII; present-only
// like deliverySmart/dispatchTime. Needed by the Delivery panel, the
// Generate-Label paczkomat pre-fill, and fulfillment routing (methodId is the
// carrier-mapping key — without it routing always resolves omp_fulfilled).
...(order.shipping !== undefined && { shipping: order.shipping }),
...(order.pickupPoint !== undefined && { pickupPoint: order.pickupPoint }),
```
Nested optional fields (`methodName`, `name`, `description`) drop out via JSON serialization when undefined — matches the present-only wire shape.

### 3.2 `order-record.service.ts` — `persistIncomingSnapshot` snapshot
Same two spreads from `incoming.shipping` / `incoming.pickupPoint`.

### 3.3 Tests — `order-record.service.spec.ts`
- `persistOrder`: with `order.shipping = { methodId, methodName }` and `order.pickupPoint = { id, name }` set → snapshot carries both verbatim; unset (the `createMockOrder` default) → keys absent.
- `persistIncomingSnapshot`: same from `incoming.shipping` / `incoming.pickupPoint` (present + absent).

### 3.4 FE — none
Verified: `apps/web/src/features/orders/api/order-snapshot.schema.ts` already defines `orderShippingSchema`/`orderPickupPointSchema`, parses `snapshot.shipping`/`snapshot.pickupPoint`, and exposes them on `ParsedOrderSnapshot`. `methodName` is `.nullish()`. No change beyond the existing wiring.

## 4. Non-goals (per #952)
- Backfilling existing snapshots — value lands on next re-ingest (snapshot rebuilt each `syncOrderFromSource`).
- `methodName` human-name enrichment when the source only carries `methodId` (FE treats it as nullish).
- Carrier-of-record display (resolved only at dispatch onto `Shipment`).
- Seeding `fulfillment_routing_rules` (config, not code) and the FE pickup-point gating fix (#954) — separate.

## 5. Validation
- `pnpm lint` + `pnpm type-check` + `pnpm test` green.
- `check:invariants` unaffected (additive snapshot keys, same context).
- Confidence: a re-ingested Allegro order now carries `shipping.methodId` (+ `pickupPoint` for locker orders) — covered by the new unit tests; existing order-ingestion int-specs exercise the persist path.

## 6. Risks
- Minimal — additive optional snapshot keys, present-only, no consumer breaks when absent. Non-PII so no `storePii` interaction.
