# Implementation Plan: Sales & Channel Aggregates Endpoint (#1987)

**Date**: 2026-08-17
**Status**: Draft
**Estimated Effort**: M (3–5 days)

---

## 1. Task Summary

**Objective**: Implement the backend read behind the `/analytics` KPI strip and by-channel table — a single endpoint returning, for a given date range: revenue, order count, average order value (AOV), median order value, units sold, cancelled-order count/value, a 7-day daily trend (revenue + order count), and the same figures broken down per source connection with each channel's revenue share and a "coverage incomplete" signal.

**Context**: GitHub issue #1987, blocked by #1985 (order analytics read model). #1985 denormalizes `placedAt`/`currency`/`taxTreatment`/`totalAmount` onto `order_records` and introduces `order_line_items` (one row per order line) precisely so this kind of aggregate can be computed without JSONB expansion (ADR-039). #1984 (merged to `main`) already added `order_records.cancelledAt`. #2083 (built on top of #1985, unmerged) added `IOrderRecordService.getEarliestOrderDateByConnection`, which this plan reuses for the per-channel coverage signal instead of building new machinery.

**Explicit scope decision — currency-mixing, resolved before merge.** This plan originally deferred currency-mixing detection to #2049/ADR-040, summing `totalAmount` as-is (see the deferral statement in § 2, kept for history). #2049 shipped (PR #2050) while this PR was still open/unmerged, stamping `order_records.reportingCurrency`/`reportingTotalAmount` — so the fix landed in this same PR rather than as a follow-up. `revenue`/`averageOrderValue`/`medianOrderValue` (headline and per channel) now sum `reportingTotalAmount` restricted to `reportingCurrency IS NOT NULL` — one comparable currency — with the complementary unstamped slice (pre-#2049 history, or a stamp still in flight) surfaced explicitly via `unconvertedCount`/`unconvertedValue` (native `totalAmount`, informational, may itself mix currencies) rather than silently mixed in or dropped. `cancelledCount`/`cancelledValue` are left on native `totalAmount`, unchanged — a secondary figure, not revisited here. Gross/net tax-treatment normalization remains out of scope, owned by a separate, not-yet-scoped effort.

**Classification**: CORE (`libs/core/src/orders/`) + Interface (`apps/api/src/analytics/`). No Integration/adapter work.

---

## 2. Scope & Non-Goals

### In Scope
- Headline aggregates for an operator-supplied date range: revenue, order count, AOV, median order value, units sold, cancelled-order count, cancelled-order value.
- The same figures (excluding median, which is headline-only) broken down per source connection, each with a `revenueShare` of headline revenue.
- A 7-day daily trend series (revenue + order count only) at headline level and per channel, for the KPI-strip/by-channel-table sparklines (mockup PR #2018/#2003; issue follow-up comment 2026-08-13).
- A per-channel `coverageComplete: false` signal when the channel's oldest ingested order (from `getEarliestOrderDateByConnection`, #2083) is later than the requested range start — i.e., the channel cannot possibly have data for the full range.
- Bucketing by `order_records.placedAt` (buyer's order time), never `createdAt`/ingestion time — this is also why `placedAt IS NOT NULL` rows are the only ones counted (an order the source never dated cannot be bucketed).
- One new endpoint: `GET /analytics/sales`.

### Out of Scope
- **Currency-mixing detection** (`mixedCurrency` flag, per-currency breakdown) — tracked in #2049/ADR-040. `totalAmount` values are summed regardless of currency. A one-line code comment on the aggregation function makes this an explicit, documented deferral rather than a silent gap.
- **Gross/net tax-treatment normalization or comparison** — a separate, not-yet-scoped tax-normalization effort. `taxTreatment` is not read by this feature at all.
- Revenue-over-time / channel-mix-over-time beyond the 7-day sparkline (issue's own A5/B4 — v2, needs a charting-library decision).
- Period-over-period comparison (issue's own A6).
- Anything needing cost, fees, or refunds.
- Frontend consumption (KPI strip / by-channel table) — a separate FE issue consumes this endpoint.
- Database migration — every column/table this plan reads (`order_records.placedAt/totalAmount/cancelledAt`, `order_line_items`) already exists from #1985 (unmerged) and #1984 (merged). No new DDL.

### Constraints
- **#1985 is not yet merged** to `main` (PR #2014 is `OPEN`/`CONFLICTING` as of 2026-08-17). This plan is written against the substrate #1985 introduces, verified directly by reading that branch (`1985-order-analytics-read-model` worktree, which also carries #2083 on top). Implementation of this plan cannot start until #1985 is merged (or is rebased onto as a stacked branch) — see § 5 Risks.
- No new abstraction beyond what's needed: this feature is entirely inside the `orders` bounded context (both tables it reads — `order_records`, `order_line_items` — are owned there) plus a thin `apps/api` HTTP layer. No new cross-context edge.

---

## 3. Architecture Mapping

**Target Layer**: CORE (`libs/core/src/orders/domain/`, `.../application/`, `.../infrastructure/`) + Interface (`apps/api/src/analytics/`).

**Capabilities Involved**: None — this reads OL's own store (`order_records`, `order_line_items`), not a marketplace-capability port. No `*Port` beyond the existing `OrderRecordRepositoryPort` / `OrderLineItemRepositoryPort`.

**Existing Services Reused**:
- `IOrderRecordService.getEarliestOrderDateByConnection` (#2083) — per-channel coverage signal, batched, one call.
- `OrderRecordRepositoryPort` / `OrderLineItemRepositoryPort` — extended with new aggregate-read methods, following the `getFailedSyncValueSummary` / `countByHealth` (`FILTER (WHERE …)` aggregate query) precedent exactly.
- `AnalyticsApiModule` (`apps/api/src/analytics/analytics.module.ts`) — already imports `OrdersModule`; the new controller is added to its `controllers` array alongside `NeedsAttentionController`.

**New Components Required**:
- Domain types: `SalesAnalyticsFilters`, `DailyOrderAggregateRow`, `DailyTrendPoint`, `SalesAnalyticsHeadline`, `ChannelSalesAnalytics`, `SalesAndChannelAnalytics`.
- Pure domain aggregation function `buildSalesAndChannelAnalytics` (ADR-011-compliant: no I/O, no framework).
- 2 new methods on `OrderRecordRepositoryPort` + implementation.
- 1 new method on `OrderLineItemRepositoryPort` + implementation.
- 1 new method on `IOrderRecordService` + implementation (composes the above + the existing earliest-date read).
- 1 new HTTP controller + 2 DTOs + registration in `AnalyticsApiModule`.

**Core vs Integration Justification**: Entirely CORE + Interface. There is no external system involved — this is a read over OL's own persisted order data. It cannot live in an integration package because it has no platform-specific behavior; it must live in `orders` (not a new context) because both source tables are owned there and no other context needs this computation.

---

## 4. External / Domain Research

### Internal Patterns (codebase search performed this session)
- **Aggregate-with-FILTER pattern**: `OrderRecordRepository.getFailedSyncValueSummary` / `.countByHealth` (`libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`) — `COUNT(*) FILTER (WHERE …)`, `COALESCE(SUM(…) FILTER (WHERE …), 0)` against static-readonly SQL-fragment constants (`NOT_MAPPING_OR_DELETED`, `HAS_FAILED`, `TOTAL_EXPR`). This plan's new repository methods follow the identical shape.
- **Batched cross-context read via service, not repository port directly**: `IOrderRecordService.getEarliestOrderDateByConnection` (#2083) — `MIN(COALESCE(placedAt, createdAt))` grouped by `sourceConnectionId`, returned as a `Map`, absent key = zero orders. This plan's per-channel `coverageComplete` reuses this method verbatim rather than re-deriving it.
- **Pure domain aggregation / projection**: `order-analytics-projection.ts` (`libs/core/src/orders/domain/`) — `deriveOrderAnalyticsScalars` / `deriveOrderLineItems`, pure functions, no I/O, colocated `.spec.ts`. This plan's `order-sales-aggregation.ts` mirrors this shape (ADR-011: entities anemic, derivation logic lives in a plain function, not on an entity).
- **HTTP composition precedent**: `NeedsAttentionController` / `NeedsAttentionService` (`apps/api/src/analytics/`, #1983/#2045) — `NeedsAttentionService` exists specifically because it composes **multiple core contexts** (listings + orders) at the apps/api layer. This plan's read is single-context (`orders` only), so per the engineering-standards default-to-simplest-abstraction rule, the new controller injects `ORDER_RECORD_SERVICE_TOKEN` directly — no new `apps/api`-layer composition service is introduced.
- **Query-param DTO precedent**: `OrderHealthSummaryQueryDto` (`apps/api/src/orders/http/dto/order-health-summary-query.dto.ts`) — `@IsOptional() @IsDateString()` pair for a date-range filter. This plan's query DTO mirrors it but makes `from`/`to` **required** (a sales query without a range is not a meaningful request, unlike the health-summary's all-time default).
- **Median via `PERCENTILE_CONT`**: no existing precedent in the codebase; standard PostgreSQL `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY …)` ordered-set aggregate is proposed fresh here — see Alternatives (§ 7) for why this beats an application-level sort.

No external system is involved.

---

## 5. Questions & Assumptions

### Open Questions
- None blocking. The issue's own follow-up comment (2026-08-13) already resolved the two ambiguous points (trend series scope, median-is-headline-only) that would otherwise need clarification here.

### Assumptions
- `from` is inclusive, `to` is exclusive (`[from, to)`) — matches the half-open-interval convention already used for `createdFrom`/`createdTo` style filters elsewhere in the codebase (inclusive lower bound via `>=`).
- The 7-day trend window is the **last 7 calendar days of the requested range**, ending at `to` (exclusive) — not a fixed rolling "last 7 days from today". If the operator requests a 30-day range, the trend shows days 24–30 of that range. This matches "sparkline for the KPI strip showing the requested period's recent trend" rather than an independent always-last-week widget. **Safe default; flag to product/FE reviewer if the mockup implies otherwise** — the mockup screenshots were not re-inspected in this planning pass.
- A day with zero orders is zero-filled in the trend series (not omitted) so a 7-point sparkline is always 7 points.
- `coverageComplete` is computed only from `getEarliestOrderDateByConnection`'s **unfiltered** earliest date (includes `source_deleted`/`awaiting_mapping`/cancelled rows, per its own documented contract) — this is deliberately consistent with #2083's own reasoning ("a coverage/freshness fact, not a revenue or health figure").
- A channel with **zero** matching rows in `[from, to)` is simply absent from the `channels[]` array (no zero-valued row) — mirrors the existing "absent key = no data" convention (`getFailedSyncValueSummary`, `getEarliestOrderDateByConnection`).

### Documentation Gaps
- None new. The existing docs (`architecture-overview.md` § Orders → "Order analytics read model (#1985 …)") already anticipate #1987/#1988 as consumers of the #1985 substrate; this plan's Phase 4 step updates that paragraph with one sentence once implemented.

### ADR Decision
**No new ADR is warranted.** This plan does not affect the plugin contract, does not introduce a new cross-context dependency, and its one non-trivial technical choice (`PERCENTILE_CONT` for the median, computed server-side rather than client-side) is a routine implementation detail with an obvious alternative already dismissed in § 7 — it does not meet the ADR bar in `docs/architecture/adrs/README.md § When to write an ADR`.

---

## 6. Proposed Implementation Plan

### Phase 1 — Domain types & pure aggregation

**Goal**: Establish the shape of the computation and its pure, fully-unit-testable core before touching persistence.

**Steps**:

1. **Add domain types**
   - **File**: `libs/core/src/orders/domain/types/order-sales-analytics.types.ts` (new)
   - **Action**: Define, per § "Domain types" in the architecture mapping:
     ```ts
     export interface SalesAnalyticsFilters {
       from: Date; // inclusive
       to: Date;   // exclusive
       sourceConnectionId?: string;
     }
     export interface DailyOrderAggregateRow {
       day: Date; // UTC day, from date_trunc('day', placedAt)
       sourceConnectionId: string;
       orderCount: number;
       revenue: number;
       cancelledCount: number;
       cancelledValue: number;
     }
     export interface DailyTrendPoint {
       date: string; // yyyy-mm-dd
       revenue: number;
       orderCount: number;
     }
     export interface SalesAnalyticsHeadline {
       revenue: number;
       orderCount: number;
       averageOrderValue: number;
       medianOrderValue: number;
       unitsSold: number;
       cancelledCount: number;
       cancelledValue: number;
       trend: DailyTrendPoint[];
     }
     export interface ChannelSalesAnalytics {
       sourceConnectionId: string;
       revenue: number;
       orderCount: number;
       averageOrderValue: number;
       unitsSold: number;
       revenueShare: number; // 0 when headline revenue is 0
       trend: DailyTrendPoint[];
       coverageComplete: boolean;
     }
     export interface SalesAndChannelAnalytics {
       headline: SalesAnalyticsHeadline;
       channels: ChannelSalesAnalytics[];
     }
     ```
   - **Acceptance**: File compiles standalone; no imports beyond TS built-ins. Matches engineering-standards "types in separate `*.types.ts` files" rule.
   - **Dependencies**: None.

2. **Add the pure aggregation function**
   - **File**: `libs/core/src/orders/domain/order-sales-aggregation.ts` (new)
   - **Action**: Export `buildSalesAndChannelAnalytics(input): SalesAndChannelAnalytics` where
     ```ts
     interface BuildSalesAndChannelAnalyticsInput {
       filters: SalesAnalyticsFilters;
       dailyRows: DailyOrderAggregateRow[];
       medianOrderValue: number | null;
       unitsByConnection: Map<string, number>;
       earliestOrderDateByConnection: Map<string, Date>;
     }
     ```
     Logic:
     - Headline `revenue`/`orderCount`/`cancelledCount`/`cancelledValue` = sums across all `dailyRows`.
     - `averageOrderValue = orderCount > 0 ? revenue / orderCount : 0`.
     - `medianOrderValue = medianOrderValue ?? 0`.
     - `unitsSold` = sum of `unitsByConnection` values.
     - Headline `trend`: group `dailyRows` by day across the full `[from, to)` range (summed across connections), zero-fill missing days, then take the **last 7 days** of that series (closest to `to`).
     - Channels: group `dailyRows` by `sourceConnectionId`. Same per-day trend derivation, scoped to that connection's rows. `revenueShare = headlineRevenue > 0 ? channelRevenue / headlineRevenue : 0`. `unitsSold = unitsByConnection.get(id) ?? 0`. `coverageComplete = earliestOrderDateByConnection.get(id) != null && earliestOrderDateByConnection.get(id)! <= filters.from` (treat a missing map entry as `false` defensively — should not occur per the #2083 contract, since any connection present in `dailyRows` has ingested at least one order, but the pure function must not throw on it).
     - **Deferral comment** (verbatim intent, adjust wording to house style): `// Currency-mixing detection and gross/net tax-treatment normalization are deliberately out of scope here — see #2049/ADR-040 (currency) and the separate tax-normalization effort. totalAmount is summed as-is regardless of currency or tax treatment.`
     - Never throws; pure function of its arguments only (ADR-011).
   - **Acceptance**: Compiles with only domain-type imports (no NestJS, no TypeORM).
   - **Dependencies**: Step 1.

3. **Unit-test the pure aggregation**
   - **File**: `libs/core/src/orders/domain/order-sales-aggregation.spec.ts` (new, colocated per `order-analytics-projection.spec.ts` precedent)
   - **Action**: Cover — empty `dailyRows` (all-zero headline, empty `channels`); single connection; multi-connection revenue share; cancelled rows excluded from `revenue`/`orderCount` but included in `cancelledCount`/`cancelledValue`; 7-day trend zero-fill when some days have no rows; `coverageComplete: true` when earliest date predates `from`, `false` when it postdates `from`, `false` (defensive) when the map has no entry for a connection present in `dailyRows`; `revenueShare` is `0` (not `NaN`) when headline revenue is `0`.
   - **Acceptance**: `pnpm --filter @openlinker/core test order-sales-aggregation` passes (do not run locally per project convention — see § 9).

### Phase 2 — Repository ports & implementations

**Goal**: Wire the three raw-data reads the pure function needs, each a single indexed query.

**Steps**:

4. **Extend `OrderRecordRepositoryPort`**
   - **File**: `libs/core/src/orders/domain/ports/order-record-repository.port.ts`
   - **Action**: Add
     ```ts
     getDailyOrderAggregates(filters: SalesAnalyticsFilters): Promise<DailyOrderAggregateRow[]>;
     getMedianOrderValue(filters: SalesAnalyticsFilters): Promise<number | null>;
     ```
     with doc comments explaining scope (`recordStatus = 'ready' AND placedAt IS NOT NULL AND totalAmount IS NOT NULL`) and the cancelled-order split, mirroring the doc style of `getFailedSyncValueSummary`.
   - **Acceptance**: Port compiles; no infrastructure imports (interface only).
   - **Dependencies**: Phase 1.

5. **Extend `OrderLineItemRepositoryPort`**
   - **File**: `libs/core/src/orders/domain/ports/order-line-item-repository.port.ts`
   - **Action**: Add
     ```ts
     getUnitsSoldByConnection(filters: SalesAnalyticsFilters): Promise<Map<string, number>>;
     ```
   - **Acceptance**: Port compiles.
   - **Dependencies**: Phase 1.

6. **Implement `OrderRecordRepository.getDailyOrderAggregates`**
   - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`
   - **Action**: Query builder against `order_records`, `GROUP BY date_trunc('day', "placedAt"), "sourceConnectionId"`, `WHERE "recordStatus" = 'ready' AND "placedAt" IS NOT NULL AND "totalAmount" IS NOT NULL AND "placedAt" >= :from AND "placedAt" < :to` (+ optional `sourceConnectionId` filter), using `FILTER (WHERE "cancelledAt" IS NULL)` / `FILTER (WHERE "cancelledAt" IS NOT NULL)` for the order/cancelled split — mirrors `stuckPredicate`'s `FILTER` idiom in `getFailedSyncValueSummary`. Map raw rows (`getRawMany`) to `DailyOrderAggregateRow[]`, converting numeric-as-string DB values with `Number(...)`.
   - **Acceptance**: Repository unit spec (step 8) passes against a mocked `QueryBuilder`.
   - **Dependencies**: Step 4.

7. **Implement `OrderRecordRepository.getMedianOrderValue`**
   - **File**: same as step 6
   - **Action**: `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "totalAmount") AS median FROM order_records WHERE "recordStatus"='ready' AND "cancelledAt" IS NULL AND "placedAt" IS NOT NULL AND "totalAmount" IS NOT NULL AND "placedAt" >= :from AND "placedAt" < :to` (+ optional connection filter). Return `null` when the query yields `null` (no matching rows — `PERCENTILE_CONT` over an empty set returns `NULL`, not an error).
   - **Acceptance**: Repository unit spec passes.
   - **Dependencies**: Step 4.

8. **Repository unit tests**
   - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/__tests__/order-record.repository.spec.ts` (extend existing file)
   - **Action**: Add `describe('getDailyOrderAggregates', ...)` / `describe('getMedianOrderValue', ...)` blocks mocking the TypeORM `Repository`/`SelectQueryBuilder`, mirroring the existing spec's mocking style for `getFailedSyncValueSummary`.
   - **Acceptance**: Covers — empty result set, single-row, multi-connection grouping, `sourceConnectionId` filter applied when provided, median `null` on empty set.
   - **Dependencies**: Steps 6–7.

9. **Implement `OrderLineItemRepository.getUnitsSoldByConnection`**
   - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/order-line-item.repository.ts`
   - **Action**: Query builder joining `order_line_items` (`li`) to `order_records` (`rec`) on `rec."internalOrderId" = li."orderRecordId"`, `WHERE rec."recordStatus" = 'ready' AND rec."cancelledAt" IS NULL AND li."placedAt" >= :from AND li."placedAt" < :to` (+ optional `sourceConnectionId`, applied against `li."sourceConnectionId"` since it's denormalized there and avoids widening the join), `GROUP BY li."sourceConnectionId"`, `SUM(li."quantity")`. Return a `Map<string, number>` (absent connection = 0 units, per the existing "absent key" convention).
   - **Acceptance**: Extend `__tests__/order-line-item.repository.spec.ts` with a `getUnitsSoldByConnection` block (mocked query builder), covering empty result and multi-connection grouping.
   - **Dependencies**: Step 5.

### Phase 3 — Service composition

**Goal**: Compose the three raw reads + the existing earliest-date read into the final response shape, entirely within the `orders` context.

**Steps**:

10. **Extend `IOrderRecordService`**
    - **File**: `libs/core/src/orders/application/interfaces/order-record.service.interface.ts`
    - **Action**: Add
      ```ts
      getSalesAndChannelAnalytics(filters: SalesAnalyticsFilters): Promise<SalesAndChannelAnalytics>;
      ```
      with a doc comment following the file's existing style (purpose, cross-context note: this is the surface `apps/api`'s `SalesAnalyticsController` uses instead of the repository ports directly).
    - **Acceptance**: Interface compiles.
    - **Dependencies**: Phase 2.

11. **Implement in `OrderRecordService`**
    - **File**: `libs/core/src/orders/application/services/order-record.service.ts`
    - **Action**:
      - Inject `ORDER_LINE_ITEM_REPOSITORY_TOKEN` (`OrderLineItemRepositoryPort`) into the constructor alongside the existing `ORDER_RECORD_REPOSITORY_TOKEN` — check `orders.module.ts` already provides this token (it does, per existing `OrderLineItemRepository` wiring) so no module change is needed beyond adding the new dependency to the existing `OrderRecordService` provider entry (NestJS resolves it automatically; no explicit module edit required since the token is already bound).
      - `getSalesAndChannelAnalytics(filters)`:
        1. `Promise.all([repository.getDailyOrderAggregates(filters), repository.getMedianOrderValue(filters), lineItemRepository.getUnitsSoldByConnection(filters)])`.
        2. Derive `connectionIds = [...new Set(dailyRows.map(r => r.sourceConnectionId))]`.
        3. `await this.getEarliestOrderDateByConnection(connectionIds)` (existing method on `this`, reused as-is — `connectionIds.length === 0` short-circuits to an empty map without a query, matching the existing method's own early-return behavior if present, or is a cheap no-op query otherwise).
        4. Call `buildSalesAndChannelAnalytics({...})` and return.
    - **Acceptance**: Extend `__tests__/order-record.service.spec.ts` with a `getSalesAndChannelAnalytics` block, mocking both repository ports.
    - **Dependencies**: Step 10; Phase 2.
    - **Risk flag**: grep the codebase for any other direct instantiation of `OrderRecordService` (e.g. a test file constructing it manually rather than via the Nest testing module) that would need updating for the new constructor parameter — do this as the first sub-step before writing the implementation.

12. **Barrel export**
    - **File**: wherever `libs/core/src/orders`'s top-level barrel/sub-barrel re-exports domain types today (locate via the existing `OrderHealthSummaryFilters` export path — same barrel).
    - **Action**: Export `SalesAnalyticsFilters`, `SalesAndChannelAnalytics`, `ChannelSalesAnalytics`, `SalesAnalyticsHeadline`, `DailyTrendPoint` (the two internal-only shapes, `DailyOrderAggregateRow` and the aggregation-function input type, do **not** need to cross the barrel — they're implementation detail between the repository and the service, both inside `orders`).
    - **Acceptance**: `apps/api` can `import type { SalesAnalyticsFilters, SalesAndChannelAnalytics } from '@openlinker/core/orders';` without a deep-path violation.
    - **Dependencies**: Step 1.

### Phase 4 — HTTP layer

**Goal**: Expose the composed read as `GET /analytics/sales`.

**Steps**:

13. **Query DTO**
    - **File**: `apps/api/src/analytics/http/dto/sales-analytics-query.dto.ts` (new)
    - **Action**: `from`/`to` as `@IsNotEmpty() @IsDateString()` (required — unlike `OrderHealthSummaryQueryDto`'s optional pair, a sales query without a range is meaningless), optional `sourceConnectionId` `@IsUUID()`. Swagger `@ApiProperty`/`@ApiPropertyOptional`.
    - **Acceptance**: `class-validator` rejects a request missing `from`/`to`; a malformed date string 400s at the pipe.
    - **Dependencies**: None (parallel to Phases 1–3).

14. **Response DTO**
    - **File**: `apps/api/src/analytics/http/dto/sales-analytics-response.dto.ts` (new)
    - **Action**: `DailyTrendPointDto`, `SalesAnalyticsHeadlineDto`, `ChannelSalesAnalyticsDto`, `SalesAnalyticsResponseDto` — each with `@ApiProperty` decorators and a `static fromDomain(...)` mapper, mirroring `needs-attention-response.dto.ts`'s exact structure (read that file first; copy its class-per-shape + static-mapper pattern verbatim).
    - **Acceptance**: `fromDomain` round-trips every field of `SalesAndChannelAnalytics` with no `any`.
    - **Dependencies**: Phase 1 (domain types).

15. **Controller**
    - **File**: `apps/api/src/analytics/http/sales-analytics.controller.ts` (new)
    - **Action**: `@Controller('analytics')`, `@Get('sales')`, `@ApiBearerAuth()` + `@ApiTags('analytics')` (matches `NeedsAttentionController`; relies on the global `JwtAuthGuard` per CLAUDE.md, no local `@UseGuards`). Constructor injects `@Inject(ORDER_RECORD_SERVICE_TOKEN) private readonly orderRecordService: IOrderRecordService` from `@openlinker/core/orders` directly (no new `apps/api` service layer — see § 3 justification). Handler: parse `from`/`to` query strings to `Date`; `throw new BadRequestException('to must be after from')` when `to <= from`; call `orderRecordService.getSalesAndChannelAnalytics({ from, to, sourceConnectionId })`; return `SalesAnalyticsResponseDto.fromDomain(result)`.
    - **Acceptance**: 200 with a well-formed range; 400 for `to <= from`; 400 for a missing/malformed query param (DTO validation).
    - **Dependencies**: Steps 13–14, Phase 3.

16. **Controller unit test**
    - **File**: `apps/api/src/analytics/http/sales-analytics.controller.spec.ts` (new, mirrors `needs-attention.controller.spec.ts`)
    - **Action**: Mock `IOrderRecordService`; assert the happy path maps domain → DTO correctly, and the `to <= from` 400 path.
    - **Dependencies**: Step 15.

17. **Module registration**
    - **File**: `apps/api/src/analytics/analytics.module.ts`
    - **Action**: Add `SalesAnalyticsController` to the `controllers` array (module already imports `OrdersModule`, so `ORDER_RECORD_SERVICE_TOKEN` is already resolvable). Update the module's own header comment (it currently enumerates its controllers) to mention the new one.
    - **Acceptance**: `pnpm --filter @openlinker/api type-check` passes; app boots (implied by controller test + existing module boot tests, if any).
    - **Dependencies**: Step 15.

### Phase 5 — Documentation

**Goal**: Keep `architecture-overview.md` in sync with the new consumer of the #1985 substrate, per house convention.

**Steps**:

18. **Update `architecture-overview.md`**
    - **File**: `docs/architecture-overview.md`, § Orders → "Order analytics read model (#1985 …)" bullet.
    - **Action**: Append one sentence noting #1987 ships `GET /analytics/sales` (`IOrderRecordService.getSalesAndChannelAnalytics`), consuming the substrate; explicitly note the currency/tax-normalization deferral (#2049/ADR-040) so a future reader doesn't mistake the omission for an oversight.
    - **Acceptance**: One sentence, no restructuring of the existing paragraph.
    - **Dependencies**: Phase 4 complete (so the sentence describes shipped, not planned, behavior).

---

## 7. Alternatives Considered

### Alternative 1: Compute the median in the application layer (sort in JS)
- **Description**: Fetch all matching `totalAmount` values for the range and compute the median in `OrderRecordService` with a sort + midpoint pick.
- **Why Rejected**: At this persona's stated volume (10–100 orders/day, per #1985/#1987's own framing) either approach is fast, but `PERCENTILE_CONT` keeps the computation in the database (one query, no N-row transfer, no duplicate logic to test against SQL semantics) and is the idiomatic PostgreSQL primitive for exactly this. It also composes naturally with the existing `FILTER`-clause aggregate style already used throughout `OrderRecordRepository`.
- **Trade-offs**: `PERCENTILE_CONT` is a Postgres-specific ordered-set aggregate; if the project ever needed database portability this would need reworking. Not a real constraint today — every other repository in this codebase is already Postgres-specific (JSONB operators, `FILTER`, etc.).

### Alternative 2: A composition service at the `apps/api` layer (mirroring `NeedsAttentionService`)
- **Description**: Introduce a `SalesAnalyticsService` in `apps/api/src/analytics/application/services/`, mirroring `NeedsAttentionService`'s shape, that calls `IOrderRecordService` and maps to the response.
- **Why Rejected**: `NeedsAttentionService` exists specifically because it fans out across **two core contexts** (`listings` + `orders`) that would otherwise need a new core-to-core dependency edge if composed inside either context. This feature's entire computation is inside `orders` already — introducing an `apps/api`-layer service here would be composing a single call with no fan-out, pure indirection with no architectural payoff. The controller injecting `IOrderRecordService` directly is the simpler, equally-testable choice (mock the port in the controller spec, same as any other single-service controller in the codebase).
- **Trade-offs**: If a future issue (e.g. combining this with #1988's top-products read) needs to fan out across contexts for one `/analytics` response, an `apps/api`-layer composition service becomes the right call at that point — not before.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Hexagonal layering respected: domain (types + pure aggregation) → application (service composing ports) → infrastructure (repository implementations) → interface (controller + DTOs).
- ✅ No cross-context edge added; `orders` already owns both source tables.
- ✅ Ports, not concrete repositories, injected everywhere (`OrderRecordRepositoryPort`, `OrderLineItemRepositoryPort`, `IOrderRecordService`).
- ✅ Domain aggregation function is pure (ADR-011): no I/O, no framework import, colocated spec.

### Naming Conventions
- ✅ `*.types.ts` for new types, `*.port.ts` extended (not renamed), `*.service.interface.ts` extended, `*-response.dto.ts` / `*-query.dto.ts` per interface-layer convention, `SalesAnalyticsController` (`{Resource}Controller`), `getSalesAndChannelAnalytics`/`getDailyOrderAggregates`/etc. camelCase.

### Existing Patterns
- ✅ Verified against `getFailedSyncValueSummary`/`countByHealth` (aggregate-with-FILTER), `getEarliestOrderDateByConnection` (#2083, batched cross-context read via service), `NeedsAttentionController`/`order-health-summary-query.dto.ts` (HTTP layer), `order-analytics-projection.ts` (pure domain derivation) — all read directly in this session.

### Risks
- **#1985 is unmerged and marked `CONFLICTING`** — the exact shape of `order_records`/`order_line_items` (column names, the `upsertWithLineItems` transaction boundary) could still change during #2014's conflict resolution before this plan's Phase 2 can be implemented against real code. **Mitigation**: do not start Phase 2 until #2014 merges (or this work is explicitly stacked on that branch with an owned rebase plan); re-verify the exact port/entity shapes referenced in this plan (§ 4) against `main` at that time before writing code.
- **`PERCENTILE_CONT` and the `FILTER`-clause daily-aggregate query both scan `order_records` for the range** — at the stated volume (10–100 orders/day) this is a non-issue; the existing `IDX_order_records_placedAt` index (added by #1985's migration) covers the range predicate. No new index is proposed.
- **A malformed but non-empty `sourceConnectionId` query param** that doesn't match any connection silently returns an empty `channels[]` and a zero headline — this mirrors the existing "absent key = no data" convention elsewhere in the codebase (no connection-existence validation is performed by peer endpoints like `OrderHealthSummaryQueryDto` either), so this plan does not add one.

### Edge Cases
- **Zero orders in range**: headline is all-zero, `channels: []`, `trend` is 7 zero-filled points. Covered by the pure-function unit test (step 3).
- **A connection with orders in range but no `placedAt`-dated rows at all** (all `null`): excluded entirely by the `placedAt IS NOT NULL` filter — this is a data-quality edge case pre-existing in #1985's own scoping ("null when the source didn't expose one"), not something this plan needs to paper over.
- **`from === to`**: rejected as a 400 by the `to <= from` check in the controller (an empty half-open range is a caller error, not a valid "no data" query).
- **Every order in range is cancelled**: `orderCount`/`revenue` are `0`, `averageOrderValue` is `0` (not `NaN`, guarded by the `orderCount > 0` check), `medianOrderValue` is `0` (the `PERCENTILE_CONT` query's `cancelledAt IS NULL` filter yields no rows → `null` → coalesced to `0` by the pure function), `cancelledCount`/`cancelledValue` carry the real totals.

### Backward Compatibility
- ✅ Purely additive: new port methods, new service method, new controller/route. No existing method signature changes except `OrderRecordService`'s constructor gaining one injected dependency (already-bound token, no module wiring change) — grep-verified in step 11 for any test file that constructs it manually.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/core/src/orders/domain/order-sales-aggregation.spec.ts` — pure function, all branches (§ 6 step 3).
- `libs/core/src/orders/infrastructure/persistence/repositories/__tests__/order-record.repository.spec.ts` — extended with the two new methods, mocked query builder.
- `libs/core/src/orders/infrastructure/persistence/repositories/__tests__/order-line-item.repository.spec.ts` — extended with `getUnitsSoldByConnection`, mocked query builder.
- `libs/core/src/orders/application/services/__tests__/order-record.service.spec.ts` — extended with `getSalesAndChannelAnalytics`, mocked ports.
- `apps/api/src/analytics/http/sales-analytics.controller.spec.ts` — new, mocked `IOrderRecordService`.

### Integration Tests
- Not proposed for this plan. The existing `needs-attention`/`analytics-trust` HTTP surfaces have no `*.int-spec.ts` counterpart either (verified: no `analytics` directory under `apps/api/test/integration/`), and this feature's only genuinely Postgres-specific behavior (`PERCENTILE_CONT`, `date_trunc` grouping, the `FILTER` clauses) is exactly what a mocked-query-builder unit test cannot verify — but per the project's existing testing posture for this analytics module, that risk is accepted at the unit-test level, consistent with its siblings. If a reviewer wants stronger DB-behavior confidence, a single `test/integration/analytics/sales-analytics.int-spec.ts` seeding a handful of `order_records`/`order_line_items` rows via `harness.getDataSource()` and asserting the HTTP response would be the natural addition — flagged here as an optional follow-up, not required by this plan.

### Mocking Strategy
- Repository specs: mock TypeORM's `Repository`/`SelectQueryBuilder` (`createQueryBuilder`, `getRawMany`, `getRawOne`), per `order-record.repository.spec.ts`'s existing style.
- Service spec: mock `OrderRecordRepositoryPort` and `OrderLineItemRepositoryPort`.
- Controller spec: mock `IOrderRecordService`.

### Acceptance Criteria (from #1987, minus the explicitly-deferred currency/tax items)
- [ ] Given a date range, the endpoint returns revenue, order count, AOV, median order value, and units.
- [ ] The same figures (except median, headline-only) are returned per source connection, with each channel's revenue share.
- [ ] Figures are bucketed by the buyer's order time (`placedAt`), not OL's ingestion time.
- [ ] Cancelled orders are excluded from revenue/order count; cancelled count and value are reported separately.
- [ ] A channel whose data does not span the full requested range is identifiable from the response (`coverageComplete: false`).
- [ ] A 7-day daily trend series (revenue + order count) is returned at headline level and per channel.
- [ ] The count of cancelled orders is returned alongside the cancelled value.
- [ ] Tests cover: a cancelled order excluded from revenue but counted separately; an outlier order's effect on mean vs. median; a channel with partial-range coverage; zero-order range.
- [ ] **Explicitly not covered by this plan** (tracked elsewhere): mixed-currency handling, gross/net comparison.
- [ ] No new ESLint warnings or type errors introduced (`pnpm lint`, `pnpm type-check`).

Per project convention, `pnpm test` is not run locally during implementation — CI runs the full unit-test suite; `pnpm lint`/`pnpm type-check` are run locally as the fast local gate.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries (no Integration package touched)
- [x] Uses existing patterns (no unnecessary abstractions — see § 7 Alternative 2)
- [x] Idempotency considered (read-only endpoint; N/A)
- [x] Event-driven patterns used where applicable (N/A — pure read)
- [x] Rate limits & retries addressed (N/A — no external system)
- [x] Error handling comprehensive (400 on invalid range; DTO validation on malformed input)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready — **once #1985/#2014 merges** (see § 8 Risks)
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md) — § Orders, § Cross-context dependencies in core
- [Engineering Standards](../engineering-standards.md) — Repository Ports Pattern, Symbol DI Token convention
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- [ADR-039: Order analytics read model persistence strategy](../architecture/adrs/039-order-analytics-read-model-persistence-strategy.md)
- GitHub issue [#1987](https://github.com/openlinker-project/openlinker/issues/1987), blocked by [#1985](https://github.com/openlinker-project/openlinker/issues/1985)
