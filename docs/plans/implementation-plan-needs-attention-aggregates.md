# Implementation Plan: Backend "Needs Attention" Aggregates (#1983)

**Date**: 2026-08-11
**Status**: Draft
**Estimated Effort**: 3–5 days

---

## 1. Task Summary

**Objective**: Implement three backend read aggregates that back the `/analytics` "needs attention" section (#1989, frontend):

1. **Coverage gaps** — variants listed on one destination connection but not on another.
2. **Stock at risk** — variants whose master stock minus the connection's `stockSafetyBuffer` (#1844) is at or below zero.
3. **Value stuck in failed syncs** — count + summed order value of orders that failed to reach a destination.

**Context**: `/analytics` (#1976) is a new reporting page. The "needs attention" section is its actionable closing block — every row links into an existing OL flow (publish, inventory detail, sync failures). #1983 is the backend half; #1989 is the frontend consumer.

A newer product-design mockup for `/analytics` (reviewed against this issue before writing this plan) attaches two ideas to these aggregates that are **explicitly out of scope for this plan** — see § 2:

- Ranking coverage gaps by units sold on the source channel ("ranked by units sold ... last 30 days").
- A sales-velocity ("fast movers") refinement of stock-at-risk ("4 fast movers ... will hit the safety buffer in ~3 days").

Both require querying order line items as rows, and today `order_records.orderSnapshot.items` is JSONB, not a queryable table — the same blocker #1983's own "Out of scope" section already names for coverage-gap ranking. Neither concept has a defined algorithm (window, threshold, data source) anywhere in the spec or mockup. This plan implements the **simple, presence/threshold-only v1** that #1983's acceptance criteria actually describe, and calls out the velocity-based follow-up explicitly so #1989's copy doesn't promise what this plan doesn't deliver (see § 2 and § 7).

**Classification**: CORE (application services in `listings`, `inventory`, `orders`) + Interface (a new `apps/api` composition service + controller).

---

## 2. Scope & Non-Goals

### In Scope

- `CoverageGapReadService` (listings context): for each variant with at least one listing, report which listing-capable connections it is missing from.
- `StockAtRiskReadService` (inventory context): for each connection with a configured stock safety buffer, report variants whose `masterStock - buffer <= 0`.
- A failed-sync-value read on the existing `orders` context: count + summed order value of orders with at least one `syncStatus` entry at `status: 'failed'` (excluding `awaiting_mapping` / `source_deleted` records, mirroring the existing health-bucket precedent).
- `NeedsAttentionService` (apps/api layer): composes the three reads into one response DTO.
- `GET /analytics/needs-attention` endpoint.
- Stale-variant exclusion (#1689) on coverage gaps and stock-at-risk.
- Bounded/paged output on every aggregate (a hard cap, not full-catalogue enumeration).

### Out of Scope

- **Sales-weighted ranking of coverage gaps** (units sold on the source channel). Named explicitly in #1983 as a follow-up once order line items are queryable.
- **Velocity-based "fast movers" refinement of stock-at-risk** (a variant "won't survive to the next sync" given its sales rate). This concept appears only in the `/analytics` spec (row E1) and the newer mockup, with no defined window, threshold, or data source anywhere. It requires the same missing substrate (queryable order line items) as the coverage-gap ranking above. **Decision from this planning pass: leave stock-at-risk as the simple threshold check in v1; raise the velocity refinement as a separate follow-up issue once the order-line-items substrate exists and someone defines the algorithm.**
- Performing the actions inline (publish, retry, etc.) — this issue only reports what needs attention (#1989 links out to existing flows).
- Estimated lost revenue from stockouts — needs stock history, which is not retained.
- The `/analytics` route shell, KPI strip, or any other `/analytics` section (#1986, #1990, etc.) — those are separate issues.

### Constraints

- Must not introduce a new bounded context; each read lives in the context that already owns its data (`listings`, `inventory`, `orders`).
- No schema/migration change required — every read is derived from existing tables (`identifier_mappings`, `inventory_items`, `connections.config`, `order_records`, `product_variants.isStale`).
- Output must be bounded — no unbounded per-catalogue payload (AC).

---

## 3. Architecture Mapping

**Target Layer**: CORE (`libs/core/src/listings`, `libs/core/src/inventory`, `libs/core/src/orders`) for the three reads; Interface/App (`apps/api/src/analytics`) for composition + HTTP.

**Capabilities Involved**:
- No new capability port. Reads are backed by existing repository ports:
  - `OfferMappingRepositoryPort` / `ShopProductMappingRepositoryPort` (listings) — mirrors the existing `PublishedVariantsService` union pattern (#1837).
  - `InventoryRepositoryPort` (inventory) via the existing `IInventoryQueryService.getAvailabilityByVariantIds` read.
  - `OrderRecordRepositoryPort` (orders) — extended with one new aggregate method, mirroring the existing `countByHealth` JSONB-filter pattern.
  - `IConnectionsService` / `IntegrationsService` (integrations) — to enumerate active, listing-capable connections (`OfferManager` or `ProductPublisher`).

**Existing Services Reused**:
- `PublishedVariantsService` pattern (listings) — the union-of-two-mapping-kinds shape is reused conceptually for coverage gaps (not called directly, since coverage gaps need the *inverse*: which capable connections a variant is **missing** from, not whether one specific connection has it).
- `readStockSafetyBuffer` / `applyStockSafetyBuffer` (`@openlinker/core/identifier-mapping`, #1844) — the exact threshold primitive stock-at-risk is defined against.
- `IInventoryQueryService.getAvailabilityByVariantIds` (inventory, #823) — variant-keyed master stock read.
- `OrderRecordRepository`'s `HAS_FAILED` / `TOTAL_EXPR` SQL-fragment precedent (`countByHealth`) — reused (not duplicated) for the failed-sync-value aggregate.
- `product_variants.isStale` (#1689) — excluded from coverage gaps and stock-at-risk, same as every other listings/inventory read that touches variants.

**New Components Required**:
- `libs/core/src/listings/application/services/coverage-gap-read.service.ts` (+ `.interface.ts`)
- `libs/core/src/listings/domain/types/coverage-gap.types.ts`
- `libs/core/src/inventory/application/services/stock-at-risk-read.service.ts` (+ `.interface.ts`)
- `libs/core/src/inventory/domain/types/stock-at-risk.types.ts`
- One new method on `OrderRecordRepositoryPort` + `IOrderRecordService`: `getFailedSyncValueSummary(filters)`
- `libs/core/src/orders/domain/types/order-record.types.ts` — add `FailedSyncValueSummary` type
- `apps/api/src/analytics/application/services/needs-attention.service.ts` (+ `.interface.ts`)
- `apps/api/src/analytics/http/needs-attention.controller.ts`
- `apps/api/src/analytics/http/dto/needs-attention-response.dto.ts`

**Core vs Integration Justification**: Everything here reads from OL's own persisted state (identifier_mappings, inventory_items, connections, order_records) — no adapter/external-API call is involved, so none of it belongs in an integration package. The three reads stay in the CORE context that already owns each table; only the cross-context *composition* (listings + inventory + orders in one response) sits at the app layer, which is the correct seam per `docs/architecture-overview.md § Cross-context dependencies in core` — composing three sibling contexts' `I*Service` interfaces from `apps/api` avoids adding a new core-to-core dependency edge that none of `listings`/`inventory`/`orders` otherwise needs.

**Reference**: [Architecture Overview - Hexagonal Architecture Structure](../architecture-overview.md#hexagonal-architecture-structure)

---

## 4. External / Domain Research

### Internal Patterns

- **Coverage gaps precedent**: `PublishedVariantsService.getPublishedVariantIds` (`libs/core/src/listings/application/services/published-variants.service.ts`) unions `OfferMappingRepositoryPort.countByConnectionAndVariants` + `ShopProductMappingRepositoryPort.countByConnectionAndVariants` to answer "is variant X published on connection Y". Coverage gaps needs the same two repositories but a different shape: "of all listing-capable connections, which ones is variant X missing from".
- **Stock-at-risk threshold precedent**: `readStockSafetyBuffer` / `applyStockSafetyBuffer` (`libs/core/src/identifier-mapping/domain/types/stock-safety-buffer.types.ts`) are pure, already-shipped helpers. `IInventoryQueryService.getAvailabilityByVariantIds` (`libs/core/src/inventory/application/services/inventory-query.service.ts`) already returns variant-keyed master stock.
- **Failed-sync-value precedent**: `OrderRecordRepository.countByHealth` (`libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts:174`) already computes a `needsAttention` bucket via the SQL fragment `rec."syncStatus" @> '[{"status":"failed"}]'::jsonb` combined with the `NOT_MAPPING_OR_DELETED` guard, and a separate `TOTAL_EXPR` fragment already extracts `orderSnapshot#>>'{totals,total}'` as a guarded numeric for sorting. The new aggregate reuses both fragments (via a `SUM(...) FILTER (WHERE ...)` + `MIN(createdAt) FILTER (WHERE ...)`) instead of duplicating the JSONB predicate.
- **Stale-variant exclusion precedent**: `OfferMappingRepositoryPort.findStaleMappedVariants` and the stale-offer-pause flow (#1689) already treat `product_variants.isStale` as the authoritative "don't touch this variant" signal for listings/inventory reads.
- **Connection capability enumeration precedent**: `IntegrationsService.listCapabilityAdapters({ lazy: true })` (used by the #1904 rival-claimant guard and elsewhere) already resolves active, capability-matching connections without constructing an adapter — the right shape for "give me every connection that supports `OfferManager` or `ProductPublisher`".

### Documentation Gaps

None blocking this plan — the spec doc (`docs/specs/product-spec-1976-analytics.md`, row E1/D2) and the mockup both name the velocity/ranking refinements without an algorithm; this plan treats that absence as a decision to defer rather than a gap to fill in (see § 2).

---

## 5. Questions & Assumptions

### Open Questions

- Should "listing-capable connection" for coverage-gap purposes mean *any* connection with `OfferManager` or `ProductPublisher` enabled, or only connections the operator has explicitly marked as a publish target? **Assumption below resolves this for v1.**
- Should the stock-at-risk read consider only variants that are currently *listed* on the connection (i.e. already have an offer/shop mapping), or every variant with master stock regardless of listing status? A variant with no listing anywhere can't oversell on that connection, so listing-scoping is the safer default.

### Assumptions (safe defaults, stated explicitly per the plan-generator process)

- "Listing-capable connection" = active connection where `OfferManager` (marketplace) or `ProductPublisher` (shop, enabled capability — not merely supported) is present, resolved via `IntegrationsService.listCapabilityAdapters({ lazy: true })` per capability and unioned by connection id — mirrors the existing `selectPublishDestinations` FE precedent's backend-side equivalent.
- Coverage-gap candidate pool = variants that have **at least one** Offer or ShopProduct mapping on **any** connection, capped at a bounded page size (`MAX_COVERAGE_GAP_CANDIDATES = 500`, ordered by most-recently-mapped) — a variant listed nowhere cannot have a "gap" (nothing to compare against).
- Stock-at-risk candidate pool = variants with **at least one** Offer or ShopProduct mapping on the connection being evaluated (only listed variants can oversell on that connection), capped per connection (`MAX_STOCK_AT_RISK_CANDIDATES = 500`).
- Failed-sync-value scope mirrors `countByHealth`'s existing bucket precedent exactly: `HAS_FAILED` AND NOT `IS_MAPPING` AND NOT `IS_SOURCE_DELETED` (an order still resolving item mappings or already flagged as source-deleted is not "stuck in a broken sync" in the operator-facing sense).
- Response paging: each of the three aggregates returns at most `N` items (default 20, capped at 100) plus a `totalCount`/`hasMore`, no cursor pagination needed for v1 (the FE section (#1989) is a compact list, not a paged table).
- Money summation for failed-sync value ignores currency mixing for v1 (same simplification the spec doc flags as `[X]` elsewhere) — if a deployment has orders in multiple currencies, the sum is currency-naive. Flagged as a known limitation, not silently hidden (surfaced in the response DTO via a `mixedCurrency: boolean` flag computed alongside the sum).

### Documentation Gaps

None beyond the velocity/ranking gap already covered in § 2.

---

## 6. Proposed Implementation Plan

### Phase 1: Coverage Gaps (listings context)

**Goal**: Report, per variant, which listing-capable connections it is missing a listing on.

**Steps**:

1. **Add types**
   - **File**: `libs/core/src/listings/domain/types/coverage-gap.types.ts`
   - **Action**: Define `CoverageGapItem { variantId: string; productId: string; listedOnConnectionIds: string[]; missingFromConnectionIds: string[]; }` and `CoverageGapsResult { items: CoverageGapItem[]; totalCount: number; }`.
   - **Acceptance**: Type-checks; no `any`.

2. **Add repository read + cross-context service method: candidate variant pool**
   - **Files**:
     - `libs/core/src/listings/domain/ports/offer-mapping-repository.port.ts` (extend) and `shop-product-mapping-repository.port.ts` (extend) — add `findRecentlyListedVariantIds(limit: number): Promise<string[]>` to both, returning distinct `internalId`s ordered by most-recent mapping `createdAt`, excluding `isStale` variants via the same read-model join `findStaleMappedVariants` already uses.
     - `libs/core/src/listings/application/services/offer-mappings.service.interface.ts` / `.ts` and `shop-product-mappings.service.interface.ts` / `.ts` — **also** add `findRecentlyListedVariantIds` here as a thin pass-through to the repository port.
   - **Why both**: `CoverageGapReadService` lives in the `listings` context itself, so it could call the repository ports directly — but `StockAtRiskReadService` (Phase 2) lives in `inventory` and needs the *same* read cross-context. Per `docs/architecture-overview.md § Cross-context dependencies in core`, `*RepositoryPort` is a forbidden cross-context import shape; `I*Service` is the seam. Adding the method to `IOfferMappingsService`/`IShopProductMappingsService` — the existing #718 cross-context read seam over these exact two repository ports — means both consumers (intra-context `CoverageGapReadService` and cross-context `StockAtRiskReadService`) call the same method through the sanctioned path, and `StockAtRiskReadService` never touches a `*RepositoryPort` from another context. (Found during the #1983 pre-implement gate — see `docs/plans/analysis/ANALYSIS-implementation-plan-needs-attention-aggregates.md` Finding 1.)
   - **Acceptance**: Unit test with a mocked `Repository` (TypeORM query builder) asserts the `DISTINCT`, `ORDER BY`, `LIMIT`, and stale-exclusion join at the repository layer; a separate unit test asserts the service method is a pure pass-through.

3. **Implement `CoverageGapReadService`**
   - **File**: `libs/core/src/listings/application/services/coverage-gap-read.service.ts` (+ `.interface.ts`)
   - **Action**: 
     1. Resolve listing-capable connection ids via `IntegrationsService.listCapabilityAdapters({ lazy: true })` for `OfferManager` and `ProductPublisher`, union by connection id.
     2. Union the two `findRecentlyListedVariantIds` reads (offer + shop) into the candidate pool, capped at `MAX_COVERAGE_GAP_CANDIDATES`.
     3. For each candidate variant, compute `listedOnConnectionIds` by checking `countByConnectionAndVariants` (offer + shop, batched per connection — NOT per variant, to avoid an N×M fan-out) against every capable connection.
     4. `missingFromConnectionIds = capableConnectionIds - listedOnConnectionIds`. Skip the variant if `missingFromConnectionIds` is empty (nothing to report) or if the variant is listed on zero connections (already excluded by the candidate-pool query, but re-check defensively).
     5. Page/cap the output to `N` items (assumption above), sorted by `missingFromConnectionIds.length` descending (widest gap first).
   - **Acceptance**: A variant listed on connection A (marketplace) and not on connection B (shop, `ProductPublisher` enabled) appears with `missingFromConnectionIds: [B]`. A `isStale` variant never appears. A variant listed on every capable connection never appears.

4. **Unit tests**
   - **File**: `libs/core/src/listings/application/services/coverage-gap-read.service.spec.ts`
   - **Action**: Mock `OfferMappingRepositoryPort`, `ShopProductMappingRepositoryPort`, `IntegrationsService`. Cover: no gaps (all listed everywhere), one gap, zero capable connections, stale-variant exclusion, candidate-pool cap respected.

### Phase 2: Stock at Risk (inventory context)

**Goal**: Report variants whose `masterStock - stockSafetyBuffer <= 0` on a given listing-capable connection.

**Steps**:

1. **Add types**
   - **File**: `libs/core/src/inventory/domain/types/stock-at-risk.types.ts`
   - **Action**: Define `StockAtRiskItem { variantId: string; productId: string; connectionId: string; masterStock: number; stockSafetyBuffer: number; }` and `StockAtRiskResult { items: StockAtRiskItem[]; totalCount: number; }`.

2. **Implement `StockAtRiskReadService`**
   - **File**: `libs/core/src/inventory/application/services/stock-at-risk-read.service.ts` (+ `.interface.ts`)
   - **Action**:
     1. Resolve listing-capable connections the same way as Phase 1 (or accept the already-resolved list as a parameter from the composing app-layer service, to avoid computing it twice — see Phase 4).
     2. For each connection with a configured, non-zero `stockSafetyBuffer` (via `readStockSafetyBuffer(connection.config)` — connections with the default `0` buffer are skipped; a buffer of `0` means "no protection configured", not "at risk of everything"), get the connection's listed variant ids by calling `IOfferMappingsService.findRecentlyListedVariantIds` + `IShopProductMappingsService.findRecentlyListedVariantIds` (the Phase 1 step 2 method, injected via `@openlinker/core/listings`'s `I*Service` barrel export — the sanctioned cross-context shape; never inject `OfferMappingRepositoryPort`/`ShopProductMappingRepositoryPort` directly from `inventory`).
     3. Batch-read `IInventoryQueryService.getAvailabilityByVariantIds(variantIds)` for those variants.
     4. Filter to `masterStock - buffer <= 0`. Exclude `isStale` variants (inherited from the listed-variant read, which already excludes them per Phase 1).
     5. Cap output.
   - **Acceptance**: A variant with `masterStock: 5`, `buffer: 5` on a connection is reported (`5 - 5 = 0`). A variant on a connection with `buffer: 0` (default, unset) is never reported. A variant not listed on the connection is never reported, even at zero stock.

3. **Unit tests**
   - **File**: `libs/core/src/inventory/application/services/stock-at-risk-read.service.spec.ts`
   - **Action**: Mock `IInventoryQueryService`, the listings read, connection config. Cover: at-risk, not-at-risk (positive margin), zero buffer (skipped), stale exclusion inherited.

### Phase 3: Value Stuck in Failed Syncs (orders context)

**Goal**: Count + sum the order value of orders that failed to reach a destination.

**Steps**:

1. **Extend `OrderRecordRepositoryPort` AND add the `IOrderRecordService` pass-through** — Option B, deliberately improving on the `countByHealth` precedent rather than copying it
   - **File**: `libs/core/src/orders/domain/ports/order-record-repository.port.ts` (confirmed exact path — verified during the pre-implement gate).
   - **Action**: Add `getFailedSyncValueSummary(filters: OrderHealthSummaryFilters): Promise<FailedSyncValueSummary>` — deliberately reuses the existing `OrderHealthSummaryFilters` shape (source connection / customer / date range) rather than inventing a parallel filter type.
   - **Decision (resolved at the #1983 pre-implement gate, Finding 2 — final call updated post-implementation)**: `IOrderRecordService` does **not** currently expose `countByHealth`, even though the repository port has it — the existing consumer, `apps/api/src/orders/http/orders.controller.ts`, injects `OrderRecordRepositoryPort` directly via its Symbol token for that exact read (`OrderRecordRepositoryPort` — rewire via `IOrdersService`), which `scripts/check-cross-context-imports.mjs` carries as a tracked, allow-listed violation, not a pattern to extend. So rather than copying that precedent (Option A), `NeedsAttentionService` (Phase 4) takes Option B: `getFailedSyncValueSummary` is added to `IOrderRecordService`/`OrderRecordService` as a thin pass-through to the repository method, and `NeedsAttentionService` injects `ORDER_RECORD_SERVICE_TOKEN`/`IOrderRecordService`, never `OrderRecordRepositoryPort` directly. This avoids growing the `apps/**` allow-list with a new entry for new code.
   - **Add type**: `libs/core/src/orders/domain/types/order-record.types.ts` → `FailedSyncValueSummary { count: number; totalValue: number; mixedCurrency: boolean; oldestFailedAt: Date | null; }`.

2. **Implement the repository method**
   - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`
   - **Action**: New `getFailedSyncValueSummary` method, structurally next to `countByHealth`, reusing the private `HAS_FAILED`, `NOT_MAPPING_OR_DELETED`, and `TOTAL_EXPR` static fragments (no duplication):
     ```ts
     .select('COUNT(*)', 'count')
     .addSelect(`COALESCE(SUM(${TOTAL_EXPR}) FILTER (WHERE ${HAS_FAILED} AND ${NOT_MAPPING_OR_DELETED}), 0)`, 'total_value')
     .addSelect(`COUNT(DISTINCT (rec."orderSnapshot"#>>'{totals,currency}')) FILTER (WHERE ${HAS_FAILED} AND ${NOT_MAPPING_OR_DELETED})`, 'currency_count')
     .addSelect(`MIN(rec."createdAt") FILTER (WHERE ${HAS_FAILED} AND ${NOT_MAPPING_OR_DELETED})`, 'oldest_failed_at')
     .where(`${HAS_FAILED} AND ${NOT_MAPPING_OR_DELETED}`)
     ```
     `mixedCurrency = currency_count > 1`.
   - **Acceptance**: Given two failed orders in PLN totalling 100 + 50, returns `{ count: 2, totalValue: 150, mixedCurrency: false, oldestFailedAt: <earlier createdAt> }`. A `source_deleted` or `awaiting_mapping` record is never counted, matching `countByHealth`'s existing bucket semantics.

3. **Unit tests**
   - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.spec.ts` (extend, or add an integration test if the existing `countByHealth` coverage is integration-only — check during implementation).

### Phase 4: Composition + HTTP (apps/api)

**Goal**: One endpoint returning all three aggregates.

**Steps**:

1. **Add response DTO**
   - **File**: `apps/api/src/analytics/http/dto/needs-attention-response.dto.ts`
   - **Action**: `NeedsAttentionResponseDto` with `coverageGaps: CoverageGapItem[]`, `stockAtRisk: StockAtRiskItem[]`, `failedSyncValue: FailedSyncValueSummary`, each carrying enough identity (variantId, productId, connectionId) for the FE to deep-link (AC).

2. **Implement `NeedsAttentionService`**
   - **File**: `apps/api/src/analytics/application/services/needs-attention.service.ts` (+ `.interface.ts`)
   - **Action**: Resolve listing-capable connections once, pass to both `CoverageGapReadService` and `StockAtRiskReadService` to avoid resolving twice (per Phase 2 step 2 note). Inject `IOrderRecordService` (via `ORDER_RECORD_SERVICE_TOKEN` from `@openlinker/core/orders`) for the failed-sync-value read — Option B from the Phase 3 decision, not `OrdersController`'s `OrderRecordRepositoryPort`-direct pattern, which is tracked debt rather than a precedent to extend. Call all three reads in parallel (`Promise.all`). Map to the response DTO.
   - **Verify early**: run `pnpm lint` right after adding the new import to confirm `check-cross-context-imports` is satisfied — `IOrderRecordService`/`ORDER_RECORD_SERVICE_TOKEN` are already-sanctioned cross-context shapes (`I*Service` / `*_TOKEN`), so no new allow-list entry should be needed (pre-implement gate Finding 3, superseded by the Phase 3 Option B call).
   - **Why apps/api and not a core service**: this is the one place three sibling CORE contexts' service interfaces (`listings`, `inventory`, `orders`) are combined for a single HTTP response — composing at the interface/app layer keeps `listings`/`inventory`/`orders` from gaining a new dependency on each other that nothing else in those contexts needs (see § 3 justification).

3. **Implement the controller**
   - **File**: `apps/api/src/analytics/http/needs-attention.controller.ts`
   - **Action**: `GET /analytics/needs-attention`, `@UseGuards(JwtAuthGuard)`, no request body/params for v1 (the FE section shows the whole picture, no filters yet — matches #1989's scope).
   - **Wire into** `apps/api/src/analytics/analytics.module.ts` (existing module — add the new controller + service provider; note this module today only hosts PostHog settings, so this is the first non-PostHog concern to land in it — flagged in § 8 as a naming overlap worth a maintainer's attention, not a blocker).

4. **Unit tests**
   - **File**: `apps/api/src/analytics/http/needs-attention.controller.spec.ts`, `apps/api/src/analytics/application/services/needs-attention.service.spec.ts`
   - **Action**: Mock the three core service interfaces; assert composition and DTO shape.

---

## 7. Alternatives Considered

### Alternative 1: Implement velocity-based "fast movers" now, alongside the simple threshold

- **Description**: Add a sales-velocity component to stock-at-risk in this same pass, computing units-sold-per-day from `order_records.orderSnapshot.items` (JSONB) via an ad-hoc `jsonb_array_elements` expansion.
- **Why Rejected**: No window, threshold, or "won't survive to next sync" formula is defined anywhere (spec, mockup, or issue) — building it now means inventing the definition unilaterally rather than getting product sign-off. It also reuses the same missing substrate (queryable line items) that #1983 itself defers for coverage-gap ranking, so building it here would be inconsistent with the issue's own stated scope.
- **Trade-offs**: Faster to ship the "smarter" version now vs. shipping the documented v1 and raising a follow-up once the algorithm is defined and the substrate exists.

### Alternative 2: Put the composition service inside `libs/core/src/analytics` (core, not apps/api)

- **Description**: Extend the existing core `analytics` context (currently PostHog-settings-only) with the needs-attention composition, so the three-context orchestration lives in CORE rather than the app layer.
- **Why Rejected**: `analytics` as a bounded context is currently scoped to PostHog settings (its own barrel documents this explicitly). Extending it to also own cross-context reporting composition would blur what the context means, and — per `docs/architecture-overview.md § Cross-context dependencies in core` — would add three new core-to-core dependency edges (`analytics → listings`, `analytics → inventory`, `analytics → orders`) that nothing else in the codebase needs, purely to satisfy one HTTP endpoint's composition. Composing at the interface layer (apps/api) is the standard seam for "read three sibling contexts and shape one response" and avoids the new edges.
- **Trade-offs**: A future second consumer of the same composed aggregate (unlikely, but possible) would need to duplicate the composition at another app-layer call site, or the composition would need to move into core at that point. Acceptable for a single-consumer v1.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Domain layer stays framework-free; all new logic is in `application/services/`.
- ✅ Services depend on ports (`OfferMappingRepositoryPort`, `IInventoryQueryService`, `OrderRecordRepositoryPort`) via Symbol tokens, never concrete repositories.
- ✅ No new cross-context core coupling — composition happens at apps/api.

### Naming Conventions
- ✅ `*ReadService` mirrors no existing exact suffix in the codebase, but `*.service.ts` implementing `I*Service` matches the standard pattern; "Read" in the name signals a query-only service (no mutation), consistent with `PublishedVariantsService`'s own read-only nature (which doesn't use the suffix, but nothing in the standards forbids it — flagged as a naming choice worth a second opinion in review, not a violation).

### Existing Patterns
- ✅ Coverage gaps reuses the offer+shop mapping union shape from `PublishedVariantsService`.
- ✅ Stock-at-risk reuses `readStockSafetyBuffer`/`applyStockSafetyBuffer` and `getAvailabilityByVariantIds` verbatim.
- ✅ Failed-sync-value reuses `countByHealth`'s SQL fragments instead of re-deriving the JSONB predicate.

### Risks
- **N×M fan-out risk in coverage gaps** (Phase 1 step 3): naively checking every candidate variant against every capable connection is O(variants × connections) queries if implemented per-pair. Mitigated by batching per connection (one `countByConnectionAndVariants` call per capable connection, not per variant) — call count is O(connections), not O(variants × connections).
- **Currency-naive money summation** (failed-sync value): flagged via `mixedCurrency`, not silently wrong — but the FE (#1989) needs to decide how to render a mixed-currency total. Raised as a cross-issue coordination point, not fixed here.
- **Naming/module overlap**: `apps/api/src/analytics` and `libs/core/src/analytics` currently mean "PostHog settings", not "the `/analytics` reporting page". Reusing the same module for this endpoint is convenient (matches the URL prefix) but conflates two unrelated meanings of "analytics" in the same file tree. Flagged for a maintainer decision — an alternative is a new `apps/api/src/reporting` module dedicated to the `/analytics` page's backend, which #1986 (route shell) may already be establishing. **This plan assumes reuse of the existing module for now; revisit if #1986 introduces a dedicated module.**

### Edge Cases
- Zero listing-capable connections → all three aggregates return empty, not an error.
- A variant listed on exactly one capable connection with no other capable connections existing → no coverage gap (nothing to be missing from).
- A connection's `stockSafetyBuffer` is present-but-invalid (per `isPresentButInvalidStockSafetyBuffer`) → treated as `0` (no protection), consistent with `readStockSafetyBuffer`'s existing coercion — not surfaced as a stock-at-risk item, since the read isn't the right place to warn about a misconfigured buffer (that's `isPresentButInvalidStockSafetyBuffer`'s existing consumer's job).
- A failed order later succeeds on retry → its `syncStatus` entry flips to `synced`; `HAS_FAILED`'s `@>` containment check no longer matches, so it drops out of the aggregate automatically (same self-healing behavior `countByHealth` already has).

### Backward Compatibility
- ✅ No breaking changes. All new methods are additive to existing ports/interfaces.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `coverage-gap-read.service.spec.ts` — see Phase 1 step 4.
- `stock-at-risk-read.service.spec.ts` — see Phase 2 step 3.
- `order-record.repository.spec.ts` (extended) + `order-record.service.spec.ts` — see Phase 3 step 4.
- `needs-attention.service.spec.ts`, `needs-attention.controller.spec.ts` — see Phase 4 step 4.

### Integration Tests
- One `*.int-spec.ts` under `apps/api/test/integration/analytics/` exercising `GET /analytics/needs-attention` against real Postgres: seed a variant listed on connection A but not capable connection B (coverage gap), a variant at/below its connection's stock buffer, and a failed-sync order record; assert the response reports all three and excludes a stale-variant control case.

### Mocking Strategy
- Unit tests mock `OfferMappingRepositoryPort`, `ShopProductMappingRepositoryPort`, `IInventoryQueryService`, `OrderRecordRepositoryPort`, and `IntegrationsService` — never a concrete repository or adapter.
- The integration test uses the real Testcontainers-backed Postgres, per `docs/testing-guide.md`.

### Acceptance Criteria (mirrors #1983's own AC, confirmed unchanged by this plan)
- [ ] Coverage gaps report, per variant, which connections carry a listing and which do not
- [ ] Stock at risk reflects the destination connection's configured safety buffer, not raw master stock
- [ ] Failed-sync value reports both the count and the summed order value of orders that never reached a destination
- [ ] Each result carries enough identity for the UI to link into the corresponding existing flow (publish, product detail, sync failures)
- [ ] Stale variants (#1689) are excluded from coverage gaps
- [ ] Results are bounded/paged
- [ ] Tests added (unit + integration)
- [ ] No new ESLint warnings or type errors introduced
- [ ] (New, from this plan) Response/DTO shape does not imply sales-velocity ranking or "fast movers" — copy and field names stay descriptive of the simple threshold/presence check, so #1989 cannot accidentally promise the deferred feature through the API contract alone.

**Reference**: [Testing Guide](../testing-guide.md)

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no unnecessary abstractions) — reuses `PublishedVariantsService`'s union shape, `readStockSafetyBuffer`/`applyStockSafetyBuffer`, and `countByHealth`'s SQL fragments instead of re-deriving any of them
- [x] Idempotency considered — all three aggregates are pure reads, no mutation, no idempotency concern
- [ ] Event-driven patterns used where applicable — not applicable, this is a synchronous read endpoint
- [ ] Rate limits & retries addressed — not applicable, no external API call
- [x] Error handling comprehensive — empty results are the "nothing to report" case, not an error path; no new exception types needed
- [x] Testing strategy complete
- [x] Naming conventions followed (with one flagged naming choice — see § 8)
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- Issue #1983, #1989 (frontend consumer), #1844 (stock safety buffer), #1689 (stale-variant exclusion), #1837 (destination-aware duplicate guard / `PublishedVariantsService` precedent)
