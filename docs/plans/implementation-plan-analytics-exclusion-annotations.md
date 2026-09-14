# Implementation Plan: Analytics — Exclusion Annotations on KPI/Channel/Product Surfaces

**Date**: 2026-08-31
**Status**: Draft/Ready for Review
**Estimated Effort**: 1–1.5 days (Task 8.1 + Channel half of 8.2); Product half of 8.2 is **blocked**, see §5.

---

## 1. Task Summary

**Objective**: Epic #2452 Phase 8 (mini-epic #2479, sub-tasks #2480 and #2481) — make the exclusion
counts Phase 7's Data Coverage panel already surfaces *centrally* also visible *locally*, on the
specific KPI card / channel row / product row that is under-counted by an open coverage category,
each annotation linking back to that category's detail modal.

**Context**: Phase 7 (merged, #2672) shipped the "Data Coverage" panel — one row per category
(currency, tax A/B/C, product-matching) with a paginated detail modal each. An operator scanning the
KPI strip or the by-channel table today has no signal that a specific number is under-counted; they
would have to separately notice the Data Coverage panel and mentally connect "23 orders excluded —
currency" to "the Revenue card's GMV figure is short by some of those 23." This phase closes that
gap for the KPI strip (Task 8.1) and starts it for the Channel/Product tables (Task 8.2), with an
explicit, honest stop where the data does not yet support a correct per-row annotation (§5).

**Classification**: Frontend (feature components only — no backend, no CORE, no migration).

---

## 2. Scope & Non-Goals

### In Scope

- **Task 8.1**: `GapMark` on the KPI strip's Revenue/Order-value cards gets a real, category-specific
  title (not the current generic "not yet stamped" copy) and becomes clickable, opening the matching
  Phase 7 `CoverageDetailDialog` for the `'currency'` category. A new `GapMark` is added next to the
  Net Sales card's label when `headline.netExcludedCount > 0`, opening the relevant tax category's
  modal.
- **Task 8.2 (Channel half only)**: New `AnalyticsExclusionNote` component rendered per row in
  `channel-sales-table.tsx`, cross-referencing each open category's full affected-order list (not the
  Phase 7 aggregate's 10-id sample) against the row's own `sourceConnectionId`, opening the matching
  modal on click.
- Page-level state lift so `AnalyticsDataCoveragePanel`'s "which category's modal is open" becomes
  externally triggerable from the KPI strip and the channel table, while staying self-contained when
  nothing external asks it to open (uncontrolled-by-default, controllable pattern).

### Out of Scope (this plan)

- **Task 8.2 (Product half)**: `product-sales-table.tsx` wiring. `TopProductRow` is keyed by
  `productId`; none of Phase 7's three paginated coverage-order endpoints
  (`CurrencyMismatchOrderDto` / `TaxCoverageOrderDto` / `ProductMatchingOrderDto`) carry a
  `productId`, SKU, or any line-item field — only `internalOrderId` + `sourceConnectionId` (+ a
  currency/date field each). There is no correct client-side cross-reference possible from an order
  id to a product id without a line-item read. Approximating this (e.g. "an excluded order touched
  *some* product in this channel, so annotate every product row for that channel") would reproduce
  exactly the mockup's own found bug class (#2481 AC 1: "a row's `.excl-note` category must be
  provably correct against its own underlying order data") — so this plan does **not** implement it.
  See §5 for the flagged backend gap and the two remediation options.
- Backend changes of any kind (no new endpoint, no DTO field addition — those belong to whichever
  future issue closes the gap in §5).
- Re-implementing `CoverageDetailDialog` or any of the five existing detail-row renderers — this plan
  reuses `AnalyticsDataCoveragePanel`'s existing dialogs verbatim via the state lift.
- Any change to `AnalyticsNeedsAttention` (a distinct component, no Phase 7 coverage dependency).

### Constraints

- Working directly on `phase/2452-p8-fe-exclusion-annotations`, branched from
  `epic/2452-analytics-currency-coverage` (Phase 7 already merged in). No commit/push in this
  session — plan-only, per explicit operator instruction.
- Must not introduce a second copy of Phase 7's coverage-category copy strings
  (`deriveCoverageRowCopy` in `data-coverage-copy.lib.ts` is the single source — reused, not
  duplicated).
- Must not add a general-purpose global store (`docs/frontend-architecture.md` § Global Store
  Policy) — the state lift is a plain `useState` at `AnalyticsPage`, passed down as props.

---

## 3. Architecture Mapping

**Target Layer**: Frontend only — `apps/web/src/features/analytics/` (feature components + one new
component) and `apps/web/src/pages/analytics/analytics-page.tsx` (state ownership).

**Capabilities Involved**: None (no backend port/capability — this is presentation wiring over
already-shipped Phase 4/7 reads).

**Existing Services Reused**:
- `useAnalyticsCoverageQuery` (Phase 7) — already fetched by `AnalyticsDataCoveragePanel`; the page
  will fetch it too (same query key ⇒ same cache entry, no extra request — the established pattern
  `salesFilters`/`coverageFilters` already use at the page level, see `analytics-page.tsx`'s own doc
  comment on `salesFilters`).
- `useCurrencyMismatchOrdersQuery` / `useTaxCoverageOrdersQuery` (Phase 7) — reused by
  `ChannelSalesTable` to fetch the full per-category order list for the cross-reference (see §6 Phase
  2 for why `useMatchingCoverageOrdersQuery` is *not* needed here: product-matching orders have no
  channel data gap of their own to annotate on the channel table — a `source_deleted`/
  `awaiting_mapping` order already fails to resolve to *any* channel-scoped total, so it cannot be
  under-counting a channel row by definition. Confirmed against `OrderRecordRepository`'s health
  semantics before scoping this out — not assumed.)
- `deriveCoverageRowCopy` (`data-coverage-copy.lib.ts`, Phase 7) — supplies the human-language
  headline/modal-title strings so the new `GapMark`/`AnalyticsExclusionNote` never invents a second
  copy of "23 orders counted in an outdated currency."
- `CoverageDetailDialog` + the five renderers already in `AnalyticsDataCoveragePanel` — no new dialog
  is built; the existing ones are lifted to accept externally-driven `open`/`onOpenChange`.
- `GapMark` (already accessible per #2480's own problem statement — verified below, §4).

**New Components Required**:
- `apps/web/src/features/analytics/components/analytics-exclusion-note.tsx` (+`.test.tsx`) — per
  #2481's own file-path spec.
- No new hooks, no new API modules, no new types files beyond what's needed to export
  `CoverageCategory` from the barrel (already defined in `analytics-coverage.types.ts`, just not
  re-exported yet).

**Core vs Integration Justification**: N/A — pure frontend, no CORE/Integration boundary crossed.

---

## 4. External / Domain Research

### Internal Patterns (codebase search results)

- **`gap-mark.tsx` is already accessible.** Read in full: it already renders
  `<span className="gap-mark" role="img" aria-label={title} title={title}>`. #2480's premise ("the
  mockup's cold audit found it missing a `title` attribute") is **already fixed on `main`**
  (independently of this epic, per the file's own #2120-review comment) — confirmed per #2480's own
  "verify against `main` before implementing" instruction. **Task 8.1 is wiring-only**, exactly the
  assumption #2480 names as the likely outcome.
- **`GapMark` is not currently clickable anywhere.** Every existing usage
  (`analytics-kpi-strip.tsx`, `analytics-kpi-card.tsx`) renders it as an inert `<span>` — a tooltip,
  never an affordance. Making a `GapMark` open a modal is new behavior, not present in the codebase
  today. Two ways to add it without changing `GapMark` itself (kept a display-only leaf, per its own
  single-responsibility doc comment):
  1. Wrap the whole `<GapMark>` in a `<button type="button">` at each call site.
  2. Give `GapMark` an optional `onActivate?: () => void` prop, rendering itself as a `<button>` when
     present and a plain `<span>` otherwise.
  Option 2 is chosen (§6) — it keeps the click affordance and its own focus/keyboard semantics in one
  place (`GapMark` itself) rather than duplicated at every call site that wants it, and every call
  site that doesn't pass `onActivate` is byte-identical to today.
- **`AnalyticsKpiStrip` already computes exactly the two booleans this task needs**:
  `stampedGapVisible = headline.unconvertedCount > 0` (currency) and
  `netExcludedVisible = headline.netExcludedCount > 0` (tax). No new computation — only the *title*
  and the *click handler* change from generic to category-specific.
- **`AnalyticsDataCoveragePanel`'s `openCategory` state is 100% local** (`useState<CoverageCategory |
  null>`), never exposed to its parent. `analytics-page.tsx` renders it with only `filters` and
  `onOpenSettings` props. This is the one real design decision in this plan (§6 Phase 1).
- **`ChannelSalesTable` / `TopProductRow` row shapes carry no order-id list** (`ChannelSalesAnalyticsDto`
  is keyed by `sourceConnectionId` alone; `TopProductRow` by `productId` alone) — confirmed by reading
  both files' full header comments and the imported types. This is what makes the Channel half
  tractable (an order carries its own `sourceConnectionId`, so a cross-reference on that field is
  exact) and the Product half currently impossible (an order carries no product/SKU field anywhere in
  the coverage-detection output) — see §5.
- **Phase 7's three order-list endpoints are already unbounded pagination, not the 10-id sample.**
  `GET /analytics/coverage` (the aggregate `useAnalyticsCoverageQuery` reads) caps `sampleOrderIds` at
  10; the three sibling endpoints (`.../currency/orders`, `.../tax/orders`, `.../matching/orders`) page
  the *real, full* affected set with `limit`/`offset`. The Channel-table cross-reference must use the
  latter (page through the full set for the current date range), never the former — using the 10-id
  sample would under-report annotations on any range with more than 10 affected orders, which is
  itself an instance of the exact bug class #2481's AC 2 guards against ("no row belonging to an open
  category's affected set is missing its annotation").

---

## 5. Flagged Backend Gap — Product-table half of #2481 (does not block this plan; blocks a future one)

Per #2481's own **Assumptions** section: *"if the affected-order lists from Phase 4 don't carry
enough identifying info (SKU/channel id) to cross-reference cleanly, that's a signal Phase 4's
detector output needs a small shape addition; flag it back rather than approximating the match."*

That is exactly the state found. `CurrencyMismatchOrderDto`, `TaxCoverageOrderDto`, and
`ProductMatchingOrderDto` all carry `internalOrderId` + `sourceConnectionId` and nothing product- or
line-item-shaped. `order_line_items` (the #1985 read-model table that *does* carry per-line product
identity — see `docs/architecture-overview.md` § Order analytics read model) is never joined by any
Phase 4/7 detection query.

**Two remediation paths for whoever picks this up** (not decided here — a product/backend call, out
of this plan's scope):
1. Add an optional `productIds: string[]` (or a separate `/orders/:id/line-items` lookup) to each of
   the three coverage-order DTOs, joining `order_line_items` in the detection query. Cheapest at read
   time, but widens three response shapes for a feature only the Product table needs.
2. A dedicated `GET /analytics/coverage/{category}/products` aggregate endpoint, mirroring the
   existing per-channel `revenueShare` breakdown shape in `GET /analytics/sales` — answers "which
   products are affected" directly rather than requiring the FE to intersect two large order lists.

Recommendation for the follow-up issue: option 2. It avoids widening the order-list DTOs (which the
Channel-table cross-reference and the detail modals both already consume unmodified) and gives a
bounded response instead of a "fetch every affected order, then intersect against every product's own
order set client-side" O(orders × products) computation the FE would otherwise have to run per
render.

**This plan explicitly does not touch `product-sales-table.tsx`.** Task 8.2's acceptance criteria are
therefore only *partially* satisfiable by this plan — see §9.

---

## 6. Proposed Implementation Plan

### Phase 1: Page-level coverage state + controllable `AnalyticsDataCoveragePanel`

**Goal**: Let the KPI strip and the channel table each open a specific category's detail modal
without duplicating `CoverageDetailDialog` or its five row renderers.

**Steps**:

1. **Lift `openCategory`/`offset` state to `AnalyticsPage`, `AnalyticsDataCoveragePanel` becomes
   controllable-with-uncontrolled-fallback.**
   - **File**: `apps/web/src/pages/analytics/analytics-page.tsx`
   - **Action**: Add `const [openCoverageCategory, setOpenCoverageCategory] = useState<CoverageCategory
     | null>(null);`. Fetch `const coverageQuery = useAnalyticsCoverageQuery(coverageFilters);` at the
     page level (same query key as the one `AnalyticsDataCoveragePanel` already issues internally — one
     network request, TanStack Query dedupes by key, same pattern already documented for
     `salesQuery`/`AnalyticsKpiStrip`). Pass `openCategory={openCoverageCategory}` and
     `onOpenCategoryChange={setOpenCoverageCategory}` into `<AnalyticsDataCoveragePanel>`. Pass
     `coverage={coverageQuery.data}` and `onOpenCategory={setOpenCoverageCategory}` into
     `<AnalyticsKpiStrip>` and `<ChannelSalesTable>`.
   - **Acceptance**: Clicking a Data Coverage panel row still opens its own modal exactly as before
     (regression guard — Phase 7's existing test suite for `analytics-data-coverage-panel.test.tsx`
     must stay green unmodified, since the component's *default* behavior is unchanged).
   - **Dependencies**: None — this is the first step.

2. **`AnalyticsDataCoveragePanel` accepts optional `openCategory` / `onOpenCategoryChange` props.**
   - **File**: `apps/web/src/features/analytics/components/analytics-data-coverage-panel.tsx`
   - **Action**: Add two optional props to `AnalyticsDataCoveragePanelProps`. Replace the internal
     `const [openCategory, setOpenCategory] = useState<CoverageCategory | null>(null);` with the
     standard controllable-component pattern:
     ```tsx
     const [internalOpenCategory, setInternalOpenCategory] = useState<CoverageCategory | null>(null);
     const openCategory = props.openCategory ?? internalOpenCategory;
     const setOpenCategory = props.onOpenCategoryChange ?? setInternalOpenCategory;
     ```
     Every existing internal call site (`openDetail`, `closeDetail`, the row `onOpenDetail` handlers)
     is unchanged — they already only call `setOpenCategory`/`setOffset`, which now transparently
     routes to the parent when one is supplied. `offset` stays **always internal** (never
     lifted) — nothing outside this component needs to control pagination, only *which* category's
     modal is open.
   - **Acceptance**: With no props supplied (the panel's own self-render), behavior is byte-identical
     to today — existing tests pass with zero changes. With `openCategory`/`onOpenCategoryChange`
     supplied, an external `setOpenCoverageCategory('currency')` call opens the currency modal exactly
     as clicking the panel's own currency row would.
   - **Dependencies**: Step 1.

3. **Export `CoverageCategory` from the feature barrel.**
   - **File**: `apps/web/src/features/analytics/index.ts`
   - **Action**: Add `CoverageCategory` to the existing `export type { AnalyticsCoverage,
     AnalyticsCoverageFilters, CoverageCategoryRow } from './api/analytics-coverage.types';` line
     (already the right file — just add the one type name). `AnalyticsPage` needs it for the
     `useState<CoverageCategory | null>` declaration.
   - **Acceptance**: `pnpm --filter @openlinker/web type-check` passes with the page importing
     `CoverageCategory` from the barrel, not a deep path.
   - **Dependencies**: None (independent of steps 1–2, can land in the same commit).

### Phase 2: Task 8.1 — `GapMark` wiring on the KPI strip

**Goal**: Every KPI card affected by an open coverage category shows a `GapMark` whose title names
the real category and whose click opens that category's modal.

**Steps**:

4. **`GapMark` grows an optional `onActivate` prop.**
   - **File**: `apps/web/src/features/analytics/components/gap-mark.tsx`
   - **Action**: Add `onActivate?: () => void` to the props interface. When present, render
     `<button type="button" className="gap-mark gap-mark--clickable" aria-label={title} title={title}
     onClick={onActivate}>` (drop `role="img"` — a genuinely interactive element gets its accessible
     name from its own content/`aria-label`, `role="img"` was for the inert-span case only). When
     absent, render exactly the current `<span role="img" …>` markup unchanged.
   - **Acceptance**: Existing `gap-mark`-adjacent tests (none exist standalone today — it's exercised
     via `analytics-kpi-strip.test.tsx`) keep passing with no `onActivate` passed at any *existing*
     call site (Units/Cancellations/Returns cards' `GapMark`s stay inert spans). New test:
     `gap-mark.test.tsx` — asserts inert-span rendering with no prop, button rendering + `onClick`
     firing `onActivate` with the prop, and that `aria-label`/`title` both still carry the reason text
     in the clickable form.
   - **Dependencies**: None.

5. **`.gap-mark--clickable` CSS.**
   - **File**: `apps/web/src/index.css`
   - **Action**: Add a bounded section under the existing analytics section (`/* ── GapMark clickable
     variant (#2480) ── */`) resetting button chrome (`background: none; border: none; padding: 0;
     font: inherit; cursor: pointer;`) and adding `:focus-visible { box-shadow: var(--shadow-focus); }`
     per the accessibility rule in `docs/frontend-ui-style-guide.md` (never remove focus rings). No
     new design token needed — reuses `--shadow-focus`, already in `tokens.ts`.
   - **Acceptance**: `pnpm lint`'s design-token drift check stays green (no new `--*` custom property
     introduced).
   - **Dependencies**: Step 4.

6. **Wire the Revenue card's GMV qualifier + the Order-value card's Average qualifier to the
   currency category.**
   - **File**: `apps/web/src/features/analytics/components/analytics-kpi-strip.tsx`
   - **Action**: `AnalyticsKpiStrip` gains two new props: `coverage: AnalyticsCoverage | undefined`
     and `onOpenCategory: (category: CoverageCategory) => void`. Resolve the currency row once:
     `const currencyRow = coverage?.categories.find((row) => row.category === 'currency');`. Replace
     the two `<GapMark title={STAMPED_GAP} />` call sites (GMV qualifier, Average qualifier) with a
     title sourced from `deriveCoverageRowCopy(currencyRow ?? emptyCurrencyRow).sub` **only when**
     `currencyRow` exists and `currencyRow.affectedCount > 0` — otherwise keep rendering the existing
     generic `STAMPED_GAP` text (a `stampedGapVisible` state the coverage query hasn't loaded yet, or
     has zero-count for some unrelated reason, must not regress to a blank/wrong title). Pass
     `onActivate={() => onOpenCategory('currency')}` in the affected-category branch only (the generic
     fallback stays inert, matching current behavior — nothing to open if there's no coverage data to
     open).
   - **Acceptance**: New tests in `analytics-kpi-strip.test.tsx` — (a) with `coverage` reporting
     `currency` `affectedCount: 23`, the GMV `GapMark`'s accessible name contains the currency
     category's real copy (not `STAMPED_GAP`'s literal text) and clicking it calls `onOpenCategory`
     with `'currency'`; (b) with `coverage` undefined (still loading) or the currency row at
     `affectedCount: 0`, the qualifier renders exactly as it does on `main` today (`STAMPED_GAP`, inert)
     — a regression guard for the "not missing, not wrong" pairing #2481's ACs establish for the sibling
     task, applied here too since the same failure class applies to any of these annotations.
   - **Dependencies**: Steps 3, 4.

7. **Add a `GapMark` to the Net Sales card when `netExcludedVisible`.**
   - **File**: same as step 6.
   - **Action**: The Revenue card's `metric` prop (currently a bare `'Net sales'` string) becomes
     conditional, mirroring the existing Order-value card's `Average <GapMark …>` pattern exactly:
     ```tsx
     metric={
       netExcludedVisible ? (
         <>
           Net sales <GapMark title={taxCoverageCopyFor(headline)} onActivate={() => onOpenCategory(taxCategoryFor(headline))} />
         </>
       ) : (
         'Net sales'
       )
     }
     ```
     `taxCategoryFor`/the category resolution: `headline.netExcludedCount` does not itself say *which*
     tax sub-category (A/B/C) caused the exclusion — that distinction only exists in the coverage
     query's per-category `affectedCount`s. Resolve by finding the tax category among
     `coverage.categories` with the largest `affectedCount` (tax-a/b/c are mutually exclusive
     partitions of the tax exclusion set per `TaxCoverageDetectionService`'s own classification pass —
     confirmed via `docs/architecture-overview.md` § Net Sales, VAT-exclusive: "a stored-rate
     requirement" — each order lands in exactly one category), falling back to `'tax-a'` (the
     remediable one, so a false attribution errs toward the operator being offered a fix rather than
     the dead-end category) if all three read zero (should not happen when `netExcludedVisible` is
     true, but a fallback avoids a runtime crash on an unexpected zero-everywhere state).
   - **Acceptance**: Test — `netExcludedCount > 0` with `tax-b` carrying the coverage query's largest
     `affectedCount` among the three tax categories opens the `tax-b` modal on click; `netExcludedCount
     === 0` renders the plain `'Net sales'` string, unchanged from today.
   - **Dependencies**: Step 6 (same file, same `coverage` prop plumbing).

8. **`AnalyticsPage` passes the new props through.**
   - **File**: `apps/web/src/pages/analytics/analytics-page.tsx`
   - **Action**: `<AnalyticsKpiStrip filters={salesFilters} connections={trustQuery.data.connections}
     coverage={coverageQuery.data} onOpenCategory={setOpenCoverageCategory} />`.
   - **Acceptance**: Manual verification against the running app (`pnpm run dev` in `apps/web`) —
     seed/observe a range with a nonzero `unconvertedCount`, confirm the GMV `GapMark`'s tooltip now
     reads the category copy and clicking it opens the currency detail modal.
   - **Dependencies**: Steps 1, 6, 7.

### Phase 3: Task 8.2 (Channel half) — `AnalyticsExclusionNote`

**Goal**: Every `ChannelSalesTable` row belonging to an open category's affected set gets exactly one
correct `.excl-note`; no row gets zero when it should have one, no row gets the wrong category.

**Steps**:

9. **`AnalyticsExclusionNote` component.**
   - **File**: `apps/web/src/features/analytics/components/analytics-exclusion-note.tsx` (+
     `.test.tsx`)
   - **Action**: A small, presentational component:
     ```tsx
     interface AnalyticsExclusionNoteProps {
       category: CoverageCategory;
       affectedCount: number;
       onOpenCategory: (category: CoverageCategory) => void;
     }
     ```
     Renders one `.excl-note` line reusing `deriveCoverageRowCopy(...)`'s `headline`/`sub` text for the
     given category (never a hand-written string — the same single-source-of-copy rule Phase 7
     established), as a `<button type="button">` (not a bare span — this is a real affordance,
     `docs/frontend-ui-style-guide.md` § Buttons: "If an element submits, confirms, or mutates state,
     it should be a button" — opening a dialog counts) calling `onOpenCategory(category)`.
     `affectedCount` is only used to pick singular/plural copy via the existing `deriveCoverageRowCopy`
     — the component itself does not compute counts (that's the caller's job, step 10).
   - **Acceptance**: Unit test renders the component for each of the five `CoverageCategory` values,
     asserts the rendered text matches `deriveCoverageRowCopy(category, …).headline` exactly (never a
     duplicated literal), and asserts `onOpenCategory` fires with the right category on click.
   - **Dependencies**: None (pure component, can be built in parallel with Phase 1).

10. **Cross-reference wiring in `ChannelSalesTable`.**
    - **File**: `apps/web/src/features/analytics/components/channel-sales-table.tsx`
    - **Action**: `ChannelSalesTable` gains `onOpenCategory: (category: CoverageCategory) => void`.
      For each open coverage category (`coverage.categories.filter((row) => row.affectedCount > 0)`,
      **excluding `'product-matching'`** per §3's confirmed reasoning), fetch the *full* affected-order
      list for the table's own `filters` range via the matching hook
      (`useCurrencyMismatchOrdersQuery`/`useTaxCoverageOrdersQuery`, called once per open category, not
      per row — table-level, mirroring how the table already calls `useSalesAnalyticsQuery` once for
      itself). Because these hooks are paginated (`limit`/`offset`), and this cross-reference needs the
      *complete* set (not one page), request the largest allowed `limit` (100, the DTOs' own `@Max(100)`
      ceiling) and, if `total > limit`, page through the remainder — bounded by the fact that this is a
      per-viewer, per-page-load read, not a hot path, and a deployment with more than a few hundred
      simultaneously-excluded orders in one category is itself the signal that the *remediation*
      (Recalculate now / Sync the catalog now) is overdue, not a performance target this table needs to
      protect against. Group the fetched order rows by `sourceConnectionId` into a
      `Map<string, Map<CoverageCategory, number>>` (`connectionId -> category -> count`), computed once
      per render via `useMemo` keyed on the fetched pages + `filters`. Each `ChannelRow`, when its own
      `sourceConnectionId` has a nonzero count in that map for some category, renders one
      `<AnalyticsExclusionNote category={…} affectedCount={…} onOpenCategory={onOpenCategory} />` per
      affected category (a channel can legitimately appear in more than one open category — e.g. some
      orders un-stamped AND some un-rated — both notes render, never merged into one ambiguous line).
    - **Acceptance**: The exact two regression guards #2481's ACs name, written as tests against a
      fixture with two categories both present in the dataset and two channels, one belonging to each:
      (a) each row's `.excl-note` names the category that fixture's own orders actually belong to
      (never the other channel's category); (b) a channel with an order in the currency category's
      affected set gets its note even when that same channel's own row otherwise reads a healthy,
      fully-covered total (i.e. the note is driven by the fetched order list, never inferred from the
      row's own aggregate figures reading "off").
    - **Dependencies**: Steps 3, 9.

11. **`AnalyticsPage` passes `onOpenCategory` to `ChannelSalesTable`.**
    - **File**: `apps/web/src/pages/analytics/analytics-page.tsx`
    - **Action**: `<ChannelSalesTable filters={salesFilters} onOpenCategory={setOpenCoverageCategory}
      />`.
    - **Acceptance**: Manual verification — a channel row with excluded orders shows its note; clicking
      it opens the same modal the Data Coverage panel's own row for that category would.
    - **Dependencies**: Steps 1, 10.

### Implementation Details

**New Components**:
- `analytics-exclusion-note.tsx` (+ test) — the only new file. No new hooks, no new API modules, no
  new types file (reuses `CoverageCategory` from the already-shipped `analytics-coverage.types.ts`).

**Configuration Changes**: None.

**Database Migrations**: None.

**Events**: None emitted/consumed (no backend involvement).

**Error Handling**: The channel table's per-category order-list fetches use the existing hooks'
standard TanStack Query error surfacing — a failed fetch for one category's cross-reference degrades
to "no notes for that category this render" (logged via the query's own `error` state, not
swallowed silently) rather than blocking the whole table, matching the codebase's existing pattern of
independent, non-blocking sibling queries (`analytics-page.tsx`'s own doc comment: "a channel-table
failure can never blank the KPI strip").

---

## 7. Alternatives Considered

### Alternative 1: A `CoverageContext` / small Zustand-style provider instead of prop-drilling

- **Description**: Wrap `/analytics` in a React context carrying `openCategory`/`setOpenCategory`,
  consumed via a hook from any descendant, instead of passing `coverage`/`onOpenCategory` props down
  three levels.
- **Why Rejected**: `docs/frontend-architecture.md` § Global Store Policy — a store is justified only
  when state "must be shared across distant branches" and "must survive route transitions." This
  state is neither: it lives entirely within one page's render tree, three components deep, and
  resets on navigation away from `/analytics` (correctly — nothing should remember which modal was
  open on a page nobody's viewing). Plain prop-drilling at this depth is exactly what the state
  ownership rules prescribe over inventing a context.
- **Trade-offs**: Context would remove the need to thread `coverage`/`onOpenCategory` through
  `AnalyticsKpiStrip`'s and `ChannelSalesTable`'s prop lists, but at the cost of an untyped
  "any descendant can read/write this" surface for state that only three call sites actually need —
  a worse trade for a codebase whose own convention is explicit prop plumbing over ambient state.

### Alternative 2: Approximate the Product-table half by annotating every product row for an affected channel

- **Description**: Since `TaxCoverageOrderDto`/etc. carry `sourceConnectionId`, and
  `TopProductRow.channels` is keyed by connection id too, annotate *every* product row that has any
  sales on a channel with an open category — "this channel has excluded orders, so this product's
  channel-column figure might be affected."
- **Why Rejected**: This is precisely the approximation #2481's own Assumptions section warns against
  ("flag it back rather than approximating the match") and is provably wrong in the common case — a
  channel with 5,000 orders and 3 currency-excluded ones would falsely flag every one of its hundreds
  of product rows, when only the products those 3 specific orders actually contain are truly
  under-counted. Shipping a known-false-positive-generating feature fails #2481's AC 1 outright
  ("provably correct against its own underlying order data").

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Pure frontend change — no CORE/Integration boundary touched, no port/adapter involved.
- ✅ State ownership: server state (`coverage`, order lists) via TanStack Query; "which modal is
  open" is local UI state lifted to the nearest common ancestor (`AnalyticsPage`), never a global
  store. Matches `docs/frontend-architecture.md` § State Management exactly.

### Naming Conventions
- ✅ `analytics-exclusion-note.tsx` — kebab-case file, `AnalyticsExclusionNote` PascalCase export,
  matching every existing primitive in `features/analytics/components/`.
- ✅ `.excl-note`/`.gap-mark--clickable` CSS class naming — `component-name`/`component-name--modifier`,
  per `docs/frontend-ui-style-guide.md` § CSS Implementation Standard.

### Existing Patterns
- ✅ Controllable-with-uncontrolled-fallback prop pattern (`value ?? internalState`,
  `onChange ?? setInternalState`) — a standard React idiom, not a new abstraction invented for this
  plan.
- ✅ Reuses `deriveCoverageRowCopy` as the single source of category copy (Phase 7's own rule,
  restated in `data-coverage-copy.lib.ts`'s header) rather than hand-writing a second copy of any
  category's headline/sub text.

### Risks
- **The tax-category attribution in step 7 (Net Sales `GapMark`) is a heuristic** ("largest
  `affectedCount` among tax-a/b/c"), not a field the backend actually stamps onto `headline` itself.
  Mitigation: documented inline at the call site with the classification-partition reasoning; a
  follow-up could add a genuine `headline.netExcludedCategory` field to `GET /analytics/sales` if this
  heuristic ever proves wrong in practice — flagged, not silently trusted.
- **The channel-table full-pagination fetch (step 10) issues up to `ceil(total / 100)` requests per
  open category, per page load.** Mitigation: bounded by the `total` count Phase 7's coverage
  aggregate already reports (an operator with the panel open sees this number before it ever spawns
  requests), and — per the acceptance note in step 10 — a `total` large enough to matter is itself the
  signal that the underlying remediation is overdue, which is exactly what the Data Coverage panel
  already surfaces prominently. If this proves too chatty in practice, a follow-up could add a genuine
  channel-grouped aggregate endpoint (the same shape recommended for the Product-table gap in §5,
  option 2) rather than this plan inventing a bespoke pagination-drain here.

### Edge Cases
- **A channel with orders in more than one open category**: both notes render (step 10, explicitly
  not merged) — an operator needs to know both, and merging into one ambiguous "this row is affected"
  line loses which fix applies.
- **`coverage` still loading (`undefined`) when the KPI strip / channel table render**: every new
  annotation renders its Phase-7-pre-existing generic fallback (KPI strip) or nothing (channel table
  — no note before the cross-reference data exists), never a broken/`undefined`-derived title. Covered
  by step 6's explicit acceptance criterion.
- **Zero open categories**: no `GapMark` gets a category-specific title (KPI strip falls back to its
  existing generic copy exactly as today), no `.excl-note` renders anywhere — byte-identical to
  pre-Phase-8 behavior, which is the correct "all clear" state.

### Backward Compatibility
- ✅ No breaking change to any existing prop, type, or exported symbol — every new prop on
  `AnalyticsDataCoveragePanel`/`AnalyticsKpiStrip`/`ChannelSalesTable`/`GapMark` is optional, and every
  component's no-new-props render path is asserted unchanged by the regression tests named in steps
  2, 4, 6.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `gap-mark.test.tsx` (new) — inert-span default, clickable-button variant, accessible name in both.
- `analytics-kpi-strip.test.tsx` (extend) — category-specific title + click-opens-category for the
  currency-driven qualifiers and the new Net Sales gap mark; the "no coverage data / zero-count ⇒
  unchanged generic behavior" regression guard.
- `analytics-exclusion-note.test.tsx` (new) — copy sourced from `deriveCoverageRowCopy` verbatim,
  click fires `onOpenCategory`.
- `channel-sales-table.test.tsx` (extend) — the two #2481 AC-mandated fixtures: correct-category
  attribution across two simultaneously-open categories, and no-missing-annotation coverage of every
  category at least once.
- `analytics-data-coverage-panel.test.tsx` — **no changes expected**; existing suite is the regression
  guard for step 2's uncontrolled-fallback default path.

### Integration Tests
- None — this is presentation-only wiring over already-integration-tested backend endpoints (Phase 7
  shipped `analytics-coverage.controller.spec.ts` et al.); no new HTTP surface is added by this plan.

### Mocking Strategy
- `createMockApiClient` (existing `test/test-utils.tsx` helper) for every new/extended test — mock
  `analytics.getCoverage`, `analytics.getCurrencyMismatchOrders`, `analytics.getTaxCoverageOrders` per
  the established Phase 7 test pattern (see `analytics-data-coverage-panel.test.tsx` for the reference
  shape).

### Acceptance Criteria

**Task 8.1 (#2480)**:
- [ ] Every KPI card affected by an open coverage category shows a `GapMark` with a real,
      category-specific `title`.
- [ ] Clicking it opens the correct detail modal for that category.
- [ ] Tests added/updated for `gap-mark.tsx` and the KPI components it's wired into.

**Task 8.2 (#2481), Channel half**:
- [ ] A channel row's `.excl-note` category is provably correct against its own underlying order
      data (test with a fixture where two categories are both present, asserting each row gets the
      right one).
- [ ] No channel row belonging to an open category's affected set is missing its annotation (test
      with a fixture covering every eligible category at least once).
- [ ] Tests added.

**Task 8.2 (#2481), Product half**: **not attempted by this plan** — see §5 for the flagged backend
gap and the recommended follow-up shape. The mini-epic's (#2479) own AC checklist cannot be closed
in full without that follow-up landing first.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A — pure frontend, no layers crossed)
- [x] Respects CORE vs Integration boundaries (N/A — no backend touched)
- [x] Uses existing patterns (no unnecessary abstractions) — controllable-component pattern,
      `deriveCoverageRowCopy` reuse, no new context/store
- [x] Idempotency considered (N/A — no writes; all reads are TanStack Query cache-consistent)
- [x] Event-driven patterns used where applicable (N/A)
- [x] Rate limits & retries addressed — N/A backend-side; FE pagination-drain risk documented in §8
- [x] Error handling comprehensive — per-category fetch failures degrade independently (§6
      Implementation Details)
- [x] Testing strategy complete — §9
- [x] Naming conventions followed — §8
- [x] File structure matches standards — one new file at the canonical `components/` location
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Frontend UI Style Guide](../frontend-ui-style-guide.md)
- [Testing Guide](../testing-guide.md)
- Epic #2452, mini-epic #2479, sub-tasks #2480 / #2481
- Mockup: `docs/plans/mockups/analytics-display-currency-picker.html`
