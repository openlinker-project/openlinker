# Implementation Plan: Retry & Remediation APIs (#72) + Failed Order Diagnostics Page (#137)

## Overview

**Goal**: Add backend retry/remediation endpoints for dead sync jobs, then build a frontend "Failed Orders" page that surfaces dead order-sync jobs with inline retry capability.

**Layers**: Interface (BE controller + FE page), Application (retry service), Infrastructure (repository method)

**Non-goals**:
- Payload editing before retry (future remediation)
- Batch retry across all job types (scope to order jobs initially, but build generic)
- Audit trail / remediation history logging (defer)

---

## Architecture

### Data Flow

```
FE: FailedOrdersPage
  → useFailedOrderJobsQuery (GET /sync/jobs?status=dead&jobType=marketplace.order.sync)
  → useRetrySyncJobMutation (POST /sync/jobs/:id/retry)
      ↓
BE: SyncController
  → POST /sync/jobs/:id/retry
  → SyncJobRetryService.retryJob(id)
      → SyncJobRepository.requeueDeadJob(id) — resets status=queued, attempts=0
      ↓
  Worker picks up requeued job normally
```

### Key Design Decisions

1. **Retry = requeue the existing DB row** (reset to `queued`, `attempts=0`). No new Redis stream message needed — the runner polls DB directly via `findAndLockDueJobs`.
2. **Generic retry endpoint** — `POST /sync/jobs/:id/retry` works for any dead job, not just orders. The FE filters to order jobs.
3. **No new idempotency key** — the existing idempotency dedup key in Redis has a 7-day TTL. We clear it on retry to allow re-enqueue if needed, but since we requeue in-place in DB, this is handled at DB level only.
4. **Safety**: Only `dead` jobs can be retried. Retrying `queued`/`running`/`succeeded` returns 409 Conflict.

---

## Step-by-Step Plan

### Step 1: Add `requeueDeadJob` to repository port and implementation

**Files:**
- `libs/core/src/sync/domain/ports/sync-job-repository.port.ts` — add method to port
- `libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.ts` — implement

**Method signature:**
```typescript
requeueDeadJob(id: string): Promise<SyncJob>;
```

**Implementation:**
- Find job by ID, verify `status === 'dead'`
- If not dead → throw `InvalidSyncJobStateError`
- Update: `status='queued'`, `attempts=0`, `nextRunAt=now()`, `lockedAt=null`, `lockedBy=null`, `lastError` preserved (for history)
- Return updated domain entity

**Acceptance:**
- Unit test: requeue dead job succeeds
- Unit test: requeue non-dead job throws

---

### Step 2: Add retry service (application layer)

**Files:**
- `libs/core/src/sync/application/services/sync-job-retry.service.interface.ts` — interface
- `libs/core/src/sync/application/services/sync-job-retry.service.ts` — implementation

**Interface:**
```typescript
export interface ISyncJobRetryService {
  retryJob(id: string): Promise<SyncJob>;
}
```

**Implementation:**
- Inject `SyncJobRepositoryPort`
- Call `requeueDeadJob(id)`
- Log retry action with `jobId`, `jobType`, `connectionId`

**Why a service?** Keeps controller thin, allows adding pre-retry validation / audit logging later.

**Acceptance:**
- Unit test: delegates to repository, logs

---

### Step 3: Add `POST /sync/jobs/:id/retry` endpoint

**Files:**
- `apps/api/src/sync/http/sync.controller.ts` — add endpoint
- `apps/api/src/sync/http/dto/retry-sync-job-response.dto.ts` — response DTO

**Endpoint:**
```
POST /sync/jobs/:id/retry
@Roles('admin')
Response: SyncJobResponseDto (existing DTO reused)
Errors: 404 (not found), 409 (not in dead state)
```

**Controller logic:**
- Call `retryService.retryJob(id)`
- Catch `InvalidSyncJobStateError` → 409 Conflict
- Catch not-found → 404

**Wire up:** Register `SyncJobRetryService` in API sync module, inject into controller.

**Acceptance:**
- Endpoint returns updated job with `status: 'queued'`
- 409 on non-dead job
- 404 on missing job

---

### Step 4: Export retry service token and update modules

**Files:**
- `libs/core/src/sync/sync.tokens.ts` — add `SYNC_JOB_RETRY_SERVICE_TOKEN`
- `libs/core/src/sync/sync.module.ts` — register provider
- `apps/api/src/sync/sync.module.ts` — import and inject
- `libs/core/src/sync/index.ts` — export new symbols

---

### Step 5: Add `retry` method to FE sync jobs API

**Files:**
- `apps/web/src/features/sync-jobs/api/sync.api.ts` — add `retry(id)` method to `SyncJobsApi`

**Method:**
```typescript
retry(id: string): Promise<SyncJob> {
  return request<SyncJob>(`/sync/jobs/${id}/retry`, { method: 'POST' });
}
```

---

### Step 6: Add `useRetrySyncJobMutation` hook

**Files:**
- `apps/web/src/features/sync-jobs/hooks/use-retry-sync-job-mutation.ts`

**Pattern:**
```typescript
export function useRetrySyncJobMutation() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.syncJobs.retry(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: syncQueryKeys.all }),
  });
}
```

---

### Step 7: Create Failed Orders page

**Files:**
- `apps/web/src/pages/orders/failed-orders-page.tsx`

**Content:**
- `PageLayout` with eyebrow "Orders", title "Failed Orders"
- Filter bar: connection filter (Select), job type locked to order types
- Uses `useSyncJobsQuery({ status: 'dead', jobType: 'marketplace.order.sync' })` — reuses existing hook with filters
- `DataTable` with columns: Job ID (mono), Connection, Failed At, Error (truncated), Attempts, Retry button
- Retry button uses `useRetrySyncJobMutation`, shows loading state per-row
- Pagination (offset-based, 25/page)
- Empty state: "No failed orders in the selected period"
- Error row expand: full error message in a `<details>` element (no drawer needed for MVP)

**State:**
- Filters in URL search params (connectionId, offset)
- Retry state per-row via mutation `variables` tracking

---

### Step 8: Add route and navigation

**Files:**
- `apps/web/src/app/routes/orders.route.tsx` — add `failed` child route
- Navigation: add link from orders list page to failed orders

**Route:**
```typescript
{ path: 'failed', element: <FailedOrdersPage /> }
```

---

### Step 9: Add tests

**BE tests:**
- `libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.spec.ts` — unit test for `requeueDeadJob`
- `libs/core/src/sync/application/services/sync-job-retry.service.spec.ts` — unit test for retry service

**FE tests:**
- `apps/web/src/pages/orders/failed-orders-page.test.tsx` — render with data, empty state, retry success, retry error

---

## Risk & Open Questions

1. **Idempotency key collision**: After retry, the old idempotency key remains. If the job was originally enqueued via Redis streams, the dedup key may still exist (7-day TTL). This is fine because retry works at DB level, not re-enqueuing to streams.
2. **Concurrent retry**: Two admins clicking retry on the same job. The `requeueDeadJob` method should handle this gracefully — if status is already `queued` on second call, return 409.
3. **Scope**: The page shows dead `marketplace.order.sync` jobs. Other job types could be surfaced later by removing the filter.
