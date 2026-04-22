# Implementation Plan — `CategoryTreeBrowser` Primitive (#304)

**Issue**: #304 (partial close — `VariantPicker`/`ConnectionPicker` extraction stays open)
**Branch**: `304-category-tree-browser-primitive`
**Layer**: Frontend only

---

## 1. Goal

Extract the shared navigation + list + feedback-states machinery from the two existing category browsers into a new **`CategoryTreeBrowser`** primitive in `apps/web/src/shared/ui/`. Refactor both current consumers onto it:

1. `apps/web/src/features/mappings/components/AllegroCategorySearch.tsx` (mapping editor: staged pick → Save, any-level selection)
2. `apps/web/src/features/listings/components/CategoryPicker.tsx` (create-offer wizard: immediate onChange, leaf-only selection, pre-fill fallback)

The two components share ~80% of their JSX and CSS (breadcrumb row, category list, loading/error/empty states). Extraction closes the "cross-feature coupling" concern flagged in PR #313's tech-review and honors the `frontend-architecture.md` rule that shared primitives stay domain-agnostic.

### Non-goals

- **`VariantPicker` / `ConnectionPicker` extraction.** #304 lists both as candidates, but the variant picker today has only one consumer (the wizard) — extracting it still trips the "no one-consumer abstractions" rule. #304 stays partially open with a follow-up. This PR's `Part of #304`.
- **Any behavioral change to either wrapper.** Mapping's staged-pick UX stays identical. Listings' leaf-only + pre-fill + form-control wiring stays identical. Pure refactor.
- **Backend / query-hook changes.** `useAllegroCategoriesQuery` stays where it is. The primitive is a presentation component; consumers call their own query hook and pass data in as props.
- **Search-as-you-type.** Still deferred to #305.

---

## 2. Architecture

```
features/mappings/components                     features/listings/components
  AllegroCategorySearch.tsx (slim wrapper)         CategoryPicker.tsx (slim wrapper)
  ├── useAllegroCategoriesQuery                    ├── useAllegroCategoriesQuery
  ├── staged-pick state                            ├── pre-fill fallback state
  ├── "Save mapping" flow                          ├── form-control a11y wiring
  └─────────────────┬──────────────────────────────┴─────────────────┐
                    ▼                                                ▼
                           shared/ui/category-tree-browser.tsx (NEW)
                           └── breadcrumb state (internal)
                           └── loading / error / empty surfaces
                           └── category list + per-row actions
                           └── `role="group"` + forwarded a11y props
```

**Dependency-rule compliance:** the primitive **does not** import from `features/`. The consumers pass their own query results in as props. Per `frontend-architecture.md` §Dependency Rules — "`shared` must not import `features` or `pages`."

**Type reuse:** the primitive defines its own minimal `CategoryTreeNode` interface (`{ id, name, leaf, parentId }`). The `AllegroCategory` type from `features/mappings/api/mappings.types` is structurally compatible, so consumers just pass their arrays through without mapping.

---

## 3. Primitive API

### `CategoryTreeBrowser`

```typescript
// apps/web/src/shared/ui/category-tree-browser.tsx

export interface CategoryTreeNode {
  id: string;
  name: string;
  leaf: boolean;
  parentId: string | null;
}

export interface CategoryTreeCrumb {
  id: string;
  name: string;
}

export interface CategoryTreeBrowserProps {
  /** Current level's nodes (from the consumer's query). */
  nodes: readonly CategoryTreeNode[] | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry?: () => void;

  /**
   * Fired when the operator clicks the Select button on a node. Primitive
   * decides whether a node is selectable via `canSelect`; non-selectable
   * non-leaf nodes show only the Browse action.
   */
  onSelect: (node: CategoryTreeNode, breadcrumb: readonly CategoryTreeCrumb[]) => void;

  /**
   * Fired every time the breadcrumb depth changes — either by drilling into a
   * non-leaf or by clicking a previous crumb. `parentId` is undefined at root.
   * Consumers use this to change their query's parentId arg.
   */
  onNavigate: (parentId: string | undefined, breadcrumb: readonly CategoryTreeCrumb[]) => void;

  /** Highlight a selected node (leaf-only UI cue). */
  selectedId?: string | null;

  /**
   * Controls which nodes render a Select button. Default: `(n) => n.leaf`.
   * AllegroCategorySearch overrides to `() => true` for any-level selection.
   */
  canSelect?: (node: CategoryTreeNode) => boolean;

  /**
   * Visual density. `compact` enables `overflow-x: auto` on the breadcrumb
   * and tightens spacing — used by the dialog-bounded wizard picker.
   * Default: `'default'`.
   */
  density?: 'default' | 'compact';

  disabled?: boolean;
  invalid?: boolean;

  /** A11y — forwarded to the root `<div role="group">`. */
  id?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;

  className?: string;
}

export const CategoryTreeBrowser: ForwardRefExoticComponent<
  CategoryTreeBrowserProps & RefAttributes<HTMLDivElement>
>;
```

**`forwardRef` is required** per `ui-components.md` §Component Structure ("All shared UI components use `forwardRef`"). Implementation uses the named-function-inside-forwardRef convention:

```typescript
export const CategoryTreeBrowser = forwardRef<HTMLDivElement, CategoryTreeBrowserProps>(
  function CategoryTreeBrowser(props, ref) { /* ... */ }
);
```

**Per-row button labels** are fixed defaults (`Select` / `Selected` / `Browse`). Both current consumers use these — per `ui-components.md` §Implementation rules ("Avoid over-generalized APIs; build only the surface the current product needs"), the three label-override props are deferred until a consumer asks for non-defaults.

### Behavior

- Owns the **breadcrumb state** internally (`useState<CategoryTreeCrumb[]>`). Why: the breadcrumb is pure navigation state, and the two consumers don't need it for anything except rendering + path-string building (handled via the `breadcrumb` callback argument).
- Fires `onNavigate(undefined, [])` when "Root" is clicked; fires `onNavigate(node.id, [...breadcrumb, node])` when drilling into a non-leaf; fires `onNavigate(prev[i].id, prev.slice(0, i+1))` when clicking a crumb.
- Renders `<LoadingState>` / `<ErrorState>` (with Retry button if `onRetry` provided) / `<EmptyState>` / list — in that order based on query state.
- Root element is a `<div role="group">` with forwarded `id`, `aria-labelledby`, `aria-describedby`, `aria-invalid`. This matches `CategoryPicker`'s existing a11y contract.
- `selectedId` highlights the matching leaf row and toggles the Select button label to `Selected` + `aria-pressed`.

### Breadcrumb reset contract

The primitive owns breadcrumb state. If a consumer's identity context changes mid-mount — e.g., a wizard's `connectionId` switches from A to B — the existing breadcrumb would still hold A-connection category IDs, and the next query for B-connection nodes at one of those parent IDs would return empty. **Consumers must force a remount via React `key` when the identity context changes.**

```tsx
// Correct — primitive remounts whenever connectionId changes, discarding stale breadcrumb
<CategoryTreeBrowser key={connectionId} ... />
```

Documented on the component's JSDoc block and exercised in the primitive's tests. Today's two consumers both live inside modals that unmount+remount per open, so they don't need the `key` trick in practice — but the contract is explicit so a future third consumer doesn't silently trip on it.

### What the primitive does **not** do

- Does **not** manage pre-fill fallback (wrapper-specific).
- Does **not** manage staged pick / "Save mapping" UX (wrapper-specific).
- Does **not** call a query hook (controlled component).
- Does **not** build path strings (wrapper does it from the `breadcrumb` callback arg).

---

## 4. Implementation steps

**File headers** on every new `.tsx`/`.ts` file per `engineering-standards.md` §File Headers.

### Step 1 — Build `CategoryTreeBrowser`
**New file**: `apps/web/src/shared/ui/category-tree-browser.tsx`

- Implements the API in §3 — wrapped in `forwardRef<HTMLDivElement, CategoryTreeBrowserProps>` per `ui-components.md` §Component Structure.
- Merges incoming `className` with internal classes (never overrides) per shared-UI convention.
- Internal `breadcrumb` state via `useState`.
- Class structure: `.category-tree-browser`, `__breadcrumb`, `__crumb`, `__crumb-group`, `__separator`, `__list`, `__item`, `__item--leaf`, `__item--non-leaf`, `__item--selected`, `__name`.
- Modifiers: `--density-compact` (wraps `overflow-x: auto` + tighter padding for the wizard's dialog-bounded usage), `--invalid`, `--disabled`.
- JSDoc on the component block documents the §3 breadcrumb-reset contract (consumer uses `key={identityContext}` to force remount when switching connections).

### Step 2 — Tests for the primitive
**New file**: `apps/web/src/shared/ui/category-tree-browser.test.tsx`

9 cases:
1. Renders root nodes from `nodes` prop.
2. Drilling a non-leaf fires `onNavigate(node.id, [...])` with the updated breadcrumb.
3. Clicking a leaf's Select button fires `onSelect(node, breadcrumb)`.
4. Clicking a crumb jumps back and fires `onNavigate` with the truncated breadcrumb.
5. Loading / error (with Retry) / empty states render based on props.
6. `canSelect={() => true}` makes **non-leaves** also show Select (any-level selection mode — exercises the mappings wrapper's use case).
7. `disabled` propagates to all interactive controls; `invalid` + ARIA props forward to the root group.
8. **forwardRef target** — `ref.current` points to the root `<div>` (standard shared-UI test per `ui-components.md` §Testing).
9. **className merge** — custom `className` coexists with internal classes on the root (standard shared-UI test).

### Step 3 — New CSS for the primitive
**Edit**: `apps/web/src/index.css`

Add a `.category-tree-browser__*` block under the existing shared-primitive section. Token-driven. Rules are the union of the two existing near-duplicate class sets:

```css
.category-tree-browser { ... }
.category-tree-browser--invalid { border-color: var(--status-error-border); background: var(--status-error-soft); }
.category-tree-browser--disabled { opacity: 0.6; pointer-events: none; }
.category-tree-browser--density-compact .category-tree-browser__breadcrumb {
  overflow-x: auto;
  padding: 0.25rem 0;
}
.category-tree-browser__breadcrumb { ... }
.category-tree-browser__crumb { ... }
.category-tree-browser__crumb-group { ... }
.category-tree-browser__separator { ... }
.category-tree-browser__list-container { max-height: 20rem; overflow-y: auto; }
.category-tree-browser__list { ... }
.category-tree-browser__item { ... }
.category-tree-browser__item--leaf, .__item--non-leaf { /* styling hooks */ }
.category-tree-browser__item--selected { background: var(--accent-primary-soft); }
.category-tree-browser__name { ... }
```

### Step 4 — Refactor `CategoryPicker` onto the primitive
**Edit**: `apps/web/src/features/listings/components/CategoryPicker.tsx`

- Keep the public prop surface identical (`connectionId`, `value`, `onChange`, `invalid`, `disabled`, `id`, `aria-*`).
- Keep the `showBrowser` pre-fill state + `.category-picker__prefill` fallback row — wrapper-specific.
- Manage a local `parentId` state (mirrored from the primitive's `onNavigate` callback) so the query hook can refetch.
- Call `useAllegroCategoriesQuery(connectionId, parentId, showBrowser)`.
- Render `<CategoryTreeBrowser key={connectionId} density="compact" canSelect={(n) => n.leaf} selectedId={value} onSelect={(node) => onChange(node.id)} onNavigate={(pid) => setParentId(pid)} ... />`.
- The `key={connectionId}` honors the §3 breadcrumb-reset contract — if the wizard ever lets the operator switch connections mid-session, the primitive remounts cleanly.
- Forward all a11y props through.
- Wrapper JSX shrinks from ~200 → ~80 lines.

### Step 5 — Refactor `AllegroCategorySearch` onto the primitive
**Edit**: `apps/web/src/features/mappings/components/AllegroCategorySearch.tsx`

- Keep the public prop surface identical (`marketplaceConnectionId`, `currentMapping`, `onSelect`, `onClear`, `isSaving`).
- Keep `.allegro-category-search__current` + `.allegro-category-search__staged` + staged-pick UX — wrapper-specific.
- Manage local `parentId` state; query hook uses it.
- Wrap `<CategoryTreeBrowser key={marketplaceConnectionId} canSelect={() => true} onSelect={(node, breadcrumb) => setStaged({ category: node, path: buildPath(breadcrumb, node) })} disabled={isSaving} ... />`.
- Build the path string from the `breadcrumb` callback arg: `[...breadcrumb.map((b) => b.name), node.name].join(' > ')`.
- Wrapper JSX shrinks.

### Step 6 — Purge duplicate CSS
**Edit**: `apps/web/src/index.css`

Remove the now-dead rules from both old class sets (keep only the wrapper-specific parts):

**Delete** from `.allegro-category-search__*`:
- `__breadcrumbs`, `__crumb`, `__separator`, `__list`, `__item`, `__item--staged`, `__name`, `__actions`
- `__item:last-child` (primitive's `__item:last-child` covers it)

**Keep** in `.allegro-category-search__*`:
- `__current`, `__staged`, `__staged-label`, `__staged-actions`, `__path` (wrapper-owned surfaces)

**Delete** from `.category-picker__*`:
- `__breadcrumb`, `__crumb`, `__crumb-group`, `__separator`, `__list-container`, `__list`, `__item`, `__item--leaf`, `__item--non-leaf`, `__item--selected`, `__name`
- Dead-hook comment for `--leaf`/`--non-leaf` (primitive owns those now)

**Keep** in `.category-picker__*`:
- `.category-picker` (root wrapper — now used only for the pre-fill variant)
- `.category-picker--prefill`, `__prefill`, `__prefill-label`

Expected line delta: `+~140` from the new primitive block, `−~80` from the purged duplicates → net `+~60` lines of CSS.

### Step 7 — Update tests

- **`category-tree-browser.test.tsx`** (new) — per Step 2.
- **`CategoryPicker.test.tsx`** (edit) — 9 existing cases. All should still pass since the wrapper's public surface is unchanged. Likely tweaks:
  - Selectors that match primitive-owned markup (`.category-picker__breadcrumb`) may need to switch to the new `.category-tree-browser__breadcrumb` — prefer role-based queries (`role="group"`, `aria-label="Category path"`) where possible.
  - The "forwards aria-labelledby…" test currently inspects `.category-picker` root; after refactor the primitive's root inherits those props, so the test queries the primitive's root instead. Same assertion, different DOM target.
- **`CreateOfferWizard.test.tsx`** — no change expected; all tests use role/name-based queries.
- **`AllegroCategorySearch`** has no existing tests. **Add a 5-case smoke test suite *before* the refactor** so the assertions encode the current behavior — the test then catches regressions from the primitive swap. Cases:
  1. Renders the root list from the mocked query.
  2. Drilling a non-leaf updates the breadcrumb and loads the drilled level.
  3. Clicking Select on a leaf stages the pick and shows the `__staged` row with the built path (e.g., "Electronics > Phones").
  4. Clicking Save fires `onSelect(category, "Electronics > Phones")` with the correct path string built from the breadcrumb.
  5. Clicking Cancel dismisses the staged pick without firing `onSelect`.

### Step 8 — Quality gate
`pnpm lint && pnpm type-check && pnpm test` from the worktree root.

---

## 5. File inventory

### New files (3)
- `apps/web/src/shared/ui/category-tree-browser.tsx`
- `apps/web/src/shared/ui/category-tree-browser.test.tsx`
- `apps/web/src/features/mappings/components/AllegroCategorySearch.test.tsx` *(new smoke test)*

### Edited files (4)
- `apps/web/src/features/listings/components/CategoryPicker.tsx` *(refactored)*
- `apps/web/src/features/listings/components/CategoryPicker.test.tsx` *(selector updates if any)*
- `apps/web/src/features/mappings/components/AllegroCategorySearch.tsx` *(refactored)*
- `apps/web/src/index.css` *(new primitive block + dead-rule purge)*

---

## 6. Risks & open questions

| Risk | Mitigation |
|---|---|
| Refactoring `AllegroCategorySearch` without existing tests is risky. | Add a smoke test covering the drill → stage → save round-trip before refactoring, so we have a regression guard. |
| Primitive API over-fits to today's two consumers. | Keep it minimal — no features that aren't used by either wrapper. `canSelect` + label overrides cover both shapes. If a third consumer surfaces with different needs, iterate then. |
| Breadcrumb state owned internally could make pre-fill rehydration harder later (for #307's retry flow). | When #307 needs it, add an `initialBreadcrumb?` prop. Out of scope here. |
| CSS rule shuffling causes visual regressions. | Run both consuming pages (`/listings`, `/connections/:id/mappings`) in the dev server after the refactor. Token-only CSS so no hex drift. |
| `AllegroCategory` type lives in `features/mappings` — new primitive can't import it. | Primitive defines its own `CategoryTreeNode` interface (structural match). Consumers pass their arrays through; TS narrowing handles compatibility. Documented in step 1. |

---

## 7. Global rules

- File headers on every new `.tsx`/`.ts` file.
- No `any`. No `console.log`.
- Token-driven CSS only.
- Primitive wrapped in `forwardRef<HTMLDivElement, ...>` per `ui-components.md` §Component Structure ("All shared UI components use `forwardRef`"). Uses the named-function-inside-forwardRef convention for DevTools clarity.
- Primitive merges incoming `className` with internal classes (never overrides) — standard `shared/ui/` convention.
- Primitive uses `density` (not `tone`) for the default/compact variant. `tone` stays reserved for color/status axes per `ui-components.md` §Prop Naming.

---

## 8. Acceptance checklist

- [ ] `CategoryTreeBrowser` primitive in `shared/ui/` — no imports from `features/` or `pages/`
- [ ] Primitive is wrapped in `forwardRef` with named inner function
- [ ] `density` prop (not `tone`) for default/compact variant
- [ ] Breadcrumb-reset contract documented in JSDoc; both consumers pass `key={connectionId}`
- [ ] Both `CategoryPicker` and `AllegroCategorySearch` refactored to compose it
- [ ] No public-surface changes to either wrapper
- [ ] 9 new primitive tests pass (includes ref-forwarding + className-merge)
- [ ] Existing `CategoryPicker.test.tsx` (9 cases) still pass
- [ ] New `AllegroCategorySearch.test.tsx` 5-case smoke suite written **before** the refactor; passes after
- [ ] `pnpm lint` — 0 errors
- [ ] `pnpm type-check` — 0 errors
- [ ] `pnpm test` — all green
- [ ] CSS block: new `.category-tree-browser__*` rules added; duplicates purged from both wrapper blocks; net diff ~+60 lines
- [ ] **Visual verification**: before/after screenshots of `/connections/:id/mappings` at desktop (1440×900) per `frontend-ui-style-guide.md` §Responsive
- [ ] **Visual verification**: before/after screenshots of the create-offer wizard Step 2 at desktop (1440×900)
- [ ] PR body: `Part of #304` (not `Closes`) — `VariantPicker` still awaiting a second consumer
