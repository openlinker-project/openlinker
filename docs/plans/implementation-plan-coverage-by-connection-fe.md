# Implementation Plan — Swap channel-table exclusion cross-reference to the aggregate endpoint

- **Issue**: [#2714](https://github.com/openlinker-project/openlinker/issues/2714)
- **Type**: Frontend
- **Layer**: Feature (`analytics`)
- **Depends on**: [#2713](https://github.com/openlinker-project/openlinker/issues/2713) — `GET /analytics/coverage/by-connection`, shipped in PR [#2810](https://github.com/openlinker-project/openlinker/pull/2810) (not yet merged to `main`). This branch is built on top of `2713-coverage-by-connection-reads`.

## 1. Goal & scope

### Goal

`ChannelSalesTable`'s `.excl-note` cross-reference currently drains **every page** of the currency-mismatch and tax A/B/C affected-order lists client-side (`useCoverageCrossReferenceQuery`, 4 separate `useQuery` calls, one per category) purely to build a `sourceConnectionId -> category -> count` map. Replace that with a single call to the new `GET /analytics/coverage/by-connection` endpoint, which already returns exactly that shape, grouped server-side.

### Non-goals

- `product-sales-table.tsx`'s use of `useCoverageCrossReferenceQuery` is **untouched**. It needs the FULL per-order `productId`/`lineRates` (there is no product-level aggregate — #2713 only groups by connection), so it keeps draining pages via the existing hook. Confirmed via `product-exclusion-map.lib.ts`'s doc comment and `buildProductExclusionMap`'s use of `lineRates`/`productId`.
- No change to `GET /analytics/coverage` (the 10-id-sample aggregate) or its hook (`useAnalyticsCoverageQuery`) — that's a different read (open/in-progress status + a small sample), consumed by `AnalyticsDataCoveragePanel`.
- No change to `product-matching` handling — it was already excluded from `CROSS_REFERENCEABLE_CATEGORIES` and the backend `by-connection` endpoint doesn't return it either (#2713).

## 2. Research summary

- **`useCoverageCrossReferenceQuery`** (`apps/web/src/features/analytics/hooks/use-coverage-cross-reference-query.ts`) is called 4× in `ChannelSalesTable` (currency, tax-a, tax-b, tax-c) and 4× in `ProductSalesTable` — **8 total call sites**, but only the 4 in `ChannelSalesTable` are in scope.
- **`buildChannelExclusionMap`** (`apps/web/src/features/analytics/lib/channel-exclusion-map.lib.ts`) is called from exactly one place: `ChannelSalesTable`. Its sibling `buildProductExclusionMap` (`product-exclusion-map.lib.ts`) re-exports `CROSS_REFERENCEABLE_CATEGORIES`/`CrossReferenceableCategory` from the same file but does **not** call `buildChannelExclusionMap` itself — so reshaping that one function's signature has no other blast radius.
- **The consumer of the result** (`ChannelExclusionNotes` in `channel-sales-table.tsx`) only ever reads `ChannelExclusionMap` (`Map<string, Map<CrossReferenceableCategory, number>>`) — untouched by this change, since both the old and new producer functions return that same shape.
- **Backend contract** (`AnalyticsCoverageByConnectionResponseDto`, PR #2810): `GET /analytics/coverage/by-connection?from=&to=&sourceConnectionId=` → `{ categories: [{ category, rows: [{ sourceConnectionId, affectedCount }] } ] }`, one entry per `'currency' | 'tax-a' | 'tax-b' | 'tax-c'` (never `'product-matching'`), each carrying a possibly-empty `rows` array.
- **Existing sibling pattern to mirror**: `analytics-coverage.api.ts` already has `getCoverage` for `GET /analytics/coverage`, reusing one `buildQuery` helper — `getCoverageByConnection` is a second method on the same `AnalyticsCoverageApi` interface/factory, same query-string shape.
- **Test fixtures to update**: `channel-sales-table.test.tsx`'s `.excl-note` describe block (2 tests) mocks `getCurrencyMismatchOrders`/`getTaxCoverageOrders`; these need to mock `getCoverageByConnection` instead, with the SAME expected rendered output (issue's own acceptance criterion — "should not need to change shape, only their mocked apiClient calls"). `test-utils.tsx`'s default `createMockApiClient` needs a default `getCoverageByConnection` mock so every OTHER test rendering `ChannelSalesTable` (which doesn't explicitly mock it) doesn't crash on an undefined function call.

## 3. Design

### 3.1 Types — `apps/web/src/features/analytics/api/analytics-coverage.types.ts`

Add, alongside the existing `AnalyticsCoverage`/`CoverageCategoryRow`:

```typescript
export interface CoverageConnectionRow {
  sourceConnectionId: string;
  affectedCount: number;
}

export interface CoverageCategoryConnectionRows {
  category: CoverageCategory;
  rows: CoverageConnectionRow[];
}

export interface AnalyticsCoverageByConnection {
  categories: CoverageCategoryConnectionRows[];
}
```

(`category` stays the broad `CoverageCategory` — same choice `CoverageCategoryRow` already makes — rather than importing the narrower `CrossReferenceableCategory` from `channel-exclusion-map.lib.ts`, which would create a `types.ts -> lib.ts` import in the wrong direction; the narrowing happens where it's consumed, per §3.4.)

### 3.2 API client — `apps/web/src/features/analytics/api/analytics-coverage.api.ts`

Add `getCoverageByConnection` to `AnalyticsCoverageApi` and its factory, reusing the existing `buildQuery` helper verbatim (same filters shape):

```typescript
export interface AnalyticsCoverageApi {
  getCoverage: (filters: AnalyticsCoverageFilters) => Promise<AnalyticsCoverage>;
  getCoverageByConnection: (filters: AnalyticsCoverageFilters) => Promise<AnalyticsCoverageByConnection>;
}
...
getCoverageByConnection: (filters) => request(`/analytics/coverage/by-connection?${buildQuery(filters)}`),
```

### 3.3 Query keys — `apps/web/src/features/analytics/api/analytics-coverage.query-keys.ts`

Add a sibling key factory:

```typescript
byConnection: (filters: AnalyticsCoverageFilters) => ['analytics', 'coverage', 'by-connection', filters] as const,
```

### 3.4 New hook — `apps/web/src/features/analytics/hooks/use-coverage-by-connection-query.ts`

One `useQuery`, no per-category fan-out (replaces `useCoverageCrossReferenceQuery`'s 4 calls with 1):

```typescript
export function useCoverageByConnectionQuery(
  filters: AnalyticsCoverageFilters,
  enabled: boolean
): { data: AnalyticsCoverageByConnection | undefined } {
  const apiClient = useApiClient();
  const { data } = useQuery({
    queryKey: analyticsCoverageQueryKeys.byConnection(filters),
    queryFn: () => apiClient.analytics.getCoverageByConnection(filters),
    enabled,
  });
  return { data };
}
```

Same silent-degradation contract as its predecessor (only `data`, no `isLoading`/`isError` — a still-loading/failed read just contributes no exclusion notes for one render, never a table-wide error state).

### 3.5 `buildChannelExclusionMap` — reshaped, not duplicated

`channel-exclusion-map.lib.ts`'s `buildChannelExclusionMap` currently counts a `Partial<Record<CrossReferenceableCategory, CoverageOrderLite[]>>` client-side. Since it has exactly one caller (being changed in this same task) and the grouping now happens server-side, **reshape it in place** rather than adding a second function:

```typescript
export function buildChannelExclusionMap(
  byConnection: AnalyticsCoverageByConnection | undefined
): ChannelExclusionMap {
  const rowsByCategory = new Map(
    (byConnection?.categories ?? []).map((entry) => [entry.category, entry.rows])
  );
  const map: ChannelExclusionMap = new Map();
  for (const category of CROSS_REFERENCEABLE_CATEGORIES) {
    for (const row of rowsByCategory.get(category) ?? []) {
      const byCategory = map.get(row.sourceConnectionId) ?? new Map<CrossReferenceableCategory, number>();
      byCategory.set(category, row.affectedCount);
      map.set(row.sourceConnectionId, byCategory);
    }
  }
  return map;
}
```

`CoverageOrderLite` and `CrossReferenceableCategory`/`CROSS_REFERENCEABLE_CATEGORIES` stay exported unchanged — `product-exclusion-map.lib.ts` still needs all three for its own, untouched function.

### 3.6 `ChannelSalesTable` — swap the call site

`apps/web/src/features/analytics/components/channel-sales-table.tsx`:

- Replace the `useCoverageCrossReferenceQuery` import with `useCoverageByConnectionQuery`.
- Replace the 4 hook calls + the `buildChannelExclusionMap({ currency: ..., 'tax-a': ..., ... })` object-literal call with:

```typescript
const anyOpenCrossReferenceable = CROSS_REFERENCEABLE_CATEGORIES.some((c) => openCategoryCodes.has(c));
const byConnection = useCoverageByConnectionQuery(
  crossRefFilters,
  crossRefEnabled && anyOpenCrossReferenceable
);
const exclusions = buildChannelExclusionMap(byConnection.data);
```

`openCategoryCodes` stays (still needed to gate the single request when every cross-referenceable category is already `affectedCount: 0` — preserving the existing "no network call when Data Coverage is all-clear" property, now expressed as "any", not "each").

- Update the component's header doc comment (the `.excl-note` paragraph, ~line 53) to describe the single aggregate call instead of "drains every page via `useCoverageCrossReferenceQuery`".

### 3.7 `useCoverageCrossReferenceQuery` doc comment

Update its header to state it is now consumed ONLY by `ProductSalesTable` (product-level cross-reference has no aggregate equivalent — #2713 groups by connection, not by product) and that `ChannelSalesTable` was swapped off it by #2714. No code change to the hook itself.

### 3.8 Tests

- `channel-sales-table.test.tsx`'s `.excl-note` describe block: replace `getCurrencyMismatchOrders`/`getTaxCoverageOrders` mocks with a single `getCoverageByConnection` mock per test, returning the equivalent `{ categories: [...] }` shape. Assertions on rendered `.excl-note` text/count stay byte-identical (issue's own acceptance criterion).
- `test-utils.tsx`: add a default `getCoverageByConnection: vi.fn().mockResolvedValue({ categories: [] })` to `createMockApiClient`'s `analytics` namespace, mirroring the existing `getCurrencyMismatchOrders`/`getTaxCoverageOrders` defaults, so every other test that renders `ChannelSalesTable` without explicitly mocking it doesn't hit an undefined function.
- New unit test for `buildChannelExclusionMap`'s reshaped signature (none existed before — add one, since this is now the shape doing the real work), covering: multi-connection grouping, an empty `rows` array for an open-but-zero category, and `undefined` input (never-loaded state).
- No new test needed for `useCoverageByConnectionQuery`/`getCoverageByConnection` beyond what the component test already exercises through `createMockApiClient` — matches the existing `useCoverageCrossReferenceQuery`'s own test coverage (none dedicated; exercised via the component).

## 4. Files touched

| File | Change |
|---|---|
| `apps/web/src/features/analytics/api/analytics-coverage.types.ts` | + `CoverageConnectionRow`, `CoverageCategoryConnectionRows`, `AnalyticsCoverageByConnection` |
| `apps/web/src/features/analytics/api/analytics-coverage.api.ts` | + `getCoverageByConnection` |
| `apps/web/src/features/analytics/api/analytics-coverage.query-keys.ts` | + `byConnection` key factory |
| `apps/web/src/features/analytics/hooks/use-coverage-by-connection-query.ts` | new file |
| `apps/web/src/features/analytics/hooks/use-coverage-cross-reference-query.ts` | doc comment only |
| `apps/web/src/features/analytics/lib/channel-exclusion-map.lib.ts` | `buildChannelExclusionMap` reshaped |
| `apps/web/src/features/analytics/lib/channel-exclusion-map.test.ts` | new file (unit test) |
| `apps/web/src/features/analytics/components/channel-sales-table.tsx` | swap call site, doc comment |
| `apps/web/src/features/analytics/components/channel-sales-table.test.tsx` | `.excl-note` mocks updated |
| `apps/web/src/test/test-utils.tsx` | + default `getCoverageByConnection` mock |

No backend, no migration, no cross-package boundary change — `apps/web` never imports `@openlinker/core` (#591), consistent with the existing pattern.

## 5. Step-by-step plan

1. Add the three new types (§3.1).
2. Add `getCoverageByConnection` to the API client + query keys (§3.2, §3.3).
3. Add `useCoverageByConnectionQuery` (§3.4).
4. Reshape `buildChannelExclusionMap` (§3.5); add its unit test.
5. Swap `ChannelSalesTable`'s call site + doc comment (§3.6).
6. Update `useCoverageCrossReferenceQuery`'s doc comment (§3.7).
7. Update `channel-sales-table.test.tsx`'s `.excl-note` mocks (§3.8).
8. Add the default `getCoverageByConnection` mock to `test-utils.tsx` (§3.8).
9. `pnpm --filter @openlinker/web type-check` + lint on touched files.
10. `pnpm --filter @openlinker/web test` (or the affected test files) — full FE suite is fast/no Docker, unlike backend `pnpm test:integration`.

## 6. Risks & edge cases

- **All-clear state**: when every cross-referenceable category has `affectedCount: 0` in the already-fetched `coverage` prop, the new hook is disabled entirely (`anyOpenCrossReferenceable` false) — zero network calls, matching current behavior's intent (previously: zero of the 4 per-category calls fired either, for the same reason).
- **Partial category presence**: the backend `by-connection` response always includes all 4 categories (even with an empty `rows` array) per PR #2810's design — `rowsByCategory.get(category) ?? []` handles a hypothetically missing entry defensively anyway.
- **`onOpenCategory`/`coverageFilters` optional**: unchanged gating (`crossRefEnabled`), so a caller that doesn't wire coverage in (e.g. some other page embedding `ChannelSalesTable`) still renders with zero exclusion notes and now literally zero related requests, not even the disabled-query bookkeeping across 4 hooks.
- **No behavior change for `ProductSalesTable`**: explicitly out of scope; verified no shared mutable state or accidental coupling exists between the two tables' use of the old hook.

## 7. Final validation checklist

- [x] Dependency direction: `pages` never imports `features` internals directly; this stays within `features/analytics`
- [x] No raw `fetch` from components — goes through `apiClient.analytics.*` via a hook, matching every sibling read
- [x] Server state via TanStack Query (`useQuery`), no new local/global state
- [x] No business logic duplicated from BE — the FE only reshapes an already-grouped response into a `Map`, same as before
- [x] Naming: `use-*.ts` hook file, `*.lib.ts` pure helper, `*.types.ts` types, `*.api.ts` client — all match existing conventions in this feature
- [x] Tests updated for the new API call shape; existing regression assertions preserved
- [x] Plan is execution-ready

## 8. Questions & Assumptions

- **Assumption**: since PR #2810 (issue #2713) is not yet merged to `main`, this branch stacks on top of `2713-coverage-by-connection-reads` rather than `main` — consistent with how #2713 itself stacked on `2799-product-identity-coverage-rows`. If #2713 merges first, this branch rebases cleanly (no conflicts expected — disjoint file sets).
- **Assumption**: `buildChannelExclusionMap`'s signature change (object → `AnalyticsCoverageByConnection | undefined`) is acceptable as an in-place reshape rather than a new function name, since it has exactly one caller and the issue explicitly anticipates this ("stays (or simplifies)").
