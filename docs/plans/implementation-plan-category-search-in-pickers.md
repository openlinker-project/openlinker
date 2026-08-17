# Implementation Plan — Wave 2b: category search in the pickers (#2075)

**Issue**: #2075 (Frontend half of Wave 2, epic #1937)
**Depends on**: #2074 (merged — `GET /listings/connections/:id/taxonomy/categories/search`)
**Layer**: Frontend (Interface — feature hooks + components)

---

## 1. Understand the task

Give the operator a category search that spans the **whole tree**, not the level they
happen to be looking at, and render each hit with its root→leaf breadcrumb so it is
intelligible without having drilled to it.

### The issue's file list is wrong, and the defect is worse than described

Two corrections, both verified against the tree at `ab2c96369`:

**(a) `category-picker.tsx` — the issue's primary target — has no production mount.**
Its only references are its own test and a `vi.mock` in `bulk-edit-modal.test.tsx`. It
is not exported from `features/listings/index.ts`. #1741 replaced it with
`BulkCategoryChooseModal`, and the leftover `categoryPickerOpen` state name in
`bulk-edit-modal.tsx:1922` is what makes it *look* mounted at a grep. **Shipping search
into that file would ship it to nobody.**

**(b) The live marketplace picker does not "lack search" — it lies about having one.**
`bulk-category-choose-modal.tsx:156` renders placeholder `"Search categories..."` with
`aria-label="Search categories"`, but L107-110 filters only `nodes`, the current level.
An operator at root typing `Smartfony` gets:

```
No categories match "Smartfony".
```

That is a **false statement rendered as fact** — the category exists, two levels down.
The issue says the pickers have "no search input and no filter logic at all"; that is
true of the *dead* component and false of the live one. The epic's original framing
("filter only the currently-loaded level") was the accurate one. The shop modal is the
same mechanism but honestly labelled (`"Filter this level..."`), so it misleads less.

This reframes the work from "add a feature" to "make an existing promise true".

### The three surfaces that actually matter

| Surface | File | Today | Mounted |
|---|---|---|---|
| Marketplace picker | `listings/components/bulk/bulk-category-choose-modal.tsx` | **Misleading** current-level filter labelled "Search" | `bulk-edit-modal.tsx:1148` (base) + `:2357` (variant) |
| Shop picker | `listings/components/bulk/shop-category-picker-modal.tsx` | Honest current-level filter | `bulk-edit-modal.tsx:3357` |
| Mapping authoring | `mappings/components/AllegroCategorySearch.tsx` | **Named "Search", has none** | `connection-category-mappings-page.tsx:269` |

### Non-goals

- **No change to `CategoryTreeBrowser`** (`shared/ui`). It owns breadcrumb state and has
  its own tests + two consumers; search renders as a *sibling* that replaces it while a
  query is active, not as a new prop on it. Same pattern on all three surfaces.
- **No change to `category-picker.tsx`.** Deleting it is out of scope (separate tech-debt
  call); adding search to it is waste.
- **No merge of the two near-duplicate modals.** They share ~95% of their body but differ
  in select semantics (marketplace: leaf-only; shop: any node). A full extraction is a
  refactor with its own risk; this change extracts only the genuinely shared part.
- **No URL state.** The query lives and dies with the modal (issue's own assumption).

---

## 2. Research findings

- **Backend contract** (`taxonomy.controller.ts`, mine, #2074):
  `GET /listings/connections/:connectionId/taxonomy/categories/search?q=&limit=`
  → `{ category: { id, name, parentId, leaf: boolean | null }, path: { id, name }[] }[]`
  `q` min length **2** (`TAXONOMY_SEARCH_MIN_QUERY_LENGTH`, whose comment already says
  "Mirrored by the FE (#2075)"); `limit` clamped to 100 server-side, default 20.
  The route is **neutral** — scope is resolved from the connection — so one hook serves
  marketplace and shop alike. That is the single biggest simplification available here.
- **Debounce**: `shared/hooks/use-debounced-value.ts` exists and is used by 7 call sites.
  Reuse; do not reinvent.
- **Feature direction**: `listings → mappings` already exists (4 imports);
  `mappings → listings` does **not**. The new hook therefore lands in **`mappings`**,
  alongside the category-browse hooks that already live there — putting it in `listings`
  would create the first `mappings → listings` edge and a feature-level cycle.
- **Test convention**: `renderWithProviders` + `createMockApiClient` from
  `test/test-utils.tsx`; no `vi.mock` of hooks.

---

## 3. Design

### Data layer (feature `mappings`)

1. `mappings.types.ts` — `CategorySearchHit { category: AllegroCategory-shaped; path: CategoryPathNode[] }`.
   Reuses the existing `CategoryPathNode`. `leaf` is `boolean | null` on the wire (null for
   shop nodes) and is normalised to `boolean` at the API boundary (`?? false`) so consumers
   need no null handling — a shop node is never leaf-gated anyway.
2. `mappings.api.ts` — `searchCategories(connectionId, q, limit?)` →
   `GET /listings/connections/${id}/taxonomy/categories/search?q=…&limit=…`.
3. `mappings.query-keys.ts` — `categorySearch(connectionId, q, limit)`.
4. `hooks/use-category-search.ts` — `useCategorySearchQuery(connectionId, query, enabled)`.
   Owns the min-length gate (`enabled && query.length >= MIN`) so no call site can forget it.
   `staleTime` 5 min (shorter than the 1 h browse cache — a search is exploratory).

### Presentation (shared, per the `CategoryTreeBrowser` precedent)

5. `shared/ui/category-search-results.tsx` — presentational only, takes hits as props,
   defines its own local `CategorySearchResultHit` type (exactly how
   `category-tree-browser.tsx` defines `CategoryTreeNode`), so `shared` imports no feature.
   Renders per hit: name, breadcrumb (`Electronics › Phones › Smartphones`), and a Select
   button. `canSelect(hit)` prop carries the per-surface semantics (marketplace leaf-only vs
   shop any-node). Loading / error / two distinct empty states are props-driven.

### The two empty states

The backend returns `[]` for both "nothing synced" and "no matches", so the FE must
distinguish them from context it already has — **without an extra request**:

> at root **and** the browse query returned zero nodes ⇒ *nothing synced yet*;
> anywhere else ⇒ *no matches*.

Correct because a synced scope always has roots, and every modal body mounts at root
(`open ? <Body/> : null` remounts per open), so the root level is always observed first.
This matters: without it the read model's staleness trade-off surfaces to the operator as
a broken search — the same confusion class the issue exists to fix.

### Interaction

Search is **modal-within-modal**: a non-empty debounced query ≥2 chars replaces the
breadcrumb+tree with the flat result list; clearing restores the tree **at its previous
position** (breadcrumb state is untouched while searching — today's code clears `search`
on navigate; the inverse must not happen).

---

## 4. Steps

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `features/mappings/api/mappings.types.ts` | Add `CategorySearchHit` | Type compiles; `leaf` normalised |
| 2 | `features/mappings/api/mappings.api.ts` | Add `searchCategories` to interface + factory | Encodes `q`; omits `limit` when unset |
| 3 | `features/mappings/api/mappings.query-keys.ts` | Add `categorySearch` key | Key varies by `q` + `limit` |
| 4 | `features/mappings/hooks/use-category-search.ts` | New `useCategorySearchQuery` | No request below min length |
| 5 | `features/mappings/index.ts` | Export hook + type | Barrel-only cross-feature import |
| 6 | `shared/ui/category-search-results.tsx` | New presentational component | No feature import; ≥44 px rows |
| 7 | `index.css` | `.category-search-results*` block | Tokens only; drift check passes |
| 8 | `bulk-category-choose-modal.tsx` | Swap local filter → server search | Root-level match found; leaf-only select |
| 9 | `bulk/shop-category-picker-modal.tsx` | Same | Any-node select; `onSelect` gets hit's own path |
| 10 | `mappings/components/AllegroCategorySearch.tsx` | Add the search surface it is named for | Staged-pick flow works from a search hit |
| 11 | `*.test.tsx` ×3 + hook test | Cover: match below loaded level, both empty states, clear-restores-position, min-length gate | All green |
| 12 | `docs/architecture-overview.md` | Wave 2b sentence | Records the misleading-filter fix |

### Shop picker nuance (step 9)

`onSelect(id, pathNames)` currently derives `pathNames` from the *breadcrumb*. A search hit
is not under the current breadcrumb, so it must pass **the hit's own `path`** — otherwise
the chip renders a breadcrumb the category does not have. Same for the marketplace modal.
This is the one place where a naive "just swap the list" would produce wrong data.

---

## 5. Validation

- **Architecture**: `shared/ui` imports no feature (local type, per precedent). Cross-feature
  import via barrel. No new `fetch()`. Feature graph stays acyclic.
- **State**: server → TanStack Query; query string → local `useState` (transient, not linkable).
- **Naming**: `use-category-search.ts`, `category-search-results.tsx`, `*.test.tsx`.
- **Responsive**: result rows follow the documented selection-row treatment (≥44 px tap
  target), not the 36 px `DataTable` row. Mobile/tablet in scope per project preference.
- **A11y**: `role="list"`, `aria-label` on the input, `aria-pressed` on Select, breadcrumb
  `aria-hidden` separators, visible focus rings via `--shadow-focus`.
- **Security**: read-only; no credential surface; `q` is URL-encoded.

### Risks

1. **Two near-duplicate modals** — mitigated by extracting the results list, not the body.
2. **`AllegroCategorySearch` staged-pick** — a search hit must stage with its own path
   string, built from the hit's `path`, not `buildCategoryPath(breadcrumb, node)`.
3. **Scope creep toward deleting `category-picker.tsx`** — explicitly deferred.
