# Implementation Plan — #450: Retry a failed destination sync from the order detail page

## Goal

Operators must be able to retry a failed destination sync directly from the order detail page once the underlying root cause (e.g. inactive country in PrestaShop) has been fixed. Today the only retry path is through `/sync` → find the dead `marketplace.order.sync` job by id → click retry — opaque and not discoverable.

## Layer classification

- **CORE** — new application service `OrderDestinationRetryService` + interface, two new domain exceptions
- **Interface (BE)** — new endpoint on `OrdersController`
- **Frontend** — Retry button per failed sync-status row + mutation hook + toast
- **DX** — Side-bug fix in `OrderActivityTimeline` so the activity row no longer reads "in progress" for `failed` destinations

## Non-goals

- Not introducing a per-destination job type (`marketplace.order.destination-sync`) — re-enqueueing the existing source-side `marketplace.order.sync` is sufficient. Per #348, destination adapters' `createOrder` is idempotent for already-synced destinations, so re-running a fan-out is safe.
- Not changing automatic retry policy or backoff.
- Not re-running source-side ingestion via a separate "re-pull" affordance — destination retry is the case the issue describes.
- Not surfacing per-destination retry across the order list (bulk operation already covered by `/sync/jobs/retry-grouped`).

## Background — what already exists

- `marketplace.order.sync` worker handler (`apps/worker/src/sync/handlers/marketplace-order-sync.handler.ts`) — delegates to `OrderIngestionService.syncOrderFromSource` which re-fetches from the source, persists snapshot, then dispatches via `OrderSyncService.syncOrder` to **every** active `OrderProcessorManager` adapter (excluding the source connection).
- Per-destination success/failure is captured in `order_records.syncStatus` JSONB; `OrderRecordRepository.updateSyncStatus` writes one row per destination with `status: 'pending' | 'syncing' | 'synced' | 'failed'`.
- `JobEnqueuePort.enqueueJob` already enforces idempotency via `idempotencyKey`. `SyncJobRepository.createIfNotExistsByIdempotencyKey` returns the existing job if the key collides.
- `SyncJobRetryService.retryJob(id)` requeues a single dead job (used by `POST /sync/jobs/:id/retry`).
- The frontend already renders `failedDestinations` in an Alert + a Sync Status `DataTable` on the order detail page; no per-row action column exists.

## Design — pragmatic re-enqueue

When the operator clicks **Retry** on a failed destination row:

1. The FE calls `POST /orders/:internalOrderId/destinations/:connectionId/retry`.
2. The endpoint finds the `OrderRecord`. Returns `404` if missing.
3. Looks up the row in `syncStatus` for `:connectionId`. Returns `404` if no such destination row.
4. Validates that the destination row's status is `failed`. Returns `409` if `pending` / `syncing` / `synced` (nothing to retry, or already in flight).
5. **Flips the destination's sync-status row from `failed` → `pending` immediately** (claim-the-slot: this acts as the de-facto lock; a concurrent click reads `pending` at step 4 and 409s).
6. Constructs a fresh idempotency key: `marketplace:{sourceConnectionId}:order:{sourceEventId}:retry:{Date.now()}` so the queue's idempotency table does not collide with the original (now-dead) job.
7. Enqueues a new `marketplace.order.sync` job via `JobEnqueuePort.enqueueJob` with payload `{ schemaVersion: 1, externalOrderId, sourceEventId }` (read from the OrderRecord and the IdentifierMappingService).
8. **If enqueue fails, reverts the sync-status row back to `failed`** (with the original error preserved) so the operator can retry again.
9. Returns `202 Accepted` with `{ jobId, jobType: 'marketplace.order.sync', destinationConnectionId, internalOrderId }`.

When the worker picks up the job, it re-fans-out to every destination. Already-synced destinations stay synced (idempotent at the destination adapter level per #348); the previously-failed destination either succeeds → status flips to `synced`, or fails again → status flips back to `failed` with the new error message.

### Why claim-then-enqueue (not enqueue-then-claim)

Claiming the slot (status → `pending`) **before** enqueue closes the only realistic concurrent-click race: two operators (or a double-click) reading `failed` simultaneously and both enqueuing separate jobs. With the order reversed, the second click reads `pending` at step 4 and 409s. The narrow remaining race — two reads passing through step 4 within the same handler tick before either has written — is bounded by the request-handler concurrency model and acceptable for MVP; a true CAS update (`updateSyncStatusIf(fromStatus, toStatus)`) would close it absolutely, but it requires a new repository method and is not needed at current operator scale. Worth revisiting if multi-tenant operator concurrency becomes a real load pattern.

### Why a fresh idempotency key

The queue's idempotency table is not what protects against double-retry — the status-flip-as-lock above is. The original `marketplace:{conn}:order:{eventKey}` key would still match the now-dead job and short-circuit the new enqueue. The `:retry:{timestamp}` suffix is purely a way to bypass the historical key so we get a fresh `queued` row; it deliberately does not serve as a deduplication key for retries.

### Why mark `pending`, not `syncing`

`syncing` semantically means "worker has picked it up and is dispatching". The job is queued but not yet picked up at the moment we return 202. `pending` matches the existing semantic (`OrderIngestionService.persistOrder` sets the initial status to `pending`).

## Files

### CORE (libs/core/src/orders/)

| File | Action | Notes |
|---|---|---|
| `application/interfaces/order-destination-retry.service.interface.ts` | new | `IOrderDestinationRetryService.retry(input: { internalOrderId, destinationConnectionId }): Promise<{ jobId, jobType }>` |
| `application/services/order-destination-retry.service.ts` | new | `@Injectable` class implementing the interface; injects `ORDER_RECORD_REPOSITORY_TOKEN`, `ORDER_RECORD_SERVICE_TOKEN`, `JOB_ENQUEUE_TOKEN`, `IDENTIFIER_MAPPING_SERVICE_TOKEN`, plus `Logger` |
| `application/services/__tests__/order-destination-retry.service.spec.ts` | new | unit-test the four error branches + happy path |
| `domain/exceptions/order-destination-not-found.exception.ts` | new | thrown when no matching syncStatus row |
| `domain/exceptions/order-destination-not-retryable.exception.ts` | new | thrown when status is not `failed` |
| `domain/exceptions/missing-source-external-id.exception.ts` | new | thrown when `IdentifierMappingService.getExternalIds('Order', internalOrderId)` returns no entry for the OrderRecord's source connection — defensive guard against stale/inconsistent data |
| `orders.tokens.ts` | extend | add `ORDER_DESTINATION_RETRY_SERVICE_TOKEN` symbol |
| `orders.module.ts` | extend | register the new service + bind to its token |
| `index.ts` | extend | export interface + token + exceptions for API layer consumption |

### Interface — apps/api/src/orders/

| File | Action | Notes |
|---|---|---|
| `http/orders.controller.ts` | extend | add `@Post(':internalOrderId/destinations/:connectionId/retry')` returning 202; map domain exceptions to 404 / 409 |
| `http/dto/retry-order-destination-response.dto.ts` | new | `{ jobId: string; jobType: 'marketplace.order.sync'; destinationConnectionId: string; internalOrderId: string }` |
| `http/orders.controller.spec.ts` | extend | unit tests for 202 / 404 / 409 paths (mock the service) |

### Frontend — apps/web/src/

| File | Action | Notes |
|---|---|---|
| `features/orders/api/orders.api.ts` | extend | add `retryDestination(internalOrderId, connectionId)` method calling `POST /orders/:internalOrderId/destinations/:connectionId/retry` |
| `features/orders/api/orders.types.ts` | extend | add `RetryOrderDestinationResult` type |
| `features/orders/hooks/use-retry-order-destination-mutation.ts` | new | mutation hook; on success invalidate `ordersQueryKeys.detail(internalOrderId)` and toast success |
| `pages/orders/order-detail-page.tsx` | extend | add `Actions` column to `SYNC_COLUMNS` rendering a `<Button>` only for `failed` rows; pass mutation state down so the button can disable during in-flight |
| `features/orders/components/order-activity-timeline.tsx` | fix side bug | render time pill as the failure context (not "in progress") when status is `failed`; pending/syncing keeps "in progress" |
| `features/orders/components/order-activity-timeline.test.tsx` | extend | add a test for the failed-status case |
| `pages/orders/order-detail-page.test.tsx` | new (small) | covers Retry button visibility (only `failed` rows) + click triggers mutation |

## Step-by-step

### Step 1 — domain exceptions + service interface
- Write the two exception classes (`OrderDestinationNotFoundException`, `OrderDestinationNotRetryableException`) in `domain/exceptions/` following the project's existing exception conventions (extend `Error`, capture stack trace).
- Write `IOrderDestinationRetryService` interface in `application/interfaces/`.
- **AC**: typecheck passes; interface and exception names match naming conventions.

### Step 2 — implement the service
- Implement `OrderDestinationRetryService` in `application/services/`.
- Logic (claim-then-enqueue ordering):
  1. `orderRecordRepository.findById(internalOrderId)` → throw `OrderRecordNotFoundException` if null.
  2. Find the destination's syncStatus row → throw `OrderDestinationNotFoundException` if missing.
  3. Validate `status === 'failed'` → throw `OrderDestinationNotRetryableException` with the current status if not.
  4. Resolve `externalOrderId` via `IdentifierMappingService.getExternalIds('Order', internalOrderId)` filtered to the entry whose `connectionId` matches the OrderRecord's `sourceConnectionId`. If no such entry exists, throw `MissingSourceExternalIdException`.
  5. **Claim the slot**: call `orderRecordService.updateSyncStatus(internalOrderId, destinationConnectionId, { destinationConnectionId, status: 'pending' })`. From here on, a concurrent click sees `pending` and 409s.
  6. Build a fresh idempotency key `marketplace:{sourceConnectionId}:order:{sourceEventId}:retry:{Date.now()}`.
  7. Try `JobEnqueuePort.enqueueJob({ jobType: 'marketplace.order.sync', connectionId: sourceConnectionId, payload, idempotencyKey })`.
  8. **On enqueue failure**: revert the status row back to `failed` with the original error preserved (read from the syncStatus snapshot taken at step 2), then re-throw. The operator must be able to retry again.
  9. Return `{ jobId, jobType: 'marketplace.order.sync' }`.
- **AC**: each branch logs an appropriate `log` / `warn` line, and the revert-on-enqueue-failure path is unit-tested.

### Step 3 — service unit tests
- Cover: happy path (claim + enqueue + return), order-not-found, destination-not-found, status-pending → 409, status-syncing → 409, status-synced → 409, missing source external id (`MissingSourceExternalIdException`), enqueue failure (status reverted to `failed` with original error preserved, then re-throw).
- **AC**: all branches pass; ports are mocked, no real adapters; the revert-on-enqueue-failure path explicitly asserts both the second `updateSyncStatus` call and the original error string is preserved.

### Step 4 — register the service in the core module
- Add the token symbol, register provider in `OrdersModule`, export from `index.ts`.
- **AC**: `pnpm --filter @openlinker/core build` passes if applicable; service is resolvable.

### Step 5 — controller endpoint
- Extend `OrdersController` with `retryDestination` method.
- Inject the new service via the new token.
- Use `ParseUUIDPipe` on `:connectionId` (UUID per `Connection.id`); leave `:internalOrderId` as a plain string param (internal IDs are `ol_order_{uuid}` TEXT, not UUID).
- Map exceptions to HTTP status codes:
  - `OrderRecordNotFoundException` → 404
  - `OrderDestinationNotFoundException` → 404
  - `OrderDestinationNotRetryableException` → 409
  - `MissingSourceExternalIdException` → 500 (this is data inconsistency, not a normal user error)
- Return DTO with 202 status.
- Add Swagger decorators consistent with the rest of the file.
- **AC**: the existing controller spec still passes; new spec covers all branches.

### Step 6 — controller unit tests
- Mock `IOrderDestinationRetryService`; assert the controller calls `retry()` with the right arguments and shapes the response.
- Assert exception → status mapping.

### Step 7 — frontend API + types + hook
- Extend `OrdersApi` with `retryDestination`. POST with empty body, returns the DTO.
- Add `RetryOrderDestinationResult` type to `orders.types.ts`.
- Write `useRetryOrderDestinationMutation` hook in `hooks/`. Invalidate `ordersQueryKeys.detail(internalOrderId)` on success.
- **AC**: `pnpm --filter @openlinker/web type-check` passes.

### Step 8 — order detail page Retry button
- Extend `SYNC_COLUMNS` with a new `actions` column rendering a `<Button>` only for `failed` rows. Other rows render a small `<EmptyValue />` or nothing.
- Wire the click handler to `useRetryOrderDestinationMutation`; disable while pending; toast success/error.
- **AC**: button only visible on `failed` rows; clicking flips the row to `pending` after the mutation settles via query invalidation.

### Step 9 — fix the activity timeline side bug
- In `OrderActivityTimeline.tsx`, change the time-pill render so events with `tone === 'error'` and no real timestamp show nothing (or "—") instead of "in progress". The dot tone is already `error` and the title verb already says "failed to sync to {destination}" — the time pill is the only piece that lies. Branching on `tone === 'error'` keeps the timeline component self-contained without threading the raw OrderSyncStatusValue through.
- Update the existing test to cover this case.

### Step 10 — page-level test
- A small test asserting:
  - Retry button is rendered for failed rows only.
  - Clicking it calls the mutation with `(internalOrderId, destinationConnectionId)`.

### Step 11 — integration test (vertical slice)
- New `apps/api/test/integration/order-destination-retry.int-spec.ts` against the standard Testcontainers harness.
- Covers:
  - **202 happy path**: seed an OrderRecord with one `failed` destination row + an identifier mapping for the source external id; POST the endpoint; assert 202 + new `marketplace.order.sync` row in `sync_jobs` (status `queued`) + the destination's `syncStatus` flipped to `pending`.
  - **409 path**: seed an OrderRecord with the destination row in `synced`; POST → expect 409 + no new sync_jobs row + status unchanged.
  - **404 path**: post against an unknown internalOrderId → expect 404.
- **AC**: runs under `pnpm test:integration` against real Postgres + Redis; verifies wiring (token resolution, JSONB upsert, idempotency-key insertion).

### Step 12 — quality gate + self-review
- Run `pnpm lint && pnpm type-check && pnpm test`.
- Self-review using `docs/code-review-guide.md`. Fix BLOCKING / IMPORTANT before commit.

## Validation

- **Hexagonal layering**: new service is in `application/services/` and depends only on ports + the existing record service. Domain exceptions are in `domain/exceptions/`. No framework leak into `domain/`.
- **Naming**: `*.service.interface.ts` + `*.service.ts` for the new service; `*.exception.ts` for new exceptions; `*-response.dto.ts` for the controller DTO.
- **Repository ports pattern**: not adding a new repository port — reusing `OrderRecordRepositoryPort` and `OrderRecordService` plus the existing `JobEnqueuePort` + `IdentifierMappingService`. No new repo lookup is needed.
- **Idempotency**: fresh `:retry:{timestamp}` key. Concurrent clicks within the same millisecond would both enqueue, but the optimistic `pending` flip after the first enqueue causes the second request to 409.
- **Security**: endpoint already covered by the controller-level `@Roles('admin')` decorator. No new auth surface.
- **No migration**: no schema changes.
- **Tests**: unit tests on new service, controller test for new endpoint, page-level FE test for button visibility/click, timeline test for the side-bug fix.

## Risk + open questions

1. **Re-enqueueing fans out to all destinations.** Successful destinations should be no-ops because of #348 idempotency at the destination adapter level. If a future destination adapter is *not* idempotent on `createOrder`, its row could flip from `synced` back to `failed` due to a duplicate-create error. Today only PrestaShop's `OrderProcessorAdapter` exists and #348 has already wired in idempotency for it. If a future destination adapter is non-idempotent, that's a defect in the adapter, not in this retry plumbing.
2. **Concurrent retries across multiple destinations of the same order.** Two operators clicking Retry on two different failed destinations of the same order each produce a fresh `marketplace.order.sync` job. Both jobs re-fan-out to all destinations, doubling work. With #348 idempotency this is functionally safe — successful destinations stay synced — but it doubles outbound HTTP traffic to the destination. Acceptable for MVP; if it becomes a problem we can serialize by checking for any in-flight `marketplace.order.sync` job for this order's source before enqueuing.
3. **The original dead job stays in the `dead` table.** That's fine — `/sync` already shows it for forensic context, and the new retry produces a separate job with its own audit trail.
4. **Single-destination claim race (narrow).** Two clicks on the *same* destination within the same handler tick can both pass step 4 before either has written `pending`. The claim-then-enqueue ordering closes the wide window; this narrow tick-level window remains. Closing it requires a CAS update method on the repository (`updateSyncStatusIf(fromStatus, toStatus)`) which is out of scope for this PR. Worth revisiting if real-world operator concurrency surfaces it.
