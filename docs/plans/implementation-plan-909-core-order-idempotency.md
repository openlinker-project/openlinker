# Implementation Plan — #909 Lift order-create idempotency fully into core

> **Issue:** [#909](https://github.com/openlinker-project/openlinker/issues/909) — *Lift order-create idempotency fully into core (OrderRef external-id contract; remove per-adapter guard)*
> **Part of:** #900. **Follow-up to:** #906/#911 (per-(order, destination) lock in core — merged as `ad821036`).
> **Reference:** ADR-015 § Required invariants; `docs/plans/implementation-plan-906-destination-order-idempotency.md` § 7 ("Full A′").

---

## 1. Understand the task

### Goal
Make destination order creation **idempotent for any `OrderProcessorManager` adapter with zero per-adapter create-or-skip code**. Today only `PrestashopOrderProcessorManagerAdapter` is idempotent, and it does so by carrying its own check-then-act guard plus the mapping write. #906/#911 already wrapped the create in a per-(order, destination) lock in `OrderSyncService`; this issue lifts the *decision* into core and fixes the `OrderRef` return contract.

### What changes
1. **Contract change:** `OrderProcessorManagerPort.createOrder` MUST return the **destination-native external id** in `OrderRef.orderId` (today it returns the internal OpenLinker id on both the success and skip paths).
2. **Move idempotency into core:** the `getExternalIds('Order', internalId)` skip + the `createMapping(externalId, …)` write move from the PrestaShop adapter into `OrderSyncService.createOrderIdempotently`, under the existing #906 lock.
3. **Remove per-adapter guard:** delete PrestaShop `createOrder` Step 0 (skip) and Step 6 (mapping write); change Step 7 to return the **external** id. Keep PS-side duplicate-key recovery as defense-in-depth.
4. **`syncStatus.externalOrderId` becomes correct:** `OrderIngestionService` writes `result.orderRef.orderId`; once that is the external id, the recorded value is correct (no logic change there, only a test-expectation fix).
5. **Audit consumers** of `orderRef.orderId` / `syncStatus.externalOrderId`.

### Layer classification
- **CORE (orders):** `OrderSyncService` (idempotency lifted here), port-contract doc, `OrderIngestionService` (verify-only).
- **Integration (PrestaShop):** adapter — remove Step 0/6, fix Step 7 return.
- **Tests:** adapter spec, order-sync spec, ingestion spec, plus full `pnpm test:integration`.

### Non-goals
- No DB schema/migration (`syncStatus` is JSONB; no entity change).
- No change to the lock mechanism itself (#906/#911 stands).
- No new capability/manifest changes.
- No change to source-side order identifier mapping (`order-destination-retry.service.ts` uses the source mapping — out of scope).

---

## 2. Research findings (current state)

| Concern | File | Detail |
|---|---|---|
| Port + `OrderRef` | `libs/core/src/orders/domain/ports/order-processor-manager.port.ts`; `…/domain/types/order-processor.types.ts:101-118` | `OrderRef.orderId` doc currently says "may be internal OR external" — ambiguous. |
| Adapter Step 0 (skip) | `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts:149-175` | `getExternalIds` lookup → returns **internal** id. |
| Adapter mapping write (Step 6) | same file `:566-618` | `createMapping(Order, externalOrderId, connId, internalOrderId)`; swallows `MappingAlreadyExistsError` / `DuplicateIdentifierMappingError`. |
| Adapter return (Step 7) | same file `:633-637` | returns `{ orderId: internalOrderId, … }` — **internal** (the bug). |
| Adapter dup-key recovery | same file `:479-564` | catches PS duplicate-key, re-queries PS by reference, recovers external id. **Keep.** |
| Core lock | `libs/core/src/orders/application/services/order-sync.service.ts:167-215` | `createOrderIdempotently`; contention branch already returns `{ orderId: existing.externalId }` (external — correct). Adapter-success branch returns adapter ref (internal — wrong). |
| Ingestion write | `libs/core/src/orders/application/services/order-ingestion.service.ts:~289` | `externalOrderId: result.orderRef.orderId`. |
| `OrderSyncStatus` | `libs/core/src/orders/domain/types/order-sync.types.ts:14-32` | `externalOrderId?: string` — "External order ID in destination system". |
| Consumer (fulfillment) | `libs/core/src/orders/application/services/fulfillment-status-sync.service.ts:222-310` | `findExternalOrderId` reads `syncStatus.externalOrderId` → `getFulfillmentStatus({ externalOrderId })`. **Currently broken** (gets internal id); this fix corrects it. |
| Consumer (dispatch notify) | `shipment-dispatch-notification.service.ts:205` | passes `entry.externalOrderId` to `updateFulfillment`. Corrected by this fix. |
| Consumer (shipment status) | `shipment-status-sync.service.ts:262,283` | filters/uses `entry.externalOrderId`. Corrected by this fix. |
| Identifier mapping access | `order-sync.service.ts` ctor | already injects `IIdentifierMappingService` via `IDENTIFIER_MAPPING_SERVICE_TOKEN` (`getExternalIds`, `createMapping` available). **No module change.** |

**Key insight:** every consumer of `syncStatus.externalOrderId` already *expects* the destination external id and was silently broken. This change fixes them — no consumer code edits required, only verification.

---

## 3. Design

### New `createOrderIdempotently` flow (core, under the lock)
```
token = syncLock.acquire(lockKey, TTL)
if (!token) {                                   // contention — peer is creating
  existing = getExternalIds('Order', internalOrderId).find(connId)
  if (existing) return { orderId: existing.externalId }     // already done
  throw OrderCreateContendedException            // retryable
}
try {
  // (A) skip check — lifted from adapter Step 0
  existing = getExternalIds('Order', internalOrderId)
               .find(m => m.connectionId === destinationConnectionId)
  if (existing) {
    log("already present; skipping create")
    return { orderId: existing.externalId }
  }
  // (B) create — adapter now returns the destination external id
  ref = await adapter.createOrder(orderCreate)
  // (C) mapping write — lifted from adapter Step 6
  try {
    await identifierMapping.createMapping(
      CORE_ENTITY_TYPE.Order, ref.orderId, destinationConnectionId, internalOrderId,
      { metadata: { orderNumber: ref.orderNumber, createdAt: <iso> } })
  } catch (e) {
    if (e instanceof DuplicateIdentifierMappingError) { /* concurrent insert — ok */ }
    else throw e
  }
  return ref
} finally {
  syncLock.release(lockKey, token)   // best-effort (unchanged)
}
```
Notes:
- The **skip check inside the acquired branch** is required: a *prior, completed* job run may already have created+mapped the order (lock released). Without it we'd double-POST.
- `internalOrderId` is already a parameter (`order.id`) — core no longer needs `metadata.internalOrderId`.
- `Date` value: follow the existing codebase idiom (`new Date().toISOString()`), matching the current adapter Step 6.
- Confirm `DuplicateIdentifierMappingError` is exported from `@openlinker/core/identifier-mapping`. If `createMapping`'s "already exists" path throws a different domain error (`MappingAlreadyExistsError`), catch both — mirror exactly what the adapter catches today.

### Adapter (PrestaShop) after change
- **Delete Step 0** (`:149-175`) entirely.
- **Delete Step 6 mapping write** (`:566-618`) — core owns it now. (The `getOrCreateInternalId` fallback there also goes.)
- **Step 7** (`:633-637`): `return { orderId: externalOrderId, orderNumber: createdOrder.reference || order.orderNumber || externalOrderId }` — `externalOrderId` already holds the created-or-recovered PS id.
- **Keep** dup-key recovery (`:479-564`); ensure the recovered `externalOrderId` flows into the Step 7 return.
- `order.metadata?.internalOrderId` reads disappear with Step 0/6. Leaving core to still pass it is harmless; prefer removing the now-dead read in the adapter.

### Port contract doc
Update `OrderRef.orderId` doc + `createOrder` docstring to state: **returns the destination-native external order id**; idempotency (skip-if-exists + mapping persistence) is owned by `OrderSyncService` under a per-(order, destination) lock, not by adapters.

### Data flow after change
`OrderSyncService.createOrderIdempotently` → returns external id (both branches) → `syncOrder` result `orderRef.orderId` = external id → `OrderIngestionService` records `syncStatus.externalOrderId` = external id (correct) → fulfillment/shipment sync read the correct destination id.

---

## 4. Step-by-step implementation

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `libs/core/src/orders/domain/types/order-processor.types.ts` | Rewrite `OrderRef.orderId` doc to "destination-native external id". | Doc unambiguous. |
| 2 | `libs/core/src/orders/domain/ports/order-processor-manager.port.ts` | Update `createOrder` docstring: returns external id; core owns idempotency. | Contract documented. |
| 3 | `libs/core/src/orders/application/services/order-sync.service.ts` | Add (A) skip check + (C) mapping write inside the acquired-lock branch of `createOrderIdempotently`; import `DuplicateIdentifierMappingError` (+ sibling) from `@openlinker/core/identifier-mapping`. | Core skips when mapping exists; writes mapping after create; swallows duplicate. Both branches return external id. |
| 4 | `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts` | Remove Step 0 + Step 6; Step 7 returns `externalOrderId`; drop dead `metadata.internalOrderId` reads; keep dup-key recovery. | Adapter has no skip/mapping logic; returns external id. |
| 5 | `…/__tests__/prestashop-order-processor-manager.adapter.spec.ts` | Expect `orderId === externalOrderId`; remove the "already exists → returns internal" skip test (logic moved); keep dup-key-recovery test (now asserting external id). | Spec green, reflects new contract. |
| 6 | `…/orders/application/services/__tests__/order-sync.service.spec.ts` | Add: (a) acquired lock + existing mapping → skip + external id, no `adapter.createOrder` call; (b) acquired + no mapping → create + `createMapping` called with `(Order, externalId, connId, internalId)` + returns external id; (c) `createMapping` throws `DuplicateIdentifierMappingError` → swallowed, returns ref. Keep existing contention tests. | New core idempotency covered. |
| 7 | `…/orders/application/services/__tests__/order-ingestion.service.spec.ts` | Update expectation: `syncStatus.externalOrderId` == external id from `orderRef`. | Spec reflects corrected value. |
| 8 | Consumers audit (no code change expected) | Re-read `fulfillment-status-sync`, `shipment-dispatch-notification`, `shipment-status-sync` to confirm they consume `externalOrderId` as destination id. | Confirmed; note any surprise in PR. |
| 9 | Quality gate + `pnpm test:integration` | Run full suites. | All green (acceptance criterion). |

---

## 5. Validation

- **Architecture:** idempotency policy belongs in the core application service (orchestration), not the adapter — this *removes* a boundary violation. ✅ Hexagonal direction preserved (core → port; adapter implements port).
- **Naming/standards:** no new types inline; reuse existing domain errors; `as const`/Symbol-token conventions untouched.
- **Security:** no new external input surface; mapping writes are connection-scoped as before.
- **Testing strategy:** unit-level for the lifted logic (core) + adapter contract; integration suite for the vertical slice (acceptance requires full `pnpm test:integration`). Per memory, run the **whole** integration suite, not just order specs.
- **Risk / blast radius:** the `OrderRef` contract change touches every consumer of `orderRef.orderId` / `syncStatus.externalOrderId`. Mitigated because all known consumers already *expect* the external id (they were latently broken). Defense-in-depth (PS dup-key recovery + core swallow-duplicate) retained.

### Open questions
1. Exact domain-error class names thrown by `IIdentifierMappingService.createMapping` on "already exists" (`DuplicateIdentifierMappingError` vs `MappingAlreadyExistsError`) and which are barrel-exported — confirm at impl time; catch the same set the adapter catches today.
2. Whether core should keep passing `metadata.internalOrderId` to the adapter (harmless) or drop it. Lean: drop the now-dead adapter read; leave core's `orderCreate` build unchanged to minimize churn.
