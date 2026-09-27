# [MINI-EPIC] Phase 1 — Decisions & documentation

> Parent: Epic "Analytics — display-currency picker + data-coverage remediation"
> Mockup: `docs/plans/mockups/analytics-display-currency-picker.html`

## Scope

Record the decisions the rest of the epic depends on, before any code is written. **Merges directly to `main`** — no epic branch exists yet at this point; the epic branch is cut from `main` only after all three tasks here land.

## Branching

All three tasks below are small and land as ordinary PRs straight to `main` (branch names `{issue#}-{slug}` per the repo convention, off `main`). None goes through the epic branch.

## Dependencies

None — this is the epic's entry point.

## Acceptance Criteria (mini-epic level)

- [ ] Tasks 1.1, 1.2, and 1.3 are all merged to `main`.
- [ ] `epic/2XXX-analytics-currency-coverage` can then be cut from `main` with all three decisions already in place.

---

## Task 1.1 — ADR: display-currency conversion policy for `/analytics`

### Problem / Context

`/analytics` currently renders only in each order's stamped `reportingCurrency` (ADR-040). There is a legitimate operator need to view the dashboard in an arbitrary currency (a multi-currency-wallet or crypto-token-total shop is the concrete case that motivated this) without restating any stamped column.

**This ADR must lead with, and resolve, a direct tension with ADR-040.** ADR-040 states that read-time conversion cannot produce a defensible financial figure ("przeliczanie w momencie odczytu nie może dać wiarygodnej liczby finansowej" — read-time conversion cannot yield a trustworthy financial number) — and a display-currency picker superficially looks exactly like the pattern ADR-040 forbids. The resolution the design converged on: this feature is compliant with ADR-040 **only** because it is strictly a *display* transform — it changes what one viewer sees on one screen, nothing is written back, and the stamped `reportingCurrency`/`reportingTotalAmount` columns (the actual financial record of truth) are never touched. The ADR must state this distinction explicitly and up front, because it is the one thing a future reader is most likely to get wrong by pattern-matching against ADR-040's banned case.

### Proposed Solution

Write `docs/architecture/adrs/0XX-analytics-display-currency-conversion.md` covering:

- The ADR-040 tension and its resolution, stated first (see above).
- **Both conversion modes operate at the aggregate level — neither needs a background job, a progress bar, or per-order network calls.** This was explicitly worked out via `/grill-me` after an early sketch (naive synchronous per-order conversion inside the request) was rejected in `/tech-review`:
  - **"Current rate"** (default) — reads each order's own native `currency`/`totalAmount` directly, ignoring the ADR-040 stamp entirely, groups the result set by **native currency** (not by order or by date), resolves one live rate per distinct native currency present, and sums. Cheap and synchronous because the number of distinct native currencies in any real dataset is small (rarely more than a handful), regardless of how many orders there are.
  - **"Rate on order date" / stable mode** — reads the *already-computed* aggregate in the system's stamped reporting currency (the normal `/analytics` result). If the requested display currency equals the current reporting currency, this is a no-op. If it differs, apply **one** today's rate to the whole already-summed total — a single multiply, not a per-order historical-rate lookup. This mode intentionally does not attempt per-order historical accuracy; it answers "what does my current total look like in currency X," not "what would each order have converted to on its own date."
- Neither mode recomputes or improves the coverage of old stamped/unconverted orders — that is Phase 5's remediation job, a separate concern this ADR explicitly does not solve.
- Default mode = "current rate"; the toggle between modes is exposed in the Analytics Settings dialog (Phase 6) as an explicit, visible control (button, not a buried tooltip) — mirroring the existing date-range control's URL-state pattern (`?displayCurrency=&rateBasis=`).
- Explicit non-goal: no restatement of `order_records.reportingCurrency` / `reportingTotalAmount` — that remains #2096.
- **A short "related gaps, deliberately out of scope" note**, so a future reader doesn't rediscover these and wonder why they weren't addressed: an audit surfaced six further silent-exclusion states on `/analytics` beyond the two this epic targets (order-record health statuses `awaiting_mapping`/`source_deleted` invisible on the dashboard; WooCommerce orders with a null `placedAt` permanently excluded from Top Products' date filtering; a tooltip that conflates the currency and tax exclusion counts into one ambiguous number). Per `CLAUDE.md`'s "don't design for hypothetical future requirements," this epic builds a Data Coverage panel for exactly the two known, concrete cases (currency, tax pre-rollout) using the same visual pattern (`AnalyticsDegradationBanner`) — it does **not** build a general-purpose "any future silent exclusion" framework. A third case gets its own banner later, following the same pattern, not a speculative engine now.

### Classification

**Type**: DX / Documentation
**Layer**: N/A (ADR)
**File(s)**: `docs/architecture/adrs/0XX-analytics-display-currency-conversion.md`

### Dependencies

None.

### Assumptions

- ADR number is assigned at write time (next available in `docs/architecture/adrs/`).

### Acceptance Criteria

- [ ] ADR follows the template in `docs/architecture/adrs/README.md`.
- [ ] The ADR-040 tension is addressed in the first substantive section, not buried.
- [ ] ADR explicitly states neither mode requires a job, queue, or progress UI, and explains why (aggregate-level math over a small distinct-currency set, or a single multiply over an already-computed total).
- [ ] The "related gaps, deliberately out of scope" note is present.
- [ ] ADR is merged to `main` before the epic branch is cut.

---

## Task 1.2 — Decision doc: data-coverage remediation model (`CoverageResolutionStatus`, `analytics_remediation_runs`)

### Problem / Context

The Data Coverage panel (mockup `settings-open` → Data coverage section, and the detail modals it opens) needs a shared vocabulary for "is this exclusion category fixed yet." Design iteration converged on a **lifecycle-only** `CoverageResolutionStatus` union (`'open' | 'in-progress' | 'resolved' | 'failed'`), with **tone** (success/warning/critical) derived by a *separate* pure function rather than folded into compound status strings. The rejected alternative, in the user's own words: *"moze status po prostu? i to bedzie status success-closed czy cos konczocay wszystkei statusy, bedzie tez succes-unclosed, warning itp itd"* (a single compound status combining outcome and lifecycle, e.g. `success-closed`) — rejected in favor of splitting lifecycle from tone, following the `deriveOrderHealth` / `ConnectionIngestionStatus` precedent already in the codebase.

**This status model applies specifically to the CURRENCY remediation category**, which is the only category in this epic that runs as a bounded, trackable, asynchronous job (Phase 5). The tax-rate category (Task 1.3) is a synchronous settings toggle with no run to track — it does not use this table.

### Proposed Solution

Write `docs/plans/analysis/analytics-coverage-remediation-decision.md` (or promote to an ADR if reviewers want one) recording:

- The `CoverageResolutionStatus` union + `deriveCoverageDisplay(status, category) → { tone, label }` split, with the rejected compound-string alternative and why.
- The `analytics_remediation_runs` table shape (`category`, `status`, `detail`, `triggeredBy`, `affectedCount`, timestamps) — mirrors `sync_jobs.lastError` / `salesDocumentBlockDetail` precedents. Scoped explicitly to the currency-recalculation run; the schema stays a general `category: string` column rather than a `'currency'`-only literal so a future *async* category can reuse it, but nothing in this epic other than currency uses it today.
- Explicit mapping of mockup states to lifecycle values: `detail-currency` (row in `open`) → `currency-in-progress` (`in-progress`) → `currency-fixed` (`resolved`, shown transiently via the row's own closing-delay CSS transition before it disappears) *or* `currency-failed` (`failed`, with `detail` populated) → `all-clear` (zero `open`/`in-progress` rows left).
- That a `resolved` row's disappearance is driven by the real `UPDATE analytics_remediation_runs SET status='resolved'` completing (Phase 5), not a UI-only timer.
- The row's transient "Fixed — closing…" sub-state before it disappears, and the resulting success confirmation rendering as a dismissible, green, **inline** `.coverage-alert` inside the Data Coverage section — confirmed design, replacing an earlier toast-based sketch (user: *"zamiast toasta mial pozostawac notifcation w sekcji data coverage tylko miec opcje zamkniecia... i mial sie robic na zielono"* — instead of a toast, it should stay as a notification inside the Data Coverage section with just a close option, and it should render green).

### Classification

**Type**: DX / Documentation
**Layer**: N/A
**File(s)**: `docs/plans/analysis/analytics-coverage-remediation-decision.md` (or `docs/architecture/adrs/0XX-...md` if escalated)

### Dependencies

- None (parallel to Task 1.1 and 1.3).

### Assumptions

- Team accepts the lifecycle-only status model as designed; if not, this doc is the place to revisit before Phase 4/5 begin, not after.

### Acceptance Criteria

- [ ] Decision doc merged to `main`.
- [ ] `CoverageResolutionStatus` values and `analytics_remediation_runs` columns are pinned exactly (so Phase 4/5 don't re-litigate).
- [ ] Doc explicitly states the mockup-state → lifecycle-value mapping above, so Phase 7 (FE) and Phase 9 (E2E) have one source of truth.
- [ ] Doc explicitly states this model covers the currency category only — the tax category (Task 1.3) is out of its scope.

---

## Task 1.3 — ADR-063 addendum: query-time opt-in for backfilled pre-rollout tax rates in Net Sales

### Problem / Context

`order_records.taxRateEra = 'pre-rollout'` permanently excludes an order from Net Sales per ADR-063 — enforced by the literal SQL condition `rec."taxRateEra" IS DISTINCT FROM 'pre-rollout'` inside `netSalesOrderNetEligibleSql` / `netSalesLineNetEligibleConditionSql` (`libs/core/src/orders/domain/types/net-sales-tax-rate.types.ts`). This holds even once `TaxRateBackfillService` has resolved a real, current-catalog tax rate for that order — because a backfilled rate is "today's" rate, not the rate confirmed at order time, and ADR-063 treats that distinction as load-bearing (the rate could have changed since).

The manual live-demo fix (nulling `taxRateEra` for 31 rows via raw SQL) permanently erases that distinction for those specific rows. **This is explicitly not the mechanism this epic ships.** The correct, decided mechanism is an operator-controlled, reversible, **query-time** setting: it loosens the net-sales eligibility condition when reading, and never mutates `taxRateEra` on any row. Turning the setting off instantly reverts every affected order back to excluded — nothing was overwritten. In the user's framing of the earlier (rejected) per-order approach: a settings-level toggle that just changes future query behavior is fundamentally different from, and safer than, a one-way per-order data mutation — and only the toggle survived design review.

### Proposed Solution

Write an addendum to `docs/architecture/adrs/063-per-line-tax-rate-resolution-and-provenance.md` (or a new short ADR cross-referencing it, team's call) recording:

- A new operator setting, `includeGuessedVatRatesInNetSales: boolean`, default **OFF**.
- When OFF (default): behavior is byte-identical to today — `taxRateEra = 'pre-rollout'` orders stay excluded from Net Sales, full stop.
- When ON: `netSalesOrderNetEligibleSql` / `netSalesLineNetEligibleConditionSql` additionally accept a `taxRateEra = 'pre-rollout'` row **provided** a backfilled rate actually resolves for it (i.e. the row would otherwise contribute a known rate fraction, not `unknown`) — a pre-rollout order with genuinely no resolvable rate (category B) stays excluded regardless of the setting.
- The setting is **never** written to `order_records.taxRateEra` or any other per-order column — it is read once per query, at the SQL-builder call site, exactly like an ordinary query parameter.
- This is additive to ADR-063, not a reversal: ADR-063's default behavior (exclude) is unchanged; this only adds an explicit, off-by-default, instantly-reversible way for an operator who understands the tradeoff to opt in.
- Where the setting lives: the same settings surface Phase 3 builds for the display-currency preference (one settings table, one dialog) — this is a second field on it, not a new table.

### Classification

**Type**: DX / Documentation
**Layer**: N/A (ADR addendum)
**File(s)**: `docs/architecture/adrs/063-per-line-tax-rate-resolution-and-provenance.md` (addendum section) or a new linked ADR

### Dependencies

None (parallel to Task 1.1 and 1.2).

### Assumptions

- The setting name `includeGuessedVatRatesInNetSales` is a working name from design discussion — country-agnostic naming should be reconsidered at write time (VAT is EU/PL-specific vocabulary; the codebase's own convention is neutral `taxRate`/`taxRateEra`) — e.g. `includeBackfilledTaxRatesInNetSales`.

### Acceptance Criteria

- [ ] Addendum merged to `main`.
- [ ] States explicitly, in one sentence a future reader can't miss: this setting never mutates `taxRateEra`.
- [ ] Names the exact two SQL-builder functions this setting parametrizes, so Phase 5's implementer doesn't have to rediscover them.
- [ ] Setting name is country-agnostic (no "VAT" in the final identifier).
