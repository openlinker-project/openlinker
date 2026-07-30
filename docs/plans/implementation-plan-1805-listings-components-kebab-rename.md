# Implementation Plan: Rename PascalCase `listings` component files to kebab-case

**Date**: 2026-07-27
**Status**: Ready for Review
**Estimated Effort**: 1–2 hours

**Issue**: [#1805](https://github.com/openlinker-project/openlinker/issues/1805)

---

## 1. Task Summary

**Objective**: Rename the last 10 PascalCase-named component files (plus their 7 `*.test.tsx` counterparts) in `apps/web/src/features/listings/components/` to kebab-case, and update every import/export site that references the old filenames. No behavioural change; exported identifiers stay `PascalCase`.

**Context**: `docs/frontend-architecture.md` § Components And Pages mandates `kebab-case.tsx` filenames (exported identifier stays `PascalCase`). Newer files in this directory already follow the rule; a set of legacy files predating the convention do not. This was intentionally spun out of PR #1774 (#1754 offer-creation-wizard unification) to keep that PR's diff focused.

**Answering the actual question ("is there a lot to fix here?")**: No — this is small and mechanical. Verified against the live tree:
- 10 component files + 7 co-located test files = **17 files to rename**.
- **2 files listed in the issue no longer exist** (`AllegroCreateOfferWizard.tsx`, `OfferCreationLauncher.tsx`) — both were removed by the #1754 wizard-unification work that landed after the issue was filed. The plan below reflects the current tree, not the (now stale) issue file list.
- **~9 real import/export sites** need a path-string edit (see Phase 2). Everything else that matches the old names in a repo-wide grep is either a same-directory self-reference (moves together with the rename) or a prose mention inside a comment/docstring (no code change needed).

**Classification**: Frontend / Interface (feature components) — mechanical rename, no new components, no port/service/architecture changes.

---

## 2. Scope & Non-Goals

### In Scope
- Renaming the 17 files listed in Phase 1 below.
- Updating every import/export statement and `vi.mock()` path string that references an old filename.
- Re-running `pnpm lint`, `pnpm type-check`, `pnpm test` to confirm zero regressions.

### Out of Scope
- Any change to exported component names, props, or behavior.
- Renaming PascalCase files **outside** `features/listings/components/`. A repo-wide check (see § 4) found a substantial amount of similar PascalCase drift elsewhere (`features/connections/components/`, `features/mappings/components/`, `features/auth/components/`, `pages/auth/*Page.tsx`, `features/sync-jobs/components/SyncJobStatusBadge.tsx`, `TriggerSyncDialog.tsx`, etc. — 20 files). The issue's own "Assumptions" section states no such drift was found elsewhere at filing time; that assumption is now stale. Re-scoping to fix all of it here would reproduce exactly the "unrelated large diff" problem #1805 was spun out to avoid, so it's flagged as a **new finding for a follow-up issue**, not pulled into this change.
- Comment/docstring prose that merely *mentions* a component name (e.g. `bulk-edit-modal.schema.ts`'s reference to `CategoryPicker`, `SyncJobStatusBadge.tsx`'s reference to `OfferCreationTracker`) — these refer to the exported identifier, which is unchanged, not the filename.

### Constraints
- Zero behavioral change — pure rename + import-path update.
- Must not touch CORE/backend — n/a, this is FE-only.

---

## 3. Architecture Mapping

**Target Layer**: Frontend / Interface (feature components), per `docs/frontend-architecture.md` § Folder Conventions and § Components And Pages.

**Capabilities Involved**: None — no port, service, or API-contract change.

**Existing Services Reused**: N/A.

**New Components Required**: None — this is a rename of existing components, not new work.

**Core vs Integration Justification**: N/A (frontend-only, no backend/core touch).

---

## 4. External / Domain Research

### Internal Patterns
Confirmed against the live tree (not just the issue body, which predates #1774/#1754 landing):

**Files to rename** (`apps/web/src/features/listings/components/`):

| Current | Target | Has test file? |
|---|---|---|
| `CategoryPicker.tsx` | `category-picker.tsx` | yes |
| `EditOfferDrawer.tsx` | `edit-offer-drawer.tsx` | yes |
| `OfferCreationErrorList.tsx` | `offer-creation-error-list.tsx` | yes |
| `OfferCreationStatusBadge.tsx` | `offer-creation-status-badge.tsx` | yes |
| `OfferCreationTracker.tsx` | `offer-creation-tracker.tsx` | yes |
| `OfferDescriptionEditor.tsx` | `offer-description-editor.tsx` | no |
| `OfferPublicationStatusBadge.tsx` | `offer-publication-status-badge.tsx` | no |
| `ShopPublishLauncher.tsx` | `shop-publish-launcher.tsx` | yes |
| `ShopPublishTracker.tsx` | `shop-publish-tracker.tsx` | no |
| `WoocommercePublishWizard.tsx` | `woocommerce-publish-wizard.tsx` | yes |

`AllegroCreateOfferWizard.tsx` and `OfferCreationLauncher.tsx` (listed in the issue body) do not exist in the current tree — confirmed via repo-wide grep — so they are dropped from this plan.

**Real import/export sites requiring a path-string edit** (repo-wide grep, cross-checked against actual `import`/`export`/`vi.mock` statements, not comment mentions):

1. `apps/web/src/pages/listings/listing-detail-page.tsx` — imports `EditOfferDrawer`, `OfferCreationErrorList`, `OfferCreationStatusBadge` (3 import statements).
2. `apps/web/src/pages/sync-jobs/sync-job-detail-page.tsx` — imports `OfferCreationTracker`.
3. `apps/web/src/pages/listings/listings-list-page.tsx` — imports `ShopPublishLauncher`.
4. `apps/web/src/features/listings/index.ts` — re-exports `WoocommercePublishWizard` from `./components/WoocommercePublishWizard`.
5. `apps/web/src/features/listings/components/OfferCreationTracker.tsx` (itself being renamed) — imports `OfferCreationErrorList` and `OfferCreationStatusBadge` from `./`.
6. `apps/web/src/features/listings/components/EditOfferDrawer.tsx` (itself being renamed) — imports `OfferDescriptionEditor` from `./`.
7. `apps/web/src/features/listings/components/offer-publication-status-panel.tsx` — imports `OfferPublicationStatusBadge` from `./`.
8. `apps/web/src/features/listings/components/ShopPublishLauncher.tsx` (itself being renamed) — imports `ShopPublishTracker` from `./`.
9. `apps/web/src/features/listings/components/bulk/bulk-edit-modal.test.tsx` — `vi.mock('../CategoryPicker', …)` mock path string.

Every renamed `*.test.tsx` file also has a self-import of its own subject component (`import { X } from './X'`) — these are updated as part of the same file's rename, not counted separately above.

**No-op mentions found by grep but requiring no edit** (comment/docstring text referencing the exported identifier, which doesn't change):
`bulk-category-choose-modal.tsx`, `bulk-edit-modal.schema.ts`, `bulk-edit-modal.tsx`, `plugin.types.ts` (×2), `shared/ui/category-tree-browser.tsx`, `edit-offer-fields.schema.ts`, `OfferPublicationStatusBadge.tsx`'s own docstring, `sync-jobs/components/SyncJobStatusBadge.tsx`, `sync-job-detail-page.tsx`'s own comment, `ShopPublishLauncher.tsx`'s own docstring, `ShopPublishLauncher.test.tsx`'s own docstring, `plugins/woocommerce/index.ts` (imports `WoocommercePublishWizard` the *identifier*, from the `features/listings` barrel — unaffected since the barrel export path itself doesn't change, only its internal target).

### External System
N/A — no external system involved.

---

## 5. Questions & Assumptions

### Open Questions
- None blocking. See the flagged wider-drift finding below.

### Assumptions
- Renamed files keep their current directory (`features/listings/components/`); only filename casing changes — confirmed by the issue and unchanged in this plan.
- `git mv` preserves file history correctly on a case-sensitive filesystem (Linux dev/CI) — no case-collision two-step rename needed since old and new names differ in more than case.

### Documentation Gaps / Findings To Flag
- The issue's "Assumptions" section states no other PascalCase drift exists outside `features/listings/components/` at filing time. That's no longer accurate — a repo-wide scan found ~20 more PascalCase-named `.tsx` files (`features/connections/components/*`, `features/mappings/components/*`, `features/auth/components/*`, `pages/auth/*Page.tsx`, `features/sync-jobs/components/SyncJobStatusBadge.tsx` + `TriggerSyncDialog.tsx`, `features/customers/components/CustomerEntityLabel.tsx`, `features/allegro/components/AllegroSetupForm.tsx`). Recommend filing a follow-up tech-debt issue for a second sweep rather than expanding this one, per the same "keep the diff focused" rationale #1805 was itself spun out from.

---

## 6. Proposed Implementation Plan

### Phase 1: Rename files (git mv, preserve history)
**Goal**: Move all 17 files to their kebab-case names without touching content yet.

**Steps** (all under `apps/web/src/features/listings/components/`):
1. `git mv CategoryPicker.tsx category-picker.tsx && git mv CategoryPicker.test.tsx category-picker.test.tsx`
2. `git mv EditOfferDrawer.tsx edit-offer-drawer.tsx && git mv EditOfferDrawer.test.tsx edit-offer-drawer.test.tsx`
3. `git mv OfferCreationErrorList.tsx offer-creation-error-list.tsx && git mv OfferCreationErrorList.test.tsx offer-creation-error-list.test.tsx`
4. `git mv OfferCreationStatusBadge.tsx offer-creation-status-badge.tsx && git mv OfferCreationStatusBadge.test.tsx offer-creation-status-badge.test.tsx`
5. `git mv OfferCreationTracker.tsx offer-creation-tracker.tsx && git mv OfferCreationTracker.test.tsx offer-creation-tracker.test.tsx`
6. `git mv OfferDescriptionEditor.tsx offer-description-editor.tsx`
7. `git mv OfferPublicationStatusBadge.tsx offer-publication-status-badge.tsx`
8. `git mv ShopPublishLauncher.tsx shop-publish-launcher.tsx && git mv ShopPublishLauncher.test.tsx shop-publish-launcher.test.tsx`
9. `git mv ShopPublishTracker.tsx shop-publish-tracker.tsx`
10. `git mv WoocommercePublishWizard.tsx woocommerce-publish-wizard.tsx && git mv WoocommercePublishWizard.test.tsx woocommerce-publish-wizard.test.tsx`

**Acceptance**: `git status` shows 17 renames (`R`), no content diff yet; `ls apps/web/src/features/listings/components/` has zero remaining PascalCase `.tsx` files.

### Phase 2: Fix import/export/mock paths
**Goal**: Every reference to an old filename now points at the new one. Exported identifiers (`CategoryPicker`, `EditOfferDrawer`, etc.) are untouched — only the module path string changes.

**Steps**:
1. **`apps/web/src/pages/listings/listing-detail-page.tsx`** — update 3 import paths: `.../EditOfferDrawer` → `.../edit-offer-drawer`, `.../OfferCreationErrorList` → `.../offer-creation-error-list`, `.../OfferCreationStatusBadge` → `.../offer-creation-status-badge`.
2. **`apps/web/src/pages/sync-jobs/sync-job-detail-page.tsx`** — update import path `.../OfferCreationTracker` → `.../offer-creation-tracker`.
3. **`apps/web/src/pages/listings/listings-list-page.tsx`** — update import path `.../ShopPublishLauncher` → `.../shop-publish-launcher`.
4. **`apps/web/src/features/listings/index.ts`** — update re-export path `./components/WoocommercePublishWizard` → `./components/woocommerce-publish-wizard`.
5. **`apps/web/src/features/listings/components/offer-creation-tracker.tsx`** — update its own two same-dir imports (`./OfferCreationErrorList` → `./offer-creation-error-list`, `./OfferCreationStatusBadge` → `./offer-creation-status-badge`).
6. **`apps/web/src/features/listings/components/edit-offer-drawer.tsx`** — update `./OfferDescriptionEditor` → `./offer-description-editor`.
7. **`apps/web/src/features/listings/components/offer-publication-status-panel.tsx`** — update `./OfferPublicationStatusBadge` → `./offer-publication-status-badge`.
8. **`apps/web/src/features/listings/components/shop-publish-launcher.tsx`** — update `./ShopPublishTracker` → `./shop-publish-tracker`.
9. **Each renamed `*.test.tsx` file's own self-import** (`./CategoryPicker` etc.) — update to the new kebab-case path, one per file (7 files).
10. **`apps/web/src/features/listings/components/bulk/bulk-edit-modal.test.tsx`** — update `vi.mock('../CategoryPicker', ...)` → `vi.mock('../category-picker', ...)`.

**Acceptance**: `grep -rn "components/CategoryPicker\|components/EditOfferDrawer\|components/OfferCreation\|components/OfferDescriptionEditor\|components/OfferPublicationStatusBadge\|components/ShopPublish\|components/WoocommercePublishWizard\|'\./CategoryPicker'\|'\./EditOfferDrawer'\|'\./OfferCreation\|'\./OfferDescriptionEditor'\|'\./OfferPublicationStatusBadge'\|'\./ShopPublish'\|'\./WoocommercePublishWizard'" apps/web/src` returns zero matches for import/export/mock statements (comment-only mentions of the *identifier* — not a `./Xxx` or `components/Xxx` path — are expected to remain and are fine).

### Phase 3: Verify
**Goal**: Confirm zero regressions.

**Steps**:
1. `pnpm --filter @openlinker/web lint` (or repo-root `pnpm lint` if the invariant scripts need the full workspace) — zero errors.
2. `pnpm --filter @openlinker/web type-check` — zero errors.
3. `pnpm --filter @openlinker/web test` — all existing tests pass unchanged (same test count, same assertions — only file paths moved).

**Acceptance**: All three commands exit 0. No test file content changed beyond the one import-path line each.

### Implementation Details

**New Components**: None.

**Configuration Changes**: None.

**Database Migrations**: None — confirmed, this is FE-only and touches no ORM entity.

**Events**: None emitted or consumed.

**Error Handling**: N/A — no new logic.

---

## 7. Alternatives Considered

### Alternative 1: Fold the wider PascalCase drift (connections, mappings, auth, sync-jobs — ~20 more files) into this same PR
- **Description**: Since the repo scan surfaced more drift than the issue anticipated, fix all of it in one sweep now.
- **Why Rejected**: The issue itself was spun out of #1774 specifically to avoid an "unrelated large diff on a focused UX change." Rolling in ~20 more unrelated files reproduces the exact problem #1805 exists to prevent, and spans multiple unrelated feature directories with their own review context.
- **Trade-offs**: Slightly defers full convention compliance, but keeps this PR reviewable and matches the issue's own stated scope.

### Alternative 2: Rename files via plain `mv` + re-add
- **Description**: Use filesystem `mv` and `git add -A` instead of `git mv`.
- **Why Rejected**: `git mv` is equivalent but self-documenting in the diff and is the standard tool for this; no reason to deviate.
- **Trade-offs**: None — purely a tooling preference, `git mv` is strictly better here.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No layer boundaries touched; pure filename + import-path change within the existing `features/listings/components/` folder, consistent with `docs/frontend-architecture.md` § Components And Pages.

### Naming Conventions
- ✅ Target names match the documented rule (`kebab-case.tsx` filename, `PascalCase` exported identifier unchanged) and mirror the sibling files already renamed in the same directory (`offer-publication-status-panel.tsx`, `category-parameters-step.tsx`, etc.).

### Existing Patterns
- ✅ Matches the pattern the issue itself points to (sibling kebab-case files in the same directory).

### Risks
- **Missed import site**: mitigated by the repo-wide grep in § 4 cross-checked against actual `import`/`export`/`vi.mock` statement text (not just substring hits), plus the Phase 2 zero-match verification grep and a full `type-check` pass (a missed import breaks the build immediately — TypeScript module resolution is exhaustive here, so this risk is self-catching).
- **Barrel re-export drift**: `features/listings/index.ts`'s public export name (`WoocommercePublishWizard`) is unaffected — only its internal `./components/...` path changes, so downstream consumers (`plugins/woocommerce/index.ts`) that import from the feature barrel need no change. Confirmed in § 4.

### Edge Cases
- Two files named in the original issue body no longer exist (`AllegroCreateOfferWizard.tsx`, `OfferCreationLauncher.tsx`) — handled by simply excluding them; no action needed since there's nothing to rename.
- Files with no co-located test (`OfferDescriptionEditor.tsx`, `OfferPublicationStatusBadge.tsx`, `ShopPublishTracker.tsx`) — only the `.tsx` is moved, no test-file step for those three.

### Backward Compatibility
- ✅ No public contract change. Exported identifiers, props, and the feature's public barrel (`features/listings/index.ts`) export name are unchanged — only internal file paths move.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- No new tests needed — this is a rename, not new logic. Existing tests (`*.test.tsx`, now kebab-case) must pass unmodified except for their own one-line self-import path fix.
- **Files**: all 7 renamed `*.test.tsx` files under `apps/web/src/features/listings/components/`.

### Integration Tests
- N/A — no FE integration-test suite exists for this slice; frontend testing baseline (`docs/frontend-architecture.md` § Testing Baseline) only requires `lint` / `type-check` / `test`.

### Mocking Strategy
- Unchanged — `bulk-edit-modal.test.tsx`'s existing `vi.mock('../category-picker', ...)` (path updated) continues mocking the same module by its new path.

### Acceptance Criteria
- [ ] All 10 PascalCase component files (and their 7 `*.test.tsx` counterparts) are renamed to kebab-case via `git mv`
- [ ] All ~9 real import/export/mock-path sites are updated (per § 6 Phase 2)
- [ ] Exported component identifiers are unchanged (still `PascalCase`)
- [ ] `pnpm lint` passes with zero errors
- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with no regressions (same test count as before the rename)
- [ ] No architecture boundary violations — confirmed n/a, no CORE/backend touch
- [ ] No documentation update needed — confirmed, this implements the existing documented rule rather than changing it

**Reference**: [Testing Guide](../testing-guide.md)

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — n/a (FE-only, no layer change)
- [x] Respects CORE vs Integration boundaries — n/a (no backend touch)
- [x] Uses existing patterns (no unnecessary abstractions) — matches sibling kebab-case files already in the directory
- [x] Idempotency considered — n/a (no runtime behavior)
- [x] Event-driven patterns used where applicable — n/a
- [x] Rate limits & retries addressed — n/a
- [x] Error handling comprehensive — n/a (no new logic)
- [x] Testing strategy complete — existing tests re-verified post-rename, zero new tests needed
- [x] Naming conventions followed — this change *is* the naming-convention fix
- [x] File structure matches standards — target state matches `docs/frontend-architecture.md` § Components And Pages
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Frontend Architecture](../frontend-architecture.md) — § Components And Pages (the rule this issue implements)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
