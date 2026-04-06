# Implementation Plan: Connection Diagnostics API + Health Dashboard

**Date**: 2026-04-06
**Status**: Ready for Review
**Estimated Effort**: 5–7 hours
**Issues**:
- [#65 — BE: Add connection diagnostics and activity API](https://github.com/SilkSoftwareHouse/openlinker/issues/65)
- [#74 — FE: Build health and environment dashboard](https://github.com/SilkSoftwareHouse/openlinker/issues/74)
**Branch**: `65-74-diagnostics-and-health-dashboard`

---

## 1. Task Summary

**Objective**: Deliver two connected slices in a single branch:

1. **#65 (BE)** — Add `GET /connections/:id/diagnostics` to the backend. The endpoint aggregates data from the `connections` and `sync_jobs` tables to give the FE a single, per-connection operational summary: status, last success/failure timestamps, recent job list, and recent error messages.

2. **#74 (FE)** — Replace the entirely static mock dashboard with real data. Wire the system health section to `GET /health/dev-stack`, the connection health panel to `GET /connections`, and the per-connection diagnostic card to the new `GET /connections/:id/diagnostics` endpoint. Add a manual refresh control. Keep the sync-jobs activity timeline as a placeholder — that data source (`GET /sync/jobs`) is being built in parallel in issue #70 and must not be blocked on.

**Context**: The backend has health endpoints and a fully persisted sync_jobs table, but no read API surfacing job data. The frontend dashboard has production-quality UI but is wired to hardcoded mock data. This plan delivers the last-mile connection between the two.

**Classification**: Backend / Interface (connection controller + diagnostics DTO) + Frontend / Feature (health feature module + dashboard wiring)

---

## 2. Scope & Non-Goals

### In Scope

**Backend (#65):**
- `findRecentByConnectionId(connectionId, limit)` — new method on `SyncJobRepositoryPort` and `SyncJobRepository`
- `GET /connections/:id/diagnostics` — new endpoint on `ConnectionController`
- `ConnectionDiagnosticsResponseDto` — response DTO

**Frontend (#74):**
- `features/health/` — new feature module: API types, `health.api.ts`, query-keys, `use-dev-stack-health-query.ts`
- `features/connections/api/connections.api.ts` — add `getDiagnostics(connectionId)` method
- `features/connections/api/connections.types.ts` — add `ConnectionDiagnostics` type
- `api-client.ts` — add `health` module
- `test-utils.tsx` — add health mock
- Dashboard page — replace static metric card, connection health list, and system health section with real data; keep sync-jobs sections as explicit placeholders; add refresh button
- Tests for the new hooks and the updated dashboard component

### Out of Scope

- `GET /sync/jobs` read API — being built in issue #70. The dashboard's "Recent events" and "Retry queue" sections stay as placeholder panels until #70 lands.
- Connection activity event log / audit trail — not yet a domain concept.
- Real-time WebSocket updates — refresh is manual (polling future enhancement).
- Allegro-specific validation state — the diagnostics endpoint uses connection status from the connections table, not the Allegro validation endpoint.
- Database migrations — no schema changes needed; `sync_jobs` table already exists.

### Constraints

- `SyncJobRepositoryPort` is a CORE domain port — any new method must be read-only and non-destructive.
- The diagnostics endpoint is read-only, no auth scope beyond the existing JWT guard.
- FE must not import `sync.api.ts` job-listing methods that do not yet exist — use only what the API client already exposes.

---

## 3. Architecture Mapping

### Backend

**Target Layer**: Interface (controller) + Infrastructure (repository method)

**Affected files by layer:**

| Layer | File | Change |
|---|---|---|
| Domain / Port | `libs/core/src/sync/domain/ports/sync-job-repository.port.ts` | Add `findRecentByConnectionId` |
| Infrastructure | `libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.ts` | Implement new method |
| Interface / DTO | `apps/api/src/integrations/http/dto/connection-diagnostics-response.dto.ts` | New DTO |
| Interface / Controller | `apps/api/src/integrations/http/connection.controller.ts` | New `GET :id/diagnostics` endpoint |

**Ports involved:**
- `SyncJobRepositoryPort` (extended, in CORE)
- `SYNC_JOB_REPOSITORY_TOKEN` already exported from `SyncModule` — inject into `ConnectionController` via the existing token

**Core vs Integration justification**: The `SyncJobRepositoryPort` lives in CORE (`libs/core/src/sync/`) — this is correct. The new `findRecentByConnectionId` method is a pure read query that returns domain entities. The controller (`apps/api/src/integrations/http/`) is the Interface layer that assembles the diagnostics view model from two data sources (connection service + sync job repository), which is appropriate for a thin aggregation controller.

### Frontend

**Target Layer**: `features/health/` (new) + `features/connections/` (extended) + `pages/dashboard/` (replaced)

**Dependency direction**: `pages/dashboard` → `features/health` + `features/connections` → `shared` ✅

---

## 4. Internal Patterns Research

### Backend patterns followed

- **Port extension**: `SyncJobRepositoryPort` follows the same pattern as `ConnectionCursorRepositoryPort` — pure interface in domain, TypeORM implementation in infrastructure.
- **Controller injection**: `AllegroController` already injects `ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN` directly — same pattern for injecting `SYNC_JOB_REPOSITORY_TOKEN` into `ConnectionController`.
- **DTO static factory**: `ConnectionResponseDto.fromDomain(connection)` — same pattern for `ConnectionDiagnosticsResponseDto`.

### Frontend patterns followed

- **Feature API module**: `features/allegro/api/allegro.api.ts` + `allegro.query-keys.ts` → same structure for `features/health/api/`
- **Query hook**: `use-start-allegro-oauth-mutation.ts` (hook per file, returns full `UseMutationResult`) → same for `use-dev-stack-health-query.ts`
- **Connections extension**: add `getDiagnostics` to existing `ConnectionsApi` interface — same pattern as `handleCallback` was added to `AllegroApi`
- **Dashboard data states**: all four states (loading/error/empty/data) per `fe-pages.md` rules

---

## 5. Questions & Assumptions

### Assumptions

- **Diagnostics aggregation in controller**: The controller directly assembles the diagnostics view model from `ConnectionService` and `SyncJobRepositoryPort`. A dedicated service is not needed for this single read query — the controller is the appropriate aggregation point for MVP (consistent with `AllegroController` pattern).
- **Limit = 10**: The diagnostics endpoint returns the 10 most recent jobs, ordered by `createdAt DESC`. This is a fixed limit for MVP.
- **lastSucceededAt / lastFailedAt**: Derived from the recent job list — the `updatedAt` of the most recent job with `status === 'succeeded'` or `status IN ('failed', 'dead')` respectively.
- **`recentErrors`**: Array of non-null `lastError` strings from the recent job list, deduplicated, limited to 5.
- **No per-connection diagnostics on the dashboard main panel**: The dashboard shows the connection list from `GET /connections`. Clicking into a connection takes you to the connection detail page (future work in #63). The `GET /connections/:id/diagnostics` endpoint is consumed by the connection detail page eventually; the dashboard uses it only to show the last-active timestamp on each connection row. For MVP, the dashboard does NOT call diagnostics for each connection — that would be N+1 requests. The dashboard uses only `GET /connections` (list) + `GET /health/dev-stack`.
- **Refresh UX**: A single "Refresh" button in the dashboard `PageLayout` actions slot calls `refetch()` on all active queries.
- **Dashboard metric cards after this PR**: "Integration health" card shows real count. "Jobs needing attention", "Inventory conflicts", "Manual reviews" stay as placeholder values until #70 + future issues land.

### Open Questions

- Should `GET /connections/:id/diagnostics` require admin role or any authenticated user? **Assumption**: Any authenticated user (same as `GET /connections/:id`) — operators need to see this.
- Should `recentErrors` be deduplicated or ordered by recency? **Assumption**: Ordered by recency (same order as jobs), not deduplicated — keeps it simple and predictable.

---

## 6. Proposed Implementation Plan

### Phase 1 — Backend: extend the port and repository

**Step 1.1 — Add `findRecentByConnectionId` to `SyncJobRepositoryPort`**

- **File**: `libs/core/src/sync/domain/ports/sync-job-repository.port.ts`
- **Action**: Add method signature:
  ```typescript
  findRecentByConnectionId(connectionId: string, limit: number): Promise<SyncJob[]>;
  ```
- **Acceptance**: TypeScript compiles; existing port consumers still compile.

**Step 1.2 — Implement in `SyncJobRepository`**

- **File**: `libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.ts`
- **Action**: Implement using TypeORM query builder:
  ```typescript
  async findRecentByConnectionId(connectionId: string, limit: number): Promise<SyncJob[]> {
    const entities = await this.repository.find({
      where: { connectionId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return entities.map((e) => this.toDomain(e));
  }
  ```
- **Acceptance**: Unit test in `sync-job.repository.spec.ts` (if exists) or a targeted spec covering the new method; verifies correct ordering and limit.

---

### Phase 2 — Backend: diagnostics endpoint

**Step 2.1 — Create `ConnectionDiagnosticsResponseDto`**

- **File**: `apps/api/src/integrations/http/dto/connection-diagnostics-response.dto.ts`
- **Shape**:
  ```typescript
  export class ConnectionDiagnosticsResponseDto {
    connectionId: string;
    connectionName: string;
    connectionStatus: string;           // 'active' | 'disabled' | 'error'
    lastSucceededAt: string | null;     // ISO timestamp of most recent succeeded job
    lastFailedAt: string | null;        // ISO timestamp of most recent failed/dead job
    recentErrors: string[];             // lastError from recent failed/dead jobs
    recentJobs: RecentJobSummaryDto[];  // last N jobs
  }

  export class RecentJobSummaryDto {
    id: string;
    jobType: string;
    status: string;
    attempts: number;
    createdAt: string;
    updatedAt: string;
    lastError: string | null;
  }
  ```
- Add static `fromDomain(connection, recentJobs)` factory method.
- **Acceptance**: TypeScript compiles; Swagger decorators present.

**Step 2.2 — Add diagnostics endpoint to `ConnectionController`**

- **File**: `apps/api/src/integrations/http/connection.controller.ts`
- **Action**:
  1. Inject `SYNC_JOB_REPOSITORY_TOKEN` in constructor (already exported from `SyncModule`).
  2. Add `GET :id/diagnostics` handler:
     - Call `this.connectionService.get(id)` to get connection (throws `NotFoundException` if missing — existing pattern).
     - Call `this.syncJobRepository.findRecentByConnectionId(id, 10)`.
     - Build and return `ConnectionDiagnosticsResponseDto.fromDomain(connection, recentJobs)`.
  3. Add Swagger `@ApiOperation`, `@ApiResponse` decorators.
- **Acceptance**: `GET /connections/:id/diagnostics` returns the DTO; 404 for unknown IDs; unit test covers happy path + 404.

**Step 2.3 — Ensure `SyncModule` is imported in `IntegrationsModule`**

- **File**: `apps/api/src/integrations/integrations.module.ts`
- **Action**: Verify `SyncModule` is already imported (it likely is, as sync tokens are used elsewhere). If not, add it.
- **Acceptance**: `pnpm type-check` passes; `SYNC_JOB_REPOSITORY_TOKEN` resolves in `ConnectionController`.

---

### Phase 3 — Frontend: health feature module

**Step 3.1 — Create `features/health/api/health.types.ts`**

- **File**: `apps/web/src/features/health/api/health.types.ts`
- **Shape**:
  ```typescript
  export type ServiceStatus = 'ok' | 'degraded' | 'error';

  export interface ServiceHealth {
    status: 'ok' | 'error';
    message?: string;
  }

  export interface DevStackHealth {
    status: ServiceStatus;
    services: {
      postgres: ServiceHealth;
      redis: ServiceHealth;
      prestashop: ServiceHealth;
    };
    timestamp: string;
  }
  ```
- **Acceptance**: Types compile; no `any`.

**Step 3.2 — Create `features/health/api/health.query-keys.ts`**

- **File**: `apps/web/src/features/health/api/health.query-keys.ts`
- **Content**:
  ```typescript
  export const healthQueryKeys = {
    all: ['health'] as const,
    devStack: () => ['health', 'dev-stack'] as const,
  };
  ```

**Step 3.3 — Create `features/health/api/health.api.ts`**

- **File**: `apps/web/src/features/health/api/health.api.ts`
- **Content**:
  ```typescript
  export interface HealthApi {
    getDevStackHealth: () => Promise<DevStackHealth>;
  }

  export function createHealthApi(request: ApiRequest): HealthApi {
    return {
      getDevStackHealth: () => request<DevStackHealth>('/health/dev-stack'),
    };
  }
  ```

**Step 3.4 — Create `features/health/hooks/use-dev-stack-health-query.ts`**

- **File**: `apps/web/src/features/health/hooks/use-dev-stack-health-query.ts`
- **Content**: `useQuery` with `queryKey: healthQueryKeys.devStack()`, `queryFn: () => apiClient.health.getDevStackHealth()`, `retry: false` (health checks should fail fast).

---

### Phase 4 — Frontend: extend connections API with diagnostics

**Step 4.1 — Add `ConnectionDiagnostics` to `connections.types.ts`**

- **File**: `apps/web/src/features/connections/api/connections.types.ts`
- **Add**:
  ```typescript
  export interface RecentJobSummary {
    id: string;
    jobType: string;
    status: string;
    attempts: number;
    createdAt: string;
    updatedAt: string;
    lastError: string | null;
  }

  export interface ConnectionDiagnostics {
    connectionId: string;
    connectionName: string;
    connectionStatus: string;
    lastSucceededAt: string | null;
    lastFailedAt: string | null;
    recentErrors: string[];
    recentJobs: RecentJobSummary[];
  }
  ```

**Step 4.2 — Add `getDiagnostics` to `connections.api.ts`**

- **File**: `apps/web/src/features/connections/api/connections.api.ts`
- **Add** to `ConnectionsApi` interface and factory:
  ```typescript
  getDiagnostics: (connectionId: string) => Promise<ConnectionDiagnostics>;
  ```
  Implementation: `request<ConnectionDiagnostics>('/connections/${connectionId}/diagnostics')`

**Step 4.3 — Add `use-connection-diagnostics-query.ts`**

- **File**: `apps/web/src/features/connections/hooks/use-connection-diagnostics-query.ts`
- **Content**: `useQuery` with `queryKey: connectionsQueryKeys.diagnostics(connectionId)`, enabled only when `connectionId` is defined.
- Also extend `connections.query-keys.ts` with `diagnostics: (id: string) => ['connections', 'diagnostics', id] as const`.

---

### Phase 5 — Frontend: wire up api-client and test-utils

**Step 5.1 — Add `health` to `api-client.ts`**

- **File**: `apps/web/src/app/api/api-client.ts`
- Add `health: HealthApi` to `ApiClient` interface.
- Add `health: createHealthApi(request)` to the factory return.

**Step 5.2 — Add health mock to `test-utils.tsx`**

- **File**: `apps/web/src/test/test-utils.tsx`
- Add to `createMockApiClient`:
  ```typescript
  health: {
    getDevStackHealth: vi.fn().mockResolvedValue({
      status: 'ok',
      services: {
        postgres: { status: 'ok' },
        redis: { status: 'ok' },
        prestashop: { status: 'ok' },
      },
      timestamp: '2026-04-06T00:00:00.000Z',
    }),
    ...overrides.health,
  } as ApiClient['health'],
  ```
- Add `health?: Partial<ApiClient['health']>` to `DeepPartialApiClient`.

---

### Phase 6 — Frontend: replace dashboard static content

**Step 6.1 — Rewrite `dashboard-page.tsx`**

- **File**: `apps/web/src/pages/dashboard/dashboard-page.tsx`
- **Action**:
  1. Consume `useConnectionsQuery()` (already exists in `features/connections/hooks/`).
  2. Consume `useDevStackHealthQuery()` (new).
  3. **Metric strip** — "Integration health" card: show `{active}/{total}` connections from the query. Pending/failed count from connections with `status !== 'active'`. Keep "Jobs needing attention", "Inventory conflicts", "Manual reviews" as static placeholder cards with a "Coming soon" label.
  4. **Integration health panel** — replace hardcoded list with real connections from the query; show `StatusBadge` per connection status; show `createdAt` as "Connected since".
  5. **System health panel** — new panel showing Postgres / Redis / PrestaShop status from `useDevStackHealthQuery()` with `StatusBadge`.
  6. **Activity and retry panels** — keep as explicit placeholder panels with "Coming soon" chip (consistent with `ModulePlaceholderPage` pattern used elsewhere).
  7. **Refresh button** — in `PageLayout` `actions` slot; calls `connectionsQuery.refetch()` + `healthQuery.refetch()` on click.
  8. Handle loading, error, and empty states for each data-driven section per `fe-pages.md` rules.
- **Acceptance**: Dashboard shows real connection data and real health status; all states handled.

---

### Phase 7 — Tests

**Step 7.1 — BE: `connection.controller.spec.ts`**

- **File**: `apps/api/src/integrations/http/connection.controller.spec.ts`
- **Tests** (add to existing spec):
  - `should return diagnostics for existing connection`
  - `should throw 404 for unknown connection`
  - `should derive lastSucceededAt and lastFailedAt from recent jobs`

**Step 7.2 — FE: `use-dev-stack-health-query.test.ts`**

- **File**: `apps/web/src/features/health/hooks/use-dev-stack-health-query.test.ts`
- Test: hook fetches `/health/dev-stack` and returns the health data.

**Step 7.3 — FE: `dashboard-page.test.tsx`**

- **File**: `apps/web/src/pages/dashboard/dashboard-page.test.tsx`
- **Tests**:
  - Shows real connection count from API
  - Shows health status badges (ok/degraded/error)
  - Shows loading state for connections section
  - Shows error state for health section
  - Refresh button calls refetch

---

### Implementation Details

**DTO response shape for `GET /connections/:id/diagnostics`:**
```json
{
  "connectionId": "uuid",
  "connectionName": "Main PrestaShop Store",
  "connectionStatus": "active",
  "lastSucceededAt": "2026-04-06T10:00:00.000Z",
  "lastFailedAt": null,
  "recentErrors": [],
  "recentJobs": [
    {
      "id": "uuid",
      "jobType": "marketplace.orders.poll",
      "status": "succeeded",
      "attempts": 1,
      "createdAt": "2026-04-06T10:00:00.000Z",
      "updatedAt": "2026-04-06T10:01:00.000Z",
      "lastError": null
    }
  ]
}
```

**No database migration needed** — `sync_jobs` table exists; new query only reads from it.

**No new CSS needed** — `StatusBadge`, existing panel/metric-card classes, `toolbar-chip` all exist.

---

## 7. Alternatives Considered

### Alternative 1: Separate `ConnectionDiagnosticsService`

**Description**: Create a dedicated application service combining connection + sync job data instead of doing it in the controller.

**Why Rejected**: The diagnostics endpoint is a single read-only aggregation of two already-resolved data sources. A dedicated service would be a one-method wrapper with no domain logic. The controller pattern is already established in `AllegroController` for similar aggregations.

---

### Alternative 2: N+1 diagnostics calls on dashboard (one per connection)

**Description**: The dashboard calls `GET /connections/:id/diagnostics` for each connection to show last-sync timestamps inline.

**Why Rejected**: N+1 API calls from the dashboard would be a performance anti-pattern. The connection list from `GET /connections` is sufficient for the dashboard panel. Diagnostics are for detail views (`/connections/:id`).

---

### Alternative 3: Extend `GET /connections` list response to include diagnostic fields

**Description**: Add `lastSucceededAt`, `lastFailedAt` to the connection list DTO directly.

**Why Rejected**: Would require joining `sync_jobs` on every connections list call — expensive and adds complexity to a frequently-called endpoint. Keeping diagnostics as a separate endpoint follows the principle of progressive disclosure and keeps the list fast.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Port extended in CORE domain layer (not in infrastructure or application)
- ✅ Repository implementation in infrastructure layer
- ✅ Controller in interface layer, calls application service + injects repository directly (consistent with existing pattern)
- ✅ FE dependency direction: `pages` → `features` → `shared`

### Naming Conventions
- ✅ `sync-job-repository.port.ts` — existing file, method name follows camelCase
- ✅ `connection-diagnostics-response.dto.ts` — matches `*-response.dto.ts` pattern
- ✅ `health.api.ts`, `health.types.ts`, `health.query-keys.ts` — matches established API module pattern
- ✅ `use-dev-stack-health-query.ts` — matches `use-{resource}-query.ts` hook pattern
- ✅ `use-connection-diagnostics-query.ts` — matches hook pattern

### Risks

- **`SyncModule` not imported in `IntegrationsModule`**: If `IntegrationsModule` doesn't already import `SyncModule`, `SYNC_JOB_REPOSITORY_TOKEN` won't resolve → controller will fail at startup. **Mitigation**: verify in Step 2.3; add import if missing.
- **`sync_jobs` table empty in dev**: The dashboard's real connection list and health data will still render; only the diagnostics-driven fields will show empty arrays. Gracefully handled by `recentJobs: []`.
- **`/health/dev-stack` PrestaShop check slow**: The dev-stack health endpoint calls PrestaShop synchronously. In environments where PrestaShop is down, this call might be slow. **Mitigation**: TanStack Query's `retry: false` and the `staleTime` setting prevent hammering a slow endpoint.
- **`useConnectionsQuery` already used in ConnectionsOverview**: Dashboard reuses the same query key — TanStack Query will deduplicate the requests. No duplicate API calls.

### Edge Cases
- Connection with zero sync jobs: `recentJobs: []`, `lastSucceededAt: null`, `lastFailedAt: null`, `recentErrors: []`.
- All jobs failed: `lastSucceededAt: null`, `lastFailedAt` = most recent `updatedAt`.
- Dashboard with zero connections: show `EmptyState` in the connection health panel with a "Add connection" CTA.

### Backward Compatibility
- ✅ Existing `SyncJobRepositoryPort` consumers unaffected (new method added, existing methods unchanged)
- ✅ Existing `GET /connections` endpoints unchanged
- ✅ Existing `connections.api.ts` methods unchanged (additive extension)

---

## 9. Testing Strategy & Acceptance Criteria

### Backend Unit Tests

**File**: `apps/api/src/integrations/http/connection.controller.spec.ts` (extend existing)
- `GET /connections/:id/diagnostics` — happy path returns DTO
- `GET /connections/:id/diagnostics` — 404 when connection not found
- `lastSucceededAt` derived from most recent succeeded job's `updatedAt`
- `lastFailedAt` derived from most recent failed/dead job's `updatedAt`

**Mocking strategy**: Mock `ConnectionService` and `SyncJobRepositoryPort` (not concrete classes).

### Frontend Tests

**`use-dev-stack-health-query.test.ts`**: hook returns health data; handles error state.

**`dashboard-page.test.tsx`** (extend or replace existing):
| Test | Arrangement | Assertion |
|---|---|---|
| Shows real connection count | mock connections list | `2 connections` (or equivalent) visible |
| Shows health status ok | mock health response `status: ok` | "ok" badge or equivalent visible |
| Shows health status degraded | mock health response `status: degraded` | degraded state visible |
| Shows loading for connections | never-resolving connection list | loading state visible |
| Shows error for health | health query rejects | error state in health panel |
| Refresh button calls refetch | render then click | both queries refetched |

### Acceptance Criteria

- [x] `GET /connections/:id/diagnostics` returns correct DTO structure
- [x] Dashboard "Integration health" metric shows real connection count
- [x] Dashboard "System health" panel shows Postgres / Redis / PrestaShop status from `/health/dev-stack`
- [x] Dashboard connection list shows real connections with status badges
- [x] All data-driven sections handle loading, error, and empty states
- [x] Refresh button refetches all live data
- [x] Sync-jobs sections are visible but clearly labelled as "Coming soon"

### Quality Gate

```bash
pnpm lint        # zero errors
pnpm type-check  # zero errors
pnpm test        # all unit tests pass
```

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (port in domain, impl in infrastructure, aggregation in controller)
- [x] Respects CORE vs Integration boundaries (SyncJobRepositoryPort extended in CORE)
- [x] Uses existing patterns (no new abstractions beyond what the task requires)
- [x] Idempotency considered (read-only endpoint, N/A for writes)
- [x] Event-driven patterns used where applicable (N/A — synchronous read query)
- [x] Rate limits & retries addressed (health query uses `retry: false`)
- [x] Error handling comprehensive (404 for unknown connections; loading/error states in FE)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Testing Guide](../testing-guide.md)
