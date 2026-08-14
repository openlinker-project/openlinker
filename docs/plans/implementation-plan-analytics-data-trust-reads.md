# Implementation Plan: Analytics Data-Trust Reads (Backend)

**Date**: 2026-08-11
**Status**: Draft
**Estimated Effort**: 1.5–2.5 days
**Issue**: [#1982](https://github.com/openlinker-project/openlinker/issues/1982)

---

## 1. Task Summary

**Objective**: Expose a single, read-only API endpoint that reports — per `OrderSource`-capable connection — when it last successfully ingested, how far back its data goes, and whether its ingestion has stalled, so the future `/analytics` page can disclose the limits of the data it reports over before rendering any figure.

**Context**: Part of the `/analytics` page effort (#1976, `docs/specs/product-spec-1976-analytics.md` § 4 group L, § 6 "Trust header", story S5). The spec frames this as the highest-value, lowest-cost slice of the whole page: "sales dropped 40%" and "the Allegro poll died on Tuesday" render identically without it, and every input already exists (`sync_jobs`, scheduler cadence, `connections.createdAt`). This issue ships the backend read only; the `/analytics` route shell that renders it is a separate, blocked-on-this issue.

**Classification**: CORE (new bounded-context read service) + Interface (one controller/DTO in `apps/api`).

---

## 2. Scope & Non-Goals

### In Scope
- One aggregate endpoint returning, for every active connection with `OrderSource` enabled: last-successful-ingestion timestamp, earliest-available-data-point timestamp, and a stalled/fresh/never-ingested status.
- Staleness threshold derived from the connection's own platform's registered polling cadence (not a fixed constant).
- Distinguishing "never ingested" from "ingested then stalled."
- Unit tests for the computation logic; one integration test for the end-to-end read.

### Out of Scope
- Any business/revenue metric (explicitly excluded by the issue).
- Changing ingestion behaviour, scheduling, or retry logic — this is a read-only projection over existing state.
- Surfacing these facts on the `/` operational dashboard (it already has its own health surfaces — `DevStackHealthService` / `ConnectionInfraHealthService` — which this issue does not touch or duplicate).
- The `/analytics` FE route shell and Trust-header UI (separate, downstream issue).
- Any capability other than `OrderSource` (the issue and spec both scope this to order ingestion; `ProductMaster`/`InventoryMaster` freshness is not requested).

### Constraints
- Response must be answerable in a single call, before any other analytics figure renders (AC).
- No new ESLint warnings or type errors (AC) — must pass `pnpm lint` / `pnpm type-check`.
- Must not introduce a `synchronize: true`-relevant schema change; this issue adds **no new tables** (see § 6 for why).

---

## 3. Architecture Mapping

**Target Layer**: CORE (`libs/core/src/analytics-trust/`, new bounded context) + Interface (`apps/api/src/analytics-trust/`).

**Capabilities Involved**:
- `OrderSource` (existing) — read-only, via `IIntegrationsService.listCapabilityAdapters`. No new port.

**Existing Services / Ports Reused**:
- `IIntegrationsService.listCapabilityAdapters<T>({ capability: 'OrderSource', lazy: true })` (`@openlinker/core/integrations`, token `INTEGRATIONS_SERVICE_TOKEN`) — enumerates every active connection with `OrderSource` enabled, without constructing adapter instances (`lazy: true`).
- `SyncJobRepositoryPort` (`@openlinker/core/sync`, token `SYNC_JOB_REPOSITORY_TOKEN`) — one new method added (see § 6); everything else reused as-is.
- `SchedulerTaskRegistryService` + `SchedulerTaskConfig` (`@openlinker/core/sync`) — already-registered per-platform cron cadence for `jobType: 'marketplace.orders.poll'`. Reused read-only via `getAll()`.
- `Connection` entity's `createdAt` (`@openlinker/core/identifier-mapping`) — reused as the coverage-window start.

**New Components Required**:
- New bounded context `libs/core/src/analytics-trust/` (domain types + one pure domain-service function + one application service + its interface + DI tokens).
- One new `SyncJobRepositoryPort` method: `findLastSucceededByConnectionAndJobType`.
- New API module `apps/api/src/analytics-trust/` (controller + response DTO), registered in `app.module.ts`.

**Core vs Integration Justification**: This is CORE, not an integration adapter — it composes two existing CORE services (`IIntegrationsService`, `SyncJobRepositoryPort`) and a CORE registry (`SchedulerTaskRegistryService`) into a cross-cutting read model. No platform-specific logic is introduced; every platform (Allegro, PrestaShop, Erli, WooCommerce) is read identically through their already-registered `OrderSource` capability and scheduler task.

**Naming decision (flagged explicitly — see § 5)**: `libs/core/src/analytics` and `apps/api/src/analytics` **already exist** but implement the unrelated PostHog telemetry-consent settings (`CoreAnalyticsModule` in `app.module.ts`, comment: "DB-backed PostHog analytics settings resolution"). Reusing that folder/module name for this feature would conflate two unrelated domains. This plan uses the distinct name **`analytics-trust`** for both the core context and the API module. The existing PostHog `/posthog-settings` controller route is unaffected; this feature's controller registers its own route at `GET /analytics/trust`, which is free (no existing controller claims the `/analytics` URL prefix).

---

## 4. External / Domain Research

### Internal Patterns (codebase research findings)

- **Aggregate-read precedent**: `apps/api/src/health/dev-stack-health.service.ts` (`DevStackHealthService.checkDevStackHealth`) is the closest existing shape — it builds one response by running several checks in parallel (`Promise.all`), and its `checkInfraConnections()` delegates to `ConnectionInfraHealthService.checkInfraConnections()`, which iterates connections into a flat `ConnectionHealthEntry[]`, catching per-connection failures so one bad probe never 500s the whole response. This plan's service follows the same per-connection-catch discipline: a scheduler-lookup miss or a repository error for one connection degrades that one entry, not the whole response.
- **Sync job schema**: `libs/core/src/sync/domain/entities/sync-job.entity.ts` — `SyncJob { id, jobType, connectionId, status, outcome, outcomeReason, createdAt, updatedAt, ... }`. `status: 'queued'|'running'|'succeeded'|'dead'`. `SyncJobRepositoryPort.findMany(filters, pagination)` supports `{ status, connectionId, jobType, outcome }` filters but orders by `createdAt DESC` only — `createdAt` is *enqueue* time, not completion time, so it is not precise enough for "last-successful-ingestion time" (see § 6 for the new method this motivates).
- **Scheduler cadence registry**: `libs/core/src/sync/infrastructure/adapters/scheduler-task-registry.service.ts` (`SchedulerTaskRegistryService`) holds every `SchedulerTaskConfig` contributed by integration plugins at boot (`getAll()`). Confirmed order-poll tasks today: `allegro-orders-poll`, `prestashop-orders-poll`, `erli-orders-poll`, `woocommerce-orders-poll` — every one has `jobType: 'marketplace.orders.poll'`, `requiredCapability: 'OrderSource'`, and a `cronExpression` (e.g. `*/5 * * * *`). Every current `OrderSource`-capable platform has exactly one matching task, keyed by `platformType`. This registry is exported from the core barrel (`@openlinker/core/sync`).
- **Cron parsing**: `apps/api/src/sync/application/services/scheduler.service.ts` already depends on the `cron` npm package (`apps/api/package.json`, pinned `3.1.3`) to drive `@nestjs/schedule` cron jobs from `cronExpression`. Reusing the same library (added as a `libs/core/package.json` dependency) to compute "expected interval" keeps the estimate consistent with what the scheduler will actually do, rather than hand-rolling a second cron parser.
- **Connection entity**: `libs/core/src/identifier-mapping/domain/entities/connection.entity.ts` — `Connection { id, platformType, name, status, config, credentialsRef, createdAt, updatedAt, adapterKey, enabledCapabilities }`. `createdAt` is the field the spec (L2) explicitly names as the coverage-window start.
- **No existing gap-filling method**: neither `OrderRecordRepository` nor any other repository exposes "earliest successfully-ingested order per connection" — see § 6 for why this plan does not add one.

### External System
Not applicable — this issue reads only OL's own persisted state (sync jobs, scheduler registry, connection metadata). No new external API calls.

---

## 5. Questions & Assumptions

### Open Questions
- Should the endpoint eventually take a `platformType` or `connectionId` filter? The issue's AC says "for each order-source connection" (implying "all of them, unfiltered") and "a single call the page can make before rendering any figure" (implying no per-connection round-trips) — this plan ships **unfiltered, all-`OrderSource`-connections** and defers filtering to a follow-up if the FE route-shell issue needs it.
- Exact FE route path for the future "link to the sync detail" (S5 AC: "with a link to the sync detail") is not this issue's concern, but the response should carry enough identifying data (`connectionId`, `platformType`) for the FE to construct that link later without a second lookup. Addressed by including both fields per entry.

### Assumptions (with rationale — proposed as safe defaults)
1. **Coverage-window start = `connection.createdAt`**, not "earliest successfully-ingested order." The issue AC says "earliest available data point," and the spec (L2) says "connection `createdAt`" verbatim — the two documents don't use identical wording, but the spec is the more specific, deliberately-🟢-scoped source, and `createdAt` costs zero new queries. **Rejected alternative**: `MIN(order_records.createdAt) GROUP BY sourceConnectionId` — more literally "the earliest data point," but adds a new aggregate query, and a connection's data could start *later* than `createdAt` for reasons unrelated to trustworthiness (e.g. a quiet first week), which would make the "channel connected 6 days ago" framing *less* accurate, not more — the connection's age is what makes a short-history channel legitimately incomparable to a long-history one, regardless of when its first order happened to land.
2. **Ingestion heartbeat = the connection's registered `marketplace.orders.poll` job**, not a broader "any order-related job type" search, and not the order-feed cursor. Rationale: every current `OrderSource` adapter (Allegro, PrestaShop, Erli, WooCommerce) registers exactly one `marketplace.orders.poll` `SchedulerTaskConfig`, which runs on a fixed tick **regardless of whether any order actually changed** — making it a true "is the pipeline alive" heartbeat. `marketplace.order.sync` (the per-order-event job) is a poor freshness signal on its own: a quiet week with zero new orders would look identical to a dead poll if measured by "last successful `marketplace.order.sync`." Using the poll job's own success timestamp instead means "no news" (zero orders) is never mistaken for "no ingestion" (dead poll) — which is exactly the ambiguity the issue exists to resolve. **Rejected alternative**: reading the connection's order-feed cursor's `updatedAt` (`ConnectionCursorRepositoryPort`) — this would track almost the same clock as the poll job's own success (the poll job is what advances the cursor) but adds a second, redundant data source with its own edge cases (a cursor that legitimately never advances because the feed is empty). Single source of truth (sync jobs) is preferred.
3. **A connection whose platform has no matching `marketplace.orders.poll` scheduler task** (hypothetically, a future webhook-only integration with no backstop poll) degrades gracefully: `expectedIntervalMs` and `staleAfterMs` are `null`, and status can only be `'never-ingested'` or `'fresh'` (never `'stalled'`, since no cadence exists to measure against). This does not affect any platform shipping today — see § 4 confirmation that all four current `OrderSource` platforms register a poll task — but is handled rather than assumed away, since a new plugin author should not silently and incorrectly show as permanently "stalled."
4. **Staleness threshold = `3 × expectedIntervalMs`** (a fixed multiplier, not a per-platform override). Three missed ticks is enough slack to absorb one worst-case processing delay plus jitter without false-positiving on a slow-but-alive poller, while still catching a genuinely dead poll well before it looks like a multi-day outage. No existing precedent for a different multiplier was found in the codebase; this is a new, explicit constant (`STALE_THRESHOLD_MULTIPLIER = 3`, defined once in the new domain-service file) that a future issue can tune without touching call sites.
5. **`cronExpression` → `expectedIntervalMs`** is derived narrowly: parse via the `cron` package's `CronJob`, take `nextDate()` twice from "now," and diff them. This correctly handles the fixed-interval expressions every current task uses (`*/N * * * *`) but is **not** a general cron-interval solver — an irregular expression (e.g. "only at 3am and 3pm") would report the gap between those two specific fires, not a true average interval. Documented as a known, currently-inapplicable limitation rather than solved, since no registered task today is irregular.

### Documentation Gaps
- `docs/architecture-overview.md` does not yet document a "cross-connection read model that composes `sync` + `integrations` + `identifier-mapping`" pattern; this issue's context is the first of its kind. No existing doc section needs correction, but a one-line addition to the Sync Manager or a new "Analytics Trust" subsection could be added post-merge if this pattern is reused (left as a suggestion, not required by this plan).

---

## 6. Proposed Implementation Plan

### Phase 1: CORE — domain types + pure computation

**Goal**: Establish the new `analytics-trust` bounded context's domain layer with zero framework dependencies, per `docs/architecture-overview.md` § Hexagonal Architecture Structure.

**Steps**:

1. **Domain types**
   - **File**: `libs/core/src/analytics-trust/domain/types/connection-ingestion-trust.types.ts`
   - **Action**: Define
     ```ts
     export const ConnectionIngestionStatusValues = ['never-ingested', 'fresh', 'stalled'] as const;
     export type ConnectionIngestionStatus = (typeof ConnectionIngestionStatusValues)[number];

     export interface ConnectionIngestionTrust {
       connectionId: string;
       connectionName: string;
       platformType: string;
       status: ConnectionIngestionStatus;
       lastSuccessfulIngestionAt: Date | null;
       coverageStartAt: Date; // = connection.createdAt
       expectedIntervalMs: number | null; // null when no matching scheduler task
       staleAfterMs: number | null;
     }

     export interface AnalyticsTrustSnapshot {
       generatedAt: Date;
       connections: ConnectionIngestionTrust[];
     }
     ```
   - **Acceptance**: File has no imports beyond TS stdlib; `as const` pattern used per `docs/engineering-standards.md § Union Types`.

2. **Pure domain-service: staleness classification + cron-interval estimation**
   - **File**: `libs/core/src/analytics-trust/domain/domain-services/ingestion-trust.domain-service.ts`
   - **Action**: Two exported pure functions (no I/O, no framework — consistent with the as-yet-uninstantiated `domain-services/` convention in `docs/engineering-standards.md`):
     - `classifyIngestionStatus(lastSuccessfulIngestionAt: Date | null, staleAfterMs: number | null, now: Date): ConnectionIngestionStatus` — `null` last-success → `'never-ingested'`; else `'stalled'` iff `staleAfterMs !== null && now.getTime() - lastSuccessfulIngestionAt.getTime() > staleAfterMs`; else `'fresh'`.
     - `estimateCronIntervalMs(cronExpression: string, now: Date): number | null` — uses the `cron` package's `CronJob` to compute the gap between the next two fire times from `now`; returns `null` on parse failure (caught internally, logged by the caller, never thrown — a malformed cron expression must degrade one connection's `expectedIntervalMs`, not crash the whole read).
   - **Acceptance**: Both functions covered by table-driven unit tests (§ 9) with no mocks needed — pure functions.
   - **Dependency note**: Add `cron` (`^3.1.3`, matching `apps/api/package.json`'s pin) to `libs/core/package.json` `dependencies` — required by the workspace-dependency-declaration rule (`docs/engineering-standards.md § Workspace dependency declarations`) since this file imports it directly.

3. **Constants**
   - **File**: `libs/core/src/analytics-trust/domain/types/connection-ingestion-trust.types.ts` (co-located; no separate constants file needed for two values)
   - **Action**: `export const STALE_THRESHOLD_MULTIPLIER = 3;`
   - **Acceptance**: Referenced by the domain-service and by tests, not hardcoded twice.

### Phase 2: CORE — application service

**Goal**: Compose `IIntegrationsService`, `SyncJobRepositoryPort`, and `SchedulerTaskRegistryService` into one read, following the per-connection-catch discipline of `ConnectionInfraHealthService`.

**Steps**:

4. **New repository port method** (small, additive — does not touch any other method)
   - **File**: `libs/core/src/sync/domain/ports/sync-job-repository.port.ts`
   - **Action**: Add
     ```ts
     /**
      * Find the most recently *completed* succeeded job for a connection and
      * job type, ordered by `updatedAt` DESC (the moment it flipped to
      * succeeded) rather than `createdAt` (enqueue time) — the precise
      * "last successful ingestion" timestamp (#1982).
      */
     findLastSucceededByConnectionAndJobType(
       connectionId: string,
       jobType: JobType
     ): Promise<SyncJob | null>;
     ```
   - **Acceptance**: New method added to the interface only in this step; implementation in Step 5.
   - **Why not reuse `findMany`**: `findMany` orders by `createdAt` (enqueue time) per its own doc comment — using it here would occasionally misreport freshness for a job that sat queued for a while before running. A dedicated method ordered by `updatedAt` is the correct, minimal addition rather than accepting an imprecise reuse.

5. **Implement the new port method**
   - **File**: `libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.ts` (existing `SyncJobRepository` — exact filename to confirm against the current tree at implementation time, following the same pattern as the neighboring `findRecentByConnectionId`)
   - **Action**: `SELECT ... WHERE connectionId = :connectionId AND jobType = :jobType AND status = 'succeeded' ORDER BY updatedAt DESC LIMIT 1`, mapped through the repository's existing private `toDomain`.
   - **Acceptance**: Unit test mocking the TypeORM repository confirms the query shape (existing pattern in `sync-job.repository.spec.ts`).

6. **Service interface**
   - **File**: `libs/core/src/analytics-trust/application/services/analytics-trust.service.interface.ts`
   - **Action**:
     ```ts
     export interface IAnalyticsTrustService {
       getIngestionTrustSnapshot(): Promise<AnalyticsTrustSnapshot>;
     }
     ```

7. **Application service**
   - **File**: `libs/core/src/analytics-trust/application/services/analytics-trust.service.ts`
   - **Action**: `AnalyticsTrustService implements IAnalyticsTrustService`, constructor-injecting:
     - `@Inject(INTEGRATIONS_SERVICE_TOKEN) integrationsService: IIntegrationsService` (`@openlinker/core/integrations`)
     - `@Inject(SYNC_JOB_REPOSITORY_TOKEN) syncJobRepository: SyncJobRepositoryPort` (`@openlinker/core/sync`)
     - `schedulerTaskRegistry: SchedulerTaskRegistryService` (`@openlinker/core/sync`)

     `getIngestionTrustSnapshot()`:
     1. `const entries = await this.integrationsService.listCapabilityAdapters({ capability: 'OrderSource', lazy: true });`
     2. `const pollTasks = this.schedulerTaskRegistry.getAll().filter(t => t.jobType === 'marketplace.orders.poll');`
     3. `Promise.all(entries.map(entry => this.buildTrustEntry(entry.connection, pollTasks)))` — **each `buildTrustEntry` call is wrapped in try/catch internally** (mirroring `ConnectionInfraHealthService`'s per-connection isolation): a failure for one connection logs a warning and returns a degraded entry (`status: 'never-ingested'`, nulls elsewhere) rather than failing the whole snapshot.
     4. Private `buildTrustEntry(connection, pollTasks)`:
        - Find `matchingTask = pollTasks.find(t => t.platformType === connection.platformType)`.
        - `expectedIntervalMs = matchingTask ? estimateCronIntervalMs(matchingTask.cronExpression, now) : null`.
        - `staleAfterMs = expectedIntervalMs !== null ? expectedIntervalMs * STALE_THRESHOLD_MULTIPLIER : null`.
        - `lastJob = matchingTask ? await this.syncJobRepository.findLastSucceededByConnectionAndJobType(connection.id, matchingTask.jobType) : null`.
        - `lastSuccessfulIngestionAt = lastJob ? new Date(lastJob.updatedAt) : null`.
        - `status = classifyIngestionStatus(lastSuccessfulIngestionAt, staleAfterMs, now)`.
        - Return the `ConnectionIngestionTrust` object (§ Phase 1, Step 1), with `coverageStartAt = connection.createdAt`.
   - **Acceptance**: Fully unit-testable by mocking the three injected dependencies (all ports/services, none concrete — per `docs/engineering-standards.md § Ports vs. Concrete Implementations`).

8. **Tokens + module**
   - **File**: `libs/core/src/analytics-trust/analytics-trust.tokens.ts`
   - **Action**: `export const ANALYTICS_TRUST_SERVICE_TOKEN = Symbol('IAnalyticsTrustService');` — per `docs/engineering-standards.md § Symbol DI Token Re-export Convention`.
   - **File**: `libs/core/src/analytics-trust/analytics-trust.module.ts`
   - **Action**: `AnalyticsTrustModule` — imports `SyncModule` (for `SYNC_JOB_REPOSITORY_TOKEN` + `SchedulerTaskRegistryService`) and `IntegrationsModule` (for `INTEGRATIONS_SERVICE_TOKEN`), provides `AnalyticsTrustService` bound to `ANALYTICS_TRUST_SERVICE_TOKEN`, exports the token.
   - **File**: `libs/core/src/analytics-trust/index.ts`
   - **Action**: Barrel — `export * from './analytics-trust.tokens';`, plus the service interface, types, and `AnalyticsTrustModule`. **Not** exported: the concrete `AnalyticsTrustService` class, and no ORM entities exist in this context (there is nothing to persist — this context is a pure read composition, so no `orm-entities` sub-barrel is needed).
   - **File**: `libs/core/src/index.ts` (top-level core barrel, if one aggregates sub-barrels — verify at implementation time) or `libs/core/package.json` `exports` map — register `@openlinker/core/analytics-trust` alongside sibling context barrels, per `docs/engineering-standards.md § Import Aliases`.

### Phase 3: Interface — controller + DTO

**Goal**: One GET endpoint returning the snapshot, mounted under `/analytics/trust`.

**Steps**:

9. **Response DTO**
   - **File**: `apps/api/src/analytics-trust/dto/analytics-trust-response.dto.ts`
   - **Action**: Swagger-annotated response classes mirroring `ConnectionIngestionTrust` / `AnalyticsTrustSnapshot` field-for-field (explicit projection, not a spread — per the MCP-tools precedent in `docs/engineering-standards.md`, response shapes are always an explicit allowlist even outside MCP; here it also lets Swagger document each field). ISO-string dates on the wire (`lastSuccessfulIngestionAt: string | null`, `coverageStartAt: string`), matching the rest of the API's JSON date convention.
   - **Acceptance**: `@ApiProperty({ enum: ConnectionIngestionStatusValues })` on `status`.

10. **Controller**
    - **File**: `apps/api/src/analytics-trust/http/analytics-trust.controller.ts`
    - **Action**:
      ```ts
      @Controller('analytics')
      @UseGuards(JwtAuthGuard)
      export class AnalyticsTrustController {
        constructor(
          @Inject(ANALYTICS_TRUST_SERVICE_TOKEN)
          private readonly analyticsTrustService: IAnalyticsTrustService,
        ) {}

        @Get('trust')
        async getTrust(): Promise<AnalyticsTrustResponseDto> {
          const snapshot = await this.analyticsTrustService.getIngestionTrustSnapshot();
          return toAnalyticsTrustResponseDto(snapshot); // small private mapper, colocated or in the DTO file
        }
      }
      ```
    - **Acceptance**: `GET /analytics/trust` returns 200 with the documented shape; requires an authenticated session per `docs/engineering-standards.md § Security baselines` (`@UseGuards(JwtAuthGuard)` on all non-public endpoints — no `@Roles()` restriction needed, this is an operator-facing read available to any authenticated role, consistent with other analytics-adjacent reads).

11. **API module + registration**
    - **File**: `apps/api/src/analytics-trust/analytics-trust.module.ts`
    - **Action**: `AnalyticsTrustApiModule` — imports `AnalyticsTrustModule` (core), declares `AnalyticsTrustController`.
    - **File**: `apps/api/src/app.module.ts`
    - **Action**: Add `AnalyticsTrustApiModule` to the `imports` array (alongside `HealthModule`, `SyncModule`, etc.), with a short inline comment distinguishing it from the pre-existing `CoreAnalyticsModule` (PostHog) import a few lines above.

### Implementation Details Summary

**New Components**:
- **Domain**: `connection-ingestion-trust.types.ts`, `ingestion-trust.domain-service.ts` (2 pure functions)
- **Application**: `analytics-trust.service.interface.ts`, `analytics-trust.service.ts`, `analytics-trust.module.ts`, `analytics-trust.tokens.ts`
- **Interface**: `analytics-trust.controller.ts`, `analytics-trust-response.dto.ts`, `analytics-trust.module.ts` (API-layer)
- **Sync context (extended, not new)**: one new method on `SyncJobRepositoryPort` + its implementation

**Configuration Changes**: None (no new env vars).

**Database Migrations**: **None.** This context reads existing tables only (`sync_jobs`, `connections`) through existing ports; no schema change. Confirm with `pnpm --filter @openlinker/api migration:show` before considering Phase 4 complete, per `docs/architecture-overview.md`'s quality-gate note.

**Events**: None emitted or consumed — this is a synchronous read, no orchestration.

**Error Handling**: Per-connection failures inside `AnalyticsTrustService.buildTrustEntry` are caught and logged (`Logger` from `@openlinker/shared/logging`), never thrown past the service boundary — one bad connection must degrade its own entry, not 500 the whole page's trust header (mirrors `ConnectionInfraHealthService`). No new domain exceptions are needed; there is no invariant this feature can violate (it is read-only).

---

## 7. Alternatives Considered

### Alternative 1: Extend `apps/api/src/health/` instead of a new context
- **Description**: Add ingestion-trust as another field on `DevStackHealthResponse` / `ConnectionHealthEntry`, reusing `ConnectionInfraHealthService`.
- **Why Rejected**: The issue explicitly excludes surfacing these facts on the `/` operational dashboard, and `ConnectionInfraHealthService` checks *reachability* (can we call the platform's API right now?), not *ingestion history* (has this connection's order pipeline been advancing?) — a connection can be perfectly reachable while its poll scheduler task is silently disabled, and vice versa. Conflating the two would make `/` dashboard changes accidentally affect the future `/analytics` page and vice versa.
- **Trade-offs**: A new context has more boilerplate (module, tokens, barrel) than one more field on an existing DTO, but keeps the two health notions — infra reachability vs. ingestion trust — cleanly separable, matching the issue's own "blocks the `/analytics` route shell" dependency framing (this is analytics-page infrastructure, not general health).

### Alternative 2: Query the order-feed cursor's `updatedAt` for freshness instead of the sync-job table
- **Description**: Use `ConnectionCursorRepositoryPort.findOne(connectionId, cursorKey)`'s `updatedAt` as the "last successful ingestion" signal.
- **Why Rejected**: See § 5 Assumption 2 — the cursor's clock and the poll job's success clock track almost the same event (the poll job is what advances the cursor), so this is a redundant second source rather than a materially different one, and it introduces its own edge case (a cursor key that legitimately never gets written for a brand-new connection, which is harder to distinguish from "never ingested" than a simple `null` last-succeeded-job read).
- **Trade-offs**: The cursor *is* closer to "the literal low-level mechanism," but the sync-job table is the higher-level, already-`outcome`-tracked signal (ADR-007) and is what every other job-observability surface in the codebase already reads from.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Domain layer (`domain/types/`, `domain/domain-services/`) has zero NestJS/TypeORM imports — only the `cron` package (a plain utility, not a framework), consistent with `docs/engineering-standards.md § Domain Layer Independence`.
- ✅ Application service depends only on port interfaces / service interfaces (`SyncJobRepositoryPort`, `IIntegrationsService`) and one registry class (`SchedulerTaskRegistryService`, itself framework-light) — no adapter or repository class is injected directly.
- ✅ Cross-context imports (`@openlinker/core/integrations`, `@openlinker/core/sync`, transitively `@openlinker/core/identifier-mapping` via `Connection`) use only allowed shapes per `docs/architecture-overview.md § Cross-context dependencies in core`: `IIntegrationsService` (`I*Service`), `INTEGRATIONS_SERVICE_TOKEN`/`SYNC_JOB_REPOSITORY_TOKEN` (`*_TOKEN`), `SyncJobRepositoryPort` (`*Port`), `SchedulerTaskRegistryService`/`SchedulerTaskConfig`, `Connection` entity by value. No `*RepositoryPort` other than the one already-allowed `SyncJobRepositoryPort`-shaped import, no ORM entity, no adapter class.

### Naming Conventions
- ✅ `*.types.ts`, `*.service.interface.ts`, `*.service.ts`, `*.tokens.ts`, `*.module.ts`, `*.controller.ts`, `*.dto.ts` — all match `docs/engineering-standards.md § Naming Conventions`.
- ✅ `AnalyticsTrustService implements IAnalyticsTrustService` — interface + impl in separate files.
- ✅ `ConnectionIngestionStatusValues` as-const union, not an enum.

### Existing Patterns
- ✅ Per-connection failure isolation mirrors `ConnectionInfraHealthService`.
- ✅ New repository method mirrors the existing `findRecentByConnectionId` method's shape/doc-comment style on the same port.

### Risks
- **Cron-expression drift**: if a future platform registers an irregular `cronExpression` (not `*/N`), `estimateCronIntervalMs` will report a interval based on the next two fires from "now," which for an irregular schedule may not represent the *typical* gap. **Mitigation**: documented as a known limitation (§ 5, Assumption 5); revisit only if/when a non-uniform schedule is actually registered — none is today.
- **`cron` package added to `libs/core`**: increases core's dependency surface by one small, already-vetted, non-framework package. **Mitigation**: it is already a direct dependency of `apps/api`, so no new transitive risk is introduced to the dependency tree as a whole — only the declaration moves one layer down to where it's actually used, per the Workspace dependency declarations rule.
- **Scheduler task registry populated only after plugin `onModuleInit`**: if `AnalyticsTrustService` is called before every plugin has registered its scheduler tasks (unlikely in a running API process, since `onModuleInit` runs at boot before any HTTP request is served), `pollTasks` could be incomplete for a request racing boot. **Mitigation**: this is an existing property of `SchedulerTaskRegistryService` shared by every other consumer (e.g. `SchedulerService` itself) — not a new risk introduced by this issue; NestJS's lifecycle guarantees `onModuleInit` completes before the HTTP listener starts accepting connections.

### Edge Cases
- **Never-ingested connection** (brand-new, zero succeeded jobs yet): `lastSuccessfulIngestionAt = null` → `status = 'never-ingested'`, distinguishable from `'stalled'` (AC2 — explicitly satisfied).
- **Connection whose platform has no registered poll task** (§ 5 Assumption 3): `expectedIntervalMs = null`, `staleAfterMs = null`, status can only be `'never-ingested'` or `'fresh'`.
- **Zero `OrderSource` connections at all** (day-one instance, spec L4): `connections: []` — the FE reads this as the explicit empty state; no special-casing needed server-side (an empty array is already an unambiguous signal, so no separate `isEmpty` flag is added).
- **A connection disabled `OrderSource` after having ingested successfully in the past**: `listCapabilityAdapters({ capability: 'OrderSource' })` excludes it (only currently-enabled connections are listed) — consistent with the issue's framing ("for each order-source connection," present tense) and avoids reporting stale trust data for a capability the operator turned off.

### Backward Compatibility
- ✅ Purely additive: new context, new module, new route, one new port method (interface addition — every existing `SyncJobRepositoryPort` implementer, i.e. only `SyncJobRepository`, gains one method; no existing method signature changes). No breaking changes.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/core/src/analytics-trust/domain/domain-services/ingestion-trust.domain-service.spec.ts`
  - `classifyIngestionStatus`: table-driven — null last-success → `never-ingested`; recent success within threshold → `fresh`; success older than threshold → `stalled`; `staleAfterMs: null` never returns `stalled`.
  - `estimateCronIntervalMs`: known fixed-interval expressions (`*/5 * * * *` → 5 min in ms, `*/10 * * * *` → 10 min) against a fixed `now`; malformed expression → `null`, no throw.
- `libs/core/src/analytics-trust/application/services/analytics-trust.service.spec.ts`
  - Mocks `IIntegrationsService`, `SyncJobRepositoryPort`, `SchedulerTaskRegistryService` (all port/interface mocks, per `docs/engineering-standards.md § Mocking Ports`).
  - "should return never-ingested when no succeeded job exists for a connection"
  - "should return stalled when the last succeeded job is older than 3× the platform's poll interval"
  - "should return fresh when the last succeeded job is within the threshold"
  - "should mark expectedIntervalMs and staleAfterMs null when no scheduler task matches the connection's platformType"
  - "should degrade a single connection's entry to never-ingested and log a warning when building its entry throws, without failing the whole snapshot"
  - "should return an empty connections array when no OrderSource connections exist"
- `libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.spec.ts` (extend existing file)
  - "should query for the most recent succeeded job ordered by updatedAt DESC" (mocked TypeORM repository, asserting `where`/`order` shape).
- `apps/api/src/analytics-trust/http/analytics-trust.controller.spec.ts`
  - "should map the snapshot to the response DTO with ISO date strings"
  - "should require authentication" (guard applied — verified the standard way other controller specs verify `@UseGuards`).

### Integration Tests
- `apps/api/test/integration/analytics-trust/analytics-trust-read.int-spec.ts`
  - Seed: one connection with `OrderSource` enabled + one succeeded `sync_jobs` row for `marketplace.orders.poll`; one connection with `OrderSource` enabled and zero jobs.
  - `GET /analytics/trust` → 200, asserts the first connection reports `fresh` (or `stalled` depending on seeded timestamp vs. the real registered cadence — pin the seeded timestamp comfortably inside/outside the known Allegro/PrestaShop threshold to make the assertion deterministic) and the second reports `never-ingested`.
  - Asserts response shape matches the DTO (all fields present, dates are ISO strings).

### Mocking Strategy
- Unit tests: mock every injected port/service/registry — never a concrete adapter or the TypeORM repository directly (only the repository's *own* spec touches TypeORM, per the standard layering).
- Integration test: real Postgres via Testcontainers (per `docs/testing-guide.md`), real registered scheduler tasks (booted via the real `AppModule`, so the actual Allegro/PrestaShop/Erli/WooCommerce plugins' `SchedulerTaskConfig` registrations are exercised, not stubbed) — this is the one place that proves the "3× real cadence" threshold computation end-to-end.

### Acceptance Criteria (mapped from the issue)
- [ ] For each `OrderSource` connection, the API reports last-successful-ingestion time, earliest available data point, and whether ingestion appears stalled — `GET /analytics/trust` response.
- [ ] A connection that has never successfully ingested is distinguishable from one that ingested and then stalled — `'never-ingested'` vs `'stalled'` status values.
- [ ] The staleness threshold accounts for the connection's own schedule — `staleAfterMs = expectedIntervalMs × 3`, derived per-platform from `SchedulerTaskRegistryService`.
- [ ] Response is a single call the page can make before rendering any figure — one `GET /analytics/trust`, no per-connection follow-up calls.
- [ ] Tests added (unit + integration) — § 9 above.
- [ ] No new ESLint warnings or type errors introduced — verify via `pnpm lint` / `pnpm type-check` before considering the plan executed.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (domain → application → interface, no layer skipping)
- [x] Respects CORE vs Integration boundaries (no integration/platform-specific code added; reads existing capability/scheduler registrations generically)
- [x] Uses existing patterns (no unnecessary abstractions) — reuses `IIntegrationsService`, `SchedulerTaskRegistryService`, and the `ConnectionInfraHealthService` per-connection-isolation pattern rather than inventing new ones
- [x] Idempotency considered — N/A, pure read, no mutation
- [x] Event-driven patterns used where applicable — N/A, synchronous read; no event needed
- [x] Rate limits & retries addressed — N/A, no outbound external calls
- [x] Error handling comprehensive — per-connection catch, degraded entries, no thrown exceptions past the service boundary
- [x] Testing strategy complete — unit (domain + application + repository + controller) and integration
- [x] Naming conventions followed — verified against `docs/engineering-standards.md § Naming Conventions`
- [x] File structure matches standards — matches `docs/engineering-standards.md § Project Structure`
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- [Product Spec 1976 — Analytics](../specs/product-spec-1976-analytics.md) — § 4 group L, § 6, § 7 story S5
