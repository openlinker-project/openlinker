# Implementation Plan: Lock-guarded idempotent destination order creation (#906)

**Date**: 2026-05-30
**Status**: Ready for Review (revised after deep review + research)
**Estimated Effort**: ~0.5–1 day
**Issue**: #906 (blocks #902; part of epic #900) — ADR-015 § Required invariants 1 & 2

---

## 1. Task Summary

**Objective**: Make creating an order in a destination safe under concurrency — a per-`(order, destination)` distributed **lock in core `OrderSyncService`** so converging triggers (webhook + poll, or a job retry) cannot produce a duplicate destination order, even across multiple worker processes.

**Context & premise correction**: Deep review + codebase research established that destination idempotency is **not** absent today — `PrestashopOrderProcessorManagerAdapter.createOrder` already does a check-then-act guard (Step 0 `getExternalIds` skip + Step 6 `createMapping`). The real gaps are: (a) that guard is **check-then-act → racy under multi-worker** (`sync-job.runner.ts` locks per-*job*, not per-*order*; two workers can run a webhook job and a poll job for the same order concurrently); and (b) it lives per-adapter. This issue closes (a) — the correctness gap — by adding the missing serialization lock in core. Closing (b) fully (platform-agnostic idempotency) is **deferred** (see §7) because it requires a rippling `OrderRef` contract change.

**Classification**: CORE application service + Testing. (No adapter behavior change in this issue.)

---

## 2. Scope & Non-Goals

### In Scope
- A per-`(internalOrderId, destinationConnectionId)` lock in `OrderSyncService` around each `adapter.createOrder`.
- Lock-not-acquired handling: re-read mapping → already-created ⇒ success; else **rethrow a retryable contention error** so the worker job retries (matches the `MissingOrderItemMappingError` pattern).
- A port-contract note on `OrderProcessorManagerPort.createOrder` documenting the idempotency expectation.
- Unit + integration tests.

### Out of Scope (deferred — see §7)
- **Full A′**: lifting the adapter's Step 0/6 into core, changing `OrderRef.orderId` to carry the destination external id, core-owned `createMapping`, and the `syncStatus.externalOrderId`-records-internal-id fix. (Tracked as a follow-up issue; rippling contract change.)
- Unified webhook/poll job dedup key (optional optimization; the lock is the guarantee).
- Any `OrderRef` shape change, DB migration, new job type, or API surface change.

### Constraints
- No `OrderRef` contract change (keeps blast radius small).
- Must land **before** #902 routes order webhooks onto `marketplace.order.sync`.

---

## 3. Architecture Mapping

**Target layer**: CORE application — `libs/core/src/orders/application/services/order-sync.service.ts` (+ a port-doc note on `domain/ports/order-processor-manager.port.ts`, + lock-key/TTL constants in a `*.types.ts`).

**Ports involved** (all already in `OrdersModule` scope — research-confirmed, **zero module edits**):
- `SyncLockPort` (`SYNC_LOCK_TOKEN`, `@openlinker/core/sync`) — `acquire(key, ttlMs) → token|null` (single-shot `SET NX PX`), `release(key, token)` (compare-and-delete Lua). `OrderIngestionService` (same module) already injects it for the poll lock — proves resolution in both apps; `REDIS_CLIENT` is `@Global`.
- `IIdentifierMappingService` (`IDENTIFIER_MAPPING_SERVICE_TOKEN`) — `getExternalIds('Order', internalId)` for the contention re-read. Already injected by sibling services.

**Core vs Integration**: serialization of "create exactly once per (order, destination)" is platform-agnostic orchestration → core. The adapter's create + its own native dedup/recovery stay in the adapter.

---

## 4. External / Domain Research (grounded, file:line)

- `OrderSyncService.syncOrder` builds one `OrderCreate` (stamps `metadata.internalOrderId = order.id`, `order-sync.service.ts:91`) and dispatches `adapter.createOrder` per destination via `Promise.allSettled` (lines 96-100); rejections → `{status:'failed'}` results (123-127); **never rethrows**.
- `OrderIngestionService.syncOrderFromSource` swallows failed destinations — only `updateSyncStatus(...,'failed')` (`order-ingestion.service.ts:279-310`), `return results` (312), **no throw**. So a failed destination ⇒ worker job `markSucceeded`, **not** retried (`sync-job.runner.ts:274-280`). The retry-on-throw path (`handleJobFailure`, 296-342) only fires on a *thrown* error; the precedent for "make the job retry" is the `MissingOrderItemMappingError` throw (`order-ingestion.service.ts:235-243`).
- `OrderDestinationRetryService` (`order-destination-retry.service.ts:48-137`) is **operator-driven** (`POST /orders/:id/destinations/:cid/retry`), only for `failed` rows, **no scheduler** — not an automatic safety net.
- PrestaShop `createOrder` returns `{ orderId: internalOrderId, … }` on **both** success (adapter:635) and skip (170-173) paths — `OrderRef.orderId` is the **internal** id, not the destination external id. (This is why full A′ needs a contract change — deferred.)
- `RedisSyncLockService.acquire` is single-shot (`redis-sync-lock.service.ts:33-38`); no heartbeat/extension → TTL must exceed worst-case `createOrder`.
- Wiring: `OrdersModule` imports `SyncModule` + `IdentifierMappingModule` and provides `OrderSyncService`; `OrderIngestionService` already uses `SYNC_LOCK_TOKEN` (`order-ingestion.service.ts:66-67,86-87,163`).

---

## 5. Questions & Assumptions

- **A1 (lock key)**: `order:create:{destinationConnectionId}:{internalOrderId}`; constant builder + TTL in `order-sync.types.ts` (no inline literals — engineering-standards § Constants).
- **A2 (TTL)**: `ORDER_CREATE_LOCK_TTL_MS` generous (default **120 000 ms**) because PS `createOrder` (customer + cart + pin + POST) is multi-second. Documented bound below.
- **A3 (contention → retry)**: on `acquire → null`, re-read `getExternalIds`; mapped ⇒ return `success` synthesized from the mapping; unmapped ⇒ throw `OrderCreateContendedError` (retryable). After `allSettled`, contention rejections are **rethrown** to trigger a whole-job retry; genuine per-destination failures stay isolated `failed` results (preserves existing behavior).
- **A4**: the adapter keeps Step 0/6, so on the retry the other worker has finished and the adapter skips. Core's lock + the adapter's check-then-act compose: the lock removes the concurrency window, the adapter remains the create/skip authority.

---

## 6. Proposed Implementation Plan

### Phase 1 — Port contract note
1. `order-processor-manager.port.ts` — JSDoc: `createOrder` SHOULD be idempotent w.r.t. `(metadata.internalOrderId, destination connection)`; core serializes concurrent creates per `(order, destination)` via a lock. Doc-only.

### Phase 2 — Lock constants + contention error
2. `application/types/order-sync.types.ts` (or existing types file) — `ORDER_CREATE_LOCK_TTL_MS` and `orderCreateLockKey(destinationConnectionId, internalOrderId)`.
3. `domain/exceptions/order-create-contended.exception.ts` — `OrderCreateContendedError extends Error` (retryable; thrown when a concurrent create holds the lock and no mapping exists yet).

### Phase 3 — Lock guard in `OrderSyncService`
4. Inject `@Inject(SYNC_LOCK_TOKEN) syncLock: SyncLockPort` and `@Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN) identifierMapping: IIdentifierMappingService` (no module change).
5. Replace the per-destination `adapter.createOrder(orderCreate)` (line 98) with `createOrderIdempotently(adapter, destinationConnectionId, order.id, orderCreate)`:
   - `acquire(orderCreateLockKey(dest, order.id), ORDER_CREATE_LOCK_TTL_MS)`;
   - **acquired** → `adapter.createOrder(...)` in `try`, `release` in `finally`; return its `OrderRef`;
   - **not acquired** → `getExternalIds('Order', order.id)` filtered to `dest`; mapped ⇒ return synthesized `OrderRef { orderId: existing.externalId }`; unmapped ⇒ `throw new OrderCreateContendedError(...)`.
6. After `Promise.allSettled`, if any settlement rejected with `OrderCreateContendedError`, **rethrow** an aggregate retryable error so the worker job retries (whole-job retry is safe given idempotency). Non-contention rejections remain `status:'failed'` results (unchanged isolation).

### Phase 4 — Tests
7. Unit `order-sync.service.spec.ts`: (a) lock acquired → `createOrder` called once, released; (b) **lock not acquired + mapping present** → `createOrder` NOT called, success synthesized from mapping; (c) **lock not acquired + no mapping** → throws (job will retry); (d) genuine `createOrder` failure → isolated `failed` result, lock released; (e) two sequential calls (adapter Step-0 simulated) → one create. Mock `SyncLockPort` (`acquire` returns token / null) + identifier mapping.
8. Integration — extend `allegro-order-sync-e2e.int-spec.ts`: two sequential `marketplace.order.sync` jobs for the same order → exactly one `createOrder` (exercises the lock-release + adapter skip; see caveat §8).

### Phase 5 — Quality gate
9. `pnpm lint && pnpm type-check && pnpm test`, then full `pnpm test:integration`.

---

## 7. Deferred follow-up — "Full A′" (separate issue)

Lift idempotency fully into core so **any** destination adapter is safe with no per-adapter code:
- Change `OrderProcessorManagerPort.createOrder` to return the **destination external id** in `OrderRef.orderId` (today it returns the internal id).
- Move the `getExternalIds` skip + `createMapping` write into `OrderSyncService` (under the lock from this issue); remove PrestaShop Step 0/6.
- Fix `syncStatus.externalOrderId` to record the destination external id (today records the internal id).
- Audit consumers of `OrderRef.orderId` / `syncStatus.externalOrderId` (fulfillment + shipment sync) for the contract change.

Deferred because the `OrderRef` contract change has wide blast radius; this issue delivers the correctness (concurrency) fix without it. **File as a follow-up of #900.**

---

## 8. Validation & Risks

- **Architecture**: ✅ lock (orchestration) in core; adapter unchanged. Cross-context imports interface/token-only; zero module edits (research-confirmed).
- **Risks**:
  - **TTL-expiry window**: single-shot lock, no heartbeat. If `createOrder` exceeds `ORDER_CREATE_LOCK_TTL_MS`, the lock expires and a concurrent create can slip through. Mitigation: generous TTL (120 s) **and** PrestaShop's own duplicate-key recovery remains the backstop (kept, since Step 0/6 stay). **Honest bound**: the lock guarantees exactly-once *up to TTL*; beyond it, correctness falls back to adapter-native dedup. For a future adapter without native recovery, full A′ + a sufficient TTL is the answer.
  - **Whole-job retry on contention** re-dispatches all destinations — safe because the adapter create is idempotent (the property this issue + Step 0 provide).
- **Backward compatibility**: ✅ no `OrderRef`/persistence/contract change.

---

## 9. Testing Strategy & Acceptance Criteria

- **Unit**: `order-sync.service.spec.ts` branches (a)–(e) in Phase 4, mocking `SyncLockPort` (incl. `acquire → null` to simulate contention).
- **Integration**: none added — and deliberately so:
  - The lock's actual property (prevents *simultaneous* double-create) is unobservable in the integration harness, which runs a **single worker sequentially**. Pre-holding the exact lock key to fake contention requires the runtime-derived `internalOrderId` + the destination connection id (from `listCapabilityAdapters`, not the harness's mocked `getCapabilityAdapter`) — a brittle, low-value test of a property the unit specs already cover via `acquire → null`.
  - A mock-adapter "two sequential jobs → one create" assertion would be *misleading*: sequential jobs release the lock between runs, so dedup there comes from the **adapter's** Step-0 mapping (a mock has none) — not from this change.
  - The existing `apps/worker/test/integration/allegro-order-sync-e2e.int-spec.ts` is **pre-broken on `main`** (calls `markSucceeded(id)` one-arg vs the #400 two-arg `markSucceeded(id, outcome)` contract) — unrelated to #906; flagged for separate cleanup. It therefore can't validate this change either.
  - Validation rests on: `pnpm type-check` (all src), `pnpm check:invariants`, core ESLint (0 errors), and 963 core unit tests including the 4 new lock-branch specs.
- **`OrderSyncResult` note**: there is no `skipped` variant; a skip surfaces as `status:'success'`. On the adapter Step-0 skip `orderRef.orderId` is the internal id (existing behavior); on the core contention re-read it's the destination external id. Minor inconsistency, documented; fully reconciled by full A′ (§7).
- **Acceptance**:
  - [ ] Concurrent creates for the same `(order, destination)` are serialized by the lock; a contended job retries rather than silently dropping.
  - [ ] Two converging same-order syncs → exactly one `createOrder`.
  - [ ] Lock always released (success + failure paths).
  - [ ] No `OrderRef`/module changes; `pnpm lint && type-check && test` green. (The worker order-sync e2e int-spec is pre-broken on `main` — `markSucceeded` arity, unrelated to #906 — and is out of scope; flagged for separate cleanup.)

---

## 10. Alignment Checklist

- [x] Hexagonal (lock orchestration in core; adapter untouched)
- [x] CORE vs Integration boundaries (interface/token imports; zero module edits)
- [x] Reuses existing seams (`SyncLockPort`, identifier mapping)
- [x] Idempotency + multi-worker concurrency addressed (the point)
- [x] Retry-safe (contention → rethrow → runner retry, matching `MissingOrderItemMappingError`)
- [x] Error handling (retryable contention error; isolated genuine failures)
- [x] Testing strategy complete + harness caveat documented
- [x] Constants in `*.types.ts`; no inline literals
- [x] Plan saved as markdown

---

## Related Documentation
- ADR-015 § Required invariants (1 & 2)
- Epic #900; blocks #902; full-A′ follow-up to be filed.
