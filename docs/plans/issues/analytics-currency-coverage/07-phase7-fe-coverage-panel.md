# [MINI-EPIC] Phase 7 — Frontend: Data coverage panel + remediation UX

> Parent: Epic "Analytics — display-currency picker + data-coverage remediation"
> Depends on: Phase 4 + Phase 5 API contracts
> Mockup: `docs/plans/mockups/analytics-display-currency-picker.html` — states `all-clear`, `detail-currency`, `detail-tax`, `detail-novat`, `detail-postrollout`, `detail-mapping`, `currency-in-progress`, `currency-fixed`, `currency-failed`, `tax-confirm`

## Scope

The "Data coverage" panel (`.attention-list` rows) and the five detail modals it opens, plus the coverage-alert success notification and the async in-progress/failed row states. This is the largest FE phase — it carries every lesson from the mockup's iteration history (real pagination, no dead click targets, human-language copy, no raw enum values in the UI, English throughout).

## Branching

Branch `phase/2XXX-p7-fe-coverage-panel` off the epic branch.

## Dependencies

- Phase 4 (`GET /analytics/coverage`), Phase 5 (the three `POST` remediation endpoints).
- Reuses `apps/web/src/features/analytics/components/analytics-needs-attention.tsx` and `analytics-degradation-banner.tsx` conventions (`.attention-list` shape) as the visual precedent — do not invent a new list pattern.

## Acceptance Criteria (mini-epic level)

- [ ] Every row's label is human-language copy — no raw backend enum value (`pre-rollout`, `awaiting_mapping`, etc.) ever reaches the DOM as visible text. This is a hard regression guard: the mockup was caught leaking exactly this twice during design review.
- [ ] All country/tax terminology is country-agnostic ("tax rate", never "VAT") — regression guard for the mockup's own VAT→tax-rate correction.
- [ ] Detail modals use real pagination (not a "View more →" link) — regression guard for the mockup's own dead-pagination bug fix.
- [ ] A resolved remediation row transitions through a visible "Fixed — closing…" sub-state before disappearing (driven by the real `analytics_remediation_runs.status` reaching `'resolved'`, not a client-only timer) and the success confirmation appears as a dismissible, green, inline `.coverage-alert` inside the Data Coverage section — never a toast.

---

## Task 7.1 — `useAnalyticsCoverageQuery` + polling for in-progress runs

### Problem / Context

The coverage list must reflect real async job state (Phase 5's `analytics_remediation_runs`), including a run that's `in-progress` when the page loads (e.g. the operator navigated away and back).

### Proposed Solution

`apps/web/src/features/analytics/api/analytics-coverage.api.ts` (+`.types.ts`/`.query-keys.ts`) mirrors the existing API-module trio pattern. `use-analytics-coverage-query.ts` uses TanStack Query's `refetchInterval` (short, bounded) **only while at least one category is `in-progress`** — matches `docs/frontend-architecture.md`'s "Query retries disabled by default unless a feature explicitly justifies retries" by scoping the exception narrowly and explaining why here.

### Classification

**Type**: Frontend
**Layer**: Application (feature hooks)
**File(s)**: `apps/web/src/features/analytics/api/analytics-coverage.api.ts`, `.types.ts`, `.query-keys.ts`, `apps/web/src/features/analytics/hooks/use-analytics-coverage-query.ts`

### Dependencies

- Phase 4 Task 4.3.

### Assumptions

None.

### Acceptance Criteria

- [ ] Polling stops automatically once no category is `in-progress` (verified by a test asserting `refetchInterval` becomes `false`/undefined).
- [ ] Tests added.

---

## Task 7.2 — Data Coverage panel (`all-clear` + populated `.attention-list`)

### Problem / Context

The panel that lists every open category as a row, each opening its own detail modal. Mirrors the real `AnalyticsNeedsAttention` component's `.attention-list` shape (`apps/web/src/features/analytics/components/analytics-needs-attention.tsx`) rather than inventing new list markup.

### Proposed Solution

`AnalyticsDataCoveragePanel` (`apps/web/src/features/analytics/components/`), rendered as a `<article class="panel panel--dense">` per the mockup, with one row per open category from Task 7.1's query. Zero open categories renders mockup state `all-clear` (a calm, non-alarming empty state — not a hidden panel; the panel's presence itself signals "we checked"). Each row's action button opens the matching detail modal from Task 7.3 (never performs the remediation action directly from the row — the mockup deliberately separates "open detail / review" from "confirm and act," a distinction lost in an earlier iteration and explicitly fixed).

### Classification

**Type**: Frontend
**Layer**: Feature component
**File(s)**: `apps/web/src/features/analytics/components/analytics-data-coverage-panel.tsx` (+`.test.tsx`)

### Dependencies

- Task 7.1.

### Assumptions

- The informational "N orders fully discounted" row (Phase 4 Task 4.3) renders in the same list but with no action button — visually distinguishable as informational, not actionable, per the mockup.

### Acceptance Criteria

- [ ] Zero-open-categories case reproduces mockup state `all-clear` exactly (copy + visual treatment).
- [ ] Each populated category's row copy is human-language (cross-check against the mockup's exact final English strings for currency/tax-A/tax-B/tax-C/mapping rows — these were iterated multiple times and are the source of truth).
- [ ] Tests added.

---

## Task 7.3 — Five detail modals (`detail-currency` / `detail-tax` / `detail-novat` / `detail-postrollout` / `detail-mapping`)

### Problem / Context

Each category's row opens a modal listing the affected orders/products with real pagination and per-row thumbnails, following the mockup's `.dialog__content--wide` + `.detail-row-list` shape (mirrors the real `OrderIdentityCell`/`ProductThumbnail` 32px-thumbnail + name + meta row convention already used elsewhere in the app — reuse those components, don't reinvent row markup).

### Proposed Solution

One `AnalyticsCoverageDetailModal` component parameterized by category (not five separate components — the row shape and pagination are identical, only the copy and the action button differ), using the shared `Dialog` primitive with `aria-modal="true"` and Escape-to-close (regression guard: the mockup's cold-audit found both missing on first pass). Pagination uses the real shared pagination pattern from `apps/web/src/pages/cursors/cursors-list-page.tsx` (`.pagination`/`.pagination__actions`), not a "View more" link (regression guard: mockup's own dead-pagination fix). The currency modal's rows show native + stamped currency, with a "Recalculate all N now" action (Phase 5 Task 5.1). The three tax modals show the resolved/candidate rate per order (never a single hardcoded rate — regression guard for the mockup's own "hardcoded 23%" bug, since real orders carry different real per-product tax rates), but their **actions differ per category and none of them is a per-order mutation**:

- `detail-tax` (category A, unconfirmed-but-resolvable) is **informational** — these orders would become Net Sales–eligible if the org-wide setting were ON. Its action is "Open Analytics Settings" (deep-links to Phase 6 Task 6.3's dialog, tax section), not a per-row or per-modal "Confirm" — there is no confirm mutation left to trigger from here.
- `detail-novat` (category B) has no action at all — the underlying data genuinely has no resolvable rate.
- `detail-postrollout` (category C) has a real bulk action, "Re-run backfill for these N orders" (Phase 5 Task 5.2's `tax/rerun-backfill`) — this is the one legitimate per-modal remediation button on the tax side.

The mapping modal shows the human-language mapping-failure reason (never the raw enum).

### Classification

**Type**: Frontend
**Layer**: Feature component
**File(s)**: `apps/web/src/features/analytics/components/analytics-coverage-detail-modal.tsx` (+`.test.tsx`)

### Dependencies

- Task 7.2, Phase 4 (per-category row data shape).

### Assumptions

- Modal reuses `ProductThumbnail`/`OrderIdentityCell` from the `orders`/`products` feature barrels per `docs/frontend-architecture.md § Feature Public Surface` (barrel imports only, never deep imports).

### Acceptance Criteria

- [ ] All five categories reproduce their respective mockup `detail-*` state, including real (non-decorative) pagination and `aria-modal`/Escape-close.
- [ ] Tax-rate display never shows a single rate for a mixed-rate order set — each row shows its own real rate.
- [ ] No raw backend enum value renders as visible copy anywhere in the modal (grep test or manual audit, documented in the PR).
- [ ] Tests added.

---

## Task 7.4 — Remediation actions + `.coverage-alert` success notification

### Problem / Context

Wires the remediation `POST` endpoints (Phase 5) to real UI. **This lifecycle applies to the currency category only** — tax has no run to track (category A is a settings toggle, category C's "re-run backfill" is a fire-and-forget trigger with no `analytics_remediation_runs` row, per Phase 1 Task 1.2's scoping). The currency lifecycle the mockup settled on after multiple corrections: an `in-progress` row → a "Fixed — closing…" transient sub-state (CSS `transition-delay`, driven by the real status reaching `resolved`) → the row disappears → a dismissible green `.coverage-alert` appears inline inside the Data Coverage panel (never a toast — this was explicitly rejected during design; do not reach for `apps/web/src/shared/ui/toast-provider.tsx` here).

### Proposed Solution

- "Recalculate all N now" (currency, mockup `currency-in-progress`) calls Phase 5 Task 5.1's mutation, invalidates Task 7.1's coverage query on settle, and is the only action in this panel with an `in-progress`/`resolved`/`failed` lifecycle to track.
- "Re-run backfill for these N orders" (tax category C, opened from `detail-postrollout`) calls Phase 5 Task 5.2's `tax/rerun-backfill` and simply invalidates Task 7.1's coverage query once the request settles — no in-progress row, no polling, since it's not tracked in `analytics_remediation_runs`.
- Category A's `detail-tax` modal has no mutation to trigger from this panel at all — its "Open Analytics Settings" action (see Task 7.3) navigates to Phase 6 Task 6.3's dialog, where the mockup's `tax-confirm` state lives (confirming the org-wide toggle, not anything scoped to this panel).
- A currency row whose polled status flips to `'resolved'` shows the transient closing sub-state for a fixed short delay before being removed from the list (mirrors the mockup's ~1.3s `transition-delay` + 500ms collapse — exact timing is a design decision, not a hard requirement; keep it perceptible, not instant, per the mockup's own "felt wrong when it vanished instantly" finding).
- A currency row whose polled status flips to `'failed'` (mockup `currency-failed`) shows the failure banner with the real `detail` message from `analytics_remediation_runs.detail` (Phase 5's `FX_STAMP_TERMINAL_REASONS`-derived text) — never a generic "something went wrong."
- On the currency row reaching `resolved` after the panel had open categories, render `AnalyticsCoverageAlert` (new component) — green, left-rule accent per the `Alert` component convention (`apps/web/src/shared/ui/alert.tsx`), with its own `×` dismiss button that clears local dismissal state (not a global toast queue). The tax category-C bulk backfill trigger gets its own lightweight success/failure feedback (e.g. a short-lived confirmation that the request was accepted) — it does not reuse `AnalyticsCoverageAlert`'s resolved-run semantics, since there is no run to resolve.

### Classification

**Type**: Frontend
**Layer**: Feature component
**File(s)**: `apps/web/src/features/analytics/components/analytics-data-coverage-panel.tsx` (extend), `apps/web/src/features/analytics/components/analytics-coverage-alert.tsx` (+`.test.tsx`)

### Dependencies

- Task 7.1, 7.2, 7.3, Phase 5.

### Assumptions

- Dismissal state is local component state (not persisted) — reloading the page and finding new coverage issues should always show the alert again if a fresh `resolved` transition happens; this is per-transition feedback, not a permanently-dismissable banner.

### Acceptance Criteria

- [ ] End-to-end (via component test with a mocked API client whose response changes across polls) reproduces `currency-in-progress → currency-fixed → (row gone) → coverage-alert visible → dismiss → coverage-alert gone`.
- [ ] `currency-failed` renders the real `detail` text from the API response, not a hardcoded string.
- [ ] `.coverage-alert` is provably not `shared/ui/toast-provider.tsx` (regression guard — grep the diff for `toast-provider` imports in this file, must be absent).
- [ ] Tests added.
