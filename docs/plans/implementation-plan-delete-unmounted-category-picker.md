# Implementation Plan: Delete the unmounted `CategoryPicker` (superseded by `BulkCategoryChooseModal`)

**Date**: 2026-09-09
**Status**: Draft
**Estimated Effort**: 1–2 hours

**Source issue**: [#2130](https://github.com/openlinker-project/openlinker/issues/2130)

---

## 1. Task Summary

**Objective**: Delete the dead `apps/web/src/features/listings/components/category-picker.tsx` component (and its test), fix the misleading state name it left behind in `bulk-edit-modal.tsx` (`categoryPickerOpen` currently drives the *live* `BulkCategoryChooseModal`, not `CategoryPicker`), and correct three stale prose references that still name `CategoryPicker` as if it were mounted.

**Context**: `#1741` replaced the inline `CategoryPicker` component in the bulk-edit modal's base scope with the external `BulkCategoryChooseModal`, but never removed the old component. Verified in this pass (worktree `adr-2082`, commit `b52d8aa7f`) that the premise still holds exactly:

- `category-picker.tsx` is not exported from `features/listings/index.ts`.
- Its only importer in the whole repo is its own `category-picker.test.tsx`.
- `bulk-edit-modal.tsx:2119` still declares `const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)`, and that state is what opens `BulkCategoryChooseModal` at `bulk-edit-modal.tsx:2634-2643` — so a grep for `CategoryPicker` today returns hits inside the *live* modal file, making the dead component look mounted.
- `bulk-edit-modal.test.tsx:23-27` still stubs `vi.mock('../category-picker', ...)`, a mock for a component the test file doesn't otherwise exercise.
- Three prose references are stale: `bulk-edit-modal.schema.ts:9`, `shared/plugins/plugin.types.ts:693`, `shared/ui/category-tree-browser.tsx:26`. A fourth was found during this research pass and is in scope for the same reason: `bulk-category-choose-modal.tsx:5` ("Replaces the inline `CategoryPicker`...") — accurate as *historical* narration but worth a light touch so it doesn't read as if `CategoryPicker` still exists to be confused with.

Nothing in the listings/category work landed since #2130 was filed (#2075 category search, #2085 destination-taxonomy read model, etc.) touched this file or the modal's state naming — the issue is not stale.

**Classification**: Frontend (Interface layer / feature components) — pure dead-code removal + a rename. No CORE/API/Integration changes.

---

## 2. Scope & Non-Goals

### In Scope
- Delete `apps/web/src/features/listings/components/category-picker.tsx`.
- Delete `apps/web/src/features/listings/components/category-picker.test.tsx`.
- Remove the `vi.mock('../category-picker', ...)` stub from `bulk-edit-modal.test.tsx` and confirm the suite still passes without it (proves the component was truly unmounted — no test depended on its rendered output).
- Rename `categoryPickerOpen` / `setCategoryPickerOpen` → `variantCategoryModalOpen` / `setVariantCategoryModalOpen` in `bulk-edit-modal.tsx` (state that opens `BulkCategoryChooseModal` for the variant-scope override).
- Fix stale prose in:
  - `bulk-edit-modal.schema.ts:9`
  - `shared/plugins/plugin.types.ts:693` (comment on `bulkOfferRowSection`'s neighboring slot)
  - `shared/ui/category-tree-browser.tsx:26`
  - `bulk-category-choose-modal.tsx:5` (light touch — keep the historical framing, name the current component instead of the retired one where it would otherwise read as live)

### Out of Scope
- `CategoryTreeBrowser` (`shared/ui/category-tree-browser.tsx`) — stays; it has a live consumer in `AllegroCategorySearch` (mappings feature). Only its doc comment changes.
- Any change to `BulkCategoryChooseModal`'s behavior, props, or rendering.
- Any change to `#2075`-era category search functionality — already shipped and unaffected.
- Renaming any *other* `category`-adjacent identifiers not named above (e.g. `CategoryParametersStep`, which is untouched and still live).

### Constraints
- No dependency blockers remain: the issue's stated dependency (#2075) has already landed, so this is unblocked today.
- Must not touch git state per explicit instruction: **this plan is executed and validated entirely in the working tree — no `git add`, `git commit`, or `git push`.**

---

## 3. Architecture Mapping

**Target Layer**: Frontend — Interface layer / feature components (`apps/web/src/features/listings/components/`), per `docs/frontend-architecture.md § Components And Pages` and `§ Feature Public Surface`.

**Capabilities Involved**: None (no backend port/capability touched).

**Existing Services Reused**: N/A — no new components, no new hooks, no API surface change.

**New Components Required**: None.

**Core vs Integration Justification**: N/A — this is a pure frontend dead-code removal confined to `apps/web`. No `libs/core`, `libs/integrations`, or `apps/api`/`apps/worker` files are touched.

**Feature Public Surface check** (`docs/frontend-architecture.md § Feature Public Surface`): `category-picker.tsx` was never re-exported from `features/listings/index.ts`, so its deletion has zero impact on the feature's public barrel — no barrel edit needed.

---

## 4. External / Domain Research

Not applicable — no external system involved. This is confined to in-repo frontend files.

### Internal Patterns
- Confirmed via `Grep`/`Read` that `CategoryPicker` (the component) has exactly one production-adjacent reference surface: its own test file, plus 4 stale doc comments (listed above) and 1 mock stub in `bulk-edit-modal.test.tsx`.
- Confirmed the *live* replacement flow: `/products` list page → multi-select → "Publish products (N)" → `/listings/bulk-create/wizard?productIds=...` → `BulkWizard` → Review step (`bulk-review-step.tsx` / `bulk-shop-review-step.tsx`) → `BulkEditModal` → (marketplace branch, `canOverrideCategory` true for a `catalog-implicit` grouping model) → `BulkCategoryChooseModal`, currently gated by the misleadingly-named `categoryPickerOpen` state.
- `bulk-edit-modal.tsx`'s own file-header docblock (lines 1-18) already correctly says the shop branch uses `ShopCategoryPickerModal` and describes the marketplace branch generically ("Rendered by `BulkEditModalForm`") — it does **not** mention `CategoryPicker` by name at the top level, so no change needed there. The stale name only appears in the prop-doc comment at `connection` (line ~237, referencing "Drives the `CategoryPicker` (by id)...") — **this is a fifth stale reference found during research, not listed in the original issue body**, and is added to scope below since it's the same class of problem in the same file.

---

## 5. Questions & Assumptions

### Open Questions
- None blocking. The issue's own "Assumptions" section (no plugin contributes a route mounting `CategoryPicker`; nobody treats it as a reference example) was independently re-verified in this pass via repo-wide grep and holds.

### Assumptions
- The new state name `variantCategoryModalOpen` is a reasonable, non-breaking choice (safe default per the issue's own suggestion of "or similar"). It is local `useState` inside `BulkEditModalForm` — renaming it is a pure identifier rename with no external contract impact (not part of any exported type, prop, or test-observable DOM attribute).
- `bulk-category-choose-modal.tsx:5`'s docblock and `bulk-edit-modal.tsx`'s `connection` prop doc comment (line ~237) are treated as in-scope "stale prose" under the same rationale as the three call outs in the issue, since they were found by the same grep sweep the issue's own AC (`grep -rn "CategoryPicker" apps/web/src`) mandates running to completion.
- No i18n/vocabulary-scan impact: `category-picker.tsx` contains no JSX rendered to an operator screen that would be caught by `scripts/check-ui-vocabulary.mjs` (deleting a component doesn't need a vocabulary-copy migration since none of its copy survives elsewhere).

### Documentation Gaps
None identified — `docs/frontend-architecture.md § Unified publish flow (#1828)` already documents the current `BulkCategoryChooseModal`-based flow accurately; no doc file needs updating as part of this change.

---

## 6. Proposed Implementation Plan

### Phase 1: Delete the dead component and its test

**Goal**: Remove `category-picker.tsx`/`category-picker.test.tsx` and the now-pointless test mock referencing it.

**Steps**:

1. **Delete the component file**
   - **File**: `apps/web/src/features/listings/components/category-picker.tsx`
   - **Action**: Remove the file entirely.
   - **Acceptance**: File no longer exists; `pnpm type-check` for `apps/web` reports no dangling import errors (confirmed by Phase 2/3 below removing the only importer first, or simultaneously).
   - **Dependencies**: None.

2. **Delete the component's test file**
   - **File**: `apps/web/src/features/listings/components/category-picker.test.tsx`
   - **Action**: Remove the file entirely.
   - **Acceptance**: File no longer exists; `pnpm --filter @openlinker/web test` runs with one fewer test suite and no failures from a missing import target.
   - **Dependencies**: Do together with Step 1 (both reference each other; deleting one without the other briefly leaves a dangling import, which is fine since both are removed in the same local changeset before any test run).

3. **Remove the `vi.mock('../category-picker', ...)` stub**
   - **File**: `apps/web/src/features/listings/components/bulk/bulk-edit-modal.test.tsx`
   - **Action**: Delete lines 23-27 (the `vi.mock('../category-picker', () => ({ CategoryPicker: ... }))` block). Also update the file's own docblock (lines 2-10) which currently says "The category picker, parameters query, parameters step, and AI suggestion dialog are stubbed..." — drop "The category picker," since nothing in this test file stubs the (now-deleted) `CategoryPicker` after this change, and the modal under test doesn't render it anyway (the marketplace-branch category chooser is `BulkCategoryChooseModal`, mocked separately if the test needs to isolate it — check Step 4).
   - **Acceptance**: Test file no longer imports/mocks the deleted module; `pnpm --filter @openlinker/web test bulk-edit-modal.test.tsx` passes.
   - **Dependencies**: Step 1 (component file gone) — technically the mock could be removed independently, but doing it after deletion avoids a moment where the mock silently no-ops against a still-present real component.

4. **Verify `bulk-edit-modal.test.tsx` doesn't implicitly rely on the removed mock**
   - **File**: `apps/web/src/features/listings/components/bulk/bulk-edit-modal.test.tsx`
   - **Action**: Run the suite after Step 3. If any test was inadvertently relying on `CategoryPicker` being mocked to a stub (e.g. to suppress a real network call the *live* `BulkCategoryChooseModal` would otherwise make when `categoryPickerOpen`/`variantCategoryModalOpen` flips true), that call path needs its own targeted mock (e.g. mocking the query hook `BulkCategoryChooseModal` uses, or mocking `BulkCategoryChooseModal` itself if the test opens the picker). Per the issue's own Acceptance Criteria: *"if removing it changes nothing, that itself proves the component is unmounted."* If a genuine new failure appears, add the minimal equivalent mock scoped to what's actually rendered today (`BulkCategoryChooseModal`), not a re-introduction of the deleted stub.
   - **Acceptance**: Full `bulk-edit-modal.test.tsx` suite green.
   - **Dependencies**: Step 3.

### Phase 2: Rename the misleading state in `BulkEditModal`

**Goal**: `categoryPickerOpen` no longer exists as a name; the state that drives `BulkCategoryChooseModal` is named for what it opens.

**Steps**:

1. **Rename the state variable and setter**
   - **File**: `apps/web/src/features/listings/components/bulk/bulk-edit-modal.tsx`
   - **Action**: Rename `categoryPickerOpen` → `variantCategoryModalOpen` and `setCategoryPickerOpen` → `setVariantCategoryModalOpen` at all four occurrences:
     - `:2119` — declaration (`const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);`)
     - `:2525` — `onClick={() => setCategoryPickerOpen(true)}`
     - `:2558` — `setCategoryPickerOpen(true);`
     - `:2636` — `onOpenChange={setCategoryPickerOpen}` on `<BulkCategoryChooseModal open={categoryPickerOpen} ...>` (also rename the `open={categoryPickerOpen}` prop value at the same JSX block, line ~2634)
   - **Acceptance**: `grep -n "categoryPickerOpen" apps/web/src` returns zero hits. `pnpm --filter @openlinker/web type-check` passes.
   - **Dependencies**: None (independent of Phase 1, but do after so the file diff is easy to review as "state rename" separate from "delete unrelated file").

2. **Fix the stale prop-doc comment referencing `CategoryPicker`**
   - **File**: `apps/web/src/features/listings/components/bulk/bulk-edit-modal.tsx` (around line 237, the `connection` prop's JSDoc: *"Drives the `CategoryPicker` (by id), the per-row platform section..."*)
   - **Action**: Replace `CategoryPicker` with `BulkCategoryChooseModal` in that sentence.
   - **Acceptance**: No remaining `CategoryPicker` mention in `bulk-edit-modal.tsx` outside of git history.
   - **Dependencies**: None.

### Phase 3: Fix stale prose references elsewhere

**Goal**: Every remaining `CategoryPicker` mention in the repo refers to `ShopCategoryPickerModal` (a genuinely distinct, live component) or is gone.

**Steps**:

1. **`bulk-edit-modal.schema.ts:9`**
   - **File**: `apps/web/src/features/listings/components/bulk/bulk-edit-modal.schema.ts`
   - **Action**: Change `(\`CategoryPicker\`, \`CategoryParametersStep\`)` to `(\`BulkCategoryChooseModal\`, \`CategoryParametersStep\`)` — the sentence is about which components read `categoryId`/`parameters` via `useFormContext()`; `CategoryParametersStep` is still accurate and untouched.
   - **Acceptance**: Comment accurately names the live component.
   - **Dependencies**: None.

2. **`shared/plugins/plugin.types.ts:693`**
   - **File**: `apps/web/src/shared/plugins/plugin.types.ts`
   - **Action**: In the `bulkOfferRowSection`-adjacent doc comment ("...shows the browsable category tree (`CategoryPicker` + category-parameters step) instead of the manual Allegro-category-id input..."), replace `CategoryPicker` with `BulkCategoryChooseModal`.
   - **Acceptance**: Comment accurately names the live component; no behavioral change (this is a plain doc comment on a type, not executable).
   - **Dependencies**: None.

3. **`shared/ui/category-tree-browser.tsx:26`**
   - **File**: `apps/web/src/shared/ui/category-tree-browser.tsx`
   - **Action**: Change "Today's two consumers (CategoryPicker in listings, AllegroCategorySearch in mappings)..." to "Today's two consumers (`BulkCategoryChooseModal` in listings, `AllegroCategorySearch` in mappings)...". Verify `BulkCategoryChooseModal` genuinely renders `CategoryTreeBrowser` (confirm via grep before editing — if it uses a different internal tree component, name that one instead; do not blindly substitute).
   - **Acceptance**: Comment names a real, currently-live consumer.
   - **Dependencies**: None — but **must verify** which component actually imports `CategoryTreeBrowser` today before writing the replacement name (see Phase 4, Step 1 below — this verification is folded into validation).

4. **`bulk-category-choose-modal.tsx:5` (light touch, in scope per research)**
   - **File**: `apps/web/src/features/listings/components/bulk/bulk-category-choose-modal.tsx`
   - **Action**: The sentence "Replaces the inline `CategoryPicker` in the base scope with a dedicated modal..." is accurate *history* (this docblock explains why `BulkCategoryChooseModal` exists) and referencing the retired component by name here is arguably fine as provenance. To avoid any residual ambiguity for a future grep, append a short clarifying clause, e.g.: "...with a dedicated modal (`CategoryPicker` itself was deleted in a later cleanup, #2130)...". Keep this edit minimal — it is explanatory, not a functional fix.
   - **Acceptance**: A future reader grepping `CategoryPicker` and landing here understands immediately that the named component no longer exists.
   - **Dependencies**: None.

### Phase 4: Final validation

**Goal**: Confirm the issue's own Acceptance Criteria are met end-to-end.

**Steps**:

1. **Grep sweep**
   - **Action**: Run `grep -rn "CategoryPicker" apps/web/src`.
   - **Acceptance**: Every remaining hit is either `ShopCategoryPickerModal` (a distinct, correctly-named live component — untouched by this plan) or `BulkCategoryChooseModal` mentions that are part of the corrected prose from Phase 3. Zero hits for the bare, unqualified `CategoryPicker` identifier or unqualified prose mentions of it as if it still exists as a component. (`index.css:8452`, currently reading "Consumed by `CategoryPicker` (listings, leaf-only mode)...", was **not** listed in the original issue but surfaced in the initial research grep — confirm during this sweep whether it also needs the same `BulkCategoryChooseModal` correction, and fix it if so, since it is the same class of stale prose.)
   - **Dependencies**: All prior phases complete.

2. **Confirm no other importer surfaced**
   - **Action**: Re-run `grep -rln "from '.*category-picker'" apps/web/src` (should already be empty post-deletion, since TypeScript compilation would fail first if not).
   - **Acceptance**: Empty result / non-issue because `pnpm type-check` already gates this.

3. **Run the full local quality gate** (per `CLAUDE.md § Quality gate`)
   - **Action**: `pnpm lint`, `pnpm type-check`, `pnpm test` (scoped to `apps/web` is sufficient given the change surface, but running the full monorepo gate is safer and matches project convention).
   - **Acceptance**: All three pass with zero errors. `pnpm lint` additionally exercises `scripts/check-ui-vocabulary.mjs` (irrelevant here — no operator-facing copy changed) and the `no-restricted-imports` ESLint rules (irrelevant — no cross-feature import boundary touched).
   - **Dependencies**: All prior phases.

---

## 7. Alternatives Considered

### Alternative 1: Leave `category-picker.tsx` in place as a "reference example" for a future simple picker
- **Description**: Keep the file (and test) as illustrative code, just fix the misleading state name.
- **Why Rejected**: The issue explicitly states "Nobody is relying on it as an example; `BulkCategoryChooseModal` is the better reference for the same job," and the file's continued presence is what caused #2075 to nearly be scoped against it as if it were live. Dead code that reads as live is actively costly, not neutral — the whole point of the issue.
- **Trade-offs**: None meaningful; keeping it costs future confusion for zero benefit.

### Alternative 2: Rename `categoryPickerOpen` without deleting `category-picker.tsx`
- **Description**: Fix only the misleading-name symptom, leave the root dead file.
- **Why Rejected**: Addresses the proximate confusion (state name vs. modal it drives) but leaves the actual dead code and its dead test in place, which is the primary ask of the issue and the thing that misled #2075's scoping in the first place.
- **Trade-offs**: Smaller diff, but doesn't close the issue's core acceptance criteria (`category-picker.tsx` and its test deleted).

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No hexagonal-architecture layers touched (pure `apps/web` frontend, no `libs/core`).
- ✅ No `docs/frontend-architecture.md § Dependency Rules` violation — deletion removes an import, doesn't add one.
- ✅ No `docs/frontend-architecture.md § Feature Public Surface` impact — `category-picker.tsx` was never barrel-exported.

### Naming Conventions
- ✅ `variantCategoryModalOpen` follows existing `camelCase` boolean-state naming convention (`categoryWarn`, `hasOwnCategory` in the same file are precedent for descriptive boolean-ish state names).

### Existing Patterns
- ✅ Matches the existing sibling pattern: `ShopCategoryPickerModal`'s own gating state in the shop branch is presumably named for the modal it opens (not verified in this pass but consistent naming is the goal, not a strict copy requirement).

### Risks
- **Risk**: A test in `bulk-edit-modal.test.tsx` implicitly depended on the deleted `CategoryPicker` mock suppressing a real network call from `BulkCategoryChooseModal` when the modal is opened during a test interaction.
  - **Mitigation**: Phase 1, Step 4 explicitly calls for running the suite after mock removal and adding a scoped replacement mock only if a genuine new failure appears — never re-adding the deleted stub.
- **Risk**: `category-tree-browser.tsx:26`'s claim that `BulkCategoryChooseModal` is the tree-rendering consumer might be inaccurate if `BulkCategoryChooseModal` delegates to a different internal component that itself wraps `CategoryTreeBrowser`.
  - **Mitigation**: Phase 3, Step 3 requires verifying the actual import chain before writing the replacement name, rather than assuming a 1:1 substitution.
- **Risk**: The `index.css:8452` comment (found during research, not in the original issue) references `CategoryPicker` in a CSS context — could be a class name comment rather than pure prose, meaning the actual CSS class might still be used by `BulkCategoryChooseModal` under an old name.
  - **Mitigation**: Phase 4, Step 1 explicitly calls this out for inspection; if it's a CSS class still in active use (e.g. `.category-picker__...`), only the *comment* should be corrected — do not rename a live CSS class as part of this issue (that would be unrelated scope creep and risk breaking styling).

### Edge Cases
- If `bulk-edit-modal.test.tsx` has no test that ever opens the category-choose modal (i.e. `variantCategoryModalOpen` never flips true during any test), the mock removal is a pure no-op — this is the expected, most-likely outcome per the issue's own framing.

### Backward Compatibility
- ✅ No public API, no exported type, no route, no persisted state (this is transient `useState`, not URL/session/DB state) — zero backward-compatibility surface.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `apps/web/src/features/listings/components/bulk/bulk-edit-modal.test.tsx` — must pass after the mock removal and state rename (rename doesn't change test-observable behavior since `categoryPickerOpen` was never asserted on by name, only by rendered DOM state).
- No new unit tests required — this is a deletion + rename, not new behavior.

### Integration Tests
- None required — no backend surface touched.

### Mocking Strategy
- N/A beyond what's described in Phase 1.

### Acceptance Criteria (from the source issue, restated)
- [ ] `category-picker.tsx` and `category-picker.test.tsx` are deleted
- [ ] `grep -rn "CategoryPicker" apps/web/src` returns only `ShopCategoryPickerModal` hits and corrected `BulkCategoryChooseModal` prose (no stale/dangling mentions of the deleted component as if live)
- [ ] `bulk-edit-modal.tsx`'s state name (`variantCategoryModalOpen`) matches the modal it opens (`BulkCategoryChooseModal`)
- [ ] `bulk-edit-modal.test.tsx` passes without the `vi.mock('../category-picker', ...)` stub
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` green

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A — frontend-only, no layer violation introduced)
- [x] Respects CORE vs Integration boundaries (N/A — no backend touched)
- [x] Uses existing patterns (no unnecessary abstractions) — pure rename + deletion
- [x] Idempotency considered (N/A — no sync/job logic)
- [x] Event-driven patterns used where applicable (N/A)
- [x] Rate limits & retries addressed (N/A)
- [x] Error handling comprehensive (N/A — no new error paths)
- [x] Testing strategy complete
- [x] Naming conventions followed (`docs/frontend-architecture.md § Components And Pages`)
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Frontend Architecture](../frontend-architecture.md) — §§ Feature Public Surface, Components And Pages, Unified publish flow (#1828)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- Source issue: [openlinker-project/openlinker#2130](https://github.com/openlinker-project/openlinker/issues/2130)
