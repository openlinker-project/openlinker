# Implementation Plan: `/analytics` "Needs attention" section

**Date**: 2026-08-14
**Status**: Draft
**Estimated Effort**: 2–3 days
**Issue**: [#1989](https://github.com/openlinker-project/openlinker/issues/1989)

---

## 1. Task Summary

**Objective**: Render the `/analytics` page's "needs attention" section — three actionable categories (coverage gaps, stock at risk, value stuck in failed syncs), each linking into the existing OL flow that resolves it. Per the spec, this is "the strongest argument this page belongs inside OpenLinker rather than in a BI tool: every row ends in an action OL can perform."

**Context**: Backend (#1983) is already merged (`GET /analytics/needs-attention`). This issue is purely the frontend consumer, mounting into the `/analytics` shell #1986 shipped (draft PR #2115). Independent of the entire order-money substrate — per the epic's shipping order (`docs/specs/product-spec-1976-analytics.md` § 6), this section is designed to go live before any revenue figure exists.

**Classification**: Frontend (Interface layer only — no backend changes; `GET /analytics/needs-attention` is consumed as-is).

---

## 2. Scope & Non-Goals

### In Scope
- `AnalyticsNeedsAttention` component mounted into `AnalyticsPage` directly under the trust header, per the mockup's build order ("Data coverage first... Needs attention directly under it")
- Three category rows (coverage gaps, stock at risk, failed-sync value), each rendering **only when open** — a resolved category renders nothing
- All-clear state: one line naming the count and the categories checked, when nothing is open
- Deep links from each open row into: the unified publish flow (coverage), the product detail page (stock at risk), the orders list filtered to `needs_attention` health (failed syncs)
- Loading / error states scoped to this section only (a failure here must not blank the trust header above it)
- Responsive: no horizontal page scroll, ≥44px tap targets
- Unit tests

### Out of Scope
- Performing the actions inline (e.g. bulk-publish from this page) — v1 links out to existing flows only (explicit issue non-goal)
- Sales-weighted ranking of coverage gaps — needs queryable order line items (explicit issue non-goal, tracked toward #1990's substrate)
- Dismissing / snoozing items (explicit issue non-goal)
- Backend changes of any kind — `GET /analytics/needs-attention` (#1983) ships as-is
- A precise multi-currency figure for the failed-sync-value row beyond the interim handling in Decision 2 below — the real fix is a consequence of #2049 (order-time FX rate snapshot + reporting-currency stamping, ADR-040, merged design), not this issue

### Constraints
- Must mount into the `/analytics` shell from #1986 — branches from `1986-analytics-page-shell` (currently draft PR #2115), not `main`, since the shell it renders into doesn't exist on `main` yet
- No backend changes: `NeedsAttentionResponseDto` (`apps/api/src/analytics/http/dto/needs-attention-response.dto.ts`) is the given contract
- Follows the design mockup's exact either/or rule and copy conventions (`docs/plans/mockups/analytics-ledger-2003.html`, frame 02 — verified against the live source, not a paraphrase)

---

## 3. Architecture Mapping

**Target Layer**: Frontend Interface layer (`apps/web/src/features/analytics/`, `apps/web/src/pages/analytics/analytics-page.tsx`).

**Capabilities Involved**: None on the backend side — pure FE consumer of an already-shipped read (`NeedsAttentionResponseDto`).

**Existing Services Reused**:
- `GET /analytics/needs-attention` (`NeedsAttentionController`) — no changes
- `features/analytics/` module scaffolding from #1986 (API-client wiring pattern, `useApiClient()`, barrel conventions) — this issue adds a sibling API module inside the same feature, not a new feature
- `shared/ui`: `StatusBadge`, `LoadingState`, `ErrorState`, `Button` — all already in the catalog
- `EntityLabel` (`shared/ui`) — candidate for rendering connection names in row sub-text; confirm during implementation whether the raw `connectionId`s in the DTO need resolving to display names via `useConnectionsQuery` (see Decision 1)

**New Components Required**:
- `features/analytics/api/needs-attention.api.ts` / `.types.ts` / `.query-keys.ts` — new API module inside the existing `features/analytics` feature (sibling to `analytics-trust.*`)
- `features/analytics/hooks/use-needs-attention-query.ts`
- `features/analytics/components/analytics-needs-attention.tsx` (+ test)
- `features/analytics/lib/needs-attention-copy.lib.ts` (+ test) — pure row-copy derivation, isolated per Decision 1/2/3 below
- One `apps/web/src/app/api/api-client.ts` edit (add `getNeedsAttention` to the existing `analyticsTrust` namespace, or a new `needsAttention` namespace — see Assumption 2)
- New `.attention-list*` CSS classes in `index.css` (don't exist yet — verified)

**Core vs Integration Justification**: N/A — no CORE or Integration change. Frontend-only, same as #1986.

---

## 4. External / Domain Research

### Backend contract already shipped (`apps/api/src/analytics/http/dto/needs-attention-response.dto.ts`)

```ts
GET /analytics/needs-attention →
{
  coverageGaps: { variantId, productId, listedOnConnectionIds: string[], missingFromConnectionIds: string[] }[];
  coverageGapsTotalCount: number;   // true total, independent of the array's page-size cap
  stockAtRisk: { variantId, productId, connectionId, masterStock, stockSafetyBuffer }[];
  stockAtRiskTotalCount: number;    // true total, independent of the array's page-size cap
  failedSyncValue: { count: number; totalValue: number; mixedCurrency: boolean; oldestFailedAt: string | null };
}
```

Verified via `apps/api/src/analytics/http/needs-attention.controller.ts` and its DTO — this is the actual shipped shape on `main`, not the issue's own prose description.

### Design mockup — verified against the live source file (not paraphrased)

`docs/plans/mockups/analytics-ledger-2003.html`, frame 02 (`id="frame-attention"`), functions `attentionItem`/`attentionClear`/`renderAttention` (lines ~3611–3648 of the source):

- **Either/or rule**: `renderAttention(el, open, all)` renders `open.map(attentionItem)` when `open.length > 0`, else `attentionClear(all)`. A resolved category is never rendered as its own row — it simply doesn't appear.
- **Row shape**: badge (`Stuck` for the error-tone row, `Action` for others) + one-line body (`headline` + `· {sub}`) + a `button--secondary button--sm` link.
- **All-clear shape**: one row, `badge('neutral', 'Clear')` + "Nothing needs attention" + `· {n} checks · {category labels joined}`.
- **Action links are dummy anchors in the mockup** (`href="#frame-attention"`) — the real destination routes are not specified anywhere in the mockup or the issue. Resolved by this plan (Decision 4) from the app's existing routes.
- **Stock-buffer formula** (documented in the mockup's build card): `publishedStock = max(0, masterStock − stockSafetyBuffer)`, never negative — the row states the buffer it subtracted so the operator can check the arithmetic. Buffer is **per connection** (`Connection.config.stockSafetyBuffer`, #1844), not global — a variant can be at-risk on one channel and fine on another.

### Reusable Components
- `StatusBadge` (`shared/ui`) — `tone`, `withDot` for the category badges
- `LoadingState`, `ErrorState`, `Button` (`shared/ui`)
- `useApiClient()`, `createMockApiClient()` (`app/api`, `test/test-utils.tsx`) — same DI/test seam as #1986

---

## 5. Questions & Assumptions

### Open Questions
1. Should `AnalyticsNeedsAttention` be a separate query (`GET /analytics/needs-attention`) from the trust snapshot, or could the backend eventually combine them into one call? **Assumption**: keep separate — the mockup's own frame 09 states "Every state is per section. Each of the five owns its own query, so a top-products timeout leaves the KPI strip and the channel table standing." One query per section is the established pattern.
2. Does the needs-attention section respect the page's date-range toolbar at all? **Assumption: no.** `GET /analytics/needs-attention` takes no query parameters and the issue explicitly says this section is "independent of the entire order-money substrate" — coverage gaps and stock-at-risk are point-in-time facts, not range-scoped. The failed-sync-value aggregate is also unscoped by date in the current DTO. This mirrors Decision 5 in the #1986 plan (the trust header is also range-independent).

### Assumptions (safe defaults — proceed without blocking)
1. **API-client placement**: add `getNeedsAttention` to the existing `analyticsTrust` namespace (`apps/web/src/app/api/api-client.ts`) rather than a new top-level namespace — it's the same `/analytics` resource family and avoids growing `CoreApiClient` for a single extra method. Rename consideration (`analyticsTrust` → `analytics`) is explicitly **not** done here to avoid unrelated churn to #1986's already-drafted PR; revisit only if a third `/analytics` sub-resource arrives.
2. **Connection-name resolution**: `listedOnConnectionIds`/`missingFromConnectionIds`/`connectionId` are raw ids. Resolving them to display names for row sub-text uses the existing `useConnectionsQuery()` (`features/connections`) client-side join — the same pattern `EntityLabel` uses elsewhere. No backend change needed since `GET /connections` already exists and is already fetched elsewhere in the app (React Query dedupes the request).
3. **`oldestFailedAt` formatting**: reuse `TimeDisplay`/`formatDateTime` from `shared/format/format-date.ts`, consistent with #1986's post-review fix (never hand-roll `toLocaleString()`).

### Documentation Gaps
- Neither the issue nor the mockup specifies the real link targets for the three action buttons. Resolved below (Decision 4) from the app's actual routes, verified by reading `app/routes/*.route.tsx` and the pages they render — not guessed.

### Decisions (recorded so this doesn't have to be re-derived)

**Decision 1 — coverage-gap and stock-at-risk row copy does not name a specific connection when the underlying items are ambiguous.** The mockup's demo copy ("12 variants... on Allegro — main but not in Sklep główny") assumes exactly one source→destination pair; the real DTO returns `listedOnConnectionIds[]`/`missingFromConnectionIds[]` per variant, which can differ across items when ≥3 connections exist, and `stockAtRisk[].stockSafetyBuffer` is genuinely per-connection and can vary. **Rule**: if every item in a category shares the same single missing/target connection (coverage) or the same connection+buffer (stock), name it explicitly, matching the mockup's copy. Otherwise, fall back to a connection-agnostic headline ("12 variants have a listing gap on at least one channel" / "4 variants are at or below their channel's safety buffer") and let the per-item detail (reached via the link) carry the specifics. This is a pure function (`deriveCoverageHeadline` / `deriveStockHeadline` in `needs-attention-copy.lib.ts`), independently unit-tested for both the single-connection and mixed-connection cases.

**Decision 2 — `deriveFailedSyncHeadline` never renders `totalValue`; the row always reads as a count.** Originally drafted (see the superseded text below) to render `"{money(totalValue)} of orders never reached a destination"` for the non-mixed case and a currency-neutral count-only sentence only when `mixedCurrency`. Shipped that way initially, then corrected post-ship: `totalValue` was rendered via `formatCurrencyNeutral` — a plain `toLocaleString` with no currency symbol — which reads exactly like a real, currency-denominated figure ("6,120.64 of orders never reached a destination") to an operator, when it is in fact a currency-naive sum with no currency field on the DTO at all. That is the *same* silent-wrong-number risk the mixed-currency branch was built to avoid, just less obviously so because the non-mixed case never puts two currencies side by side. **Both branches now render the same shape**: `"{count} orders never reached a destination"`, with `sub` either `"open the list to see which orders and destinations"` or, when `mixedCurrency`, `"affected orders span multiple currencies"`. `totalValue` stays on the wire (`FailedSyncValueSummaryDto`/`getFailedSyncValueSummary` are unchanged — a currency-normalized sum, once #2049 lands, may still be worth surfacing) but `deriveFailedSyncHeadline` no longer reads it. `#2049`'s eventual reporting-currency stamping is therefore not a prerequisite for this row anymore — the row already made the honest choice #2049 would have enabled ahead of time.

<details>
<summary>Superseded original text (kept for history)</summary>

`mixedCurrency` renders as a currency-neutral figure, not a bare amount, and this is a known, tracked interim. When `failedSyncValue.mixedCurrency === true`, showing `totalValue` under a single currency symbol would misrepresent a currency-naive sum as a real figure — the same silent-wrong-number risk the epic's spec calls out for gross/net mixing. Ship: when `mixedCurrency`, render `"{count} orders across multiple currencies never reached a destination"` (no summed amount); when not mixed, render `"{money(totalValue, currency)} of orders never reached a destination"` (currency comes from... see note below). This is intentionally a stopgap. #2049 (Order-time FX rate snapshot + reporting-currency stamping, ADR-040, design merged) will very likely let a future backend change make `getFailedSyncValueSummary` sum `order_records.reportingTotalAmount` (already normalized to one system reporting currency) instead of raw per-currency amounts — at which point `mixedCurrency` becomes obsolete and this row simplifies to always showing one amount. That follow-up is not this issue's job; #2049 is tracked independently, and the FE change when it lands is a small, isolated edit to this one row (delete a branch), not a rewrite — confirmed by re-reading #2049's scope, which touches only `order_records` + the FX registry, nothing in the `analytics` context. Open sub-question left for implementation: `FailedSyncValueSummaryDto` doesn't include a `currency` field for the non-mixed case — check `NeedsAttentionService`/`FailedSyncValueSummary` (`libs/core/src/orders`) at implementation time for whether a currency string is available; if not, add `(unspecified currency)` rather than guessing PLN.

</details>

**Decision 3 — headline counts use `*TotalCount`, never `array.length`.** `coverageGapsTotalCount`/`stockAtRiskTotalCount` are the true totals before the page-size cap; the arrays themselves may be capped smaller. Every headline count in this section reads from the `*TotalCount` fields. The rendered *rows* (if a future iteration adds a "show N more" expansion) would read from the arrays — out of scope for v1, which shows the count only, no per-item list (matching the mockup's one-line-per-category shape).

**Decision 4 — real link targets, resolved from the app's actual routes (the mockup's own links are dummy anchors):**

| Row | Target | Params |
|---|---|---|
| Coverage gap | `/listings/bulk-create/wizard` (unified publish flow, `docs/frontend-architecture.md § Unified publish flow`) | `?productIds={productId}&variantIds={variantId}&connectionId={missingFromConnectionIds[0]}` when Decision 1's single-connection case applies; omit `connectionId` (let the wizard's destination picker resolve it) when ambiguous |
| Stock at risk | `/products/{productId}` (`app/routes/products.route.tsx` `:id` child) | none — product detail page is where inventory/stock context lives (per `ProductThumbnail`/stock-detail conventions in `shared/ui` catalog) |
| Failed syncs | `/orders` (`app/routes/orders.route.tsx`) | `?health=needs_attention` — verified against `features/orders/lib/order-health.ts`: `needs_attention` is literally defined as *"not awaiting_mapping/source_deleted AND any destination failed"*, labeled "Sync failed" in `ORDER_HEALTH_META` — an exact semantic match for "orders that never reached a destination" |

Only the coverage-gap link is conditionally parameterized (per Decision 1); the other two are always fully resolvable since `productId` and the `needs_attention` bucket are unconditional.

---

## 6. Proposed Implementation Plan

### Phase 1: API module

**Goal**: Typed, tested data-fetching layer for the needs-attention read, added to the existing `features/analytics` feature.

**Steps**:

1. **`features/analytics/api/needs-attention.types.ts`**
   - Hand-written types mirroring `NeedsAttentionResponseDto` verbatim (camelCase preserved): `CoverageGapItem`, `StockAtRiskItem`, `FailedSyncValueSummary`, `NeedsAttentionSummary`.
   - Acceptance: compiles, no `any`.

2. **`features/analytics/api/needs-attention.api.ts`**
   - `createNeedsAttentionApi(request)` → `{ getSummary: () => Promise<NeedsAttentionSummary> }`, calling `request('/analytics/needs-attention')`. Mirrors `analytics-trust.api.ts`'s shape exactly (Phase 1 of the #1986 plan).
   - Acceptance: unit test stub resolves the mocked shape.

3. **`features/analytics/api/needs-attention.query-keys.ts`**
   - `needsAttentionQueryKeys = { all: ['needs-attention'] as const, summary: () => ['needs-attention', 'summary'] as const }`.

4. **`features/analytics/hooks/use-needs-attention-query.ts`**
   - `useNeedsAttentionQuery()` — same shape as `useAnalyticsTrustQuery` (Phase 1 Step 4 of the #1986 plan).
   - Acceptance: loading/success/error test via `createMockApiClient`.

5. **Wire the API-client**
   - File: `apps/web/src/app/api/api-client.ts`
   - Add `getNeedsAttention: () => Promise<NeedsAttentionSummary>` to the existing `analyticsTrust` namespace's interface + composition (Assumption 1) — a two-line addition next to the existing `getTrust`.
   - Update `createMockApiClient`'s default `analyticsTrust` mock in `apps/web/src/test/test-utils.tsx` to include a default `getNeedsAttention` resolving to an all-clear summary (`{ coverageGaps: [], coverageGapsTotalCount: 0, stockAtRisk: [], stockAtRiskTotalCount: 0, failedSyncValue: { count: 0, totalValue: 0, mixedCurrency: false, oldestFailedAt: null } }`) — required so every *other* existing test using `createMockApiClient()` without overrides keeps type-checking (same necessity documented in the #1986 plan for `analyticsTrust` itself).
   - Acceptance: `pnpm type-check` passes; every pre-existing test file still compiles.

### Phase 2: Copy derivation (pure, isolated)

**Goal**: Encapsulate the ambiguous-copy and mixed-currency decisions (§5 Decisions 1–3) in small, independently testable pure functions — the same discipline #1986 used for `shouldShowDegradationBanner` / `computePresetRange`.

**Steps**:

1. **`features/analytics/lib/needs-attention-copy.lib.ts`**
   - `deriveCoverageHeadline(items: CoverageGapItem[], totalCount: number, connectionName: (id: string) => string): { headline: string; sub: string; connectionId: string | null }` — implements Decision 1's single-connection vs. ambiguous branching. **`connectionId` is the single source of truth for the deep link** (#2120 re-review, IMPORTANT) — the component reads this field rather than re-deriving its own 'single missing connection' predicate, because an independently-computed, weaker predicate previously pinned a `connectionId` into the wizard link for a case the headline copy right next to it explicitly declined to name.
   - `deriveStockHeadline(items: StockAtRiskItem[], totalCount: number, connectionName: (id: string) => string): { headline: string; sub: string }` — same shape for stock-at-risk, including the buffer-arithmetic sub-text ("master stock at or below the connection's safety buffer · buffer {n}") when a single buffer value applies.
   - `deriveFailedSyncHeadline(summary: FailedSyncValueSummary): { headline: string; sub: string }` — implements Decision 2's `mixedCurrency` branch.
   - Acceptance: unit tests cover — single-connection coverage gap, multi-connection (ambiguous) coverage gap, single-buffer stock row, mixed-buffer stock row, `mixedCurrency: true`, `mixedCurrency: false`, zero-count (should not be called — see Phase 3, but defensively returns a safe default).

### Phase 3: Component

**Goal**: Render the either/or section per the mockup's exact rule.

**Steps**:

1. **`features/analytics/components/analytics-needs-attention.tsx`**
   - Reads `NeedsAttentionSummary`, resolves connection names via `useConnectionsQuery()` (Assumption 2), and builds up to 3 candidate rows using Phase 2's derivation functions — a category is a candidate only when its count is `> 0` (`coverageGapsTotalCount > 0`, `stockAtRiskTotalCount > 0`, `failedSyncValue.count > 0`).
   - If the candidate list is non-empty: render one `.attention-list__item` per candidate (badge tone `error` + "Stuck" label for the failed-sync row, `warning` + "Action" for the other two — matching the mockup's tone split), each with its `<Link>` from Decision 4.
   - If the candidate list is empty: render the single all-clear row — "Nothing needs attention · 3 checks · coverage, stock, destination syncs".
   - Panel chrome (`panel panel--dense`, `panel__header` with `section-title` "Needs attention" + a `text-muted mono-text` "checked HH:MM" using the client's own receipt time, not a backend field — no such field exists in the DTO) matches `AnalyticsTrustHeader`'s panel shape from #1986 for visual consistency.
   - Acceptance: component tests — renders 0/1/2/3 open rows correctly, renders the all-clear line when count is 0 for all three, correct badge tone per row, correct link `href` per Decision 4's table (including the ambiguous-coverage no-`connectionId` case).

2. **CSS — `apps/web/src/index.css`**
   - Add `.attention-list`, `.attention-list__item`, `.attention-list__item--resolved`, `.attention-list__body`, `.attention-list__headline`, `.attention-list__sub` — transcribed verbatim from the mockup's real stylesheet (confirmed absent from `index.css` today), consuming only existing tokens (no new custom properties, so no `tokens.ts` edit needed).
   - Acceptance: visual check against the published mockup excerpt (artifact `analytics-needs-attention-mockup.html`).

### Phase 4: Page wiring

**Goal**: Mount into `AnalyticsPage` per the build order.

**Steps**:

1. **`apps/web/src/pages/analytics/analytics-page.tsx`**
   - Add `useNeedsAttentionQuery()` alongside the existing `useAnalyticsTrustQuery()`.
   - Render `AnalyticsNeedsAttention` directly under the "Data coverage" panel, inside the same success branch (i.e., it doesn't render at all in the empty-instance / still-arriving states, matching the mockup's frame 00 vertical order — needs-attention is a populated-instance concern).
   - Its own `isLoading`/`error` states render `LoadingState`/`ErrorState` scoped to just this panel — never blank the trust header above it (per the mockup's per-section-independence rule, reused from #1986's Phase 4).
   - Acceptance: manual smoke test covers — populated instance with 0/1/2/3 open categories, a needs-attention fetch failure while the trust header still renders successfully.

2. **`features/analytics/index.ts`** (barrel)
   - Add `useNeedsAttentionQuery`, `AnalyticsNeedsAttention` to the existing barrel's exports.

### Implementation Details

**New Components**:
- **Application (FE feature)**: `needsAttentionQueryKeys`, `createNeedsAttentionApi`, `useNeedsAttentionQuery`, `deriveCoverageHeadline`, `deriveStockHeadline`, `deriveFailedSyncHeadline`
- **Interface (FE components)**: `AnalyticsNeedsAttention`

**Configuration Changes**: None.

**Database Migrations**: None.

**Events**: None — pure read.

**Error Handling**: Scoped `ErrorState` per section (mirrors #1986's established pattern), independent of the trust-header query.

---

## 7. Alternatives Considered

### Alternative 1: Combine trust + needs-attention into a single query
- **Description**: One `GET /analytics/overview`-style endpoint returning both.
- **Why Rejected**: Backend already shipped them as two separate endpoints (#1982, #1983) for two separate reasons (data-trust reads no order data; needs-attention reads listings/inventory/orders). Combining now would be a backend contract change with no stated benefit, and it would violate the mockup's own stated principle that a slow section must not stall a fast one.
- **Trade-offs**: Two round-trips instead of one — negligible for a page loaded once per navigation, not polled.

### Alternative 2: Show the raw per-item list (not just a count) for each category
- **Description**: Render every coverage-gap/stock-at-risk item as its own row, like a mini-table.
- **Why Rejected**: The mockup is explicit — "Rows carry a headline and a qualifier, not two facts, so each collapses to one line," and the issue's own out-of-scope list defers a richer ranked view. A count + one deep link is the v1 shape; the link's destination is where the per-item detail lives.
- **Trade-offs**: An operator with, say, 47 coverage gaps sees "47 variants..." and must click through to see which ones — acceptable for v1, matches the design intent.

### Alternative 3: Guess a single currency (PLN) for `mixedCurrency: true` rather than a currency-neutral headline
- **Description**: Always show a number, defaulting ambiguous sums to PLN.
- **Why Rejected**: This is exactly the "quietly wrong number" failure mode the epic's spec calls out as the single most dangerous class of bug on this page (§4, note [G] and the discussion of gross/net mixing). A silently-mislabeled sum is worse than an honest count-only sentence.
- **Trade-offs**: The mixed-currency sentence is less immediately actionable ("how much money, exactly?") — accepted, and explicitly temporary pending #2049 (Decision 2).

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Frontend-only; respects `app → pages → features → shared`; no raw API calls outside `features/analytics/api/`
- ✅ No new global store — server state via TanStack Query, nothing else needed
- **Reference**: `docs/frontend-architecture.md`

### Naming Conventions
- ✅ `kebab-case.tsx`/`.ts` files, `use-*.ts` hooks, `*.types.ts`, `*.query-keys.ts`, `*.lib.ts` — matches #1986's established `features/analytics` layout exactly

### Existing Patterns
- ✅ API/hook/query-keys triad mirrors `analytics-trust.*` from #1986 verbatim
- ✅ Loading/error/empty handling mirrors the canonical pattern already used by `AnalyticsPage`

### Risks
- **Ambiguous-connection copy (Decision 1) is a judgment call, not something the mockup or issue specifies.** *Mitigation*: isolated in a pure, independently unit-tested function so the exact wording can be revisited without touching the component or its tests' structure.
- **`mixedCurrency` handling (Decision 2) is an interim.** *Mitigation*: explicitly documented as such, with the exact future change (#2049) named, so nobody re-derives this from scratch later or is surprised when it needs to change.
- **Link targets (Decision 4) were inferred from existing routes, not specified anywhere.** *Mitigation*: each target was verified by reading the actual route file and the semantic meaning of its filter (e.g. `needs_attention`'s own `ORDER_HEALTH_META` definition), not guessed from the label text alone.
- **No backend field for "checked at" timestamp.** *Mitigation*: uses client-side receipt time (query's own `dataUpdatedAt` or a local `Date.now()` at render), which is honest — it genuinely reflects when the FE last received the summary.

### Edge Cases
- **All three categories clear**: single all-clear row (Decision covered in Phase 3 Step 1).
- **Exactly one category open, two clear**: only the open one renders — the clear ones produce nothing (per the mockup's explicit rule, "a resolved category renders nothing").
- **`coverageGaps` array empty but `coverageGapsTotalCount > 0`** (shouldn't happen given the backend's own invariant, but defensively): treat as open using the total count for the headline number; the derivation functions accept an empty array without throwing.
- **Needs-attention fetch fails while trust-header fetch succeeds**: only this panel shows `ErrorState`; the rest of the page is unaffected.

### Backward Compatibility
- ✅ No breaking changes — purely additive to `features/analytics` and one small `api-client.ts`/`test-utils.tsx` edit.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `features/analytics/lib/needs-attention-copy.lib.test.ts` — all branches of Decisions 1–3
- `features/analytics/hooks/use-needs-attention-query.test.tsx` — loading/success/error
- `features/analytics/components/analytics-needs-attention.test.tsx` — 0/1/2/3-open-category rendering, all-clear line, correct link hrefs, correct badge tones
- `pages/analytics/analytics-page.test.tsx` — extend with a needs-attention-scoped error case (trust header still renders)

### Integration Tests
- None required — no backend surface changes.

### Mocking Strategy
- `createMockApiClient({ analyticsTrust: { getNeedsAttention: vi.fn()... } })`, `connections: { list: vi.fn()... } }` for name resolution.

### Acceptance Criteria (from the GitHub issue, mapped to this plan)
- [ ] Each category renders with its count and, where meaningful, its value — Phase 3. **The failed-sync-value row renders count only** (Decision 2, revised): a currency-neutral `totalValue` is not "meaningful" here, it is misleading — it reads as a real amount with no way for an operator to know what it's denominated in.
- [ ] Every item links into the corresponding existing OL flow, pre-scoped where the target supports it — Phase 3/4, Decision 4
- [ ] A category with nothing to report renders as resolved, not as an error or empty box — Phase 3 (either/or rule)
- [ ] House style: structured-list idiom, status hues only for status meaning, `tabular-nums` — Phase 3 CSS
- [ ] Loading/error per section, with retry, independent of other sections — Phase 4
- [ ] Responsive, no horizontal page scroll — verified manually
- [ ] Tests added — § 9 above
- [ ] No new ESLint warnings or type errors — `pnpm lint && pnpm type-check`

**Reference**: `docs/testing-guide.md`

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A layers untouched; FE layering respected)
- [x] Respects CORE vs Integration boundaries (no backend change)
- [x] Uses existing patterns (mirrors #1986's `features/analytics` module shape exactly; no new abstractions)
- [x] Idempotency considered (N/A — pure GET)
- [x] Event-driven patterns used where applicable (N/A)
- [x] Rate limits & retries addressed (TanStack Query defaults, same as #1986)
- [x] Error handling comprehensive (scoped `ErrorState`, independent of sibling sections)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Frontend Architecture](../frontend-architecture.md) § Unified publish flow
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- Issue [#1989](https://github.com/openlinker-project/openlinker/issues/1989)
- Backend PR #2045 (issue #1983) — `GET /analytics/needs-attention`
- Design PR #2018 (issue #2003) — `docs/plans/mockups/analytics-ledger-2003.html`, frame 02
- Mockup excerpt artifact — `analytics-needs-attention-mockup.html` (published for #1989 review)
- #1986 implementation plan (`docs/plans/implementation-plan-analytics-page-shell.md`) — the shell this section mounts into, and the structural precedent this plan follows
- Issue #2049 / ADR-040 (merged design, implementation not started) — the eventual fix for Decision 2's `mixedCurrency` interim
