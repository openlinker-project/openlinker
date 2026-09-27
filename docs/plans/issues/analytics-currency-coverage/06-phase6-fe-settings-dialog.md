# [MINI-EPIC] Phase 6 — Frontend: Analytics Settings dialog

> Parent: Epic "Analytics — display-currency picker + data-coverage remediation"
> Depends on: Phase 2 + Phase 3 API contracts, Phase 1 Task 1.3 (can start against a mocked `useApiClient()` once DTOs are agreed, per the epic's dependency note)
> Mockup: `docs/plans/mockups/analytics-display-currency-picker.html` — states `native`, `converting`, `converted`, `unavailable`, `settings-open`

## Scope

The currency-picker toolbar control + the Analytics Settings dialog (currency + rate-basis mode). Data-coverage UI is Phase 7 — kept separate because it has an independent lifecycle (remediation runs) the settings dialog does not.

## Branching

Branch `phase/2XXX-p6-fe-settings-dialog` off the epic branch.

## Dependencies

- Phase 2 (`GET /analytics/sales?displayCurrency=&rateBasis=`), Phase 3 (`GET/PUT /analytics/settings`).

## Acceptance Criteria (mini-epic level)

- [ ] Every listed mockup state for this phase is reproducible in the real `/analytics` page, pixel-equivalent modulo real data.
- [ ] No raw `fetch()` — all calls go through `apps/web/src/features/analytics/api/` modules and `useApiClient()`.
- [ ] Currency choice and rate-basis mode are both URL state (`?displayCurrency=&rateBasis=`) per `docs/frontend-architecture.md § URL State` (filters/view-mode belong in the URL, not local state) — reading the settings default only seeds the URL on first load, it isn't a competing source of truth once the operator changes it.

---

## Task 6.1 — `useAnalyticsSettingsQuery` / `useUpdateAnalyticsSettingsMutation` + API module

### Problem / Context

New feature-owned API surface, no existing hook for this.

### Proposed Solution

`apps/web/src/features/analytics/api/analytics-settings.api.ts` + `.types.ts` + `.query-keys.ts` (mirrors the existing `sales-analytics.api.ts` file trio exactly), `apps/web/src/features/analytics/hooks/use-analytics-settings-query.ts` and `use-update-analytics-settings-mutation.ts` (mirrors `use-sales-analytics-query.ts`). Mutation invalidates the settings query key on success; per `docs/frontend-architecture.md § Async UX Conventions`, no optimistic update.

### Classification

**Type**: Frontend
**Layer**: Application (feature hooks)
**File(s)**: `apps/web/src/features/analytics/api/analytics-settings.api.ts`, `.types.ts`, `.query-keys.ts`; `apps/web/src/features/analytics/hooks/use-analytics-settings-query.ts`, `use-update-analytics-settings-mutation.ts`; export the public ones from `apps/web/src/features/analytics/index.ts`

### Dependencies

- Phase 3 Task 3.2 (backend endpoints).

### Assumptions

None.

### Acceptance Criteria

- [ ] Hooks follow the existing `use-sales-analytics-query.ts` pattern verbatim (query key shape, `enabled`, error surface).
- [ ] Unit test using `createMockApiClient()` per `docs/frontend-architecture.md § Testing Baseline`.
- [ ] Tests added.

---

## Task 6.2 — Currency-picker toolbar control (`native` / `converting` / `converted` / `unavailable`)

### Problem / Context

Today `apps/web/src/features/analytics/components/analytics-date-range-toolbar.tsx` has a date-range control but no currency control. The mockup adds a functional `<select class="control control--select">` (built to replace an earlier non-functional button-only prototype during design iteration) plus a `.convert-note` banner with three visual variants.

### Proposed Solution

New `AnalyticsCurrencyPicker` component in `apps/web/src/features/analytics/components/`, using the shared `Select` primitive (`apps/web/src/shared/ui/select.tsx`) — never a raw `<select>`, per `docs/frontend-architecture.md § UI Library Policy`. A companion `AnalyticsConvertNote` component renders the three states:
- `data-state="native"` — no note (baseline, reporting currency).
- `data-state="converting"` — "Converting…" (busy state; only ever hit in `rateBasis='order-date'` mode per Phase 2 Task 2.1 — "current rate" mode is cheap enough it should not need this state in practice, but the component still supports it honestly rather than assuming).
- `data-state="converted"` — success copy interpolating the real per-currency order counts returned by Phase 2's response (`"Summed by each order's own currency: {n} orders in {native}, ..."`) — never hardcode the mockup's literal "29 orders in PLN, 2 in EUR" numbers.
- `data-state="unavailable"` — renders `unresolvedNativeCurrencies` from Phase 2's response, with a "Try again" text button (mirrors mockup's `data-goto="converting"` retry affordance) and a "Switch back to {reporting currency}" text button.

### Classification

**Type**: Frontend
**Layer**: Feature component
**File(s)**: `apps/web/src/features/analytics/components/analytics-currency-picker.tsx` (+`.test.tsx`), `apps/web/src/features/analytics/components/analytics-convert-note.tsx` (+`.test.tsx`)

### Dependencies

- Task 6.1, Phase 2 Task 2.2.

### Assumptions

- Placed in the existing toolbar (`analytics-date-range-toolbar.tsx`) rather than a separate row — matches the mockup's layout (toolbar with date range + currency control side by side).

### Acceptance Criteria

- [ ] All four `data-state` values (`native`/`converting`/`converted`/`unavailable`) are reachable from real user interaction (pick a currency → see converting-or-converted-or-unavailable depending on real API response).
- [ ] "Switch back to {reporting currency}" actually clears the `displayCurrency` URL param.
- [ ] Component test per state.
- [ ] Tests added.

---

## Task 6.3 — Analytics Settings dialog (`settings-open`)

### Problem / Context

Reproduces the mockup's `<div class="dialog__content--settings">` with its two `.settings-section` blocks: "Currency — recalculation" (display currency + rate-basis mode + the "this section writes data permanently" caveat that was added after the earlier reversibility-contradiction bug found during design review) and "Tax rates" (the toggle whose confirm dialog explicitly states it's reversible — see mockup's confirm-dialog copy: "You can turn it off any time; nothing is permanently changed in the database").

### Proposed Solution

New `AnalyticsSettingsDialog` using the shared `Dialog` primitive (`apps/web/src/shared/ui/dialog.tsx`), triggered from the toolbar (mirrors the mockup's "Analytics Settings" trigger button). Two sections as separate `AccessGate`/`ReadOnlyLock`-appropriate blocks per `docs/frontend-architecture.md § Access Control And UI Visibility` — writing a setting is a write affordance (`useWriteAccess` + `ReadOnlyLock`), not merely informational content. **Preserve the exact scoping fix from the mockup's design history**: the dialog's top-level description text must only describe the display-currency/rate-basis fields as non-destructive; it must not make a blanket "nothing is saved" claim once the Currency section's own explicit permanent-write caveat is present — copy these two independently, do not let one description drift back to covering both.

### Classification

**Type**: Frontend
**Layer**: Feature component
**File(s)**: `apps/web/src/features/analytics/components/analytics-settings-dialog.tsx` (+`.test.tsx`)

### Dependencies

- Task 6.1, Phase 1 Task 1.3, Phase 3 Task 3.2.

### Assumptions

- The "Tax rates" toggle is exactly Phase 1 Task 1.3's `includeGuessedVatRatesInNetSales` (or its renamed equivalent) setting — a single global boolean, never a per-order action. There is no per-order "confirm" affordance anywhere in this dialog; the confirm dialog it opens is confirming the TOGGLE change (see mockup's `tax-confirm` state), not confirming an order-level data mutation.

### Acceptance Criteria

- [ ] Reproduces mockup state `settings-open` visually and behaviourally, including both section descriptions' exact reversibility framing.
- [ ] A component test asserts the top-level dialog description text does NOT claim "nothing is saved" when the currency section is visible (regression guard for the bug caught twice during mockup design review).
- [ ] Tests added.
