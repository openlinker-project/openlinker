# [MINI-EPIC] Phase 5 — Backend: remediation actions

> Parent: Epic "Analytics — display-currency picker + data-coverage remediation"
> Depends on: Phase 4, Phase 1 Task 1.2, Phase 1 Task 1.3, Phase 3
> Mockup: `docs/plans/mockups/analytics-display-currency-picker.html` — states `currency-in-progress`, `currency-fixed`, `currency-failed`, `tax-confirm`

## Scope

Two structurally different remediations, because they are structurally different problems:

- **Currency** is a genuine bulk data-repair job — real orders need real `order_records` rows re-stamped via `OrderFxStampService`, which takes real time and can fail per-order. This needs the full `analytics_remediation_runs` lifecycle from Phase 1 Task 1.2.
- **Tax** (category A) is **not a data-repair action at all** — per Phase 1 Task 1.3, it is a single, instant, reversible settings write (`includeGuessedVatRatesInNetSales`), already built in Phase 3. This phase's tax-side work is *wiring the query-time gate to respect that setting* — a CORE change, not a "remediation run." Category C (pre-rollout, backfill not yet attempted) gets one legitimate bulk action: triggering `TaxRateBackfillService` sooner than its schedule for the named orders. Category B (no rate candidate at all) has no remediation action.

## Branching

Branch `phase/2XXX-p5-remediation-actions` off the epic branch.

## Dependencies

- Phase 4 (the categories this phase remediates or wires).
- Phase 1 Task 1.2 (`CoverageResolutionStatus`, `analytics_remediation_runs` shape — currency only).
- Phase 1 Task 1.3 (the tax setting's exact semantics).
- Phase 3 (the settings table/endpoint the tax side reads).

## Acceptance Criteria (mini-epic level)

- [ ] "Recalculate all N now" for the currency category enqueues real `marketplace.order.fxStamp` jobs (the same job type used to manually fix the live-demo currency bug) and never performs a synchronous DB write from the HTTP request thread.
- [ ] Toggling the tax-inclusion setting (Phase 3) changes the very next `/analytics` Net Sales query's result set immediately — no job, no `analytics_remediation_runs` row, no delay.
- [ ] `analytics_remediation_runs` rows transition `open → in-progress → resolved | failed`, and a `failed` row always carries a non-empty `detail`. This lifecycle applies to the currency category only.
- [ ] Restarting the API mid-run does not lose the currency run's state (it's a DB row, not in-memory).

---

## Task 5.1 — Currency bulk remediation: `POST /analytics/coverage/currency/recalculate`

### Problem / Context

The manual fix on the demo DB nulled the six stamp columns and inserted 13 `sync_jobs` rows with `jobType: 'marketplace.order.fxStamp'`, verified via `SELECT status, outcome FROM sync_jobs`. This endpoint must do exactly that, via `OrderFxStampService`, never by reaching into `sync_jobs` directly from the controller.

### Proposed Solution

`AnalyticsCoverageController` (or a sibling remediation controller) exposes `POST .../currency/recalculate`: creates one `analytics_remediation_runs` row (`status: 'in-progress'`, `affectedCount` = the count from Phase 4 Task 4.1's detector), then calls `OrderFxStampService.sweep()` (or the equivalent per-order `stamp()` loop the existing service already exposes — do not add a new bulk-enqueue path if `sweep()` already covers it), bounded and paged so it fixes **every** currently-mismatched order, not just newly-created ones. The worker's existing `marketplace-order-fx-stamp.handler.ts` / `marketplace-order-fx-stamp-sweep.handler.ts` do the actual work unchanged. On the sweep's completion (job success/failure), update the `analytics_remediation_runs` row to `resolved` or `failed` (with `detail` populated from the job's terminal failure reason — reuse `FX_STAMP_TERMINAL_REASONS` for the message rather than a generic "something went wrong").

Also expose `GET .../currency/status/{runId}` (poll the run's current lifecycle state) and `GET .../currency/orders` (paginated list of affected orders, backing the `detail-currency` modal).

**Optional, only if scope allows**: an `autoRecalculateOnCurrencyChange: boolean` setting (default OFF) on Phase 3's settings table that, when ON, automatically triggers this same sweep whenever `reporting_currency_setting` changes — closing the gap at its source rather than waiting for an operator to notice. If this is deferred, note it explicitly as a follow-up rather than silently dropping it.

### Classification

**Type**: Interface + CORE
**Layer**: Interface + Application
**File(s)**: `apps/api/src/analytics/http/analytics-coverage.controller.ts` (+`.spec.ts`), `libs/core/src/orders/application/services/order-fx-stamp.service.ts` (extend if it lacks a scoped-sweep-by-order-ids entry point), `apps/worker/src/sync/handlers/marketplace-order-fx-stamp-sweep.handler.ts` (update to write the `analytics_remediation_runs` row on completion)

### Dependencies

- Phase 1 Task 1.2 (table shape).

### Assumptions

- The worker handler is the right place to flip `analytics_remediation_runs` to its terminal state (it's the one place that actually knows the job finished) — the API's `POST` only creates the `in-progress` row and enqueues.

### Acceptance Criteria

- [ ] Backs mockup states `currency-in-progress` (row exists, `status='in-progress'`) → `currency-fixed` (`status='resolved'`) or `currency-failed` (`status='failed'`, `detail` populated).
- [ ] Integration test: trigger recalculate, let the worker process the job, assert the `analytics_remediation_runs` row reaches `resolved` and the underlying `order_records` rows are correctly re-stamped (the actual regression test for the original live-demo bug).
- [ ] Tests added.

---

## Task 5.2 — Wire the tax-inclusion setting into the net-sales query, plus a bulk re-run-backfill trigger for category C

### Problem / Context

Phase 3 persists `includeGuessedVatRatesInNetSales`; Phase 1 Task 1.3 defines exactly what it must do to `netSalesOrderNetEligibleSql` / `netSalesLineNetEligibleConditionSql`. This task is the wiring between the two — a CORE change to two SQL-builder call sites, not a remediation endpoint. Category C additionally gets a genuine bulk action: `TaxRateBackfillService` already runs on a schedule, and an operator seeing a large category-C count in the coverage panel shouldn't have to wait for the next scheduled tick.

### Proposed Solution

- Extend `netSalesOrderNetEligibleSql` / `netSalesLineNetEligibleConditionSql` (`libs/core/src/orders/domain/types/net-sales-tax-rate.types.ts`) with an additional parameter (e.g. `includeBackfilledPreRollout: boolean`) that, when true, changes the literal `rec."taxRateEra" IS DISTINCT FROM 'pre-rollout'` clause to also admit a `pre-rollout` row **whose rate resolves** (mirrors Phase 4 Task 4.2's category-A definition exactly — reuse that same resolution check, do not re-derive it). Every call site in `order-record.repository.ts` / `order-line-item.repository.ts` reads the flag from Phase 3's settings table.
- `POST /analytics/coverage/tax/rerun-backfill` for category C: re-invokes `TaxRateBackfillService`'s existing resolution path on-demand for the named order ids — the same mechanism that already runs on a schedule, just triggered early. This is a synchronous or lightweight-async call (no `analytics_remediation_runs` tracking needed — a backfill attempt is idempotent and safe to re-request without a run ledger).
- Category B gets **no endpoint** — the mockup's `detail-novat` state correctly shows no "fix" action, only the informational row, because the underlying data genuinely has no resolvable rate.

### Classification

**Type**: CORE + Interface
**Layer**: Domain + Application + Interface
**File(s)**: `libs/core/src/orders/domain/types/net-sales-tax-rate.types.ts`, `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`, `order-line-item.repository.ts`, `libs/core/src/orders/application/services/tax-rate-backfill.service.ts` (+ `.interface.ts`), `apps/api/src/analytics/http/analytics-coverage.controller.ts`

### Dependencies

- Phase 1 Task 1.3, Phase 3 Task 3.1/3.2 (the setting must exist and be readable), Phase 4 Task 4.2 (category-A/C detectors).

### Assumptions

- The flag defaults to reading `false` when the setting row doesn't exist, matching Phase 3's default-OFF behaviour — byte-identical to today's Net Sales figure until an operator explicitly opts in.

### Acceptance Criteria

- [ ] Toggling the setting ON changes the very next Net Sales query's included population — no caching, no delay, no job.
- [ ] Toggling it back OFF instantly reverts to today's behaviour — a test asserts no `order_records` row is touched by either the ON or OFF transition (regression guard for Phase 1 Task 1.3's core invariant).
- [ ] `tax/rerun-backfill` on a category-C order with a real resolvable current-catalog rate moves it into category A on the next `GET /analytics/coverage` read.
- [ ] Unit tests for the two SQL-builder functions cover both flag states directly (not just through the repository).
- [ ] Tests added, including a regression test replaying the exact live-demo fixture (31 `pre-rollout` rows with resolvable rates) — asserting they appear as Net Sales–eligible only once the setting is ON, and never via any row mutation.
