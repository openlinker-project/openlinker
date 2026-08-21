# Implementation Plan: Top Products Analytics (#1988)

**Date**: 2026-08-18
**Status**: Draft
**Estimated Effort**: 2–3 days

---

## 1. Task Summary

**Objective**: Implement `GET /analytics/top-products` — ranks products by revenue or units over a date
range, with each row carrying its own inline per-channel (per-connection) breakdown, and flagging a
product that sells on one channel but isn't listed on another. This is issue
[#1988](https://github.com/openlinker-project/openlinker/issues/1988), child of the analytics epic #1976
(`docs/specs/product-spec-1976-analytics.md` §4 rows **C1** "Top products by revenue", **C2** "Top products
by units", **D1** "Per-product channel split — the flagship metric"), story **S3**:

> As an operator, I want to see what's selling and where, so that I can spot a product doing well on one
> channel and not another.
> - A top-products table ranks by revenue or units (operator's choice)
> - Each row breaks the product's sales down per channel, in the same row
> - A product selling on one channel but not listed on another is visibly flagged

**Context**: #1985 (this branch) built the `order_records` / `order_line_items` read-model substrate.
#1987 (PR #2151, branch `1987-sales-channel-aggregates`) built the first consumer — `/analytics/sales` —
and, in doing so, established the **currency-correctness pattern** mandated by #2049/ADR-040: every
cross-order money aggregate must split "comparable" (FX-stamped) rows from "unconverted" rows, never sum
across currencies, and always disclose the gap rather than hide it. #1988 is explicitly scoped by its own
issue text to reuse that exact pattern, not invent a new one — this plan is almost entirely "apply the
#2151 idiom to a new dimension (product × channel)" rather than new architecture.

**Classification**: CORE (`libs/core/src/orders`) + Interface (`apps/api/src/analytics`). No new port, no
new capability, no schema migration.

---

## 2. Scope & Non-Goals

### In Scope
- `OrderLineItemRepositoryPort` gains two new read methods: a bounded, paginated product ranking query and
  a per-page channel-breakdown query — both applying the stamped/unconverted FX split.
- A pure domain aggregation function that merges ranking + breakdown rows into per-product view models
  (mirrors `buildSalesAndChannelAnalytics`).
- `IOrderRecordService.getTopProducts(filters)` — the single new core service method apps/api calls.
- `GET /analytics/top-products` controller + query/response DTOs, mirroring `SalesAnalyticsController`.
- An apps/api-layer composition service that enriches the core ranking with product name/SKU
  (`IProductsService.getProductsByIds`) and a per-product "not listed on channel X" flag (reusing
  `IPublishedVariantsService.getPublishedVariantIds`, the same primitive #1983's `CoverageGapReadService`
  already uses) — bounded to the current page, never the whole catalogue.
- Sort by `revenue` or `units`; pagination (`limit`/`offset`, `{ items, total }`).
- Explicit, non-silent handling of a line item's `productId` that fails to resolve to a live `Product`.
- Unit tests for the new domain function, repository methods, controller, and composition service.
- An integration test exercising a mixed-currency, multi-channel, coverage-gap scenario end-to-end.

### Out of Scope
- **Variant-level ranking (spec row C3)** — the spec explicitly separates "Top products" (C1/C2/D1, this
  issue) from "Top variants" (C3, its own feasibility note: "needs item→variant resolution"), and §6's v1
  cut lists only `C1, C2, D1` for the top-products slice. This plan aggregates at **product** granularity.
  Variant drill-down is a follow-up issue, not built here.
- **Bottom performers / zero-sales SKUs** (spec row C4) and **category roll-up** (C6) — different issues.
- **`getFailedSyncValueSummary` (#1983)** — the needs-attention widget sums native `orderSnapshot` JSONB
  totals with a coarse `mixedCurrency` boolean, predating the reporting-currency stamp. The same
  stamped/unconverted pattern applies there too, but it's a different table read (`order_records` JSONB
  path, not `order_line_items`), a different consumer (`NeedsAttentionController`), and not a dependency of
  #1988. Recommended as a **separate follow-up issue** — see § 7 Alternatives Considered.
- Any new database migration — `order_line_items` (from #1985) already carries every column this feature
  needs (`productId`, `variantId`, `quantity`, `unitPrice`, `sourceConnectionId`, `placedAt`).
- A materialized view — ADR-039 already rejected one at this persona's volume (10–100 orders/day); the
  same reasoning applies to a product-ranked read.

### Constraints
- **Base branch**: `order_records.reportingCurrency`/FX columns and the entire `order_line_items` table
  exist only on `1985-order-analytics-read-model` (this worktree) and its dependent branch
  `1987-sales-channel-aggregates` (PR #2151, DRAFT) — **not yet on `main`**. #1988's implementation branch
  must be based on `origin/1987-sales-channel-aggregates`, exactly as #1987 branched off #1985, so the
  `getDailyOrderAggregates`/`pickCurrency`/`SalesAnalyticsController` scaffolding it extends actually
  exists. This plan assumes that base.
- Per this session's instruction, **no git branch/commit/push/PR is created for this planning pass** — the
  plan document is the only output right now.
- Must not add a new `libs/core` cross-context edge for the coverage-gap flag (orders → listings does not
  exist today; only listings → orders does). The flag is computed in apps/api, composing two existing
  `I*Service` reads — see § 3.

---

## 3. Architecture Mapping

**Target Layer**: CORE (`libs/core/src/orders`) for the ranking + aggregation; Interface
(`apps/api/src/analytics`) for the endpoint and the cross-context enrichment composition.

**Capabilities Involved**: none new. Reuses:
- `IOrderRecordService` (orders context) — new method `getTopProducts`.
- `OrderLineItemRepositoryPort` (orders context, intra-context) — two new methods.
- `IProductsService.getProductsByIds` (products context) — already exists, used from apps/api exactly as
  the cross-context contract intends (`I*Service`, not a repository port).
- `IPublishedVariantsService.getPublishedVariantIds` (listings context) — already exists, same story.
- `IIntegrationsService.listCapabilityAdapters` — to enumerate listing-capable connections for the coverage
  check (same primitive `CoverageGapReadService` uses).

**Existing Services Reused**: `SalesAnalyticsController` / `SalesAnalyticsQueryDto` /
`SalesAnalyticsResponseDto` / `order-sales-aggregation.ts` / `applySalesAnalyticsScope` are the direct
structural templates. `NeedsAttentionService` (`apps/api/src/analytics/application/services/needs-attention.service.ts`)
is the template for **composing across contexts in apps/api** with graceful per-section degradation.

**New Components Required**:
- `libs/core/src/orders/domain/types/top-products.types.ts` — `TopProductFilters`, `TopProductSortBy`,
  `ProductRevenueUnitsRow`, `ProductChannelBreakdownRow`, `TopProductView`, `TopProductsResult`.
- `libs/core/src/orders/domain/top-products-aggregation.ts` — pure function `buildTopProducts(...)`.
- Two new methods on `OrderLineItemRepositoryPort` + `OrderLineItemRepository`.
- One new method on `IOrderRecordService` + `OrderRecordService`.
- `apps/api/src/analytics/http/top-products.controller.ts`.
- `apps/api/src/analytics/http/dto/top-products-query.dto.ts`,
  `apps/api/src/analytics/http/dto/top-products-response.dto.ts`.
- `apps/api/src/analytics/application/services/top-products.service.ts` (+ its `interface.ts`) — the
  cross-context composition service.

**Core vs Integration/Composition Justification**: the ranking + FX-correctness math is pure orders-context
domain logic (same reasoning as #1987) and belongs in `libs/core/src/orders`. Enriching a ranked row with a
product's display name and its cross-connection listing coverage is **not** an orders-domain concern — it's
presentation composition across two unrelated contexts, which is exactly the role `apps/api` already plays
for `NeedsAttentionService`. Doing it there avoids adding a new `orders → listings` edge to the documented
cross-context dependency graph (only `listings → orders` exists today; adding the reverse would create a
second orders↔listings cycle with no interface-only justification, unlike the accepted orders↔customers /
orders↔invoicing cycles which exist for identity/document reasons intrinsic to *placing* an order).

---

## 4. External / Domain Research

### Internal Patterns (from codebase research)

**The FX-correctness idiom to replicate** (`order-record.repository.ts`, PR #2151):

```ts
const isStamped = 'rec."reportingCurrency" IS NOT NULL';
const isUnconverted = 'rec."reportingCurrency" IS NULL';
// ...
.addSelect(`COALESCE(SUM(rec."reportingTotalAmount") FILTER (WHERE ${stampedAndNotCancelled}), 0)`, 'revenue')
.addSelect(`COUNT(*) FILTER (WHERE ${unconvertedAndNotCancelled})`, 'unconverted_count')
.addSelect(`COALESCE(SUM(rec."totalAmount") FILTER (WHERE ${unconvertedAndNotCancelled}), 0)`, 'unconverted_value')
.addSelect(`(array_agg(rec."reportingCurrency") FILTER (WHERE ${isStamped}))[1]`, 'reporting_currency')
```

and the domain-layer `pickCurrency` helper that re-derives the same label when merging rows from separate
queries.

**`OrderLineItemRepositoryPort.getUnitsSoldByConnection`** (already shipped on `1987-sales-channel-aggregates`)
is the direct precedent for querying `order_line_items` joined back to `order_records` for scope
(`recordStatus = 'ready' AND cancelledAt IS NULL`, date range on `li.placedAt`, optional
`sourceConnectionId`). Its doc comment explicitly names itself the extension point for #1988's aggregates.

**Deriving a per-line reporting-currency amount without a new join or new columns**: `order_line_items` has
no FX columns of its own (by design — ADR-039 keeps the child table a plain denormalization, and ADR-040
stamps at the *order* level only). But because one order has exactly one exchange rate for its one
currency pair on its one order-day, `reportingTotalAmount / totalAmount` (both already on `order_records`,
already joined for scope) **is** that rate, per ADR-040's own invariant (`reportingTotalAmount = totalAmount
× rate`, never a division at write time — so recovering the multiplier by division at *read* time is safe
and introduces no new derivation semantics, just numeric(12,2)-precision rounding noise acceptable for a
ranking aggregate, per ADR-040's explicit "analytics-only" framing). Applying that multiplier to a line's own
native `unitPrice × quantity` gives its reporting-currency contribution — correct regardless of whether
`order_records.totalAmount` includes shipping/discounts beyond the sum of lines, because the multiplier is a
currency-conversion factor, not a proration of a whole-order total across lines.

**Product catalog enrichment**: `IProductsService.getProductsByIds(ids): Promise<Product[]>` — documented
contract: "missing ids are silently dropped (no null fillers)". This is the exact hazard #1988's own AC
("line items that cannot be resolved to a catalogue product are handled explicitly rather than dropped
silently") warns about, so the composition service must diff the requested id set against the returned set
and surface the gap rather than let `.map()` quietly shrink the row count.

**Coverage-gap flag**: `IPublishedVariantsService.getPublishedVariantIds(connectionId, variantIds):
Promise<string[]>` already unions offer-mapping and shop-product-mapping per connection (#1837) and is the
exact primitive `CoverageGapReadService` (#1983, `libs/core/src/listings/application/services/coverage-gap-read.service.ts`)
uses to answer "is this variant listed on this connection" in bulk. #1988 reuses it directly rather than
duplicating listings-context logic.

**Pagination convention**: no shared generic DTO exists; the established shape across the codebase (e.g.
`apps/api/src/listings/http/dto/list-offer-mappings-query.dto.ts`) is `limit` (default 20, min 1, max 100)
+ `offset` (default 0, min 0) on the request, `{ items, total }` on the domain/response — this plan follows
that convention rather than `page`/`pageSize` (the less common of the two existing variants).

**Unresolvable line items at ingestion time**: `OrderIngestionService` already refuses to persist an order
as `recordStatus = 'ready'` (the only status under which `order_line_items` rows are ever written — see
`getUnitsSoldByConnection`'s `WHERE rec."recordStatus" = 'ready'`) if any item fails to resolve to an
internal id; it routes to `'awaiting_mapping'`/`'source_deleted'` instead. So a `productId` already
recorded in `order_line_items` should always still resolve via `getProductsByIds`, because master-side
deletion only ever flips `product_variants.isStale = true` (never a hard delete). The residual defensive
case this plan still guards — per the issue's own explicit AC — is a genuinely missing id (data
inconsistency, future hard-delete path, or the seed data used in this repo's tests), surfaced as an
`unresolvedProductCount` alongside a still-rendered row for the id (labeled from `order_line_items` alone),
mirroring the `unconvertedCount`/`unconvertedValue` disclosure precedent rather than dropping the row.

---

## 5. Questions & Assumptions

### Open Questions
- Should the coverage-gap flag (D2-shaped) consider *every* listing-capable connection in the deployment,
  or only connections that already sell *something* in the requested date range? This plan defaults to
  **every active listing-capable connection** (via `IIntegrationsService.listCapabilityAdapters`), because
  "not listed on channel B" is most actionable when B is a channel the operator actually uses, and limiting
  to already-selling channels would hide the case of "never listed there at all" — the exact gap D2 exists
  to surface. Flag for product-team confirmation once implemented.
- Should `sortBy=revenue` rank strictly by the stamped/comparable revenue sum, silently pushing an
  all-unconverted-currency product to the bottom of a revenue-sorted list? This plan says **yes** — same
  rule as the sales-aggregates headline — and surfaces the product's `unconvertedRevenue` alongside so the
  operator isn't misled into thinking it sold nothing.

### Assumptions
- Per-request page size is small enough (≤100 per the `limit` cap) that the coverage-gap enrichment's cost
  — bounded by `page size × listing-capable-connection count`, not catalogue size — is acceptable inline
  rather than pre-computed. This matches ADR-039's target persona (10–100 orders/day, correspondingly small
  distinct-connection counts).
- The `reportingTotalAmount / totalAmount` per-order multiplier is an acceptable substitute for looking up
  the stored `exchange_rates` row directly (avoiding a `currency`-context join from `orders`) — see the
  derivation in § 4. This is analytics-only math (ADR-040's own framing), not a fiscal computation.
- Product-level (not variant-level) grouping is correct for v1 per the spec's own C1/C2/D1-vs-C3 split (§
  4's Out of Scope).

### Documentation Gaps
- None identified — #1976's spec (`docs/specs/product-spec-1976-analytics.md`) and ADR-039/ADR-040 fully
  cover the correctness contract this plan implements against.

---

## 6. Proposed Implementation Plan

### Phase 1: Core domain — ranking + FX-correct aggregation

**Goal**: `IOrderRecordService.getTopProducts(filters)` returns a fully FX-correct, paginated, product-ranked
result with inline per-channel breakdown — no product names, no coverage flags yet (those are apps/api's
job in Phase 3).

**Steps**:

1. **Define domain types**
   - **File**: `libs/core/src/orders/domain/types/top-products.types.ts`
   - **Action**: Add
     ```ts
     export const TopProductSortByValues = ['revenue', 'units'] as const;
     export type TopProductSortBy = (typeof TopProductSortByValues)[number];

     export interface TopProductFilters extends SalesAnalyticsFilters {
       sortBy: TopProductSortBy;
       limit: number;
       offset: number;
     }

     export interface ProductRankingRow {
       productId: string;
       units: number;
       revenue: number;            // stamped-only, reporting currency
       unconvertedRevenue: number; // native-currency sum of unstamped orders' lines
       unconvertedOrderCount: number;
       currency: string | null;    // pickCurrency-style label
     }

     export interface ProductChannelBreakdownRow {
       productId: string;
       sourceConnectionId: string;
       units: number;
       revenue: number;
       unconvertedRevenue: number;
       currency: string | null;
     }

     export interface TopProductView {
       productId: string;
       units: number;
       revenue: number;
       unconvertedRevenue: number;
       unconvertedOrderCount: number;
       currency: string | null;
       channels: ProductChannelBreakdownRow[];
     }

     export interface TopProductsResult {
       items: TopProductView[];
       total: number; // distinct products matching scope, before pagination
     }
     ```
   - **Acceptance**: Types compile; `SalesAnalyticsFilters` import reused, not redefined.
   - **Dependencies**: none.

2. **Extend `OrderLineItemRepositoryPort`**
   - **File**: `libs/core/src/orders/domain/ports/order-line-item-repository.port.ts`
   - **Action**: Add
     ```ts
     getTopProductRanking(filters: TopProductFilters): Promise<{ rows: ProductRankingRow[]; total: number }>;
     getProductChannelBreakdown(
       productIds: string[],
       filters: SalesAnalyticsFilters,
     ): Promise<ProductChannelBreakdownRow[]>;
     ```
   - **Acceptance**: Interface only, no framework imports (domain layer rule).
   - **Dependencies**: Step 1.

3. **Implement `getTopProductRanking`**
   - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/order-line-item.repository.ts`
   - **Action**: Two-query-builder implementation:
     - **Ranking query** (page of product ids, ordered by the requested metric): join `li` → `rec` on
       `rec."internalOrderId" = li."orderRecordId"`, scope via the same predicates as
       `getUnitsSoldByConnection` (`recordStatus='ready'`, `cancelledAt IS NULL`, date range on
       `li."placedAt"`, optional `sourceConnectionId`), group by `li."productId"`, and select:
       ```sql
       COALESCE(SUM(li."quantity"), 0) AS units,
       COALESCE(SUM(li."unitPrice" * li."quantity" * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0)))
         FILTER (WHERE rec."reportingCurrency" IS NOT NULL), 0) AS revenue,
       COALESCE(SUM(li."unitPrice" * li."quantity")
         FILTER (WHERE rec."reportingCurrency" IS NULL), 0) AS unconverted_revenue,
       COUNT(DISTINCT li."orderRecordId") FILTER (WHERE rec."reportingCurrency" IS NULL) AS unconverted_order_count,
       (array_agg(rec."reportingCurrency") FILTER (WHERE rec."reportingCurrency" IS NOT NULL))[1] AS reporting_currency
       ```
       `ORDER BY` the requested metric (`revenue` or `units`) `DESC`, `LIMIT :limit OFFSET :offset`.
     - **Total count**: a second `COUNT(DISTINCT li."productId")` over the same scoped, ungrouped query (no
       `ORDER BY`/`LIMIT`) — run in parallel via `Promise.all` inside the method, mirroring how
       `getDailyOrderAggregates`'s scope-building is factored into a shared private helper.
     - Extract the shared scope predicates into a private `applyTopProductsScope(qb, filters)` — do **not**
       duplicate `applySalesAnalyticsScope`'s literal string (it's on a different query root, `li` not
       `rec`), but keep the predicate list byte-for-byte aligned with it (same `recordStatus`/`cancelledAt`
       semantics) so the two endpoints can never silently diverge in what counts as an "order in scope".
   - **Acceptance**: `pnpm --filter @openlinker/core test order-line-item.repository` covers both the
     ranked-page shape and the total count; a spec asserts `sortBy='units'` never references
     `reportingCurrency` in its `ORDER BY` (units have no currency).
   - **Dependencies**: Step 2.

4. **Implement `getProductChannelBreakdown`**
   - **File**: same as Step 3.
   - **Action**: Same join/scope, additionally filtered to `li."productId" IN (:...productIds)`, grouped by
     `(li."productId", li."sourceConnectionId")`, same SELECT list as Step 3 minus the total count. Called
     only with the current page's product ids (bounded cost — see § 4).
   - **Acceptance**: Given a product with lines on two connections, returns two rows with correct
     per-connection stamped/unconverted split.
   - **Dependencies**: Step 2.

5. **Pure domain aggregation function**
   - **File**: `libs/core/src/orders/domain/top-products-aggregation.ts`
   - **Action**: `buildTopProducts({ ranking, total, breakdown }): TopProductsResult` — joins each ranking
     row to its breakdown rows by `productId` (a plain `Map`, no I/O), in ranking order. Reuses the same
     `pickCurrency`-style single-value-per-row derivation already computed at the SQL layer (no re-picking
     needed here since each row already carries its own `currency`).
   - **Acceptance**: Unit-testable with plain arrays — no mocks, no DB. `libs/core/src/orders/domain/top-products-aggregation.spec.ts`
     covers: a product with no breakdown rows (shouldn't happen given the join, but defend anyway → empty
     `channels: []`), a product present in ranking but whose breakdown returns rows for a connection with
     zero revenue (still included), ordering preserved from the ranking input.
   - **Dependencies**: Steps 1, 3, 4.

6. **Wire `IOrderRecordService.getTopProducts`**
   - **Files**:
     `libs/core/src/orders/application/interfaces/order-record.service.interface.ts` (add method signature
     `getTopProducts(filters: TopProductFilters): Promise<TopProductsResult>`);
     `libs/core/src/orders/application/services/order-record.service.ts` (implement — `Promise.all`
     `lineItemRepository.getTopProductRanking(filters)`, then `lineItemRepository.getProductChannelBreakdown`
     with the returned page's product ids, then call `buildTopProducts`).
   - **Acceptance**: `order-record.service.spec.ts` gains a `describe('getTopProducts', ...)` block mocking
     both repository calls; asserts the two-query sequencing (breakdown query only receives the *page's*
     ids, never the full scoped set).
   - **Dependencies**: Steps 3–5.

### Phase 2: Interface layer — endpoint

**Goal**: `GET /analytics/top-products?from&to&sortBy&sourceConnectionId&limit&offset` returns a
paginated, ranked, per-channel-broken-down JSON payload — still without name/SKU/coverage enrichment.

**Steps**:

1. **Query DTO**
   - **File**: `apps/api/src/analytics/http/dto/top-products-query.dto.ts`
   - **Action**:
     ```ts
     export class TopProductsQueryDto {
       @IsNotEmpty() @IsDateString() from!: string;
       @IsNotEmpty() @IsDateString() to!: string;
       @IsOptional() @IsUUID() sourceConnectionId?: string;
       @IsOptional() @IsIn(TopProductSortByValues) sortBy?: TopProductSortBy = 'revenue';
       @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
       @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number = 0;
     }
     ```
   - **Acceptance**: mirrors `SalesAnalyticsQueryDto`'s `from`/`to`/`sourceConnectionId` verbatim; adds the
     three new fields following `list-offer-mappings-query.dto.ts`'s `limit`/`offset` convention.
   - **Dependencies**: Phase 1 Step 1 (for `TopProductSortByValues`).

2. **Response DTOs**
   - **File**: `apps/api/src/analytics/http/dto/top-products-response.dto.ts`
   - **Action**: `ProductChannelBreakdownDto`, `TopProductRowDto` (adds `name: string | null`, `sku: string
     | null`, `missingFromConnectionIds: string[]` on top of the core `TopProductView` fields — populated in
     Phase 3, `null`/`[]` at this stage), `TopProductsResponseDto { items, total, unresolvedProductCount }`.
     Each with a static `fromDomain`-style factory, matching `SalesAnalyticsResponseDto`'s pattern.
   - **Acceptance**: DTO classes have no business logic beyond field mapping (matches the reviewed
     `sales-analytics-response.dto.ts` precedent).
   - **Dependencies**: Step 1.

3. **Controller**
   - **File**: `apps/api/src/analytics/http/top-products.controller.ts`
   - **Action**: `GET /analytics/top-products`, `@UseGuards(JwtAuthGuard)`, validates `to > from` (400
     otherwise, same as `SalesAnalyticsController`), delegates to the Phase 3 composition service (not
     directly to `IOrderRecordService` — the controller needs the enriched result).
   - **Acceptance**: registered in `apps/api/src/analytics/analytics.module.ts` alongside
     `SalesAnalyticsController` / `NeedsAttentionController`.
   - **Dependencies**: Phase 3 (composition service exists), Step 2.

### Phase 3: Composition — product enrichment + coverage-gap flag

**Goal**: apps/api-layer service that turns a core `TopProductsResult` into the fully enriched response:
product names, explicit unresolved-id accounting, and the "not listed on channel X" flag.

**Steps**:

1. **Service interface + implementation**
   - **Files**: `apps/api/src/analytics/application/services/top-products.service.interface.ts`,
     `apps/api/src/analytics/application/services/top-products.service.ts`
   - **Action**:
     ```ts
     export interface ITopProductsService {
       getTopProducts(filters: TopProductsQuery): Promise<TopProductsResponseDto>;
     }
     ```
     Implementation:
     1. `const { items, total } = await this.orderRecordService.getTopProducts(coreFilters);`
     2. `const products = await this.productsService.getProductsByIds(items.map(i => i.productId));` — build
        a `Map<productId, Product>`; any `item.productId` missing from the map is **still rendered** (name:
        `null`, a `nameUnresolved: true` marker) and counted into `unresolvedProductCount` — never dropped
        from `items`.
     3. Coverage-gap flag: resolve listing-capable connections via
        `integrationsService.listCapabilityAdapters({ capability: 'OfferManager', lazy: true,
        includeAllStatuses: false })` unioned with `'ProductPublisher'` (mirrors `CoverageGapReadService`'s
        two-kind union). For the page's products, resolve their variant ids
        (`productsService.getProductVariants` per product — page-bounded, ≤100 calls) and, per
        listing-capable connection, call `publishedVariantsService.getPublishedVariantIds(connectionId,
        allPageVariantIds)` **once per connection** (not once per product) to keep the fan-out at
        `O(connections)`, not `O(products × connections)`. For each product, `missingFromConnectionIds` =
        connections where **none** of its variants appear in that connection's published set, **excluding**
        connections where the product also has zero *sales* in the requested channel breakdown (a product
        genuinely never sold anywhere shouldn't be in this ranked list to begin with, so this exclusion is
        naturally satisfied by construction — no extra filter needed).
     4. Wrap step 3 in a `try/catch` that logs and falls back to `missingFromConnectionIds: []` for every
        row on failure — **never** fail the whole endpoint because the coverage read (a different context)
        had a transient error, mirroring `NeedsAttentionService`'s `settleSection` degrade-to-empty pattern.
     5. Map to `TopProductsResponseDto`.
   - **Acceptance**: unit-testable with mocked `IOrderRecordService`/`IProductsService`/
     `IPublishedVariantsService`/`IIntegrationsService`; a spec explicitly asserts the coverage-check call
     count is `O(pageConnections)`, not `O(pageProducts × pageConnections)`.
   - **Dependencies**: Phase 1 Step 6, Phase 2 Steps 1–2.

2. **Wire into `analytics.module.ts`**
   - **File**: `apps/api/src/analytics/analytics.module.ts`
   - **Action**: add `TopProductsController` to `controllers`, `TopProductsService` (bound to
     `ITopProductsService`/its Symbol token, following the existing token convention in this module) to
     `providers`, importing `ProductsModule` and `ListingsModule` (for the two additional cross-context
     services) alongside the module's existing `OrdersModule`/`IntegrationsModule` imports.
   - **Acceptance**: `pnpm --filter @openlinker/api type-check` passes; module boots in
     `apps/api/test/integration/app-boot.int-spec.ts`.
   - **Dependencies**: Step 1, Phase 2 Step 3.

---

### Implementation Details

**New Components**:
- **Domain**: `top-products.types.ts`, `top-products-aggregation.ts` (pure function, no entity/exception
  changes needed).
- **Application**: `OrderRecordService.getTopProducts` (core); `TopProductsService` +
  `ITopProductsService` (apps/api composition).
- **Infrastructure**: two new `OrderLineItemRepository` methods (no new ORM entity, no migration).
- **Interface**: `TopProductsController`, `TopProductsQueryDto`, `TopProductsResponseDto`,
  `TopProductRowDto`, `ProductChannelBreakdownDto`.

**Configuration Changes**: none.

**Database Migrations**: none — `order_line_items` already carries every column required.

**Events**: none emitted or consumed — this is a pure read.

**Error Handling**: `to <= from` → 400 (matches `SalesAnalyticsController`). A transient failure in the
coverage-gap enrichment (Phase 3 Step 1.4) degrades to an empty flag per row rather than a 500. No new
domain exceptions needed — no write path exists here.

---

## 7. Alternatives Considered

### Alternative 1: Compute the coverage-gap flag inside `libs/core/src/orders`
- **Description**: Add an `orders → listings` dependency so `OrderRecordService.getTopProducts` itself
  calls `IPublishedVariantsService` and returns the flag as part of the core `TopProductsResult`.
- **Why Rejected**: Creates a new cross-context edge not in the documented dependency graph (today only
  `listings → orders` exists). The existing precedent for "compose two contexts for one read-model
  response" is apps/api (`NeedsAttentionService`), not a new core-to-core coupling. Keeping it in apps/api
  also keeps the core aggregation function (`buildTopProducts`) trivially unit-testable with plain arrays.
- **Trade-offs**: apps/api's composition service is slightly more code than a single core method, but it
  matches an established, already-reviewed pattern instead of introducing a new architectural edge for one
  feature.

### Alternative 2: Prorate `order_records.totalAmount` across lines instead of applying the order's implicit FX multiplier
- **Description**: Compute each line's reporting-currency share as
  `(li.unitPrice * li.quantity / sumOfOrderLines) * rec.reportingTotalAmount`.
- **Why Rejected**: Requires a second aggregate (sum of the order's own lines) purely to recover a ratio
  that's already directly available as `reportingTotalAmount / totalAmount` (the order's own FX rate, per
  ADR-040's own multiplicative definition). The proration approach also silently absorbs shipping/discount
  differences into each line's per-unit figure, which is a worse approximation of "how much this product
  actually earned" than applying the currency-conversion factor to the line's own native amount.
- **Trade-offs**: none identified — the chosen approach is strictly simpler and more correct.

### Alternative 3: Apply the same FX-correctness fix to `getFailedSyncValueSummary` (#1983) in this same PR
- **Description**: Since the user's own brief raised this, convert the needs-attention widget's
  `mixedCurrency` boolean + native-JSONB sum to the same `SUM(reportingTotalAmount)` +
  `unconvertedCount`/`unconvertedValue` + currency-label pattern.
- **Why Rejected (for this PR)**: Different table read path (JSONB `orderSnapshot` extraction, not
  `order_records`/`order_line_items` columns), different consumer (`NeedsAttentionController`), and no
  dependency relationship with #1988 — #1988 does not call or extend `getFailedSyncValueSummary`. Bundling
  it would widen this PR's blast radius for a fix that stands on its own. **Recommendation**: file it as a
  separate follow-up issue referencing this plan's § 4 pattern description, to be picked up independently.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Domain layer (`top-products.types.ts`, `top-products-aggregation.ts`) has no framework imports.
- ✅ `OrderLineItemRepositoryPort` extended, not bypassed — `apps/api` never imports it directly (enforced
  by `scripts/check-cross-context-imports.mjs` / the port-doc's stated rule).
- ✅ No new `libs/core` cross-context edge added (see § 7 Alternative 1).
- ✅ Services implement interfaces (`IOrderRecordService`, `ITopProductsService`) per
  `docs/engineering-standards.md § Service Interface Implementation`.

### Naming Conventions
- ✅ `*.types.ts`, `*.dto.ts`, `*.controller.ts`, `*.service.ts` / `*.service.interface.ts` all follow
  `docs/engineering-standards.md § Naming Conventions`.
- ✅ `as const` + union type for `TopProductSortByValues`, not an enum.

### Existing Patterns
- ✅ Mirrors `SalesAnalyticsController`/`SalesAnalyticsQueryDto`/`SalesAnalyticsResponseDto` structurally.
- ✅ Mirrors `getDailyOrderAggregates`'s stamped/unconverted FILTER idiom exactly.
- ✅ Mirrors `NeedsAttentionService`'s graceful cross-context degradation.

### Risks
- **Coverage-gap fan-out cost**: bounded by page size × listing-capable connection count (both small at
  ADR-039's target scale), not catalogue size — mitigated by resolving variant ids once per page and
  calling `getPublishedVariantIds` once per connection (Phase 3 Step 1.3), not once per product.
- **Rounding noise from the `reportingTotalAmount / totalAmount` division**: both are `numeric(12,2)`, so
  recovering the rate by division reintroduces sub-cent rounding vs. the stored rate. Acceptable for a
  ranking aggregate (ADR-040 explicitly frames the stamp as analytics-only); would **not** be acceptable
  for a fiscal document, which is exactly the boundary ADR-040 itself draws.
- **A product with zero rows in the current page's breakdown query** (defensive case in Step 5, § 6 Phase
  1): shouldn't be reachable given the ranking/breakdown queries share scope, but the aggregation function
  defends against it (`channels: []`) rather than throwing, so a scope-predicate drift between the two
  queries degrades gracefully instead of 500ing the endpoint.

### Edge Cases
- **All-unconverted product** (every order for it is FX-unstamped): ranks at `revenue = 0` under
  `sortBy=revenue` but its `unconvertedRevenue` is still visible — never silently invisible, per #1988's own
  "currencies never silently summed" AC.
- **Product referenced by `order_line_items` but missing from `getProductsByIds`**: rendered with `name:
  null`, counted in `unresolvedProductCount` — see § 4.
- **`sortBy=units` with an all-cancelled-orders product**: excluded entirely by the shared scope predicate
  (`cancelledAt IS NULL`), consistent with the sales-aggregates precedent.

### Backward Compatibility
- ✅ Purely additive — new endpoint, new types, two new repository methods, one new service method. No
  existing endpoint or type changes.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/core/src/orders/domain/top-products-aggregation.spec.ts` — pure function, plain-array fixtures; no
  mocks needed.
- `libs/core/src/orders/infrastructure/persistence/repositories/order-line-item.repository.spec.ts` — add
  cases for `getTopProductRanking` (sort by each metric, limit/offset, unconverted split) and
  `getProductChannelBreakdown`.
- `libs/core/src/orders/application/services/order-record.service.spec.ts` — `getTopProducts` composition
  (mocked repo calls), asserting breakdown query receives only the page's ids.
- `apps/api/src/analytics/http/top-products.controller.spec.ts` — `to <= from` → 400; happy path delegates
  to the composition service.
- `apps/api/src/analytics/application/services/top-products.service.spec.ts` — product-enrichment gap
  handling (`unresolvedProductCount`), coverage-flag `O(connections)` call-count assertion, and the
  try/catch degrade-to-empty-flag path on a simulated `IPublishedVariantsService` failure.

### Integration Tests
- **File**: `apps/api/test/integration/analytics/top-products.int-spec.ts` (mirrors whatever
  `sales-analytics.int-spec.ts` exists on `1987-sales-channel-aggregates`, if any — otherwise the first of
  its kind for this controller family).
- **Scenario**: seed two connections (one marketplace, one shop), orders across both, one order left
  FX-unstamped (simulating an in-flight/deferred stamp), one product listed on both connections, one
  product listed on only one. Assert: `GET /analytics/top-products?sortBy=revenue` ranks correctly, the
  unstamped order's revenue never leaks into `revenue` but appears in `unconvertedRevenue`, and the
  single-channel product's row carries the other connection's id in `missingFromConnectionIds`.

### Mocking Strategy
- Unit tests mock all ports/services (`OrderLineItemRepositoryPort`, `IProductsService`,
  `IPublishedVariantsService`, `IIntegrationsService`).
- Integration test uses the real Postgres Testcontainer harness (`getTestHarness()`), no mocked adapters
  beyond what's already faked at the capability-registry level for connection setup.

### Acceptance Criteria
- [ ] `GET /analytics/top-products` ranks by `revenue` (default) or `units`, date-range scoped, optional
      `sourceConnectionId` filter.
- [ ] Every row carries an inline per-channel breakdown (units + revenue) in the same response — no
      follow-up call needed per product.
- [ ] Revenue ranking and totals never sum across currencies — comparable revenue derives only from
      FX-stamped orders; unconverted orders' native-currency value and count are surfaced separately per
      product, matching the sales-aggregates precedent.
- [ ] A product's `missingFromConnectionIds` flags a listing-capable connection where none of its variants
      are published, when the product has sales on at least one other connection.
- [ ] A line item whose `productId` fails to resolve to a live `Product` is still represented in the
      response (not dropped), and counted in `unresolvedProductCount`.
- [ ] Pagination (`limit`/`offset`) works and `total` reflects the full scoped distinct-product count, not
      just the returned page.
- [ ] All new unit tests pass; new integration test passes against a real Postgres Testcontainer.
- [ ] `pnpm lint` and `pnpm type-check` pass with zero errors.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (domain aggregation pure; infra reads via repository port; apps/api
      composes cross-context reads).
- [x] Respects CORE vs Integration/Interface boundaries — no new core-to-core edge introduced.
- [x] Uses existing patterns — mirrors #2151's FX-correctness idiom, `NeedsAttentionService`'s composition
      pattern, and `list-offer-mappings-query.dto.ts`'s pagination shape. No new abstractions invented.
- [x] Idempotency — pure read, not applicable.
- [x] Event-driven patterns — not applicable (no write, no event).
- [x] Rate limits & retries — not applicable (internal read, standard `JwtAuthGuard`).
- [x] Error handling comprehensive — 400 on invalid range, graceful degradation on coverage-flag failure,
      explicit (not silent) handling of unresolved product ids.
- [x] Testing strategy complete — unit + integration, mirroring the #1987 precedent.
- [x] Naming conventions followed.
- [x] File structure matches standards.
- [x] Plan is execution-ready.
- [x] Plan is saved as a markdown file.
- [x] No ADR required — applies the existing ADR-040 pattern to a new dimension; no new architectural
      decision, no new cross-context edge.

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md) — § Orders (order analytics read model, #1985/#1987),
  § Currency (ADR-040 five-state FX table).
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- [ADR-039: Order analytics read model persistence strategy](../architecture/adrs/039-order-analytics-read-model-persistence-strategy.md)
- [ADR-040: Order-time FX stamping against a system reporting currency](../architecture/adrs/040-order-time-fx-stamping-against-a-system-reporting-currency.md)
- [`docs/specs/product-spec-1976-analytics.md`](../specs/product-spec-1976-analytics.md) — §4 rows C1–C3/D1,
  §6 v1 cut, §7 story S3.
- Reference implementation to copy the pattern from: PR #2151 (branch `1987-sales-channel-aggregates`),
  `order-record.repository.ts` (`getDailyOrderAggregates`, `getMedianOrderValue`),
  `order-sales-aggregation.ts` (`pickCurrency`), `order-sales-analytics.types.ts`.
