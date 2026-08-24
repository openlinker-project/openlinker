# Implementation Plan: Top Products Table (#1991)

**Date**: 2026-08-19
**Status**: Draft
**Estimated Effort**: 3–5 days

---

## 1. Task Summary

**Objective**: Build the `/analytics` "Top products" section — a `DataTable` ranking products by
revenue or units for the selected date range, each row carrying its own inline per-channel
breakdown, so an operator can see "Widget A sells 120 on Allegro, 22 on the shop, nothing on Erli"
in one glance, without a drill-down page or a chart.

**Context**: This is the frontend for #1988 (backend, already implemented — draft PR #2172,
stacked on `1987-sales-channel-aggregates`). Design source is dual and the two sources **disagree
on money-column terminology** — see § 4 for the resolution this plan adopts, which is to follow the
precedent the sibling by-channel table (#1990) already set when it hit the identical tension.

**Classification**: Frontend (`apps/web`). No backend or core changes in scope.

---

## 2. Scope & Non-Goals

### In Scope
- `ProductSalesTable` component: `DataTable` with a frozen `Product` column (thumbnail + name,
  links to product detail), an `SKU` column, a toggle-driven `Revenue`/`Units` pair (both always
  visible; the toggle only changes sort order), and one column per connected sales channel that
  grows/scrolls horizontally as connections are added.
- The "Not listed" vs. real `0` distinction, and the "Publish" chip that swaps into a "Not listed"
  cell's slot when the product sells elsewhere but isn't listed on that channel.
- Card view for mobile (`≤767.98px`) with the per-channel split behind `collapsibleDetail`.
- Per-section loading / recalculating / error / empty states, independent of the KPI strip and
  by-channel table sections it sits beside.
- FE data layer: `top-products.types.ts` (mirrors `TopProductsResponseDto`), `top-products.api.ts`,
  query keys, `useTopProductsQuery`, and a small view-model helper module.
- Unit tests for the table component (loading/error/empty/success, not-listed vs zero, publish
  chip, sort toggle) and the view-model helpers.

### Out of Scope (per the issue and per this plan's own findings)
- Per-product drill-down page.
- Bottom performers / zero-sales SKUs.
- Price dispersion / uplift columns (D4/D5) — deferred to v2 per the issue.
- Variant-level ranking (spec row C3) — #1988's backend is product-level only; this table is too.
- **The mockup's "currency-split" rendering mode** (two money columns, one per reporting currency,
  when the dataset spans more than one). #1988's `TopProductsResponseDto` carries a single
  `currency` field per product with no per-currency-column breakdown, and ADR-040 establishes one
  system-wide reporting currency — the multi-currency-column mode in the mockup's JS
  (`mode === 'currency-split'`) has no backend contract to render against today. Treated as
  aspirational/future, not a gap to fill in this PR.
- **True "Net sales" (net-of-VAT, net-of-returns) computation.** See § 4 — #1988 does not compute
  this, and this plan does not add it.
- A shared `DateRangePicker` extraction, KPI strip, by-channel table, trust header — all already
  shipped or in flight on sibling branches (see § 3).

### Constraints
- **Branch stack.** #1991 needs three things that live on three different branches:
  1. `1986-analytics-page-shell` (PR #2115) — the `/analytics` route + page shell.
  2. `1990-sales-analytics-trend-plan` (PR #2171, based on `1986-analytics-page-shell`, itself
     based on `1987-sales-channel-aggregates`) — the KPI strip + by-channel table, which #1991's
     table sits directly beside on the same page and whose component/file conventions this plan
     copies verbatim.
  3. `1988-top-products-analytics` (PR #2172, based on `1987-sales-channel-aggregates`) — the
     backend endpoint this table calls. **This commit is not on `1990-sales-analytics-trend-plan`**
     (they are siblings off `1987-sales-channel-aggregates`, not stacked on each other).

  **Recommended base: branch off `1990-sales-analytics-trend-plan`, then merge in the single commit
  from `1988-top-products-analytics` on top** (a clean `git merge origin/1988-top-products-analytics`
  — no conflicts expected, disjoint file sets). Mirrors the same "stack note" pattern PR #2171
  itself already used for #1986/#1987. Confirm at implementation time whether any of the three
  have merged further down the stack in the meantime and simplify accordingly.
- Per this session's instruction, **no git branch/commit/push/PR is created for this planning
  pass** — the plan document is the only output right now.

---

## 3. Architecture Mapping

**Target Layer**: Frontend only (`apps/web/src/features/analytics`, `apps/web/src/pages/analytics`).

**Existing Services Reused**:
- `DataTable` (`shared/ui/data-table.tsx`) — `stickyLeftColumns`, `hideBelow` (480|768|1024),
  `cardView` with `collapsibleDetail`. All three props are already shipped and already exercised
  by `channel-sales-table.tsx` (#1990) for the sibling table.
- `GapMark` (`features/analytics/components/gap-mark.tsx`, shipped in PR #2171) — the inline `†`
  + tooltip primitive for a figure not yet backed by data. **Not used in this plan** (see § 4) but
  confirmed to exist in case a reviewer expects it.
- `ProductThumbnail` (`shared/ui/product-thumbnail.tsx`) — `size="md"` in the table, `"sm"` in the
  mobile card, matching `products-list-page.tsx`'s own convention.
- `EmptyValue`, `ErrorState`, `LoadingState`, `Chip`, `Button`, `SegmentedControl` — all shipped,
  all already used by `channel-sales-table.tsx` / `analytics-kpi-strip.tsx`.
- `useProductsBatchQuery` (`features/products`, confirmed shipped) — batch-fetch products by id for
  thumbnail images, the exact same "backend carries only ids, FE joins for display" pattern
  `channel-sales-table.tsx` already uses via `useConnectionsQuery()` for connection identity.
- `useNumberFormat` / `formatAmount` (`shared/i18n`, `shared/format`) — tabular-nums currency
  formatting, already used by `channel-sales-table.tsx`.
- `useSalesAnalyticsQuery`'s sibling pattern (own hook, own query key, no prop-drilled `query`) —
  copied for `useTopProductsQuery`.

**New Components Required**:
- `features/analytics/api/top-products.types.ts`
- `features/analytics/api/top-products.api.ts`
- `features/analytics/api/top-products.query-keys.ts`
- `features/analytics/hooks/use-top-products-query.ts`
- `features/analytics/lib/top-products-view-model.ts`
- `features/analytics/components/product-sales-table.tsx` (+ `.test.tsx`)
- `features/analytics/index.ts` — additive exports
- `pages/analytics/analytics-page.tsx` — additive: mount `<ProductSalesTable />` after the
  by-channel table (this file already exists once #1990 lands; this plan only adds one section)

**Core vs Integration Justification**: N/A — no backend work. The frontend consumes #1988's
already-defined `GET /analytics/top-products` contract as-is.

---

## 4. External / Domain Research

### The canonical design source, and where it disagrees with itself

Two design artifacts exist and were both consulted; **this plan treats the one merged onto `main`
as authoritative** per `.claude/rules/analytics-metrics.md`'s own "on divergence, the spec wins"
rule:

1. **`docs/plans/mockups/analytics-ledger-2003.html`** (PR #2018, **merged to `main`**) — Frame 06
   "Top products", explicitly captioned `feeds #1991`. This is the more recent, more detailed, and
   canonical source. Read in full for this plan.
2. A separately-referenced Claude.ai artifact mockup (`d1e9bc65-…`, not in the repo) — an earlier or
   parallel round of the same design. Cross-checking the two surfaced **one factual correction**:
   the artifact's summary described a trailing "GMV trend" sparkline column on the top-products
   table. **The canonical mockup's own render function (`productTable()`, line ~4700) has no
   sparkline column at all** — the "GMV trend" sparkline is a `channel-sales-table.tsx` /
   by-channel-table feature only (confirmed in both the mockup HTML and the already-shipped
   `channel-sales-table.tsx` on PR #2171). **This plan follows the canonical mockup: no trend
   column on the top-products table.**

### The money-column terminology conflict — and how #1990 already resolved it

The canonical mockup's own copy calls the toggle **"By net sales"** and the money column **"Net
sales"**, and even ships a `blocked()` gap-marker mechanism (`NET_SALES_NEED = 'Needs refunded
value, and no return or refund amount is stored on any entity'`) for exactly this situation — a
figure the mockup itself flags as not backend-computable at authoring time.

Checked against the current state of the codebase:
- `RefundRecord` (entity + repository) **does now exist** on `main` (#2036/#2046, merged) — so the
  mockup's literal claim ("no return or refund amount is stored on any entity") is **now stale**.
- However, **no aggregate query anywhere subtracts refund value from revenue.** #1988's backend
  (`getTopProductRanking`) computes `revenue = SUM(unitPrice × quantity × orderFxMultiplier)` over
  FX-stamped orders — a gross, reporting-currency figure, with no returns deduction. This is not
  "Net sales" per `docs/specs/metrics-analytics-dashboard.md`'s own definition (Net Sales = Net
  Order Value − Returns Value, also net of VAT).
- **The sibling by-channel table (#1990, PR #2171, already implemented) hit this exact tension and
  resolved it**: `channel-sales-table.tsx`'s shipped column header is plain **`'Revenue'`** — not
  "Net sales", and it carries **no `GapMark`**. The by-channel table's own backend
  (`ChannelSalesAnalyticsDto`) is `#1987`'s same gross reporting-currency figure, same as #1988's.

**Decision (following the already-shipped precedent, not the mockup's literal copy): this table's
money column is labeled `Revenue`, the sort toggle is `By revenue` / `By units`, and no `GapMark`
is used.** This is the only choice that keeps the two sibling tables terminologically consistent
with each other and with what the backend actually computes. Building real "Net sales" (VAT
netting + returns subtraction) is a backend-scoped follow-up outside both #1990 and #1991's stated
scope — flagged, not built.

### Internal Patterns — `channel-sales-table.tsx` as the direct structural precedent

Fetched from the shipped `1990-sales-analytics-trend-plan` branch (PR #2171) and read in full. Key
patterns this plan copies:
- The component calls its **own** query hook (`useTopProductsQuery`, not a `query` prop) so a page
  rendering multiple analytics sections for the same range gets TanStack Query's cache dedup for
  free via identical query keys — no cross-component coordination needed.
- A backend DTO carrying only ids (here: `sourceConnectionId` for channels) is joined against a
  separate feature's batch query for display identity — this plan does the identical thing for
  product thumbnails via `useProductsBatchQuery` (§ 3), rather than requesting a backend change to
  #1988's already-drafted DTO.
- `LoadingState` / `ErrorState` / `EmptyValue` used exactly as `channel-sales-table.tsx` uses them —
  same import paths, same prop shapes.
- `DataTableColumn<Row>[]` array with `hideBelow` set per column, not a hand-rolled responsive
  table.

### #1988's actual response contract (from `1988-top-products-analytics`, PR #2172)

```ts
// TopProductsResponseDto
{
  items: Array<{
    productId: string;
    name: string | null;       // null when the id didn't resolve to a live catalogue entry
    sku: string | null;
    units: number;
    revenue: number;           // comparable, reporting-currency, stamped orders only
    unconvertedRevenue: number;
    unconvertedOrderCount: number;
    currency: string | null;   // null only when every contributing order is unconverted
    channels: Array<{
      sourceConnectionId: string;
      units: number;
      revenue: number;
      unconvertedRevenue: number;
      currency: string | null;
    }>;
    missingFromConnectionIds: string[]; // listing-capable connections with no listing for this product
  }>;
  total: number;                // distinct products in scope, before pagination
  unresolvedProductCount: number;
  coverageGapAvailable: boolean; // false = coverage-gap enrichment failed for the whole response
}
```

**`coverageGapAvailable` correction (#2172 review, IMPORTANT 1 — not in the original transcript above).**
When `false`, every row's `missingFromConnectionIds` is an unreliable `[]` for the whole response,
not evidence the product is listed everywhere. `ChannelCell` must render the real `0` unconditionally
in that case, never "Not listed"/Publish, with a footnote stating the check is unavailable — the
original plan text below (§ Acceptance) only covered the per-row `missingFromConnectionIds` case and
missed this response-level flag entirely.

Query params: `from`, `to` (ISO, required), `sourceConnectionId?`, `sortBy?: 'revenue' | 'units'`
(default `'revenue'`), `limit?` (default 20, max 100), `offset?` (default 0).

**No per-row `imageUrl`, no per-row `name`/`sku`-resolution flag beyond a null name.** Thumbnails
are resolved FE-side via `useProductsBatchQuery(productIds)` against `Product.images[0]`, per
`channel-sales-table.tsx`'s established join pattern (§ 3) — **not** an amendment to #1988's DTO.

### Aggregation identity rule (from the canonical mockup, already honored by #1988)

> Aggregate on `productId`/`variantId`, never `sku`: Allegro sets `sku = offer.id`, so a SKU-keyed
> roll-up splits one product across channels.

#1988's backend already groups by `productId` — no rework needed. This plan's FE code must not
introduce a SKU-keyed `rowKey` or dedup step either; `rowKey={(row) => row.productId}`.

### Thumbnail sourcing rule (from the canonical mockup)

> Do not read the photo from `OrderItem.imageUrl`. WooCommerce populates that field on ingestion,
> Allegro's checkout-form endpoint cannot, and Erli and PrestaShop never set it — the column would
> turn patchy depending on which channel the sale landed on.

Confirms the `useProductsBatchQuery` → `Product.images[0]` join is the only channel-agnostic source.
An unresolved product (`name: null`) or a product with no catalogue image falls back to
`ProductThumbnail`'s own initial-letter placeholder — never a broken-image box.

---

## 5. Questions & Assumptions

### Open Questions
- Where does the "Publish" chip navigate? Neither design source specifies a target route. **Default
  assumption**: reuse the existing unified publish flow's entry point (`docs/frontend-architecture.md`
  § Unified publish flow, #1828/#1829) — clicking "Publish" for `(productId, connectionId)` should
  route into the bulk-create wizard the same way the Products page's per-row "+ Publish" CTA does,
  pre-selecting the product and the target connection. This needs a small navigation helper
  (`buildPublishWizardUrl(productId, connectionId)`) rather than a new flow. Flag for product
  confirmation before implementation; the fallback if this proves wrong is a simple `Link` to the
  connection's own listings page.
- Should `missingFromConnectionIds` values map 1:1 to rendered channel columns, or could a
  listing-capable connection with zero sales anywhere in range appear in `missingFromConnectionIds`
  without ever having its own column? **Assumption**: the table's channel columns are derived from
  the **union of connection ids appearing in any row's `channels[]`** (i.e., connections with at
  least one sale among the displayed products) — a connection that sells nothing at all doesn't get
  a column, matching how #1988's backend never surfaces a connection that isn't already present in
  some row's `channels[]`. A `missingFromConnectionIds` entry for a connection with no column would
  be an invisible flag; if this occurs in practice (a connection with sales on some OTHER page of
  results but not on the current page), render the chip only for connections that already have a
  column — cross-page connections are out of scope for a bounded, paged table.

### Assumptions
- The by-channel table's column-header channel-name truncation convention
  (`c.name.split(' — ')[0]`, i.e. show only the part before an em-dash-delimited connection-name
  suffix) is **not** replicated here unless `channel-sales-table.tsx` itself does the same — checked:
  it doesn't (it renders full connection identity via `ConnectionCell`). This plan therefore uses
  each channel column's header as the connection's plain `name` (via `useConnectionsQuery`), for
  consistency with the sibling table rather than the mockup's own space-saving truncation, which
  the real by-channel implementation evidently decided against.
- `total` and pagination (`limit`/`offset`) exist in #1988's contract but the mockup shows a fixed,
  un-paginated table. This plan renders the **first page only** (`limit: 20, offset: 0`, matching
  #1988's own default) with **no pagination control in v1** — the issue's own AC ("Paged and bounded
  for large catalogues") is a backend requirement #1988 satisfies; a FE "load more" / page control is
  not in either design source and is deferred rather than invented.
- Units are re-derived FE-side as `SUM(row.channels[].units)` rather than trusted from
  `row.units` directly, mirroring the mockup's own explicit defensive-derivation comment ("so
  adding the fourth channel cannot leave the total disagreeing with the row it totals"). In
  practice #1988's `units` and the channel-summed total are always equal (same SQL query, same
  scope) — this is a belt-and-suspenders display consistency choice, not a correctness fix, and
  costs nothing.

### Documentation Gaps
- None blocking — the canonical mockup plus the already-shipped sibling table close every material
  gap this plan surfaced.

---

## 6. Proposed Implementation Plan

### Phase 1: Data layer

**Goal**: A typed, cached read of `GET /analytics/top-products`, mirroring the `sales-analytics.*`
file set exactly.

**Steps**:

1. **Types**
   - **File**: `apps/web/src/features/analytics/api/top-products.types.ts`
   - **Action**: Hand-written mirror of #1988's `TopProductsResponseDto` (§ 4) —
     `ProductChannelSales`, `TopProductRow`, `TopProductsResult`, `TopProductSortBy` (`'revenue' |
     'units'`), `TopProductsFilters` (`from`, `to`: `yyyy-mm-dd` strings matching the toolbar
     convention; `sourceConnectionId?`; `sortBy`; `limit?`; `offset?`).
   - **Acceptance**: Field names and nullability match #1988's DTO exactly — no renaming, per
     `frontend-architecture.md`'s "preserve backend camelCase naming" rule.

2. **API client**
   - **File**: `apps/web/src/features/analytics/api/top-products.api.ts`
   - **Action**: `fetchTopProducts(client, filters): Promise<TopProductsResult>` — converts the
     toolbar's inclusive `to` day into the exclusive end instant #1988's `to` expects, reusing
     `toExclusiveEndInstant` from `sales-analytics.api.ts` (already fixed there per PR #2171's own
     changelog — do not re-derive this logic a second time; import and reuse it, or extract it to
     `lib/date-range.lib.ts` if it isn't already shared).
   - **Acceptance**: A `sortBy=units` request round-trips distinctly from `sortBy=revenue`.

3. **Query keys + hook**
   - **Files**: `top-products.query-keys.ts`, `hooks/use-top-products-query.ts`
   - **Action**: `useTopProductsQuery(filters)` — same shape as `useSalesAnalyticsQuery`.
   - **Acceptance**: Query key includes every filter field so a `sortBy` toggle or date-range change
     produces a distinct cache entry (no stale-sort flash).

### Phase 2: View-model helpers

**Goal**: Pure, unit-testable functions the component calls — no JSX, no React.

**Steps**:

1. **File**: `apps/web/src/features/analytics/lib/top-products-view-model.ts`
   - `deriveChannelColumns(rows: TopProductRow[]): string[]` — union of `sourceConnectionId`s
     across every row's `channels[]`, order-stable (first-seen order, or sorted — pick one and test
     it; first-seen avoids a column reordering itself as the sort toggle changes row order).
   - `totalUnits(row: TopProductRow): number` — `SUM(channels[].units)` (§ 5 assumption).
   - `channelCellFor(row, connectionId): ProductChannelSales | undefined` — lookup helper.
   - `isMissingFrom(row, connectionId): boolean` — `row.missingFromConnectionIds.includes(connectionId)`.
   - **Acceptance**: `deriveChannelColumns` on an empty `rows` array returns `[]`; a channel present
     in one row but absent from another still appears exactly once in the derived column list.

### Phase 3: Table component

**Goal**: `ProductSalesTable`, structurally identical in shape to `channel-sales-table.tsx`.

**Steps**:

1. **File**: `apps/web/src/features/analytics/components/product-sales-table.tsx`
   - **Action**:
     - Calls `useTopProductsQuery(filters)` and `useConnectionsQuery()` (for channel column
       headers) and `useProductsBatchQuery(productIds)` (for thumbnails) — three independent
       queries, each degrading gracefully (a thumbnail-batch failure falls back to
       `ProductThumbnail`'s initial-letter placeholder, never blocks the table).
     - `LoadingState` / `ErrorState` on `useTopProductsQuery`'s own `isLoading`/`error` — **does
       not** block on the connections/thumbnails queries, matching the "every state is per section"
       rule and keeping thumbnails/channel-names as progressive enhancement, not a hard dependency.
     - A `SegmentedControl` above the table: `By revenue` / `By units` (§ 4), driving local
       component state (`sortBy`) that feeds `useTopProductsQuery`'s `filters.sortBy` — this is a
       **local UI concern**, not URL state (the issue's AC doesn't ask for shareable sort state, and
       neither does #1986/#1990's URL-state scope; keep it simple per
       `frontend-architecture.md`'s URL-state guidance, which reserves the URL for filters/sort/
       pagination that should be *shareable* — a per-section sort toggle inside one analytics
       section is not, by itself, worth a search param). **Flag as a judgment call**, not
       a hard requirement — revisit if product feedback wants the sort to survive a reload.
     - Columns, in exact mockup order: `Product` (frozen, `stickyLeftColumns={1}`, thumbnail +
       name via `ProductThumbnail size="md"` + link to product detail), `SKU` (`hideBelow={768}`),
       `Revenue` (right-aligned, `formatAmount(row.revenue, row.currency ?? undefined)`, arrow/
       `aria-sort` bound to `sortBy === 'revenue'`), `Units` (right-aligned, `totalUnits(row)`,
       arrow/`aria-sort` bound to `sortBy === 'units'`), then one column per
       `deriveChannelColumns(rows)` entry (header = connection name via `useConnectionsQuery`
       lookup; cell = `renderChannelCell`, below).
     - `renderChannelCell(row, connectionId)`:
       - If `channelCellFor(row, connectionId)` exists → render its `units` as a plain
         tabular-nums number (a real `0` renders identically to any other number — no special
         casing for zero).
       - Else (no channel entry — "not listed") → render the "Not listed" / "Publish" swap:
         a `<span>` containing a muted `<span>Not listed</span>` label plus, when
         `isMissingFrom(row, connectionId)`, a `<Chip>`/`<button>` "Publish" **absolutely
         positioned inside the same wrapper**, revealed via CSS on row `:hover`/`:focus-within` and
         always visible under `@media (hover: none)`. Reuses the exact CSS mechanism the mockup
         documents (label fades via `opacity`, never `display: none`; chip is `position: absolute;
         right: 0`, never a flex sibling — see § 4's mockup quote on the specific bug this avoids).
     - `product` row link: wraps the product cell's name in a `<Link to={`/products/${row.productId}`}>`
       (confirm the exact product-detail route path against `apps/web/src/app/routes/` at
       implementation time — this plan assumes it matches the existing products list's row-link
       convention).
     - `cardView` for mobile: `title` = product name, `subtitle` = SKU (never both column and
       subtitle at once, per the mockup's own rule), `summary` = Revenue + Units pair, `detail` =
       the full per-channel breakdown, `collapsibleDetail: true`.
   - **Acceptance** (unit-testable, mocked queries):
     - A channel with a real sale of `0` units renders `0`, not "Not listed".
     - A channel absent from `row.channels` renders "Not listed", with a "Publish" chip present iff
       `row.missingFromConnectionIds` includes that connection id.
     - Toggling the segmented control swaps `aria-sort` between the Revenue and Units headers and
       re-issues the query with the new `sortBy`.
     - `unresolvedProductCount > 0` in the response does not hide the affected row — it still
       renders with `ProductThumbnail`'s placeholder and no crash on `name: null`, **and is
       surfaced to the operator** as a footnote line below the table (#2172 review, IMPORTANT 2 —
       the original AC only required "doesn't crash", not "is disclosed").
     - `coverageGapAvailable: false` suppresses "Not listed"/Publish on every channel cell,
       rendering the real `0` instead, and shows a footnote explaining the check is unavailable
       (#2172 review, IMPORTANT 1).
     - `query.error` renders `ErrorState` with a retry action; `query.isLoading` renders
       `LoadingState`; an empty `items` array renders an empty-state message
       (`"No orders in this range"` — matches #1986/#1990's copy convention) rather than a
       zero-row table shell.

2. **Barrel export**
   - **File**: `apps/web/src/features/analytics/index.ts`
   - **Action**: Add `export { ProductSalesTable } from './components/product-sales-table';` plus
     the new types, following the exact append style already used for the sales-analytics exports.

### Phase 4: Page mount

**Goal**: `ProductSalesTable` renders on `/analytics`, directly after the by-channel table.

**Steps**:

1. **File**: `apps/web/src/pages/analytics/analytics-page.tsx` (already exists once #1990/#1986
   land — this step is additive)
   - **Action**: Mount `<ProductSalesTable filters={sharedRangeFilters} />` in its own `<article
     class="panel panel--dense">` section, immediately after `<ChannelSalesTable />`, sharing the
     same `filters` object the page already threads to the KPI strip / by-channel table (so a
     `sourceConnectionId`/date-range change re-fetches all three sections consistently, and their
     shared query-key prefix lets TanStack Query dedup nothing here since the endpoints differ —
     only the *filters shape* is shared, not the cache entry).
   - **Acceptance**: Changing the toolbar's date range re-fetches top-products alongside the other
     two sections; a top-products fetch error does not blank the KPI strip or by-channel table
     (verified by a page-level test asserting section independence, matching the "every state is
     per section" rule).

---

## 7. Alternatives Considered

### Alternative 1: Build "Net sales" (VAT + returns netting) as part of this PR
- **Description**: Extend #1988's backend to subtract `SUM(refund_records.amount)` per product and
  ship the mockup's literal "Net sales" copy.
- **Why Rejected**: #1991 is scoped frontend-only by its own issue labels and dependency list
  (blocked by #1988, #1986 — no backend issue named). The sibling by-channel table already faced
  and resolved the identical gap by shipping "Revenue" instead (§ 4) — reopening that resolved
  question here, differently, would make the two tables use different terminology for the same
  underlying figure on the same page. A follow-up backend issue for real net-sales computation
  (VAT netting + returns subtraction, feeding both tables identically) is the correct scope for
  that work, not a silent scope-add to #1991.

### Alternative 2: Amend #1988's `TopProductsResponseDto` to carry `imageUrl` per row
- **Description**: Have the backend resolve `Product.images[0]` during its existing catalog
  enrichment step (it already loads `Product` objects for `name`/`sku`) and add one field.
- **Why Rejected**: The established, already-shipped precedent for exactly this shape of problem
  (a DTO carrying only an id, a FE needing display metadata for it) is a FE-side batch join —
  `channel-sales-table.tsx` already does this for connection identity via `useConnectionsQuery()`,
  and `useProductsBatchQuery` already exists for products. Matching that precedent keeps the
  pattern for "how does an analytics table get display metadata" singular across the page, rather
  than solving it two different ways for two sibling tables. It also avoids reopening a
  draft-but-otherwise-complete backend PR (#2172) for a FE-only feature.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Frontend-only change; no `apps/api`/`libs/core` edits.
- ✅ Follows `frontend-architecture.md`'s state-ownership rules: server state via TanStack Query,
  sort toggle as local UI state (§ 6 Phase 3, flagged as a judgment call), no new global store.
- ✅ Feature public surface: only `product-sales-table.tsx`'s export and its types are added to
  `features/analytics/index.ts`; internals stay private.
- ✅ No raw `fetch()` — goes through the shared `top-products.api.ts` module, matching the
  `no-restricted-globals` lint rule.

### Naming Conventions
- ✅ `kebab-case.tsx` file, `PascalCase` export (`ProductSalesTable`), matching every existing
  primitive in `features/analytics/components/`.
- ✅ Hook `use-top-products-query.ts` / `useTopProductsQuery`, route/page files untouched by this
  plan beyond the one additive mount line.

### Existing Patterns
- ✅ Structurally identical to `channel-sales-table.tsx` (own-query-hook, `DataTableColumn[]`
  array, `LoadingState`/`ErrorState`/`EmptyValue`, FE-side identity join for display metadata).

### Risks
- **Branch-stack drift**: by the time this is implemented, #1986/#1987/#1988/#1990 may have merged
  further down the stack (into each other or into `main`), changing which branch to fork from. § 2
  Constraints names the current state explicitly; re-verify at implementation time rather than
  trusting this document's snapshot.
- **Publish-chip target route is unconfirmed** (§ 5) — implement behind a small navigation helper
  so the target can change without touching the table component itself.
- **Terminology risk**: if product/design pushes back on "Revenue" vs the mockup's "Net sales"
  copy, that is a page-wide (KPI strip + both tables) decision, not a top-products-only one — raise
  it against #1990's already-shipped choice, not as a #1991-local deviation.

### Edge Cases
- **All-unconverted product** (§ #1988's own edge case): renders `revenue: 0` with the row still
  present — this plan does not add a FE-side "unconverted" disclosure to the top-products table
  (unlike the KPI strip / by-channel table, which do show `unconvertedCount`/`unconvertedValue` —
  #1988's `TopProductsRowDto` exposes `unconvertedRevenue`/`unconvertedOrderCount` per product but
  neither design source shows them rendered on this table). **Decision**: leave unrendered in v1,
  consistent with the canonical mockup (which has no such cell), but keep the fields flowing
  through `top-products.types.ts` so a future disclosure (e.g. a tooltip on the Revenue cell) is a
  small addition, not a contract change.
- **A product with zero listing-capable connections at all** (a brand-new instance, no marketplace/
  shop connected): `deriveChannelColumns` returns `[]`, the table renders Product/SKU/Revenue/Units
  only — no crash, no empty-channel-column artifact.
- **`total > items.length`** (more products in scope than fit on one page): per § 5, v1 renders
  page one only with no pagination control — the discrepancy is silent in v1, which is an accepted,
  explicitly-stated limitation, not an oversight.

### Backward Compatibility
- ✅ Purely additive — new components, new feature files, one new mount line on a page that (once
  #1986/#1990 land) doesn't yet have this section.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `top-products-view-model.test.ts` — `deriveChannelColumns`, `totalUnits`, `channelCellFor`,
  `isMissingFrom`, per § 6 Phase 2 acceptance criteria.
- `product-sales-table.test.tsx` — loading/error/empty/success states, not-listed-vs-zero
  rendering, publish-chip visibility tied to `missingFromConnectionIds`, sort-toggle behavior
  (`aria-sort` + refetch), mirroring `channel-sales-table.test.tsx`'s existing test shape.
- `use-top-products-query.test.tsx` — query key changes with each filter field, mirroring
  `use-sales-analytics-query`'s test (if one exists on the #1990 branch — verify and copy its
  shape).

### Integration Tests
- None — this is a frontend-only Vitest project; `apps/web` has no `*.int-spec.ts` convention (that
  pattern is backend-only per `testing-guide.md`).

### Mocking Strategy
- Mock `useTopProductsQuery`, `useConnectionsQuery`, `useProductsBatchQuery` at the hook level in
  component tests (matching `channel-sales-table.test.tsx`'s existing mocking approach) — never
  mock at the `fetch`/API-client level for a component test.

### Acceptance Criteria (mirrors #1991's own AC list)
- [ ] Table ranks products with a visible toggle between "By revenue" and "By units"
- [ ] Each row shows the product's sales split across channels, in that row
- [ ] A real `0` and "Not listed" render distinguishably (prose vs. tabular number)
- [ ] A product selling on one channel but not listed on another shows a "Publish" affordance
- [ ] Product rows link to product detail
- [ ] Channel columns adapt to the number of connected channels without breaking layout
      (horizontal scroll inside `.data-table__container`, frozen Product column)
- [ ] `tabular-nums` on every numeric cell; `SKU` hidden below 768px; card view on mobile with the
      per-channel split behind one disclosure tap
- [ ] Loading/error/empty states follow the existing per-section convention
- [ ] Tests added, covering every branch above
- [ ] `pnpm --filter @openlinker/web lint` and `type-check` clean

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — N/A layer (pure frontend), no boundary crossed.
- [x] Respects CORE vs Integration boundaries — no backend touched.
- [x] Uses existing patterns — `channel-sales-table.tsx` copied structurally, not reinvented.
- [x] Idempotency — N/A, read-only.
- [x] Event-driven patterns — N/A.
- [x] Rate limits & retries — inherits TanStack Query's existing retry-disabled-by-default policy.
- [x] Error handling comprehensive — per-section `ErrorState`, never blocks sibling sections.
- [x] Testing strategy complete.
- [x] Naming conventions followed.
- [x] File structure matches standards.
- [x] Plan is execution-ready, contingent on the branch-stack note in § 2 being re-verified at
      implementation time.
- [x] Plan is saved as a markdown file.
- [x] No ADR required — no architectural decision, purely additive frontend feature reusing an
      already-established component pattern.

---

## Related Documentation

- [Frontend Architecture](../frontend-architecture.md) — § Dependency Rules, § State Management,
  § Unified publish flow (#1828/#1829)
- [Engineering Standards](../engineering-standards.md)
- `.claude/rules/analytics-metrics.md` — the spec-wins-on-divergence rule this plan follows in § 4
- `docs/specs/metrics-analytics-dashboard.md` — canonical metric definitions (Net Sales, GMV, etc.)
  referenced to establish that #1988 does not compute "Net sales" as literally defined
- `docs/plans/mockups/analytics-ledger-2003.html` — Frame 06 "Top products", the canonical design
  source (PR #2018, merged to `main`)
- Reference implementation to copy structurally: `apps/web/src/features/analytics/components/channel-sales-table.tsx`
  and its sibling files, on branch `1990-sales-analytics-trend-plan` (PR #2171)
- Backend contract this table calls: `1988-top-products-analytics` (PR #2172),
  `docs/plans/implementation-plan-top-products-analytics.md`
