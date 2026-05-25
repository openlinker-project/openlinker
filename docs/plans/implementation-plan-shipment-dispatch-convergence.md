# Implementation Plan: Shipment dispatch seam — converge InPost onto the routing model (#835)

**Date**: 2026-05-25
**Status**: Ready for implementation (design resolved via `/grill-me` Q1–Q11)
**Estimated Effort**: S–M (1–3 days; core seam + tests, no migration, no new port)

---

## 0. Premise reconciliation (read first)

The #835 issue is written as a **retrofit** — "converge the in-flight InPost path … eliminating any parallel/separate routing mechanism." Verified against `main` (post-#812 + #832), **no such path exists**:

- ✅ InPost adapter (#812) and routing model (#832) are merged.
- ❌ **Zero** shipment-dispatch code: no `generateLabel` caller, no `SHIPMENT_REPOSITORY_TOKEN` consumer, **no `application/` layer in the shipping context**, no worker handler, InPost not in `apps/worker/src/plugins.ts`. The #727 live path (#766–#772) is still open; **0 open PRs**.

So there is **no parallel mechanism to eliminate**. #835 therefore *builds the single convergence point* so InPost dispatch routes through #832 **from day one** — the same discipline #832 used (ship `resolve()`, leave it unwired). "No parallel mechanism" is achieved **by construction**: there's exactly one dispatch entry point and it owns the `resolve()` call.

---

## 1. Scope

**In scope** — a core `ShipmentDispatchService` (the "seam"), **unwired** (no trigger):

`dispatch(input)` → `resolve()` the processor → branch on `processorKind` → for a label-generating kind, create `Shipment(draft)` → `generateLabel()` via the resolved connection's `ShippingProviderManagerPort` → persist `generated` → return. Idempotent; persists `failed` on adapter error.

**Out of scope** (other issues): the *trigger* / call-site (manual button / auto-on-paid — #769/#771); order→recipient/parcel assembly (operator input + #767 paczkomat-from-PS-module + PII email sourcing); Allegro Delivery adapter (#833); status read-back (#834/#838); FE (#769/#770/#836/#839); worker registration of InPost (the trigger issue does it).

---

## 2. Resolved design decisions (Q1–Q11)

1. **Q1 — Deliverable**: the unwired core seam (like #832's `resolve()`). *Confirmed.*
2. **Q2 — Command boundary (Design A)**: the seam **consumes** a caller-supplied label payload (`recipient`, `parcel`, `shippingMethod`, `paczkomatId?`); it does **not** parse orders. Rationale: a complete `GenerateLabelCommand` is **not derivable** from a persisted `Order` — `parcel` is never on the order; `recipient.email` (required) is absent under `OL_STORE_PII=false`; `Address` needs `street`/`buildingNumber` splitting; `phone` is optional. Those are operator/PII/#767 concerns owned by #769/#767/#771. The seam owns the *routing + Shipment aggregate + dispatch*. *Confirmed.*
3. **Q3 — Branch semantics (unified path)**: branch on `processorKind === omp_fulfilled` → `null` (covers the default's `null` connection **and** a *configured* omp_fulfilled rule's non-null connection — OMP ships externally, no OL label; read-back is #834). `ol_managed_carrier` **and** `source_brokered` share **one** path (both implement `ShippingProviderManagerPort`; topology is enforced at rule-creation by #832's `assertCompatible`, not at dispatch). **No `source_brokered` guard** — it's unreachable today (Allegro lacks the capability so no such rule persists) and `getCapabilityAdapter` is defensively safe; #833 then "just works" with zero seam rework. Exhaustive `default` guard mirrors #832. *Confirmed.*
4. **Q4 — Lifecycle**: `repo.create({orderId, connectionId: resolution.processorConnectionId, shippingMethod, paczkomatId})` (always `draft`) → on `generateLabel` success `repo.update(id, {status:'generated', providerShipmentId, trackingNumber, labelPdfRef})`.
5. **Q5 — Placement**: `libs/core/src/shipping/application/{services,interfaces,types}/`. `ShipmentDispatchService implements IShipmentDispatchService`. `SHIPMENT_DISPATCH_SERVICE_TOKEN` in `shipping.tokens.ts`. `ShippingModule` imports `MappingsModule` + `IntegrationsModule`. No cross-context cycle (nothing imports shipping at the module layer except `app.module`).
6. **Q6 — Input type**: `ShipmentDispatchInput = { sourceConnectionId; sourceDeliveryMethodId: string|null } & Omit<GenerateLabelCommand,'shipmentId'|'connectionId'>` in `application/types/shipment-dispatch.types.ts`. Thin reshape of the shipped command → near-zero contract drift with #769. Exported from the barrel (the future caller needs it).
7. **Q7 — Repository**: no changes — `create` / `update` / `findActiveByOrderId` already exist with the right shapes. **No migration.**
8. **Q8 — Errors**: `generateLabel` rejection → `repo.update(id, {status:'failed', failedAt: now, errorMessage})` then **rethrow** the domain error (visible `failed` row for #770 + retry; error propagates for UX). `log.warn`.
9. **Q9 — Idempotency**: after determining a label-generating kind, `findActiveByOrderId(orderId)`; if a non-terminal shipment exists, **return it** (no second label/fee). Cancel+re-issue flips to `cancelled` first, so a re-dispatch is allowed.
10. **Q10 — Worker**: untouched (unwired seam).
11. **Q11 — Tests**: unit (mock `ShipmentRepositoryPort` + `IFulfillmentRoutingService` + `IIntegrationsService`) covering omp_fulfilled default + configured-omp_fulfilled (the Q3 catch) + ol_managed_carrier happy path + source_brokered identical-path + idempotency + failure + exhaustiveness. Integration (`shipment-dispatch.int-spec.ts`) with an **inlined `ShippingProviderManager` stub** registered via `AdapterRegistryService` + `AdapterFactoryResolverService` under `inpost.test.v1` (mirrors `allegro-test-source-stub`) — real Postgres + real `replaceRules` compatibility + real `resolve` + real seam + fake provider.

---

## 3. Step-by-step

1. `shipping.tokens.ts` — add `SHIPMENT_DISPATCH_SERVICE_TOKEN = Symbol('IShipmentDispatchService')`.
2. `application/types/shipment-dispatch.types.ts` — `ShipmentDispatchInput`.
3. `application/interfaces/shipment-dispatch.service.interface.ts` — `IShipmentDispatchService` (`dispatch(input): Promise<Shipment | null>`).
4. `application/services/shipment-dispatch.service.ts` — `ShipmentDispatchService` (resolve → branch → idempotency → create → generateLabel → persist; failed+rethrow on error).
5. `shipping.module.ts` — import `MappingsModule` + `IntegrationsModule`; provide `ShipmentDispatchService` + bind `SHIPMENT_DISPATCH_SERVICE_TOKEN` (`useExisting`); export the token.
6. `index.ts` — export `IShipmentDispatchService` (type) + `ShipmentDispatchInput` (type); token auto-exported via `export * from './shipping.tokens'`.
7. `application/services/shipment-dispatch.service.spec.ts` — unit tests.
8. `apps/api/test/integration/helpers/inpost-test-shipping-stub.helper.ts` — inlined ShippingProviderManager stub + registry registration.
9. `apps/api/test/integration/shipment-dispatch.int-spec.ts` — integration test.
10. `apps/api/test/integration/setup.ts` — add `'shipments'` to `tablesToTruncate`.

---

## 4. Architecture / validation

- CORE-only; no integration code touched. New `shipping/application/` layer. Anemic `Shipment` (ADR-011) unchanged. Symbol token + barrel conventions (#595). Cross-context surface used: `IFulfillmentRoutingService` + token + `FULFILLMENT_PROCESSOR_KIND` (mappings), `IIntegrationsService` + token (integrations), `ShippingProviderManagerPort` (own context). No new ESLint/type errors. No migration.
- **AC mapping**: AC "InPost routed via the same #832 config (no separate mechanism)" → the single seam owns `resolve()`; **AC "existing #727 behavior preserved"** → vacuously true (no prior path) + omp_fulfilled default unchanged; AC "tests added" → unit + integration. PR body records that the seam is **unwired** (trigger = #769/#771), matching the #832 precedent.

## 5. Risks

- **R1 — input-contract drift** vs #769's real needs. *Mitigation*: `ShipmentDispatchInput` is a thin `Omit<GenerateLabelCommand,…>` reshape — #769 builds exactly that.
- **R2 — premise mismatch** (issue assumes a path that doesn't exist). *Mitigation*: §0 documents it; PR body states #835 builds the convergence point rather than retrofitting one.

## 6. Post-review refinements (tech-review)

- **Return type** — `dispatch` returns a discriminated union `ShipmentDispatchResult` (`{ kind: 'dispatched'; shipment } | { kind: 'omp_fulfilled' }`) rather than `Shipment | null`, so the future caller (#769) handles both outcomes explicitly. A `generateLabel` failure is still surfaced as a thrown error.
- **Invariant guards** — the exhaustiveness `default` and the null-connection guard throw a typed domain error `UndispatchableResolutionException` (in `shipping/domain/exceptions/`), mirroring #832's exhaustiveness discipline rather than a bare `Error`.
- **Idempotency is best-effort (carried to #769/#771)** — the `findActiveByOrderId` → `create` check is **not atomic**; concurrent dispatches for one order can double-create (the schema allows N shipments/order by design — no DB guard). The live call-site must serialise dispatch per order (debounce / job-level dedup). Documented in the service + interface.
- **Provider partial-failure (carried to #812/#833)** — if `generateLabel` commits provider-side but its response fails, the shipment is marked `failed` and a re-dispatch starts a fresh attempt, which could double-create at the provider. `GenerateLabelCommand.shipmentId` is available for adapters to use as a provider-side idempotency key.
