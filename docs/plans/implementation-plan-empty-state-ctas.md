# Implementation Plan — Empty-state CTAs on list pages (#219)

## Goal

Every list-page `EmptyState` should offer a clear next step. Operators who land on an empty screen today hit a dead end — this adds actionable CTAs to guide them forward, and adds a "Clear filters" button when an empty result is the product of active filters.

**Issue:** #219 — `fix(web): add actionable CTAs to empty states on list pages`

## Non-goals

- No new shared components — the existing `EmptyState` `action` prop does the work.
- Pages *not* listed in the issue (webhook-deliveries, cursors, failed-orders, customer/order/connection detail drawers) stay untouched — avoid scope creep.
- No copy changes to titles/messages beyond what's necessary to support the new CTA.
- No changes to the `EmptyState` component API.

## Layer classification

**Frontend — page composition only.** No `shared/ui/` changes, no new hooks, no feature/API work.

## Research summary

- `apps/web/src/shared/ui/feedback-state.tsx:40` — `EmptyState` already accepts an optional `action: ReactNode`; renders it inside `.state-card__actions`.
- `.claude/rules/fe-pages.md` requires "Provide CTA on empty — guide the user toward the next action". The issue is closing a known gap against this rule.
- Two existing patterns for the action slot:
  - Navigation CTA: `<Link className="button button--primary" to="/target">Label</Link>` (used at `connection-category-mappings-page.tsx:174`)
  - Inline Button: existing pattern in error states — `<Button onClick={handler}>Retry</Button>`.
- Filter-clearing handlers: each affected page already owns `setSearchParams` — clearing is a local concern that maps to existing search-param resets.
- `connections-list-page.tsx:150` already ships a navigation CTA for the no-filter empty state, but no CTA for the filter-active branch. Consistent treatment is the goal.

## Design

### CTA matrix (from the issue, refined by code inspection)

| Page | No data (no filter) | Filter-active empty |
|---|---|---|
| `orders-list-page` | `Link → /connections` ("Manage connections") | Button: "Clear filters" (removes `syncStatus` + `sourceConnectionId`) |
| `products-list-page` | `Link → /connections` ("Manage connections") | Button: "Clear search" (removes `search`) |
| `inventory-list-page` | `Link → /products` ("Browse products") | Button: "Clear filters" (removes `productId`, `productVariantId`) |
| `listings-list-page` | `Link → /connections` ("Manage connections") | Button: "Clear filters" (removes `search`, `connectionId`, `platformType`) |
| `customers-list-page` | `Link → /orders` ("Browse orders") | Button: "Clear filters" (removes `search`, `lastSourceConnectionId`) |
| `connections-list-page` | **Already has** `Link → /connections/new` — no change | Button: "Clear filters" (removes `platformType`, `status`) |
| `sync-jobs-page` | No CTA (informational — jobs are populated by the system) | Button: "Clear filters" (removes `status`, `jobType`, `connectionId`) |
| `adapters-catalog-page` | No CTA (system-managed registry — user cannot add adapters from UI) | N/A |
| `product-detail-page` stock section | No CTA (informational — stock is sourced from the master, not editable here) | N/A |

**Rationale for exclusions:**
- `sync-jobs` no-filter branch, `adapters-catalog`, and `product-detail` stock section have no meaningful user action; the issue itself flags `sync-jobs` as "Informational only" and offering a fake CTA would be noise.

### Implementation sketch

For each list page, replace

```tsx
<EmptyState
  liveRegion="off"
  title="No X found"
  message={filterActive ? 'filter msg' : 'empty msg'}
/>
```

with

```tsx
<EmptyState
  liveRegion="off"
  title="No X found"
  message={filterActive ? 'filter msg' : 'empty msg'}
  action={
    filterActive ? (
      <Button onClick={clearFilters}>Clear filter(s)</Button>
    ) : (
      <Link className="button button--primary" to="/target">Label</Link>
    )
  }
/>
```

Where `clearFilters` is a small local function that calls `setSearchParams` with the filter keys removed and `offset` dropped, plus — for pages that keep a debounced local input state (products, inventory, listings, customers) — resets the `useState` input mirrors so the toolbar reflects the cleared filter.

**On duplication:** four pages (products / inventory / listings / customers) end up with near-identical `clearFilters` implementations (reset useState mirrors + drop URL params + reset offset). This is accepted as intentional in-page duplication, not a deferred extraction. Rationale: a generic `useClearableSearchParams` hook would need to juggle per-page `useState` mirrors via callbacks, which adds more complexity than it saves for four call sites. Revisit if a fifth page joins the pattern.

For `connections-list-page`, the no-filter branch already has a CTA. Add the filter-active branch; keep the existing CTA intact.

For `sync-jobs-page`, only the filter-active branch gets a button.

## Files to modify

- `apps/web/src/pages/orders/orders-list-page.tsx`
- `apps/web/src/pages/products/products-list-page.tsx`
- `apps/web/src/pages/inventory/inventory-list-page.tsx`
- `apps/web/src/pages/listings/listings-list-page.tsx`
- `apps/web/src/pages/customers/customers-list-page.tsx`
- `apps/web/src/pages/connections/connections-list-page.tsx`
- `apps/web/src/pages/sync-jobs/sync-jobs-page.tsx`

And their corresponding `*.test.tsx` files to add/extend empty-state tests covering both branches.

## Step-by-step implementation

Each page follows the same shape: extract a local `clearFilters` function, pass an `action` node to the existing `EmptyState`, make sure `Link` is imported where needed. One acceptance criterion per page below.

### Step 1 — `orders-list-page.tsx`

- Add `clearFilters()` that calls `setSearchParams` clearing `syncStatus` + `sourceConnectionId` + `offset`.
- Filter-active branch is `Boolean(syncStatus ?? sourceConnectionId)` so the button also appears for URL-driven `sourceConnectionId` filters even though the toolbar doesn't expose an input for it yet.
- `action`: `filterActive ? <Button onClick={clearFilters}>Clear filters</Button> : <Link className="button button--primary" to="/connections">Manage connections</Link>`

Acceptance: with `?syncStatus=failed` and no results → "Clear filters" clears the URL param. With `?sourceConnectionId=X` and no results → same button clears the URL param. Without any filter → a primary-styled link navigates to `/connections`.

### Step 2 — `products-list-page.tsx`

- Add `clearFilters()` that resets the debounced `searchInput` state and calls `setSearchParams` clearing `search` + `offset`.
- `action`: `debouncedSearch ? <Button onClick={clearFilters}>Clear search</Button> : <Link className="button button--primary" to="/connections">Manage connections</Link>`

Acceptance: search with no match → "Clear search" clears both URL param and toolbar input. Empty state with no search → link to `/connections`.

### Step 3 — `inventory-list-page.tsx`

- Add `clearFilters()` that resets `productIdInput`, `variantIdInput` and clears URL params.
- `action`: filters-active → "Clear filters" button; otherwise → `Link → /products` ("Browse products").

Acceptance: filter-active empty → single click clears both filters and toolbar inputs. No-filter empty → link navigates to `/products`.

### Step 4 — `listings-list-page.tsx`

- Add `clearFilters()` covering `searchInput`, `connectionIdInput`, `platformTypeInput` and URL params.
- `action`: filters-active → "Clear filters"; otherwise → `Link → /connections` ("Manage connections").

Acceptance: matches Step 3 pattern.

### Step 5 — `customers-list-page.tsx`

- Add `clearFilters()` covering `searchInput`, `connectionIdInput` and URL params.
- `action`: filters-active → "Clear filters"; otherwise → `Link → /orders` ("Browse orders").

Acceptance: matches Step 3 pattern; primary-link destination is `/orders`.

### Step 6 — `connections-list-page.tsx`

- Existing no-filter CTA stays in place but is upgraded from `className="button"` to `className="button button--primary"` so it matches every other navigation CTA introduced in this PR.
- Add filter-active CTA: `<Button onClick={clearFilters}>Clear filters</Button>` clearing `platformType`/`status` from the URL.

Acceptance: two branches each render a CTA; the "Add the first connection" link is primary-styled; the filter-active button clears both filter params.

### Step 7 — `sync-jobs-page.tsx`

- Add `clearFilters()` that removes `status`, `jobType`, `connectionId`, `offset`.
- `action`: filters-active → "Clear filters" button; no-filter branch → no `action` (informational).
- Trim the trailing "Try clearing some filters." sentence in the filter-active message since a button now provides the action. Grep `sync-jobs-page.test.tsx` for that exact sentence before the change so any test assertion on it is updated in lockstep (Step 8).

Acceptance: filter-active empty → button clears all three filter params. No-filter empty is text-only (unchanged behavior aside from slightly tightened copy).

### Step 8 — Tests

For each of the 7 pages, extend the empty-state test(s) to assert the new CTA. Where there is an existing "empty state with filter message when filters are active" test (customers, listings), add a role-based assertion that a "Clear filters" button (or "Clear search"/"Clear filter") is present. Where only a single "empty state" test exists (orders, products, inventory, sync-jobs), add a second test for the filter-active branch.

For `connections-list-page`, add a filter-active test alongside the existing "empty state" test.

Acceptance: `pnpm --filter @openlinker/web test` passes with new assertions green; no regressions in existing tests.

### Step 9 — Quality gate

```bash
pnpm lint         # zero errors
pnpm type-check   # zero errors
pnpm --filter @openlinker/web test
```

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Clearing filters leaves stale debounced input in local state | Explicitly reset the `useState` mirrors in `clearFilters()` for each affected page. |
| Pages that navigate to a suggested target land on another empty screen | Accept as MVP — the link gives the operator a concrete next move instead of a dead end. The downstream empty state (per this same work) will also have a CTA. |
| CTA wording inconsistency across pages | Standardise: "Clear filters" when N > 1 filters, "Clear filter" / "Clear search" when exactly one scalar param. Use `button button--primary` for navigation links across the board. |
| Adding `action` changes the ARIA live region's text and may re-announce | `EmptyState` already sets `liveRegion="off"` on these pages; unchanged. |

## Open questions

None — issue is prescriptive.

## Out of scope (documented for the PR description)

- `webhook-deliveries-page`, `cursors-list-page`, `failed-orders-page` — outside the issue's scope list; left untouched.
- `product-detail-page` stock section and `adapters-catalog-page` — inside the issue's scope list but have no meaningful user CTA (stock is sourced from the master; adapters are system-registered). Leave as text-only empty states and add a one-line `// No action: …` comment above each `EmptyState` so future readers don't quietly add a CTA without re-checking the rationale.
- No changes to `EmptyState` component itself.
