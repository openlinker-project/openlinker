# Implementation Plan: Fix invisible connection-name line in marketplace picker modal

**Date**: 2026-07-09
**Status**: Implemented (scope expanded during manual verification — see §11 Implementation Addendum)
**Estimated Effort**: < 30 minutes (original scope); ~1 hour actual (three additional layout bugs surfaced during live visual verification)

---

## 1. Task Summary

**Objective**: Fix `.marketplace-picker__name` (the connection-name line in `MarketplacePickerModal`) rendering at near-invisible contrast in both light and dark themes, by giving it an explicit `color: var(--text-primary)`.

**Context**: Issue [#1438](https://github.com/openlinker-project/openlinker/issues/1438). `MarketplacePickerModal` (`apps/web/src/pages/products/marketplace-picker-modal.tsx`) shows a marketplace picker when 2+ `OfferManager` connections exist (#1096). Each row renders the connection name (`.marketplace-picker__name`) above a deliberately-muted secondary line (`.mono-text.muted-text`, adapterKey + platform display name). Confirmed live on the demo stack (Allegro + Erli rows) — the name line reads as broken/ghosted next to the correctly-muted line below it.

**Classification**: Frontend / Interface (shared CSS, `apps/web/src/index.css`)

---

## 2. Scope & Non-Goals

### In Scope
- Add an explicit `color` declaration so `.marketplace-picker__name` renders at full `--text-primary` contrast in both themes.
- Verify the fix visually (light + dark) and confirm no regression to the `.mono-text.muted-text` secondary line.

### Out of Scope
- Any change to `MarketplacePickerModal`'s TSX structure, logic, or props — this is a pure CSS fix.
- Any change to `.mono-text` / `.muted-text` utility classes.
- Auditing other components for the same missing-color pattern (not requested by the issue; flag as a follow-up if the root cause generalizes, but don't fix speculatively here).

### Constraints
- Per `docs/frontend-ui-style-guide.md` and `.claude/rules/frontend.md`: no hardcoded colors — token (`var(--token-name)`) only.
- `pnpm lint` runs `scripts/check-design-tokens.mjs`, which asserts every CSS var used in `index.css` has a matching entry in `apps/web/src/shared/theme/tokens.ts`. `--text-primary` is already cataloged (`tokens.ts:95`), so no catalog edit is needed.
- User has instructed: **do not commit and do not push** for this session. The plan doc and the fix are left as local working-tree changes only.

---

## 3. Architecture Mapping

**Target Layer**: Frontend — Interface (shared CSS consumed by a `pages/` component). No `app`/`features`/`shared` dependency-direction change; this is a same-file CSS edit.

**Capabilities Involved**: None (no port/adapter/service touched). Pure presentational fix.

**Existing Services Reused**: N/A.

**New Components Required**: None.

**Core vs Integration Justification**: N/A — this change touches only `apps/web` presentation CSS. No CORE, Integration, or Infrastructure layer is affected.

**Reference**: `docs/frontend-architecture.md` § Design tokens, `docs/frontend-ui-style-guide.md`.

---

## 4. External / Domain Research

### External System
N/A — no external system involved.

### Internal Patterns
- Confirmed via direct read of `apps/web/src/index.css:8534-8580`: `.marketplace-picker__option` (the native `<button>`) sets `background`, `border`, spacing — but no `color`. `.marketplace-picker__name` (line 8577-8580) sets only `font-weight: 600` and `font-size: 0.9rem` — no `color`. A bare `<button appearance:none>` falls back to the browser's UA/system button text color rather than inheriting the page's `--text-primary`, which is why the name line looks faint/ghosted next to the sibling `.mono-text.muted-text` span, which *does* set its own (intentionally muted) color.
- Confirmed via `apps/web/src/pages/products/marketplace-picker-modal.tsx:70-77`: the TSX structure matches the issue's snippet exactly — `.marketplace-picker__name` wraps `{c.name}` inside `.marketplace-picker__meta`, sibling to the muted line.
- Confirmed `--text-primary` is already a cataloged token in `apps/web/src/shared/theme/tokens.ts:95` — using it needs no catalog update.
- Comparable pattern elsewhere in `index.css`: other `button`-based list-row primitives (e.g. connection rows, dropdown items) explicitly set `color: var(--text-primary)` on their name/title element rather than relying on inheritance from a `<button>` — this fix follows that same established convention.

---

## 5. Questions & Assumptions

### Open Questions
- None blocking. The issue's own "Assumptions" section suggested a quick DevTools computed-style check before applying the fix to rule out a z-index/overlay cause — this plan's Phase 1 covers that verification step before editing CSS.

### Assumptions
- Root cause is exactly as diagnosed in the issue and re-confirmed by direct source read (Section 4): missing `color` on `.marketplace-picker__name` (or its parent `.marketplace-picker__option` button), not a z-index/overlay issue. Safe default given the CSS read leaves no other candidate rule affecting this element's color.
- The fix should live on `.marketplace-picker__name` specifically (not the parent `.marketplace-picker__option` button), so the color declaration is scoped to the exact element the issue calls out and doesn't risk affecting other children of `.marketplace-picker__option` (e.g. the `StatusBadge`, which manages its own color via its own component styles).

### Documentation Gaps
- None relevant to this fix.

---

## 6. Proposed Implementation Plan

### Phase 1: Confirm root cause in a running browser
**Goal**: Rule out a non-color cause (e.g. an overlay or z-index issue) before touching CSS, per the issue's own caveat.

**Steps**:
1. **Reproduce and inspect**
   - **File**: N/A (manual browser step)
   - **Action**: Run `pnpm start:dev:web` (with the API + a connection fixture that yields 2+ `OfferManager` connections, per #1096), open the Products page, trigger the picker modal, and inspect `.marketplace-picker__name` in DevTools → Computed styles.
   - **Acceptance**: Computed `color` for `.marketplace-picker__name` is confirmed to be a browser/UA default (not `var(--text-primary)`), validating the CSS-only root cause. If a different cause is found (e.g. an overlay), stop and re-scope before Phase 2.
   - **Dependencies**: None.

### Phase 2: Apply the CSS fix
**Goal**: Give `.marketplace-picker__name` full `--text-primary` contrast, matching the token-only styling convention used everywhere else in `index.css`.

**Steps**:
1. **Add explicit color to `.marketplace-picker__name`**
   - **File**: `apps/web/src/index.css` (rule at line ~8577-8580)
   - **Action**: Add `color: var(--text-primary);` inside the existing `.marketplace-picker__name` rule:
     ```css
     .marketplace-picker__name {
       color: var(--text-primary);
       font-weight: 600;
       font-size: 0.9rem;
     }
     ```
   - **Acceptance**: Rule now declares `color`; `.mono-text.muted-text` sibling rule is untouched.
   - **Dependencies**: Phase 1 confirmation.

2. **Re-run the design-token drift check**
   - **File**: N/A (script run)
   - **Action**: Run `pnpm lint` (chains `check:invariants` → `scripts/check-design-tokens.mjs`).
   - **Acceptance**: Lint passes — `--text-primary` is already in `tokens.ts`, so no catalog edit is required and no drift is introduced.
   - **Dependencies**: Step 1.

### Implementation Details

**New Components**: None — no domain/application/infrastructure/interface additions. Single CSS rule edit.

**Configuration Changes**: None.

**Database Migrations**: None.

**Events**: None emitted or consumed.

**Error Handling**: N/A — presentational-only change, no runtime logic path.

**Reference**: `docs/engineering-standards.md` (N/A for this pure-CSS change beyond the general "no hardcoded values" rule, satisfied via `var(--text-primary)`).

---

## 7. Alternatives Considered

### Alternative 1: Set `color` on `.marketplace-picker__option` instead of `.marketplace-picker__name`
- **Description**: Add `color: var(--text-primary);` to the parent button rule, letting `.marketplace-picker__name` inherit it.
- **Why Rejected**: The parent button also contains the `StatusBadge` component, which manages its own text color via its own component styles; setting `color` on the shared ancestor is a broader change than the bug requires and risks a future regression if `StatusBadge` (or another future child) ever relies on inheriting `color` from an ancestor instead of setting its own. Scoping the fix to `.marketplace-picker__name` — the exact element called out in the issue — is the minimal, safest change.
- **Trade-offs**: None material; `.marketplace-picker__meta` has no other children needing the same fix today, so there's no duplication cost to scoping narrowly.

### Alternative 2: Audit and fix every other native-`<button>`-based row primitive for the same missing-color pattern in this PR
- **Description**: Since the root cause (a bare `<button appearance:none>` not inheriting `--text-primary`) could plausibly affect other list-row components, proactively grep `index.css` for similar patterns and fix them all now.
- **Why Rejected**: Out of scope for this issue — #1438 specifically reports the marketplace-picker modal, and the acceptance criteria don't ask for a broader audit. Expanding scope risks an unreviewed, unrequested change surface. If the pattern does recur elsewhere, it's a distinct, separately-filed bug.
- **Trade-offs**: Slightly slower to reach full consistency across the codebase, but keeps this fix minimal, reviewable, and matched to the reported bug.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No hexagonal-architecture layers touched (pure `apps/web` CSS). Fully compliant by default.

### Naming Conventions
- ✅ No new class introduced; existing `.marketplace-picker__name` BEM-style name (`.component-name__child`) is retained per `.claude/rules/frontend.md` § Styling.

### Existing Patterns
- ✅ Matches the established convention of explicit `color: var(--token)` on every styled primitive (per `docs/frontend-ui-style-guide.md` and the "no hardcoded colors" rule) — confirmed against comparable list-row components elsewhere in `index.css`.

### Risks
- **Risk — root cause is not purely CSS-color (e.g. overlay/z-index)**: Mitigated by Phase 1's DevTools computed-style verification before editing CSS, per the issue's own caveat.
- **Risk — token catalog drift**: None; `--text-primary` is already cataloged, so `pnpm lint`'s `check-design-tokens.mjs` passes without further edits.

### Edge Cases
- **Long connection names that wrap**: `.marketplace-picker__name` has no `white-space`/`overflow` handling today; adding `color` doesn't change wrapping behavior, so this remains as-is (unrelated to the bug).
- **`.marketplace-picker__option--picked` state**: The picked-state rule (border + box-shadow) doesn't touch `color`, so the fix applies identically in both picked and unpicked states.

### Backward Compatibility
- ✅ No breaking change. Purely additive CSS declaration; no consumer of `.marketplace-picker__name` relies on its previous (undefined/UA-default) color.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- Not applicable — no component logic changed, only a CSS color declaration. Existing tests for `MarketplacePickerModal` (if any) are unaffected; no new `.test.tsx` needed for a CSS-only fix.

### Integration Tests
- Not applicable — no API/service/DB interaction.

### Mocking Strategy
- N/A.

### Manual Verification (replaces automated coverage for this CSS-only fix)
- [ ] Confirm via DevTools computed styles that `.marketplace-picker__name` previously resolved to a non-`--text-primary` color (Phase 1).
- [ ] After the fix, visually confirm the connection-name line renders at full contrast in **light theme** (`/dev/ui` theme toggle or live picker modal).
- [ ] After the fix, visually confirm the connection-name line renders at full contrast in **dark theme**.
- [ ] Confirm the `.mono-text.muted-text` secondary line (adapterKey · platform display name) still renders at its existing muted color — no regression.
- [ ] `pnpm lint` passes (design-token drift check + general lint).
- [ ] `pnpm type-check` passes (no TS surface touched, expected no-op).

### Acceptance Criteria (from issue #1438)
- [ ] Connection-name line in the marketplace picker modal renders at full `--text-primary` contrast in both light and dark themes
- [ ] No regression to the existing `.mono-text.muted-text` secondary line's intentional muted styling
- [ ] Verified visually against `/dev/ui` or the live picker modal (screenshot before/after)
- [ ] No architecture boundary violations (CORE ↔ Integration) — not applicable, FE-only CSS fix

**Reference**: `docs/testing-guide.md`.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A — no layer touched)
- [x] Respects CORE vs Integration boundaries (N/A)
- [x] Uses existing patterns (no unnecessary abstractions) — matches existing token-based color convention
- [x] Idempotency considered (N/A — static CSS)
- [x] Event-driven patterns used where applicable (N/A)
- [x] Rate limits & retries addressed (N/A)
- [x] Error handling comprehensive (N/A — presentational fix)
- [x] Testing strategy complete (manual visual verification, appropriate for a CSS-only fix)
- [x] Naming conventions followed
- [x] File structure matches standards (no new files)
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## 11. Implementation Addendum (found during manual visual verification)

The planned fix (§6, Phase 2, Step 1 — `color: var(--text-primary)` on `.marketplace-picker__name`) was applied and, on its own, resolved the exact bug reported in #1438. Live visual verification against the running app (both themes, real `ALLEGRO DEMO v1` / `Erli` connections) then surfaced **three additional, pre-existing layout bugs** in the same `.marketplace-picker__option` / `.marketplace-picker__meta` rules — not part of the original issue, but in the same component and blocking a clean "done" for this modal. All three are documented here rather than filed separately since they were found and fixed in the same session, on the same file, immediately downstream of the planned change.

### Root causes found

1. **Low-contrast border in light theme** — `.marketplace-picker__option` used `border: 1px solid var(--border-default)`. `--border-default` in light theme is `oklch(88% 0.008 80)` — very pale against `--bg-surface`, reading as "too thin/faint". Fixed by switching to the existing `--border-strong` token (`oklch(78% 0.010 80)` light / `oklch(42% 0.014 270)` dark), already used elsewhere in `index.css` for exactly this purpose — no new token, no drift-check impact.

2. **Text overflowing past the card's right/bottom edge** — `.marketplace-picker__meta` (the flex child holding the name + mono secondary line) had no `min-width: 0`. Flex items default to `min-width: auto`, i.e. they refuse to shrink below their content's intrinsic width — so a long mono-text value (`erli.shopapi.v1 · Erli`) forced the flex item wider than the available row space and visually escaped the button's border, even though `.mono-text` already carries `overflow-wrap: anywhere` for exactly this scenario (see the pre-existing comment at `index.css:2375-2379`, which even names this exact failure mode: *"without this they escape cards"*). The comment's own prescribed fix — enabling wrap — requires `min-width: 0` somewhere in the ancestor chain, which was missing here. Fixed by adding `min-width: 0` to `.marketplace-picker__meta`.

3. **Fixed 32px button height clipping two-line content** — the root cause behind what first looked like a border sizing issue and then a text-wrapping issue. The **global** `button, .button { height: 2rem; white-space: nowrap; }` reset (`index.css:501-507`, `height` and `white-space` both inherited/applied to *every* native `<button>` in the app) was bleeding onto `.marketplace-picker__option`, which is a native `<button>`. Neither property was ever overridden on this selector, so the row was clamped to a fixed 32px height with wrapping forcibly disabled — the two-line content (bold name + mono secondary line) had nowhere to go and visually spilled past the border's bottom edge. This is why the earlier border-contrast and `min-width: 0` fixes alone didn't visually resolve it — `white-space: nowrap` (inherited, unrelated to `overflow-wrap`) was still forcing the mono line onto one row, and even after allowing wrap the fixed `height: 2rem` would have clipped the now-taller content. Fixed by adding `height: auto; white-space: normal;` to `.marketplace-picker__option`, explicitly overriding the generic button reset for this multi-line list-item-styled-as-button use case.

### Final diff (`apps/web/src/index.css`)

```diff
 .marketplace-picker__option {
   ...
   gap: var(--space-3);
+  height: auto;
+  white-space: normal;
   background: var(--bg-surface);
-  border: 1px solid var(--border-default);
+  border: 1px solid var(--border-strong);
   border-radius: var(--radius-md);
   padding: var(--space-3) var(--space-4);
 }
 ...
 .marketplace-picker__meta {
   display: flex;
   flex-direction: column;
   gap: 2px;
+  min-width: 0;
 }
 
 .marketplace-picker__name {
+  color: var(--text-primary);
   font-weight: 600;
   font-size: 0.9rem;
 }
```

### Validation performed

- `pnpm --filter @openlinker/web lint` — 0 errors (pre-existing, unrelated warnings only).
- `node scripts/check-design-tokens.mjs` — passes (`--text-primary` and `--border-strong` were already cataloged in `tokens.ts`; no new tokens introduced).
- Manual visual verification against the live app (real `ALLEGRO DEMO v1` + `Erli` `OfferManager` connections), both light and dark themes, confirmed by the reporting user as resolved.

### Scope note

None of the three additional fixes touch a different architectural layer, port, service, DI token, or ORM entity — they're all in the same CSS file, same component, same selectors the original plan already scoped to change. The `/pre-implement` READY verdict (`docs/plans/analysis/ANALYSIS-1438-marketplace-picker-name-contrast.md`) remains valid: no contract-surface break, no reuse collision, for any of the four total rule changes.

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Frontend UI Style Guide](../frontend-ui-style-guide.md)
- Issue: [#1438](https://github.com/openlinker-project/openlinker/issues/1438)
