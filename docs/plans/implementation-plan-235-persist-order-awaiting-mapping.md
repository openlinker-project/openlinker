# Implementation Plan: #235 — Persist order with `awaiting_mapping` status

## 1. Task Understanding

**Goal**: Ensure that when `syncOrderFromMarketplace` fails to resolve one or more order items (because offer→variant mapping doesn't exist yet), the incoming order is **still persisted** in `order_records` with a `recordStatus = 'awaiting_mapping'` — so it is observable in the UI, can be diagnosed, and recovers automatically on the next retry once the mapping is created.

**Layer**: CORE (orders) + Infrastructure (migration) + Interface (API DTO + FE page)

**Non-goals**:
- Triggering an ad-hoc `marketplace.offers.sync` for the unresolved offer (separate issue)
- Making `MissingOrderItemMappingError` non-retryable after N attempts (out of scope)
- Changing orphan `customer_projections` behavior (acceptable for now)
- Storing order snapshot from the *stored* record on retry (each retry still re-fetches from marketplace once; snapshot is for observability, not to replace fetching)

---

## 2. Codebase Research

### Key files

| File | Role |
|---|---|
| `libs/core/src/orders/domain/entities/order-record.entity.ts` | `OrderRecord` domain entity — needs `recordStatus` field |
| `libs/core/src/orders/domain/types/order-record.types.ts` | `OrderRecordFilters` — needs `recordStatus` filter |
| `libs/core/src/orders/domain/ports/order-record-repository.port.ts` | Repository port — `findMany` signature covers new filter |
| `libs/core/src/orders/application/interfaces/order-record.service.interface.ts` | Service interface — needs `persistIncomingSnapshot` |
| `libs/core/src/orders/application/services/order-record.service.ts` | Service impl — implement `persistIncomingSnapshot` |
| `libs/core/src/orders/application/services/order-ingestion.service.ts` | **Main fix**: reorder snapshot persist before item resolution |
| `libs/core/src/orders/application/services/order-item-ref-resolver.service.ts` | Add `tryResolve` non-throwing variant |
| `libs/core/src/orders/infrastructure/persistence/entities/order-record.orm-entity.ts` | Add `recordStatus` column |
| `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts` | Map new field, support new filter |
| `apps/api/src/migrations/` | New migration for `record_status` column |
| `apps/api/src/orders/http/dto/list-orders-query.dto.ts` | Add `recordStatus` filter param |
| `apps/api/src/orders/http/dto/order-record-response.dto.ts` | Add `recordStatus` to response |
| `apps/api/src/orders/http/orders.controller.ts` | Pass `recordStatus` to repository query |
| `apps/web/src/features/orders/api/orders.types.ts` | Add `recordStatus` to `OrderRecord` + `OrderFilters` |
| `apps/web/src/features/orders/api/orders.api.ts` | Pass `recordStatus` filter param |
| `apps/web/src/pages/orders/failed-orders-page.tsx` | Query `order_records` with `recordStatus=awaiting_mapping`, show real order data |

### Current flow (broken)

```
syncOrderFromMarketplace(connectionId, externalOrderId, sourceEventId)
  1. marketplace.getOrder()              ← fetches from Allegro
  2. toUnifiedOrder()                    ← ❌ throws MissingOrderItemMappingError here
  3. orderRecordService.persistOrder()   ← never reached → order lost
  4. orderSyncService.syncOrder()
  5. updateSyncStatus per destination
```

### Target flow (fixed)

```
syncOrderFromMarketplace(connectionId, externalOrderId, sourceEventId)
  1. marketplace.getOrder()
  2. resolve internalOrderId + customerId (existing identifierMapping + customerIdentityResolver calls)
  3. orderRecordService.persistIncomingSnapshot(incoming, internalOrderId, customerId, …)
       → upserts order_records with recordStatus='awaiting_mapping', raw IncomingOrder snapshot
  4. tryResolveItems(incoming.items, connectionId)
       → returns { resolved: OrderItem[], unresolved: UnresolvedItemRef[] }
  5. if unresolved.length > 0:
       → throw MissingOrderItemMappingError (job runner retries with backoff)
         record already persisted — operator can see it in UI
  6. construct unified Order (all items resolved)
  7. orderRecordService.persistOrder(order, …)
       → upserts with recordStatus='ready', resolved snapshot
  8. orderSyncService.syncOrder()
  9. updateSyncStatus per destination
```

---

## 3. Solution Design

### 3.1 Domain: `OrderRecord` entity

Add `recordStatus: OrderRecordStatus` field (`'ready' | 'awaiting_mapping'`).

```typescript
// order-record.types.ts — add:
export const OrderRecordStatusValues = ['ready', 'awaiting_mapping'] as const;
export type OrderRecordStatus = (typeof OrderRecordStatusValues)[number];

// order-record.entity.ts — add field:
public readonly recordStatus: OrderRecordStatus,
```

### 3.2 `OrderItemRefResolverService` — add `tryResolve`

Add a non-throwing variant that returns a discriminated union:
```typescript
type ItemResolutionResult =
  | { resolved: true; internalProductId: string; internalVariantId?: string }
  | { resolved: false; productRef: IncomingOrderItemRef; reason: string };

async tryResolve(connectionId: string, productRef: IncomingOrderItemRef): Promise<ItemResolutionResult>
```

Internally calls `resolve()` and catches `MissingOrderItemMappingError`.

### 3.3 `IOrderRecordService` / `OrderRecordService` — add `persistIncomingSnapshot`

```typescript
persistIncomingSnapshot(
  incoming: IncomingOrder,
  internalOrderId: string,
  customerId: string | null,
  sourceConnectionId: string,
  sourceEventId: string | null,
): Promise<OrderRecord>
```

Stores `incoming` as-is in `orderSnapshot` (raw `IncomingOrder` JSON — items retain external offer refs, no internal IDs). Sets `recordStatus = 'awaiting_mapping'`. PII rules still apply to address fields.

**Snapshot shape contract**: `orderSnapshot` for `awaiting_mapping` records differs from `ready` records — it contains `IncomingOrderItem[]` with `productRef` (external offer ID) instead of resolved `OrderItem[]` with internal product/variant IDs. Consumers (API response, frontend page) must treat the snapshot as opaque debug data for `awaiting_mapping` records; only `ready` records have fully resolved item refs. The `OrderRecordResponseDto` documents this via an `@ApiProperty` description.

### 3.4 `OrderIngestionService` — rework `syncOrderFromMarketplace` + `toUnifiedOrder`

Split `toUnifiedOrder` so that:
- ID resolution (order + customer) happens first and can be used to call `persistIncomingSnapshot`
- Item resolution happens after, using `tryResolve` (non-throwing)
- If any unresolved → throw after snapshot is persisted

### 3.5 Database: migration

```sql
ALTER TABLE order_records ADD COLUMN record_status VARCHAR NOT NULL DEFAULT 'ready';
CREATE INDEX idx_order_records_record_status ON order_records (record_status);
```

Existing rows default to `'ready'`.

### 3.6 API: add `recordStatus` to list query + response

- `ListOrdersQueryDto`: add `recordStatus?: OrderRecordStatus`
- `OrderRecordResponseDto`: add `recordStatus: string`
- `OrdersController`: pass `recordStatus` to `findMany`

### 3.7 Frontend: `failed-orders-page.tsx`

Current: queries `useSyncJobsQuery({ status: 'dead', jobType: 'marketplace.order.sync' })`

New: query `useOrdersQuery({ recordStatus: 'awaiting_mapping' })` in addition (or replace entirely) so the page shows real order content (items, customer, totals from `orderSnapshot`) rather than just job error strings. Add a "Retry" action per order that re-queues the sync job by `sourceEventId`.

The page will show two conceptually different rows today: records that are `awaiting_mapping` (waiting for offer sync to catch up) and sync jobs that went `dead` for other reasons. For this issue scope, we surface `awaiting_mapping` records with their real content. Dead jobs remain accessible via `/sync-jobs` if needed.

---

## 4. Step-by-Step Implementation Plan

### Step 1 — Domain types

**File**: `libs/core/src/orders/domain/types/order-record.types.ts`

- Add `OrderRecordStatusValues` and `OrderRecordStatus` (as-const union).
- Add `recordStatus?: OrderRecordStatus` to `OrderRecordFilters`.

**Acceptance**: `OrderRecordStatus` is exported; existing tests pass.

---

### Step 2 — Domain entity

**File**: `libs/core/src/orders/domain/entities/order-record.entity.ts`

- Add `public readonly recordStatus: OrderRecordStatus` parameter to constructor (after `syncStatus`, before `createdAt`).

**Acceptance**: Entity compiles; existing instantiations updated.

---

### Step 3 — ORM entity + migration

**File**: `libs/core/src/orders/infrastructure/persistence/entities/order-record.orm-entity.ts`

- Add `@Column({ type: 'varchar', default: 'ready' }) recordStatus!: string;`

**File**: `apps/api/src/migrations/1783000000000-add-order-record-status.ts`

- `ALTER TABLE order_records ADD COLUMN record_status VARCHAR NOT NULL DEFAULT 'ready'`
- `CREATE INDEX idx_order_records_record_status ON order_records (record_status)`

**Acceptance**: Migration runs cleanly; schema matches ORM entity.

---

### Step 4 — Repository

**File**: `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`

- `toDomain`: map `entity.recordStatus` → `domain.recordStatus`
- `toOrm`: map `domain.recordStatus` → `entity.recordStatus`
- `findMany`: if `filters.recordStatus`, add `WHERE rec.record_status = :recordStatus` clause

**Acceptance**: Unit tests for `toDomain`/`toOrm` pass; filter works.

---

### Step 5 — `OrderItemRefResolverService`: add `tryResolve`

**File**: `libs/core/src/orders/application/services/order-item-ref-resolver.service.ts`

Add `ItemResolutionResult` type (in `order-item-ref-resolver.types.ts` or inline — it's application-layer-only).
Add `tryResolve(connectionId, productRef): Promise<ItemResolutionResult>` that wraps `resolve()` and catches `MissingOrderItemMappingError`.

**Acceptance**: New unit tests for `tryResolve` covering resolved and unresolved cases.

---

### Step 6 — `IOrderRecordService` + `OrderRecordService`: add `persistIncomingSnapshot`

**File**: `libs/core/src/orders/application/interfaces/order-record.service.interface.ts`

Add:
```typescript
persistIncomingSnapshot(
  incoming: IncomingOrder,
  internalOrderId: string,
  customerId: string | null,
  sourceConnectionId: string,
  sourceEventId: string | null,
): Promise<OrderRecord>;
```

**File**: `libs/core/src/orders/application/services/order-record.service.ts`

Implement: build snapshot from `IncomingOrder`, apply PII rules to addresses, set `recordStatus = 'awaiting_mapping'`, call `repository.upsert()`.

Also update `persistOrder` to explicitly set `recordStatus = 'ready'`.

**Acceptance**: `persistIncomingSnapshot` unit tests: snapshot shape, PII=off scrubs addresses, `recordStatus='awaiting_mapping'`. `persistOrder` sets `recordStatus='ready'`.

---

### Step 7 — `OrderIngestionService`: rework `syncOrderFromMarketplace`

**File**: `libs/core/src/orders/application/services/order-ingestion.service.ts`

New `syncOrderFromMarketplace` flow:
1. `marketplace.getOrder()`
2. Resolve `internalOrderId` (via `identifierMapping.getOrCreateInternalId`)
3. Resolve customer identity (existing logic)
4. **Call `orderRecordService.persistIncomingSnapshot(...)`** ← new, before item resolution
5. Resolve items via `orderItemRefResolver.tryResolve()` for each item
6. Collect `unresolvedRefs`
7. If `unresolvedRefs.length > 0`: throw `MissingOrderItemMappingError` (using first unresolved ref details)
8. Build unified `Order` from resolved items
9. `orderRecordService.persistOrder(order, ...)` — upserts with `recordStatus='ready'`
10. `orderSyncService.syncOrder(...)` + update sync statuses

Replace `toUnifiedOrder` with a private `buildUnifiedOrder(incoming, resolvedItems, internalOrderId, customerId): Order` method that handles the happy-path construction only (all items already resolved). This keeps `syncOrderFromMarketplace` readable and makes the resolved-order construction independently testable.

**Acceptance**: Unit tests covering:
- Happy path (all items resolve): `persistIncomingSnapshot` called, then `persistOrder` called with `recordStatus='ready'`
- Partial failure (one item unresolved): `persistIncomingSnapshot` called, `MissingOrderItemMappingError` thrown, `persistOrder` NOT called
- All items unresolved: same as partial failure

---

### Step 8 — API layer

**File**: `apps/api/src/orders/http/dto/list-orders-query.dto.ts`

- Add `@IsOptional() @IsEnum(OrderRecordStatusValues) recordStatus?: OrderRecordStatus`

**File**: `apps/api/src/orders/http/dto/order-record-response.dto.ts`

- Add `@ApiProperty() recordStatus!: string`

**File**: `apps/api/src/orders/http/orders.controller.ts`

- Extract `recordStatus` from query, pass to `findMany()`
- Include `recordStatus` in `toDto()` output

**Acceptance**: API returns `recordStatus` field; filter param is accepted.

---

### Step 9 — Frontend types + API client

**File**: `apps/web/src/features/orders/api/orders.types.ts`

- Add `recordStatus: string` to `OrderRecord`
- Add `recordStatus?: string` to `OrderFilters`

**File**: `apps/web/src/features/orders/api/orders.api.ts`

- Add `recordStatus` to `buildQuery`

**Acceptance**: Types compile.

---

### Step 10 — `failed-orders-page.tsx` — surface `awaiting_mapping` records

**File**: `apps/web/src/pages/orders/failed-orders-page.tsx`

Replace `useSyncJobsQuery` with `useOrdersQuery({ recordStatus: 'awaiting_mapping' })`.

Show columns:
- Order ID (`internalOrderId` truncated)
- Connection (`sourceConnectionId` truncated)
- Snapshot items count (from raw `orderSnapshot` — treat as opaque debug data, count `items` array length)
- First seen at (`createdAt`)

**Retry button — deferred to follow-up issue**: A `POST /orders/:internalOrderId/retry` endpoint requires a new `IOrderRetryService` interface method, module wiring, a job-enqueue implementation using `sourceConnectionId` + `sourceEventId`, error handling for missing records, and unit tests. This is out of scope for #235 to keep the change set focused. The retry button will be omitted in this issue; operators can use the existing `/sync-jobs` page to re-queue manually. A follow-up issue will add the retry endpoint and button.

**Acceptance**:
- Page shows order records with `recordStatus=awaiting_mapping`
- Shows order ID, connection, snapshot item count, and created-at date
- All four data-fetch states handled: loading → error → empty → data

---

### Step 11 — Tests

**Unit tests to add/update**:
- `order-item-ref-resolver.service.spec.ts`: `tryResolve` — resolved, unresolved (offer missing, variant missing)
- `order-record.service.spec.ts`: `persistIncomingSnapshot` — creates with `awaiting_mapping`; `persistOrder` sets `ready`
- `order-ingestion.service.spec.ts`: three new cases (happy, partial unresolved, all unresolved)
- `order-record.repository.spec.ts`: `findMany` with `recordStatus` filter; `findMany` without `recordStatus` returns all records (existing callers unaffected); `toDomain`/`toOrm` include `recordStatus`

---

## 5. Validation

### Architecture compliance ✅
- Domain entity change is framework-free
- Application services depend on ports, not infrastructure
- Repository maps domain ↔ ORM (no leakage)
- New `persistIncomingSnapshot` lives in application service, not domain

### Naming ✅
- `recordStatus` follows `camelCase` for domain, `record_status` for DB column
- New type `OrderRecordStatus` follows `PascalCase`
- `tryResolve` follows `camelCase` function naming

### Testing strategy ✅
- Unit tests for all changed services (no Docker)
- Existing integration tests should still pass (new column has a default)

### Security ✅
- No new user input injection surfaces (filter is enum-validated in DTO)
- PII rules still apply in `persistIncomingSnapshot`

### Migration risk ✅
- `DEFAULT 'ready'` ensures zero-downtime migration (existing rows unaffected)

### Open questions resolved
| Question | Decision |
|---|---|
| Where does unresolved state live? | `recordStatus` column on `order_records` — efficient querying; snapshot stores raw `IncomingOrder` items for debugging |
| Non-retryable after N attempts? | Out of scope; keep retryable |
| Ad-hoc offers sync trigger? | Out of scope |
| Orphan `customer_projections`? | Acceptable; not changed |
| What does `orderSnapshot` contain for `awaiting_mapping`? | Raw `IncomingOrder` JSON — items keep external offer refs, not internal IDs. Shape differs from `ready` records; document in `OrderRecordResponseDto` |
| Retry button on failed-orders page? | Deferred to follow-up issue; requires `IOrderRetryService`, module wiring, and tests out of scope for #235 |
