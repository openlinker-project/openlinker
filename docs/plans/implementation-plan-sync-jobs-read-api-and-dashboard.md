# Implementation Plan: Sync Jobs Read API + Dashboard

**Date**: 2026-04-06
**Status**: Ready for Review
**Estimated Effort**: 4–6 hours
**Issues**: [#70](https://github.com/openlinker-project/openlinker/issues/70) (BE) · [#71](https://github.com/openlinker-project/openlinker/issues/71) (FE)
**Branch**: `70-71-sync-jobs-read-api-and-dashboard`

---

## 1. Task Summary

**Objective**: Add `GET /sync/jobs` and `GET /sync/jobs/:id` REST endpoints that expose sync job state to the frontend, then build the sync jobs dashboard page that consumes those endpoints.

**Context**: The backend has a full sync job persistence layer (`sync_jobs` table, `SyncJobRepository`, `SyncJobRepositoryPort`) but exposes only `POST /sync/jobs` for enqueuing. Operators have no visibility into job status, failure reasons, or retry state. The frontend route (`/jobs-logs`) exists as a placeholder.

**Classification**: CORE / Infrastructure (BE repository) · Interface (API controller + DTOs) · Frontend Feature

---

## 2. Scope & Non-Goals

### In Scope
- Two new repository port methods: `findMany` (filtered, paginated list) and `findById`
- Two new controller endpoints: `GET /sync/jobs` and `GET /sync/jobs/:id`
- Request/response DTOs with Swagger docs
- Frontend types, API client methods, React Query hooks
- Sync jobs list page at `/jobs-logs` with status/type/connection filters and pagination
- Sync job detail page at `/jobs-logs/:id` with all fields and failure display
- Unit tests for new repository methods and new controller endpoints
- Unit tests for new FE hooks

### Out of Scope
- Retry/requeue actions from the UI (tracked in #72)
- Real-time streaming / WebSocket updates
- Adding a DB index on `connectionId` or `createdAt` (noted as follow-up performance item)
- Cursor-based pagination (offset is sufficient for MVP scale)

### Constraints
- All new endpoints are `@Roles('admin')` — no new auth surface
- `payloadJson` is included in the detail response (admin-only, useful for debugging)
- `lockedBy` / `lockedAt` are included only in the detail response

---

## 3. Architecture Mapping

**Target Layers**:
- `libs/core/src/sync/` — domain port extension + repository implementation (CORE / Infrastructure)
- `apps/api/src/sync/` — controller + DTOs (Interface layer)
- `apps/web/src/features/sync-jobs/` — API client, types, query keys, hooks (FE Feature)
- `apps/web/src/pages/sync-jobs/` — page components (FE Pages)
- `apps/web/src/app/routes/` — route wiring (FE App)

**Existing Ports Reused**:
- `SyncJobRepositoryPort` — extended with two read methods (no new port)
- `SYNC_JOB_REPOSITORY_TOKEN` — already exported from `CoreSyncModule`, injected directly into controller (same pattern as `JOB_ENQUEUE_TOKEN`)

**New Components**:
- `SyncJobFilters` + `SyncJobPagination` types in domain types
- `findMany` + `findById` on `SyncJobRepositoryPort` + `SyncJobRepository`
- 3 new API DTOs
- 2 new controller methods
- FE: `sync-jobs.types.ts`, extended `sync.api.ts`, extended `sync.query-keys.ts`, 2 hooks, 2 pages, 2 components

**Core vs Integration**: Change is entirely in CORE (persistence layer) and Interface (API). No integration adapters touched.

---

## 4. External / Domain Research

No external systems involved.

### Internal Patterns
- **Repository read pattern**: `findMany` uses TypeORM `findAndCount` with dynamic `where`, `order: { createdAt: 'DESC' }`, `take`/`skip`. Returns `{ items: SyncJob[]; total: number }`.
- **Controller injection**: `SyncController` already injects `JOB_ENQUEUE_TOKEN` — inject `SYNC_JOB_REPOSITORY_TOKEN` the same way for reads.
- **FE API client**: `createConnectionsApi(request)` factory pattern — replicate exactly in `createSyncJobsApi`.
- **FE Query hooks**: `useConnectionsQuery` pattern — `useQuery` with `apiClient.syncJobs.list(filters)`.
- **FE types**: Separate `*.types.ts` file with `as const` arrays for status/type values.
- **FE status badge**: `StatusBadge` from `shared/ui` — map job status to `StatusBadgeTone`.

---

## 5. Questions & Assumptions

### Assumptions
1. **Offset pagination** is sufficient at current `sync_jobs` table size. Cursor pagination not needed for MVP.
2. **`payloadJson` included in detail only** — list response excludes it to keep payloads small; detail response includes it.
3. **`lockedBy`/`lockedAt` detail-only** — not operator-relevant in list view.
4. **Default sort**: `createdAt DESC` (most recent first) — operators want to see latest jobs.
5. **Default page size**: 20 jobs, max 100.
6. **`status: 'failed'`** in the API means `status = 'queued'` with `attempts > 0` and `lastError IS NOT NULL` in the DB (the repository uses `queued` to re-enqueue failed jobs). To avoid confusing operators, the API presents `queued` + `lastError` as `'failed'` visually on the FE. The backend `status` field is returned as-is; the FE derives the display state.

   **Actually**: After reading the repository, `markFailed` re-sets status to `'queued'` for retry. So from the DB there is no persistent `'failed'` status for retryable jobs — `'failed'` and `'dead'` are both terminal states only (`markDead` sets `status = 'dead'`). A job actively retrying shows as `'queued'` with `attempts > 0`. The FE should show `attempts` to communicate retry context.

7. **No new DB migration needed** — no schema changes.

### Open Questions
- None — all ambiguities resolved above.

---

## 6. Proposed Implementation Plan

### Phase 1 — Backend: Domain Types + Repository Port

**Goal**: Extend the domain contract to support read queries.

#### Step 1 — Add filter/pagination types to `sync-job.types.ts`

**File**: `libs/core/src/sync/domain/types/sync-job.types.ts`

Add at the end of the existing file:

```typescript
export interface SyncJobFilters {
  status?: JobStatus;
  connectionId?: string;
  jobType?: JobType;
}

export interface SyncJobPagination {
  limit: number;   // 1–100
  offset: number;  // >= 0
}

export interface PaginatedSyncJobs {
  items: SyncJob[];
  total: number;
}
```

**Acceptance**: Types compile, no `any`.

---

#### Step 2 — Extend `SyncJobRepositoryPort` with read methods

**File**: `libs/core/src/sync/domain/ports/sync-job-repository.port.ts`

Add two methods to the interface:

```typescript
/**
 * Find jobs matching filters with pagination.
 * Results ordered by createdAt DESC.
 */
findMany(
  filters: SyncJobFilters,
  pagination: SyncJobPagination,
): Promise<PaginatedSyncJobs>;

/**
 * Find a single job by ID. Returns null if not found.
 */
findById(id: string): Promise<SyncJob | null>;
```

**Acceptance**: Interface compiles; `SyncJobRepository` will need to implement the new methods (next step).

---

### Phase 2 — Backend: Repository Implementation

**Goal**: Implement the new port methods in the infrastructure repository.

#### Step 3 — Implement `findMany` and `findById` in `SyncJobRepository`

**File**: `libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.ts`

`findById`:
```typescript
async findById(id: string): Promise<SyncJob | null> {
  const entity = await this.repository.findOne({ where: { id } });
  return entity ? this.toDomain(entity) : null;
}
```

`findMany`:
```typescript
async findMany(
  filters: SyncJobFilters,
  pagination: SyncJobPagination,
): Promise<PaginatedSyncJobs> {
  const where: Record<string, unknown> = {};
  if (filters.status) where['status'] = filters.status;
  if (filters.connectionId) where['connectionId'] = filters.connectionId;
  if (filters.jobType) where['jobType'] = filters.jobType;

  const [entities, total] = await this.repository.findAndCount({
    where,
    order: { createdAt: 'DESC' },
    take: pagination.limit,
    skip: pagination.offset,
  });

  return {
    items: entities.map((e) => this.toDomain(e)),
    total,
  };
}
```

**Acceptance**: Unit test (mock TypeORM `Repository`) passes for filtered list, empty list, and single-item results.

---

#### Step 4 — Unit test for repository read methods

**File**: `libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.spec.ts` (new)

Test cases:
- `findById` returns domain entity when found
- `findById` returns null when not found
- `findMany` returns paginated items and total
- `findMany` applies status filter correctly
- `findMany` returns empty items and `total: 0` when no match

**Acceptance**: All tests green with `pnpm test`.

---

### Phase 3 — Backend: API Layer

**Goal**: Expose the read queries as REST endpoints with Swagger docs.

#### Step 5 — `ListSyncJobsQueryDto`

**File**: `apps/api/src/sync/http/dto/list-sync-jobs-query.dto.ts` (new)

```typescript
import { IsEnum, IsOptional, IsUUID, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { JobStatusValues, JobStatus, JobTypeValues, JobType } from '@openlinker/core/sync';

export class ListSyncJobsQueryDto {
  @ApiPropertyOptional({ enum: JobStatusValues })
  @IsOptional()
  @IsEnum(JobStatusValues)
  status?: JobStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  connectionId?: string;

  @ApiPropertyOptional({ enum: JobTypeValues })
  @IsOptional()
  @IsEnum(JobTypeValues)
  jobType?: JobType;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
```

**Acceptance**: DTO validates correctly; invalid enum values rejected.

---

#### Step 6 — `SyncJobResponseDto`

**File**: `apps/api/src/sync/http/dto/sync-job-response.dto.ts` (new)

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JobStatusValues, JobTypeValues } from '@openlinker/core/sync';

export class SyncJobResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: JobTypeValues }) jobType: string;
  @ApiProperty() connectionId: string;
  @ApiProperty({ enum: JobStatusValues }) status: string;
  @ApiProperty() attempts: number;
  @ApiProperty() maxAttempts: number;
  @ApiProperty() nextRunAt: string;
  @ApiPropertyOptional({ nullable: true }) lastError: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
  // Detail-only fields (null in list responses)
  @ApiPropertyOptional({ nullable: true }) payloadJson: Record<string, unknown> | null;
  @ApiPropertyOptional({ nullable: true }) lockedAt: string | null;
  @ApiPropertyOptional({ nullable: true }) lockedBy: string | null;
  @ApiPropertyOptional({ nullable: true }) idempotencyKey: string | null;
}
```

> **Note**: All fields are included in both list and detail responses for simplicity. The FE list view renders a subset; the detail view renders all.

---

#### Step 7 — `PaginatedSyncJobsResponseDto`

**File**: `apps/api/src/sync/http/dto/paginated-sync-jobs-response.dto.ts` (new)

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { SyncJobResponseDto } from './sync-job-response.dto';

export class PaginatedSyncJobsResponseDto {
  @ApiProperty({ type: [SyncJobResponseDto] }) items: SyncJobResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() limit: number;
  @ApiProperty() offset: number;
}
```

---

#### Step 8 — Extend `SyncController` with GET endpoints

**File**: `apps/api/src/sync/http/sync.controller.ts`

Add `SYNC_JOB_REPOSITORY_TOKEN` injection and two new methods:

```typescript
// Add to constructor:
@Inject(SYNC_JOB_REPOSITORY_TOKEN)
private readonly syncJobRepository: SyncJobRepositoryPort,

// New methods:
@Get('jobs')
@HttpCode(HttpStatus.OK)
async listJobs(@Query() query: ListSyncJobsQueryDto): Promise<PaginatedSyncJobsResponseDto> { ... }

@Get('jobs/:id')
@HttpCode(HttpStatus.OK)
async getJob(@Param('id', ParseUUIDPipe) id: string): Promise<SyncJobResponseDto> { ... }
```

`listJobs` maps `query` → `SyncJobFilters` + `SyncJobPagination`, calls `syncJobRepository.findMany(...)`, maps result to `PaginatedSyncJobsResponseDto`.

`getJob` calls `syncJobRepository.findById(id)`, throws `NotFoundException` if null, maps to `SyncJobResponseDto`.

**Mapper**: Private `toDto(job: SyncJob): SyncJobResponseDto` method on the controller — converts Dates to ISO strings, passes through all fields.

**Acceptance**: `GET /sync/jobs` returns paginated list; filters work; `GET /sync/jobs/:id` returns detail; unknown ID returns 404.

---

#### Step 9 — Unit test for new controller methods

**File**: `apps/api/src/sync/http/sync.controller.spec.ts` (new)

Test cases:
- `listJobs` returns paginated response from repository
- `listJobs` passes filters through correctly
- `getJob` returns job when found
- `getJob` throws `NotFoundException` when not found

Mock `SYNC_JOB_REPOSITORY_TOKEN` and `JOB_ENQUEUE_TOKEN`.

**Acceptance**: All tests green.

---

### Phase 4 — Frontend: Types, API Client, Query Keys, Hooks

**Goal**: FE data layer to consume the new endpoints.

#### Step 10 — `sync-jobs.types.ts`

**File**: `apps/web/src/features/sync-jobs/api/sync-jobs.types.ts` (new)

```typescript
export const JOB_STATUS_VALUES = ['queued', 'running', 'succeeded', 'failed', 'dead'] as const;
export type JobStatus = (typeof JOB_STATUS_VALUES)[number];

export const JOB_TYPE_VALUES = [
  'marketplace.orders.poll',
  'marketplace.order.sync',
  'marketplace.offers.sync',
  'marketplace.offerQuantity.update',
  'master.product.syncByExternalId',
  'master.inventory.syncByExternalId',
  'inventory.propagateToMarketplaces',
] as const;
export type JobType = (typeof JOB_TYPE_VALUES)[number];

export interface SyncJob {
  id: string;
  jobType: string;
  connectionId: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  lastError: string | null;
  payloadJson: Record<string, unknown> | null;
  lockedAt: string | null;
  lockedBy: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncJobFilters {
  status?: JobStatus;
  connectionId?: string;
  jobType?: JobType;
}

export interface SyncJobPagination {
  limit?: number;
  offset?: number;
}

export interface PaginatedSyncJobs {
  items: SyncJob[];
  total: number;
  limit: number;
  offset: number;
}
```

**Acceptance**: No `any`, all values typed.

---

#### Step 11 — Extend `sync.api.ts`

**File**: `apps/web/src/features/sync-jobs/api/sync.api.ts`

Add to `SyncJobsApi` interface and `createSyncJobsApi` factory:

```typescript
list: (filters?: SyncJobFilters, pagination?: SyncJobPagination) => Promise<PaginatedSyncJobs>;
getById: (id: string) => Promise<SyncJob>;
```

`list` builds query string from filters + pagination params (limit, offset), calls `GET /sync/jobs?...`.
`getById` calls `GET /sync/jobs/:id`.

**Acceptance**: Methods typed, query string builder handles all optional params correctly.

---

#### Step 12 — Extend `sync.query-keys.ts`

**File**: `apps/web/src/features/sync-jobs/api/sync.query-keys.ts`

```typescript
export const syncJobsQueryKeys = {
  all: ['sync-jobs'] as const,
  list: (filters?: SyncJobFilters, pagination?: SyncJobPagination) =>
    ['sync-jobs', 'list', filters ?? {}, pagination ?? {}] as const,
  detail: (id: string) => ['sync-jobs', 'detail', id] as const,
};
```

---

#### Step 13 — `use-sync-jobs-query.ts`

**File**: `apps/web/src/features/sync-jobs/hooks/use-sync-jobs-query.ts` (new)

```typescript
export function useSyncJobsQuery(
  filters?: SyncJobFilters,
  pagination?: SyncJobPagination,
): UseQueryResult<PaginatedSyncJobs> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: syncJobsQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.syncJobs.list(filters, pagination),
  });
}
```

---

#### Step 14 — `use-sync-job-query.ts`

**File**: `apps/web/src/features/sync-jobs/hooks/use-sync-job-query.ts` (new)

```typescript
export function useSyncJobQuery(id: string): UseQueryResult<SyncJob> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: syncJobsQueryKeys.detail(id),
    queryFn: () => apiClient.syncJobs.getById(id),
    enabled: Boolean(id),
  });
}
```

---

### Phase 5 — Frontend: Components + Pages + Routes

**Goal**: Operator-facing UI for sync job visibility.

#### Step 15 — `SyncJobStatusBadge` component

**File**: `apps/web/src/features/sync-jobs/components/sync-job-status-badge.tsx` (new)

Maps `JobStatus` → `StatusBadgeTone`:

| Status | Tone |
|---|---|
| `queued` | `info` |
| `running` | `review` |
| `succeeded` | `success` |
| `failed` | `warning` |
| `dead` | `error` |

```typescript
export function SyncJobStatusBadge({ status }: { status: string }): ReactElement {
  const tone = STATUS_TONE_MAP[status as JobStatus] ?? 'neutral';
  return <StatusBadge tone={tone} withDot>{status}</StatusBadge>;
}
```

**Acceptance**: Renders correct tone for each status; unknown status falls back to `neutral`.

---

#### Step 16 — Sync jobs list page

**File**: `apps/web/src/pages/sync-jobs/sync-jobs-page.tsx` (new)

Structure:
```
PageLayout (eyebrow="Operations", title="Sync Jobs")
  ├── Filter bar (status Select, jobType Select, connectionId input)
  ├── DataTable (columns: status, jobType, connectionId, attempts, lastError, createdAt)
  │     rows link to /jobs-logs/:id
  └── Pagination controls (Prev / Next buttons, "Showing X–Y of Z")
```

State:
- Filters: URL search params (`?status=&jobType=&connectionId=`)
- Pagination: URL search params (`?limit=20&offset=0`)
- Server state: `useSyncJobsQuery(filters, pagination)`

All states handled: loading skeleton → error state (`FeedbackState`) → empty state → data.

**Acceptance**: Renders table; filter changes update URL + refetch; pagination works; error and empty states display.

---

#### Step 17 — Sync job detail page

**File**: `apps/web/src/pages/sync-jobs/sync-job-detail-page.tsx` (new)

Structure:
```
PageLayout (eyebrow="Sync Jobs", title=jobType, back link)
  ├── Status + metadata section (id, status badge, connectionId, attempts/maxAttempts, timestamps)
  ├── Error section (if lastError) — monospace pre block with error text
  └── Payload section (payloadJson) — monospace pre block, JSON.stringify(…, null, 2)
```

Uses `useSyncJobQuery(id)` from URL param.
Loading → error (`FeedbackState`) → data.

**Acceptance**: Renders all fields; error section only visible when `lastError` present.

---

#### Step 18 — Wire routes

**File**: `apps/web/src/app/routes/jobs-logs.route.tsx`

Replace the `ModulePlaceholderPage` stub with real pages:

```typescript
export const jobsLogsRoute: RouteObject = {
  path: 'jobs-logs',
  children: [
    { index: true, element: <SyncJobsPage /> },
    { path: ':id', element: <SyncJobDetailPage /> },
  ],
};
```

**Acceptance**: `/jobs-logs` renders list; `/jobs-logs/:id` renders detail; back navigation works.

---

### Phase 6 — Frontend: Tests

#### Step 19 — Hook unit tests

**Files**:
- `apps/web/src/features/sync-jobs/hooks/use-sync-jobs-query.test.ts` (new)
- `apps/web/src/features/sync-jobs/hooks/use-sync-job-query.test.ts` (new)

Test with `renderWithProviders` + `createMockApiClient`:
- `useSyncJobsQuery` returns paginated data on success
- `useSyncJobsQuery` is in loading state initially
- `useSyncJobQuery` returns job data on success
- `useSyncJobQuery` is disabled when id is empty

---

## 7. Alternatives Considered

### Alternative 1: New `SyncJobQueryService` application service
**Description**: Wrap `findMany`/`findById` in a dedicated application service rather than injecting the repository directly into the controller.
**Why Rejected**: The existing `SyncController` already injects `JobEnqueuePort` directly — a consistent pattern. A separate query service adds a file and an interface for zero architectural gain at this scope.

### Alternative 2: Cursor-based pagination
**Description**: Use `createdAt` as a cursor instead of offset.
**Why Rejected**: Offset pagination is simpler to implement and consume for an admin tool where operators navigate by page. The `sync_jobs` table is unlikely to grow large enough for offset to be a problem at MVP stage.

### Alternative 3: Separate list/detail DTOs
**Description**: Return a slimmer `SyncJobSummaryDto` in the list (excluding `payloadJson`, `lockedBy`, etc.) and a full `SyncJobResponseDto` for detail.
**Why Rejected**: Minimal bandwidth benefit since `payloadJson` is typically a small object. Single DTO keeps the mapping code simpler and avoids type proliferation.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Repository port extended in domain layer, implementation in infrastructure layer
- ✅ Controller in interface layer, injects via Symbol token — no concrete class dependency
- ✅ No TypeORM in application layer
- ✅ FE: API client in `features/`, pages in `pages/`, components colocated with feature

### Naming Conventions
- ✅ `list-sync-jobs-query.dto.ts`, `sync-job-response.dto.ts` — follow `*.dto.ts` pattern
- ✅ `use-sync-jobs-query.ts`, `use-sync-job-query.ts` — follow `use-*.ts` pattern
- ✅ `sync-job-status-badge.tsx` — `PascalCase` component

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `ORDER BY createdAt DESC` slow on large table | Low (MVP) | Add `@Index('createdAt')` if table grows; noted in plan |
| `connectionId` filter full-scan | Low (MVP) | Add `@Index('connectionId')` when needed |
| FE pagination offset drift (items inserted while browsing) | Low | Cosmetically acceptable for operator tool; no fix needed at MVP |
| `toDomain` throws on unknown `jobType` in DB | Existing risk | Already guarded in existing `toDomain` method |

### Edge Cases
- `GET /sync/jobs/:id` with non-UUID → `ParseUUIDPipe` returns 400 automatically
- `GET /sync/jobs` with `limit=0` → class-validator `@Min(1)` returns 400
- `offset` greater than `total` → returns `items: [], total: N` (correct behaviour)
- `findMany` with no filters → returns all jobs paginated (intended)

### Backward Compatibility
- ✅ Only additive changes — new repository methods, new endpoints, new FE files
- ✅ Existing `POST /sync/jobs` unchanged
- ✅ Existing `createSyncJobsApi` extended (not replaced); `enqueue` method preserved

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests

| File | What's tested |
|---|---|
| `sync-job.repository.spec.ts` (new) | `findById` found/not found; `findMany` with filters, pagination, empty result |
| `sync.controller.spec.ts` (new) | `listJobs` paginated response, filter passthrough; `getJob` found/not found (404) |
| `use-sync-jobs-query.test.ts` (new) | Loading → success; filters passed to API client |
| `use-sync-job-query.test.ts` (new) | Loading → success; disabled when id empty |

### Integration Tests
Not required for this slice. The repository's `findAndCount` is standard TypeORM — no raw SQL involved — making mocked unit tests reliable.

### Manual Verification
1. `pnpm start:dev:api` → `GET /sync/jobs` returns `{ items: [], total: 0, limit: 20, offset: 0 }`
2. Enqueue a job via `POST /sync/jobs` → appears in `GET /sync/jobs`
3. Filter by `status=queued` → returns only queued jobs
4. `GET /sync/jobs/:id` with valid ID → full detail
5. `GET /sync/jobs/not-a-uuid` → 400
6. `GET /sync/jobs/00000000-0000-0000-0000-000000000000` → 404
7. FE: `/jobs-logs` loads list; filters update URL; row click navigates to `/jobs-logs/:id`

### Acceptance Criteria
- [ ] `GET /sync/jobs` returns paginated list with optional status/connectionId/jobType filters
- [ ] `GET /sync/jobs/:id` returns full job detail; unknown ID returns 404
- [ ] All responses include ISO timestamps and failure reason
- [ ] Frontend `/jobs-logs` renders list with all states (loading, empty, error, data)
- [ ] Frontend `/jobs-logs/:id` renders detail with error/payload sections
- [ ] Status filter, jobType filter, and pagination work end-to-end
- [ ] `pnpm lint` passes
- [ ] `pnpm type-check` passes
- [ ] `pnpm test` passes (unit tests green)

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (port in domain, impl in infrastructure, controller in interface)
- [x] Respects CORE vs Integration boundaries — no integration adapters touched
- [x] Uses existing patterns (`createConnectionsApi` factory, `useQuery` hooks, `DataTable` + `StatusBadge`)
- [x] Idempotency considered — read-only endpoints, no side effects
- [x] Event-driven patterns N/A for read API
- [x] Rate limits N/A (internal admin API)
- [x] Error handling comprehensive (`NotFoundException` for missing job, `ParseUUIDPipe` for bad ID, `FeedbackState` on FE)
- [x] Testing strategy complete (unit tests for all new logic)
- [x] Naming conventions followed (BE + FE)
- [x] File structure matches standards
- [x] Plan is execution-ready

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Frontend Architecture](../frontend-architecture.md)
