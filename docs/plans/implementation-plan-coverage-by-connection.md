# Implementation Plan — Aggregate-by-connection reads for Data Coverage categories

- **Issue**: [#2713](https://github.com/openlinker-project/openlinker/issues/2713)
- **Type**: CORE (application services) + Interface (new controller route)
- **Layer**: Application, Interface
- **Base branch for this work**: `2799-product-identity-coverage-rows` (PR #2808) — this task is a pure
  follow-up to epic #2452 Phase 8 (#2481, PR #2701) and depends on nothing from that PR being reverted.

## 1. Goal & Scope

### Goal

`apps/web/src/features/analytics/components/channel-sales-table.tsx`'s `useCoverageCrossReferenceQuery`
today answers "how many affected orders does connection X have, per Data Coverage category" by paging
through the FULL affected-order list (`GET /analytics/coverage/currency-mismatch-orders`,
`GET /analytics/coverage/tax-orders`) and grouping by `sourceConnectionId` **client-side**. On an install
with a large `netExcludedCount`/`unconvertedCount` population this drains many pages of full order rows
over the network just to produce a handful of per-connection counts.

Add one new read per detector that does the `GROUP BY sourceConnectionId` server-side, plus one new
controller endpoint that composes all of them into a single response — mirroring
`AnalyticsCoverageController.getCoverage`'s existing `Promise.all` composition shape.

### Primary objectives

1. `OrderRecordRepositoryPort` gains a currency-mismatch aggregate-by-connection method
   (`GROUP BY` SQL — same predicate as `findCurrencyMismatchOrders`, no per-row hydration).
2. `ITaxCoverageDetectionService` gains a tax A/B/C aggregate-by-connection method that reuses the
   existing `classify()` pass and groups the already-classified rows by `sourceConnectionId` in memory
   — never a second live-catalogue read.
3. One new controller endpoint, `GET /analytics/coverage/by-connection`, composing both aggregates (see
   §4 on why `product-matching` is scoped OUT) into `{ category, rows: { sourceConnectionId,
   affectedCount }[] }[]`.

### Non-goals

- No FE changes. This is the paired backend issue for a separate FE ticket that will consume the new
  endpoint and delete `useCoverageCrossReferenceQuery`'s client-side pagination/grouping. Out of scope
  here.
- No change to any existing endpoint's response shape (`GET /analytics/coverage`,
  `GET /analytics/coverage/currency-mismatch-orders`, `GET /analytics/coverage/tax-orders`) — this is
  purely additive.
- No `product-matching` aggregate (see §4 — confirmed unnecessary, not merely deferred).
- No FX/tax computation changes. This task reshapes existing detector output; it introduces no new
  business logic about what counts as a mismatch.

### Constraints honoured

- Cross-context reads still go through `I*Service`, never a repository port directly (the controller
  already follows this for the sibling endpoint and will for the new one).
- `orders` must not import `analytics`; the new endpoint reuses the existing pattern of resolving
  `currentReportingCurrency` / `includeBackfilledTaxRatesInNetSales` in the `apps/api` layer and
  threading them in as plain parameters (already how `AnalyticsCoverageController.getCoverage` does it).
- Same `SalesAnalyticsFilters` / `MAX_COVERAGE_RANGE_DAYS` date-range validation as
  `AnalyticsCoverageController`.

## 2. Research summary

### Existing patterns this plan reuses verbatim

- **`OrderRecordRepository.findCurrencyMismatchOrders`** (`libs/core/src/orders/infrastructure/
  persistence/repositories/order-record.repository.ts:614`) — the predicate to reuse for the new
  aggregate: `applySalesAnalyticsScope(qb, filters)` (private helper, `recordStatus = 'ready'`,
  resolvable `placedAt`/`totalAmount`, in-range, optional `sourceConnectionId`) plus
  `cancelledAt IS NULL` plus `(reportingCurrency IS NULL OR reportingCurrency !=
  currentReportingCurrency)`. The new method drops `.orderBy/.take/.skip/.getManyAndCount()` for
  `.select('rec.sourceConnectionId', ...).addSelect('COUNT(*)', ...).groupBy(...).getRawMany()` —
  exactly the shape `getDailyOrderAggregates` (same file, ~line 496-556) already uses for its own
  `GROUP BY rec.sourceConnectionId`.
- **`TaxCoverageDetectionService.getAllCategoryPages`** (`libs/core/src/orders/application/services/
  tax-coverage-detection.service.ts:150`) — the sibling to copy: it calls `classify()` ONCE and reshapes
  the same `TaxCoverageClassification` three ways. The new method does the same, grouping each of the
  three category arrays by `sourceConnectionId` (every `TaxCoverageOrderRow` already carries
  `sourceConnectionId` via `toRow`, confirmed at `tax-coverage-detection.service.ts:178`) instead of
  slicing pages.
- **`AnalyticsCoverageController.getCoverage`** (`apps/api/src/analytics/http/
  analytics-coverage.controller.ts`) — the composition shape to mirror: resolve
  `currentReportingCurrency` once, resolve `includeBackfilledTaxRatesInNetSales` once, `Promise.all` the
  detector reads, assemble one response DTO. The new endpoint is a sibling `@Get` on the same
  controller, reusing `AnalyticsCoverageQueryDto` unchanged (its `from`/`to`/`sourceConnectionId` already
  cover this read's needs) and the same `MAX_COVERAGE_RANGE_DAYS` validation — will extract that
  validation into a small private helper on the controller rather than duplicate the `if` blocks (see
  Step 3.4).

### Confirmed via codebase check: `product-matching` aggregate is NOT needed

The issue flags this as "needs confirmation before implementing." Confirmed by reading
`apps/web/src/features/analytics/components/channel-sales-table.tsx`: its own header comment
(around line 53) states the cross-reference is "currency, or one of tax-a/b/c — never
`product-matching`, which cannot [be cross-referenced]" and `useCoverageCrossReferenceQuery` is called
exactly 4 times (currency, tax-a, tax-b, tax-c) — no product-matching call site exists anywhere in the
FE. Building a `getProductMatchingErrorOrdersByConnection` aggregate would ship dead code. **Scoped out.**

### Types already in place, reused unchanged

- `SalesAnalyticsFilters` (`{ from, to, sourceConnectionId? }`) — currency + tax aggregates.
- `CoverageCategory` / `CoverageCategoryValues` (`libs/core/src/orders/domain/types/
  coverage-detection.types.ts`) — already includes `'currency' | 'tax-a' | 'tax-b' | 'tax-c' |
  'product-matching'`; the response DTO will use only the four relevant values via
  `TaxCoverageCategoryValues` + a literal `'currency'`, matching how `getCoverage` already assembles its
  `categories` array.

## 3. Design

### 3.1 New domain type — `CoverageConnectionAggregateRow`

New file section in `libs/core/src/orders/domain/types/coverage-detection.types.ts` (additive, per that
file's own stated convention — "kept additive on purpose"):

```typescript
/**
 * One `(category, sourceConnectionId)` count for the aggregate-by-connection
 * read (#2713) — the shape `useCoverageCrossReferenceQuery`'s client-side
 * GROUP BY currently derives from a full paginated order list. Deliberately
 * NOT keyed per-category at the type level (no `CurrencyConnectionAggregate`
 * / `TaxConnectionAggregate` split) — every consumer of this shape wants the
 * same two fields regardless of which detector produced it.
 */
export interface CoverageConnectionAggregateRow {
  sourceConnectionId: string;
  affectedCount: number;
}
```

### 3.2 Repository layer — currency aggregate

**Port** (`libs/core/src/orders/domain/ports/order-record-repository.port.ts`), new method
`findCurrencyMismatchOrdersByConnection`, doc comment cross-referencing `findCurrencyMismatchOrders` and
stating the IDENTICAL predicate (so the two reads can never silently diverge on what counts as a
mismatch — same rationale already used for every sibling doc comment in this file):

```typescript
findCurrencyMismatchOrdersByConnection(
  filters: SalesAnalyticsFilters,
  currentReportingCurrency: string
): Promise<CoverageConnectionAggregateRow[]>;
```

**Repository** (`order-record.repository.ts`), new method placed immediately after
`findCurrencyMismatchOrders`:

```typescript
async findCurrencyMismatchOrdersByConnection(
  filters: SalesAnalyticsFilters,
  currentReportingCurrency: string
): Promise<CoverageConnectionAggregateRow[]> {
  const qb = this.repository
    .createQueryBuilder('rec')
    .select('rec.sourceConnectionId', 'source_connection_id')
    .addSelect('COUNT(*)', 'affected_count')
    .andWhere('rec."cancelledAt" IS NULL')
    .andWhere(
      '(rec."reportingCurrency" IS NULL OR rec."reportingCurrency" != :currentReportingCurrency)',
      { currentReportingCurrency }
    )
    .groupBy('rec.sourceConnectionId');

  this.applySalesAnalyticsScope(qb, filters);

  const rows = await qb.getRawMany<{ source_connection_id: string; affected_count: string }>();

  return rows.map((row) => ({
    sourceConnectionId: row.source_connection_id,
    affectedCount: Number(row.affected_count),
  }));
}
```

A connection with zero mismatches is simply absent from the result — the "absent key = no data"
convention `getDailyOrderAggregates`/`findEarliestOrderDateByConnection` already establish in this file.
No pagination — this is already a bounded number of rows (≤ number of `OrderSource`-capable
connections), unlike the order-list reads it replaces for this use case.

### 3.3 Application layer — tax A/B/C aggregate

**Interface** (`tax-coverage-detection.service.interface.ts`), new method
`getAllCategoryCountsByConnection`:

```typescript
/**
 * All three categories' per-connection counts in ONE {@link classify} pass
 * (#2713) — the aggregate-by-connection counterpart to
 * {@link getAllCategoryPages}, for the same reason that method exists:
 * `AnalyticsCoverageController` needs `tax-a`/`tax-b`/`tax-c` together, and
 * three separate calls would re-run the live-catalogue classification pass
 * three times over the SAME candidate population.
 */
getAllCategoryCountsByConnection(
  filters: SalesAnalyticsFilters,
  currentReportingCurrency: string,
  includeBackfilledPreRollout?: boolean
): Promise<Record<TaxCoverageCategory, CoverageConnectionAggregateRow[]>>;
```

**Service** (`tax-coverage-detection.service.ts`), new method placed after `getAllCategoryPages`, reusing
`classify()` and a small private grouping helper:

```typescript
async getAllCategoryCountsByConnection(
  filters: SalesAnalyticsFilters,
  currentReportingCurrency: string,
  includeBackfilledPreRollout = false
): Promise<Record<TaxCoverageCategory, CoverageConnectionAggregateRow[]>> {
  const classification = await this.classify(
    filters,
    currentReportingCurrency,
    includeBackfilledPreRollout
  );
  const counts: Partial<Record<TaxCoverageCategory, CoverageConnectionAggregateRow[]>> = {};
  for (const category of TaxCoverageCategoryValues) {
    counts[category] = this.groupByConnection(classification[category]);
  }
  return counts as Record<TaxCoverageCategory, CoverageConnectionAggregateRow[]>;
}

private groupByConnection(rows: TaxCoverageOrderRow[]): CoverageConnectionAggregateRow[] {
  const byConnection = new Map<string, number>();
  for (const row of rows) {
    byConnection.set(row.sourceConnectionId, (byConnection.get(row.sourceConnectionId) ?? 0) + 1);
  }
  return Array.from(byConnection, ([sourceConnectionId, affectedCount]) => ({
    sourceConnectionId,
    affectedCount,
  }));
}
```

This is a genuinely new `classify()` call site (distinct from `getCoverage`'s own call), so — per the
issue's acceptance criteria — the unit test must assert it calls `findNetExcludedOrderCandidates`
(the one live-catalogue-touching read inside `classify`) exactly once per invocation, not once per
category.

### 3.4 Interface layer — new controller endpoint

**Query DTO**: reuse `AnalyticsCoverageQueryDto` unchanged — same `from`/`to`/`sourceConnectionId`
shape, same semantics (currency/tax bucketed by `placedAt`).

**Response DTO** — new file `apps/api/src/analytics/http/dto/analytics-coverage-by-connection-response.dto.ts`:

```typescript
export class CoverageConnectionRowDto {
  @ApiProperty() sourceConnectionId!: string;
  @ApiProperty() affectedCount!: number;
}

export class CoverageCategoryConnectionRowsDto {
  @ApiProperty({ enum: CoverageCategoryValues }) category!: CoverageCategory;
  @ApiProperty({ type: [CoverageConnectionRowDto] }) rows!: CoverageConnectionRowDto[];
}

export class AnalyticsCoverageByConnectionResponseDto {
  @ApiProperty({ type: [CoverageCategoryConnectionRowsDto] })
  categories!: CoverageCategoryConnectionRowsDto[];
}
```

Note: unlike `CoverageCategoryRowDto`, this row carries no `status`/`activeRunId` — those are
per-category lifecycle facts, not per-connection ones, and the issue's own assumption pins the response
shape to `{ category, rows: { sourceConnectionId, affectedCount }[] }[]`.

**Controller method** (`AnalyticsCoverageController`), new `@Get('coverage/by-connection')` sibling to
`getCoverage`:

```typescript
@Get('coverage/by-connection')
@ApiOperation({
  summary:
    'Data Coverage panel, per-connection breakdown — affected-order counts grouped by sourceConnectionId (currency, tax A/B/C)',
})
@ApiResponse({ status: 200, type: AnalyticsCoverageByConnectionResponseDto })
async getCoverageByConnection(
  @Query() query: AnalyticsCoverageQueryDto
): Promise<AnalyticsCoverageByConnectionResponseDto> {
  const { from, to } = this.parseAndValidateRange(query); // extracted helper, see below

  const salesFilters = { from, to, sourceConnectionId: query.sourceConnectionId };

  const currentReportingCurrency = await this.reportingCurrencySettings.resolve();
  const { includeBackfilledTaxRatesInNetSales } = await this.displaySettings.getSettings();

  const [currencyRows, taxRowsByCategory] = await Promise.all([
    this.orderRecordService.getCurrencyMismatchOrdersByConnection(
      salesFilters,
      currentReportingCurrency
    ),
    this.taxCoverageDetectionService.getAllCategoryCountsByConnection(
      salesFilters,
      currentReportingCurrency,
      includeBackfilledTaxRatesInNetSales
    ),
  ]);

  const response = new AnalyticsCoverageByConnectionResponseDto();
  response.categories = [
    { category: 'currency', rows: currencyRows },
    ...TaxCoverageCategoryValues.map((category) => ({
      category,
      rows: taxRowsByCategory[category],
    })),
  ];
  return response;
}
```

`parseAndValidateRange` is a small private helper extracted from `getCoverage`'s existing inline
`from`/`to`/`MAX_COVERAGE_RANGE_DAYS` block (lines 90-100 today), reused by both endpoints — a
refactor-while-touching, not scope creep, since duplicating that validation block verbatim into the new
method would be the actual standards violation (`docs/engineering-standards.md` favors reuse over
duplication). `getCoverage` is updated to call the same helper; its behavior is unchanged (same
`BadRequestException` messages, same 400 status).

### 3.5 `IOrderRecordService` — thin pass-through

**Interface** (`order-record.service.interface.ts`), new method next to `getCurrencyMismatchOrders`:

```typescript
/**
 * Data Coverage `'currency'` category aggregate-by-connection (#2713) — thin
 * pass-through to {@link OrderRecordRepositoryPort.findCurrencyMismatchOrdersByConnection}.
 * Unlike {@link getCurrencyMismatchOrders}, no line-item enrichment is needed
 * here — a count carries no `productId`/`variantId` to attach.
 */
getCurrencyMismatchOrdersByConnection(
  filters: SalesAnalyticsFilters,
  currentReportingCurrency: string
): Promise<CoverageConnectionAggregateRow[]>;
```

**Service** (`order-record.service.ts`), thin pass-through next to `getCurrencyMismatchOrders`:

```typescript
async getCurrencyMismatchOrdersByConnection(
  filters: SalesAnalyticsFilters,
  currentReportingCurrency: string
): Promise<CoverageConnectionAggregateRow[]> {
  return this.repository.findCurrencyMismatchOrdersByConnection(filters, currentReportingCurrency);
}
```

## 4. Files touched

| File | Change |
|---|---|
| `libs/core/src/orders/domain/types/coverage-detection.types.ts` | + `CoverageConnectionAggregateRow` |
| `libs/core/src/orders/domain/ports/order-record-repository.port.ts` | + `findCurrencyMismatchOrdersByConnection` |
| `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts` | + method impl |
| `libs/core/src/orders/application/interfaces/order-record.service.interface.ts` | + `getCurrencyMismatchOrdersByConnection` |
| `libs/core/src/orders/application/services/order-record.service.ts` | + pass-through impl |
| `libs/core/src/orders/application/services/tax-coverage-detection.service.interface.ts` | + `getAllCategoryCountsByConnection` |
| `libs/core/src/orders/application/services/tax-coverage-detection.service.ts` | + method impl + `groupByConnection` private helper |
| `apps/api/src/analytics/http/dto/analytics-coverage-by-connection-response.dto.ts` | new file |
| `apps/api/src/analytics/http/analytics-coverage.controller.ts` | + `getCoverageByConnection`, extract `parseAndValidateRange` |
| Tests (see §6) | new/updated `.spec.ts` + one `.int-spec.ts` addition |

No ORM entity, no migration, no module-wiring change (all services/tokens already registered).

## 5. Step-by-step plan

**Phase 1 — Domain type**
1.1. Add `CoverageConnectionAggregateRow` to `coverage-detection.types.ts`. *Acceptance*: type-checks,
     no other file changed yet.

**Phase 2 — Currency aggregate (repository → service → interface)**
2.1. Add `findCurrencyMismatchOrdersByConnection` to `OrderRecordRepositoryPort`.
2.2. Implement it in `OrderRecordRepository`, reusing `applySalesAnalyticsScope`.
2.3. Add unit test(s) in `order-record.repository.spec.ts` asserting the `GROUP BY` query builder calls
     (mock query-builder pattern already used by sibling tests in that file) and the raw-row mapping
     (`source_connection_id`/`affected_count` → camelCase).
2.4. Add an integration test case to `apps/api/test/integration/orders/` (a new
     `order-record-coverage-by-connection.int-spec.ts`, or extend an existing coverage int-spec if one
     already exercises `findCurrencyMismatchOrders` against a real Postgres) with orders split across
     ≥2 connections — asserting per-connection counts match a manual tally and a connection with zero
     mismatches is simply absent from the result.
2.5. Add `getCurrencyMismatchOrdersByConnection` to `IOrderRecordService` + `OrderRecordService`
     (thin pass-through — no line-item enrichment).
2.6. Unit test in `order-record.service.spec.ts` asserting the pass-through delegates with the exact
     arguments received.

**Phase 3 — Tax A/B/C aggregate**
3.1. Add `getAllCategoryCountsByConnection` to `ITaxCoverageDetectionService`.
3.2. Implement it + the private `groupByConnection` helper in `TaxCoverageDetectionService`.
3.3. Unit test in `tax-coverage-detection.service.spec.ts` (or the file backing its existing tests):
     - fixture with candidates split across ≥2 `sourceConnectionId`s, assert grouped counts per category
       sum correctly and match `getCategoryCounts`'s totals for the same filters (cross-check the two
       methods never diverge).
     - assert `findNetExcludedOrderCandidates` (the mocked repository call standing in for the
       live-catalogue-touching path) is called exactly once per `getAllCategoryCountsByConnection`
       invocation — the "no second live-catalogue read per connection" acceptance criterion.

**Phase 4 — Controller endpoint**
4.1. Extract `parseAndValidateRange` from `getCoverage`'s inline block; rewire `getCoverage` to use it
     (behavior-preserving refactor — same error messages/status).
4.2. Add `analytics-coverage-by-connection-response.dto.ts`.
4.3. Add `getCoverageByConnection` to `AnalyticsCoverageController`.
4.4. Add Swagger documentation via `@ApiOperation`/`@ApiResponse` (already shown above).
4.5. Controller-level test (unit, mocking the two services — mirrors however `getCoverage` is tested
     today, e2e or unit) asserting: 400 on missing/invalid range, 400 on range > `MAX_COVERAGE_RANGE_DAYS`,
     200 with the composed `{ categories: [...] }` shape for a happy-path fixture, and that
     `sourceConnectionId` query-param narrowing reaches both underlying reads.

**Phase 5 — Review pass**
5.1. Re-read both new predicate copies (currency SQL `WHERE`, tax `classify()` reuse) side-by-side
     against their non-aggregate siblings to confirm byte-identical scoping — this is the acceptance
     criterion "verified against a fixture with orders split across ≥2 connections," and the
     regression-guard convention this file's siblings already follow (their doc comments explicitly
     state "same predicate, so totals can never diverge").
5.2. Confirm no `product-matching` aggregate was added (scoped out per §"Confirmed" above) and that the
     new endpoint's Swagger description says so if asked — no action needed, just a final scope check.
5.3. Run `pnpm lint` / `pnpm type-check` for the touched packages (per CLAUDE.md — user has instructed
     not to run `pnpm test` in this session; type-check/lint only).

## 6. Testing strategy

- **Repository**: unit test (mocked `Repository`/`SelectQueryBuilder`, matching the existing spec file's
  mocking style) + one integration test against a real Postgres fixture (Testcontainers), per the
  issue's own acceptance criterion ("verified against a fixture with orders split across ≥2
  connections").
- **`TaxCoverageDetectionService`**: unit test with a spy/mock call-count assertion on
  `findNetExcludedOrderCandidates`, per the issue's explicit acceptance criterion ("no second
  live-catalogue read per connection").
- **`OrderRecordService`**: unit test, pass-through argument assertion.
- **Controller**: unit test covering validation + happy path + `sourceConnectionId` narrowing.
- No FE tests — out of scope.

## 7. Risks & edge cases

- **Empty result set**: a category/filter combination with zero mismatches must return `rows: []`, not
  omit the category row entirely — the controller always emits all four category entries
  (`'currency'` + the three `TaxCoverageCategoryValues`), each carrying a (possibly empty) `rows` array.
  This matches `getCoverage`'s existing behavior of always emitting every `CoverageCategoryValues` row.
- **`sourceConnectionId` query param on an already-narrowed request**: when the caller passes
  `sourceConnectionId`, the aggregate degenerates to at most one row per category — correct behavior,
  not a bug, since `applySalesAnalyticsScope` already narrows the underlying population the same way
  `getCoverage` does today.
- **Currency-setting change mid-window**: unaffected by this change — the aggregate reads the exact same
  `reportingCurrency`-stamped rows the existing drill-down does, with `currentReportingCurrency`
  resolved once per request (existing pattern, preserved).
- **Backward compatibility**: fully additive — no existing endpoint, DTO, or service method signature
  changes (aside from the internal `parseAndValidateRange` extraction, which is behavior-preserving).
- **Performance**: the currency aggregate is a single indexed `GROUP BY` (same index profile as
  `findCurrencyMismatchOrders`'s `WHERE` clause); the tax aggregate reuses the existing unpaged
  `classify()` pass with no additional catalogue calls — the acceptance criterion this plan is built
  around.

## 8. Final validation checklist

- [x] Follows hexagonal architecture (repository port → repository impl → application service → thin
      controller composition; no CORE↔Integration boundary crossed)
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns — `getDailyOrderAggregates`'s `GROUP BY` shape, `getAllCategoryPages`'s
      single-`classify()`-call shape, `getCoverage`'s composition shape; no new abstractions introduced
- [x] Idempotency — read-only, N/A
- [x] Event-driven patterns — N/A (no writes)
- [x] Rate limits & retries — N/A (no outbound platform calls; tax aggregate reuses `classify()`'s
      existing `IProductsService.getEffectiveTaxRate` calls unchanged)
- [x] Error handling — same `BadRequestException` validation as the sibling endpoint, via the extracted
      shared helper
- [x] Testing strategy complete (§6)
- [x] Naming conventions followed (`*ByConnection` suffix, `I*Service` interfaces, `*Port` for the
      repository contract, `*RepositoryPort` never crossing the cross-context boundary)
- [x] File structure matches standards (types in `*.types.ts`, DTOs in `apps/api/.../dto/`)
- [x] Plan is execution-ready

## 9. Questions & Assumptions

- **Assumption (confirmed)**: `product-matching` aggregate is scoped out — no FE consumer exists today
  (verified: `channel-sales-table.tsx` never calls `useCoverageCrossReferenceQuery` for it, and its own
  header comment says so explicitly).
- **Assumption**: response shape is `{ category, rows: { sourceConnectionId, affectedCount }[] }[]` per
  the issue's stated assumption — matches how a paired FE issue would consume it (array of category
  buckets, not a top-level per-connection grouping).
- **Assumption**: the new endpoint lives on the SAME controller (`AnalyticsCoverageController`) as a
  sibling `@Get`, rather than a new controller class — the issue's own file list names
  `analytics-coverage.controller.ts "(or a new sibling controller)"`; sibling-method is chosen because
  the endpoint shares 100% of its dependencies (`IOrderRecordService`, `ITaxCoverageDetectionService`,
  `IReportingCurrencySettingsService`, `IAnalyticsDisplaySettingsService`) with `getCoverage`, and a new
  controller class would just re-inject the same four services for no isolation benefit.
- **Open question for reviewer**: should `parseAndValidateRange` extraction be included in this PR, or
  is touching `getCoverage` (even behavior-preservingly) out of this issue's stated file list? The issue
  lists `analytics-coverage.controller.ts` as a file to touch, so this plan includes it; flag if the
  reviewer prefers duplicating the validation block instead to keep the diff minimal.

## 10. Execution note (this session)

Per explicit instruction, this plan is executed **locally only**: no commits, no pushes, no PR, no
GitHub comments. All work stays uncommitted in the local worktree for review before any of those steps
happen.
