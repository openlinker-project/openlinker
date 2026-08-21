# Implementation Plan: `/analytics` route shell — page scaffold, date-range control, trust header

**Date**: 2026-08-14 (revised same day — pre-implementation cross-check against PR #2037/#2018)
**Status**: Draft — intentionally provisional on two points (Decision 3 and Decision 4). Both are pinned to a **known, filed backend gap** rather than solved in this plan; re-open this document once #1985 merges and #2083 is picked up.
**Estimated Effort**: 3–5 days
**Issue**: [#1986](https://github.com/openlinker-project/openlinker/issues/1986)
**Tracked follow-up**: [#2083](https://github.com/openlinker-project/openlinker/issues/2083) — Backend, real per-connection earliest-order-date read. Blocked by #1985. Not a blocker for this plan; it's the issue that lets Decision 3 below stop being a workaround.

---

## 1. Task Summary

**Objective**: Ship the container every other `/analytics` section will mount into: a new authenticated `/analytics` route with the standard app shell, a date-range control that drives shareable URL state, and a trust/data-coverage header that discloses ingestion freshness and stalled-channel warnings before any money figure is shown.

**Context**: `/analytics` is the first business-metrics surface OpenLinker ships (epic #1976). Every other section on the page (needs-attention #1989, KPI strip + by-channel #1990, top products #1991) mounts inside this shell and depends on its date-range URL contract. This issue deliberately ships **zero metrics** — no revenue, no KPI cards, no charts beyond the existing `Sparkline` primitive (unused here) — only the shell, the filter, and the trust disclosure.

**Classification**: Frontend (Interface layer only — no CORE/backend changes; the one backend read this issue depends on, `GET /analytics/trust`, already shipped in #1982/PR #2037).

---

## 2. Scope & Non-Goals

### In Scope
- New route `/analytics`, registered in the root route tree and sidebar nav
- `PageLayout` with eyebrow "Operations" / title "Analytics" / description
- Date-range control: presets (7d / 30d / 90d / Custom) + two native `<input type="date">` fields + a draft-buffered `Apply` action, backed by `from`/`to` URL search params
- Trust header: per-connection freshness / coverage / ingestion-state rows sourced from `GET /analytics/trust`, plus a page-level degradation banner per the rule in § 6
- Fresh-instance empty state (no `OrderSource` connections, or all connections `never-ingested`)
- Loading / error states for the trust-header panel using `LoadingState` / `ErrorState`
- Responsive layout (mobile/tablet), ≥44px tap targets, primary content within 120px of viewport top
- Unit tests for the new feature module and page

### Out of Scope
- Any revenue/order metric, KPI card, chart, or the "needs attention" panel (#1989, #1990, #1991 — separate issues that mount into this shell later)
- A reusable `DateRangePicker` extraction into `shared/ui/` — build the control feature-local first; extract only if it lands cleanly without expanding this issue (per the issue's own note)
- Order-date (`placedAt`) filtering — the backend does not yet expose it (#1985, in progress as PR #2014). The toolbar ships a visible **"Order date †"** disclaimer chip instead (see § 5, Decision 2)
- A `MIN(placedAt)`-based "data from" coverage fact per connection — not backed by any endpoint today (see § 5, Decision 3). The trust header ships with the coverage facts `GET /analytics/trust` actually has today

### Constraints
- Must not duplicate or diverge from the interaction contract specified in the (currently open, not-yet-merged) design PR **#2018** for issue #2003 (`docs/plans/mockups/analytics-ledger-2003.html`, frame `01` and `01b`, explicitly tagged `feeds #1986`). That PR is expected to land close to as-is; this plan follows it verbatim rather than re-deriving the interaction rules.
- No backend changes. `GET /analytics/trust` (`apps/api/src/analytics-trust/http/analytics-trust.controller.ts`) is consumed as-is.
- Must not block on #1985 (order analytics read model, PR #2014, still `REVIEW_REQUIRED`/`CONFLICTING`) — this issue is explicitly scoped to avoid it.

---

## 3. Architecture Mapping

**Target Layer**: Frontend Interface layer (`apps/web/src/pages/`, `apps/web/src/app/routes/`, `apps/web/src/app/nav-registry.ts`) + a new Frontend feature module (`apps/web/src/features/analytics/`).

**Capabilities Involved**: None on the backend side — this is a pure FE consumer of an already-shipped read (`AnalyticsTrustSnapshot` / `IAnalyticsTrustService`, `@openlinker/core/analytics-trust`).

**Existing Services Reused**:
- `GET /analytics/trust` (`AnalyticsTrustController`) — no changes
- `PageLayout`, `SegmentedControl`, `KeyValueList`, `StatusBadge`, `Chip`, `Alert`, `Popover`/`PopoverTrigger`/`PopoverContent`, `LoadingState`, `ErrorState`, `EmptyState`, `Button` — all from `shared/ui`
- `useApiClient()` DI hook, TanStack Query conventions (`features/cursors` is the structural reference for a small read-only feature module)
- URL search-param pattern from `apps/web/src/pages/orders/orders-list-page.tsx` (day-boundary widening, `setFilterParam`) — reused for the *mechanics* (day-boundary widening to UTC instants), **not** for its live-per-keystroke-apply behavior (see § 5, Decision 1)

**New Components Required**:
- `features/analytics/` — new feature module (api, types, query-keys, hook, components)
- `pages/analytics/analytics-page.tsx` — new page
- `app/routes/analytics.route.tsx` — new route module
- One nav-registry edit (`app/nav-registry.ts`)
- One `apps/web/src/app/api/api-client.ts` edit (new `analyticsTrust` namespace)

**Core vs Integration Justification**: N/A — no CORE or Integration change. This plan touches only `apps/web` (Interface layer per `docs/frontend-architecture.md`).

---

## 4. External / Domain Research

### Internal Patterns

**Backend contract already shipped** (`libs/core/src/analytics-trust/domain/types/connection-ingestion-trust.types.ts`, `apps/api/src/analytics-trust/dto/analytics-trust-response.dto.ts`):

```ts
interface AnalyticsTrustSnapshot {
  generatedAt: Date;             // ISO string over the wire
  worstStatus: ConnectionIngestionStatus; // 'never-ingested' | 'fresh' | 'stalled' | 'disconnected' | 'unknown'
  connections: ConnectionIngestionTrust[];
}

interface ConnectionIngestionTrust {
  connectionId: string;
  connectionName: string;
  platformType: string;
  connectionStatus: ConnectionStatus;       // 'active' | 'disabled' | 'error' | 'needs_reauth'
  status: ConnectionIngestionStatus;
  lastPollAt: Date | null;                  // pipe liveness
  lastOrderIngestedAt: Date | null;         // data recency — NOT thresholded
  connectionCreatedAt: Date;                // operator-configured-at, NOT a coverage-window claim
  earliestOrderDate: Date | null;           // real coverage window, MIN(COALESCE(placedAt, createdAt)); shipped by #2083/PR #2121, on this plan's base
  expectedIntervalMs: number | null;
  staleAfterMs: number | null;
}
```

Route: `GET /analytics/trust` → `AnalyticsTrustResponseDto` (same shape, dates as ISO strings). Guarded by the global `JwtAuthGuard`, no extra role.

**Gap closed on this plan's base branch**: `connectionCreatedAt` was deliberately renamed from `coverageStartAt` because "the field never supported a 'coverage window' claim," and at the time this section was first drafted there was no `MIN(placedAt)`-per-connection field anywhere in the backend. #2083/PR #2121 has since shipped `earliestOrderDate` on `1985-order-analytics-read-model` (this plan's base), so the design mockup's "Data coverage" row (`data from {date}`) *can* be built from data that exists today — see Decision 3 (resolved) below.

**Design mockup** (`docs/plans/mockups/analytics-ledger-2003.html`, from the open PR #2018 for issue #2003), frames `01` and `01b`, are the literal behavior spec this plan follows. Key points transcribed:
- URL carries `from`/`to` only (`YYYY-MM-DD`), never a `range` param — the lit preset is *derived* from the dates, not stored.
- Clicking a preset (7d/30d/90d) applies **immediately** (no Apply step) and writes absolute dates: `from = today − (N−1)`, `to = today`.
- Clicking "Custom" lights `Custom`, keeps the dates, focuses the `From` field — it does not change data.
- Editing `From`/`To` lights `Custom` and enables `Apply`. Fields are always editable, even while a preset is lit.
- `Apply` is a **local draft buffer only** — it never reaches the URL until committed, and a reload discards any pending edit. It is disabled unless the draft is complete, valid (`From ≤ To`), and different from the range currently in force.
- On commit: write `from`/`to` to the URL, refresh all sections, then **re-derive** which preset is lit (a typed range that happens to equal a preset lights that preset, not `Custom`).
- Day boundaries: URL carries calendar dates; widen to `T00:00:00.000Z` / `T23:59:59.999Z` UTC instants only when building the query (mirrors `orders-list-page.tsx:268-273`).
- Trust header: 3 facts per connection (freshness, coverage, state), never aggregated into fewer rows; channel names from `connection.name`; a standing caveat lives on the section's `ⓘ` info button (Popover on **click**, not the Tooltip primitive — Radix `Tooltip` ignores `pointerType === 'touch'`, making it unreachable on a phone); per-row notes stay inline, one line.
- Banner rule (frame `11`): a page-level `Alert` fires **only** when a channel that has ingested at least one order within the selected date range (`lastOrderIngestedAt` falls inside `[from, to]`) is currently `stalled` or `disconnected`. A stalled/disconnected channel with **no** orders in range gets a row-level marker only, never a banner. Two currencies, mixed tax basis, and a channel merely having less history than the range are explicitly **not** degradations.
- Fresh-instance empty state (frame `10`): two distinct sentences — "no `OrderSource` connection exists at all" (CTA: add a connection) vs. "a connection exists but every one of its statuses is `never-ingested`" (CTA: view sync progress). Never render a screen of dashes.
- Loading vs. recalculating are different states (`isLoading` vs `isFetching && !isLoading`); the trust-header panel gets its own error boundary independent of the rest of the page (a pattern later sections will repeat, not exercised by real failure here since the trust panel is the only section in this issue).

### Reusable Components (all pre-existing, no new shared primitive needed)
- `PageLayout`, `SegmentedControl`, `Chip`, `KeyValueList`, `StatusBadge`, `Alert`, `Popover`/`PopoverTrigger`/`PopoverContent`, `Button`, `LoadingState`, `ErrorState`, `EmptyState`, `TimeDisplay` — all already in `shared/ui/index.ts`.
- **Divergence from this list, as shipped**: `Chip tone="info"` (the standard chip API) is not used for the "Order date †" disclaimer, which instead uses a bare `title`-attribute markup with a `Popover` for the caveat body (see the toolbar Tooltip/Popover note below) — a good in-file rationale exists (the interactive `Chip` renders `aria-pressed`, which is wrong for a chip that isn't a toggle) but it never made it back into this plan until now. **`PageLayout` was adopted** in the #2098 tech-review pass — `analytics-page.tsx` previously hand-rolled the `page-section`/`page-header` markup instead of the shared primitive; that gap is closed.

---

## 5. Questions & Assumptions

### Open Questions
1. Will design PR #2018 (issue #2003) merge before or during this work? It is `REVIEW_REQUIRED` as of 2026-08-13.
2. Will the sidebar nav item live in the existing "Operations" group (matching the page's `eyebrow`) or a new "Analytics" group? The mockup's `page-header` eyebrow says "Operations" but doesn't show the nav tree.

### Assumptions (safe defaults — proceed without blocking)
1. **This plan is written and code will be implemented against the mockup HTML as currently committed on branch `2003-analytics-kpi-strip-mockup` / PR #2018.** If review changes the interaction contract before merge, the affected pieces (toolbar component, trust-header markup) are isolated enough to patch without touching the route/page scaffold.
2. **Nav placement**: add `{ to: '/analytics', label: 'Analytics' }` to the existing `Operations` nav group in `nav-registry.ts`, positioned after `Dashboard` — matches the page's own `Operations` eyebrow and avoids inventing a new nav group for a single-page section.
3. **API client namespace name**: `analyticsTrust` (feature-scoped name, mirrors `mcpTokens`/`posthogSettings` precedent of naming the namespace after the feature, not the raw route segment).

### Documentation Gaps
- `docs/frontend-architecture.md` has no precedent for a **draft-then-apply** URL-filter pattern (every existing example, incl. `orders-list-page.tsx`, applies each filter change immediately to the URL). This plan introduces the pattern for `/analytics` only, justified in Decision 1 below; it is not proposed as a new house-wide convention.

### Decisions (recorded so future `/analytics` issues don't re-derive them)

**Decision 1 — draft-buffered date apply, not live-apply.** Unlike `orders-list-page.tsx` (every filter edit hits the URL immediately), the date toolbar keeps typed-but-uncommitted `From`/`To` edits in local component state until `Apply` is clicked. *Why:* the mockup explicitly requires it (a half-typed date range must never re-query mid-edit — editing `From` and `To` are two separate keystrokes-worth of edits), and every other `/analytics` section refetches on range change, so re-querying per keystroke would be wasteful and visually thrashy across five sections at once. Presets remain live-apply (no draft step) since a preset click is a single complete action.

**Decision 2 — "Order date" filters by ingestion time today, with a visible caveat.** The backend has no `placedAt` column yet (#1985, not merged). `from`/`to` are sent to `GET /analytics/trust` filtering is N/A for this issue (the trust endpoint takes no date params — see Decision 4), but the URL contract and the toolbar's own semantics are that of "order date," per the mockup. Ship the toolbar now with the mockup's **"Order date †"** disclaimer chip (tooltip: "placedAt is not a column and cannot be filtered today"). When #1985 lands, remove the chip — no URL contract change.

**Decision 3 — trust header ships without a "data from" coverage-window row.** The mockup's coverage fact is `MIN(placedAt)` per connection, which doesn't exist in the current `GET /analytics/trust` response (`connectionCreatedAt` is explicitly documented as *not* a coverage claim — see the doc comment on the field in `connection-ingestion-trust.types.ts`). Ship the trust-header row set as **freshness + connection-configured-since + state** (using `connectionCreatedAt` labeled **"connected since"**, never "data from" or any wording that implies data history — the mockup's own copy rule ("coverage reads 'data from', never 'complete since'") is exactly the over-claim this labeling avoids repeating). **Tracked, not deferred silently**: [#2083](https://github.com/openlinker-project/openlinker/issues/2083) is filed and is the real fix (`MIN(COALESCE(placedAt, createdAt))` per connection), blocked by #1985. When #2083 ships, this is a one-line label + prop swap in `analytics-trust-header.tsx`, not a rewrite.
**Resolved (#2083 / PR #2121):** shipped and on this plan's base (`1985-order-analytics-read-model`). `ConnectionIngestionTrustResponseDto` / `ConnectionIngestionTrust` now carry a real `earliestOrderDate: string | null`. `analytics-trust-header.tsx` renders it as **"Data from"** (falling back to "No orders yet" when null), exactly the one-line swap anticipated above. `connectionCreatedAt` stays on the type and in test fixtures — it's still a real DTO field, just no longer the coverage-row value.

**Decision 3a — no "backfilling" state exists, and this plan does not invent one.** The same root cause as Decision 3 has a second symptom: `ConnectionIngestionStatusValues` (`never-ingested | fresh | stalled | disconnected | unknown`) cannot distinguish "just connected, still loading its first orders" from "connected long ago, currently ingesting nothing because there's genuinely no new order" — both read as whatever the last poll/sync job says, and a connection with zero orders so far is `never-ingested` regardless of *why* it has zero orders. This plan's "still arriving" empty-state variant (Phase 4 Step 2, mockup frame 10 variant 2) triggers on `status === 'never-ingested'` as an **approximation**, not a true backfilling signal — it will occasionally show "First orders are still arriving" for a connection that is simply quiet (e.g. a seasonal shop with no orders yet, not because it's new). This is accepted as a soft, non-misleading approximation (worst case: an accurate-but-oddly-worded empty state, never a false "everything's fine") and is not blocking; a real `'backfilling'` status value would also need #2083's coverage-window fact to derive correctly, so it is not proposed here as separate scope.

**Decision 4 — banner rule ships as `status`-only (`stalled` or `disconnected`), not range-gated, for v1.** The mockup's frame 11 rule gates the page-level banner on a *stricter* condition — only a channel that has ingested **at least one order within the selected date range** — specifically so a disabled/seasonal connection that happens to be `stalled` doesn't train operators to ignore banners. A pre-implementation cross-check flagged that this plan's earlier draft approximated "sales in range" via `lastOrderIngestedAt` falling inside `[from, to]` — a single timestamp, not a real per-range aggregate, and itself an approximation of the same kind flagged in Decision 3a. **Revised for this version**: ship v1 on the simpler, always-correct-in-the-safe-direction rule — `selectDegradedConnections` fires for every connection whose `status` is `'stalled'` or `'disconnected'`, independent of the date range. This can over-warn (a genuinely-disabled test connection surfaces a banner) but never under-warns (a channel that matters is never silently hidden behind a range check built on a proxy signal). The mockup's exact range-gated version is **explicitly deferred**, to be picked up once #1990 (by-channel data, which will make "did this channel sell in this range" an honest, non-approximated fact) exists — filed as a follow-up at that point, not invented here. `hasSalesInRange` is **dropped from this plan's Phase 2 Step 1** (was speculative scaffolding for the deferred version); `selectDegradedConnections` takes only `entries: ConnectionIngestionTrust[]`, no date range.

**Decision 5 — the date-range toolbar does not yet re-fetch the trust header.** `GET /analytics/trust` takes no query parameters and reports connection-wide facts, not range-scoped ones. The date range is stored in the URL purely for every other `/analytics` section to consume once they exist (per Decision 4, it no longer drives any client-side check in this issue either). This matches the mockup: frame `01` shows the same trust-header rows regardless of which date-range frame is shown.

---

## 6. Proposed Implementation Plan

### Phase 1: Feature module — API + types + query hook

**Goal**: A typed, tested data-fetching layer for the trust snapshot.

**Steps**:

1. **`features/analytics/api/analytics-trust.types.ts`**
   - File: `apps/web/src/features/analytics/api/analytics-trust.types.ts`
   - Action: Hand-written types mirroring `AnalyticsTrustResponseDto` (camelCase preserved per `docs/frontend-architecture.md § API Client Conventions`): `ConnectionIngestionStatus`, `ConnectionIngestionTrust` (with `lastPollAt`/`lastOrderIngestedAt`/`connectionCreatedAt`/`earliestOrderDate` typed `string | null` / `string`, ISO wire format — `earliestOrderDate` shipped with #2083/PR #2121, on this plan's base branch, and backs the trust-header's "Data from" row per Decision 3 (resolved) below), `AnalyticsTrustSnapshot`.
   - Acceptance: types compile; no `any`.
   - Dependencies: none.

2. **`features/analytics/api/analytics-trust.api.ts`**
   - File: `apps/web/src/features/analytics/api/analytics-trust.api.ts`
   - Action: `createAnalyticsTrustApi(request)` returning `{ getTrust: () => Promise<AnalyticsTrustSnapshot> }`, calling `request<AnalyticsTrustSnapshot>('/analytics/trust')`. Mirrors `features/cursors/api/cursors.api.ts` shape exactly (no filters/pagination needed here).
   - Acceptance: unit test stub call resolves the mocked response shape.
   - Dependencies: Step 1.

3. **`features/analytics/api/analytics-trust.query-keys.ts`**
   - File: `apps/web/src/features/analytics/api/analytics-trust.query-keys.ts`
   - Action: `export const analyticsTrustQueryKeys = { all: ['analytics-trust'] as const, snapshot: () => ['analytics-trust', 'snapshot'] as const }`.
   - Acceptance: compiles; consumed by the hook below.
   - Dependencies: none.

4. **`features/analytics/hooks/use-analytics-trust-query.ts`**
   - File: `apps/web/src/features/analytics/hooks/use-analytics-trust-query.ts`
   - Action: `useAnalyticsTrustQuery()` using `useApiClient()` + TanStack `useQuery({ queryKey: analyticsTrustQueryKeys.snapshot(), queryFn: () => apiClient.analyticsTrust.getTrust() })`. Returns the full `UseQueryResult` per house convention.
   - Acceptance: `use-analytics-trust-query.test.tsx` covers loading/success/error via `createMockApiClient`.
   - Dependencies: Steps 2–3, and the API-client wiring in Phase 4 Step 1 (can be developed against a local mock in the meantime).

5. **Wire the API-client namespace**
   - File: `apps/web/src/app/api/api-client.ts`
   - Action: import `createAnalyticsTrustApi`/`AnalyticsTrustApi`, add `analyticsTrust: createAnalyticsTrustApi(request)` to the `CoreApiClient` composition (alongside `cursors`, `orders`, etc., alphabetically ordered per the existing import block).
   - Acceptance: `pnpm type-check` passes; `apiClient.analyticsTrust.getTrust()` is callable.
   - Dependencies: Step 2.

### Phase 2: Trust header + banner components

**Goal**: Render the per-connection freshness/coverage/state rows and the page-level degradation banner.

**Steps**:

1. **Pure helpers — `features/analytics/lib/ingestion-trust.lib.ts`**
   - File: `apps/web/src/features/analytics/lib/ingestion-trust.lib.ts`
   - Action: One pure, unit-testable function — no date-range parameter (per Decision 4, the range-gated version is deferred):
     - `selectDegradedConnections(entries: ConnectionIngestionTrust[]): ConnectionIngestionTrust[]` — filters entries where `status` is `'stalled' | 'disconnected'`. Returns the list (usually 0 or 1) so the banner can name every offender; caller renders one `Alert` per entry, or none. **Renamed from `shouldShowDegradationBanner`** (#2098 tech review): a `should*` name on a function returning a non-empty array reads as a boolean at every call site, and `if (shouldShowDegradationBanner(entries))` is truthy even for `[]`.
   - Acceptance: unit tests cover: no connections stalled/disconnected → `[]`; one `stalled` connection → included; one `disconnected` connection → included; a `fresh`/`never-ingested`/`unknown` connection → excluded.
   - Dependencies: Phase 1 Step 1 (types).

2. **`features/analytics/components/analytics-degradation-banner.tsx`**
   - File: `apps/web/src/features/analytics/components/analytics-degradation-banner.tsx`
   - Action: Renders zero or more `Alert tone="error"` blocks, one per entry returned by `selectDegradedConnections`, with copy `"{connectionName} has not ingested since {lastPollAt formatted}"` + description "This is an ingestion gap, not a drop in sales." + a `Button tone="secondary"` sized `sm` labelled "View sync" linking to `/cursors?connectionId={id}` (existing cursors page — closest existing "sync detail" destination; no new page needed). Renders `null` when the input list is empty.
   - Acceptance: component test — renders one alert per stalled/disconnected connection, renders nothing otherwise, link href is correct.
   - Dependencies: Step 1.

3. **`features/analytics/components/analytics-trust-header.tsx`**
   - File: `apps/web/src/features/analytics/components/analytics-trust-header.tsx`
   - Action: Renders one row per connection: `StatusBadge` (tone mapped from `ConnectionIngestionStatus`: `fresh→success`, `stalled→warning`, `disconnected→error`, `never-ingested→neutral`, `unknown→neutral`), `connectionName` (never `platformType`), a freshness fact ("Current to {time}" from `lastPollAt`, or "Never polled"), and a **"Data from {date}"** fact from `earliestOrderDate` (falling back to "No orders yet" when null) — per Decision 3 (resolved): #2083/PR #2121 shipped the real per-connection coverage window on this plan's base branch, so the row renders the actual "data from" claim rather than the `connectionCreatedAt`-labeled placeholder originally planned here. A section-level info button (`Popover`/`PopoverTrigger` rendering the `ⓘ` glyph as a real `<button aria-label="About these dates">`, `PopoverContent` holding the standing caveat text from the mockup) sits in the panel header next to the `section-title`, per the mockup's rule that a permanent caveat is a popover, not an always-visible banner line.
   - Acceptance: component test — one row per connection entry, correct tone per status, popover opens on click (not hover-only), no row aggregation (asserts row count == connections.length even for 5+ connections).
   - Dependencies: Phase 1 Step 1.

### Phase 3: Date-range toolbar

**Goal**: The 7d/30d/90d/Custom + From/To + Apply control, with the draft-buffer semantics from Decision 1.

**Steps**:

1. **`features/analytics/lib/date-range.lib.ts`**
   - File: `apps/web/src/features/analytics/lib/date-range.lib.ts`
   - Action: Pure helpers, unit-tested in isolation from any component:
     - `PRESET_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const`
     - `computePresetRange(preset: '7d'|'30d'|'90d', today: Date): { from: string; to: string }` — inclusive count: `from = today − (N−1) days`, `to = today`, both formatted `YYYY-MM-DD`.
     - `derivePreset(from: string, to: string, today: Date): '7d'|'30d'|'90d'|'custom'` — returns the matching preset if `from`/`to` exactly equal `computePresetRange` for that preset, else `'custom'`.
     - `toUtcRangeInstants(from: string, to: string): { from: string; to: string }` — `from → T00:00:00.000Z`, `to → the NEXT day's T00:00:00.000Z` (exclusive bound, not `T23:59:59.999Z` as originally sketched here). **Corrected in the #2098 tech-review pass**: `SalesAnalyticsQueryDto.to` (#1987) is documented and implemented as EXCLUSIVE (`placedAt < :to` in SQL), so a `23:59:59.999Z` bound would be off by 1ms rather than aligned with the contract it's converting for — the next-midnight exclusive bound is exact, not an approximation. This toolbar itself still operates on the OPERATOR'S LOCAL calendar day (see the module header for why local-day-in / UTC-instant-out is the deliberate choice, not a bug); `toUtcRangeInstants` is the one conversion point every future `/analytics/*` consumer must route through.
   - Acceptance: unit tests — preset math for a fixed `today`, boundary/leap-year case, `derivePreset` round-trips a preset-computed range back to that preset, an arbitrary custom range returns `'custom'`, `toUtcRangeInstants` pins the exclusive `to` bound across a month/year boundary.
   - Dependencies: none.

2. **`features/analytics/components/analytics-date-range-toolbar.tsx`**
   - File: `apps/web/src/features/analytics/components/analytics-date-range-toolbar.tsx`
   - Action: Controlled component. Props: `{ from: string; to: string; onApply: (from: string, to: string) => void }` (parent owns URL state, this component owns only the draft). Internal state: `draftFrom`/`draftTo` initialized from props, reset via `useEffect` when `from`/`to` props change (i.e., after a URL-driven navigation/reload). Renders:
     - `SegmentedControl` with 4 options (7d/30d/90d/Custom). Clicking a day-count preset computes the range via `computePresetRange` and calls `onApply` **immediately** (no draft). Clicking "Custom" only updates a local "which button is highlighted while editing" state — it does not call `onApply`.
     - Two `<label>`-wrapped `<input type="date" className="control">` for `draftFrom`/`draftTo`, updating draft state on change.
     - An `Apply` `Button` — `disabled` unless `draftFrom && draftTo && draftFrom <= draftTo && (draftFrom !== from || draftTo !== to)`. On click, calls `onApply(draftFrom, draftTo)`.
     - The highlighted segment is **derived** on every render via `derivePreset(draftFrom, draftTo, today)` while the Apply button is enabled with unsaved edits is NOT re-derived on keystroke per the mockup's rule ("Custom holds its selection from the click until Apply") — implemented as: highlight is derived from the **committed** `from`/`to` props at rest, and separately forced to `'custom'` the instant any draft field is edited away from the committed values, never recomputed back to a preset until the next `Apply` commits.
     - The `Chip tone="info"` "Order date †" disclaimer per Decision 2, with a `title` attribute carrying the exact mockup tooltip text.
   - Acceptance: component tests — clicking 7d calls `onApply` with the correct dates and no separate Apply click needed; editing a date field enables Apply and does not call `onApply` until clicked; Apply is disabled when fields are incomplete or unchanged; clicking Custom does not call `onApply`; a reload (props changing external to a click) resets the draft.
   - Dependencies: Step 1.

### Phase 4: Page + route + nav wiring

**Goal**: Compose everything behind `/analytics`.

**Steps**:

1. **`features/analytics/index.ts`** (public barrel)
   - File: `apps/web/src/features/analytics/index.ts`
   - Action: Re-export `useAnalyticsTrustQuery`, `AnalyticsTrustHeader`, `AnalyticsDegradationBanner`, `AnalyticsDateRangeToolbar`, and the date-range lib functions actually needed by the page. Keep narrow — this feature has exactly one consumer (the page) today.
   - Acceptance: `pnpm lint` passes the feature-barrel / deep-import ESLint rules.
   - Dependencies: Phases 1–3.

2. **`pages/analytics/analytics-page.tsx`**
   - File: `apps/web/src/pages/analytics/analytics-page.tsx`
   - Action:
     - Read `from`/`to` from `useSearchParams()`; default to the 30d preset's computed range when absent (so a first-ever visit shows *something* concrete in the URL after mount, matching the mockup's "resting state: 30d is lit").
     - `onApply(from, to)` writes both params via `setSearchParams`, mirroring `setFilterParam` from `orders-list-page.tsx` but setting both keys atomically in one `setSearchParams` call (never two calls, to avoid an intermediate history entry with a half-updated range).
     - Call `useAnalyticsTrustQuery()`.
     - Render order: `PageLayout` (eyebrow "Operations", title "Analytics", description "Sales across connected channels, with clear data coverage.") → `AnalyticsDateRangeToolbar` → `AnalyticsDegradationBanner` (computed from the query data alone, per Decision 4 — no `from`/`to` input) → the "Data coverage" `panel` wrapping `AnalyticsTrustHeader`.
     - State handling per `docs/frontend-architecture.md § Async UX Conventions` / the mockup's frame 09/10:
       - `isLoading` → `LoadingState` in place of the trust-header panel only (toolbar still renders — the range control doesn't depend on the trust fetch).
       - `error` → `ErrorState` with retry (`refetch`), scoped to the trust panel.
       - Empty instance: `connections.length === 0` → full-page `EmptyState` ("Connect a sales channel to see figures here", CTA to `/connections/new`), replacing the whole page body below the header per mockup frame 10.
       - All-`never-ingested` (connections exist but `worstStatus === 'never-ingested'` and every entry's `status === 'never-ingested'`): render the trust header AND an `EmptyState`-style card underneath ("First orders are still arriving") rather than replacing the page, per mockup frame 10's second variant.
   - Acceptance: manual smoke test in the running dev server covers: fresh instance, populated instance, a stalled connection (banner shows, per Decision 4's status-only rule), a "still arriving" (`never-ingested`) instance.
   - Dependencies: Step 1.

3. **`app/routes/analytics.route.tsx`**
   - File: `apps/web/src/app/routes/analytics.route.tsx`
   - Action: Mirrors `dashboard.route.tsx` — lazy-loaded, `handle: { crumb: { group: 'Operations', title: 'Analytics' } } satisfies RouteCrumbHandle`, `path: 'analytics'`.
   - Acceptance: `route-lazy.test.ts`'s `EXPECTED_LAZY_ROUTE_COUNT` bumped by 1; `route-handle.test.ts` passes for the new leaf route.
   - Dependencies: Step 2.

4. **Register the route**
   - File: `apps/web/src/app/routes/root.route.tsx`
   - Action: import `analyticsRoute`, add to `coreChildren` (position after `dashboardRoute`, before `ordersRoute` — matches its conceptual place as a second "Operations" landing page).
   - Acceptance: `/analytics` resolves in the running app; existing route tests still pass.
   - Dependencies: Step 3.

5. **Nav registry**
   - File: `apps/web/src/app/nav-registry.ts`
   - Action: add `{ to: '/analytics', label: 'Analytics' }` to the `Operations` group's `items`, after `{ to: '/', label: 'Dashboard', end: true }` (per Assumption 2).
   - Acceptance: `nav-registry.test.ts` updated/passes; the item appears in the sidebar.
   - Dependencies: none (independent of the route itself, but meaningless without it).

### Implementation Details

**New Components**:
- **Application (FE feature)**: `analyticsTrustQueryKeys`, `createAnalyticsTrustApi`, `useAnalyticsTrustQuery`, `selectDegradedConnections`, `computePresetRange`, `derivePreset`, `toUtcRangeInstants` (`hasSalesInRange` dropped per Decision 4 — the range-gated banner it was scaffolding for is deferred, not shipped in this plan)
- **Interface (FE components/pages)**: `AnalyticsTrustHeader`, `AnalyticsDegradationBanner`, `AnalyticsDateRangeToolbar`, `AnalyticsPage`, `analyticsRoute`

**Configuration Changes**: None.

**Database Migrations**: None.

**Events**: None emitted or consumed — pure read.

**Error Handling**: Network/API errors surface via TanStack Query's `error` on `useAnalyticsTrustQuery`, rendered via the shared `ErrorState` with a `refetch()`-bound retry button, scoped to the trust panel only (per the mockup's "a section can fail without taking the page with it" rule — trivially satisfied here since there's only one section, but the pattern must be right for #1989/#1990/#1991 to copy).

---

## 7. Alternatives Considered

### Alternative 1: Live-apply date filter (mirror `orders-list-page.tsx` exactly)
- **Description**: Every keystroke in `From`/`To` immediately updates the URL and refetches, no `Apply` button.
- **Why Rejected**: The design mockup (frame `01b`) explicitly specifies a draft-buffered `Apply` step and gives the reasoning (a half-typed date must never fire a query; five sections would refetch simultaneously on every keystroke once this shell has consumers). Deviating from an explicit, reasoned design decision without discussing it with the user first is worse than a one-off inconsistency with `orders-list-page.tsx`.
- **Trade-offs**: Slightly more component state to manage; introduces the repo's first draft-then-commit URL pattern. Documented in § 5 Decision 1 so it isn't silently copied or silently "fixed" back to live-apply later.

### Alternative 2: Extract `DateRangePicker` into `shared/ui/` now
- **Description**: Build the presets+dates+Apply control as a generic, reusable `shared/ui/date-range-picker.tsx` per the issue's own suggestion.
- **Why Rejected**: The issue explicitly frames this as a judgement call and says "do not let it expand this issue." The control's current second use case (`orders-list-page.tsx`) uses a *different* interaction model (live-apply, no preset-derivation-at-commit), so a shared abstraction would need a mode flag on day one — premature generalization for a single real consumer. Ship it feature-local in `features/analytics/components/`; extract later if a second `/analytics` section or a future orders-page redesign needs the identical draft-buffered behavior.
- **Trade-offs**: A future extraction is a pure move + prop-generalization, not a rewrite, since the component is already self-contained and controlled via props.

### Alternative 3: Wait for PR #2018 (design) and #2014 (#1985 backend) to merge before starting
- **Description**: Block this plan until the design PR is merged and the order-analytics read model lands.
- **Why Rejected**: #1986 has no formal backend dependency beyond #1982 (already merged). The design PR is expected to land close to as-is per the user's own read of its review state. Blocking wastes the time between now and either PR merging. The plan instead documents exactly which two pieces (the "Order date †" chip, the trust-header coverage row) are placeholders pending #1985, isolated to single, easily-revisited spots (Decisions 2 and 3).
- **Trade-offs**: Small risk of rework on the toolbar/trust-header markup if #2018's review changes the interaction contract before merge — accepted, since the affected surface is narrow and covered by unit tests that would catch a silent regression.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Frontend-only change; respects `app → pages → features → shared` (page imports the feature barrel; feature does not import pages or app internals beyond the sanctioned `useApiClient()` DI seam)
- ✅ No new global store — date range lives in URL search params, trust snapshot lives in TanStack Query, toolbar draft lives in local component state (textbook application of `docs/frontend-architecture.md § State Management`)
- **Reference**: `docs/frontend-architecture.md`

### Naming Conventions
- ✅ `kebab-case.tsx` files, `PascalCase` exports, `use-*.ts` hooks, `*.route.tsx`, `*.types.ts`, `*.query-keys.ts`, `*.lib.ts` (matches the "Optional: pure helpers" `lib/` convention in `docs/frontend-architecture.md § Feature Module Structure`)
- **Reference**: `docs/engineering-standards.md § Naming Conventions`, `docs/frontend-architecture.md`

### Existing Patterns
- ✅ API module / query-keys / hook triad mirrors `features/cursors` exactly
- ✅ Loading/error/empty state handling mirrors the canonical pattern in `docs/frontend-ui-style-guide.md` / `fe-pages.md`
- ✅ Route/nav wiring mirrors `dashboard.route.tsx` + `nav-registry.ts` verbatim

### Risks
- **Design-contract drift**: PR #2018 is unmerged; its interaction rules could still change in review. *Mitigation*: isolate every mockup-derived rule (preset math, draft-buffer, banner threshold) in small pure functions with their own unit tests (Phase 2 Step 1, Phase 3 Step 1) so a contract change is a localized diff, not a rewrite.
- **Coverage-row semantic risk — resolved**: #2083 shipped (PR #2121) before this plan closed, so the "Connected since" → "Data from" swap anticipated in Decision 3 was done in this same PR rather than left as a follow-up.
- **Banner over-warns relative to the mockup**: shipping the status-only rule (Decision 4) means a genuinely-disabled or seasonal `stalled` connection surfaces a banner the mockup's range-gated version would have suppressed. *Mitigation*: accepted trade-off — over-warning is the safe direction (never hides a real problem), documented explicitly in Decision 4 as deferred rather than silently simplified, and revisited once #1990 makes an honest "sold in this range" fact available.
- **"Still arriving" empty state can mislabel a quiet-but-healthy connection**: Decision 3a — `status === 'never-ingested'` cannot distinguish "brand new, backfilling" from "old but genuinely has zero orders." *Mitigation*: accepted as a soft, non-misleading approximation (wrong wording, never a wrong "everything's fine" signal); would need #2083's coverage-window fact to fix properly, not proposed as separate scope here.
- **The mockup's "64% of units" banner copy needs per-channel unit-share data this issue doesn't have** (blocked on #1985+#1990) — moot for v1 now that Decision 4 ships the plain status-only banner without any percentage clause; revisit only if/when the range-gated version is picked up.

### Edge Cases
- **Zero `OrderSource` connections**: full-page empty state (mockup frame 10, variant 1).
- **Connections exist, none has ever ingested**: trust header renders + a "still arriving" card underneath (mockup frame 10, variant 2).
- **`From > To` typed into the draft**: Apply stays disabled; never reaches the URL.
- **One date field cleared**: Apply stays disabled (an incomplete range can't commit) — matches the mockup's explicit rule, and differs from `orders-list-page.tsx`'s "clearing a field removes the URL param" behavior, which only applies post-commit here, not to the draft.
- **Reload / shared link with an arbitrary (non-preset) `from`/`to`**: `Custom` lights correctly, no preset falsely highlighted.
- **A connection with `connectionStatus !== 'active'`**: `status` is always `'disconnected'` per the existing backend contract — trust header must trust `status`, never re-derive from `lastPollAt` client-side.

### Backward Compatibility
- ✅ No breaking changes — purely additive route, nav item, and feature module. No existing page, API contract, or shared component is modified except the two additive edits (`api-client.ts` composition list, `nav-registry.ts` items array).

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `features/analytics/lib/date-range.lib.test.ts` — preset math, `derivePreset` round-trip, UTC boundary widening
- `features/analytics/lib/ingestion-trust.lib.test.ts` — banner truth table over `status` alone (fresh / never-ingested / unknown → excluded; stalled / disconnected → included), per Decision 4
- `features/analytics/hooks/use-analytics-trust-query.test.tsx` — loading/success/error via `createMockApiClient`
- `features/analytics/components/analytics-date-range-toolbar.test.tsx` — preset click behavior, draft/Apply gating, no-op on Custom click
- `features/analytics/components/analytics-trust-header.test.tsx` — row count, tone mapping, popover open-on-click
- `features/analytics/components/analytics-degradation-banner.test.tsx` — renders per the truth table, empty renders `null`
- `pages/analytics/analytics-page.test.tsx` — empty-instance state, still-arriving state, populated state, error state with retry

### Integration Tests
- None required — this issue has no backend surface to integration-test. (`GET /analytics/trust` already has its own coverage from #1982.)

### Mocking Strategy
- `createMockApiClient({ analyticsTrust: { getTrust: vi.fn()... } })` per the house pattern in `docs/frontend-architecture.md` / `fe-pages.md § Testing Feature Components`.

### Acceptance Criteria (from the GitHub issue, mapped to this plan)
- [ ] `/analytics` reachable from nav, renders in the standard app shell — Phase 4
- [ ] Date range changes update the URL; reloading restores it — Phase 3 + 4
- [ ] Page states data freshness — Phase 2 (trust header `lastPollAt`)
- [ ] Stalled ingestion for a channel with sales in range is called out explicitly, with a link to sync detail — Phase 2 (banner → `/cursors`); satisfied only in the over-warning direction per Decision 4's status-only v1 rule (a `stalled`/`disconnected` channel banners regardless of whether it sold in the selected range, not just those that did)
- [ ] Each channel's available history is visible — Phase 2 (trust header renders the real `earliestOrderDate` "Data from" fact per Decision 3, resolved)
- [ ] No-history instance shows an explanatory empty state — Phase 4 Step 2
- [ ] Loading/error states follow `LoadingState`/`ErrorState` with retry — Phase 4 Step 2
- [ ] Responsive, no horizontal scroll, ≥44px tap targets — verified manually in the running dev server at mobile/tablet breakpoints per the mockup's frames 07/08
- [ ] Primary content within 120px of viewport top — verified manually (no tall hero band; the toolbar is the first element under `PageLayout`'s header)
- [ ] Tests added — § 9 above
- [ ] No new ESLint warnings or type errors — `pnpm lint && pnpm type-check`

**Reference**: `docs/testing-guide.md`

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A layers untouched; FE layering respected)
- [x] Respects CORE vs Integration boundaries (no backend change)
- [x] Uses existing patterns (no unnecessary abstractions — no premature `DateRangePicker` extraction, no new shared primitives)
- [x] Idempotency considered (N/A — pure GET, no mutation)
- [x] Event-driven patterns used where applicable (N/A)
- [x] Rate limits & retries addressed (TanStack Query default retry policy; `refetch()` on manual retry per house convention — no bespoke backoff needed for a single lightweight GET)
- [x] Error handling comprehensive (scoped `ErrorState`, network vs empty-instance vs still-arriving are distinct states)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md) § Analytics Trust
- [Frontend Architecture](../frontend-architecture.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- Issue [#1986](https://github.com/openlinker-project/openlinker/issues/1986)
- Design PR #2018 (issue #2003) — `docs/plans/mockups/analytics-ledger-2003.html`, frames 01 & 01b
- Backend read model PR #2014 (issue #1985) — tracked as the source of the documented follow-ups (Decisions 2 & 3)
- Follow-up issue [#2083](https://github.com/openlinker-project/openlinker/issues/2083) — the real `earliestOrderDate` read Decision 3 defers to; blocked by #1985
- Pre-implementation cross-check (2026-08-14, against PR #2037 + PR #2018) — source of Decisions 3a and 4's revision from a range-gated to a status-only v1 banner rule
