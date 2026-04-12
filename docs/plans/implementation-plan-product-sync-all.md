# Implementation Plan — `master.product.syncAll` (Issue #169)

## Goal

Add initial-catalog-discovery path so a fresh PrestaShop connection automatically
populates OpenLinker's product catalog. Today there is no code path that enumerates
a source platform's products — `master.inventory.syncAll` only iterates rows that
already exist in `identifier_mappings`, and `master.product.syncByExternalId`
requires the caller to already know the external ID. Clean installs have no way
to bootstrap products.

## Classification

- **CORE / Application + Infrastructure** — new port method, new job type and payload
- **Worker** — new sync handler (fan-out)
- **API** — scheduler task + auto-trigger on connection create + existing `POST /sync/jobs` for manual button
- **Frontend** — "Sync products now" button on connection detail page

## Non-goals

- No changes to `master.product.syncByExternalId` handler (existing, unchanged)
- No Jobs & Logs batch-grouping UI (separate follow-up if needed)
- No PrestaShop category discovery (separate feature)

## Design

Pipeline end-to-end:

```
POST /connections  (API: ConnectionService.create)
  → save connection
  → if adapter supports ProductMaster: enqueue master.product.syncAll
       idempotencyKey='bootstrap:{connectionId}:product:syncAll'  (stable, once per connection)

cron (API: SchedulerService, OL_PRODUCT_SYNC_CRON, default */20 * * * *)
  → for each active ProductMaster-capable connection: enqueue master.product.syncAll
       idempotencyKey='master:{connectionId}:product:syncAll:{minute-timestamp}'

manual "Sync now" (Web: connection detail → POST /sync/jobs)
  → idempotencyKey='manual:{connectionId}:product:syncAll:{Date.now()}'

worker consumes master.product.syncAll:
  MasterProductSyncAllHandler:
    1. resolve ProductMasterPort for connection via IntegrationsService
    2. paginate: loop ProductMasterPort.listExternalIds({limit, offset})
    3. for each externalId: enqueue master.product.syncByExternalId
         idempotencyKey='master:{connectionId}:product:sync:{externalId}:{outerJobId}'
    4. Promise.allSettled — individual enqueue failures logged, not fatal
    5. enumeration failure (DB / upstream API) bubbles up as SyncJobExecutionError

worker consumes master.product.syncByExternalId (existing):
  → syncs one product, creates mapping + projection
```

Why a new port method `listExternalIds` rather than reusing `getProducts`:
`getProducts` already performs identifier mapping creation internally and returns
Products keyed by internal ID — the external key is discarded. The fan-out handler
needs external IDs verbatim to build the per-product sub-job payloads. Adding a
dedicated enumeration method keeps responsibilities clean and leaves the expensive
mapping creation work to the downstream `syncByExternalId` handler where it belongs.

## Steps

1. **`libs/core/src/sync/domain/types/sync-job.types.ts`** — add `'master.product.syncAll'` to `JobTypeValues`.
2. **`libs/core/src/sync/domain/types/master-job-payloads.types.ts`** — add `MasterProductSyncAllPayloadV1 { schemaVersion: 1 }`.
3. **`libs/core/src/sync/index.ts`** — export new payload type.
4. **`libs/core/src/products/domain/ports/product-master.port.ts`** — add
   `listExternalIds(filters?: { limit?: number; offset?: number }): Promise<string[]>`.
5. **`libs/integrations/prestashop/src/infrastructure/adapters/prestashop-product-master.adapter.ts`** —
   implement `listExternalIds` using `httpClient.listResources('products', { display: ['id'] }, limit, offset)`
   (note: uses PS webservice `display` filter to fetch only IDs, avoiding full product payload).
6. **`apps/worker/src/sync/handlers/master-product-sync-all.handler.ts`** — new handler,
   injects `IIntegrationsService` + `JobEnqueuePort`, paginates `listExternalIds`,
   fan-out enqueues per-product sub-jobs.
7. **`apps/worker/src/sync/sync-worker.module.ts`** — register provider.
8. **`apps/worker/src/sync/handlers/handler-registration.service.ts`** — register under `'master.product.syncAll'`.
9. **`apps/api/src/sync/application/services/scheduler.service.ts`** — `registerProductSyncTask()`
   mirroring inventory; env `OL_PRODUCT_SYNC_ENABLED` (default true), `OL_PRODUCT_SYNC_CRON` (default `*/20 * * * *`),
   capability filter `ProductMaster`.
10. **`apps/api/src/integrations/application/services/connection.service.ts`** — inject
    `JobEnqueuePort` and `IIntegrationsService`; after `connectionPort.create`, best-effort
    enqueue `master.product.syncAll` with stable bootstrap key when the adapter supports
    `ProductMaster`. Failure to enqueue must NOT fail connection creation — log and swallow.
11. **`apps/api/src/integrations/integrations.module.ts`** — no change needed (SyncModule + CoreIntegrationsModule already imported).
12. **Frontend** — `apps/web/src/pages/connections/connection-detail-page.tsx` (or existing
    connection detail): add "Sync products now" button gated on `ProductMaster` capability
    (reuses existing `useEnqueueSyncJobMutation`). Toast + invalidate sync jobs query on success.
13. **Tests**:
    - `apps/worker/src/sync/handlers/__tests__/master-product-sync-all.handler.spec.ts` — fan-out,
      empty list, partial failure, enumeration failure, pagination loop terminates.
    - `apps/api/src/integrations/application/services/connection.service.spec.ts` — auto-trigger
      enqueues when capability present; no-throw when enqueue fails; skipped when no adapter.
    - PrestaShop adapter test for `listExternalIds` (paginated fetch).
14. **`apps/api/.env.example`** — document `OL_PRODUCT_SYNC_ENABLED`, `OL_PRODUCT_SYNC_CRON`, `OL_PRODUCT_SYNC_PAGE_SIZE`.
15. **`docs/getting-started.md`** — update §5 with new one-shot auto-bootstrap + manual button.

## Validation

- Hexagonal boundaries: new port method lives in `libs/core/src/products/domain/ports`; impl in
  `libs/integrations/prestashop/.../adapters`. Handler resolves adapter via `IntegrationsService`,
  never imports PrestaShop directly.
- Types in `*.types.ts`. No `any`. No `console.log`. JobType added to `as const` union.
- Idempotency: bootstrap key stable (one-shot per connection); recurring key time-salted per
  minute (natural dedupe on same-minute cron overlap); sub-job key derived from outer job id
  (retry safe).
- Tests mock ports only.
