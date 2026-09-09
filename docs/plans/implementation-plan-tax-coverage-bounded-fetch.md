# Implementation Plan: Page/bound `findNetExcludedOrderCandidates`'s base fetch

**Date**: 2026-09-08
**Status**: Draft
**Estimated Effort**: 4-6 hours
**Issue**: [#2834](https://github.com/openlinker-project/openlinker/issues/2834) (follow-up to #2826, split out of PR #2827 review)

---

## 1. Task Summary

**Objective**: `OrderRecordRepository.findNetExcludedOrderCandidates` issues one **unbounded**
query (no `LIMIT`/`OFFSET`) over the full `SalesAnalyticsFilters` window, and
`TaxCoverageDetectionService.classify()` materializes the *entire* resulting array in memory
before any category count or page can be produced. `GET /analytics/coverage` (hit unconditionally
on `/analytics` page mount) therefore does one full-history-window scan and one full in-memory
classification pass per request, and both costs scale linearly with total non-cancelled,
net-excluded order history for the filter window (currently up to 400 days).

**Context**: PR #2827 already closed two of #2826's three acceptance criteria — the per-order
`order_line_items` N+1 read is now one batched `findByOrderIds` call, and the per-line catalogue
rate lookup runs with bounded concurrency (`RATE_LOOKUP_CONCURRENCY = 5`) over a deduplicated key
set instead of one sequential `getEffectiveTaxRate` call per unresolved line. What #2827 did **not**
close is the base row fetch: `findNetExcludedOrderCandidates` still returns every matching row in
one `getRawMany()` call, and `classify()` still builds one big `candidates` array before doing
anything else.

**Classification**: CORE (Application + Infrastructure layers, `orders` bounded context)

---

## 2. Scope & Non-Goals

### In Scope
- Bound the per-query cost of `findNetExcludedOrderCandidates` (or its replacement) so no single
  SQL statement returns an unbounded row count.
- Make `TaxCoverageDetectionService.classify()` — and by extension `getCategoryCounts`,
  `getCategoryPage`, `getAllCategoryPages`, `getAllCategoryCountsByConnection` — consume the base
  population incrementally (batch by batch) instead of materializing the full unbounded array
  before doing any classification work.
- Preserve **exact** parity with today's output: identical `tax-a`/`tax-b`/`tax-c` partitions,
  identical counts, identical per-category drill-down page contents, for identical inputs. This is
  a non-negotiable acceptance criterion (#2834 AC-2) — the fix must not become a sampling or
  approximation shape.
- Add/extend tests (unit + a live-Postgres int-spec mirroring `tax-coverage-net-excluded.int-spec.ts`)
  proving the batched shape produces byte-identical results to the pre-change unbounded shape, and
  proving no single repository call can return an unbounded row count.

### Out of Scope
- Changing what counts as "net excluded" or the tax A/B/C classification rule itself — the
  `netExcludedAndNotCancelled` SQL predicate and `classifyOne`'s bucket logic are unchanged.
- Changing the catalogue-lookup concurrency bound (`RATE_LOOKUP_CONCURRENCY`) — already addressed
  by #2826/#2827.
- Adding caching, background pre-computation, or a materialized view for `/analytics/coverage`
  — the issue's own "Proposed Solution" explicitly scopes this to bounding/paging the existing
  read path, not to a different caching architecture. A materialized/cached shape is a bigger
  change with its own staleness-tracking questions and belongs in a separate issue if it turns out
  to still be needed after this fix.
- Any FE change — `GET /analytics/coverage`'s response shape and values are unchanged, so
  `apps/web` needs no changes.
- Sampling / approximate counts. The issue's "Proposed Solution" mentions a bounded-sample option
  as an alternative, but it is rejected here (see §7 Alternatives Considered) because it cannot
  satisfy AC-2 (byte-identical counts) — tax classification depends on a **live catalogue read**
  that has no SQL equivalent, so a sample cannot be extrapolated into an exact aggregate.

### Constraints
- Must preserve the `candidates.length === netExcludedCount` regression guard (or an equivalent
  invariant over the new shape) that existing unit/int-specs assert.
- Must not introduce a CORE → Infrastructure or CORE → cross-context boundary violation
  (`docs/architecture-overview.md § Cross-context dependencies in core`).
- Follows PR #2827 — the batched line-item read (`findByOrderIds`) and bounded-concurrency
  catalogue lookup (`resolveRates`) it introduced are reused unchanged, just invoked once per
  batch instead of once for the whole unbounded set.

---

## 3. Architecture Mapping

**Target Layer**: CORE — `libs/core/src/orders/`
- Domain: `domain/ports/order-record-repository.port.ts` (port contract), `domain/types/coverage-detection.types.ts` (new cursor/page types)
- Application: `application/services/tax-coverage-detection.service.ts` (incremental accumulation)
- Infrastructure: `infrastructure/persistence/repositories/order-record.repository.ts` (keyset-paginated query)

**Capabilities Involved**: none new — this is entirely inside the existing `orders` context's
`OrderRecordRepositoryPort` / `ITaxCoverageDetectionService` seam. No new port, no new capability.

**Existing Services Reused**:
- `OrderLineItemRepositoryPort.findByOrderIds` (#2827's batched line-item read) — called once per
  batch instead of once for the whole candidate set.
- `TaxCoverageDetectionService.resolveRates` (#2826/#2827's bounded-concurrency catalogue lookup)
  — called once per batch, over the subset of that batch's deduplicated keys not already resolved
  on a prior page. The resolved-rate map is owned by `classify()` and shared across every page, so
  a product/variant referenced across multiple pages is resolved exactly once per `classify()` run
  — the dedup #2826 introduced stays population-wide rather than resetting per page.
- `applySalesAnalyticsScope` (existing private helper on `OrderRecordRepository`) — unchanged,
  reused verbatim inside the new paginated query builder.

**New Components Required**:
- A keyset cursor type (`NetExcludedOrderCandidateCursor`, `domain/types/coverage-detection.types.ts`)
  representing "resume after this `(placedAt, internalOrderId)` pair".
- `OrderRecordRepositoryPort.findNetExcludedOrderCandidatesPage(...)` — a new, bounded, paginated
  read replacing the unbounded `findNetExcludedOrderCandidates`.
- `TaxCoverageDetectionService`'s internal batch-accumulation loop (private method), replacing the
  single unbounded `findNetExcludedOrderCandidates` call at the top of `classify()`.

**Core vs Integration Justification**: This is pure `orders` CORE-context work — a repository read
shape and an application-service accumulation loop. No integration/adapter boundary is touched;
`IProductsService.getEffectiveTaxRate` (the one cross-context call in this service, `orders →
products` per the documented dependency map) is called through the exact same
`ITaxCoverageDetectionService`/`IProductsService` seam as before, just invoked per-batch.

---

## 4. External / Domain Research

### Internal Patterns

**Keyset pagination precedent** — this repository already has a `placedAt IS NOT NULL` guarantee
baked into `applySalesAnalyticsScope` (verified by reading the method), so `(placedAt, internalOrderId)`
is a safe, always-non-null, unique-enough keyset ordering key (the same `ORDER BY rec."placedAt"
DESC` the unbounded query already uses; `internalOrderId` is the row's primary/unique id and breaks
ties deterministically). Using `LIMIT/OFFSET` instead was considered and rejected — see §7.

**Bounded-concurrency precedent** — `RATE_LOOKUP_CONCURRENCY` / `resolveBatchConcurrency`
(ADR-047/#2229) is the established pattern in this exact file for "bound the fan-out, never fully
sequential, never a single unbounded `Promise.all`". The new batch loop over
`findNetExcludedOrderCandidatesPage` follows the same spirit: bound the *page size* of a single SQL
statement rather than issue one unbounded statement.

**`runBoundedSweep` (`apps/worker/src/sync/bounded-sweep.ts`) was considered and rejected as a
direct fit** — see §7. It is designed for a cross-tick, cursor-persisted background sweep; this is
a synchronous, single-HTTP-request read that must return a complete, exact answer before the
request completes. The *idea* (bounded batch + resumable cursor) is reused; the mechanism
(persisted `connection_cursors` state, tick-based resumption) is not, because there is no
multi-tick job here — the whole loop runs inside one `classify()` call.

**Existing regression guard** — `tax-coverage-net-excluded.int-spec.ts` and
`tax-coverage-detection.service.spec.ts` already assert `candidates.length === netExcludedCount`
and the exact tax-a/b/c partition for fixture data. These specs are the parity oracle for this
change: after the rewrite, the exact same assertions must pass unchanged (see §9).

### Existing code read during research

- `libs/core/src/orders/application/services/tax-coverage-detection.service.ts` — full file read.
  `classify()` today: (1) one unbounded `findNetExcludedOrderCandidates` call, (2) filter to
  pre-rollout candidates, (3) one batched `findByOrderIds` call for those, (4) build the
  deduplicated `(productId, variantId)` key set across ALL pre-rollout candidates, (5) one
  bounded-concurrency `resolveRates` call over that whole key set, (6) loop over ALL candidates and
  classify each into `tax-a`/`tax-b`/`tax-c`.
- `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts:1027-1059`
  — `findNetExcludedOrderCandidates`'s current unbounded `getRawMany()` implementation, and the
  `applySalesAnalyticsScope` private helper it (and every other sales-analytics read) shares.
- `libs/core/src/orders/domain/ports/order-record-repository.port.ts:379-411` — the port's doc
  comment explicitly states "Unpaged by design" with the rationale that classification needs the
  full set before any page can be sliced. This plan's job is to falsify that "before any page can
  be sliced" premise by making the *classification pass itself* incremental, not just the read.
- `libs/core/src/orders/domain/types/coverage-detection.types.ts` — `NetExcludedOrderCandidate`,
  `TaxCoverageClassification`, `CoverageDetectionPagination` shapes.
- `apps/api/test/integration/orders/tax-coverage-net-excluded.int-spec.ts` — existing int-spec
  shape to mirror for the new batched-read int-spec (fixture pattern, harness usage,
  `resetTestHarness()` between cases).

---

## 5. Questions & Assumptions

### Open Questions
- None blocking. The issue's own "Assumptions" section explicitly permits either sub-approach (cap
  + incremental accumulation, or an alternative bounding shape) as long as AC-2 (identical output)
  holds — this plan picks the "cap + page + incremental accumulate" branch, which is the only one
  of the two that can satisfy AC-2 exactly (see §7).

### Assumptions
- **Batch size**: `NET_EXCLUDED_CANDIDATE_PAGE_SIZE = 500` — matches the `bounded-sweep.ts`
  family's `SWEEP_BUDGET_DEFAULT`-adjacent scale (a few hundred rows) and this context's own
  ADR-039 "10-100 orders/day persona, 10-100x that per multi-hundred-day window" scale note already
  present in the port's doc comment. Not exposed as an env var — this is a request-scoped internal
  batch size, not an operator-tunable sweep cadence, so it stays a `const` in the repository file
  (mirroring how `RATE_LOOKUP_CONCURRENCY` is a plain file-local `const`, not an env-configured
  value).
- **Revised during review**: the initial draft accepted a cross-batch dedup gap (a `(productId,
  variantId)` pair referenced by pre-rollout orders in two different pages would be looked up
  twice), reasoning it was a micro-optimization out of scope for the *base fetch* bound. Review
  correctly identified this as silently narrowing #2826's own dedup guarantee — and worse, as
  making the #2826 regression spec unable to fail on that narrowing, since its fixture was
  single-page. The final implementation instead threads ONE `rateByKey` map, owned by
  `classify()`, through every page's `classifyBatch()` call — population-wide dedup is preserved
  exactly as #2826 shipped it, at the cost of one small map living for the duration of the request
  (bounded by distinct product/variant count, not by row count).
- **`internalOrderId` is a stable, unique-per-row sort tiebreaker** — verified: `OrderRecord`'s
  `internalOrderId` is the entity's identifier column (used as the map key throughout this service
  already, e.g. `linesByOrderId.get(candidate.internalOrderId)`), so `(placedAt DESC,
  internalOrderId DESC)` is a safe, total keyset order with no possibility of skipping or
  duplicating a row across page boundaries.
- **`placedAt` is never null within scope**: confirmed by reading `applySalesAnalyticsScope`,
  which unconditionally adds `rec."placedAt" IS NOT NULL`. The keyset cursor can therefore treat
  `placedAt` as non-null without a `COALESCE`/null-ordering special case.
- **The three "all three categories at once" callers (`getCategoryPage` — which internally calls
  the full `classify()` anyway today — `getCategoryCounts`, `getAllCategoryPages`,
  `getAllCategoryCountsByConnection`) all keep calling `classify()` once and reading off its
  result**, unchanged. Only `classify()`'s *internals* change; its public return shape
  (`TaxCoverageClassification`) is untouched, so none of these four call sites need edits beyond
  what `classify()` itself requires.

### Documentation Gaps
- None material. `docs/architecture-overview.md`'s `orders` context section documents
  `getSalesAndChannelAnalytics`/analytics reads generally but has no dedicated bullet for
  `TaxCoverageDetectionService` or `findNetExcludedOrderCandidates` — the change is small enough
  (an internal read/accumulation shape, no new capability, no new API surface) that no
  architecture-overview.md update is required. The port method's own doc comment (currently
  claiming "Unpaged by design") is the one piece of documentation that must be rewritten in place
  (see Phase 1, Step 1).

---

## 6. Proposed Implementation Plan

### Phase 1: Repository — bounded, keyset-paginated candidate fetch
**Goal**: Replace the single unbounded `getRawMany()` with a bounded, resumable, keyset-paginated
read that a caller can drive in a loop without ever issuing a statement with no `LIMIT`.

**Steps**:

1. **Add the cursor + page-result types**
   - **File**: `libs/core/src/orders/domain/types/coverage-detection.types.ts`
   - **Action**: Add
     ```ts
     /**
      * Keyset-pagination cursor for
      * {@link OrderRecordRepositoryPort.findNetExcludedOrderCandidatesPage} (#2834) — resumes
      * strictly after the given `(placedAt, internalOrderId)` pair, matching the query's own
      * `ORDER BY placedAt DESC, internalOrderId DESC`. `placedAt` is guaranteed non-null within
      * `SalesAnalyticsFilters` scope (`applySalesAnalyticsScope` enforces `placedAt IS NOT NULL`).
      */
     export interface NetExcludedOrderCandidateCursor {
       placedAt: Date;
       internalOrderId: string;
     }

     /**
      * One bounded page of {@link NetExcludedOrderCandidate} rows (#2834) — replaces the
      * pre-#2834 unbounded `findNetExcludedOrderCandidates` return. `nextCursor` is `null` when
      * this page was the last (fewer than the requested page size came back).
      */
     export interface NetExcludedOrderCandidatePage {
       items: NetExcludedOrderCandidate[];
       nextCursor: NetExcludedOrderCandidateCursor | null;
     }
     ```
   - **Acceptance**: Types compile; no existing import breaks (these are additive exports).
   - **Dependencies**: None.

2. **Add the bounded, paginated repository method; deprecate the unbounded one in place**
   - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`
   - **Action**: Add a `NET_EXCLUDED_CANDIDATE_PAGE_SIZE = 500` file-local `const` near the top
     (beside other tuning constants, or inline if none exist at file scope — check for a
     conventional spot). Add a new method:
     ```ts
     async findNetExcludedOrderCandidatesPage(
       filters: SalesAnalyticsFilters,
       currentReportingCurrency: string,
       includeBackfilledPreRollout = false,
       cursor: NetExcludedOrderCandidateCursor | null = null,
       limit: number = NET_EXCLUDED_CANDIDATE_PAGE_SIZE
     ): Promise<NetExcludedOrderCandidatePage> {
       const { netEligible } = this.buildNetSalesOrderFragments(includeBackfilledPreRollout);
       const netExcludedAndNotCancelled = `rec."cancelledAt" IS NULL AND rec."reportingCurrency" = :currentReportingCurrency AND NOT ${netEligible}`;

       const qb = this.repository
         .createQueryBuilder('rec')
         .select('rec."internalOrderId"', 'internal_order_id')
         .addSelect('rec."sourceConnectionId"', 'source_connection_id')
         .addSelect('rec."placedAt"', 'placed_at')
         .addSelect('rec."taxRateEra"', 'tax_rate_era')
         .andWhere(netExcludedAndNotCancelled, { currentReportingCurrency })
         .orderBy('rec."placedAt"', 'DESC')
         .addOrderBy('rec."internalOrderId"', 'DESC')
         .take(limit + 1); // fetch one extra row to detect "more pages exist" without a COUNT

       this.applySalesAnalyticsScope(qb, filters);

       if (cursor) {
         qb.andWhere(
           '(rec."placedAt" < :cursorPlacedAt OR (rec."placedAt" = :cursorPlacedAt AND rec."internalOrderId" < :cursorInternalOrderId))',
           { cursorPlacedAt: cursor.placedAt, cursorInternalOrderId: cursor.internalOrderId }
         );
       }

       const rows = await qb.getRawMany<{
         internal_order_id: string;
         source_connection_id: string;
         placed_at: Date;
         tax_rate_era: string | null;
       }>();

       const hasMore = rows.length > limit;
       const page = hasMore ? rows.slice(0, limit) : rows;

       const items = page.map((row) => ({
         internalOrderId: row.internal_order_id,
         sourceConnectionId: row.source_connection_id,
         placedAt: row.placed_at,
         taxRateEra: row.tax_rate_era,
       }));

       const last = page.at(-1);
       const nextCursor =
         hasMore && last ? { placedAt: last.placed_at, internalOrderId: last.internal_order_id } : null;

       return { items, nextCursor };
     }
     ```
   - **Note on the "fetch `limit + 1`" trick**: avoids a separate `COUNT(*)` query per page just to
     know whether another page follows — the same "peek one extra row" idiom used elsewhere in
     this codebase for offset-free "has more" detection (verify against `runBoundedSweep`'s own
     page-boundary handling for a matching in-tree precedent before finalizing; if no exact
     precedent exists, this is still the standard keyset-pagination idiom and needs no new
     abstraction).
   - **Rewrite `findNetExcludedOrderCandidates`'s doc comment** (or remove the method — see Step 3)
     to no longer claim "Unpaged by design"; if kept, mark it deprecated pointing at the new method.
   - **Acceptance**: New method compiles, returns a bounded page, `nextCursor` correctly signals
     continuation. Verified by unit test in Phase 3.
   - **Dependencies**: Step 1 (types).

3. **Decide: keep or remove the old unbounded method**
   - **Action**: Since `findNetExcludedOrderCandidates` (unbounded) has exactly one production
     caller (`TaxCoverageDetectionService.classify()`, changed in Phase 2) and the port doc comment
     explicitly ties its existence to that one caller's "needs the full set" assumption — which
     Phase 2 removes — **remove** the unbounded method and its port declaration entirely rather
     than leaving a dead/deprecated method behind. Update:
     - `libs/core/src/orders/domain/ports/order-record-repository.port.ts` — remove the
       `findNetExcludedOrderCandidates` declaration (lines ~379-411), replace with the new
       `findNetExcludedOrderCandidatesPage` declaration + doc comment explaining the keyset-batch
       contract and why it replaces the unbounded predecessor (cite #2834).
     - `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`
       — remove the old `findNetExcludedOrderCandidates` method body (superseded by Step 2's new
       method).
   - **Acceptance**: `pnpm type-check` clean — no remaining reference to the removed method
     anywhere in `libs/core` or `apps/*`.
   - **Dependencies**: Step 2.

### Phase 2: Application service — incremental accumulation
**Goal**: `classify()` drives the new paginated repository method in a loop, running the existing
per-batch line-item read + catalogue resolve + classification logic once per page, and merges
results into the same `TaxCoverageClassification` shape — with **no** behavioral difference in the
final output versus today.

**Steps**:

4. **Extract the existing per-candidate-set classification body into a batch-shaped private helper**
   - **File**: `libs/core/src/orders/application/services/tax-coverage-detection.service.ts`
   - **Action**: Refactor `classify()`'s current body (everything after fetching `candidates`) into
     a new private method `classifyBatch(candidates: NetExcludedOrderCandidate[]):
     Promise<TaxCoverageClassification>` that takes a candidate array and returns a
     `TaxCoverageClassification` for *just that array* — i.e. exactly what `classify()` does today,
     unchanged in logic, just scoped to operate over any array rather than assuming it is the whole
     population. This is a pure refactor with no behavior change (verified by running the existing
     unit spec unchanged against it before touching the pagination loop).
   - **Acceptance**: `classify(filters, currency, includeBackfilled)` still calls the unbounded
     fetch (temporarily, before Step 5) then `classifyBatch(candidates)`, and every existing unit
     test still passes unchanged. This step is a safe, independently-verifiable checkpoint.
   - **Dependencies**: None (independent of Phase 1).

5. **Replace the single unbounded fetch with a paginated accumulation loop**
   - **File**: `libs/core/src/orders/application/services/tax-coverage-detection.service.ts`
   - **Action**: Rewrite `classify()`:
     ```ts
     async classify(
       filters: SalesAnalyticsFilters,
       currentReportingCurrency: string,
       includeBackfilledPreRollout = false
     ): Promise<TaxCoverageClassification> {
       const result: TaxCoverageClassification = { 'tax-a': [], 'tax-b': [], 'tax-c': [] };
       let cursor: NetExcludedOrderCandidateCursor | null = null;

       for (;;) {
         const page = await this.orderRecordRepository.findNetExcludedOrderCandidatesPage(
           filters,
           currentReportingCurrency,
           includeBackfilledPreRollout,
           cursor
         );
         if (page.items.length === 0) {
           break;
         }

         const batchResult = await this.classifyBatch(page.items);
         for (const category of TaxCoverageCategoryValues) {
           result[category].push(...batchResult[category]);
         }

         if (page.nextCursor === null) {
           break;
         }
         cursor = page.nextCursor;
       }

       return result;
     }
     ```
   - **Rationale for the merge-by-append shape**: category assignment (`tax-a`/`tax-b`/`tax-c`) is
     a pure function of *one order's own state* (its `taxRateEra`, its lines, and the catalogue's
     answer for its unresolved lines) — never of any *other* order's state or of aggregate
     position. So classifying page N in isolation and appending its per-category rows to the
     running result is exactly equivalent to classifying the whole unbounded set in one pass. This
     is the load-bearing correctness argument for the whole plan and must be called out explicitly
     in the method's doc comment (cite #2834, explain why batch-then-append is provably equivalent
     to whole-set classification, and update the class-level doc comment's "Not pushed into SQL"
     section to describe the new batched shape instead of the old unbounded one).
   - **Row ORDER within a category is not currently a documented contract** (verify against
     `TaxCoverageOrderRow`'s doc comment and `getCategoryPage`'s slicing use — if no ordering
     guarantee is documented, the batch-then-append shape naturally preserves the pre-change
     `placedAt DESC` order across page boundaries anyway, since the keyset cursor iterates in that
     same order, so no additional sort step is needed. If `getCategoryPage`'s `.slice(offset,
     offset+limit)` behavior is relied on by a UI expecting stable ordering across repeated calls,
     confirm this in Phase 4 testing rather than assuming it away).
   - **Acceptance**: `getCategoryCounts`, `getCategoryPage`, `getAllCategoryPages`,
     `getAllCategoryCountsByConnection` all still compile unchanged (they only call `classify()`
     and read its return value) and produce identical output to before, verified by the parity
     tests in Phase 3.
   - **Dependencies**: Step 4, Phase 1 (the new repository method must exist).

6. **Update the class-level and interface-level doc comments**
   - **Files**:
     - `libs/core/src/orders/application/services/tax-coverage-detection.service.ts` (class doc
       comment's "Not pushed into SQL" paragraph — currently says the base population is "fetched
       UNPAGED" and classified "here in the application layer" with "page slicing... happens
       in-memory over the already-classified result" — update to describe the new batched-fetch +
       incremental-accumulation shape and why it is provably equivalent).
     - `libs/core/src/orders/application/services/tax-coverage-detection.service.interface.ts` (no
       method-signature change needed — `classify`'s public contract is unchanged — but note in
       `classify`'s doc comment that the population is now fetched in bounded batches internally,
       for a future reader's benefit).
   - **Acceptance**: Doc comments accurately describe the new implementation; no stale claims about
     "unpaged" or "unbounded" remain anywhere referencing this read path.
   - **Dependencies**: Step 5.

### Phase 3: Tests
**Goal**: Prove exact parity with the pre-change behavior, and prove the new shape is genuinely
bounded per query.

**Steps**:

7. **Unit test: repository pagination correctness**
   - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.spec.ts`
     (create if it doesn't already cover this repository — check for an existing spec file first;
     if this repository has no dedicated unit spec today because it's typically covered only by
     int-specs via a real query builder, this is a case for the int-spec in Step 9 instead — TypeORM
     query-builder logic is usually not meaningfully unit-testable without a real DB, so **prefer
     the int-spec route** for this repository method specifically).
   - **Acceptance**: Deferred to Step 9's int-spec, which is the correct testing layer for real SQL
     keyset-pagination behavior (page boundaries, `nextCursor` correctness, ordering) per this
     repo's own testing-guide.md split (unit = pure logic, int-spec = real Postgres behavior).

8. **Unit test: `TaxCoverageDetectionService.classify()` batch-accumulation equivalence**
   - **File**: `libs/core/src/orders/application/services/tax-coverage-detection.service.spec.ts`
   - **Action**: Extend the existing spec (already mocks `OrderRecordRepositoryPort`,
     `OrderLineItemRepositoryPort`, `IProductsService`) to:
     - Mock `findNetExcludedOrderCandidatesPage` to return **multiple pages** (e.g. 3 pages of a
       handful of candidates each, spanning all three tax-a/b/c outcomes and mixed pre-rollout /
       non-pre-rollout candidates) instead of one page.
     - Assert `classify()`'s final result is IDENTICAL (same category assignment, same
       `lineRates` per row, same row count per category) to what the pre-change single-unbounded-call
       shape would have produced for the same combined candidate set — i.e. run the same fixture
       data both as "one big unbounded array" (old shape, via a throwaway reference implementation
       or by asserting against previously-recorded expected output) and as "three paged batches"
       (new shape), and assert equality.
     - Assert `findNetExcludedOrderCandidatesPage` is called with the correct `cursor` argument on
       each successive call (i.e. mock returns `nextCursor` and the second call receives exactly
       that cursor), proving the loop actually pages rather than re-fetching from the start.
     - Assert the loop terminates when `nextCursor` is `null` or `page.items.length === 0`.
   - **Acceptance**: New/updated tests pass; the existing `candidates.length === netExcludedCount`-shaped
     assertions in this file are updated to sum across the mocked pages and still hold.
   - **Dependencies**: Phase 2 complete.

9. **Integration test: live-Postgres keyset pagination + end-to-end parity**
   - **File**: `apps/api/test/integration/orders/tax-coverage-net-excluded.int-spec.ts` (extend the
     existing file, mirroring its harness/fixture conventions) **or** a new sibling file
     `apps/api/test/integration/orders/tax-coverage-bounded-fetch.int-spec.ts` if the existing file
     is already large/focused enough that adding this scope would blur its purpose — decide based
     on reading the existing file's current size/focus at implementation time; default to extending
     in place unless it clearly warrants a split.
   - **Action**: Add cases that:
     - Seed more than one page's worth of net-excluded candidate orders (i.e. more than
       `NET_EXCLUDED_CANDIDATE_PAGE_SIZE`, or use a small test-only page size override if the
       method accepts one as a parameter per Step 2's signature — the plan's signature already
       exposes `limit` as an optional parameter specifically so tests can exercise pagination
       without seeding 500+ rows) and assert `findNetExcludedOrderCandidatesPage` called
       repeatedly with successive cursors returns the full seeded set with **no duplicates and no
       gaps** across pages, in the documented `placedAt DESC, internalOrderId DESC` order.
     - Assert **no single call** to `findNetExcludedOrderCandidatesPage` returns more than `limit`
       rows — the literal "bounded" acceptance criterion.
     - Run `TaxCoverageDetectionService.classify()` (or `getCategoryCounts`/`getAllCategoryPages`
       via the real HTTP `GET /analytics/coverage` route, following whichever pattern the existing
       int-spec file already uses) against a seeded set spanning multiple pages and assert the
       resulting counts/partition match hand-computed expected values — i.e. the AC-2 regression
       guard, now proven across a multi-page population rather than only a single-page one.
     - Keep (or update, if the API surface changed) the existing `candidates.length ===
       netExcludedCount` — or its new equivalent, e.g. `Object.values(classification).flat().length
       === netExcludedCount` — regression assertion this file already has.
   - **Acceptance**: New/updated int-spec cases pass against a real Testcontainers Postgres
     instance via `pnpm test:integration`.
   - **Dependencies**: Phase 1 + Phase 2 complete.

### Phase 4: Verification
**Goal**: Confirm no regression in the live `/analytics/coverage` endpoint and no architecture/lint
violations.

**Steps**:

10. **Type-check, lint, unit test**
    - **Action**: Run `pnpm type-check` and `pnpm lint` (which includes
      `scripts/check-cross-context-imports.mjs` and the service-interface / import-alias
      invariants) and `pnpm test` for the `orders` context scope. Per this session's established
      convention, integration tests (`pnpm test:integration`) and any full test-suite run are left
      for the user / CI rather than run here — see `feedback_dont_run_tests_locally`.
    - **Acceptance**: Clean type-check and lint; unit tests for the touched files pass.
    - **Dependencies**: Phases 1-3 complete.

11. **Manual sanity check of `AnalyticsCoverageController` callers** (read-only — no changes expected)
    - **File**: locate the controller consuming `ITaxCoverageDetectionService` (referenced in the
      service interface's doc comment as `AnalyticsCoverageController`) and confirm it calls
      `getAllCategoryPages`/`getCategoryCounts`/`getAllCategoryCountsByConnection` — all of which
      are unchanged public methods — with no direct reference to the now-removed
      `findNetExcludedOrderCandidates` or any repository method at all (it should only ever talk to
      the service interface, per the Repository Ports Pattern in `engineering-standards.md`).
    - **Acceptance**: Confirmed no controller-layer change is needed.
    - **Dependencies**: Phase 1-2 complete.

---

## 7. Alternatives Considered

### Alternative 1: `LIMIT/OFFSET` pagination instead of keyset pagination
- **Description**: Page the repository read with plain `.skip(offset).take(limit)` instead of a
  `(placedAt, internalOrderId)` keyset cursor.
- **Why Rejected**: `OFFSET` pagination re-scans and discards `offset` rows on every page — for a
  window with N candidates, total DB work across all pages is O(N²) in the worst case, which is
  strictly worse than the single unbounded scan being fixed here. Keyset pagination does O(N) total
  work (each row visited once across all pages), which is the actual fix. `OFFSET` pagination is
  also vulnerable to skipped/duplicated rows if a row is inserted/deleted between page fetches
  within one request (unlikely here given the short single-request lifetime, but keyset pagination
  has no such hazard at all, so there's no reason to accept it).
- **Trade-offs**: Keyset pagination requires carrying a cursor value (two columns) between calls
  instead of a single integer offset — marginally more type surface (Step 1's new types), but this
  is a small, one-time cost for a strictly better and already-conventional-in-this-codebase pattern
  (see `connection_cursors` / scan-offset family cited throughout `docs/architecture-overview.md`).

### Alternative 2: Bounded sample + separate SQL `COUNT` for aggregate figures (the issue's own second suggestion)
- **Description**: Fetch a bounded sample of candidates for the drill-down pages, and compute
  `netExcludedCount`-style aggregate figures via a separate `SELECT COUNT(*)` query, avoiding full
  materialization for the *count* path while still bounding the *page* path.
- **Why Rejected**: Tax A/B/C classification is **not** a property the database can compute — it
  depends on a live catalogue read (`IProductsService.getEffectiveTaxRate`) per unresolved line,
  which has no SQL equivalent (the class doc comment is explicit about this: "Not pushed into
  SQL"). A `COUNT(*) WHERE net_excluded` query can only ever answer "how many candidates exist",
  never "how many of them are `tax-a` vs `tax-b` vs `tax-c`" — that requires actually visiting every
  candidate's lines and consulting the catalogue. So this alternative cannot produce the exact
  per-category counts AC-2 requires without *also* visiting every row anyway, at which point it
  offers no advantage over Alternative 3 (chosen) while adding a second, redundant query path
  (a raw `COUNT` plus a bounded sample) that can drift from each other over time (sample says one
  partition, count says a different total). Rejected specifically because it cannot satisfy AC-2
  (byte-identical output) without degenerating into the chosen approach anyway.

### Alternative 3 (Chosen): Keyset-paginated bounded fetch + incremental in-application accumulation
- **Description**: As detailed in §6 — bound each SQL statement's row count via keyset pagination,
  and make the application-layer classification pass incremental (batch-then-append) rather than
  requiring the full unbounded array up front.
- **Why Chosen**: The only approach among those considered that (a) bounds every individual SQL
  statement's row count (the literal AC-1 wording), (b) produces byte-identical output to today for
  identical inputs (AC-2, provable because per-order classification is independent of any other
  order's state or of aggregate position — see Step 5's rationale), and (c) requires no new
  caching/staleness-tracking machinery, keeping the change scoped to exactly what #2834 asks for.
- **Trade-offs**: Total DB round-trips per request increase from 1 to `ceil(N / 500)` for a
  population of N candidates (typically 1 for any window under 500 net-excluded orders — the
  overwhelmingly common case per the persona scale already documented in the port's doc comment),
  and the catalogue-lookup deduplication window narrows from "whole request" to "one batch" (a
  product referenced by pre-rollout orders in two different batches is looked up twice instead of
  once — accepted per §5's Assumptions, since this issue's stated problem is the unbounded *base
  fetch*, not catalogue-read count, which #2826/#2827 already bounded separately).

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No new cross-context edge — `orders → products` (via `IProductsService`) is the sole
  cross-context dependency in this file, unchanged from today, per
  `docs/architecture-overview.md`'s documented `orders --> products` edge.
- ✅ Repository Ports Pattern preserved — the application service continues to depend only on
  `OrderRecordRepositoryPort` (an interface), never on `OrderRecordRepository` (the concrete
  infrastructure class). The port gains a new method; no consumer reaches past it.
- ✅ No framework dependency introduced into the domain layer — the new
  `NetExcludedOrderCandidateCursor`/`NetExcludedOrderCandidatePage` types are plain interfaces in
  `domain/types/`, with no TypeORM/NestJS import.

### Naming Conventions
- ✅ New port method name (`findNetExcludedOrderCandidatesPage`) follows the existing
  `find*Page`-suffix-for-paginated-read convention already used elsewhere in this same repository
  (e.g. `findCurrencyMismatchOrders` uses `.take()/.skip()` internally; the `Page` suffix
  distinguishes a keyset-cursor-based paginated read from an offset-based one, worth calling out
  explicitly in the method's own doc comment since this is a naming distinction unique to this
  method in the file).
- ✅ New types follow `*.types.ts` file-per-domain-vocabulary convention — added to the existing
  `coverage-detection.types.ts` file rather than a new file, matching how every other
  coverage-detection-adjacent type already lives there.

### Existing Patterns
- ✅ Keyset pagination via `(sortColumn, tiebreakColumn)` cursor mirrors the `connection_cursors` /
  scan-offset family's spirit (bounded batch, resumable via an explicit cursor value) without
  reusing that family's persisted-cursor machinery (correctly, since this is a single-request loop,
  not a multi-tick background sweep — see §4's `runBoundedSweep` comparison).
- ✅ Bounded-concurrency catalogue lookup pattern (`resolveRates`) is reused verbatim per batch,
  consistent with the existing #2826/#2827 precedent in the same file.

### Risks
- **Risk: `netExcludedAndNotCancelled` predicate or `applySalesAnalyticsScope` changes in a future
  PR without updating the new paginated method in lockstep.** Both `getDailyOrderAggregates` and
  the new `findNetExcludedOrderCandidatesPage` independently construct the identical
  `netExcludedAndNotCancelled` string today (already true pre-change — this is an existing,
  accepted duplication in the file, not something this plan introduces). Mitigation: the parity
  int-spec (Step 9) continues to assert `classification total === netExcludedCount` from
  `getDailyOrderAggregates`, which is exactly the guard that would catch a future drift between the
  two predicates.
- **Risk: keyset cursor correctness bug (off-by-one, duplicate/skipped row at a page boundary).**
  Mitigation: Step 9's int-spec explicitly seeds a population spanning multiple pages and asserts
  no duplicates/no gaps across the full paginated read — this is the primary test for exactly this
  risk class.
- **Risk: the `limit + 1` "peek" trick returns exactly `limit` rows with none extra when the true
  population size is a multiple of `limit`, requiring a correct "was there truly nothing more"
  check.** Mitigation: covered by the same int-spec — seed exactly `2 * limit` candidates (using
  the test-only `limit` override) and assert the loop terminates after exactly 2 pages, not 3.

### Edge Cases
- **Zero candidates**: `findNetExcludedOrderCandidatesPage` returns `{ items: [], nextCursor: null
  }` on the first call; `classify()`'s loop breaks immediately on `page.items.length === 0`,
  returning `{ 'tax-a': [], 'tax-b': [], 'tax-c': [] }` — identical to today's behavior for an
  empty candidate set.
- **Exactly one page's worth of candidates**: first call returns all items with `nextCursor: null`
  (since `rows.length === limit`, not `limit + 1`); loop runs once, matching today's single-call
  behavior for small windows (the common case).
- **All candidates share the same `placedAt` value** (e.g. a burst of orders placed in the same
  second): the `internalOrderId DESC` tiebreak in both the `ORDER BY` and the cursor `WHERE` clause
  ensures a stable, gap-free, duplicate-free page boundary even with duplicate `placedAt` values —
  explicitly exercised by an int-spec case seeding several same-`placedAt` rows spanning a page
  boundary.

### Backward Compatibility
- ✅ No breaking change to any public API — `ITaxCoverageDetectionService`'s four public methods
  keep their exact signatures and return types; `GET /analytics/coverage`'s response is unchanged
  for identical inputs (AC-2). The only removed symbol
  (`OrderRecordRepositoryPort.findNetExcludedOrderCandidates`) has exactly one caller in the
  codebase (verified via Phase 1 Step 3's plan to grep before removal), so its removal is safe
  within this repository and carries no external/plugin contract risk (this port is not part of
  `@openlinker/core`'s plugin-facing barrel surface for `orders` in a way that a third-party
  adapter would implement — it's an internal repository port, not a capability port).

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/core/src/orders/application/services/tax-coverage-detection.service.spec.ts` — extended
  per Phase 3 Step 8: multi-page mock-driven equivalence test, cursor-propagation assertion,
  loop-termination assertion. All EXISTING assertions in this file continue to pass unmodified in
  their logical intent (values may need updating if the mock setup shape changes from
  single-array-return to paginated-return, but the *assertions themselves* — which categories which
  fixture orders land in — must not change).

### Integration Tests
- `apps/api/test/integration/orders/tax-coverage-net-excluded.int-spec.ts` (extended) — real
  Postgres, multi-page seeded population, asserts: no single page exceeds the configured limit; no
  duplicate/skipped rows across the full paginated traversal; `classify()`/`getCategoryCounts()`
  output is byte-identical to hand-computed expected values across a population spanning multiple
  pages; the `netExcludedCount` parity guard holds.
- **File**: `apps/api/test/integration/orders/tax-coverage-net-excluded.int-spec.ts` — see Phase 3
  Step 9 for the "extend vs. new sibling file" decision to make at implementation time.

### Mocking Strategy
- Unit tests mock `OrderRecordRepositoryPort`, `OrderLineItemRepositoryPort`, and
  `IProductsService` exactly as the existing spec already does — no new mocking pattern introduced.
  The only change is that the repository mock now needs to simulate multi-call pagination (return
  different values across successive calls, keyed by the `cursor` argument it receives) rather than
  a single-call unbounded return.
- Integration tests use the real Postgres Testcontainers harness (`getTestHarness()`) and real
  repository implementations, per this repo's existing int-spec convention — no adapter is mocked
  at this layer except `IProductsService`'s catalogue lookup where the existing int-spec already
  stubs/seeds product tax-rate data (follow whatever pattern `tax-coverage-net-excluded.int-spec.ts`
  already uses for that).

### Acceptance Criteria (mirroring #2834's own AC list)
- [ ] `findNetExcludedOrderCandidatesPage`'s per-call cost (rows returned) is bounded by
      `limit`/`NET_EXCLUDED_CANDIDATE_PAGE_SIZE` — proven by an int-spec assertion that no single
      call returns more rows than requested.
- [ ] `TaxCoverageDetectionService.classify()` no longer materializes the full unbounded candidate
      set before producing any classification work — proven by the batch-then-append shape and the
      multi-page unit test in Step 8.
- [ ] `GET /analytics/coverage` response (category counts, category pages) is unchanged for
      identical inputs — no regression in which orders land in `tax-a`/`tax-b`/`tax-c` — proven by
      the parity int-spec in Step 9, run against a population spanning multiple pages (a stronger
      guarantee than the pre-#2834 single-page-only test coverage).
- [ ] Tests added/updated for the new bounded/incremental shape, including a live-Postgres int-spec
      mirroring `tax-coverage-net-excluded.int-spec.ts`'s existing conventions.
- [ ] No architecture boundary violations — `pnpm lint`'s `check-cross-context-imports.mjs` and
      `check-service-interfaces.mjs` invariants pass unchanged.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (domain port + types, application accumulation logic,
      infrastructure query implementation — each in its correct layer)
- [x] Respects CORE vs Integration boundaries (no integration/adapter code touched; the one
      cross-context call, `orders → products`, is unchanged)
- [x] Uses existing patterns (keyset-pagination spirit of the `connection_cursors`/scan-offset
      family; bounded-concurrency precedent already in this exact file from #2826/#2827)
- [x] Idempotency considered — this is a pure read path with no side effects; repeated calls with
      the same cursor return the same page (no mutation, no ordering-dependent side effect)
- [ ] Event-driven patterns used where applicable — N/A, no event involved in this read path
- [x] Rate limits & retries addressed — N/A (internal DB read, not an external API call); the
      existing `RATE_LOOKUP_CONCURRENCY` bound on the one external-ish call
      (`IProductsService.getEffectiveTaxRate`) is unchanged and still applied per batch
- [x] Error handling comprehensive — no new error paths introduced; existing `resolveRates`
      catch-and-log-as-`null` behavior (treat catalogue-read failure as `'not-checked'`) is
      unchanged and still applies per batch
- [x] Testing strategy complete (unit + int-spec, parity + boundedness both explicitly covered)
- [x] Naming conventions followed (`*Page` suffix for keyset-paginated read, `*.types.ts` placement,
      `*Cursor`/`*Page` type names)
- [x] File structure matches standards (domain/application/infrastructure split preserved, no new
      files beyond the optional int-spec split decision left open in Step 9)
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Session note — local-only scope

Per explicit instruction for this session ("only local", "dont commit and push and comment"), this
plan is saved to disk only. **No worktree was created, no branch was made, no commit was created, no
push occurred, and no comment was posted to issue #2834.** Implementation (if/when requested) should
also stay uncommitted in the working tree for the user to review and commit themselves, consistent
with this session's established working convention.

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md) — § 4. Orders, § Cross-context dependencies in core
- [Engineering Standards](../engineering-standards.md) — Repository Ports Pattern, Symbol DI Token
  Re-export Convention
- [Testing Guide](../testing-guide.md) — unit vs. integration test split, Testcontainers pattern
- [Code Review Guide](../code-review-guide.md)
- Issue [#2826](https://github.com/openlinker-project/openlinker/issues/2826) (prior work: N+1 →
  batched line-item read + bounded catalogue-lookup concurrency)
- PR #2827 (closed two of #2826's three ACs; this issue, #2834, is the split-out third)
