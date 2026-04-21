# Implementation Plan: #268 + #269 — Server-side failed-job aggregation and bulk retry

## 1. Task Understanding

**Goal**: Move two concerns off the frontend and onto the server so the dashboard's "What's broken right now" surface scales past 500 dead jobs and retries entire failure signatures in one action.

- **#268** — `GET /sync/jobs/grouped?status=dead&connectionId=<optional>` returns failures aggregated by `(connectionId, jobType)`: count, latest `updatedAt`, a representative `jobId`, and the group's last error. Also returns `totalGroups` and `totalJobs`.
- **#269** — `POST /sync/jobs/retry-grouped` accepts `{ connectionId, jobType }`, re-queues every matching dead job (capped at a batch size, e.g. 1000), skips jobs that flipped back to `queued`/`running` between fetch and action, emits one `sync.job.bulk-retry-requested` event.

**Layer**:
- CORE (sync domain + application) — new repository method, new bulk-retry service
- Interface (HTTP) — two new endpoints on `SyncController`
- Frontend — dashboard rewrites its dead-job query, retires the client-side grouping module

**Explicit non-goals**:
- **No schema migration.** No new columns, no new indexes in this PR. With ~500 dead jobs and the existing `(status, nextRunAt)` index seeding the `WHERE status='dead'` filter, a window-function aggregation is fine. If scale later warrants `(status, connectionId, jobType)`, add in a follow-up.
- **No batched continuation API.** Cap at 1000; if a group has more, the UI shows "retried first 1000" and the operator clicks again. YAGNI until a real user hits it.
- **No structural change to the single-job retry endpoint.** `POST /sync/jobs/:id/retry` stays exactly as it is.
- **`summarizeFailuresByConnection` will not be reused.** Inline the tally from `groups[]` at the one call site in the dashboard (see §4 step 11).

## 2. Research findings

**Backend** (sync-agent report verified against source):

- `apps/api/src/sync/http/sync.controller.ts:48-199` — existing endpoints: `POST /sync/jobs`, `GET /sync/jobs`, `GET /sync/jobs/:id`, `POST /sync/jobs/:id/retry`. Uses `@Roles('admin')` + `@ApiBearerAuth()`. Constructor injects `JobEnqueuePort`, `SyncJobRepositoryPort`, `ISyncJobRetryService`.
- `libs/core/src/sync/domain/ports/sync-job-repository.port.ts:22-116` — port surface. Key methods: `findMany`, `findById`, `requeueDeadJob` (single), `findRecentByConnectionId`. **No aggregation or bulk-update methods yet.**
- `libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.ts:240-269` — `requeueDeadJob` is an atomic conditional UPDATE (`WHERE id = :id AND status = 'dead'`) with distinguished "not found" vs "wrong status" errors. Pattern to mirror for the bulk case.
- `libs/core/src/sync/infrastructure/persistence/entities/sync-job.orm-entity.ts:18-64` — table `sync_jobs`. Indexes: `(status, nextRunAt)`, `(lockedAt)`, `(connectionId, createdAt)`. Columns: `id`, `jobType`, `connectionId`, `payloadJson`, `status`, `idempotencyKey`, `attempts`, `maxAttempts`, `nextRunAt`, `lockedAt`, `lockedBy`, `lastError`, `createdAt`, `updatedAt`.
- `apps/api/src/webhooks/application/services/webhook-event-publisher.service.ts` — concrete event-publisher pattern. Inject `EVENT_PUBLISHER_TOKEN`, build an `EventEnvelope` with JSON-stringified `payloadJson`/`metadataJson`, call `eventPublisher.publish(streamName, envelope)`. Returns a Redis Streams message id.
- `apps/api/src/sync/http/dto/list-sync-jobs-query.dto.ts` — validates `status`/`connectionId`/`jobType`/`limit`/`offset` with `class-validator`. Reuse the decorators for the new DTOs.
- `apps/api/test/integration/sync-jobs-read.int-spec.ts` + `apps/api/test/integration/fixtures/sync-job.fixtures.ts` — existing integration suite + `createTestSyncJob()` helper. New `int-specs` mirror the shape.

**Frontend** (fe-agent report verified against source):

- `apps/web/src/pages/dashboard/dashboard-page.tsx:40-46` — `DEAD_JOB_GROUPING_LIMIT` constant with the "Long-term fix: #268" comment that the issue explicitly marks for deletion.
- `apps/web/src/pages/dashboard/dashboard-page.tsx:213-241` — `handleRetryGroup` currently calls `retrySyncJob.mutateAsync(group.representative.id)` and fires the "N other failures still dead" caveat toast.
- `apps/web/src/pages/dashboard/dashboard-page.tsx:298` — the `retryLabel = group.count > 1 ? 'Retry 1 of N' : 'Retry'` band-aid.
- `apps/web/src/pages/dashboard/dashboard-page.tsx:433-439` — the "N signatures in first M" panel meta fallback.
- `apps/web/src/pages/dashboard/failed-job-groups.ts` — `groupFailedJobs` + `summarizeFailuresByConnection`. Both retire: `groupFailedJobs` becomes unnecessary (server returns the shape), `summarizeFailuresByConnection` is inlined at its single dashboard call site.
- `apps/web/src/features/sync-jobs/api/{sync.api.ts, sync-jobs.types.ts, sync.query-keys.ts}` + `hooks/{use-sync-jobs-query.ts, use-retry-sync-job-mutation.ts}` — existing pattern for list/detail/retry. Mirror for grouped-list and grouped-retry.
- `apps/web/src/pages/dashboard/dashboard-page.test.tsx` — three tests to retire (labels-with-group-size, caveat toast, signatures-in-first-N) plus one to update (retry mutation call).

## 3. Solution

### Backend shape (domain types)

```ts
// libs/core/src/sync/domain/types/sync-job.types.ts — additions
export interface SyncJobGroup {
  connectionId: string;
  jobType: JobType;
  count: number;
  latestUpdatedAt: Date;
  representativeJobId: string;
  lastError: string | null;
}

export interface SyncJobGroupsResult {
  groups: SyncJobGroup[];
  totalGroups: number;
  totalJobs: number;
}

export interface SyncJobGroupFilters {
  status: JobStatus;
  connectionId?: string;
}

export interface BulkRetryResult {
  requeuedJobIds: string[];
  count: number;
  skipped: number;
}

export const BULK_RETRY_MAX_BATCH_SIZE = 1000;

/**
 * Redis Streams channel for sync-job lifecycle events. New in this PR;
 * no consumer is attached yet (audit-trail / observability only).
 * Future bulk-operation events should publish to the same stream.
 */
export const SYNC_JOBS_EVENT_STREAM = 'events.sync.jobs';
```

### Repository port additions

```ts
// libs/core/src/sync/domain/ports/sync-job-repository.port.ts — additions
findGroupedByStatus(
  filters: SyncJobGroupFilters,
  maxGroups: number,
): Promise<SyncJobGroupsResult>;

requeueDeadJobsInGroup(
  connectionId: string,
  jobType: string,
  maxBatchSize: number,
): Promise<BulkRetryResult>;
```

### Repository implementation (Postgres)

`findGroupedByStatus` uses a window-function query — one round-trip, single pass over the filtered set, no new indexes required:

```sql
WITH ranked AS (
  SELECT
    id,
    "connectionId",
    "jobType",
    "updatedAt",
    "lastError",
    COUNT(*) OVER (PARTITION BY "connectionId", "jobType") AS group_count,
    ROW_NUMBER() OVER (
      PARTITION BY "connectionId", "jobType"
      ORDER BY "updatedAt" DESC, id DESC
    ) AS rn
  FROM sync_jobs
  WHERE status = $1
    AND ($2::uuid IS NULL OR "connectionId" = $2)
)
SELECT "connectionId", "jobType", group_count, "updatedAt", id, "lastError"
FROM ranked
WHERE rn = 1
ORDER BY group_count DESC, "updatedAt" DESC
LIMIT $3;
```

Totals in a second query (cheap aggregate over the same filter):
```sql
SELECT COUNT(*)::int AS total_jobs,
       COUNT(DISTINCT ("connectionId", "jobType"))::int AS total_groups
FROM sync_jobs
WHERE status = $1
  AND ($2::uuid IS NULL OR "connectionId" = $2);
```

Two queries, no transaction needed (read-only, eventually-consistent snapshot is fine; the UI re-polls).

`requeueDeadJobsInGroup` is a single bulk UPDATE with `RETURNING`:

```sql
WITH target AS (
  SELECT id
  FROM sync_jobs
  WHERE status = 'dead'
    AND "connectionId" = $1
    AND "jobType" = $2
  ORDER BY "updatedAt" DESC, id DESC
  LIMIT $3
)
UPDATE sync_jobs sj
SET status = 'queued',
    attempts = 0,
    "nextRunAt" = now(),
    "lockedAt" = NULL,
    "lockedBy" = NULL
FROM target
WHERE sj.id = target.id
  AND sj.status = 'dead'  -- tolerate the rare flip to queued/running between SELECT and UPDATE
RETURNING sj.id;
```

`skipped` = `target rowcount − RETURNING rowcount`. To get both counts reliably, run the `target` SELECT first (with `LIMIT $3`) in JS, then UPDATE `WHERE id = ANY($ids) AND status = 'dead'`. Two queries, same result, simpler to read. Either works; plan uses the two-query variant for clarity.

### Application service (`SyncJobBulkRetryService`)

```ts
// libs/core/src/sync/application/services/sync-job-bulk-retry.service.interface.ts
export interface ISyncJobBulkRetryService {
  retryGroup(connectionId: string, jobType: JobType): Promise<BulkRetryResult>;
}

// libs/core/src/sync/application/services/sync-job-bulk-retry.service.ts
@Injectable()
export class SyncJobBulkRetryService implements ISyncJobBulkRetryService {
  constructor(
    @Inject(SYNC_JOB_REPOSITORY_TOKEN)
    private readonly repo: SyncJobRepositoryPort,
    @Inject(EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: EventPublisherPort,
  ) {}

  async retryGroup(connectionId: string, jobType: JobType): Promise<BulkRetryResult> {
    const result = await this.repo.requeueDeadJobsInGroup(
      connectionId, jobType, BULK_RETRY_MAX_BATCH_SIZE
    );

    if (result.count > 0) {
      await this.eventPublisher.publish(SYNC_JOBS_EVENT_STREAM, {
        eventId: randomUUID(),
        eventType: 'sync.job.bulk-retry-requested',
        payloadJson: JSON.stringify({
          connectionId, jobType,
          jobIds: result.requeuedJobIds,
          count: result.count,
          skipped: result.skipped,
        }),
        metadataJson: JSON.stringify({ schemaVersion: '1' }),
        occurredAt: new Date().toISOString(),
        publishedAt: new Date().toISOString(),
      });
    }
    return result;
  }
}
```

No event when `count === 0` — the UI gets the response directly; emitting zero-count events is noise. This also correctly handles the race where two operators click Retry on the same group: the second one's `count` is 0 (its target ids already flipped to `queued`), so no duplicate event fires.

### HTTP surface

```ts
// apps/api/src/sync/http/sync.controller.ts — additions

@Get('jobs/grouped')
async listGroupedJobs(
  @Query() query: ListGroupedSyncJobsQueryDto,
): Promise<GroupedSyncJobsResponseDto>;

@Post('jobs/retry-grouped')
@HttpCode(HttpStatus.OK)
async retryGroupedJobs(
  @Body() dto: RetryGroupedSyncJobsDto,
): Promise<RetryGroupedSyncJobsResponseDto>;
```

DTOs:
- `ListGroupedSyncJobsQueryDto`: `status: JobStatus` (required), `connectionId?: string`, `limit?: number = 100` (cap at 100).
- `SyncJobGroupDto`: `connectionId`, `jobType`, `count`, `latestUpdatedAt: ISO string`, `representativeJobId`, `lastError`.
- `GroupedSyncJobsResponseDto`: `groups: SyncJobGroupDto[]`, `totalGroups`, `totalJobs`.
- `RetryGroupedSyncJobsDto`: `connectionId: string (UUID)`, `jobType: JobType`.
- `RetryGroupedSyncJobsResponseDto`: `requeuedJobIds: string[]`, `count`, `skipped`.

### Frontend shape

```ts
// apps/web/src/features/sync-jobs/api/sync-jobs.types.ts — additions
export interface SyncJobGroup {
  connectionId: string;
  jobType: JobType;
  count: number;
  latestUpdatedAt: string;   // ISO
  representativeJobId: string;
  lastError: string | null;
}

export interface SyncJobGroupsResponse {
  groups: SyncJobGroup[];
  totalGroups: number;
  totalJobs: number;
}

export interface RetryGroupedSyncJobsInput {
  connectionId: string;
  jobType: JobType;
}

export interface RetryGroupedSyncJobsResult {
  requeuedJobIds: string[];
  count: number;
  skipped: number;
}
```

API + hooks + query keys mirror the existing sync-jobs pattern verbatim. The dashboard switches to the new hooks and deletes the client-side aggregation.

## 4. Step-by-step

### Backend — CORE

**Step 1 — Extend domain types**
`libs/core/src/sync/domain/types/sync-job.types.ts`: add `SyncJobGroup`, `SyncJobGroupsResult`, `SyncJobGroupFilters`, `BulkRetryResult`, `BULK_RETRY_MAX_BATCH_SIZE = 1000`. Export from `libs/core/src/sync/index.ts`.

**Step 2 — Extend repository port**
`libs/core/src/sync/domain/ports/sync-job-repository.port.ts`: add `findGroupedByStatus(filters, maxGroups)` and `requeueDeadJobsInGroup(connectionId, jobType, maxBatchSize)`. JSDoc both.

**Step 3 — Implement in repository**
`libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.ts`:

- `findGroupedByStatus` — execute the window-function query via `this.dataSource.query(sql, params)` (raw SQL — TypeORM QueryBuilder doesn't model window functions cleanly). Add a short comment above the raw SQL: `// Inputs are DTO-validated upstream (IsEnum JobStatus, IsUUID, @Max(100)). Raw SQL used because TypeORM QueryBuilder doesn't model window functions cleanly.` Map rows to `SyncJobGroup` shape (convert `group_count::string → number`, validate `jobType`/`status` via the existing `isValidJobType` helper). Run the totals query after. Return `SyncJobGroupsResult`.
- `requeueDeadJobsInGroup`:
  1. `SELECT id FROM sync_jobs WHERE status='dead' AND "connectionId"=$1 AND "jobType"=$2 ORDER BY "updatedAt" DESC, id DESC LIMIT $3` via QueryBuilder.
  2. If empty → return `{ requeuedJobIds: [], count: 0, skipped: 0 }`.
  3. UPDATE those ids with `AND sj.status = 'dead'` guard; RETURNING `id`. Use `createQueryBuilder().update().where('id IN (:...ids) AND status = :dead').returning(['id']).execute()`.
  4. `skipped = selectedIds.length − returnedIds.length`.

**Step 4 — Bulk retry service interface + impl**
New files:
- `libs/core/src/sync/application/services/sync-job-bulk-retry.service.interface.ts` — `ISyncJobBulkRetryService.retryGroup(connectionId, jobType)`.
- `libs/core/src/sync/application/services/sync-job-bulk-retry.service.ts` — implementation per §3. Inject `SYNC_JOB_REPOSITORY_TOKEN` + `EVENT_PUBLISHER_TOKEN`. Log start/success/empty-result.

**Step 5 — Token + module wiring**
- `libs/core/src/sync/sync.tokens.ts`: add `SYNC_JOB_BULK_RETRY_SERVICE_TOKEN = Symbol('ISyncJobBulkRetryService')`.
- `libs/core/src/sync/sync.module.ts`: register `SyncJobBulkRetryService`, provide token via `useExisting`, export. Ensure the `EVENT_PUBLISHER_TOKEN` provider is already imported (it is — via `EventsModule`).
- `libs/core/src/sync/index.ts`: re-export the token + interface.

**Step 6 — Unit tests**
- `libs/core/src/sync/application/services/sync-job-bulk-retry.service.spec.ts` — mock `SyncJobRepositoryPort` + `EventPublisherPort`. Assert:
  - emits one `sync.job.bulk-retry-requested` event on `count > 0` (publisher called once with expected stream name, eventType, payload shape)
  - skips event emission when `count === 0` (publisher never called)
  - surfaces the `BulkRetryResult` unchanged to the caller
  - passes `BULK_RETRY_MAX_BATCH_SIZE` through to the repository's `requeueDeadJobsInGroup` — locks in the cap contract at the service boundary
- No repository unit tests (repository is integration-tested; unit-testing raw SQL is brittle per engineering-standards §"ORM ↔ Domain Mapping").

### Backend — Interface (HTTP)

**Step 7 — DTOs**
New files in `apps/api/src/sync/http/dto/`:
- `list-grouped-sync-jobs-query.dto.ts` — `status` (required, `@IsEnum(JobStatusValues)`), `connectionId?` (`@IsUUID`), `limit? = 100` (`@Min(1) @Max(100)`).
- `sync-job-group.dto.ts` — the group DTO.
- `grouped-sync-jobs-response.dto.ts` — `groups`, `totalGroups`, `totalJobs`.
- `retry-grouped-sync-jobs.dto.ts` — `connectionId: @IsUUID`, `jobType: @IsEnum(JobTypeValues)`.
- `retry-grouped-sync-jobs-response.dto.ts` — `requeuedJobIds`, `count`, `skipped`.

Each file uses `@nestjs/swagger` decorators consistent with existing DTOs.

**Step 8 — Controller endpoints**
`apps/api/src/sync/http/sync.controller.ts`:
- Inject `ISyncJobBulkRetryService` via `SYNC_JOB_BULK_RETRY_SERVICE_TOKEN`.
- `@Get('jobs/grouped')` → call `this.syncJobRepository.findGroupedByStatus({ status, connectionId }, limit)`; map to DTO (ISO-string the timestamps).
- `@Post('jobs/retry-grouped')` → call `this.bulkRetryService.retryGroup(dto.connectionId, dto.jobType)`; return the DTO directly.
- Both inherit the class-level `@Roles('admin')` + `@ApiBearerAuth()`.

**Step 9 — Module wiring**
`apps/api/src/sync/sync.module.ts`: no change if it already imports core `SyncModule` (confirm via read). Controller just needs the new token injected.

**Step 10 — Integration tests**
New files in `apps/api/test/integration/`:
- `sync-jobs-grouped.int-spec.ts` — `GET /sync/jobs/grouped?status=dead`:
  - empty list → `{ groups: [], totalGroups: 0, totalJobs: 0 }`
  - single signature collapses to one row with count=3
  - multi-signature sorted by count DESC then latestUpdatedAt DESC
  - representativeJobId = most-recently-updated row in the group
  - `connectionId` filter narrows results
  - auth required (existing pattern: call without token → 401)
- `sync-jobs-retry-grouped.int-spec.ts` — `POST /sync/jobs/retry-grouped`:
  - re-queues every matching dead job; DB confirms `status='queued'`, `attempts=0`
  - skips jobs already flipped to `queued` (seed one with `status='queued'` in same group) — not re-touched, `skipped` reflects the difference
  - batch-size cap tested in the service unit spec (Step 6), not here — avoids seeding 1000+ rows
  - 400 on missing/invalid body

Event emission (`sync.job.bulk-retry-requested`) is asserted in the `SyncJobBulkRetryService` unit spec (Step 6) with a mocked `EventPublisherPort`. Not asserted at integration level: the publish call is a one-liner branched on `count > 0`, and unit-test coverage is cleaner than reading back from Redis Streams in the harness.

Use the existing `createTestSyncJob` fixture.

### Frontend

**Step 11 — Types + API + query keys**
- `apps/web/src/features/sync-jobs/api/sync-jobs.types.ts` — add `SyncJobGroup`, `SyncJobGroupsResponse`, `RetryGroupedSyncJobsInput`, `RetryGroupedSyncJobsResult`.
- `apps/web/src/features/sync-jobs/api/sync.api.ts`:
  - `listGrouped(filters: { status: JobStatus; connectionId?: string; limit?: number }): Promise<SyncJobGroupsResponse>` → `GET /sync/jobs/grouped?...` via `buildQuery`.
  - `retryGrouped(input: RetryGroupedSyncJobsInput): Promise<RetryGroupedSyncJobsResult>` → `POST /sync/jobs/retry-grouped`.
- `apps/web/src/features/sync-jobs/api/sync.query-keys.ts` — add `grouped: (filters?) => ['sync-jobs', 'grouped', filters ?? {}] as const`.

**Step 12 — Hooks**
New files:
- `apps/web/src/features/sync-jobs/hooks/use-failed-job-groups-query.ts` — `useFailedJobGroupsQuery(filters?, options?)`. Same `refetchInterval` surface as `useSyncJobsQuery`. Filter default: `{ status: 'dead' }`.
- `apps/web/src/features/sync-jobs/hooks/use-retry-grouped-sync-jobs-mutation.ts` — invalidates `syncJobsQueryKeys.all` on success.

Unit tests for both hooks: mirror `use-sync-jobs-query.test.tsx` pattern.

**Step 13 — Dashboard rewrite**
`apps/web/src/pages/dashboard/dashboard-page.tsx`:
- Delete lines 40-46 (`DEAD_JOB_GROUPING_LIMIT` constant + its comment).
- Replace the `useSyncJobsQuery({ status: 'dead' }, { limit: DEAD_JOB_GROUPING_LIMIT }, { refetchInterval })` call with `useFailedJobGroupsQuery({ status: 'dead' }, { refetchInterval })`.
- Remove imports of `groupFailedJobs` and `summarizeFailuresByConnection` from `./failed-job-groups`.
- Replace `failedGroups = groupFailedJobs(deadJobs)` with `failedGroups = deadJobGroupsQuery.data?.groups ?? []`.
- Replace `deadTotal` wiring with `deadJobGroupsQuery.data?.totalJobs ?? 0`.
- Connection health rollup: inline the tally. Before implementing, grep `rollUpConnectionHealth` (or whichever consumer reads `summarizeFailuresByConnection`'s output) in `dashboard-page.tsx` to see whether it reads named fields (`connectionId`, `deadJobCount`) or just needs a count. If it reads named fields, inline as `Map<string, ConnectionFailureSignal>` built via `failedGroups.reduce((m, g) => { const existing = m.get(g.connectionId); m.set(g.connectionId, { connectionId: g.connectionId, deadJobCount: (existing?.deadJobCount ?? 0) + g.count }); return m; }, new Map())` — preserving type parity with the deleted `summarizeFailuresByConnection`. Move the `ConnectionFailureSignal` type declaration from `failed-job-groups.ts` into a local file-top type in `dashboard-page.tsx` or into `apps/web/src/features/sync-jobs/api/sync-jobs.types.ts` if it becomes reusable.
- `handleRetryGroup`: call `retryGrouped.mutateAsync({ connectionId: group.connectionId, jobType: group.jobType })`. Toast text: `"Re-queued N jobs"` / description includes `jobType`; if `result.skipped > 0`, mention "N already running, skipped".
- Delete `retryLabel` branching; hard-code `'Retry'`. Button disabled/pending state logic stays.
- Delete the `"signatures in first N"` branch from panel meta (lines 433-439). Always render `"N unique signature(s) · M total failures"`.

**Step 14 — Delete retired module**
- Delete `apps/web/src/pages/dashboard/failed-job-groups.ts`.
- Delete `apps/web/src/pages/dashboard/failed-job-groups.test.ts`.

**Step 15 — Update dashboard tests**
`apps/web/src/pages/dashboard/dashboard-page.test.tsx`:
- Update the `"calls the retry mutation for the representative job when Retry is clicked"` test → rename to `"calls retryGrouped with the group selector when Retry is clicked"`; assert `retryGrouped` called with `{ connectionId, jobType }`, not `retry(id)`.
- Delete `"labels the Retry button with the group size when there is more than one failure"`.
- Delete `"surfaces the remaining-failures caveat in the success toast for a multi-row group"`. Replace with a leaner `"shows re-queued count in toast"` that asserts `/Re-queued \d+ jobs/`.
- Delete `"shows 'signatures in first N' when the dead-job page is capped below the total"`.
- Update the `"requests dead jobs with limit capped at SYNC_JOBS_MAX_LIMIT (regression guard for #270)"` regression guard → the new call no longer takes a limit, so delete the test outright. **The commit message must explicitly note that the #270 regression guard becomes obsolete because the dashboard no longer requests raw dead jobs** — grep the archaeologist's path: without the callout, a future reader seeing the guard deleted won't know the underlying invariant was retired by moving to server-side grouping.
- Update the `deadJobsQuery` mock pattern → now mocks `syncJobs.listGrouped` returning `{ groups, totalGroups, totalJobs }`.

### Quality gate

**Step 16 — Run**
```
pnpm lint && pnpm type-check && pnpm test
pnpm --filter @openlinker/api migration:show   # confirm no pending migrations
pnpm test:integration                           # verify the two new int-specs pass
```

No migration is expected. If `migration:show` reports a new pending entry, something in this PR drifted from "no schema changes" — stop and diagnose.

## 5. Validation

- **Architecture**: Domain types in `domain/types/`, port in `domain/ports/`, service in `application/services/` with an interface in `application/services/*.service.interface.ts`, controller in `apps/api/src/sync/http/`. Matches hexagonal layering per architecture-overview.md §"Hexagonal Architecture Structure". ✅
- **CORE ↔ Integration boundary**: no integration-specific code. ✅
- **Naming**: `SyncJobGroup` (entity-like type), `ISyncJobBulkRetryService` + `SyncJobBulkRetryService`, `SYNC_JOB_BULK_RETRY_SERVICE_TOKEN` as a Symbol. Matches engineering-standards §"Naming Conventions" + §"Services". ✅
- **Types in separate files**: all new types land in `sync-job.types.ts`. No inline types. ✅
- **Interface/impl separation**: service interface and impl in separate files per engineering-standards §"Service Interface Implementation". ✅
- **Testing**: unit test on the bulk-retry service (mocks ports); integration tests on both endpoints (real Postgres via Testcontainers, real Redis for the event stream). Matches testing-guide.md conventions. ✅
- **Frontend**: state ownership — server state via TanStack Query (new hooks); no global store; no raw `fetch`. Dependency direction: `pages/dashboard` imports `features/sync-jobs/hooks`, never the other way. ✅
- **Security**: both endpoints inherit `@Roles('admin')` + `@ApiBearerAuth()` from the controller class. DTOs validate `@IsUUID`/`@IsEnum`. No user-controlled SQL interpolation (all params bound via TypeORM). ✅

## 6. Risk

- **Raw SQL in the repository** — window functions don't map cleanly through TypeORM QueryBuilder. `dataSource.query(sql, params)` is the pragmatic choice. The risk: Postgres-specific (`ROW_NUMBER() OVER (PARTITION BY ...)`). OpenLinker is Postgres-only by policy (testing-guide.md: `postgres:16-alpine`), so acceptable.
- **`requeueDeadJobsInGroup` concurrent safety** — two operators clicking Retry on the same group at the same time: both SELECT the same ids, both UPDATE with `WHERE status='dead'`. The second UPDATE affects zero rows for already-flipped ids; its `skipped` reflects that. No double-enqueue risk because the worker fetches jobs by `status='queued'` + `FOR UPDATE SKIP LOCKED` — flipping an already-queued job to `queued` again is a no-op at the worker level. ✅
- **Event emission failure** — if `eventPublisher.publish` throws after the UPDATE, the retry is done but the event is lost. Acceptable: per the issue, the event is for observability, not for the retry itself to take effect. Log-and-swallow would hide real Redis outages; letting it throw surfaces them. The DB state is still correct. Worth a comment in the service.
- **`skipped` accuracy** — we define "skipped" as "ids we intended to update that weren't in `dead` state by the time the UPDATE ran." This matches the issue's definition and is implementable in the two-query approach. A job that's `running` for a legitimate reason would count as skipped — that's correct per the issue.
- **Frontend test migration** — three dashboard-page tests retire and one updates. Risk of losing coverage. Mitigation: new leaner tests explicitly assert `retryGrouped` is called and the toast shows re-queued count + optional skipped — covers the same behavioural surface.
- **Connection-health rollup regression** — inlining `summarizeFailuresByConnection` into the dashboard changes the data source from "raw jobs" to "groups". Semantically identical because every dead job belongs to exactly one group (by `(connectionId, jobType)`), and each group row carries its full count. Verified by: `sum(group.count) where group.connectionId = C` === `count(dead jobs) where connectionId = C`. ✅

## 7. Out of scope

- Schema migration / new indexes (deferred to a follow-up if production scale requires).
- Paginated grouped endpoint (`limit=100` is the cap; operators who hit it can filter by connection).
- Bulk-retry continuation API for groups >1000 (UI shows "retried first 1000").
- Single-job retry endpoint changes.
- Connection-health rollup becoming its own endpoint (fine to derive client-side from `groups[]`).
- **Shared domain-event type for `sync.job.bulk-retry-requested`**: the service builds the `EventEnvelope` inline with a `schemaVersion: '1'` metadata field. Once a consumer is added to the `events.sync.jobs` stream, extract a `SyncJobBulkRetryRequestedEvent` type and matching Zod schema into `libs/core/src/sync/domain/events/` so producer and consumer share the same contract. YAGNI until then.

## 8. Summary of files touched

### Backend — CORE

| File | Change |
|---|---|
| `libs/core/src/sync/domain/types/sync-job.types.ts` | Add `SyncJobGroup`, `SyncJobGroupsResult`, `SyncJobGroupFilters`, `BulkRetryResult`, `BULK_RETRY_MAX_BATCH_SIZE` |
| `libs/core/src/sync/domain/ports/sync-job-repository.port.ts` | Add `findGroupedByStatus` and `requeueDeadJobsInGroup` methods |
| `libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.ts` | Implement both methods (raw SQL for the group query, QueryBuilder for the bulk UPDATE) |
| `libs/core/src/sync/application/services/sync-job-bulk-retry.service.interface.ts` | **New** — `ISyncJobBulkRetryService` |
| `libs/core/src/sync/application/services/sync-job-bulk-retry.service.ts` | **New** — implementation + event emission |
| `libs/core/src/sync/application/services/sync-job-bulk-retry.service.spec.ts` | **New** — unit test with mocked port + publisher |
| `libs/core/src/sync/sync.tokens.ts` | Add `SYNC_JOB_BULK_RETRY_SERVICE_TOKEN` |
| `libs/core/src/sync/sync.module.ts` | Register new service + token binding |
| `libs/core/src/sync/index.ts` | Re-export new types, token, interface |

### Backend — API

| File | Change |
|---|---|
| `apps/api/src/sync/http/dto/list-grouped-sync-jobs-query.dto.ts` | **New** |
| `apps/api/src/sync/http/dto/sync-job-group.dto.ts` | **New** |
| `apps/api/src/sync/http/dto/grouped-sync-jobs-response.dto.ts` | **New** |
| `apps/api/src/sync/http/dto/retry-grouped-sync-jobs.dto.ts` | **New** |
| `apps/api/src/sync/http/dto/retry-grouped-sync-jobs-response.dto.ts` | **New** |
| `apps/api/src/sync/http/sync.controller.ts` | Inject bulk-retry service; add `GET /sync/jobs/grouped` and `POST /sync/jobs/retry-grouped` |
| `apps/api/test/integration/sync-jobs-grouped.int-spec.ts` | **New** |
| `apps/api/test/integration/sync-jobs-retry-grouped.int-spec.ts` | **New** |

### Frontend

| File | Change |
|---|---|
| `apps/web/src/features/sync-jobs/api/sync-jobs.types.ts` | Add `SyncJobGroup`, `SyncJobGroupsResponse`, `RetryGroupedSyncJobsInput`, `RetryGroupedSyncJobsResult` |
| `apps/web/src/features/sync-jobs/api/sync.api.ts` | Add `listGrouped` + `retryGrouped` methods on `SyncJobsApi` |
| `apps/web/src/features/sync-jobs/api/sync.query-keys.ts` | Add `grouped` key |
| `apps/web/src/features/sync-jobs/hooks/use-failed-job-groups-query.ts` | **New** |
| `apps/web/src/features/sync-jobs/hooks/use-failed-job-groups-query.test.tsx` | **New** |
| `apps/web/src/features/sync-jobs/hooks/use-retry-grouped-sync-jobs-mutation.ts` | **New** |
| `apps/web/src/features/sync-jobs/hooks/use-retry-grouped-sync-jobs-mutation.test.tsx` | **New** |
| `apps/web/src/pages/dashboard/dashboard-page.tsx` | Swap query + mutation; delete `DEAD_JOB_GROUPING_LIMIT`; simplify retry handler; drop `retryLabel` branching; inline connection-failure tally from groups |
| `apps/web/src/pages/dashboard/dashboard-page.test.tsx` | Update retry-mutation test; delete three retired tests; update mocks to `listGrouped` |
| `apps/web/src/pages/dashboard/failed-job-groups.ts` | **Deleted** |
| `apps/web/src/pages/dashboard/failed-job-groups.test.ts` | **Deleted** |
