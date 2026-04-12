# Implementation Plan: Periodic Inventory Sync Scheduler (#136) & Allegro Command Status Polling (#102)

## Overview

**Issues**: #136, #102
**Branch**: `136-102-inventory-sync-allegro-polling`
**Classification**: CORE/Infrastructure (#136), Integration (#102)

### Goals

1. **#136**: Add a periodic scheduler that enqueues `master.inventory.syncAll` jobs for all active `InventoryMaster` connections, with overlap detection and configurable cron/feature-flag.
2. **#102**: After Allegro quantity update commands are submitted, poll for async command result status and persist the outcome.

### Non-Goals

- No new REST API endpoints
- No frontend changes
- No distributed locking (#136 uses job-queue idempotency for overlap)
- No retry of failed Allegro commands (#102 only detects and surfaces failures)

---

## Issue #136 — Periodic Inventory Sync Scheduler

### Design

The existing `SchedulerService` already supports registering arbitrary `SchedulerTaskConfig` entries with per-platform connection enumeration and idempotency-key-based dedup. We add a new task config for inventory sync.

However, `SchedulerService` currently filters by `platformType`. Inventory sync needs **all** active connections with `InventoryMaster` capability, which may span multiple platform types. Two options:

**Option A (chosen)**: Use `platformType: '*'` or add a `connectionFilter` callback to `SchedulerTaskConfig` that overrides the default platform-based filter. This keeps all scheduling logic in one place.

**Option B**: Create a separate `PeriodicInventorySyncScheduler` class as the issue suggests.

**Decision**: Option A — extend `SchedulerTaskConfig` with an optional `connectionFilter` to allow capability-based filtering. This is a small change that keeps the scheduler unified and avoids a parallel scheduling mechanism.

### New Job Type

Add `master.inventory.syncAll` to `JobTypeValues`. This job will be handled by a new `MasterInventorySyncAllHandler` that:
1. Receives `connectionId` from the enqueued job
2. Fetches all products with inventory for that connection (via `ProductMasterPort.getProducts()`)
3. For each product, enqueues a `master.inventory.syncByExternalId` job

This fan-out pattern keeps individual inventory sync jobs small and retryable.

### Steps

#### Step 1: Add `master.inventory.syncAll` job type
- **File**: `libs/core/src/sync/domain/types/sync-job.types.ts`
- **Change**: Add `'master.inventory.syncAll'` to `JobTypeValues`

#### Step 2: Extend `SchedulerTaskConfig` with optional `connectionFilter`
- **File**: `apps/api/src/sync/application/services/scheduler.service.ts`
- **Change**: Add optional `connectionFilter?: () => Promise<Connection[]>` to `SchedulerTaskConfig`
- In `executeTask()`, use `connectionFilter()` if provided, otherwise fall back to `connectionPort.list({ platformType, status: 'active' })`

#### Step 3: Register inventory sync scheduler task
- **File**: `apps/api/src/sync/application/services/scheduler.service.ts`
- **Change**: In `registerDefaultTasks()`, add a new task block:
  - `taskId`: `'master-inventory-sync'`
  - `platformType`: `'*'` (cosmetic, overridden by connectionFilter)
  - `jobType`: `'master.inventory.syncAll'`
  - `cronExpression`: from `OL_INVENTORY_SYNC_CRON` env (default `*/15 * * * *`)
  - `enabledEnvVar`: `'OL_INVENTORY_SYNC_ENABLED'`
  - `connectionFilter`: calls `IntegrationsService.listCapabilityAdapters({ capability: 'InventoryMaster' })` and maps to connections
  - `generatePayload`: `{ schemaVersion: 1 }`
  - `generateIdempotencyKey`: `master:${connectionId}:inventory:syncAll:${timestamp}`

#### Step 4: Inject `IIntegrationsService` into `SchedulerService`
- **File**: `apps/api/src/sync/application/services/scheduler.service.ts`
- **Change**: Add `@Inject(INTEGRATIONS_SERVICE_TOKEN) private readonly integrationsService: IIntegrationsService` to constructor
- **File**: `apps/api/src/sync/sync.module.ts`
- **Change**: Ensure `IntegrationsModule` is imported

#### Step 5a: Add `listByEntityTypeAndConnection` to identifier mapping repository
- **File**: `libs/core/src/identifier-mapping/domain/ports/identifier-mapping-repository.port.ts`
- **Change**: Add `listByEntityTypeAndConnection(entityType: EntityType, connectionId: string): Promise<IdentifierMapping[]>`
- **File**: `libs/core/src/identifier-mapping/infrastructure/persistence/repositories/identifier-mapping.repository.ts`
- **Change**: Implement the new method (simple `find` with `where: { entityType, connectionId }`)
- **File**: `libs/core/src/identifier-mapping/application/services/identifier-mapping.service.interface.ts`
- **Change**: Add `listExternalIdsByConnection(entityType: EntityType, connectionId: string): Promise<string[]>` 
- **File**: `libs/core/src/identifier-mapping/application/services/identifier-mapping.service.ts`
- **Change**: Implement — delegates to repo, maps results to `externalId[]`

#### Step 5b: Create `MasterInventorySyncAllHandler`
- **File**: `apps/worker/src/sync/handlers/master-inventory-sync-all.handler.ts` (new)
- **Pattern**: Follow existing handler pattern (implements `SyncJobHandler`)
- **Logic**:
  1. Call `identifierMappingService.listExternalIdsByConnection('Product', job.connectionId)` to get all known product external IDs for this connection
  2. For each external ID, enqueue `master.inventory.syncByExternalId` job with `{ schemaVersion: 1, externalId, objectType: 'Product' }`
  3. Use `Promise.allSettled()` for resilience
  4. Log summary: total, enqueued, skipped (already existing), failed

#### Step 6: Register handler
- **File**: `apps/worker/src/sync/handlers/handler-registration.service.ts`
- **Change**: Import and register `MasterInventorySyncAllHandler` for `'master.inventory.syncAll'`
- **File**: `apps/worker/src/sync/sync-worker.module.ts`
- **Change**: Add `MasterInventorySyncAllHandler` to providers

#### Step 7: Add env vars to example
- **File**: `apps/api/env.example`
- **Change**: Add `OL_INVENTORY_SYNC_ENABLED=true` and `OL_INVENTORY_SYNC_CRON=*/15 * * * *`

#### Step 8: Unit tests
- **File**: `apps/api/src/sync/application/services/__tests__/scheduler.service.spec.ts` (update existing or create)
  - Test: inventory sync task is registered when enabled
  - Test: inventory sync task is NOT registered when `OL_INVENTORY_SYNC_ENABLED=false`
  - Test: connectionFilter returns InventoryMaster connections
  - Test: idempotency key prevents double-enqueue within same minute
- **File**: `apps/worker/src/sync/handlers/__tests__/master-inventory-sync-all.handler.spec.ts` (new)
  - Test: enqueues `syncByExternalId` jobs for all products
  - Test: handles empty product list gracefully
  - Test: partial enqueue failures don't block others

---

## Issue #102 — Allegro Offer Quantity Command Status Polling

### Design

Allegro's quantity change commands are async. After `PUT /sale/offer-quantity-change-commands/{commandId}`, the actual result is available at `GET /sale/offer-quantity-change-commands/{commandId}`. The response includes a `status` field.

**Approach**: Add a `pollQuantityCommandStatus` method to the Allegro marketplace adapter. The existing `updateOfferQuantity` method will call this after submitting the command, with backoff polling until a terminal status is reached.

### Allegro Command Statuses

From Allegro API docs:
- `NEW` — command accepted, not yet processed
- `IN_PROGRESS` — processing
- `SUCCESS` — completed successfully  
- `FAIL` — failed (includes error details in `taskReport`)

### Steps

#### Step 1: Add Allegro response types
- **File**: `libs/integrations/allegro/src/infrastructure/types/allegro-quantity-command.types.ts` (new)
- **Content**: Type definitions for `GET /sale/offer-quantity-change-commands/{commandId}` response

```typescript
export interface AllegroQuantityChangeCommandStatusResponse {
  id: string;
  status: 'NEW' | 'IN_PROGRESS' | 'SUCCESS' | 'FAIL';
  taskReport?: {
    totalCount: number;
    successCount: number;
    failedCount: number;
    errors?: Array<{
      offerId: string;
      message: string;
    }>;
  };
}
```

#### Step 2: Add `pollQuantityCommandStatus` to Allegro adapter
- **File**: `libs/integrations/allegro/src/infrastructure/adapters/allegro-marketplace.adapter.ts`
- **Change**: Add private `pollQuantityCommandStatus(commandId: string): Promise<AllegroQuantityChangeCommandStatusResponse>` method
- **Logic**:
  1. Poll `GET /sale/offer-quantity-change-commands/${commandId}` 
  2. Retry with exponential backoff: initial 2s, max 30s, up to 5 attempts (configurable)
  3. Return on terminal status (`SUCCESS` or `FAIL`)
  4. On timeout (all attempts exhausted with still `NEW`/`IN_PROGRESS`): return last status

#### Step 3: Integrate polling into `updateOfferQuantity`
- **File**: `libs/integrations/allegro/src/infrastructure/adapters/allegro-marketplace.adapter.ts`
- **Change**: After the PUT call succeeds, call `pollQuantityCommandStatus(commandId)` 
- On `FAIL`: update command status in repository to `'failed'` with error, then throw
- On `SUCCESS`: update command status to `'accepted'`
- On timeout (still pending): update status to `'queued'`, log warning, do NOT throw (fire-and-forget for timeout case)

#### Step 4: Add `'succeeded'` status to command entity
- **File**: `libs/integrations/allegro/src/domain/entities/allegro-quantity-command.entity.ts`
- **Change**: Add `'succeeded'` to `AllegroQuantityCommandStatusValues` (currently missing — `accepted` was the closest but semantically different from confirmed success)

#### Step 5: Unit tests
- **File**: `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-marketplace-quantity-polling.spec.ts` (new)
  - Test: polling returns on SUCCESS — command status updated to `succeeded`
  - Test: polling returns on FAIL — command status updated to `failed` with error, method throws
  - Test: polling times out — command stays `queued`, warning logged, no throw
  - Test: HTTP errors during polling are handled gracefully (retry continues)

---

## Implementation Order

1. Step 1 (#136): Add job type `master.inventory.syncAll`
2. Steps 1-3 (#102): Allegro types, polling method, integration into adapter
3. Step 4 (#102): Add `succeeded` status to command entity
4. Steps 2-4 (#136): Extend scheduler, register task, inject integrations service
5. Steps 5-6 (#136): Create handler, register in worker
6. Step 7 (#136): Env vars
7. Steps 5 (#102) + Step 8 (#136): All unit tests

## Risks & Open Questions

1. **Allegro polling delay** — The 2s initial delay adds latency to quantity updates. Acceptable since updates are already async via the job queue.
2. **Large product catalogs** — `listExternalIdsByConnection` may return thousands of product IDs. The handler enqueues all sub-jobs at once with `Promise.allSettled`. For very large catalogs, batching could be added later.
3. **Identifier mapping completeness** — The `syncAll` handler only syncs products that already have identifier mappings (i.e., previously synced products). New products added directly in PrestaShop without a prior product sync won't be picked up. This is acceptable for the periodic safety-net use case.
