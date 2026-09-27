# [EPIC] Analytics — display-currency picker + data-coverage remediation

> Local draft. Not yet created on GitHub. Written per `/create-issue` convention.
> Mockup: `docs/plans/mockups/analytics-display-currency-picker.html` (committed to repo per `docs/frontend-architecture.md § UX Mockups`).

## Problem / Context

Two real defects were found and hand-fixed on the live demo Postgres (167.233.154.227):

1. **Currency-era mismatch**: `order_records.reportingCurrency` can go stale relative to the current `reporting_currency_setting` (ADR-040 write-once stamp). Affected orders are silently excluded from revenue on `/analytics`, with no operator-visible signal that anything is wrong.
2. **Tax-rate-era exclusion**: `order_records.taxRateEra = 'pre-rollout'` permanently excludes an order from Net Sales (ADR-063), even after `TaxRateBackfillService` has resolved a valid rate. Again, silent — the KPI just reads low with no explanation.

Both were fixed manually via direct SQL / real service calls (`OrderFxStampService.stamp()`, nulling `taxRateEra`) during live diagnosis. That is not a repeatable fix — it required DB access, an operator cannot self-serve it, and there is no way to know it will happen again until revenue looks wrong.

**Neither of these is a bug** — both are ADR-040 and ADR-063 behaving exactly as designed. What's missing is operator visibility and a safe remediation path. In fact the two exclusion counts are **already computed** today: `unconvertedCount`/`unconvertedValue` (currency) and `netExcludedCount`/`netExcludedValue` (tax) exist right now on `SalesAnalyticsHeadline` (`libs/core/src/orders/domain/order-sales-aggregation.ts`) — they're just buried in a Revenue-card tooltip with no drill-down and no fix. This epic's core job is to elevate those existing numbers into an actionable panel, not to invent new detection from scratch.

This also surfaced a legitimate, requested feature: an operator running multi-currency sales (e.g. wallets in several currencies, or crypto-token totals) wants to **view `/analytics` in a currency other than the stamped reporting currency**, without touching the stamped `reportingCurrency`/`reportingTotalAmount` columns (ADR-040 restatement is explicitly out of scope — that is #2096).

## Proposed Solution

Two independent capabilities, designed together because they share one panel:

**A. Display-currency picker** — a per-viewer, read-only, **synchronous** re-render of `/analytics` in a chosen currency. Two modes, neither needing a job or progress UI: "current rate" (one live rate per distinct native currency present in the dataset, ignoring the stamp entirely) and "order-date"/stable mode (reads the already-computed stamped-currency total and applies **one** today's rate to the whole sum — a single multiply, not per-order lookups). Does not touch `order_records` stamped columns. See mockup states `native` / `converting` / `converted` / `unavailable`.

**B. Data coverage panel** — elevates the existing currency/tax exclusion counts (plus a genuinely new product-matching-error detector) into a "Data coverage" section on `/analytics`, with a real remediation path per category:
- **Currency**: a bulk, trackable job (`OrderFxStampService.sweep()`, tracked via `analytics_remediation_runs` and `CoverageResolutionStatus`) — the only category with an actual async run to poll. See mockup states `detail-currency`, `currency-in-progress` / `currency-fixed` / `currency-failed`.
- **Tax (category A — unconfirmed but resolvable)**: an org-wide, off-by-default, instantly reversible **query-time setting** that loosens the Net Sales eligibility SQL — it never mutates `taxRateEra` on any row. See mockup states `settings-open`, `tax-confirm`, `detail-tax`.
- **Tax (category C — pre-rollout, backfill not yet attempted)**: a bulk "re-run backfill now" trigger, no data mutation of its own — it just runs the existing `TaxRateBackfillService` sooner. See mockup state `detail-postrollout`.
- **Tax (category B — no rate candidate at all)**: no remediation exists; the data genuinely isn't there. See mockup state `detail-novat`.
- **Product-matching errors**: see mockup state `detail-mapping`.
- Zero open categories renders mockup state `all-clear`.

## Related gaps, deliberately out of scope

An audit while designing this surfaced six further silent-exclusion states on `/analytics` beyond the two above: order-record health statuses (`awaiting_mapping`/`source_deleted`) invisible on the dashboard; WooCommerce orders with a null `placedAt` permanently excluded from Top Products' date filtering; and a tooltip that conflates the currency and tax counts into one ambiguous number. Per `CLAUDE.md`'s "don't design for hypothetical future requirements," this epic does **not** build a generic "any future silent exclusion" framework — it builds the Data Coverage panel for exactly the two known, concrete cases, using the same visual pattern (`AnalyticsDegradationBanner`) a third case would reuse later.

## Classification

**Type**: CORE + Frontend (cross-cutting; several child issues split BE/FE per `/create-issue` convention rule)
**Layer**: Domain / Application / Infrastructure / Interface (backend); features/analytics (frontend)
**File(s)**: `libs/core/src/orders/**` (order-sales-analytics, fx-stamp, tax-rate-backfill), `apps/api/src/analytics/**`, `apps/web/src/features/analytics/**`

## Branching / merge strategy (applies to every child issue below)

```
main
 └─ epic/2XXX-analytics-currency-coverage      (created from main; hosts Phases 2-9; PRs to main only once all phases are merged into it)
     ├─ phase/2XXX-p2-currency-read-model      (created FROM the epic branch, not main)
     ├─ phase/2XXX-p3-settings-persistence
     ├─ phase/2XXX-p4-coverage-detection
     ├─ phase/2XXX-p5-remediation-actions
     ├─ phase/2XXX-p6-fe-settings-dialog
     ├─ phase/2XXX-p7-fe-coverage-panel
     ├─ phase/2XXX-p8-fe-exclusion-annotations
     └─ phase/2XXX-p9-e2e
```

Rules:

1. **Phase 1** (decisions/ADR) is *not* on this list — it merges directly to `main`, before the epic branch is even cut, because Phases 2-9 depend on the decisions it records.
2. The epic branch `epic/2XXX-analytics-currency-coverage` is created from `main` once Phase 1 is merged.
3. Each Phase gets exactly one branch, created **from the epic branch** (not from `main`). All of that phase's individual task work is committed **directly** to the phase branch — there are no per-task branches. Small scope per task keeps this safe; a phase branch is a normal short-lived feature branch, just scoped to one phase's worth of tasks.
4. Each phase branch opens a PR **into the epic branch**, reviewed and merged there.
5. Once every phase branch has merged into the epic branch, the epic branch opens one PR into `main`.
6. Phase ordering is dependency order, not necessarily merge order — Phase 6/7/8 (frontend) depend on Phase 2-5 (backend) contracts existing, but can start against a mocked API client once the DTO shapes are agreed in the phase's own issue.

## Dependencies

- None outside this epic. Depends on the already-shipped ADR-040 (order-time FX stamping) and ADR-063 (per-line tax rate / `taxRateEra`) for its vocabulary.

## Assumptions

- Neither display-currency mode needs a job, queue, or progress UI — both are aggregate-level, synchronous operations (see Phase 1 Task 1.1's ADR). Only the currency *remediation* action (Phase 5) is a real asynchronous job; the tax fix is an instant settings toggle plus, for one sub-category, a fire-and-forget backfill trigger with no run to track.
- The `analytics_remediation_runs` table (Phase 1 Task 1.2 / Phase 5) tracks the currency category only; no new UI surface is invented for its audit trail — the existing Jobs & Logs page covers detail-level debugging via `sync_jobs`.
- No restatement of historical `reportingCurrency`/`reportingTotalAmount` — that remains #2096, explicitly out of scope here.
- No `order_records` row is ever mutated by the tax-inclusion setting, in either direction — this is the load-bearing safety property Phase 1 Task 1.3 records and Phase 3/5 must preserve.

## Acceptance Criteria

- [ ] Phase 1's three decisions (currency-conversion ADR, coverage-status decision doc, ADR-063 tax-inclusion addendum) are all merged to `main` before the epic branch is cut.
- [ ] All 9 phases are implemented, each behind its own phase branch, each merged into the epic branch via reviewed PR.
- [ ] The epic branch merges to `main` with `pnpm lint && pnpm type-check && pnpm test` green end-to-end.
- [ ] Every mockup `data-state` (`native`, `converting`, `converted`, `unavailable`, `all-clear`, `settings-open`, `detail-currency`, `currency-in-progress`, `currency-fixed`, `currency-failed`, `detail-tax`, `tax-confirm`, `detail-novat`, `detail-postrollout`, `detail-mapping`) is reachable in the real, running `/analytics` page and matches the mockup's behaviour.
- [ ] The two original live-demo defects (currency-era mismatch, tax-rate-era exclusion) are each remediable by an operator from the UI, with no direct DB access required.
- [ ] Tests added/updated for all non-trivial logic (Phase-level acceptance criteria detail this further).
- [ ] No CORE ↔ Integration boundary violations.
