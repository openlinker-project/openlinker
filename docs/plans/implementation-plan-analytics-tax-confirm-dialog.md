# Implementation Plan — Analytics Settings tax-rate-inclusion confirm dialog (#2857)

## 1. Task

`AnalyticsSettingsDialog` writes `includeBackfilledTaxRatesInNetSales=true` directly from the
checkbox `onChange`, with no confirmation — unlike the currency-recalculate action, which is
gated behind `confirmingRecalculate` + a `ConfirmDialog` (added per #2668 review, finding 14).
Mirror that pattern for the tax-inclusion toggle's ON direction only. Frontend-only, feature-layer
change. Non-goal: gating the OFF direction (reversing is the safe direction, per the issue's own
assumption).

## 2. Research

- `handleRecalculate` / `confirmingRecalculate` / the `ConfirmDialog` at the bottom of
  `analytics-settings-dialog.tsx` is the pattern mirrored exactly (same `dialog__overlay--elevated`
  / `dialog__content--elevated` classes for a dialog nested over the settings dialog).
- `handleTaxToggleChange(nextInclude: boolean)` is the existing mutation call — reused as-is for
  both directions; only the call site changes.
- The checkbox's existing description is the toggle's own stated consequence (deployment-wide,
  re-queried-not-retroactive) — reused verbatim in the confirm copy so the two never drift, per
  the issue's acceptance criterion.
- Test pattern: the recalculate-confirm click sequence (`click 'Recalculate now'` → `click
  'Recalculate'`) is mirrored for `'Turn on'`. Two existing tests that click the tax checkbox and
  assert an immediate `updateSettings` call (both toggle ON) needed the new confirm-click step
  inserted.

## 3. Design

- New `confirmingTaxInclude` boolean state, alongside `confirmingRecalculate`.
- Checkbox `onChange` branches on `event.target.checked`: `true` → open the confirm dialog (no
  mutation yet); `false` → call `handleTaxToggleChange(false)` directly, unchanged.
- Second `ConfirmDialog`, same elevated classes, `onConfirm` calls a new
  `handleConfirmTaxInclude` (closes the dialog, then calls `handleTaxToggleChange(true)`) —
  mirrors `handleRecalculate`'s self-closing pattern.
- Confirm copy: title "Turn on this setting?" (mirrors the mockup's button copy "Turn on this
  setting ›"); description reuses the toggle's own stated-consequence text verbatim so wording
  can't drift from the checkbox description.
- `isConfirming={updateSettings.isPending}` — same in-flight-disables-confirm behavior as the
  recalculate dialog.

## 4. Steps

1. `apps/web/src/features/analytics/components/analytics-settings-dialog.tsx`
   - Add `confirmingTaxInclude` state near `confirmingRecalculate`.
   - Branch the checkbox `onChange` as designed above.
   - Add `handleConfirmTaxInclude` and a second `<ConfirmDialog>` wired to it.
2. `apps/web/src/features/analytics/components/analytics-settings-dialog.test.tsx`
   - Update the two existing "toggle the tax-rate setting" tests to click the checkbox, then
     click the new confirm button, before asserting `updateSettings`.
   - Add a new test asserting the confirm gate: clicking the checkbox alone does not call
     `updateSettings`, and Cancel leaves the setting untouched.
3. `apps/e2e/tests/analytics/mockup-parity.spec.ts`
   - Move `tax-confirm` from "documented divergence" into "fully compared"; drive it through the
     real dialog (toggle ON → assert the real confirm dialog → Cancel leaves it OFF → toggle ON
     again through the confirm to restore prior state where needed).

## 5. Validate

- No CORE/Integration boundary touched — purely `apps/web` feature component + its test + the
  e2e spec.
- Confirm dialog copy is asserted (test) to match the toggle's own copy, preventing drift.
- Security: no new data exposure; still gated by existing `useWriteAccess('analytics:write')` +
  `ReadOnlyLock` demo-mode handling — untouched.

## Result

Implemented as designed. Quality gate: `pnpm --filter web lint` (0 errors), `pnpm --filter web
type-check` (clean), `pnpm --filter @openlinker/e2e lint` (0 errors), `pnpm --filter
@openlinker/e2e type-check` (clean). Unit tests not run locally per project convention (weak
laptop) — verified by careful manual trace of the click sequence against the `ConfirmDialog`
component's rendered markup instead.
