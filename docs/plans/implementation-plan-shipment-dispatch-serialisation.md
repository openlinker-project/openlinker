# Implementation Plan: Shipment dispatch serialisation + lost-carrier-response recovery

**Date**: 2026-07-29
**Status**: Ready for Review
**Issue**: [#1917](https://github.com/openlinker-project/openlinker/issues/1917)
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective**: Close two correctness holes in `ShipmentDispatchService` that can each mint a real, paid carrier label the operator cannot see or cancel. **Both ship in one PR** - the lock prevents the next duplicate, the lookup recovers the one already created; either alone leaves half the hole open.

1. The per-order idempotency check (`findActiveByOrderId`) is a non-atomic find-then-create, so two concurrent dispatches for the same order can both pass it.
2. When `generateLabel` commits carrier-side but its response is lost, the shipment is written `failed` with `providerShipmentId = NULL`, and the next dispatch re-creates at the carrier - orphaning the first label.

**Correction to the in-code note (verified against the schema).** The comment at `:229-240` predicts a double-*create*. On one connection that cannot happen: `UQ_shipments_branch_one_per_order_conn` is unique on `(orderId, connectionId) WHERE providerShipmentId IS NULL`. What happens instead is a **row reset** - the loser reaches `findBranchOneByOrderAndConnection` (line 285), finds the winner's just-created draft row, and resets it (line 292), so both requests call `generateLabel` with the *same* `shipmentId`. The carrier mints two shipments under one reference; both `update()` the single row and last write wins. One OL row, two paid waybills, one recorded id. This is why the reconciler must refuse to adopt on a multi-match (§6 step 7).

**Operator-facing walkthrough**: [The screen looks the same either way](https://claude.ai/code/artifact/24438ea9-ba2f-44bd-8845-f2c8f67500a6) - both failure paths in real `apps/web` components.

**Context**: Both holes are documented in-code as known gaps deferred to a call-site that was never built (`shipment-dispatch.service.ts:229-240`, `:306-310`). #1905's shareable `/orders/:id?retryShipmentId=...` link makes a genuinely concurrent double-submit a normal workflow rather than a freak event.

**Classification**: CORE (application + domain), with one Integration follow-through (InPost).

---

## 2. Scope & Non-Goals

### In Scope
- Per-order distributed lock around `ShipmentDispatchService.dispatch()`, using the existing `SyncLockPort`.
- A new optional `ShipmentReferenceReconciler` sub-capability of `ShippingProviderManagerPort`, consulted on the **retry** path before re-creating at the carrier.
- InPost ShipX implementation of the reconciler.
- New `ShipmentDispatchContendedException` + HTTP mapping.
- Unit + integration tests; refresh the now-stale in-code notes.

### Out of Scope
- The post-waybill regenerate guard (#1905 fixed it at the UI layer).
- DPD reconciler implementation - DPD has no verifiable find-by-reference operation in this codebase (see §4). It degrades gracefully via the capability guard.
- Any change to `BulkShipmentDispatchService`'s sequential-loop design (only its explanatory comment changes).
- A DB uniqueness guard on `(orderId)`. N shipments/order stays legal by design (cancel + re-issue).
- FE changes. Server-side serialisation is the durable guarantee; the same-tab guard stays.

### Constraints
- **No migration.** The design deliberately avoids a schema change (see §7 Alternatives).
- Backward compatible: adapters that don't implement the reconciler behave exactly as today.
- **Concurrent with [#1905](https://github.com/openlinker-project/openlinker/pull/1905)** (open, CI green, awaiting review). Not a prerequisite. It touches no file under `libs/core/src/shipping/**`, so Phases 1-2 are conflict-free; the single overlap is `apps/api/src/shipping/http/shipment.controller.ts`, where #1905 re-signatures `toHttpException(error)` to `toHttpException(error, canWrite)`. Mitigation: add the contended branch adjacent to the existing `ShipmentNotCancellableException` case (untouched by #1905) and away from both the signature line and the provider-rejection branch, so the two edits usually auto-merge.

---

## 3. Architecture Mapping

**Target Layer**: CORE - `application/services` (lock), `domain/ports/capabilities` (reconciler); Integration - InPost adapter.

**Capabilities Involved**:
- `SyncLockPort` (`@openlinker/core/sync`) - consumed cross-context as a capability port + Symbol token, which is an allowed cross-context shape per architecture-overview § "Cross-context dependencies in core".
- `ShippingProviderManagerPort` + new `ShipmentReferenceReconciler` sub-capability.

**Existing Services Reused**:
- `RedisSyncLockService` / `SYNC_LOCK_TOKEN` - already exported from `SyncModule`.
- `ShipmentRepositoryPort.findActiveByOrderId` / `findBranchOneByOrderAndConnection` / `update`.

**New Components Required**:
| Component | Path |
|---|---|
| Lock key + TTL helper | `libs/core/src/shipping/application/services/shipment-dispatch-lock.ts` |
| Contended exception | `libs/core/src/shipping/domain/exceptions/shipment-dispatch-contended.exception.ts` |
| Reconciler sub-capability + guard | `libs/core/src/shipping/domain/ports/capabilities/shipment-reference-reconciler.capability.ts` |

**Core vs Integration Justification**: Serialisation and the decision *whether* to reconcile are marketplace-neutral orchestration - they belong in CORE. *How* a carrier is asked "do you already hold a shipment with this reference?" is carrier-wire detail - it belongs behind an optional sub-capability implemented in the integration package, exactly like `ShipmentCanceller` / `DispatchProtocolReader`.

**New cross-context edge**: `shipping -> sync`. No cycle: `sync` depends on `events` / `listings` / `orders`, never on `shipping`.

---

## 4. External / Domain Research

### Carrier find-by-reference feasibility

`cmd.shipmentId` (the `ol_shipment_*` id) is already stamped as the carrier `reference` on both create paths:
- InPost: `inpost-shipx.mapper.ts:318` (locker), `:369` (courier) -> `ShipXCreateShipmentRequest.reference`.
- DPD: `dpd-shipment.mapper.ts:106` (`DpdSinglePackage`), `:291` (`DpdParcel`).

`reference` is free text on both and does **not** deduplicate server-side - so it can't prevent the duplicate create, but it *can* be used to find one after the fact.

| Carrier | Existing reads | Reconciler feasible? |
|---|---|---|
| **InPost ShipX** | `GET /v1/shipments/{id}`, `GET /v1/points`, `GET /v1/shipments/{id}/label`, `GET .../dispatch_orders/printouts` - the HTTP client's `request()` already takes arbitrary `query` | **Yes.** `GET /v1/organizations/{orgId}/shipments` with a reference filter. Org id is already on `InpostConnectionConfig`. Response envelope mirrors the existing `ShipXPointsResponse { items }` shape. |
| **DPD Polska** | `findPoints` (directory) and SOAP `getEventsForWaybill` (keyed by waybill) | **No.** There is no shipment read by any key, and the REST client is POST-body-only with no `query` support. A find-by-reference would need a DPDServices operation whose path is unconfirmed in this codebase. Deferred. |

**Unverified-endpoint risk and its mitigation.** The exact ShipX filter param for the org shipments collection is not confirmed against a live sandbox in this change. Two guards make shipping it safe:

1. **Non-fatal**: any reconcile failure (404, auth, unexpected shape) is caught, logged at `warn`, and falls through to today's behaviour. Worst case the feature is an inert extra GET - it cannot regress the current path.
2. **Client-side equality check**: the adapter only returns a match when the returned item's own `reference` is **exactly equal** to the requested one. So even if the server ignores the filter and returns an unfiltered page, we never adopt the wrong shipment.

Live verification against the InPost sandbox is called out in the PR as a follow-up.

### Internal Patterns
- **Lock**: `libs/core/src/orders/application/services/order-create-lock.ts` + `OrderSyncService.createOrderIdempotently` (`order-sync.service.ts:190-249`) is the precedent, verbatim: key builder + clamped env-tunable TTL in a sibling module; `acquire` -> on failure re-read and return the peer's result, else throw a retryable contended exception; `try/finally` with a best-effort `release` that never masks the result.
- **Sub-capability**: `shipment-canceller.capability.ts` - interface + co-located `is*` guard, exported from the shipping barrel, resolved by narrowing the dispatched port (never `getCapabilityAdapter('<sub>')`).
- **Exception -> HTTP**: `ShipmentController.toHttpException` (`:390`).

---

## 5. Questions & Assumptions

### Assumptions
- Redis is available wherever dispatch runs - already true (`RedisSyncLockService` backs `SyncLockPort`; the shipping context already uses Redis for pickup-point caches).
- The lock is single-shot with no heartbeat, exactly like `ORDER_CREATE_LOCK_TTL_MS`: it serialises only up to the TTL. Beyond the TTL, correctness falls back to the reconciler. Same trade-off `order-create-lock.ts` already documents and accepts.
- A contended dispatch should behave like a sequential repeat call where possible (return the in-flight shipment) rather than erroring, because that is what the operator means by pressing the button twice.
- `generateLabel` round-trips are seconds, not minutes. Default lock TTL 120 s (same default as order-create), clamped to [10 s, 600 s].

### Open Questions
- **OQ-1**: exact ShipX query-param spelling for the reference filter on the org shipments collection. Mitigated as described in §4; resolved by a sandbox spike, not by blocking this change.

---

## 6. Proposed Implementation Plan

### Phase 1: Per-order dispatch lock

1. **Lock helper**
   - **File**: `libs/core/src/shipping/application/services/shipment-dispatch-lock.ts` (new)
   - **Action**: Export `shipmentDispatchLockKey(orderId): string` returning `shipment:dispatch:${orderId}`, and `SHIPMENT_DISPATCH_LOCK_TTL_MS` resolved from `OL_SHIPMENT_DISPATCH_LOCK_TTL_MS` with default 120 000 clamped to [10 000, 600 000]. Mirrors `order-create-lock.ts` including the doc header.
   - **AC**: non-numeric / empty env falls back to the default; out-of-range clamps.

2. **Contended exception**
   - **File**: `libs/core/src/shipping/domain/exceptions/shipment-dispatch-contended.exception.ts` (new), exported from `libs/core/src/shipping/index.ts`.
   - **Action**: `ShipmentDispatchContendedException(orderId)` - retryable signal, mirrors `OrderCreateContendedException`.

3. **Wrap `dispatch()`**
   - **File**: `libs/core/src/shipping/application/services/shipment-dispatch.service.ts`
   - **Action**: inject `SyncLockPort` via `SYNC_LOCK_TOKEN`. Rename the existing body to a private `dispatchLocked(input)` and make `dispatch()` the lock wrapper:
     - `acquire(shipmentDispatchLockKey(input.orderId), SHIPMENT_DISPATCH_LOCK_TTL_MS)`.
     - On **failure to acquire**: re-read `findActiveByOrderId(orderId)`; if present return `{ kind: 'dispatched', shipment }`; else throw `ShipmentDispatchContendedException`.
     - On **acquire**: run the existing body in `try`, release in `finally` inside its own try/catch that only logs.
   - **Note**: the lock wraps the whole method, including the omp-fulfilled branch. Two Redis round-trips on a no-op branch is a deliberate simplicity trade (one entry point, one invariant).

4. **Module wiring**
   - **File**: `libs/core/src/shipping/shipping.module.ts` - add `SyncModule` to `imports`.

5. **HTTP mapping**
   - **File**: `apps/api/src/shipping/http/shipment.controller.ts` - map `ShipmentDispatchContendedException` to `ConflictException` (409) in `toHttpException`, and add the `@ApiResponse({ status: 409 })` to `generateLabel`.

### Phase 2: Lost-response reconciliation

6. **Sub-capability**
   - **File**: `libs/core/src/shipping/domain/ports/capabilities/shipment-reference-reconciler.capability.ts` (new)
   - **Action**:
     ```ts
     export interface ShipmentReferenceReconciler {
       findShipmentByReference(input: { reference: string }): Promise<ReconciledShipment | null>;
     }
     export function isShipmentReferenceReconciler(adapter: ShippingProviderManagerPort): ...
     ```
     `ReconciledShipment` = `{ providerShipmentId, trackingNumber: string | null }` (a `*.types.ts` sibling per engineering-standards). Export both from the shipping barrel and add the capability to the port's doc header list.

7. **Consult it on the retry path**
   - **File**: `shipment-dispatch.service.ts`, inside `dispatchViaShippingProvider`
   - **Action**: when `priorBranchOne` exists (i.e. this is a retry of a previously-failed attempt) **and** the adapter narrows to `ShipmentReferenceReconciler`, call `findShipmentByReference({ reference: priorBranchOne.id })` before `generateLabel`. On a hit: `update()` the row to `generated` with the discovered `providerShipmentId` / `trackingNumber`, recompute the fulfillment projection, and return - no second carrier create. On a miss or any thrown error: log at `warn` and continue into the normal create path.
   - **Why the retry path only**: on a first dispatch the reference has never been sent to the carrier, so the lookup is guaranteed-empty and would just add latency.
   - **Multi-match refuses to adopt.** Rows created before this fix can legitimately carry two carrier shipments under one reference (the row-reset mechanism in §1). On more than one match the adapter returns `null` and logs at `warn`; picking arbitrarily would mis-link a paid label.

8. **InPost implementation**
   - **Files**: `inpost-shipping.adapter.ts` (add to `implements`, add method), `inpost-shipx.types.ts` (list-response envelope + `reference` on the shipment resource), `inpost-shipx.mapper.ts` (query builder + result mapper with the exact-equality check), `testing/fake-inpost-shipping.adapter.ts` (+ a `seedShipmentByReference` helper).

9. **Refresh stale notes**
   - `shipment-dispatch.service.ts:229-240` (find-then-create note) and `:306-310` (lost-response note); `bulk-shipment-dispatch.service.ts:64-67`.

10. **Docs**
    - `docs/architecture-overview.md`: add the `shipping --> sync` edge to the cross-context dependency map.

---

## 7. Alternatives Considered

**(a) Optimistic pre-issue persist** - write a marker (new column / new status) before calling `generateLabel` so a lost response is distinguishable from a clean rejection. **Rejected as the primary mechanism**: a marker only records *that* an attempt may have committed; it cannot recover the `providerShipmentId`, which is what actually makes the orphaned label cancellable and trackable. It would also require a migration. The reconciler subsumes it - re-reading by reference on the retry path establishes the truth directly, with no schema change. If a future carrier can't support a reference read, the marker becomes worth revisiting.

**(b) DB unique constraint on `(orderId)` for non-terminal rows** - rejected: N shipments/order is deliberate (cancel + re-issue), and a partial-unique index would still leave the carrier-side duplicate window open. It solves the OL-row symptom, not the paid-label problem.

**(c) Job-level dedup instead of a lock** - dispatch is a synchronous HTTP command (`POST /shipments/generate-label`), not a queued job, so there's no job to dedup. A lock is the right primitive for the actual call shape.

---

## 8. Testing Strategy & Acceptance Criteria

| Test | File | Asserts |
|---|---|---|
| Lock helper | `shipment-dispatch-lock.spec.ts` (new) | key shape; TTL default / clamp / non-numeric env |
| Contended path | `shipment-dispatch.service.spec.ts` | acquire-fail + active shipment -> returns it, no `generateLabel`; acquire-fail + none -> throws contended |
| Release discipline | same | released on success **and** on throw; a release failure doesn't mask the result |
| Reconciler adoption | same | retry + capable adapter + hit -> row updated to `generated` with the discovered id, `generateLabel` NOT called |
| Reconciler degradation | same | incapable adapter, or reconcile throws -> falls through to `generateLabel` exactly as today |
| Guard | `shipment-reference-reconciler.capability.spec.ts` (new) | true only when the method is present |
| InPost adapter | `inpost-shipping.adapter.spec.ts` | issues the org-scoped GET; returns null when no item's `reference` matches exactly |
| Concurrency | `apps/api/test/integration/shipment-dispatch-concurrency.int-spec.ts` (new) | two `dispatch()` calls started before either resolves -> exactly one `generateLabel`, one non-cancelled shipment |

Plus the issue's acceptance criteria verbatim, and the standard gate: `pnpm lint`, `pnpm type-check`, `pnpm test`, and the shipping integration suites.

---

## 9. Final Alignment Checklist

- [x] Cross-context import limited to a capability port + Symbol token (`SyncLockPort`, `SYNC_LOCK_TOKEN`) - passes `check:invariants`.
- [x] Sub-capability follows the `capabilities/` + co-located `is*` guard convention; resolved by narrowing, never `getCapabilityAdapter('<sub>')`.
- [x] Service still `implements IShipmentDispatchService` (interface unchanged - the lock is internal).
- [x] No `any`, no `console.log`, no new secrets.
- [x] No migration; no ORM entity change.
- [x] Adapters without the reconciler are byte-identical in behaviour to today.
