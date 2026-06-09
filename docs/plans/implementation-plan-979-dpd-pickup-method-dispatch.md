# Implementation Plan — #979 Neutral delivery intent (ADR-020)

**Issue:** #979 · **ADR:** [ADR-020](../architecture/adrs/020-neutral-delivery-intent-shipping-dispatch.md) (Accepted)
**Branch:** `979-dpd-pickup-method-dispatch` · **Layer:** CORE shipping + API + FE (+ migration).
**Supersedes** the earlier server-side-normalization draft of this plan.

## 1. Goal

The caller sends a carrier-neutral `DeliveryIntent`; the **dispatch seam** maps it to the concrete
`ShippingMethod` using each adapter's **existing `getSupportedMethods()`**, persists both, and passes
the resolved method into the **unchanged** `generateLabel`. Fixes DPD pickup dispatch (#979), retires
the FE regex. **No plugin-port change, no adapter change.**

## 2. Key shapes (grounded in current code)

- `ShipmentDispatchInput = {routing keys} & Omit<GenerateLabelCommand, 'shipmentId'|'connectionId'|'deliveryMethodId'>` (`application/types/shipment-dispatch.types.ts`). → swap `shippingMethod` out, `deliveryIntent` in.
- `GenerateLabelCommand.shippingMethod` (`domain/types/generate-label.types.ts:36`) — **adapter contract, unchanged** (carries the *resolved* method).
- `Shipment` domain entity (`domain/entities/shipment.entity.ts`) — positional ctor; **append `deliveryIntent` as the last required arg** (matches the documented anti-collision discipline used for `sourceDeliveryMethodId` / `carrier`).
- `ShipmentDispatchService.dispatchViaShippingProvider` resolves the adapter at `:168`, creates the row at `:173` (persists `shippingMethod`), calls `generateLabel` at `:191`.
- `shipment.orm-entity.ts:62` `shippingMethod text NOT NULL`; no intent column.

## 3. Steps

### Phase A — core domain: intent type + resolver (pure)
| # | File | Change | AC |
|---|---|---|---|
| A1 | `libs/core/src/shipping/domain/types/delivery-intent.types.ts` (new) | `DeliveryIntentValues = ['pickup_point','address'] as const`; `DeliveryIntent`; `DELIVERY_INTENT` const-map (mirror `SHIPPING_METHOD`) | as-const union; file header |
| A2 | `libs/core/src/shipping/domain/delivery-intent-resolution.ts` (new) | pure `resolveCarrierMethod(intent, supported): ShippingMethod` (pickup_point → the single point method in `supported` ∈ {paczkomat,pickup}; address → the courier method = the supported non-point method / `kurier`; throw `ShippingProviderRejectionException('preflight.unsupported-intent', …)` on 0/≥2 point methods) + `deriveIntentFromLegacyMethod(method): DeliveryIntent` (paczkomat\|pickup→pickup_point, kurier→address) | pure, no I/O, no framework |
| A3 | `…/delivery-intent-resolution.spec.ts` (new) | matrix: DPD `['kurier','pickup']` + pickup_point → 'pickup'; InPost `['paczkomat','kurier']` + pickup_point → 'paczkomat'; address → 'kurier' (all); ambiguous/empty → throws; legacy-method derivation | green |
| A4 | `libs/core/src/shipping/index.ts` | export `DeliveryIntentValues`, `DeliveryIntent`, `DELIVERY_INTENT` (for the API DTO) | additive barrel |

### Phase B — core application: seam wiring
| # | File | Change | AC |
|---|---|---|---|
| B1 | `application/types/shipment-dispatch.types.ts` | `ShipmentDispatchInput`: omit `shippingMethod` from the `GenerateLabelCommand` pick; add `deliveryIntent?: DeliveryIntent` + keep `shippingMethod?: ShippingMethod` (legacy fallback) | at least one required at runtime |
| B2 | `application/services/shipment-dispatch.service.ts` | after `:168`: `const supported = adapter.getSupportedMethods(); const intent = input.deliveryIntent ?? deriveIntentFromLegacyMethod(requireDefined(input.shippingMethod)); const shippingMethod = resolveCarrierMethod(intent, supported);` — use `shippingMethod` for `create` (:173) **and** `generateLabel` (:191); persist `deliveryIntent: intent`; `logger.log` the mapping | DPD point order → 'pickup'; others unchanged |
| B3 | `application/services/shipment-dispatch.service.spec.ts` | cases: DPD supported+`pickup_point` ⇒ adapter receives `'pickup'` **and** row persists `pickup`/`pickup_point`; InPost `pickup_point` ⇒ `'paczkomat'`; `address` ⇒ `'kurier'`; legacy `shippingMethod`-only input still dispatches; missing-both ⇒ error | mock adapter `getSupportedMethods` |

### Phase C — persistence
| # | File | Change | AC |
|---|---|---|---|
| C1 | `domain/entities/shipment.entity.ts` | append `public readonly deliveryIntent: DeliveryIntent \| null` as the **last** ctor arg (with the same "do not splice" comment) | required arg ⇒ every construction site compile-errors |
| C2 | `domain/ports/shipment-repository.port.ts` (`CreateShipmentInput`) | add `deliveryIntent?: DeliveryIntent \| null` | — |
| C3 | `infrastructure/persistence/entities/shipment.orm-entity.ts` | `@Column({ type: 'text', nullable: true }) deliveryIntent!: DeliveryIntent \| null` | nullable |
| C4 | shipment repository impl (`…/repositories/shipment.repository.ts`) | `toDomain`/`toOrm` map `deliveryIntent`; `create` persists it | round-trips |
| C5 | `apps/api/src/migrations/<ts>-add-shipment-delivery-intent.ts` (new) | `ADD COLUMN delivery_intent text NULL`; backfill `paczkomat\|pickup→pickup_point`, `kurier→address`, `omp→NULL`; `down()` drops | `migration:show` lists it; 13-digit invariant |

### Phase D — API (HTTP contract, transition window) — **single + bulk** (review)
| # | File | Change | AC |
|---|---|---|---|
| D1 | `apps/api/src/shipping/http/dto/generate-label.dto.ts` | add `@IsOptional @IsIn(DeliveryIntentValues) deliveryIntent?`; make `shippingMethod` `@IsOptional` (was required); `@ApiPropertyOptional` both | DTO accepts intent; legacy still parses |
| D2 | `apps/api/src/shipping/http/shipment.controller.ts` | map `deliveryIntent: dto.deliveryIntent` into `ShipmentDispatchInput` (keep `shippingMethod` passthrough). The "neither present" case is caught in the **seam** (B2) and mapped to a **4xx** at the controller boundary (mirror the `UndispatchableResolutionException → 422` mapping) — not a bubbled 500 | — |
| D3 | `…/shipment.controller.spec.ts` | intent passthrough; legacy-method-only still 200; neither → 4xx | — |
| **D4** | **bulk dispatch DTO** (`apps/api/src/shipping/http/dto/*bulk*`) | **same `deliveryIntent` (optional) + `shippingMethod` (optional) treatment on the per-item shape** — `BulkShipmentDispatchItem = Omit<ShipmentDispatchInput,'sourceConnectionId'>` auto-flows the core type, but the **HTTP request DTO must carry the field** or bulk DPD pickup stays broken (review) | bulk item accepts intent |
| **D5** | bulk controller + `…spec` | map per-item `deliveryIntent`; check any FE bulk-dispatch payload builder emits it | — |

### Phase E — frontend
| # | File | Change | AC |
|---|---|---|---|
| E1 | `apps/web/src/features/shipments/api/shipments.types.ts` | add `DeliveryIntentValues`/`DeliveryIntent`; `GenerateLabelInput`: add `deliveryIntent`, drop required `shippingMethod`. **Do NOT add `deliveryIntent` to the `Shipment` type** (review — phantom field unless the API response emits it; the panel already shows the resolved `shippingMethod`) | mirror documented next to `ShippingMethod` |
| E2 | `apps/web/src/features/orders/components/generate-label-form.tsx` | delete `LOCKER_METHOD_RE`/`classifyDeliveryMethod`; `deliveryIntent = snapshot.pickupPoint ? 'pickup_point' : 'courier→address'` derived from data; `buildGenerateLabelInput` sends `deliveryIntent` (no caller `shippingMethod`); pickup-id input shown when `deliveryIntent==='pickup_point'` | regex gone |
| E3 | `…/generate-label-form.test.tsx` | submit sends `deliveryIntent`; pickup-point order ⇒ `'pickup_point'`; courier ⇒ `'address'` | green |

### Phase F — gate
`pnpm lint` (+ invariants incl. migration-timestamp), `pnpm type-check` (catches every `Shipment` ctor site — C1), full `pnpm test`, affected `pnpm test:integration` (shipment-dispatch / shipping int-specs). Rebuild libs dist after any base change.

## 4. Transition precedence (resolves pre-implement OQ #1/#2)

`deliveryIntent` is the contract. For one release the seam falls back to `deriveIntentFromLegacyMethod(shippingMethod)` when `deliveryIntent` is absent, so an un-updated client keeps working. Neither present ⇒ readable 4xx. Next release removes the `shippingMethod` caller field + the fallback.

## 5. Out of scope / deferred
- `resolveMethodForIntent` adapter-owned port method (ADR-020 alt (a)) — until a carrier ships two point methods.
- Exposing `deliveryIntent` as an operator-visible field beyond the derived default (the form derives + lets override via the existing pickup-point presence; no new toggle UI).

## 6. Risks
- **Every `Shipment` construction site** must add the new arg — intentional compile-error surface (C1); sweep fixtures/factories.
- Backfill correctness (C5) — covered by the explicit map; `omp→NULL` verified (branch-1 returns before the carrier step).
- FE↔BE `DeliveryIntent` mirror drift — one documented location (E1), #966 lesson.
