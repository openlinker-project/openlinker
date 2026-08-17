# Implementation Plan: Real per-connection earliest-order-date read for analytics-trust coverage window

**Date**: 2026-08-14
**Status**: Draft
**Estimated Effort**: 3–4 hours
**Base branch**: `1985-order-analytics-read-model` (NOT `main` — see § Branching note)
**Issue**: [#2083](https://github.com/openlinker-project/openlinker/issues/2083)

---

## Branching note

This plan is intentionally based on `1985-order-analytics-read-model` rather than `main`. #2083 is explicitly
**blocked by #1985**: it needs `order_records.placedAt` to exist, and that column does not exist on `main` yet —
it ships in #1985's own migration. `1985-order-analytics-read-model` already has the column
(`libs/core/src/orders/infrastructure/persistence/entities/order-record.orm-entity.ts:128`), so branching from
it (rather than waiting for #1985 to merge to `main` first) lets this work start immediately. The eventual PR
should target `1985-order-analytics-read-model` as its base, not `main`, until that branch merges — at which
point it can be rebased.

A separate, unrelated line of work (write-time FX/currency normalization onto `order_records`) is being designed
in parallel but is **not implemented anywhere in the codebase yet** (verified — no `normalizedAmount` /
`fxRateSnapshot` columns exist). It touches different columns and different repository methods than this plan
does, so it creates no architectural conflict; the only realistic risk is an ordinary git merge conflict if both
land on the same files before either is merged.

---

## 1. Task Summary

**Objective**: Make `GET /analytics/trust`'s per-connection `earliestOrderDate` a real, `order_records`-derived
fact (`MIN(COALESCE(placedAt, createdAt))`), rather than the current `connectionCreatedAt` field being asked to
double as a "coverage window" claim it was never able to support.

**Context**: The analytics data-trust read (#1982) was meant to report, per `OrderSource` connection, how far
back its ingested data goes — so a 6-day-old connection isn't misread as underperforming next to one with 8
months of history. What shipped instead only carries `connectionCreatedAt` (when the operator configured the
integration), which the field's own doc comment already flags as insufficient: a connection can legitimately
ingest orders placed before it was created (e.g. Allegro's event journal seeded from the beginning).
`AnalyticsTrustService.buildTrustEntry` today never reads `order_records` at all — `analytics-trust` currently
depends only on `integrations` and `sync`. The `/analytics` v1 "Ledger" mockup (PR #2018, frame 01 "Trust
header") specifies the correct fix: read `MIN(placedAt)` per connection, falling back to `createdAt` only for
rows that predate a `placedAt` value.

**Classification**: CORE — Domain (new repository port method), Application (new service method,
`AnalyticsTrustService` orchestration change), Infrastructure (repository aggregate query), Interface (DTO +
controller mapping).

---

## 2. Scope & Non-Goals

### In Scope

- `OrderRecordRepositoryPort.findEarliestPlacedAtByConnection` + its `OrderRecordRepository` implementation —
  one batched aggregate query.
- `IOrderRecordService.getEarliestOrderDateByConnection` — the cross-context seam `analytics-trust` calls
  through, per `docs/architecture-overview.md § Cross-context dependencies in core`.
- `AnalyticsTrustService.getIngestionTrustSnapshot` restructured to batch this lookup once across all
  enumerated connections (not once per connection).
- New `earliestOrderDate: Date | null` field on `ConnectionIngestionTrust`, threaded through to
  `ConnectionIngestionTrustResponseDto` / `AnalyticsTrustController.toResponseDto`.
- `AnalyticsTrustModule` gains an import of `OrdersModule` (or the narrower path if one exists — see Phase 1,
  Step 2) to obtain `ORDER_RECORD_SERVICE_TOKEN`.
- `docs/architecture-overview.md`'s mermaid dependency map gains the `analytics-trust --> orders` edge.
- Unit tests: repository method, service method, `AnalyticsTrustService`, controller DTO mapping.

### Out of Scope

- Cancelled-order exclusion from the earliest-date computation — explicitly called out in the issue as not
  applicable here (this is a coverage/freshness fact, not a revenue figure; #1984/#1987/#1988 own cancellation
  exclusion for revenue reads).
- Any new database index — `sourceConnectionId` and `placedAt` are already indexed independently on
  `order_records` (`order-record.orm-entity.ts`); at the documented `/analytics` persona volume (10–100
  orders/day, 50–1000 SKUs) neither the issue nor this plan sees a need for a composite index. Revisit if this
  read is later called on a hot path rather than once per `/analytics` page load.
- Any FE change — `#1986`'s trust-header component ships with an interim "Connected since" label per its own
  plan and swaps to a "Data from" label once this lands; no URL/component-contract change is needed here beyond
  that future label swap (not part of this plan).
- An ADR. This is a same-shape extension of an already-established, already-ADR'd pattern
  (`getFailedSyncValueSummary`'s repository→service→cross-context-consumer chain, and the `analytics-trust →
  sync`/`integrations` cross-context precedent already in the dependency map) — it doesn't cross the "when to
  write an ADR" bar in `docs/engineering-standards.md § Architecture Decision Records`.

### Constraints

- Must not turn the per-connection entry-building loop into an N+1 query pattern — acceptance criteria requires
  one batched query across all connections.
- Must preserve the existing `analytics-trust` per-connection degraded-entry (`'unknown'`) behavior on a build
  failure — the new field participates in that same isolation, not a separate failure mode.
- Must go through `IOrderRecordService`, never `OrderRecordRepositoryPort` directly, per the cross-context
  contract rule.

---

## 3. Architecture Mapping

**Target Layer**: CORE — spans Domain (`orders` port), Application (`orders` service + `analytics-trust`
service), Infrastructure (`orders` repository), Interface (`apps/api` DTO + controller).

**Capabilities Involved**: None (no capability port) — this is a cross-context core-to-core read, not an
adapter-facing capability.

**Existing Services Reused**:
- `IIntegrationsService.listCapabilityAdapters` (already used by `AnalyticsTrustService` to enumerate
  `OrderSource`-capable connections) — its output supplies the connection-id batch for the new lookup.
- `IOrderRecordService` (`@openlinker/core/orders`) — extended with one new method; the service class,
  DI token, and module wiring already exist.

**New Components Required**:
- `OrderRecordRepositoryPort.findEarliestPlacedAtByConnection(connectionIds: string[]): Promise<Map<string, Date>>`
- `OrderRecordRepository` implementation (one `GROUP BY` aggregate query via `createQueryBuilder`).
- `IOrderRecordService.getEarliestOrderDateByConnection(connectionIds: string[]): Promise<Map<string, Date>>`
  (thin delegation in `OrderRecordService`).
- `ConnectionIngestionTrust.earliestOrderDate: Date | null` domain type field.
- `ConnectionIngestionTrustResponseDto.earliestOrderDate: string | null` DTO field.
- `AnalyticsTrustModule` import of `OrdersModule`.

**Core vs Integration Justification**: Everything here is core-to-core (orders ↔ analytics-trust); no
integration/adapter surface is touched. `analytics-trust` already depends on `integrations` and `sync` as
sibling core contexts through their published `I*Service` interfaces — adding `orders` through
`IOrderRecordService` is the identical shape, not a new architectural pattern.

**Reference**: `docs/architecture-overview.md § Hexagonal Architecture Structure`, § Cross-context dependencies
in core.

---

## 4. External / Domain Research

### Internal Patterns (found via codebase search)

- **Batched-by-id-set precedent**: `OrderRecordRepositoryPort.findByIds` (#1995) is the existing "one query
  scoped to an id set, not a fan-out" pattern in this exact repository — same shape this plan needs, just
  grouped instead of flat.
- **Aggregate-query precedent**: `OrderRecordRepository.getFailedSyncValueSummary` (#1983) is the closest
  existing example of a `createQueryBuilder` aggregate (`COUNT`/`SUM`/`MIN` with `FILTER (WHERE …)`) reached
  through the identical port → service → cross-context-consumer chain this plan follows almost verbatim: its
  `IOrderRecordService` doc comment ("The cross-context surface `apps/api`'s analytics composition uses —
  repository ports are forbidden across context boundaries … so callers go through this service method instead
  of `OrderRecordRepositoryPort.getFailedSyncValueSummary` directly") is the template this plan's new doc
  comment should mirror almost word-for-word.
- **`sourceConnectionId` filtering precedent**: every existing `OrderRecordRepository` query method
  (`findMany`, `countByHealth`, `countBySla`, `getFailedSyncValueSummary`) filters via
  `qb.andWhere('rec.sourceConnectionId = :sourceConnectionId', …)` for a *single* connection; this plan's method
  is the first to filter by a *set* (`IN (...)`) combined with `GROUP BY`.
- **`AnalyticsTrustService` current shape**: `getIngestionTrustSnapshot` calls
  `Promise.all(entries.map((entry) => this.buildTrustEntry(entry.connection, now)))`, and `buildTrustEntry`
  independently does its own two job lookups per connection (`findLastSucceededJob` × 2). That per-connection
  fan-out is pre-existing and out of scope to fix — but it means the *new* lookup must NOT be added inside
  `buildTrustEntry` (that would silently reintroduce N+1 for this one field). It must be computed once, before
  the `Promise.all`, and passed in.
- **Module wiring precedent**: `OrdersModule` already exports `ORDER_RECORD_SERVICE_TOKEN` (and the
  `OrderRecordService` class itself) at `libs/core/src/orders/orders.module.ts:116-126`. No orders-side change
  is needed to make the token importable — only `AnalyticsTrustModule` needs a new `imports: [OrdersModule]`
  entry (mirroring its existing `imports: [IntegrationsModule, SyncModule]`).
- **No reverse dependency exists** (`orders` does not import `analytics-trust` anywhere), so this is a new leaf
  edge, not a new cycle — unlike the already-documented `orders ↔ customers` / `orders ↔ invoicing` cycles.

### External System

Not applicable — no external platform integration in this change.

---

## 5. Questions & Assumptions

### Open Questions

- None blocking. The issue's own "Assumptions" section already resolves the two judgment calls (fallback
  semantics, no new index) — carried into this plan verbatim below.

### Assumptions

- `COALESCE(placedAt, createdAt)` is the correct, and only, fallback — matches #1985's own documented
  fallback-for-records-without-placed-at behavior, and the issue's explicit acceptance criterion.
- A connection with zero `order_records` rows is simply **absent from the returned `Map`** (mirroring
  `findByIds`'s "no matching row is silently omitted" convention) — the service/controller layer maps a missing
  map entry to `earliestOrderDate: null`, distinct from a connection that has rows whose earliest predates the
  `placedAt` backfill (which resolves to its `createdAt`-derived fallback date, non-null).
- No new database index is needed at current expected volumes; revisit only if this read moves onto a
  higher-frequency path than "once per `/analytics` page load."
- Cancelled orders are included in the earliest-date computation (not excluded) — a freshness/coverage fact, not
  a revenue figure.

### Documentation Gaps

None identified — `docs/architecture-overview.md § Cross-context dependencies in core` and the existing
`getFailedSyncValueSummary` precedent fully specify the pattern to follow.

---

## 6. Proposed Implementation Plan

### Phase 1: `orders` context — repository port + implementation + service seam

**Goal**: Add the batched earliest-order-date read, reachable only through `IOrderRecordService`.

**Steps**:

1. **Add the port method**
   - **File**: `libs/core/src/orders/domain/ports/order-record-repository.port.ts`
   - **Action**: Add, alongside `findByIds`:
     ```ts
     /**
      * Batch earliest-order-date lookup by source connection (#2083).
      *
      * `MIN(COALESCE(placedAt, createdAt))` per `sourceConnectionId`, in one
      * `GROUP BY` query — the real batch analytics-trust's coverage-window
      * read needs, as opposed to one query per connection. A connection with
      * zero matching rows is simply absent from the returned Map (mirrors
      * {@link findByIds}); callers treat a missing key as "no orders yet",
      * distinct from a present key whose value is merely old.
      */
     findEarliestPlacedAtByConnection(connectionIds: string[]): Promise<Map<string, Date>>;
     ```
   - **Acceptance**: Compiles; JSDoc present; method sits next to `findByIds` for discoverability.
   - **Dependencies**: None.

2. **Implement the query**
   - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`
   - **Action**: Implement using the same `createQueryBuilder` idiom as `getFailedSyncValueSummary` — early-return
     `new Map()` for an empty `connectionIds` array (mirrors `findByIds`'s empty-input short-circuit), otherwise:
     ```ts
     async findEarliestPlacedAtByConnection(connectionIds: string[]): Promise<Map<string, Date>> {
       if (connectionIds.length === 0) {
         return new Map();
       }
       const rows = await this.repository
         .createQueryBuilder('rec')
         .select('rec.sourceConnectionId', 'source_connection_id')
         .addSelect(`MIN(COALESCE(rec."placedAt", rec."createdAt"))`, 'earliest_at')
         .where('rec.sourceConnectionId IN (:...connectionIds)', { connectionIds })
         .groupBy('rec.sourceConnectionId')
         .getRawMany<{ source_connection_id: string; earliest_at: Date }>();

       return new Map(rows.map((row) => [row.source_connection_id, row.earliest_at]));
     }
     ```
   - **Acceptance**: A unit-test-level check that the query builder is invoked with `IN (...)` + `GROUP BY` (see
     Phase 4); manually verified the raw column aliases (`getRawMany` returns snake_case keys by TypeORM
     convention, matching the existing `getFailedSyncValueSummary`/`countByHealth` raw-row patterns in this same
     file) resolve correctly.
   - **Dependencies**: Step 1.

3. **Extend the cross-context service interface**
   - **File**: `libs/core/src/orders/application/interfaces/order-record.service.interface.ts`
   - **Action**: Add, mirroring `getFailedSyncValueSummary`'s doc-comment shape verbatim in intent:
     ```ts
     /**
      * Batch earliest-order-date lookup by source connection (#2083). The
      * cross-context surface `analytics-trust`'s coverage-window read uses —
      * repository ports are forbidden across context boundaries per
      * architecture-overview.md § "Cross-context dependencies in core", so
      * callers go through this service method instead of
      * `OrderRecordRepositoryPort.findEarliestPlacedAtByConnection` directly.
      * A connection absent from the returned Map has zero ingested orders.
      */
     getEarliestOrderDateByConnection(connectionIds: string[]): Promise<Map<string, Date>>;
     ```
   - **Acceptance**: Compiles; matches the `getFailedSyncValueSummary` doc-comment pattern for consistency.
   - **Dependencies**: Step 1.

4. **Implement the service delegation**
   - **File**: `libs/core/src/orders/application/services/order-record.service.ts`
   - **Action**: Add, mirroring the existing `getFailedSyncValueSummary` delegation:
     ```ts
     async getEarliestOrderDateByConnection(connectionIds: string[]): Promise<Map<string, Date>> {
       return this.repository.findEarliestPlacedAtByConnection(connectionIds);
     }
     ```
   - **Acceptance**: Compiles; one-line delegation, no added logic (matches house style for this service).
   - **Dependencies**: Steps 2, 3.

### Phase 2: `analytics-trust` context — consume the new seam, batched

**Goal**: Wire the new field into the snapshot without introducing per-connection N+1 queries.

**Steps**:

5. **Add the domain type field**
   - **File**: `libs/core/src/analytics-trust/domain/types/connection-ingestion-trust.types.ts`
   - **Action**: Add to `ConnectionIngestionTrust`, directly below `connectionCreatedAt` (keeping the two facts
     visually paired, matching the JSDoc contrast the issue itself draws):
     ```ts
     /**
      * `MIN(COALESCE(placedAt, createdAt))` over this connection's
      * `order_records` (#2083) — the real per-channel coverage-window fact
      * `connectionCreatedAt` was never able to support (a connection can
      * legitimately ingest orders placed before it was created). `null` when
      * the connection has zero ingested orders — distinct from a non-null
      * value that merely predates the #1985 `placedAt` backfill (which
      * resolves to its `createdAt`-derived fallback instead).
      */
     earliestOrderDate: Date | null;
     ```
   - **Acceptance**: Compiles; the two doc comments (`connectionCreatedAt` / `earliestOrderDate`) read as a
     matched, non-redundant pair.
   - **Dependencies**: None (parallel with Phase 1).

6. **Import `OrdersModule` and inject `IOrderRecordService`**
   - **File**: `libs/core/src/analytics-trust/analytics-trust.module.ts`
   - **Action**: Add `OrdersModule` to `imports: [IntegrationsModule, SyncModule, OrdersModule]`. Update the
     module's own header doc comment to mention the new composed context (mirrors its existing style of listing
     every composed dependency).
   - **File**: `libs/core/src/analytics-trust/application/services/analytics-trust.service.ts`
   - **Action**: Inject `IOrderRecordService` via `ORDER_RECORD_SERVICE_TOKEN` from `@openlinker/core/orders`,
     alongside the existing `IIntegrationsService`/`ISyncJobsService` constructor params.
   - **Acceptance**: `AnalyticsTrustModule` resolves at boot (verified via `pnpm --filter @openlinker/api
     type-check` / an existing app-boot integration spec, not a new one — see Phase 4).
   - **Dependencies**: Phase 1 complete (needs `ORDER_RECORD_SERVICE_TOKEN` exported, which it already is).

7. **Restructure `getIngestionTrustSnapshot` to batch the lookup**
   - **File**: `libs/core/src/analytics-trust/application/services/analytics-trust.service.ts`
   - **Action**: Between enumerating `entries` and the `Promise.all(entries.map(...))` fan-out, add one call:
     ```ts
     const connectionIds = entries.map((entry) => entry.connection.id);
     const earliestOrderDates = await this.orderRecordService.getEarliestOrderDateByConnection(connectionIds);
     ```
     Then pass `earliestOrderDates` through to `buildTrustEntry(entry.connection, now, earliestOrderDates)` and
     `buildDegradedEntry(connection, earliestOrderDates)`. Inside each, resolve
     `earliestOrderDates.get(connection.id) ?? null` and stamp it onto the returned object. **Deliberately
     resolved even in the degraded/`'unknown'` path** — a per-connection job-lookup failure (the only thing the
     existing `try`/`catch` guards against) has nothing to do with whether the earliest-order-date batch lookup
     itself succeeded, so a single connection's degraded entry should still carry a real
     `earliestOrderDate` if the batch call succeeded for it.
   - **Acceptance**: `getEarliestOrderDateByConnection` is called exactly once per `getIngestionTrustSnapshot`
     invocation, regardless of how many connections are enumerated (asserted in the service spec — see Phase 4).
   - **Dependencies**: Steps 5, 6.

   **Edge case**: if the batch call itself throws (e.g. a transient DB error), the whole snapshot build would
   fail rather than degrading one entry — unlike the per-connection `try`/`catch` around job lookups. This
   matches the issue's own scope (it doesn't ask for per-connection resilience on this specific read) and is
   consistent with `getIngestionTrustSnapshot`'s existing top-level `listCapabilityAdapters` call, which is
   equally unguarded. Not changing this failure boundary — flagged here for reviewer visibility, not treated as
   a gap to fix in this plan.

### Phase 3: `apps/api` — DTO + controller mapping

**Goal**: Surface the new field on the HTTP response.

**Steps**:

8. **Add the DTO field**
   - **File**: `apps/api/src/analytics-trust/dto/analytics-trust-response.dto.ts`
   - **Action**: Add to `ConnectionIngestionTrustResponseDto`, directly below `connectionCreatedAt`:
     ```ts
     @ApiProperty({
       nullable: true,
       description:
         'Earliest ingested order date (ISO 8601) for this connection — MIN(placedAt) falling back to ' +
         "createdAt for pre-#1985 rows. Null when the connection has zero ingested orders. The real " +
         "per-channel coverage-window fact; do not confuse with connectionCreatedAt.",
     })
     earliestOrderDate!: string | null;
     ```
   - **Acceptance**: Swagger schema includes the new nullable field.
   - **Dependencies**: Phase 2.

9. **Map it in the controller**
   - **File**: `apps/api/src/analytics-trust/http/analytics-trust.controller.ts`
   - **Action**: In `toResponseDto`, add:
     ```ts
     connectionDto.earliestOrderDate = entry.earliestOrderDate
       ? entry.earliestOrderDate.toISOString()
       : null;
     ```
   - **Acceptance**: `GET /analytics/trust` response includes `earliestOrderDate` per connection.
   - **Dependencies**: Step 8.

### Phase 4: Documentation + tests

**Steps**:

10. **Update the architecture dependency map**
    - **File**: `docs/architecture-overview.md`
    - **Action**: Add `analytics-trust --> orders` to the mermaid diagram (currently at line ~1337-1338,
      alongside the existing `analytics-trust --> integrations` / `analytics-trust --> sync` lines). Also update
      the "Analytics Trust" § 4 bullet list (Cross-context seam discipline paragraph) to mention the new
      `IOrderRecordService.getEarliestOrderDateByConnection` dependency, following the same prose style as the
      existing `findLastSucceededJob`/`findEnabledPollTask` mentions.
    - **Acceptance**: Diagram renders the new edge; prose accurately describes the batched, single-call nature
      of the new dependency (explicitly calling out that it is NOT per-connection, matching the existing prose's
      care about the job-lookup calls).
    - **Dependencies**: None (can happen any time after Phase 1/2 land).

11. **Unit tests — repository**
    - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/__tests__/order-record.repository.spec.ts`
    - **Cases**:
      - Multiple connections, each with orders → returns one `Map` entry per connection with the correct MIN.
      - A connection with zero rows → absent from the returned Map.
      - A row whose `placedAt` is `null` → falls back to `createdAt` in the MIN computation.
      - Empty `connectionIds` input → returns an empty Map without issuing a query (assert the query builder / DB
        call is not invoked, mirroring `findByIds`'s existing empty-input test if one exists).
    - **Acceptance**: All cases pass; matches the file's existing setup/mocking conventions (check whether this
      spec unit-tests the repository against a real query builder mock or a Testcontainers int-spec — follow
      whichever the file already uses for `getFailedSyncValueSummary` / `countByHealth`).

12. **Unit tests — service**
    - **File**: `libs/core/src/orders/application/services/__tests__/order-record.service.spec.ts`
    - **Case**: `getEarliestOrderDateByConnection` delegates to
      `repository.findEarliestPlacedAtByConnection` with the same argument and returns its result unchanged.

13. **Unit tests — `AnalyticsTrustService`**
    - **File**: `libs/core/src/analytics-trust/application/services/analytics-trust.service.spec.ts`
    - **Cases**:
      - `getIngestionTrustSnapshot` calls `orderRecordService.getEarliestOrderDateByConnection` **exactly once**
        with the full list of enumerated connection ids, regardless of connection count (the acceptance
        criterion this whole plan exists to satisfy — guard this explicitly so a future refactor can't
        regress it back into a per-connection call).
      - A connection present in the returned Map → `earliestOrderDate` on its trust entry matches the Map value.
      - A connection absent from the returned Map → `earliestOrderDate: null`.
      - A connection whose job-lookup throws (existing degraded-entry path) still carries a correct
        `earliestOrderDate` when the batch lookup itself succeeded for that connection id.

14. **Unit tests — controller DTO mapping**
    - **File**: `apps/api/src/analytics-trust/http/analytics-trust.controller.spec.ts` (create if it doesn't
      exist yet — check first; if the controller currently has no spec, add one matching the smallest existing
      controller-spec pattern in `apps/api/src/analytics-trust/` or a sibling module).
    - **Case**: `toResponseDto` maps `earliestOrderDate: Date` → ISO string, and `null` → `null`.

**No integration test (`*.int-spec.ts`) is proposed** — the repository aggregate query is a single, simple
`GROUP BY`/`MIN` with no cross-service orchestration risk beyond what the unit tests already cover, and the
existing `getFailedSyncValueSummary`/`countByHealth` methods in the same file are unit-tested only, not
integration-tested. Deviate from this only if code review disagrees.

---

## 7. Alternatives Considered

### Alternative 1: Compute `earliestOrderDate` inside `buildTrustEntry` (one query per connection)

- **Description**: Add the lookup call directly inside the existing per-connection `buildTrustEntry` method,
  alongside the two existing `findLastSucceededJob` calls.
- **Why Rejected**: Explicitly forbidden by the issue's own acceptance criteria ("batched across all connections
  in one query, not one query per connection"). It would also be inconsistent with the file's own stated design
  philosophy (the module doc comment already explains why job lookups aren't gated on scheduler registration
  for correctness reasons) even though the *existing* job lookups already are, unfortunately, N+1 across
  connections — this plan does not compound that with a second N+1 field.
- **Trade-offs**: Simpler code (no map threading through two builder methods) at the cost of violating an
  explicit, tested acceptance criterion.

### Alternative 2: Materialize `earliestOrderDate` as a persisted, incrementally-maintained column

- **Description**: Instead of computing `MIN` on read, maintain a running "connection's earliest order date" as
  a stamped value updated on each `persistOrder`/`persistIncomingSnapshot` call (compare-and-set-if-earlier).
- **Why Rejected**: Over-engineered for the documented data volume (10–100 orders/day) and read frequency (once
  per `/analytics` page load). It also duplicates data that's trivially derivable, adds a new write-path
  responsibility to `OrderRecordService.persistOrder`/`persistIncomingSnapshot` (both hot, already-complex
  paths), and reopens exactly the kind of "materialized view we don't need at this scale" question ADR-039
  already answered no to for the sibling `order_line_items` design. A read-time aggregate over an already-indexed
  column is the right-sized solution here, matching the issue's own proposed solution.
- **Trade-offs**: Slightly more read-time cost (negligible at this volume) vs. a persistent, always-in-sync
  column that adds write-path complexity and violates the "materialized view rejected at this persona's volume"
  precedent.

---

## 8. Validation & Risks

### Architecture Compliance

- ✅ `analytics-trust` reaches `orders` only through `IOrderRecordService` — never `OrderRecordRepositoryPort` or
  an ORM entity. New cross-context edge is `I*Service`-shaped, matching the allowed contract surface.
- ✅ Domain layer (`order-record-repository.port.ts`) has no framework dependency added.
- ✅ Repository implementation stays in `infrastructure/persistence/repositories/`; mapping (Map construction
  from raw rows) stays private to the repository method, matching the "ORM ↔ Domain Mapping" convention.
- ✅ No new `*RepositoryPort` symbol is imported cross-context — only the existing `IOrderRecordService` symbol
  gains a method.

**Reference**: `docs/architecture-overview.md § Cross-context dependencies in core`.

### Naming Conventions

- ✅ `findEarliestPlacedAtByConnection` follows the existing `find*By*` verb-object naming used by
  `findByIds`/`findById`/`findMany` in the same port.
- ✅ `getEarliestOrderDateByConnection` follows the existing `get*` naming used by `getOrderRecord`/
  `getFailedSyncValueSummary` in the same service interface (verb differs from the port method deliberately,
  mirroring the existing `getFailedSyncValueSummary` port/service pair which also differs only in verb, not
  structure).

### Existing Patterns

- ✅ Matches `getFailedSyncValueSummary`'s exact port → repository → service → cross-context-consumer chain.
- ✅ Matches `findByIds`'s empty-input short-circuit and "absent-key = no match" Map/array convention.

### Risks

- **Risk**: `AnalyticsTrustModule` importing `OrdersModule` pulls in `OrdersModule`'s full provider graph
  (`OrderSyncService`, `OrderIngestionService`, etc.) even though only `IOrderRecordService` is needed.
  **Mitigation**: This is the same cost every existing consumer of `OrdersModule` already pays (NestJS modules
  are all-or-nothing at the module-import level); no narrower "orders read-only" sub-module exists today, and
  creating one is out of scope for this plan. Flagged as a pre-existing pattern, not a new problem introduced
  here.
- **Risk**: A future refactor could accidentally move the new lookup back inside `buildTrustEntry`, silently
  reintroducing the N+1 the issue explicitly forbids. **Mitigation**: Test 13's first case pins the "called
  exactly once" invariant explicitly, so a regression fails CI rather than silently shipping.
- **Risk**: `GROUP BY` query performance at scale. **Mitigation**: Not a real risk at the documented persona
  volume (10–100 orders/day per connection); both filter columns (`sourceConnectionId`, `placedAt`) are already
  independently indexed, matching the issue's own no-new-index assumption.

### Edge Cases

- **Connection with zero orders**: Map key absent → `earliestOrderDate: null`. Covered by test 11/13.
- **Connection whose earliest row predates the #1985 `placedAt` backfill** (i.e. `placedAt IS NULL` on that
  row): `COALESCE` falls back to `createdAt` for that row's contribution to the `MIN`. Covered by test 11.
- **Empty `entries` array** (no `OrderSource`-capable connections at all — day-one instance): the batch call
  receives an empty `connectionIds` array and short-circuits to an empty Map without a query, per Phase 1 Step 2.

### Backward Compatibility

- ✅ Purely additive: one new nullable field on an existing response type, one new port/service method. No
  existing field, endpoint, or method signature changes. No migration — no new column, just a read over
  existing (already-migrated, in #1985) columns.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests

- `libs/core/src/orders/infrastructure/persistence/repositories/__tests__/order-record.repository.spec.ts` —
  `findEarliestPlacedAtByConnection`: multi-connection grouping, zero-row connection omission, `placedAt`-null
  fallback, empty-input short-circuit.
- `libs/core/src/orders/application/services/__tests__/order-record.service.spec.ts` —
  `getEarliestOrderDateByConnection` delegation.
- `libs/core/src/analytics-trust/application/services/analytics-trust.service.spec.ts` — batched single-call
  invariant, per-connection field wiring (present/absent map key), degraded-entry field wiring.
- `apps/api/src/analytics-trust/http/analytics-trust.controller.spec.ts` — DTO date→ISO-string / null mapping.

### Integration Tests

None proposed for this change (see Phase 4 rationale). If review disagrees, the natural addition would be a
case in `apps/api/test/integration/analytics-trust/` (create if none exists) asserting `GET /analytics/trust`
returns a non-null `earliestOrderDate` after seeding an `order_records` row via `persistOrder`.

### Mocking Strategy

- Repository spec: real TypeORM query builder against whatever fixture/mock harness the file's existing
  `getFailedSyncValueSummary`/`countByHealth` tests already use (check the file first — don't introduce a second
  convention).
- Service spec (`order-record.service.spec.ts`): mock `OrderRecordRepositoryPort` (jest.Mocked).
- `AnalyticsTrustService` spec: mock `IOrderRecordService` (jest.Mocked `Pick<IOrderRecordService,
  'getEarliestOrderDateByConnection'>`), following the file's existing `Pick<...>` mocking style for
  `IIntegrationsService`/`ISyncJobsService`.
- Controller spec: no mocking needed if testing `toResponseDto` as a pure function; otherwise mock
  `IAnalyticsTrustService`.

### Acceptance Criteria (from the issue, verified against this plan)

- [ ] `GET /analytics/trust` reports a real `earliestOrderDate` per connection, sourced from
      `MIN(COALESCE(placedAt, createdAt))` over that connection's `order_records` — Phase 1–3.
- [ ] A connection with zero ingested orders reports `earliestOrderDate: null` (distinct from a connection whose
      earliest order predates `placedAt` backfill, which reports its `createdAt`-derived fallback date) — Phase
      1 Step 2, Phase 2 Step 7.
- [ ] The lookup is batched across all connections in one query, not one query per connection — Phase 2 Step 7,
      pinned by test 13.
- [ ] `connectionCreatedAt` remains on the response, unchanged in meaning — no change proposed to that field.
- [ ] `docs/architecture-overview.md`'s cross-context dependency map includes the new `analytics-trust → orders`
      edge — Phase 4 Step 10.
- [ ] Tests added: repository method, service method, `AnalyticsTrustService`, controller DTO mapping — Phase 4
      Steps 11–14.
- [ ] No architecture boundary violations — `analytics-trust` reaches `orders` only through
      `IOrderRecordService`, never `OrderRecordRepositoryPort` or ORM entities directly — verified in § 8.

**Reference**: `docs/testing-guide.md`.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries (pure core-to-core; no integration/adapter touched)
- [x] Uses existing patterns (no unnecessary abstractions) — mirrors `getFailedSyncValueSummary` and `findByIds`
      exactly
- [x] Idempotency considered — read-only, no write path, nothing to make idempotent
- [ ] Event-driven patterns used where applicable — N/A, no event involved
- [ ] Rate limits & retries addressed — N/A, internal DB read only
- [x] Error handling comprehensive — degraded-entry path preserved; batch-call failure boundary explicitly
      documented as an accepted, pre-existing-shaped gap (§ 8 Risks)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md) — see § Analytics Trust, § Cross-context dependencies in core
- [Engineering Standards](../engineering-standards.md) — see § Repository Ports Pattern, § Symbol DI Token Re-export Convention
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- Issue [#2083](https://github.com/openlinker-project/openlinker/issues/2083)
- Depends on [#1985](https://github.com/openlinker-project/openlinker/issues/1985) (`order_records.placedAt`)
- Follow-up to [#1982](https://github.com/openlinker-project/openlinker/issues/1982)
