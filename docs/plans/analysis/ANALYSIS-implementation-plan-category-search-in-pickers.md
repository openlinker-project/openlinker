# Pre-implement gate — #2075 category search in the pickers

**Verdict: READY** (with two plan revisions applied below; no contract breaks).

## Reuse audit

| Artifact | Verdict | Evidence |
|---|---|---|
| `CategorySearchHit` (mappings.types.ts) | **NEW** | No `*SearchHit` in apps/web. Composes existing `AllegroCategory` (:125) + `CategoryPathNode` (:133) rather than a fresh shape. |
| `searchCategories` on `MappingsApi` | **NEW** | `mappings.api.ts:41` has zero `search*` methods; no taxonomy-search route is called anywhere in apps/web. |
| `categorySearch` query key | **NEW** | No collision (`categories` :19, `allegroCategories` :20, `allegroCategoryPath` :23). |
| `use-category-search.ts` / `useCategorySearchQuery` | **NEW** | Filename free; no such hook. |
| `shared/ui/category-search-results.tsx` | **NEW file, PARTIAL overlap** | Overlaps `CategoryTreeBrowser` (:120) — see Revision 2. |
| `.category-search-results` CSS | **NEW** | Not present; `.category-tree-browser` block at index.css:7628. |

## Contract surfaces — all clear

- **`shared/ui` may NOT import a feature type** — hard ESLint error (`.eslintrc.js:97`), plus a
  domain-agnostic ban on `*allegro*` paths (:121-129). The plan already declares a local
  structural type in the primitive, mirroring `CategoryTreeNode`. **Confirmed correct.**
- **`shared/ui/index.ts` need not export it** — `CategoryTreeBrowser` is itself deep-imported by
  both consumers, so the category primitives already have a deep-import precedent.
- **Cross-feature imports must go through the `features/mappings` barrel** (:203, slug list
  :250-254). `listings` consuming the new hook via the barrel is correct; a deep path errors.
- **`createMockApiClient` is DeepPartial → safe** (`test-utils.tsx:81-90`). Adding a method breaks
  no existing test at type level. **Caveat:** it is `undefined` at runtime, so any test that types
  ≥2 chars into a picker must supply a `searchCategories` override or hit
  `is not a function`.
- **Token drift checker** only enforces `tokens.ts` → `index.css`. Consuming existing `var(--…)`
  tokens is unconstrained; no new token is needed.

## Revision 1 — reject the sibling `allegro*` naming convention

The gate flagged that siblings are `allegroCategories` / `use-allegro-categories.ts`, and that a
bare `categorySearch` "breaks that convention".

**Deliberately not following it.** That prefix is precisely the platform-named legacy epic #1937
exists to remove, and the route being consumed (`/listings/connections/:id/taxonomy/...`, #2074)
is **neutral by construction** — scope resolves from the connection, so the same call serves a
marketplace and a WooCommerce shop. Naming a neutral hook `useAllegroCategorySearch` would make it
unusable-by-name for the shop picker that is one of its three consumers, and would re-introduce the
naming this epic is retiring. Neutral names stand; the divergence is recorded in the file headers.

## Revision 2 — keep the results list a separate primitive, do not extend `CategoryTreeBrowser`

The gate suggested a "results-mode slot" on `CategoryTreeBrowser` instead of a second primitive.
Rejected, on the evidence:

- **Only 1 of the 3 target surfaces uses `CategoryTreeBrowser`** (`AllegroCategorySearch`). The two
  bulk modals hand-roll their own `.bulk-editor__catpick-items` lists. Extending the primitive
  would therefore serve one surface and leave the other two needing the results list anyway —
  the opposite of consolidation.
- The results list is **structurally simpler**, not a variation: no breadcrumb, no drill-in, no
  navigate callback. Flat rows + a derived path label + select. Making the tree primitive
  polymorphic over that adds a mode to a component that currently does one thing well, and its
  documented `key`-remount breadcrumb-reset contract (category-tree-browser.tsx:14-29) is exactly
  the state a search mode must bypass.

A standalone presentational component serves all three uniformly, which is the stronger consistency
argument. Trade-off accepted and recorded in the component header.

## Risks carried into implementation

1. `searchCategories` undefined in DeepPartial mocks → every picker test that searches needs an override.
2. `AllegroCategorySearch` is browse-only despite its name; adding real search **resolves** the
   shadowing rather than deepening it.
3. A search hit is not under the current breadcrumb — `onSelect` must carry the hit's own `path`
   (already the plan's step-9 nuance).
