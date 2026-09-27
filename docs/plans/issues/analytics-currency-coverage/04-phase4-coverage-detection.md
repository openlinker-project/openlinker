# [MINI-EPIC] Phase 4 — Backend: data-coverage detection (elevate existing exclusion counts)

> Parent: Epic "Analytics — display-currency picker + data-coverage remediation"
> Depends on: Phase 1 Task 1.2, existing `order-sales-aggregation.ts` fields
> Mockup: `docs/plans/mockups/analytics-display-currency-picker.html` — states `all-clear`, `detail-currency`, `detail-tax`, `detail-novat`, `detail-postrollout`, `detail-mapping`

## Scope

**Correction to the original scoping of this phase**: the currency-mismatch and tax-era exclusion counts are **not new detectors to build** — `unconvertedCount`/`unconvertedValue` and `netExcludedCount`/`netExcludedValue` already exist today, computed in `libs/core/src/orders/domain/order-sales-aggregation.ts` and surfaced via `SalesAnalyticsHeadline` — they are simply buried in a Revenue-card tooltip on `/analytics` and carry no drill-down or remediation. This phase's real job is to **elevate** these already-computed numbers into a first-class `GET /analytics/coverage` response with per-category sample order ids for the detail modals, and to add the one genuinely new detector: product-matching errors, which the existing aggregate does not track at all.

## Branching

Branch `phase/2XXX-p4-coverage-detection` off the epic branch.

## Dependencies

- Phase 1 Task 1.2 (the `CoverageResolutionStatus` / category vocabulary must be pinned first).
- Reads `libs/core/src/orders/domain/order-sales-aggregation.ts`, `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts` and `order-line-item.repository.ts` — extends their query surface, does not change their write paths.

## Acceptance Criteria (mini-epic level)

- [ ] `GET /analytics/coverage` returns one row per category with `{ category, status: 'open', affectedCount, sampleOrderIds }`, where the currency and tax counts come from the **existing** `unconvertedCount`/`netExcludedCount` fields (not a parallel re-derivation) — zero categories with `affectedCount > 0` renders as mockup state `all-clear`.
- [ ] The tax category is further split into A/B/C sub-categories by cross-referencing the existing `netExcludedCount` population against `TaxRateBackfillService`'s resolution — this is the one place genuinely new query logic is needed on the tax side.
- [ ] Detection correctly identifies the two real defects fixed manually on the demo DB during earlier diagnosis (currency-era mismatch, `taxRateEra = 'pre-rollout'` with a resolvable current rate).

---

## Task 4.1 — Currency-mismatch drill-down (reusing `unconvertedCount`/`unconvertedValue`)

### Problem / Context

`unconvertedCount`/`unconvertedValue` on `SalesAnalyticsHeadline` already report how many orders in range have `reportingCurrency IS NULL` (per `order-record.repository.ts`'s existing `unconverted_count`/`unconverted_value` SQL aliases) — this is the currency-era-mismatch population (13 rows on the live demo DB). What's missing is: (a) the actual list of affected order ids (today only a count exists), (b) a query specifically for **stale-but-not-null** stamps (`reportingCurrency` set but diverging from the *current* `reporting_currency_setting` value — a slightly different condition than the existing `IS NULL` check, since a stamp can be present-but-wrong, not just absent).

### Proposed Solution

Extend `order-record.repository.ts` with a paged read returning the affected order ids + native/stamped currency + stamped date for two populations: (1) the existing `unconvertedCount`'s underlying rows (`reportingCurrency IS NULL`), and (2) a new but structurally identical query for `reportingCurrency IS NOT NULL AND reportingCurrency <> {current setting}`. Both feed the same `detail-currency` category — the mockup does not need to distinguish "never stamped" from "stamped stale" to the operator, since the remediation (Phase 5's bulk re-stamp) is identical for both.

### Classification

**Type**: CORE
**Layer**: Domain + Infrastructure
**File(s)**: `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`, `libs/core/src/orders/domain/types/coverage-detection.types.ts` (new)

### Dependencies

- Phase 1 Task 1.2.

### Assumptions

- The two populations (never-stamped, stamped-stale) are reported as one combined `affectedCount` in the coverage row — cross-check against Phase 1 Task 1.2's decision doc if it says otherwise.

### Acceptance Criteria

- [ ] Detector correctly flags the exact shape of orders manually fixed on the demo DB (same-currency case: `reportingCurrency='EUR'`, `currency='PLN'`) as well as the cross-currency case.
- [ ] `affectedCount` on the new endpoint matches the existing `unconvertedCount` field exactly for the never-stamped population (regression guard — the numbers must not diverge between the tooltip and the new panel).
- [ ] Reproduces mockup state `detail-currency`'s row list shape (thumbnail + order id + native currency + stamped currency + stamped date, paginated).
- [ ] Tests added, including a fixture with zero mismatches (backs `all-clear`).

---

## Task 4.2 — Tax-rate drill-down + A/B/C split (reusing `netExcludedCount`/`netExcludedValue`)

### Problem / Context

`netExcludedCount`/`netExcludedValue` already report the population `netSalesOrderNetEligibleSql` excludes (pre-rollout era, or a line with an unresolvable rate). What's missing is splitting that single number into the three operator-actionable sub-cases the mockup distinguishes, because they have different remediation paths (Phase 1 Task 1.3's setting only helps category A/C, never B):

- **A — unconfirmed-but-resolvable**: `taxRateEra = 'pre-rollout'` AND a backfilled rate exists (would become net-eligible if Phase 1 Task 1.3's setting were ON) → mockup `detail-tax`.
- **B — no tax rate at all**: excluded, and no backfill candidate resolves from the current catalog either → mockup `detail-novat`.
- **C — pre-rollout, backfill not yet run**: `taxRateEra = 'pre-rollout'` and `TaxRateBackfillService` has not yet attempted this order → mockup `detail-postrollout`.

### Proposed Solution

A read-only extension that takes the existing `netExcludedCount` population and, for each row, calls `TaxRateBackfillService`'s existing rate-resolution logic (read-only — do not trigger an actual backfill write here) to classify it into A, B, or C. Emits `{ category: 'tax-a' | 'tax-b' | 'tax-c', ... }` per Phase 1 Task 1.2's category vocabulary.

### Classification

**Type**: CORE
**Layer**: Domain + Application
**File(s)**: `libs/core/src/orders/application/services/tax-rate-backfill.service.ts` (read-only extension or a sibling read service consuming it), `libs/core/src/orders/domain/types/coverage-detection.types.ts`

### Dependencies

- Task 4.1 (shares the `coverage-detection.types.ts` file and the overall `GET /analytics/coverage` shape).

### Assumptions

- Category naming (`tax-a`/`tax-b`/`tax-c` vs. a more descriptive slug) is pinned by whatever Phase 1 Task 1.2 decided — this task must not invent its own naming if the decision doc already named them.

### Acceptance Criteria

- [ ] `affectedCount` summed across A+B+C matches the existing `netExcludedCount` field exactly (regression guard).
- [ ] Category A correctly flags the manually-fixed live-demo case (31 `taxRateEra='pre-rollout'` rows that had a resolvable backfill rate).
- [ ] Categories B and C are each independently testable with a fixture that is unambiguously that category and not another (no overlap in test data).
- [ ] Reproduces mockup states `detail-tax`, `detail-novat`, `detail-postrollout` row-list shapes.
- [ ] Tests added.

---

## Task 4.3 — Product-matching-error detector + `GET /analytics/coverage` aggregate endpoint

### Problem / Context

The mockup's `detail-mapping` state is the one genuinely new category — no existing aggregate field tracks it. This task also assembles the currency and tax detectors from 4.1/4.2 into one endpoint.

### Proposed Solution

- Product-matching-error detector: reuses whatever mapping-failure signal already exists on order line items (grep `order-line-item.repository.ts` for an existing `mappingFailureReason`/similar field before inventing a new one — the codebase already has an `awaiting_mapping`/`source_deleted` precedent per `docs/architecture-overview.md § Stale-variant offer pause`; if line items carry an equivalent field, reuse its vocabulary rather than adding a parallel one).
- `AnalyticsCoverageController` (`GET /analytics/coverage`) in `apps/api/src/analytics/http/` composes the currency detector (4.1), the three tax detectors (4.2), and this product-matching detector into one response, one row per category, `status: 'open'` (Phase 5 is what ever writes `'resolved'`/`'failed'`/`'in-progress'`, and only for the currency category — see Phase 1 Task 1.2's scoping note).

### Classification

**Type**: CORE + Interface
**Layer**: Domain + Interface
**File(s)**: `apps/api/src/analytics/http/analytics-coverage.controller.ts` (+`.spec.ts`), `apps/api/src/analytics/analytics.module.ts`

### Dependencies

- Tasks 4.1, 4.2.

### Assumptions

- The mockup's informational "3 orders fully discounted" row is a **separate, non-actionable** note — it exists to explain a KPI number, not to flag a defect, and does not carry an `analytics_remediation_runs`-trackable status at all. If Phase 1 Task 1.2's decision doc treats it differently, follow that instead.

### Acceptance Criteria

- [ ] `GET /analytics/coverage` with zero open categories reproduces mockup state `all-clear`.
- [ ] Each populated category reproduces its `detail-*` mockup state's row-list shape end-to-end (paginated, real order ids).
- [ ] Controller spec covers empty + populated + mixed-category responses.
- [ ] Tests added.
