# Implementation Plan — Allegro Category Picker (browse-only v1)

**Issues**: #305 partial (category picker for wizard) · #304 stays open (now has a real second consumer — see §Scope)
**Branch**: `304-305-category-picker-and-shared-primitive`
**Layer mix**: Frontend only. Backend and cache infrastructure already exist.

---

## Scope — major revision after discovery

Codebase discovery during Phase 4 kickoff found that **most of the infrastructure this plan's first draft wanted to build already exists**:

- `GET /connections/:connectionId/allegro/categories?parentId=...` — implemented at `apps/api/src/mappings/http/mapping-options.controller.ts:199`
- Backing service + cache — `apps/api/src/categories/categories-cache.service.ts` with `allegro_category_cache` table, 24h TTL, adapter fan-out via `MarketplacePort.fetchCategories`
- Migration `1779000000001-add-allegro-category-cache-table.ts` applied
- FE query hook — `apps/web/src/features/mappings/hooks/use-allegro-categories.ts` with 1h `staleTime`
- FE type — `AllegroCategory` at `apps/web/src/features/mappings/api/mappings.types.ts:53`
- A browse-based picker — `apps/web/src/features/mappings/components/AllegroCategorySearch.tsx` — exists but is tightly coupled to the mapping-editor UX (staged pick → "Save mapping", `currentMapping` prop, path-string building, allows selecting any level)

**So what actually needs building for #305:**
- A new `CategoryPicker` in `features/listings/components/` that is leaf-only, emits via `onChange(id)` on leaf click (no staged/save intermediate), and is shaped for RHF `Controller` wiring.
- CSS for it.
- Wizard Step 2 wiring.
- Tests.

**Cross-feature import from listings → mappings** (for the query hook + `AllegroCategory` type) is acceptable here — the wizard already imports from `products/` and `connections/` features (see `CreateOfferWizard.tsx:40–42`). The alternative — duplicating the hook/type under listings — is worse.

**#304 scope change**: the existing `AllegroCategorySearch` in `features/mappings/components/` + the new `CategoryPicker` in `features/listings/components/` now give #304 a legitimate second consumer. **This PR does not close #304**; it sets up the condition for a future PR that extracts a shared `CategoryTreeBrowser` primitive into `shared/ui/`. Called out in the PR body.

**#305 scope change**: search-as-you-type still deferred (Allegro adapter doesn't expose it). PR closes #305 only if the user accepts browse-only in review; otherwise `Part of #305`.

---

## 1. Goal

Replace the free-text `overrides.categoryId` input on Step 2 of `CreateOfferWizard` with a browseable category picker that enforces **leaf-only** selection. Reuse the existing backend endpoint and query hook.

### Non-goals

- **Search-as-you-type.** Adapter doesn't expose it.
- **Breadcrumb rehydration for pre-filled IDs.** The picker shows a pre-fill fallback row (monospace ID + "Change" button). Real ancestor-walk is a follow-up tied to #307's retry flow.
- **Extracting shared `CategoryTreeBrowser` primitive.** Closes #304 — not this PR.
- **Touching `AllegroCategorySearch` in mappings.** Stays as-is; its staged-pick UX suits the mapping editor.

---

## 2. Architecture

```
CreateOfferWizard (apps/web/src/features/listings/components)   # Step 2 form field
       ↓  <Controller>
CategoryPicker (NEW — apps/web/src/features/listings/components)
       ↓ query hook import (cross-feature — precedent set)
useAllegroCategoriesQuery (EXISTING — apps/web/src/features/mappings/hooks)
       ↓ useApiClient()
apiClient.mappings.getAllegroCategories (EXISTING)
       ↓ HTTP
GET /connections/:id/allegro/categories?parentId=... (EXISTING)
       ↓
MappingOptionsController → CategoriesCacheService (EXISTING)
       ↓ cache-aside (DB, 24h TTL)
MarketplacePort.fetchCategories (EXISTING — Allegro adapter)
```

---

## 3. Implementation steps

### Step 1 — `CategoryPicker` component
**New file**: `apps/web/src/features/listings/components/CategoryPicker.tsx`

Props:
```typescript
interface CategoryPickerProps {
  connectionId: string;
  value: string | null;
  onChange: (categoryId: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  /** Forwarded from FormField for aria-describedby wiring */
  id?: string;
}
```

Behavior:
- Imports `useAllegroCategoriesQuery` from `../../mappings/hooks/use-allegro-categories` and `AllegroCategory` from `../../mappings/api/mappings.types` (cross-feature — matches wizard's existing pattern).
- Internal breadcrumb state: `useState<Array<{ id: string; name: string }>>([])`. Current `parentId = breadcrumb.at(-1)?.id ?? undefined`.
- Renders:
  1. Pre-fill fallback row (when `value` is non-null and breadcrumb is empty): `<span class="mono-text">{value}</span>` + "Change" button that keeps `value` intact and shows the root list for re-selection.
  2. Breadcrumb row (`<nav aria-label="Category path">`) — "Root" button + current crumbs.
  3. Query-state handling: `LoadingState` / `ErrorState` (with retry) / `EmptyState` / data list.
  4. Category list: clicking a **non-leaf** pushes onto breadcrumb (re-fetch); clicking a **leaf** fires `onChange(id)` and highlights it as selected.
- Uses `aria-invalid={invalid}` and `aria-disabled={disabled}` on the container.
- Tags the root-level container with `id` so `FormField`'s `aria-describedby` wiring works (spec'd in `frontend.md`).

### Step 2 — CSS
**Edit**: `apps/web/src/index.css` (append)

New classes (all token-driven):
- `.category-picker` (container, grid layout)
- `.category-picker__prefill` (the pre-fill fallback row)
- `.category-picker__breadcrumb` (`overflow-x: auto` so deep paths scroll)
- `.category-picker__crumb` (clickable button)
- `.category-picker__list` (scrollable category list, ~320px max-height)
- `.category-picker__item` + `--leaf`, `--selected`, `--non-leaf` modifiers
- `.category-picker[aria-invalid="true"]` state styling for invalid ring

Pattern: mirror spacing/borders/radii of the existing `.allegro-category-search__*` classes so visual consistency is preserved between the two surfaces.

### Step 3 — Wizard integration
**Edit**: `apps/web/src/features/listings/components/CreateOfferWizard.tsx`

Replace the Step 2 `<Input>` for `categoryId` with:

```tsx
<FormField
  label="Allegro category"
  name="categoryId"
  description="Browse and pick a leaf category (no free-text)"
  error={form.formState.errors.categoryId?.message}
>
  <Controller
    control={form.control}
    name="categoryId"
    render={({ field, fieldState }) => (
      <CategoryPicker
        connectionId={currentConnectionId}
        value={field.value ?? null}
        onChange={field.onChange}
        invalid={!!fieldState.error}
      />
    )}
  />
</FormField>
```

Zod schema stays unchanged (`z.string().min(1, ...)` — the picker guarantees non-empty leaf IDs).

### Step 4 — Tests

- **New: `CategoryPicker.test.tsx`** — 6 cases:
  1. Renders root list on mount.
  2. Clicking a non-leaf updates breadcrumb and fetches children.
  3. Clicking a leaf calls `onChange(id)` and shows selected state.
  4. Clicking a crumb jumps back.
  5. Error state with retry button.
  6. Pre-fill fallback row when `value` is non-null with empty breadcrumb; "Change" reveals the root list.

- **Edit: `CreateOfferWizard.test.tsx`** — update happy-path to drill into a leaf category; add regression "won't advance past Step 2 until a leaf is selected."

### Step 5 — Quality gate + commit

`pnpm lint && pnpm type-check && pnpm test` from the worktree root.

---

## 4. File inventory

### New files (2)
- `apps/web/src/features/listings/components/CategoryPicker.tsx`
- `apps/web/src/features/listings/components/CategoryPicker.test.tsx`

### Edited files (3)
- `apps/web/src/features/listings/components/CreateOfferWizard.tsx`
- `apps/web/src/features/listings/components/CreateOfferWizard.test.tsx`
- `apps/web/src/index.css`

**No backend changes. No migrations.**

---

## 5. Global rules

- File header on the new `.tsx` file per `engineering-standards.md` §File Headers.
- No `any`. No `console.log`.
- Token-driven CSS only.
- `aria-invalid` + `aria-describedby` wired through `FormField`.

---

## 6. Acceptance checklist

- [ ] `CategoryPicker` renders root list and drills through breadcrumb
- [ ] Leaf click emits `onChange(id)` with the leaf ID
- [ ] Non-leaf click pushes breadcrumb; crumb click jumps back
- [ ] Pre-fill fallback row shows mono ID + "Change" when `value` non-null on mount
- [ ] Wizard Step 2 uses `CategoryPicker` (no free-text input remains)
- [ ] Wizard tests updated; 6 picker tests pass
- [ ] `pnpm lint && pnpm type-check && pnpm test` all pass
- [ ] No `any`, no `console.log`, file header present
- [ ] PR body accurately reflects: `Part of #305` (browse-only) + `#304 stays open with real second consumer now established`

---

## 7. Follow-ups

- **#305 search-as-you-type** — needs a new adapter method (Allegro name lookup). File on merge.
- **#304 shared primitive extraction** — now has two real consumers (`AllegroCategorySearch` in mappings + `CategoryPicker` in listings). Propose a future PR that extracts `shared/ui/category-tree-browser.tsx`, with `mappings` keeping its staged-pick wrapper and `listings` keeping its leaf-only wrapper. Not this PR.
- **#307 retry flow breadcrumb rehydration** — needs `GET /connections/:id/allegro/categories/:id/ancestors` or similar to rehydrate breadcrumb for a pre-filled ID. Tied to #307.
- **Manual cache invalidation endpoint** — `POST /connections/:id/allegro/categories/invalidate-cache`. Only if operators hit staleness pain.
