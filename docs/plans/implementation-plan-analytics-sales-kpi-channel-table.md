# Implementation Plan: `/analytics` KPI strip + by-channel table (#1990)

**Date**: 2026-08-18
**Status**: Draft
**Estimated Effort**: 3–5 days

---

## 0. Critical context — dependencies are not yet on `main`

This plan was generated against `origin/main` (`bd642a070`), which does **not** contain either
blocking issue:

- **#1986** (route shell) — implemented on local branch `1986-analytics-page-shell`, based
  directly on current `main` tip. Ships `apps/web/src/pages/analytics/analytics-page.tsx`,
  `AnalyticsDateRangeToolbar`, `AnalyticsTrustHeader`, `AnalyticsDegradationBanner`, the
  `analytics.route.tsx` registration, and a `currency-settings` feature slice.
- **#1987** (sales & channel aggregates endpoint) — a working implementation exists on local
  branch `1987-sales-channel-aggregates` (`GET /analytics/sales`), also based on current `main`
  tip, but it predates the currency/FX-stamp work (#2049 / ADR-040 / reporting-currency). A
  **separate, further-along, uncommitted** revision of the same endpoint (seen in another active
  worktree for the same issue) adds `reportingCurrency`, per-headline `stampedOrderCount`, and a
  per-channel `revenueBasis: 'reporting' | 'native' | 'unavailable'` + `taxTreatment` /
  `taxTreatmentMixed` — i.e. exactly the currency/gross-net machinery this issue's acceptance
  criteria require. **The final merged shape of `GET /analytics/sales` is not yet settled.**
- A **prior, now-superseded attempt at #1990 itself** exists on local branch
  `1990-analytics-kpi-strip-channel-table` (commits `af08b361b`/`45137031a`/`f945a39ef`/`b6eafa5e8`).
  It is a complete, tech-reviewed, tested implementation of the KPI strip + channel table —
  built against the **pre-currency** `#1987` shape and an analytics page shell that predates the
  current `#1986` branch. It is **the single best reference for component structure, file
  layout, and test shape** in this plan, but its money-rendering logic (`formatAmount(x,
  undefined)` everywhere) is stale against the current acceptance criteria and must not be
  copied verbatim.

**Phase 0 of this plan (below) is a mandatory re-verification step**: before writing any FE code,
confirm the actual merged shape of `#1986` and `#1987` against `main`, and adjust
`sales-analytics.types.ts` to match. Everywhere this plan states a field name from the DTO, it is
marked either **(confirmed)** — present in the committed `1987-sales-channel-aggregates` branch —
or **(expected, unconfirmed)** — from the in-flight currency work, not yet committed anywhere.

---

## 1. Task Summary

**Objective**: Build the money-half top section of `/analytics` — a 6-card KPI strip (Revenue,
Orders, Order value w/ median, Units, Cancellations, Returns & refunds) and a by-channel
`DataTable` (revenue, share, orders, AOV, units, trend sparkline) — consuming `GET
/analytics/sales` and mounting into the `#1986` route-shell page.

**Context**: Part of the `/analytics` epic (#1976, design doc
`docs/specs/product-spec-1976-analytics.md` § 5 Design 1 "Ledger", § 6, stories S1/S2). The
trust header + needs-attention half of the page already ships (#1989, #1982/#2037/#2083/#2121,
merged to `main`); this issue is the first *money* section, gated correctness-wise on #1987 doing
currency/gross-net honestly rather than blending figures across currencies or tax bases.

**Classification**: Frontend (feature slice `features/analytics` + `pages/analytics`).

---

## 2. Scope & Non-Goals

### In Scope
- KPI strip: Revenue, Orders, Order value (mean + median), Units, Cancellations — all backed by
  real `#1987` fields. Returns & refunds renders as an honest "not available" placeholder (no
  return/refund entity exists anywhere in the repo).
- By-channel `DataTable`: revenue, share, orders, AOV, units, trend sparkline, per connected
  channel (source connection).
- Currency correctness per the ACs: every figure carries its currency; a mixed-currency range
  never renders one blended number; gross/net incomparability is stated, not hidden; partial
  channel history is visibly marked.
- Loading/error states per section, independently (a channel-table failure must not blank the
  KPI strip).
- Responsive reflow (KPI strip 1×4/2×2/vertical is now 1×N reflow at 6 cards; table → card view).
- Unit + component tests.

### Out of Scope
- Revenue time-series chart (sparkline-level trend only — no new chart primitive).
- Period-over-period comparison (`#1987` has no prior-range concept).
- Top-products table (#1991), needs-attention (#1989, already shipped separately).
- Commerce-mix rows (COD/Paczkomat/Smart!) — group I, deferred to v2.
- Changing `#1987`'s domain/service layer. This plan treats the endpoint as a consumed contract;
  if Phase 0 finds the contract missing a field this plan needs, the gap is raised back against
  #1987, not patched around in the FE.

### Constraints
- Must not introduce a charting library (`docs/specs/product-spec-1976-analytics.md` binding
  constraint — sparkline only).
- Must reuse `PageLayout`, `.status-strip` + `KpiCard`, `DataTable`, `Chip`, `Sparkline`,
  `EmptyState`/`ErrorState`/`LoadingState` — no new primitives.
- Per this session's instruction: **local only** — no commit, no push, no PR for this plan.

---

## 3. Architecture Mapping

**Target Layer**: Frontend (`apps/web/src/features/analytics/**`, `apps/web/src/pages/analytics/analytics-page.tsx`).

**Capabilities Involved**: none backend-side (pure FE consumer). Backend capability already
covered by `#1987`'s `IOrderRecordService.getSalesAndChannelAnalytics` (core `orders` context).

**Existing Services Reused**:
- `useApiClient()` / `app/api/api-client.ts` — add an `analytics.getSales` namespace (mirrors the
  `analytics.getTrust` namespace `#1986` already registers).
- `features/connections` (`useConnectionsQuery`, `ConnectionCell`) and `features/orders`
  (`ConnectionDot`) for channel identity — same pattern `#1996`/`#2027` established.
- `shared/ui`: `DataTable`, `Chip`, `Sparkline`, `Button`, `EmptyValue`, `LoadingState`/`ErrorState`.
- `shared/format/format-amount.ts` (`formatAmount(amount, currency)` — already currency-aware,
  already on `main`, no changes needed).
- `shared/i18n/use-number-format.ts` for ratio/percent formatting.
- `features/analytics` barrel (`#1986`/`#1989` already populate it) — this issue adds to the same
  barrel rather than creating a second one.

**New Components Required**:
- `features/analytics/api/sales-analytics.types.ts`, `.api.ts`, `.query-keys.ts`
- `features/analytics/hooks/use-sales-analytics-query.ts`
- `features/analytics/lib/sales-analytics-view-model.ts`
- `features/analytics/components/analytics-kpi-card.tsx`, `analytics-infotip.tsx`, `gap-mark.tsx`,
  `analytics-kpi-strip.tsx`, `channel-sales-table.tsx`
- Wiring in `pages/analytics/analytics-page.tsx` (extend, don't replace, the `#1986` shell)

**Core vs Integration Justification**: N/A — this is a pure frontend consumer of an existing HTTP
endpoint; no core/integration boundary is touched.

---

## 4. External / Domain Research

### Reference implementation (branch `1990-analytics-kpi-strip-channel-table`)
A complete prior attempt exists (commits `f945a39ef`, `b6eafa5e8`), including tests, and it
already survived one tech-review round. File inventory to mine for structure (not to copy
verbatim — see § 0 on the currency gap):

```
apps/web/src/features/analytics/api/sales-analytics.api.ts
apps/web/src/features/analytics/api/sales-analytics.query-keys.ts
apps/web/src/features/analytics/api/sales-analytics.types.ts
apps/web/src/features/analytics/components/analytics-infotip.tsx (+.test.tsx)
apps/web/src/features/analytics/components/analytics-kpi-card.tsx
apps/web/src/features/analytics/components/analytics-kpi-strip.tsx (+.test.tsx)
apps/web/src/features/analytics/components/channel-sales-table.tsx (+.test.tsx)
apps/web/src/features/analytics/components/gap-mark.tsx
apps/web/src/features/analytics/hooks/use-sales-analytics-query.ts
apps/web/src/features/analytics/lib/sales-analytics-view-model.ts (+.test.ts)
```

Its documented design decisions worth keeping:
- **"Real vs. not-yet-real is explicit, never fabricated."** Revenue's headline needs a refund
  figure that doesn't exist anywhere → renders as an honest placeholder (`GapMark` + `EmptyValue`)
  while the GMV qualifier (`headline.revenue`, real) renders normally. Returns & refunds is fully
  planned. Cancellations is fully real (`cancelledCount`/`cancelledValue` are genuine fields).
  Every "vs previous period" delta is a static placeholder (no comparison-range concept in the
  API at all). **Keep this pattern** — do not invent numbers the API doesn't provide.
- **Each section owns its own `useSalesAnalyticsQuery(filters)` call** rather than a shared
  `query` prop threaded down from the page. Because the `queryKey` is identical for the same
  `filters`, TanStack Query dedupes the network request automatically — this is *why* a
  channel-table failure can't blank the KPI strip (they're independent renders, not independent
  fetches) and is the correct pattern to keep.
- Channel identity via `ConnectionCell` + `ConnectionDot`, joined client-side against
  `useConnectionsQuery()` since `ChannelSalesAnalyticsDto` carries only `sourceConnectionId`.

### A confirmed defect in the reference implementation — do not repeat it
`sales-analytics.api.ts`'s `buildQuery` passes the toolbar's `to` (an **inclusive**, `yyyy-mm-dd`
day string from `date-range.lib.ts`) straight through as the query param. But the controller
(`sales-analytics.controller.ts`, confirmed on the `1987-sales-channel-aggregates` branch) does
`new Date(query.to)`, which parses to **midnight UTC of that day**, and the domain service treats
`to` as **exclusive**. Passed through unconverted, the selected range's entire last day is
silently dropped from every figure. **This plan's Phase 1 must convert the inclusive UI end-date
into an exclusive boundary** (start of the day *after* `to`) before calling the endpoint — a
one-line fix in the query-building step, covered by a unit test asserting the boundary.

### `#1986` route shell — confirmed integration point
`analytics-page.tsx` (branch `1986-analytics-page-shell`) already:
- reads `from`/`to` from URL search params (`yyyy-mm-dd`, inclusive), defaulting to a 30-day
  preset written back into the URL on first visit;
- renders `AnalyticsDateRangeToolbar`, then gates everything else on `useAnalyticsTrustQuery()`:
  loading/error states, an `EmptyState` when there are zero connections, and — once trust data
  loads — `AnalyticsDegradationBanner` + `AnalyticsTrustHeader`, followed by an `EmptyState` when
  *every* connection is `'never-ingested'`.
- This issue's sections mount **after** that trust block, inside the same "at least one
  connection has ingested something" branch — i.e. as an addition to the final `<>...</>` block,
  not a parallel gate. They must not re-implement the zero-connections / never-ingested empty
  states themselves.

### `#1987` endpoint — confirmed (pre-currency) contract
Committed on `1987-sales-channel-aggregates` branch, `GET /analytics/sales?from&to&sourceConnectionId`:

```ts
interface SalesAnalyticsHeadline {
  revenue: number; orderCount: number; averageOrderValue: number; medianOrderValue: number;
  unitsSold: number; cancelledCount: number; cancelledValue: number; trend: DailyTrendPoint[];
}
interface ChannelSalesAnalytics {
  sourceConnectionId: string; revenue: number; orderCount: number; averageOrderValue: number;
  unitsSold: number; cancelledCount: number; cancelledValue: number; revenueShare: number;
  trend: DailyTrendPoint[]; coverageComplete: boolean;
}
interface DailyTrendPoint { date: string; revenue: number; orderCount: number; }
```

**(expected, unconfirmed)** additions from the in-flight currency work (per the parallel
worktree's WIP `docs/architecture-overview.md`, itself not yet committed): a resolved reporting
currency exposed on the headline, a `stampedOrderCount` alongside `orderCount` (so `averageOrderValue`
divides by the stamped count, per ADR-040), and per-channel `revenueBasis: 'reporting' | 'native'
| 'unavailable'` (+ a `currency` field when `'native'`) plus `taxTreatment` /
`taxTreatmentMixed`. **Phase 0 confirms which of these actually landed** before Phase 2/3/4 code
is written against them.

---

## 5. Questions & Assumptions

### Open Questions
- Exact final field names/shape of the currency additions to `SalesAnalyticsResponseDto` — not
  committed anywhere as of this plan. **Must be re-confirmed against `main` at implementation
  start (Phase 0).**
- Whether `#1987`'s headline carries a top-level currency/reporting-currency string, or whether
  the FE must resolve it via a separate `currency-settings` read (the `#1986` branch already adds
  a `currency-settings` feature slice with `useCurrencySettingsQuery` — plan assumes the headline
  carries its own currency and this is only a fallback source of the *label* for "no stamped
  orders" copy, not the money value itself).
- Whether "Returns & refunds" stays a placeholder forever in v1 or whether a nearer-term entity
  is expected — treating it as out-of-repo-data for this issue, per the reference decision log.

### Assumptions (safe defaults if the above aren't resolved before work starts)
- If the currency fields are **not yet on `main`** when implementation begins: ship the KPI strip
  and channel table using `formatAmount(amount, headline.currency ?? undefined)` with a
  visible "currency unknown" fallback exactly where `formatAmount` already falls back to a bare
  number — i.e. degrade gracefully rather than blocking on the currency work, but the **mixed-
  currency / gross-net ACs cannot be marked done** until the real fields exist. Flag this
  explicitly in the PR description as a partial-AC ship, gated on #1987's currency slice landing.
- If `revenueBasis` exists: a channel with `revenueBasis === 'unavailable'` renders its revenue
  cell as `EmptyValue` with an inline reason (mirrors the Revenue KPI card's existing
  `GapMark`/`EmptyValue` pattern for "not computable" figures) and is **excluded** from the
  revenue-share percentage's implied 100% (its `revenueShare` is `null` per the documented
  contract, never divided against headline revenue).
- `taxTreatmentMixed` (if present) renders as a small `Chip tone="info"` inline with the channel
  name, reusing the existing `CoverageFlag`-adjacent slot in `ChannelName`, with copy explaining
  gross/net figures aren't compared 1:1 for that channel.

### Documentation Gaps
- `docs/specs/product-spec-1976-analytics.md` predates the currency/gross-net contract detail
  found in the in-flight `#1987` work; its acceptance criteria (S1/S2, quoted in § 2 above) are
  the authoritative source for *what* must be shown, not *how* the DTO expresses it.

---

## 6. Proposed Implementation Plan

### Phase 0: Re-verify dependency contracts (do this first, every time)
**Goal**: Replace every "(expected, unconfirmed)" field in § 4 with the actual merged shape.

1. **Confirm #1986 and #1987 status on `main`**
   - **Action**: `git log --oneline main | grep -E "#198[67]"`; if absent, locate the current
     branch/PR for each and diff its `apps/api/src/analytics/http/dto/sales-analytics-response.dto.ts`
     and `apps/web/src/pages/analytics/analytics-page.tsx` against this plan's § 4.
   - **Acceptance**: This plan's § 4 "confirmed" vs "expected" contract table is updated to match
     reality before any component code is written.
   - **Dependencies**: none.

2. **Reconcile the two competing `#1987` shapes**
   - **Action**: If both a pre-currency and a currency-aware `#1987` implementation are in play
     (as observed during planning), confirm with whoever owns #1987 which one is landing, since
     this issue cannot ship its currency-related ACs against the pre-currency shape.
   - **Acceptance**: One confirmed target DTO shape recorded in this plan before Phase 1 starts.

### Phase 1: API client, types, hook
**Goal**: A typed, tested data-fetch layer for `GET /analytics/sales`.

1. **`features/analytics/api/sales-analytics.types.ts`**
   - **File**: `apps/web/src/features/analytics/api/sales-analytics.types.ts`
   - **Action**: Mirror the confirmed (post-Phase-0) response DTO 1:1 — `DailyTrendPoint`,
     `SalesAnalyticsHeadline`, `ChannelSalesAnalytics`, `SalesAndChannelAnalytics`,
     `SalesAnalyticsFilters` (`from`, `to`, `sourceConnectionId?`).
   - **Acceptance**: Type-checks; every field the components in Phase 3/4 need exists here.
   - **Dependencies**: Phase 0.

2. **`features/analytics/api/sales-analytics.api.ts`**
   - **File**: `apps/web/src/features/analytics/api/sales-analytics.api.ts`
   - **Action**: `createAnalyticsApi(request)` returning `{ getSales }`. **Fix the exclusive-end
     bug found in § 4**: convert an inclusive `to` (`yyyy-mm-dd`) into the exclusive
     start-of-next-day ISO instant before building the query string. Extract this as a small
     named helper (`toExclusiveEndInstant(to: string): string`) so it is independently unit-tested.
   - **Acceptance**: A unit test asserts `to=2026-08-17` produces an exclusive boundary of
     `2026-08-18T00:00:00.000Z` (or local-equivalent, matching whatever `date-range.lib.ts` uses —
     confirm local-vs-UTC convention against that lib in Phase 0).
   - **Dependencies**: 1.1.

3. **Register the namespace on the API client**
   - **File**: `apps/web/src/app/api/api-client.ts`
   - **Action**: Add `analytics: { ...existing, getSales: createAnalyticsApi(request).getSales }`
     — or extend whatever shape `#1986` already established for `analytics.getTrust`, so both
     endpoints share one `analytics` namespace rather than two.
   - **Acceptance**: `useApiClient().analytics.getSales(filters)` type-checks.
   - **Dependencies**: 1.2, `#1986`'s `api-client.ts` changes present.

4. **Query keys + hook**
   - **Files**: `sales-analytics.query-keys.ts`, `hooks/use-sales-analytics-query.ts`
   - **Action**: `salesAnalyticsQueryKeys.sales(filters)`; `useSalesAnalyticsQuery(filters)` thin
     `useQuery` wrapper (mirrors reference branch exactly — no changes needed here beyond typing).
   - **Acceptance**: Two components calling the hook with identical `filters` share one network
     request (verified by a test asserting a single `fetch` call under React Query's cache).
   - **Dependencies**: 1.3.

### Phase 2: View-model helpers
**Goal**: Pure, unit-tested arithmetic separated from rendering.

1. **`features/analytics/lib/sales-analytics-view-model.ts`**
   - **Action**: Port `averageDailyOrders`, `rangeDays`, `unitsPerOrder`, `cancellationRate`,
     `revenueTrendValues`, `orderCountTrendValues`, `trendTone` from the reference branch verbatim
     (pure functions, contract-independent, no currency involvement — safe to reuse as-is). Add,
     if Phase 0 confirms `revenueBasis`: a `channelMoneyBasis(channel): 'reporting' | 'native' |
     'unavailable'` passthrough plus a `formatChannelRevenue(channel, headlineCurrency)` helper
     that centralizes the `EmptyValue`-vs-`formatAmount` branching so both the KPI strip (headline
     only) and the channel table don't duplicate the branch.
   - **Acceptance**: Unit tests cover every branch, including the exclusive-end date-range fix's
     interaction with `rangeDays`/`averageDailyOrders` (a range of exactly 1 day must not report 0
     days).
   - **Dependencies**: Phase 1 types.

### Phase 3: KPI strip
**Goal**: The 6-card `.status-strip`.

1. **`analytics-kpi-card.tsx`, `analytics-infotip.tsx`, `gap-mark.tsx`**
   - **Action**: Port from the reference branch largely as-is — these are presentational and
     contract-independent (infotip definitions, gap markers, card shell with sparkline slot).
   - **Acceptance**: Existing reference tests (`analytics-infotip.test.tsx`) pass unchanged.

2. **`analytics-kpi-strip.tsx`**
   - **Action**: Port the card composition (Revenue/Orders/Order value/Units/Cancellations/
     Returns) from the reference branch, but replace every `formatAmount(x, undefined)` call with
     `formatAmount(x, headlineCurrency)` where `headlineCurrency` comes from the confirmed Phase 0
     contract (or is `undefined` with a visible caveat, per § 5 assumptions, if the currency field
     isn't there yet). Keep the "real vs. not-yet-real" honesty pattern (Returns & refunds stays
     planned; Cancellations stays real; Revenue's headline stays a `GapMark`'d placeholder with
     GMV as the real qualifier) unless Phase 0 finds a refund/return field now exists — it does
     not, per the current domain model.
   - **Acceptance**: Renders correctly for loading/error/empty/success; every money value in the
     strip carries a currency label (AC: "Every figure carries its currency"); a mixed-currency
     range (if the confirmed contract signals this — e.g. `stampedOrderCount < orderCount`) shows
     an explicit caveat rather than a blended figure.
   - **Dependencies**: Phase 2, Phase 3.1.

### Phase 4: By-channel table
**Goal**: `DataTable` with revenue/share/orders/AOV/units/trend per channel.

1. **`channel-sales-table.tsx`**
   - **Action**: Port the reference branch's structure (columns, `ChannelIdentity` via
     `ConnectionCell`+`ConnectionDot`, `CoverageFlag` for partial history, `hideBelow` for narrow
     columns, card view for mobile). Update the money column to use the confirmed
     `revenueBasis`/currency contract via the Phase 2 `formatChannelRevenue` helper: a
     `'reporting'`-basis channel renders normally; `'native'` renders with its own currency and a
     `Chip tone="info"` noting it's not on the comparable basis (and its `revenueShare` cell
     renders `EmptyValue`, never a computed percentage against headline revenue); `'unavailable'`
     renders `EmptyValue` for both revenue and share.
   - **Acceptance**: AC "gross and net reporting channels... table says so rather than implying
     comparability" — verified by a test asserting a `taxTreatmentMixed` channel shows the
     comparability chip and a `revenueBasis !== 'reporting'` channel's share cell never renders a
     percentage.
   - **Dependencies**: Phase 2, Phase 1.

### Phase 5: Page wiring
**Goal**: Mount both sections into the `#1986` shell without disturbing its existing gates.

1. **`pages/analytics/analytics-page.tsx`**
   - **Action**: Inside the existing `trustQuery.data ? <>...</> : null` branch, after
     `AnalyticsTrustHeader` and the "every connection never-ingested" `EmptyState`, add: when at
     least one connection has ingested, render `<AnalyticsKpiStrip filters={{ from: toExclusive... }} />`
     and `<ChannelSalesTable filters={...} />`. Build the shared `SalesAnalyticsFilters` object
     once at the page level (applying the Phase 1 exclusive-end conversion) so both children
     receive byte-identical `filters` and share the query-cache dedup.
   - **Acceptance**: A channel-table fetch failure (mocked 500) leaves the KPI strip rendering
     normally, and vice versa (AC: "a channel-table failure does not blank the KPI strip").
   - **Dependencies**: Phase 3, Phase 4.

2. **Barrel export**
   - **File**: `apps/web/src/features/analytics/index.ts`
   - **Action**: Export `AnalyticsKpiStrip`, `ChannelSalesTable`, and any types the page needs, in
     the same barrel `#1986`/`#1989` already populate.

### Phase 6: Styling
**Goal**: Match the reference mockup's anatomy without introducing new primitives.

1. **`apps/web/src/index.css`**
   - **Action**: Port the reference branch's `.status-strip--analytics` and related rules; verify
     against the current mockup reference in `docs/plans/ui-overhaul-mockup.html` /
     `docs/specs/product-spec-1976-analytics.md` § 5 Design 1 ASCII layout. Confirm
     `font-variant-numeric: tabular-nums` is applied to every numeric cell (KPI values, table
     numeric columns) and mono is used for any id/timestamp (none expected on this section).
   - **Acceptance**: `pnpm lint` (design-token drift check) passes; responsive reflow at the
     documented breakpoints (1×N → 2×N → vertical for the strip; table → card view) with no
     horizontal page scroll.

### Phase 7: Tests
**Goal**: Match or exceed the reference branch's test coverage.

- `sales-analytics-view-model.test.ts` — port + extend for the exclusive-end fix and any new
  currency-basis helpers.
- `analytics-kpi-strip.test.tsx` — port + add currency-label and mixed-currency-caveat cases.
- `channel-sales-table.test.tsx` — port + add `revenueBasis`/`taxTreatmentMixed` cases.
- `analytics-infotip.test.tsx` — port unchanged.
- Extend `pages/analytics/analytics-page.test.tsx` (from `#1986`) with cases: KPI strip + table
  render once trust data loads and at least one connection has ingested; channel-table error
  doesn't blank the strip.

### Phase 8: Docs
- If the exclusive-end date bug (§ 4) is judged non-obvious enough to recur, add an entry to
  `docs/lessons.md` per the project's regression-ledger convention (only if this correction would
  plausibly repeat — a single inline code comment at the `toExclusiveEndInstant` helper may be
  sufficient instead).

---

## 7. Alternatives Considered

### Alternative 1: Cherry-pick / rebase the existing `1990-analytics-kpi-strip-channel-table` branch directly onto `main`
- **Description**: Take the already-committed, already-tech-reviewed branch and rebase it onto
  current `main` + the `#1986`/`#1987` branches, resolving conflicts mechanically.
- **Why Rejected**: Its merge-base predates the currency/FX-stamp work by a wide margin (diff
  shows large unrelated churn from unrelated merged features in `orders`/`invoicing` since); its
  page-shell integration point (`analytics-page.tsx`) is a different, now-superseded shape than
  the current `#1986` branch's; and its money rendering is currency-blind, which directly
  contradicts this issue's own acceptance criteria. A mechanical rebase would resolve to code that
  compiles but silently fails the currency ACs.
- **Trade-offs**: Rebasing would be faster to a compiling state, but slower overall once the
  currency-correctness gaps are found in review. Building fresh against current `main` (using the
  branch only as a structural reference, per this plan) front-loads that cost instead.

### Alternative 2: Ship without the currency ACs, deferring them to a follow-up issue
- **Description**: Implement against the pre-currency `#1987` shape (already committed), ship the
  page, and file a follow-up for currency-correctness once #1987's currency slice lands.
- **Why Rejected**: The issue's own acceptance criteria explicitly require currency-per-figure and
  gross/net comparability disclosure — shipping without them is an incomplete implementation of
  the stated issue, not a smaller version of it. Kept as a documented fallback (§ 5 Assumptions)
  only if the currency work is meaningfully delayed relative to this issue's schedule, with the
  gap called out explicitly in the PR rather than silently shipped.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Pure frontend feature slice; no backend/core changes. Follows `docs/frontend-architecture.md`
  folder conventions (`features/analytics/{api,hooks,lib,components}`, public barrel).

### Naming Conventions
- ✅ `kebab-case.tsx` files, `PascalCase` exports, `use-*.ts` hooks, `*.test.tsx`/`*.test.ts` tests
  — matches the reference branch and `docs/frontend-architecture.md`.

### Existing Patterns
- ✅ Reuses `DataTable`, `KpiCard`-family, `ConnectionCell`/`ConnectionDot`, `formatAmount`,
  `useNumberFormat` — no new `shared/ui` primitives, no charting library.

### Risks
- **R1 — Contract drift**: the actual merged `#1987` shape may differ from both versions found
  during planning. *Mitigation*: Phase 0 is a hard gate before any component code is written.
- **R2 — Dependency sequencing**: if `#1986`/`#1987` land with a different page-shell/DTO shape
  than analyzed here, Phase 5's wiring step needs re-deriving. *Mitigation*: Phases are ordered so
  Phase 1 (types) absorbs contract drift with minimal blast radius to Phases 3/4.
- **R3 — Off-by-one on the date range** (§ 4) — silently drops the last day's figures if not fixed.
  *Mitigation*: dedicated Phase 1.2 unit test.
- **R4 — Revenue-share arithmetic on a non-reporting-basis channel**: dividing a native/unavailable
  channel's revenue into headline revenue would silently overstate/understate share. *Mitigation*:
  Phase 4 explicitly renders `EmptyValue` for that cell rather than computing a number.

### Edge Cases
- Zero channels ingested anything in range → both sections render (KPI strip shows zeros, not
  blank; channel table shows an empty-state row) — the page-level "never-ingested" `EmptyState`
  from `#1986` only fires when *no* connection has ever ingested, which is a different condition.
- A single-day range (`from === to`) — `rangeDays` must return 1, not 0.
- All channels `revenueBasis: 'unavailable'` — headline revenue may still be non-zero if it
  aggregates independently of the per-channel basis breakdown; confirm this reconciliation in
  Phase 0 rather than assuming headline = Σ channels.

### Backward Compatibility
- ✅ No breaking changes — new page section, new feature files, one shared barrel/API-client
  extension already anticipated by `#1986`.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `sales-analytics-view-model.test.ts` — all pure helpers, including the exclusive-end conversion
  and any currency-basis helpers.
- **Files**: `apps/web/src/features/analytics/lib/sales-analytics-view-model.test.ts`

### Component Tests
- `analytics-kpi-strip.test.tsx`, `channel-sales-table.test.tsx`, `analytics-infotip.test.tsx` —
  loading/error/success rendering, currency labeling, mixed-currency and gross/net-incomparability
  disclosure, coverage-flag rendering, independent-failure isolation between the two sections.
- **Files**: `apps/web/src/features/analytics/components/*.test.tsx`

### Page Test
- Extend `apps/web/src/pages/analytics/analytics-page.test.tsx` with the two new sections mounted,
  and the independent-failure case.

### Mocking Strategy
- Mock `useApiClient()`'s `analytics.getSales` (MSW or manual mock, matching the existing
  `#1986`/`#1989` test setup in `apps/web/src/test/test-utils.tsx`). No real network/Docker
  needed — this is unit-test-only work (`pnpm test`, no `pnpm test:integration`).

### Acceptance Criteria (from the issue, restated as verifiable checks)
- [ ] KPI strip shows revenue, orders, AOV with median, and units for the selected range
- [ ] By-channel table lists every connected channel with its figures and share
- [ ] Every figure carries its currency; a mixed-currency range never renders one blended number
- [ ] Gross/net incomparability is stated explicitly where it applies, never implied as comparable
- [ ] A channel with less history than the range is visibly marked (coverage flag)
- [ ] Cancelled value is visible (not silently excluded from view)
- [ ] All numerics use `tabular-nums`
- [ ] Independent loading/error states per section; channel-table failure never blanks the KPI strip
- [ ] Responsive: strip reflows, table becomes card view, no horizontal page scroll
- [ ] Tests added and passing (`pnpm test`)
- [ ] `pnpm lint` and `pnpm type-check` clean

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A — pure FE, no backend layers touched)
- [x] Respects CORE vs Integration boundaries (untouched)
- [x] Uses existing patterns (no unnecessary abstractions) — reuses `DataTable`, `KpiCard`
      family, `ConnectionCell`/`ConnectionDot`, `formatAmount`
- [x] Idempotency considered (N/A — read-only GET)
- [ ] Event-driven patterns used where applicable (N/A — no events involved)
- [x] Rate limits & retries addressed (TanStack Query default retry policy per
      `docs/frontend-architecture.md` § Async UX Conventions — retries disabled by default)
- [x] Error handling comprehensive — independent per-section error states specified
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready **once Phase 0 resolves the open contract questions**
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Testing Guide](../testing-guide.md)
- [Product Spec #1976 — `/analytics`](../specs/product-spec-1976-analytics.md)
