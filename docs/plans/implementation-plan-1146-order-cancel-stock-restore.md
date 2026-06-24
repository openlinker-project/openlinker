# Implementation Plan: #1146 — Order-cancellation-observe hook → marketplace stock-restore (Q-T2)

**Date**: 2026-06-22
**Status**: Draft — pending `/tech-review` + `/pre-implement`
**Estimated Effort**: ~1–1.5 days (core hook + capability port + job + Erli wiring + tests)
**Base branch**: `997-erli-writeback` (decision — build on top of #997 so `restoreStockOnCancellation` is present; see §5 Q1). The #1146 PR targets `997-erli-writeback`, not `main`, and is rebased onto `main` after #997 merges.

---

## 1. Task Summary

**Objective**: Add a marketplace-agnostic CORE hook that detects an order transitioning to
`cancelled` during ingestion and triggers the destination marketplace's stock-restore mechanism.

**Context**: Erli auto-decrements stock on purchase but does **not** restore on cancellation
(ADR-025 §4a). The compensating mechanism (`ErliOfferManagerAdapter.restoreStockOnCancellation`)
was authored under #997 but is **wired to no live trigger** — `OrderProcessorManagerPort` exposes
only `createOrder`, and `OrderIngestionService` persists a `cancelled` status without emitting any
status-change signal. This issue closes that gap.

**Classification**: CORE (orders application + listings domain port) + Integration wiring (Erli).

---

## 2. Scope & Non-Goals

### In Scope
- A new **marketplace-agnostic capability port** `OfferStockRestorer` (+ `isOfferStockRestorer` guard) under `libs/core/src/listings/domain/ports/capabilities/`.
- A **cancellation-observe seam** in `OrderIngestionService.syncOrderFromSource` that detects the `→ cancelled` transition.
- A **retry-safe dispatch**: enqueue a new `marketplace.offer.stockRestore` sync job; a worker handler resolves the marketplace `OfferManager` adapter, narrows to `OfferStockRestorer`, resolves the order's variant→external-offer ids, and invokes restore.
- Unit tests for: transition detection (fires once, not on re-poll), capability guard, handler dispatch + id resolution, Erli wiring.

### Out of Scope
- Generalising to non-cancellation status transitions (shipped/returned/etc.).
- A conflict/override UI for frozen stock (ADR-025 — frozen stock skips restore by design).
- Changing `OrderProcessorManagerPort` (the restore is an **OfferManager** concern, not order-processor).

### Constraints
- **Built on top of #997** (`997-erli-writeback`) so `restoreStockOnCancellation` is present and Erli wiring ships in the same PR. The PR is coupled to #997's review/merge (see §5 Q1, §8).
- Idempotent / retry-safe: no double-restore.
- No PII (order id / waybill) in logs.
- CORE ↔ Integration boundary intact: core depends only on the capability port + `IIntegrationsService`.

---

## 3. Architecture Mapping

**Target Layer**: CORE — `libs/core/src/listings/domain/ports/capabilities/` (new port), `libs/core/src/orders/application/services/` (hook), `apps/worker/src/**` (job handler). Integration: `libs/integrations/erli/` (declare `implements OfferStockRestorer`).

**Capabilities Involved**: `OfferManagerPort` + new `OfferStockRestorer` sub-capability; `OrderSourcePort` (already used); `IInventoryQueryService.getAvailabilityByVariantIds` (#823); `OfferMappingRepositoryPort.findMany` (variant→external offer id).

**Existing Services Reused**:
- `OrderIngestionService` — `existing` record is already fetched (line ~206); reuse for transition detection.
- `IIntegrationsService.getCapabilityAdapter<OfferManagerPort>(connectionId, 'OfferManager')` — same resolution path as the content channel-publish flow.
- `SyncJobQueuePort.enqueue` — established `marketplace.offer.*` job idiom.

**New Components Required**:
- `offer-stock-restorer.capability.ts` (+ guard) and `offer-stock-restore.types.ts` (`OfferStockRestoreTarget`) — **listings** context.
- `OfferStockRestoreService` + `IOfferStockRestoreService` interface (`*.service.interface.ts`) — **listings** context (satisfies `check-service-interfaces.mjs`).
- `marketplace.offer.stockRestore` job type + a thin worker handler that delegates to the service.

**Owning context (cross-context edges)**: the restore service lives in **`listings`**. Rationale: `listings` already depends on `inventory` + `integrations` + `products` + `mappings`, so the only *new* edge is `listings → orders` (to read the order record via `IOrderRecordService`) — one new edge vs. two if it lived in `orders` (which depends on neither `listings` nor `inventory` today). The new edge is interface/token-only (safe per the cross-context contract). **This PR updates the dependency map in `architecture-overview.md § Current dependency map` and, if `check-cross-context-imports.mjs` flags it, adds the `listings → orders` interface import to the allow shapes.** The cancellation-*observe* hook itself stays in `orders` (`OrderIngestionService`) and only enqueues a job — no new edge from orders.

**Core vs Integration Justification**: the *trigger* (observe cancellation) and the *orchestration* (resolve targets + adapter, dispatch) are platform-neutral and live in CORE so any future marketplace with the same asymmetric-stock problem reuses them. The *mechanism* (absolute-set write) stays in the Erli adapter behind the capability port. No platform string appears in core.

---

## 4. Design

### Data flow
```
poll/webhook → marketplace.order.sync → OrderIngestionService.syncOrderFromSource
   ├─ existing = getOrderRecord(internalOrderId)          [fetched ~line 206, PRE-persist]
   ├─ [destination-echo early-return ~line 217 stays ABOVE the hook]
   ├─ priorStatus = read from the PRE-persist `existing` snapshot  [never re-fetch after persistOrder]
   ├─ if order.status === 'cancelled' && priorStatus !== 'cancelled':
   │       enqueue { type: 'marketplace.offer.stockRestore',
   │                 connectionId,                         [source = the marketplace]
   │                 payload: { internalOrderId },
   │                 dedupeKey: `marketplace:${connectionId}:stockRestore:${internalOrderId}` }
   └─ … existing persist/sync flow continues unchanged

OfferStockRestoreService (CORE, listings context) — invoked by the worker handler:
   ├─ load order record → resolved item variant ids                  [via IOrderRecordService]
   ├─ OfferMappingRepository.findMany → distinct external offer ids for (connection, variants)
   ├─ IInventoryQueryService.getAvailabilityByVariantIds → target qty per variant   [core reads master, NOT the adapter]
   ├─ build OfferStockRestoreTarget[] = { externalOfferId, quantity }
   ├─ adapter = getCapabilityAdapter<OfferManagerPort>(connectionId,'OfferManager')
   ├─ if !isOfferStockRestorer(adapter): log + no-op (capability honestly absent)
   └─ adapter.restoreStockOnCancellation(targets)
```
The worker handler is a thin wrapper that delegates to `OfferStockRestoreService` (orchestration stays in a core application service per `architecture-overview.md § Sync Manager`).

### Capability port (the contract to reconcile with #997)
**Core resolves availability and passes plain targets** — the adapter does not receive a core service. This keeps the plugin contract free of `IInventoryQueryService` and dissolves the id-conflation in #997 (no id has to double as both a variant key and an offer id).
```ts
// libs/core/src/listings/domain/ports/capabilities/offer-stock-restorer.capability.ts
import type { OfferManagerPort } from '../offer-manager.port';
import type { OfferStockRestoreTarget } from '../../types/offer-stock-restore.types';

export interface OfferStockRestorer {
  // Absolute set per offer — re-runnable by construction. The adapter just
  // writes; it does not read master inventory.
  restoreStockOnCancellation(targets: readonly OfferStockRestoreTarget[]): Promise<void>;
}
export function isOfferStockRestorer(a: OfferManagerPort): a is OfferManagerPort & OfferStockRestorer { … }

// offer-stock-restore.types.ts
export interface OfferStockRestoreTarget { externalOfferId: string; quantity: number; }
```
**#997 reconciliation**: the existing `ErliOfferManagerAdapter.restoreStockOnCancellation(variantOfferIds, inventoryQuery)` body is refactored to the new signature — the availability read moves up into the core restore service; the adapter loops `targets` calling `updateOfferQuantity({ offerId, quantity })`. (Free to change: #997 is unreleased.)

### Idempotency
- The restore is an **absolute set** from master inventory (re-runnable by construction).
- Enqueue is **transition-gated** (`priorStatus !== 'cancelled'`) so a re-poll within the watermark window doesn't re-fire. Job `dedupeKey` is per `(connection, order)`. Together: at-most-once per cancellation, harmless if it runs twice.

---

## 5. Questions & Assumptions

### Open Questions
1. **#997 ordering — RESOLVED (decision: build on top of #997).** This branch is based on `997-erli-writeback`, where `restoreStockOnCancellation` is present, so the capability port + observe hook + job + Erli `implements` all ship in one PR. Consequence: the PR is **coupled to #997's merge** — it targets `997-erli-writeback` and must be rebased onto `main` after #997 lands (997 is currently 28 commits ahead of / 12 behind main; targeting main directly would surface a 28-commit diff). Tracked as a risk in §8.
2. **Id semantics — RESOLVED (tech-review).** The #997 method conflated variant ids and offer ids. Resolved by moving the master-inventory read into the core `OfferStockRestoreService` and passing the adapter explicit `OfferStockRestoreTarget[]` (`{ externalOfferId, quantity }`). The adapter no longer needs an id to double as a variant key, and no longer receives `IInventoryQueryService`. The #997 method body is refactored to the new signature in Phase 4.
3. **Restore target connection** = the order's **source** connection (the marketplace that decremented stock). Confirmed Erli is both `OrderSource` and `OfferManager` on one connection. Assumption: restore only on the source marketplace, never on sync destinations.

### Assumptions
- Prior business status is read from `existing.orderSnapshot.status` (typed, fail-safe read — mirror the existing `paymentStatus` getter idiom). Safe default: absent/garbled prior status ⇒ treat as non-cancelled ⇒ allowed to fire once.
- Dispatch via a new sync job (decoupled, retry-safe) rather than an in-process call — matches the codebase's `marketplace.offer.*` idiom and the issue's idempotency/retry requirement.

---

## 6. Proposed Implementation Plan

### Phase 1 — CORE capability port
1. **`offer-stock-restorer.capability.ts`** (+ co-located `isOfferStockRestorer` guard) and **`offer-stock-restore.types.ts`** (`OfferStockRestoreTarget`) under `libs/core/src/listings/domain/`. Export from the listings barrel. **Acceptance**: guard narrows; barrel exports compile.
2. **Doc**: add the capability row to the `OfferManagerPort` sub-capability table in `architecture-overview.md`.

### Phase 2 — CORE observe hook
3. **`OrderIngestionService.syncOrderFromSource`**: capture `priorStatus` from the **pre-persist `existing`** record (the one fetched ~line 206, before `persistOrder` — never re-fetch after persist), keeping the hook **below** the destination-echo early-return (~line 217). If `order.status === 'cancelled' && priorStatus !== 'cancelled'`, enqueue `marketplace.offer.stockRestore` via `SyncJobQueuePort` with `dedupeKey = marketplace:${connectionId}:stockRestore:${internalOrderId}`. **Acceptance**: unit tests — fires once on transition; no-ops on re-poll of an already-cancelled order, on non-cancel statuses, and on a **destination-echo** order; **first-seen already-cancelled** (`existing === null`) fires once (harmless absolute-set).

### Phase 3 — Dispatch (job + service + handler)
4. **Job type** `marketplace.offer.stockRestore` added to the sync job-type union + worker handler registration. (No new plugin import → no `jest-integration.cjs` mapper edit, #917.)
5. **`OfferStockRestoreService` (+ `IOfferStockRestoreService`)** in `libs/core/src/listings/application/`: read order record (`IOrderRecordService`) → resolved variant ids → `OfferMappingRepository.findMany` distinct external offer ids → `IInventoryQueryService.getAvailabilityByVariantIds` target qty → build `OfferStockRestoreTarget[]` → resolve `OfferManager` adapter → `isOfferStockRestorer` guard → `restoreStockOnCancellation(targets)`. **Acceptance**: unit test with mocked ports; guard-absent path no-ops; no-PII logging.
6. **Worker handler** thin wrapper delegating to the service; returns `SyncJobHandlerResult` `ok`.

### Phase 4 — Erli wiring (in scope — base is #997)
7. Declare `ErliOfferManagerAdapter implements … OfferStockRestorer`; refactor the existing `restoreStockOnCancellation(variantOfferIds, inventoryQuery)` body to the new `(targets: OfferStockRestoreTarget[])` signature — drop the `getAvailabilityByVariantIds` read (now done in the core service) and loop `targets` calling `updateOfferQuantity({ offerId, quantity })`. Update the adapter's existing unit spec accordingly. **Acceptance**: cancellation → `restoreStockOnCancellation` (absolute set) end-to-end; unit + (if feasible) a worker integration slice.

### Phase 5 — Tests + docs
8. Unit tests across phases; update ADR-025 §4a note (cancel-restore now wired) and draft **ADR-026** for the order-cancellation-observe hook + `OfferStockRestorer` capability (new cross-context seam touching the plugin contract → warrants an ADR per `adrs/README.md`).

---

## 7. Alternatives Considered
- **In-process call inside ingestion** (no job): rejected — couples `orders` → `inventory`/`listings` at runtime in the hot ingestion path and isn't independently retry-safe.
- **Extend `OrderProcessorManagerPort` with `cancelOrder`/restore**: rejected — restore is an offer/stock concern (`OfferManager`), not destination order-processing; would bloat an unrelated port.
- **Emit a Redis-streams domain event** (`order.cancelled`) consumed by a listings listener: viable and more decoupled, but heavier than the existing job idiom for a single consumer; revisit if more cancellation consumers appear.

## 8. Validation & Risks
- **Architecture**: ✅ capability-port seam keeps platform out of core. **Risk**: id-semantics mismatch (§5 Q2) — mitigated by pinning the port contract and a reconciliation test against the Erli impl.
- **Backward compat**: ✅ additive — new optional capability, new job type, additive hook branch. No signature changes to existing published contracts (the 997 `restoreStockOnCancellation` is not yet released, so pinning its final signature is free).
- **#997 coupling risk**: MEDIUM — the PR targets `997-erli-writeback` and cannot merge to `main` until #997 does. Mitigated by: keeping all *new* core artifacts (port, hook, job) cleanly separable so a post-#997 rebase onto `main` is mechanical, and tracking the merge order explicitly. If #997 stalls, the core half can be cherry-picked onto `main` (Erli wiring drops to a guard no-op).

## 9. Testing Strategy & Acceptance Criteria
- **Unit**: transition detection (incl. destination-echo no-fire + first-seen-already-cancelled); capability guard; restore-service target resolution + dispatch (incl. guard-absent no-op); Erli adapter conformance to the new signature. Mock all ports.
- **Integration** (optional): worker slice cancelling an ingested order → asserts `updateOfferQuantity` absolute-set call. Gated on #997.
- **Acceptance** (from issue): observable cancelled signal ✅; marketplace-agnostic core hook ✅; Erli end-to-end ✅ (base is #997); idempotent/no double-restore ✅; tests ✅; no boundary violations ✅.

## 10. Alignment Checklist
- [x] Hexagonal architecture (capability port seam)
- [x] CORE vs Integration boundary respected
- [x] Reuses existing patterns (job idiom, capability guard, getCapabilityAdapter)
- [x] Idempotency considered (transition-gate + absolute-set + dedupeKey)
- [x] Error handling / no-PII logging
- [x] Testing strategy complete
- [x] **Execution-ready** — base decided (#997); remaining open item is the id-semantics contract (§5 Q2), resolved during implementation by adjusting port + method together. PR-merge order tracked in §8.
