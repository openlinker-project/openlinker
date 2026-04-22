# Implementation Plan — DataTableSkeleton (#218)

## Goal

Replace spinner-based `LoadingState` with shimmer skeleton screens on every list page, matching the real table's visual structure so there is no layout shift when data arrives.

**Issue:** #218 — `feat(web): replace spinner LoadingState with skeleton screens in data tables`

## Non-goals

- Non-list pages (detail pages, auth flows, connection mapping editor) keep `LoadingState`.
- No new design tokens; use `--bg-surface-muted`, `--bg-surface-hover`, `--border-subtle`.
- No new dependencies — pure CSS `@keyframes` shimmer.
- No changes to `DataTable` component internals.
- Not bundled with #224 (sidebar) or #219 (empty-state CTAs).

## Layer classification

**Frontend — shared UI primitive + list-page updates.** Fits `apps/web/src/shared/ui/`; no backend work.

## Research summary

- `apps/web/src/shared/ui/data-table.tsx` — the real table renders a `<table className="data-table">` inside `.data-table__container` (has `overflow-x: auto`), and switches to a `<ul className="data-table__cards">` below 767.98px via `useMediaQuery`.
- `apps/web/src/shared/ui/feedback-state.tsx` — `LoadingState` is a centered card with eyebrow / title / message; used on 7 list pages (orders, products, inventory, listings, customers, sync-jobs, webhook-deliveries) as the entire loading UI.
- `apps/web/src/index.css` — existing tokens include `--bg-surface-muted: #eef2f6`, `--bg-surface-hover: #e3e8ef`, `--border-subtle`. `.data-table` conventions already use these, so the skeleton can blend in.
- Each list page defines a local `COLUMNS` array, so `COLUMNS.length` provides the column count at call sites.
- Test pattern: `apps/web/src/shared/ui/product-thumbnail.test.tsx` uses Vitest + Testing Library with `describe / it / expect`.

## Design

### Public API

```ts
interface DataTableSkeletonProps {
  /**
   * Either a plain column count, or the same `DataTableColumn[]` array passed
   * to `DataTable`. Passing the array lets the skeleton honour each column's
   * `hideBelow` so intermediate widths match the real table's visible columns
   * (no horizontal shift when data lands).
   */
  columns: number | DataTableColumn<unknown>[];
  rows?: number; // default 8
}
```

The issue spec states `columns: number` — this extends it by also accepting the column array, which is strictly a superset. All 7 list pages pass the array since they already have `COLUMNS` in scope, gaining `hideBelow` parity at intermediate widths.

### Behavior

- Renders a `<div role="status" aria-live="polite" aria-label="Loading table data" className="data-table-skeleton">` wrapper — matches the announcement semantics of `LoadingState` at `apps/web/src/shared/ui/feedback-state.tsx:28`, keeping SR UX consistent with the current loading flow.
- Visible shimmer elements get `aria-hidden="true"`; a visually-hidden `<span className="sr-only">Loading…</span>` carries the label.
- Above 768px (or when `useMediaQuery` is unknown, i.e. SSR/initial render): renders a table-shaped skeleton inside `.data-table__container` so the DOM shape and spacing match the real `.data-table`. When `columns` is a `DataTableColumn[]`, applies the same `data-table__cell--hide-below-*` classes to each cell so columns collapse in lockstep with the real table.
- Below 767.98px: renders a list of card-shaped skeletons mirroring `DataTable`'s card view — avoids layout shift at mobile widths.
- Shimmer: CSS `@keyframes shimmer-sweep` on each bar — 1.4s linear infinite gradient sweep. Wrap in `@media (prefers-reduced-motion: reduce)` to still colour the bar but skip the animation.
- File header present per `docs/engineering-standards.md:245`. Existing FE primitives skip this by convention, but adopting the standard here is cheap and documents the component's role.

### Files

**Create:**
- `apps/web/src/shared/ui/data-table-skeleton.tsx` — the component.
- `apps/web/src/shared/ui/data-table-skeleton.test.tsx` — unit tests.

**Modify:**
- `apps/web/src/index.css` — append `.data-table-skeleton` block (next to `.data-table` rules) with the shimmer keyframe.
- 7 list pages — swap `LoadingState` → `<DataTableSkeleton columns={COLUMNS} />` (pass the array, not `COLUMNS.length`, so the skeleton honours `hideBelow` breakpoints).

## Step-by-step implementation

### Step 1 — Create the skeleton primitive

File: `apps/web/src/shared/ui/data-table-skeleton.tsx`

- File header block per `docs/engineering-standards.md:245` describing purpose and usage context.
- Default-export nothing; named export `DataTableSkeleton`.
- Accept `columns: number | DataTableColumn<unknown>[]`; normalize to an internal `normalizedColumns` array of `{ hideBelow?: DataTableHideBreakpoint }` so both forms share the rendering path. When a plain number is passed, generate `N` entries with no `hideBelow`.
- Use `useMediaQuery('(max-width: 767.98px)')` for card/table switch (matches `data-table.tsx`).
- Render `rows` ?? 8 skeleton rows. Apply `data-table__cell--hide-below-{480|768|1024}` to matching cells when `hideBelow` is set.

Acceptance: component compiles, renders without props errors, accepts both a number and a `DataTableColumn[]`; `rows` defaults to 8.

### Step 2 — Add shimmer CSS

File: `apps/web/src/index.css` (append near existing `.data-table` rules around line 1240)

Add:
- `.data-table-skeleton` wrapper (inherits `.data-table__container` layout feel)
- `.data-table-skeleton__bar` — the shimmer bar primitive (uses `background: linear-gradient(...)` + `animation: shimmer-sweep 1.4s ease-in-out infinite`)
- `.data-table-skeleton__table`, `.data-table-skeleton__cell`, `.data-table-skeleton__cards`, `.data-table-skeleton__card` — layout classes matching `.data-table` / `.data-table__cards` dimensions.
- `@keyframes shimmer-sweep` with 200% background-position sweep over `--bg-surface-muted` → `--bg-surface-hover`.
- `@media (prefers-reduced-motion: reduce)` disables the animation but keeps the muted colour.

Acceptance: skeleton bar is visible and animates; motion is removed when the OS prefers reduced motion.

### Step 3 — Add unit test

File: `apps/web/src/shared/ui/data-table-skeleton.test.tsx`

Cover:
1. Renders the default 8 rows when `rows` is omitted.
2. Respects a custom `rows` prop.
3. Renders the given column count when `columns` is a number (header + each row).
4. Renders the same column count when `columns` is a `DataTableColumn[]`.
5. Applies `data-table__cell--hide-below-768` to cells for columns whose `hideBelow === 768` (array form).
6. Outer wrapper has `role="status"` and `aria-live="polite"`.
7. Visible bars are `aria-hidden="true"`.
8. Includes a visually-hidden "Loading" label (sr-only).
9. Smoke: shimmer bars carry the `data-table-skeleton__bar` class (documents the CSS hook that `prefers-reduced-motion` targets).

Acceptance: `pnpm --filter @openlinker/web test data-table-skeleton` passes.

### Step 4 — Swap list-page loading UI

For each page below, replace

```tsx
<LoadingState liveRegion="off" title="..." message="..." />
```

with

```tsx
<DataTableSkeleton columns={COLUMNS} />
```

Keep the conditional structure (loading → error → empty → table).

Pages:
- `apps/web/src/pages/orders/orders-list-page.tsx`
- `apps/web/src/pages/products/products-list-page.tsx`
- `apps/web/src/pages/inventory/inventory-list-page.tsx`
- `apps/web/src/pages/listings/listings-list-page.tsx`
- `apps/web/src/pages/customers/customers-list-page.tsx`
- `apps/web/src/pages/sync-jobs/sync-jobs-page.tsx`
- `apps/web/src/pages/webhook-deliveries/webhook-deliveries-page.tsx`

Remove the unused `LoadingState` import per file. Keep it if the page still uses `LoadingState` elsewhere — none of these do (all 7 pages use `LoadingState` only for the list-loading branch).

Acceptance: each page still renders correctly on error / empty / data paths; `pnpm type-check` reports zero errors.

### Step 5 — Quality gate

Run before commit:

```bash
pnpm lint
pnpm type-check
pnpm --filter @openlinker/web test
```

All must pass with zero errors.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Skeleton visually drifts from real table, causing layout shift | Reuse `.data-table__container` shell; match cell padding (8px 12px) and row height (~40px). |
| Shimmer adds noise for users with motion sensitivity | `@media (prefers-reduced-motion: reduce)` removes animation. |
| Card/table breakpoint mismatch between skeleton and real table | Reuse the same `useMediaQuery('(max-width: 767.98px)')` string that `data-table.tsx` uses. |
| `LoadingState` usages in detail pages accidentally stripped | Only touch the 7 list pages listed above; leave detail-page `LoadingState` usages alone. |

## Testing strategy

- **Unit:** new `data-table-skeleton.test.tsx` covers props, structure, a11y.
- **Manual:** visual check in `pnpm start:dev:web` on 2–3 list pages (desktop + mobile emulation).
- **No integration tests needed** — component is presentational and has no data dependencies.

## Open questions

None — issue spec is clear and self-contained.
