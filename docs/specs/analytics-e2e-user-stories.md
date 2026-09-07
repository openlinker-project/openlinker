# Analytics `/analytics` — E2E User Stories & Acceptance Criteria

Reusable scenario ledger for the analytics dashboard (epic #2452 — display-currency
conversion + data-coverage remediation). This is the source list for the follow-up
e2e work: seed-helper design and Playwright specs both draw their scenario
inventory from here rather than re-deriving it.

**How to use this doc**

- A checkbox is checked **only** when a Playwright test implementing that
  exact AC exists and passes — not when the feature is merely believed to work.
- Each User Story (US) section carries a **Seed state** line naming the order/data
  condition an e2e test needs before it can assert the ACs under it. Every seed
  state here must be reachable through a real flow — an order ingested via a real
  marketplace/shop connection, an admin API call, a settings write — never a raw
  DB insert. If a scenario turns out to have no flow-driven path, that is a gap to
  raise, not a reason to add a DB shortcut.
- Definitions of every metric referenced below are canonical in
  [`docs/specs/metrics-analytics-dashboard.md`](./metrics-analytics-dashboard.md) —
  quote it, don't restate it. On any conflict between this doc and that one, the
  metrics spec wins.
- Mockup references: [`analytics-ledger-2003.html`](../plans/mockups/analytics-ledger-2003.html)
  (main page, frames 00–14), [`analytics-display-currency-picker.html`](../plans/mockups/analytics-display-currency-picker.html)
  (Data Coverage panel + Settings dialog + drill-down modals), [`analytics-top-products-inline-expand.html`](../plans/mockups/analytics-top-products-inline-expand.html)
  (Top Products row-expand behavior). Mockup-parity ACs (§L) are asserted **both**
  ways: a Playwright screenshot for a human to review, and a content/state
  assertion (`getByText`/`getByRole`/ARIA) for the test itself to pass or fail on.
- **§L is tracked as its own GitHub issue**, [#2482](https://github.com/openlinker-project/openlinker/issues/2482)
  (epic #2452 Phase 9), branch `phase/2452-p9-e2e` off the epic branch. It is
  scoped to the `analytics-display-currency-picker.html` mockup only — see §L
  for the exact `data-state` list and the hard "never screenshot the Artifact
  URL" requirement. Sections A–K and M have no filed issue yet.

---

## A. Core sales metrics (KPI strip)

**US-A1** — As an operator, I want the KPI strip to show accurate revenue and order
volume for the selected date range, so that I can trust the dashboard as my
source of truth for sales performance.

*Seed state*: a mixed batch of orders across at least two source connections,
placed within and outside the tested date range, including at least one
multi-line order with a per-line discount.

- [ ] AC-A1.1: GMV = SUM(gross unit price × qty, all lines, excluding cancelled orders) for the selected range.
- [ ] AC-A1.2: Net Sales = SUM(net after line-discounts, excluding cancelled orders) − Returns Value for the same period.
- [ ] AC-A1.3: Number of Orders = COUNT(orders, excluding cancelled) for the selected range.
- [ ] AC-A1.4: AOV = Net Sales-basis SUM ÷ Number of Orders, and an order with a partial/full return still counts at its full order value (AOV × count ≠ Net Sales by exactly the Returns Value gap).
- [ ] AC-A1.5: Median Order Value = MEDIAN over the same order set/value field AOV uses.
- [ ] AC-A1.6: Average Daily Orders = Number of Orders ÷ calendar days in range; for an ongoing (not-yet-complete) period the denominator is days elapsed so far, not the full period length.
- [ ] AC-A1.7: Units Sold = SUM(quantity, all lines, excluding cancelled orders).
- [ ] AC-A1.8: Units per Order = Units Sold ÷ Number of Orders.
- [ ] AC-A1.9: Return Rate = (orders with ≥1 issued refund) ÷ (orders placed, excluding cancelled) × 100%, and the trigger is a completed refund event, not merely a return request.
- [ ] AC-A1.10: Returns Value (UI label "Refunded value") = SUM(net refunded amounts, completed refunds only, merchandise portion only — no shipping), each converted at its **original order's** FX rate, not today's rate.
- [ ] AC-A1.11: Cancellation Rate = cancelled orders ÷ **all** orders placed (including cancelled) × 100%.
- [ ] AC-A1.12: Cancellations Value (UI label "Cancelled value") = SUM(net value of fully-cancelled orders placed in period); a partially-cancelled order's line value never appears here.

**US-A2** — As an operator, I want a partially-cancelled order handled per the
documented edge case, so that the KPI strip doesn't silently under- or
double-count it.

*Seed state*: one order with ≥2 lines where one line is cancelled and the other
ships normally.

- [ ] AC-A2.1: The order counts in Number of Orders (not excluded, not double-counted).
- [ ] AC-A2.2: The surviving line's value counts in GMV and Units Sold; the cancelled line's value is excluded from both.
- [ ] AC-A2.3: The cancelled line's value does **not** appear in Cancellations Value (that column is reserved for fully-cancelled orders only — this is a documented gap in the spec, not a bug to "fix" in a test).

---

## B. Currency conversion & coverage

**US-B1** — As an operator selling in multiple currencies, I want to pick a
single display currency and see every KPI converted into it, so that I can read
one number instead of mentally converting several.

*Seed state*: orders in at least two distinct native currencies, both already
FX-stamped (ADR-040) under the current reporting-currency era.

- [ ] AC-B1.1: Selecting a display currency converts every KPI-strip figure and the by-channel table into that currency.
- [ ] AC-B1.2: The rate-basis toggle "current rate" converts every order at today's published rate.
- [ ] AC-B1.3: The rate-basis toggle "order date" converts each order at the rate stamped for its own placement date, so two identical-value orders placed on different dates may show different converted figures.
- [ ] AC-B1.4: The two-currency KPI-strip mockup variant (frame 03b) renders when the order set spans more than one native currency and no display currency is selected.

**US-B2** — As an operator, I want the Data Coverage panel to tell me when
orders are stuck in a stale or unstamped currency, and let me fix it in one
action, so that my figures aren't silently wrong.

*Seed state*: at least one order stamped under a currency era that predates the
current `reporting_currency_setting` (produced by changing the reporting-currency
setting after the order was already ingested — a real setting write, not a
backdated DB row), plus at least one never-stamped order (e.g. an order source
whose adapter never wrote `placedAt`).

- [ ] AC-B2.1: The `currency` category in `GET /analytics/coverage` reports a non-zero affected count for this population.
- [ ] AC-B2.2: Clicking the currency `GapMark` opens the drill-down modal listing the affected orders ("N orders counted in an outdated currency" copy per the mockup).
- [ ] AC-B2.3: Triggering "Recalculate" (`POST /analytics/coverage/currency/recalculate`) opens an async remediation run; the UI polls status until it completes and the affected count drops to 0 (or the still-unresolved remainder is reported honestly).
- [ ] AC-B2.4: A second recalculate attempt while a run is already open returns 409 and the UI shows the "stuck run" recovery affordance instead of a generic error toast.
- [ ] AC-B2.5: "Cancel stuck run" (`POST .../cancel`) succeeds and the success toast reads "Stuck recalculation cancelled – you can try again" (or the shipped equivalent copy).

---

## C. Tax-rate coverage (A/B/C)

**US-C1** — As an operator, I want to see which orders are excluded from Net
Sales because of an unresolved tax rate, and understand why each one is
excluded differently, so that I know whether a fix exists for it.

*Seed state*: three distinct order populations, each with `taxRateEra =
'pre-rollout'` or a genuinely unresolved per-line tax rate: (a) a
pre-rollout order whose master-catalogue rate has since resolved (tax-A), (b) a
pre-rollout order whose master confirms the product carries no rate (tax-B), (c)
a pre-rollout order whose rate has never been checked against the catalogue at
all (tax-C).

- [ ] AC-C1.1: `GET /analytics/coverage` reports non-zero counts for `tax-a`, `tax-b`, and `tax-c` independently, and their sum matches the total pre-rollout-excluded population.
- [ ] AC-C1.2: The tax-A drill-down modal shows "N orders have an unconfirmed tax rate" and offers **no** remediation button — the fix is the settings opt-in (US-C2), not an action here.
- [ ] AC-C1.3: The tax-B drill-down modal shows "N orders have no tax rate at all" and is purely informational — no action exists for this category.
- [ ] AC-C1.4: The tax-C drill-down modal shows "N orders' rate is still unresolved" and offers a "rerun backfill" action (`POST /analytics/coverage/tax/rerun-backfill`); running it against the seeded population resolves at least the resolvable ones and the count drops accordingly.
- [ ] AC-C1.5: Rerunning the backfill shows a success toast naming how many of the scanned rate-less lines were resolved (e.g. "X of Y rate-less line(s) resolved").

**US-C2** — As an operator, I want to opt in to including tax-A orders in Net
Sales once their rate has resolved, so that I don't have to wait for a
re-ingestion to see the correct figure.

*Seed state*: reuse the tax-A order from US-C1 (resolvable pre-rollout order).

- [ ] AC-C2.1: With `includeBackfilledTaxRatesInNetSales` off (default), the tax-A order is excluded from Net Sales and counted in the coverage panel's excluded total.
- [ ] AC-C2.2: Toggling the setting on via the Analytics Settings dialog (`PUT /analytics/settings`) and re-querying immediately includes the order in Net Sales, with no re-ingestion or backfill run required.
- [ ] AC-C2.3: No `order_records` row is mutated by flipping the setting — toggling it off again reverts the figure instantly (query-time gate, not a write).

---

## D. Product-matching coverage

**US-D1** — As an operator, I want to see orders whose line items failed to
match a known product, so that I can investigate a broken mapping.

*Seed state*: an order whose item resolution fails (e.g. `recordStatus IN
('awaiting_mapping', 'source_deleted')` reached via a real ingestion against a
connection with a deliberately unmapped/deleted product).

- [ ] AC-D1.1: `GET /analytics/coverage` reports a non-zero `product-matching` count.
- [ ] AC-D1.2: The drill-down modal (`GET /analytics/coverage/matching/orders`) lists the affected orders ("N orders with a product-matching error" per the mockup).
- [ ] AC-D1.3: The modal offers **no** remediation button — this category self-heals once the mapping resolves (re-matched on the next sync), unlike currency/tax-C.

---

## E. Top Products

**US-E1** — As an operator, I want to see which products earn the most revenue
or sell the most units, with a per-channel breakdown, so that I can spot my
best sellers per marketplace.

*Seed state*: at least 3 distinct products, sold across ≥2 connections, with
different revenue/unit-count rankings under the two sort modes (e.g. a
high-price low-volume product and a low-price high-volume product).

- [ ] AC-E1.1: Sorting by revenue orders products by summed reporting-currency-stamped revenue, descending.
- [ ] AC-E1.2: Sorting by units orders products by summed units sold, descending, and a product whose orders are entirely unstamped (currency-wise) still appears here even though it may rank at revenue 0 or be absent under the revenue sort.
- [ ] AC-E1.3: Each row's inline per-channel breakdown sums back to the row's own total.

**US-E2** — As an operator, I want to expand a product row inline to see its
variant-level split, without leaving the Analytics page, so that I don't lose
my sort/scroll position for a quick look-up.

*Seed state*: a multi-variant product with sales on ≥2 variants.

- [ ] AC-E2.1: Clicking a product row expands it inline (desktop) — the page does not navigate away and the current sort/date-range state is preserved.
- [ ] AC-E2.2: The expanded panel's variant-level split is fetched lazily (only on expand, not eagerly for every row on initial load).
- [ ] AC-E2.3: If the operator attempts to navigate away mid-investigation via a path the mockup gates, the "leave page" confirm dialog appears (per `analytics-top-products-inline-expand.html`).

---

## F. Channel/product sales tables

**US-F1** — As an operator, I want the by-channel and by-product tables to be
honest about which figures are excluded and why, so that a low number isn't
mistaken for a low number of sales.

*Seed state*: reuse the currency-mismatch and tax-coverage seed states from §B/§C
so at least one row in each table has an active exclusion.

- [ ] AC-F1.1: The by-channel table renders with bases aligned (all rows share the same "as of" basis — no mixed-basis row per the mockup's frame 04/05 rule).
- [ ] AC-F1.2: A row whose figures are affected by a currency or tax exclusion shows the `AnalyticsExclusionNote` with copy naming the exclusion reason.
- [ ] AC-F1.3: A row with no active exclusion shows no note (the note is conditional, not a permanent fixture).

---

## G. Trust header / connection health

**US-G1** — As a new operator with no connections configured, I want the
dashboard to tell me clearly why it's empty, so that I know what to do next
rather than assuming the product is broken.

*Seed state*: an OL instance/test workspace with zero `OrderSource`-capable
connections configured.

- [ ] AC-G1.1: The trust header shows "Connect a sales channel to see figures here" (or shipped equivalent) instead of a bare empty chart.

**US-G2** — As an operator who just connected a channel, I want to know my
first orders are still on the way rather than assume nothing will ever appear.

*Seed state*: a connection configured and active, but with zero ingested orders
yet (no order-sync job has succeeded).

- [ ] AC-G2.1: The trust header shows "First orders are still arriving" (or shipped equivalent), distinct from the zero-connections copy in US-G1.

**US-G3** — As an operator, I want to be warned when a connection's ingestion
pipe has stalled, so that "sales dropped" and "the poll died" are never
confused.

*Seed state*: a connection whose poll job has not succeeded within its
staleness window (achievable by disabling/breaking the connection's credentials
after initial ingestion, then waiting past the threshold — a real degraded
state, not a fabricated flag).

- [ ] AC-G3.1: The trust header/degradation banner reflects a `'stalled'` ingestion status for that connection, distinguishable from `'fresh'`/`'disconnected'`/`'unknown'`.
- [ ] AC-G3.2: The degradation banner's rule from mockup frame 11 is followed — it renders only when trust status genuinely warrants it, never on a healthy instance.

---

## H. Empty / loading / error states

**US-H1** — As an operator, I want an honest empty state when my selected date
range genuinely has no orders, so I don't mistake it for a broken page.

*Seed state*: none — pick a date range guaranteed empty (mirrors the existing
`apps/e2e/tests/orders/filtered-empty-state.spec.ts` pattern of narrowing to an
impossible range rather than needing a fresh stack).

- [ ] AC-H1.1: The KPI strip and tables show "No orders in this range" (mockup frame 09) rather than zeros dressed up as real figures, or a blank void.

**US-H2** — As an operator, I want to know when Top Products specifically
failed to load, even if the rest of the page is fine, so partial failures are
visible per-section.

*Seed state*: simulate a Top Products fetch failure (e.g. via a route
intercept in the test) while the rest of the page's data is healthy.

- [ ] AC-H2.1: The Top Products section shows "Unable to load top products" (mockup frame 09) while the KPI strip and other sections remain populated and unaffected.

**US-H3** — As an operator, I want to see that a recalculation is in progress
on any KPI it affects, so I don't mistake a stale number for the final answer.

*Seed state*: reuse the currency-recalculation run from US-B2, captured mid-flight.

- [ ] AC-H3.1: While a recalculation run is open, the affected KPI(s) show the pending/`aria-busy` indicator (`RecalculatingValue` component / `kpi-strip-pending` state) instead of silently displaying a stale number as if final.
- [ ] AC-H3.2: Once the run completes, the pending indicator clears and the figure updates without a manual page reload.

---

## I. Needs-attention section

**US-I1** — As an operator, I want one place summarizing coverage gaps,
stock-at-risk, and value stuck in failed syncs across my whole catalogue, so I
don't have to hunt through separate pages.

*Seed state*: at least one item in each of the three categories (a coverage gap
from §B/§C/§D, a low-stock/at-risk listing, and an order stuck in a failed sync
state).

- [ ] AC-I1.1: The Needs-attention section renders unconditionally (not gated behind a filter) and reflects all three category counts accurately.
- [ ] AC-I1.2: Each count is clickable/navigable to its underlying detail (coverage panel, listings stock-at-risk view, failed-sync orders list).

---

## J. Analytics Settings dialog

**US-J1** — As an admin, I want my display-currency, rate-basis, and
tax-inclusion choices to persist across sessions, so I don't have to re-pick
them every visit.

*Seed state*: an admin session.

- [ ] AC-J1.1: Setting a display-currency override via the Settings dialog (`PUT /analytics/settings`) persists it — reloading `/analytics` (or a fresh session) shows the same override applied.
- [ ] AC-J1.2: The rate-basis choice persists the same way.
- [ ] AC-J1.3: The `includeBackfilledTaxRatesInNetSales` opt-in persists the same way (reinforces AC-C2.2's immediacy, this AC is about persistence across reloads specifically).

**US-J2** — As a non-admin operator, I should not be able to change
organization-wide analytics settings, so a display preference can't
accidentally corrupt what everyone else sees.

*Seed state*: a non-admin (`operator` or `viewer`) authenticated session.

- [ ] AC-J2.1: `GET /analytics/settings` is readable by any authenticated user.
- [ ] AC-J2.2: `PUT /analytics/settings` is rejected for a non-admin session (403/hidden control), and the Settings dialog's write affordances are disabled or hidden per the `AccessGate`/`useWriteAccess` convention rather than merely failing silently on submit.

---

## K. Notifications (toasts)

**US-K1** — As an operator, I want a clear toast confirming every mutating
analytics action succeeded or failed, so I'm never left guessing whether my
click did anything.

*Seed state*: reuses the mutation flows from §B/§C (recalculate, cancel-stuck-run,
rerun-backfill) plus §J (settings save).

- [ ] AC-K1.1: A successful currency recalculation trigger shows a toast confirming the run started (or completed, depending on shipped UX — assert the actual shipped copy, not an assumed one).
- [ ] AC-K1.2: Cancelling a stuck run shows the success toast with the copy from AC-B2.5.
- [ ] AC-K1.3: A successful rerun-backfill shows the resolved-count success toast from AC-C1.5.
- [ ] AC-K1.4: A successful settings save shows a success toast.
- [ ] AC-K1.5: Each of the above mutations, when made to fail (e.g. simulated network/API error), shows an error toast (`ApiError` message or a generic fallback) instead of failing silently.
- [ ] AC-K1.6: The recalculate-currency 409-conflict case does **not** show a generic error toast — it routes to the "stuck run" recovery UI instead (already covered by AC-B2.4; cross-referenced here as a notification-specific negative assertion).

---

## L. Mockup parity

**Tracked as [#2482](https://github.com/openlinker-project/openlinker/issues/2482)
(epic #2452 Phase 9).** Scope is narrower and more precise than earlier drafts of
this section: it covers **only** `docs/plans/mockups/analytics-display-currency-picker.html`
(Data Coverage panel + Settings dialog + drill-down modals), driven through its
own `data-goto` state machine — **not** `analytics-ledger-2003.html` (KPI strip /
trust header / top products / responsive frames) or
`analytics-top-products-inline-expand.html` (row-expand behavior). Those two
remain real gaps with no filed issue yet — see the note at the end of this
section.

**Hard requirements from #2482, non-negotiable:**
- The baseline is the **repo-committed mockup file on the exact commit under
  test**, read directly off disk (`file://` or a short-lived local static
  server) — **never** the Claude Artifact URL, which can drift or expire
  independently of the repo.
- Comparison is **structural/visual, not pixel-perfect** — it must catch a real
  copy or layout regression, not fail on anti-aliasing noise.
- A failing assertion must **name the specific `data-state` that diverged and
  how** — "screenshot mismatch" alone is not an acceptable failure message.
- Every state must be forced **deterministically via seeded backend fixture
  data** (a real currency-era mismatch, a real order in each tax category, a
  real mapping-error order, a real in-flight/failed remediation run) — never
  hand-curated demo-DB state that can silently drift out from under the test.
- This spec is **merge-ready and lands on `main`**, not a throwaway
  investigation script (per the user's standing e2e rule).

**US-L1** — As a reviewer, I want every state
`analytics-display-currency-picker.html` defines to be provably identical
(structurally) between the mockup and the real running page, so that a design
regression is caught before it ships.

*Seed state*: see the per-state notes below; several states reuse the seed
states already defined in §B/§C/§D (currency-mismatch order, tax-A/B/C orders,
product-matching-error order, an open/failed remediation run).

Each AC below pairs one Playwright screenshot (mockup file vs. real page, for
human review) with one content/state assertion (for automated pass/fail) —
per the user's "screenshots for humans, content/state for robots" split.

- [ ] AC-L1.1 `native`: baseline state, no currency conversion applied, matches.
- [ ] AC-L1.2 `converting`: the brief client-side wait state (no backend job involved) matches.
- [ ] AC-L1.3 `converted`: the successful multi-currency conversion banner matches.
- [ ] AC-L1.4 `unavailable`: the state where a native currency has no resolvable rate matches (seed: an order in a currency the registered FX providers don't quote).
- [ ] AC-L1.5 `settings-open`: the Analytics Settings dialog, both sections, matches.
- [ ] AC-L1.6 `all-clear`: the Data Coverage panel with zero open categories matches (seed: a clean order set with no active coverage gap).
- [ ] AC-L1.7 `detail-currency`: the currency-mismatch detail modal matches (reuses the US-B2 seed state).
- [ ] AC-L1.8 `currency-in-progress`: the currency-remediation-running state matches (reuses the US-B2 in-flight-run seed state).
- [ ] AC-L1.9 `currency-fixed`: the transient "remediation resolved" closing state matches.
- [ ] AC-L1.10 `currency-failed`: the "remediation failed" state matches (seed: a run that terminates in a failed outcome).
- [ ] AC-L1.11 `detail-tax`: the unconfirmed-tax-rate (A) detail modal matches (reuses the US-C1 tax-A seed state).
- [ ] AC-L1.12 `tax-confirm`: the tax-rate-inclusion setting confirmation dialog (inside the Settings dialog, not the coverage panel) matches.
- [ ] AC-L1.13 `detail-novat`: the no-tax-rate (B) detail modal matches (reuses the US-C1 tax-B seed state).
- [ ] AC-L1.14 `detail-postrollout`: the pre-rollout-unresolved (C) detail modal matches (reuses the US-C1 tax-C seed state).
- [ ] AC-L1.15 `detail-mapping`: the product-matching-error detail modal matches (reuses the US-D1 seed state).

Phase 8's `.excl-note`/`GapMark` annotations have no standalone `data-goto`
entry in the mockup — they are asserted as embedded checks **within** the
`all-clear`/`detail-*` screenshots above (AC-L1.6–AC-L1.15), not as separate
top-level ACs.

**Known gap, not covered by #2482 or this section**: `analytics-ledger-2003.html`
(KPI strip frames 03/03b, trust header, top products, empty/fresh-instance
frames 09/10, tablet/mobile frames 07/08) and
`analytics-top-products-inline-expand.html` (row-expand + "leave page" confirm)
have no comparable state-by-state e2e coverage and no filed issue yet. Raise a
follow-up issue mirroring #2482's shape before building that coverage — do not
fold it into the #2482 branch, which is scoped to one mockup file only.

---

## M. Date-range / period-assignment correctness

**US-M1** — As an operator, I want every figure assigned to the period the
order was actually placed in, not when it was paid or shipped, so that
period-over-period comparisons are meaningful.

*Seed state*: an order whose placement date, payment date, and ship date fall in
three different reporting periods (e.g. placed near a period boundary).

- [ ] AC-M1.1: The order is counted in the period containing its placement date, regardless of when payment or shipment occurred.

**US-M2** — As an operator, I want the date-range picker's boundaries to be
unambiguous, so I don't wonder whether "today" is included.

*Seed state*: orders placed exactly at the range's start instant and exactly at
its end instant.

- [ ] AC-M2.1: An order placed at the exact start of the selected range is included.
- [ ] AC-M2.2: An order placed at the exact end of the selected range is included (or excluded, per whichever boundary rule is actually shipped — assert the real behavior, don't assume inclusive-both).

---

## Coverage summary

| Section | User Stories | ACs |
|---|---|---|
| A — Core sales metrics | 2 | 15 |
| B — Currency conversion & coverage | 2 | 9 |
| C — Tax-rate coverage | 2 | 8 |
| D — Product-matching coverage | 1 | 3 |
| E — Top Products | 2 | 6 |
| F — Channel/product sales tables | 1 | 3 |
| G — Trust header / connection health | 3 | 4 |
| H — Empty / loading / error states | 3 | 4 |
| I — Needs-attention section | 1 | 2 |
| J — Analytics Settings dialog | 2 | 5 |
| K — Notifications | 1 | 6 |
| L — Mockup parity ([#2482](https://github.com/openlinker-project/openlinker/issues/2482)) | 1 | 15 |
| M — Date-range / period correctness | 2 | 3 |
| **Total** | **23** | **83** |

## Known gap: seed states not yet proven flow-driven

Every seed state above is written on the assumption it's reachable through a
real order/webhook/admin-API flow. Two are flagged as genuinely uncertain and
need a spike before the seed-helper design starts:

- **US-B2 / US-C1** (an order stamped under a *previous* reporting-currency era):
  requires ingesting an order, then changing the reporting-currency setting via
  a real `PUT`, then ingesting a second order — achievable in-flow, but the
  *first* order's stamp only becomes "stale" relative to the *new* setting, so
  the test must sequence the setting change carefully rather than assume any
  two orders differ by era.
- **US-G3** (stalled ingestion): breaking a connection's credentials and
  waiting out the staleness window in a live e2e run may be slow (the window is
  measured in the connection's own poll cadence) — worth checking whether the
  staleness threshold is configurable per-test-connection before committing to
  a real-time wait.
