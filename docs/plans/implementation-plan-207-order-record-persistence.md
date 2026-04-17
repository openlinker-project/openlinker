# Implementation Plan — #207: Persist OrderRecord after marketplace order sync

## 1. Goal

Wire `OrderRecordService` into `OrderIngestionService.syncOrderFromMarketplace` so that an `OrderRecord` is persisted for every order successfully hydrated from the marketplace, capturing sync outcomes per destination.

**Layer**: Application (CORE — `libs/core/src/orders/`)  
**Non-goals**: No schema changes, no new domain entities, no API endpoints, no UI changes.

---

## 2. Current State

`OrderIngestionService.syncOrderFromMarketplace`:
1. Fetches order from marketplace adapter
2. Calls `toUnifiedOrder()` → hydrates to `Order` with internal IDs
3. Calls `orderSyncService.syncOrder()` → returns `OrderSyncResult[]`
4. **Never calls `OrderRecordService`** — `order_records` table stays empty

`OrderRecordService` exists and is fully wired in `OrdersModule` with token `ORDER_RECORD_SERVICE_TOKEN`, but is not injected into `OrderIngestionService`.

---

## 3. Solution Design

### Three scenarios to handle

| Scenario | What happens | Record state |
|---|---|---|
| Successful sync | `syncOrder` returns `status: 'success'` entries | Persisted before sync; updated with `externalOrderId`/`externalOrderNumber` |
| Per-destination failure | `syncOrder` returns some `status: 'failed'` entries | Persisted before sync; updated with `error` message |
| Full `syncOrder` throw | `syncOrder` throws (e.g. `NoOrderDestinationsAvailableException`) | Persisted before sync; no status update (record exists without sync entries) |

### Sequencing

```
1. toUnifiedOrder()  →  order (with internal IDs)
2. orderRecordService.persistOrder(order, connectionId, sourceEventId ?? null)
3. orderSyncService.syncOrder(...)  →  results[]   [may throw]
4. Promise.allSettled → updateSyncStatus per result
5. return results
```

Step 2 runs before step 3 — ensures a record exists even when `syncOrder` throws.  
Step 4 uses `Promise.allSettled` — one failing status update doesn't block others.

---

## 4. Implementation Steps

### Step 1 — Inject `IOrderRecordService` into `OrderIngestionService`

**File**: `libs/core/src/orders/application/services/order-ingestion.service.ts`

- Add `@Inject(ORDER_RECORD_SERVICE_TOKEN) private readonly orderRecordService: IOrderRecordService` to constructor
- Import `IOrderRecordService` and `ORDER_RECORD_SERVICE_TOKEN`

**Acceptance**: Service compiles; existing tests still pass (mock added to test setup).

### Step 2 — Update `syncOrderFromMarketplace` with record persistence

**File**: `libs/core/src/orders/application/services/order-ingestion.service.ts`

Replace the current `syncOrderFromMarketplace` body with:

```typescript
async syncOrderFromMarketplace(connectionId, externalOrderId, sourceEventId?) {
  const marketplace = await this.integrationsService.getCapabilityAdapter<MarketplacePort>(connectionId, 'Marketplace');
  const incoming = await marketplace.getOrder({ externalOrderId });
  const order = await this.toUnifiedOrder(incoming, connectionId);

  // Persist before routing — ensures record exists even if syncOrder throws
  await this.orderRecordService.persistOrder(order, connectionId, sourceEventId ?? null);

  const results = await this.orderSyncService.syncOrder({ order, sourceConnectionId: connectionId, sourceEventId });

  // Update per-destination sync status; allSettled — one failure doesn't block others
  const settlements = await Promise.allSettled(
    results.map((result) => {
      if (result.status === 'success') {
        return this.orderRecordService.updateSyncStatus(order.id, result.destinationConnectionId, {
          destinationConnectionId: result.destinationConnectionId,
          status: 'synced',
          syncedAt: new Date(),
          externalOrderId: result.orderRef.orderId,
          externalOrderNumber: result.orderRef.orderNumber,
        });
      } else {
        return this.orderRecordService.updateSyncStatus(order.id, result.destinationConnectionId, {
          destinationConnectionId: result.destinationConnectionId,
          status: 'failed',
          error: result.error.message,
        });
      }
    }),
  );
  for (const settlement of settlements) {
    if (settlement.status === 'rejected') {
      this.logger.warn('Failed to update order record sync status', settlement.reason);
    }
  }

  return results;
}
```

**Acceptance**: `order_records` row created before `syncOrder` is called; sync outcomes recorded after.

### Step 3 — Update unit tests for `OrderIngestionService`

**File**: `libs/core/src/orders/application/services/__tests__/order-ingestion.service.spec.ts`

Add `orderRecordService` mock to test setup and update `syncOrderFromMarketplace` tests:

1. Add `orderRecordService: jest.Mocked<IOrderRecordService>` to test setup
2. Add mock to `OrderIngestionService` constructor call
3. Add/update test cases:
   - **successful sync**: verify `persistOrder` called before `syncOrder` using `mock.invocationCallOrder` (assert `persistOrder.mock.invocationCallOrder[0] < orderSyncService.syncOrder.mock.invocationCallOrder[0]`); verify `updateSyncStatus` called with `status: 'synced'`
   - **per-destination failure**: verify `updateSyncStatus` called with `status: 'failed'` and error message
   - **multiple destinations, mixed results**: verify `updateSyncStatus` called for each result independently
   - **`syncOrder` throws entirely**: verify `persistOrder` was still called; `updateSyncStatus` not called
   - **`updateSyncStatus` rejects for one destination**: mock one `updateSyncStatus` call to reject; verify `logger.warn` called once; verify the method still resolves (does not throw)

**Acceptance**: All new tests pass; all existing tests still pass.

---

## 5. Validation

- **Architecture compliance**: Application service depends on `IOrderRecordService` port (not concrete class). ✅
- **Naming**: No new files — only modifying existing service and test. ✅
- **Error safety**: `persistOrder` failure propagates (caller can retry). `Promise.allSettled` for status updates; rejected settlements logged via `this.logger.warn`. ✅
- **PII**: `persistOrder` internally respects `OL_STORE_PII` — no change needed. ✅
- **Idempotency**: `OrderRecordRepository.upsert` is used by `persistOrder` — safe to re-run. ✅
- **No migration needed**: `order_records` table already exists. ✅

---

## 6. Files Changed

| File | Change |
|---|---|
| `libs/core/src/orders/application/services/order-ingestion.service.ts` | Inject `IOrderRecordService`; update `syncOrderFromMarketplace` |
| `libs/core/src/orders/application/services/__tests__/order-ingestion.service.spec.ts` | Add mock; add/update `syncOrderFromMarketplace` test cases |
