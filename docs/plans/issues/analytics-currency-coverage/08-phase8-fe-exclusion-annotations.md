# [MINI-EPIC] Phase 8 — Frontend: exclusion annotations on KPI/channel/product surfaces

> Parent: Epic "Analytics — display-currency picker + data-coverage remediation"
> Depends on: Phase 4, Phase 7
> Mockup: `docs/plans/mockups/analytics-display-currency-picker.html` — `.excl-note` annotations inside the Channel and Top Products tables, and the KPI strip's gap-mark (`†`)

## Scope

The part of the design that makes exclusions *locally* visible, not just centrally listed in the Data Coverage panel: a small annotation on the specific KPI card, channel row, or product row that is under-counted because of an open coverage category, linking back to that category's detail modal. Kept as its own phase because it touches three existing, already-shipped components (`analytics-kpi-strip.tsx`/`analytics-kpi-card.tsx`, `channel-sales-table.tsx`, `product-sales-table.tsx`) rather than adding new ones — the review discipline here is "don't break what's already shipped," different from Phase 6/7's "build new."

## Branching

Branch `phase/2XXX-p8-fe-exclusion-annotations` off the epic branch.

## Dependencies

- Phase 4 (per-order/per-category affected data), Phase 7 Task 7.1 (the coverage query this phase's annotations key off of).
- Existing components: `apps/web/src/features/analytics/components/analytics-kpi-strip.tsx`, `analytics-kpi-card.tsx`, `channel-sales-table.tsx`, `product-sales-table.tsx`, `gap-mark.tsx`.

## Acceptance Criteria (mini-epic level)

- [ ] Every `.excl-note` annotation is factually consistent with which category actually excluded that row — regression guard for the mockup's own found bug (a candle row wrongly labeled a tax-rate issue when it was actually a currency issue).
- [ ] No row that belongs to an open coverage category is silently missing its annotation (regression guard for the mockup's own found bug — a tee-shirt row missing its excl-note despite being in the tax-A list).
- [ ] Clicking an annotation opens the exact same detail modal Phase 7 built for that category (no duplicate modal implementation).

---

## Task 8.1 — `gap-mark.tsx` accessible title + KPI-strip wiring

### Problem / Context

`apps/web/src/features/analytics/components/gap-mark.tsx` already exists (the `†` gap-mark symbol used elsewhere in the analytics surface); the mockup's cold audit found it missing a `title` attribute, meaning the symbol conveyed nothing to assistive tech or a hovering mouse. This phase both fixes that on the existing component (if not already fixed on `main` — check current state before assuming the bug is still present) and wires it to Phase 7's coverage data on `analytics-kpi-strip.tsx` / `analytics-kpi-card.tsx`.

### Proposed Solution

Ensure `GapMark` accepts and renders a `title`/`aria-label` describing which coverage category caused the gap (e.g. "2 orders excluded — currency needs recalculating"), sourced from Phase 7 Task 7.1's query, and that clicking it opens the matching `AnalyticsCoverageDetailModal` from Phase 7 Task 7.3.

### Classification

**Type**: Frontend
**Layer**: Feature component
**File(s)**: `apps/web/src/features/analytics/components/gap-mark.tsx`, `apps/web/src/features/analytics/components/analytics-kpi-strip.tsx`, `analytics-kpi-card.tsx`

### Dependencies

- Phase 7 Task 7.1, 7.3.

### Assumptions

- If `gap-mark.tsx`'s missing-`title` bug was already fixed on `main` independently of this epic, this task becomes wiring-only — verify against `main` before implementing, don't assume the earlier audit finding is still live.

### Acceptance Criteria

- [ ] Every KPI card affected by an open coverage category shows a `GapMark` with a real, category-specific `title`.
- [ ] Clicking it opens the correct detail modal for that category.
- [ ] Tests added/updated for `gap-mark.tsx` and the KPI components it's wired into.

---

## Task 8.2 — Channel and Top Products `.excl-note` wiring

### Problem / Context

`channel-sales-table.tsx` and `product-sales-table.tsx` need a per-row annotation when that specific channel/product's numbers are under-counted by an open coverage category. The mockup iteration found and fixed two consistency bugs here (wrong category attributed to one row, missing annotation on another) — this task's acceptance criteria exist specifically to prevent re-introducing either class of bug in the real implementation.

### Proposed Solution

New shared `AnalyticsExclusionNote` component (`apps/web/src/features/analytics/components/analytics-exclusion-note.tsx`), taking a list of affected order/category pairs (from Phase 4's per-category `sampleOrderIds`, cross-referenced against the channel/product row's own order set — this cross-reference is the part that must be exact, since it's exactly where the mockup's consistency bugs came from). Rendered inline in each table row, opening the matching Phase 7 Task 7.3 modal on click.

### Classification

**Type**: Frontend
**Layer**: Feature component
**File(s)**: `apps/web/src/features/analytics/components/analytics-exclusion-note.tsx` (+`.test.tsx`), `channel-sales-table.tsx`, `product-sales-table.tsx`

### Dependencies

- Task 8.1 (shares the coverage-data wiring pattern), Phase 7.

### Assumptions

- The order-to-row cross-reference happens client-side against data already fetched for the table (no new endpoint) — if the affected-order lists from Phase 4 don't carry enough identifying info (SKU/channel id) to cross-reference cleanly, that's a signal Phase 4's detector output needs a small shape addition; flag it back rather than approximating the match.

### Acceptance Criteria

- [ ] A row's `.excl-note` category is provably correct against its own underlying order data (test with a fixture where two categories are both present in the dataset, asserting each row gets the right one — the exact bug class the mockup hit).
- [ ] No row belonging to an open category's affected set is missing its annotation (test with a fixture covering every category at least once).
- [ ] Tests added.
