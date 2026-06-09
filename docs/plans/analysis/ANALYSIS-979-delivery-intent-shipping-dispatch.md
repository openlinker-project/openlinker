# Pre-implement gate — ADR-020 / #979 (neutral delivery intent shipping dispatch)

**Gated against:** `docs/architecture/adrs/020-neutral-delivery-intent-shipping-dispatch.md` (stands in for the not-yet-rewritten impl plan — the prior `implementation-plan-979-*.md` described the superseded server-side-normalization shim).
**Date:** 2026-06-05 · **Scope:** read-only repo audit, no source/plan edits.

> **Post-gate revision (2026-06-05):** ADR-020 was subsequently revised to **drop the `ShippingProviderManagerPort` change** — the seam now maps `deliveryIntent` to the concrete method via the *existing* `getSupportedMethods()` (no longer dead code), so the **one CRITICAL finding below (the port-method swap) no longer applies**. The remaining contract surfaces are the request DTO (additive + deprecate) and the ORM column (additive nullable). Net effect on this verdict: strictly more favourable — no plugin-facing break, no adapter/mock churn. The reuse-audit and DTO/ORM findings stand.

## Verdict: **NEEDS-REVISION**

No reuse collision and **the ADR's central claim is confirmed** — but the decision crosses three **Critical** contract surfaces (plugin-facing port, request DTO, ORM schema). Each is *named and sequenced in the ADR*, so this is `NEEDS-REVISION`, not `NEEDS-MAJOR-REVISION`: the ADR is sound; the **implementation plan must absorb the exact blast radius + transition precedence enumerated below before coding.**

## Reuse audit

| Artifact | Class | Verdict | Evidence |
|---|---|---|---|
| `DeliveryIntent` / `DeliveryIntentValues` | type | **NEW** | grep `deliveryintent` (case-insensitive) across `libs`+`apps` → empty |
| `resolveMethodForIntent` / `getSupportedIntents` | port method | **NEW** | grep → empty |
| `delivery_intent` shipment column | ORM column | **NEW** | `shipment.orm-entity.ts` has `shippingMethod` (:62) + `paczkomatId` (:71) but **no intent column** |
| `ShippingMethod` / `ShippingMethodValues` | type | **EXISTS → reuse (demote)** | `shipping-method.types.ts`; barrel `index.ts:28-29` |
| `ShippingProviderManagerPort` | port | **EXISTS → change** | `shipping-provider-manager.port.ts:69`; barrel `index.ts:82` |
| `GenerateLabelCommand.shippingMethod` | command field | **EXISTS → change** | `generate-label.types.ts:36` |
| `GenerateLabelDto.shippingMethod` | request DTO field | **EXISTS → change** | `generate-label.dto.ts:160` (`@IsEnum`, required) |
| FE `GenerateLabelInput.shippingMethod` | FE type | **EXISTS → change** | `shipments.types.ts:131` (+ `:76` Shipment, `:183` optional) |
| `ShipmentDispatchService` wiring | service | **EXISTS → change** | `shipment-dispatch.service.ts:168-199` |
| `LOCKER_METHOD_RE` / `classifyDeliveryMethod` | FE regex | **EXISTS → retire** | `generate-label-form.tsx:94,101,106,120` (single consumer) |

**No artifact the ADR calls "new" already exists.** No collision.

## Backward-compatibility findings

**CRITICAL — port method swap** (`getSupportedMethods()` → `resolveMethodForIntent()`).
*The ADR's de-risking claim is CONFIRMED:* **zero production callers of `getSupportedMethods()`.** Every occurrence is the port declaration (`shipping-provider-manager.port.ts:69`), an adapter/ fake/ test-stub *implementation*, a `jest.fn()` mock, or a doc-comment — no `.getSupportedMethods(` invocation exists in non-test code. So removing it can't break a runtime consumer. **Mechanical blast radius the plan must list:** 3 real adapters (`dpd-shipping.adapter.ts:79`, `inpost-shipping.adapter.ts:55`, `allegro-delivery-shipping.adapter.ts:92`), 2 fakes (`fake-dpd…:44`, `fake-inpost…:46`), 3 apps/api int-test stubs (`inpost-test-shipping-stub`, `dispatch-notify-test-stubs:128`, `shipment-status-sync-test-stubs:109`), and ~12 unit-test mocks/asserts across `shipping/**/*.spec.ts` + capability `__tests__/`. All implement the base port, so all must adopt the new method.

**CRITICAL — request DTO** (`GenerateLabelDto.shippingMethod`, `:160`). Add `deliveryIntent`; make `shippingMethod` accepted-but-ignored for one release then remove (ADR §Migration). Plan must define **transition precedence**: if `deliveryIntent` present → use it; else (one release) derive from legacy `shippingMethod`; reject when neither present.

**CRITICAL — published command type** (`GenerateLabelCommand.shippingMethod`, barrel-exported via `generate-label.types.ts`). Adding `deliveryIntent` touches the controller producer + the dispatch consumer + all 3 adapter mappers (which keep branching on the seam-passed concrete `shippingMethod` — unchanged). Additive; safe.

**WARNING — ORM migration.** `shipments` gains **nullable** `delivery_intent text`; existing `shippingMethod text NOT NULL` stays. Migration + backfill (`paczkomat|pickup → pickup_point`, `kurier → courier`, `omp → NULL`). Nullability is correct: branch-1/omp rows have no intent — and dispatch returns `{kind:'omp_fulfilled'}` **before** the adapter-resolution step, so `resolveMethodForIntent` is never called on branch 1 (confirmed). Follows `docs/migrations.md` (core migration, `apps/api/src/migrations/`).

**WARNING — barrel + FE mirror.** Add `DeliveryIntentValues`/`DeliveryIntent` to `libs/core/src/shipping/index.ts` (additive). The exported `ShippingProviderManagerPort` shape changes (method removed) → external `jest.Mocked<…>` test doubles must drop it. FE `ShippingMethod` mirror in `shipments.types.ts` gains `DeliveryIntent` — keep BE↔FE in one documented place (#966 drift lesson).

**LOW — check:invariants.** The new pure resolver is a *port method* (not an `application/services/*.service.ts`), so `check-service-interfaces` doesn't fire. New migration must satisfy the 13-digit timestamp invariant. No cross-context or repo-URL exposure.

## Open questions for the impl plan

1. **DTO/command transition precedence** (above) — exact rule + how long the legacy `shippingMethod` stays accepted.
2. **`deliveryIntent` required vs optional** on `GenerateLabelCommand` during transition (must accept "intent OR legacy method", not both-required).
3. **Capability sub-port mocks** — `ShipmentCanceller`/`PickupPointFinder`/`LabelDocumentReader`/`DispatchProtocolReader` `__tests__` mock `getSupportedMethods` on the base shape; enumerate them so none is missed.
4. **Source-brokered Allegro** — confirm `resolveMethodForIntent` for Allegro returns a sane concrete method while its dispatch keeps forwarding `deliveryMethodId` (method stays cosmetic, ADR §Cons).
5. **`resolveMethodForIntent` failure mode** — new `preflight.unsupported-intent` rejection vs. the adapters' existing `preflight.unsupported-method` (keep the latter as defense-in-depth in the mappers).

## Bottom line

The ADR is accurate against the tree and free of reuse collisions; its riskiest move (dropping `getSupportedMethods`) is confirmed safe. Proceed to write the implementation plan from ADR-020, and make sure that plan carries the **full port-implementer + mock list**, the **DTO/command transition precedence**, and the **nullable-column migration + backfill** — then it's ready to build.
