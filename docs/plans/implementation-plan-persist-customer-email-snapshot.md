# Implementation Plan — persist `customerEmail` in the order snapshot (#948)

## 1. Goal & layer
Stop dropping the buyer email captured on `IncomingOrder` so `order_records.orderSnapshot.customerEmail` is populated and the Generate-Label form (#769) no longer rejects every order with "Buyer email is missing from the order snapshot."

- **Layer: CORE / orders** — Domain type (`Order`) + Application services (`OrderIngestionService`, `OrderRecordService`).
- **No migration** (snapshot is JSONB). **No FE change** (the FE `ParsedOrderSnapshot.customerEmail` already exists and `detectMissingFields` already reads it).

## 2. Root cause (verified)
`IncomingOrder.customerEmail` is set by adapters but:
1. `Order` (order.types.ts:82-135) has no `customerEmail` field.
2. `buildUnifiedOrder` (order-ingestion.service.ts:361-385) doesn't map it onto `Order` (uses it only for customer-identity resolution).
3. `persistOrder` (order-record.service.ts:53-94) and `persistIncomingSnapshot` (:126-153) both omit it.

DB: 0/40 snapshots carry `customerEmail`.

## 3. Steps

### 3.1 `libs/core/src/orders/domain/types/order.types.ts`
Add to the `Order` interface, near `customerId`:
```ts
/** Buyer email from the source platform (#948), carried through from
 *  `IncomingOrder.customerEmail`. Persisted into the order snapshot (PII-gated)
 *  so the Generate-Label recipient can be built. Absent when the source didn't
 *  expose one. */
customerEmail?: string;
```

### 3.2 `order-ingestion.service.ts` — `buildUnifiedOrder`
Map it onto the returned `Order`: `customerEmail: incoming.customerEmail,`.

### 3.3 `order-record.service.ts` — `persistOrder` snapshot
Add a **PII-gated, present-only** key (email is PII — under hash-only mode `OL_STORE_PII=false` raw email must not be stored; the projection keeps `emailHash`):
```ts
...(piiConfig.storePii && order.customerEmail !== undefined && {
  customerEmail: order.customerEmail,
}),
```
Rationale doc-comment referencing the address PII precedent already in this method.

### 3.4 `order-record.service.ts` — `persistIncomingSnapshot` snapshot
Same, from `incoming.customerEmail`.

### 3.5 Tests — `order-record.service.spec.ts`
- `persistOrder`: with `OL_STORE_PII=true` (or mocked `getPiiConfig`) and `order.customerEmail` set → snapshot has `customerEmail`; with PII off → key absent; with email undefined → key absent.
- `persistIncomingSnapshot`: same three cases from `incoming.customerEmail`.
- Mirror however the existing suite controls `getPiiConfig` (check whether it mocks the module or sets `OL_STORE_PII`).

### 3.6 (optional polish) `apps/web/.../generate-label-form.tsx`
Fix the now-stale comment in `buildGenerateLabelInput` ("Gate guarantees customerEmail is present") — there's no such guarantee; `detectMissingFields` is the gate and the `?? ''` is the real fallback. One-line comment correction; no behavior change.

## 4. Non-goals (per #948)
- Thin PrestaShop **seed** orders missing address/items — dev-fixture data, not code.
- Masked Allegro email deliverability — separate downstream concern.
- Backfilling existing rows — value lands on next re-ingest (snapshot rebuilt each `syncOrderFromSource`).
- Button-level recipient gate on `ShipmentActionButtons` — reasonable follow-up, not here.

## 5. Validation
- `pnpm lint` + `pnpm type-check` + `pnpm test` green.
- `check:invariants` (service-interface, cross-context) unaffected — additive field, same context.
- Manual/int confidence: a freshly-ingested Allegro order with a buyer email now carries `customerEmail` in the snapshot (covered by the unit tests; the existing order-ingestion int-specs exercise the persist path).

## 6. Risks
- **PII semantics**: gating behind `storePii` keeps hash-only mode honest. The in-memory `Order.customerEmail` carries the raw value regardless (transient), exactly like `Order.shippingAddress`; only persistence is gated.
- Low blast radius: additive optional field; no consumer breaks if absent.
