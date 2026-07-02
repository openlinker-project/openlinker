# Implementation Plan: Users Page — Server-Side Pagination for All/Pending Tabs

**Date**: 2026-07-01
**Status**: Ready for Review
**Estimated Effort**: 4–6 hours

---

## 1. Task Summary

**Objective**: Replace `UsersPage`'s single, unpaginated `useUsersQuery({ status: undefined })` call and its client-side tab derivation with **two independent server-paginated queries** — one for "All users" (active + deactivated) and one for "Pending" — each owning its own page state, Previous/Next controls, and a "Page X of Y" indicator. Tab-count badges must be driven by the backend's `total` field. `usersQueryKeys.list` must include `pageSize` in its cache key.

**Context**: The backend `GET /users` endpoint already supports `page` / `pageSize` / `status` query params and returns `total` (confirmed in `apps/api/src/users/http/users.controller.ts`, `apps/api/src/users/dto/list-users-query.dto.ts`, `apps/api/src/users/dto/user-list-response.dto.ts`). The frontend never wired these through: it fetches a single page (backend default 25 rows) and slices it client-side into "All" / "Pending", so users beyond row 25 are invisible on both tabs, and tab badges reflect the in-memory slice instead of the real totals. Follows from #1125 (user management feature).

**Classification**: Frontend (feature query layer + page composition). No backend, CORE, or migration changes required — the API contract already supports everything this plan needs.

---

## 2. Scope & Non-Goals

### In Scope
- `apps/web/src/features/users/api/users.query-keys.ts` — add `pageSize` to the `list` cache key.
- `apps/web/src/pages/users/users-page.tsx` — split into two `useUsersQuery` calls, add per-tab URL-backed page state, add Previous/Next + "Page X of Y" controls per tab, derive tab badges from `total`.
- `apps/web/src/pages/users/users-page.test.tsx` — verify existing tests still pass under the new query shape, add pagination-specific tests.

### Out of Scope
- Any backend/API change — `page` (0-based), `pageSize` (1–100, default 25), `status`, and response `total` all already exist and are exercised by this plan as-is.
- A page-size selector / configurable page size in the UI.
- An exact server-side count for "All users" excluding pending (the issue explicitly accepts `allTotal - pendingTotal` as an approximation "correct for typical usage" — see §7 Alternative 3 for why a backend change to support this exactly is not pursued here).
- Auto-clamping the current page when a mutation shrinks a tab's `total` below the current page's range (flagged as a risk in §8, not required by the issue's acceptance criteria).
- Syncing which tab is active into the URL (not requested by the issue).
- Any change to the shared `DataTable` component (it is already page-agnostic — see §4).

### Constraints
- Fixed `PAGE_SIZE = 25` per tab (matches the backend default and stays under its `@Max(100)` cap).
- Must not regress the existing mutation flows (approve/reject/role-update/deactivate/reactivate/delete) or their tests.

---

## 3. Architecture Mapping

**Target Layer**: Frontend only — `features/users` (query/API layer) + `pages/users` (page composition), per `docs/frontend-architecture.md`. Server state stays in TanStack Query; per-tab pagination becomes URL state (route search params), matching the documented "URL State" rule (pagination is explicitly listed alongside filters/sort/selected tab) and the existing `OrdersListPage` precedent.

**Capabilities Involved**: None — no CORE ports, adapters, or capability contracts are touched. This is purely `apps/web`.

**Existing Services Reused**:
- `useUsersQuery` hook (`apps/web/src/features/users/hooks/use-users-query.ts`) — unchanged signature, called twice with different filters.
- `usersQueryKeys` (`apps/web/src/features/users/api/users.query-keys.ts`) — one-line fix.
- `UsersApi.list` (`apps/web/src/features/users/api/users.api.ts`) — already forwards `status`/`page`/`pageSize` to the backend; no change needed.
- `DataTable`, `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`, `Button`, `EmptyState`/`ErrorState`, `DataTableSkeleton` — all reused as-is.
- `.pagination` / `.pagination__actions` CSS (`apps/web/src/index.css:2034-2049`) — already defined and used by `OrdersListPage`; reused verbatim, no new CSS.

**New Components Required**: None. Only edits to the three files listed in Scope.

**Core vs Integration Justification**: N/A — no CORE or Integration code is touched. This is a pure frontend fix confined to `apps/web`, consistent with the issue's `frontend` label and its explicit statement that "the backend already supports `page`/`pageSize`/`status`... the frontend just hasn't wired them through."

**ADR**: Not required. Per `docs/architecture-overview.md` § Architecture Decision Records, an ADR is warranted for decisions that affect multiple bounded contexts, the plugin contract, or carry non-trivial rejected alternatives. This change is a routine frontend feature fix confined to one page and one feature folder, using a pattern (`useSearchParams`-backed pagination) already established by `OrdersListPage` — it doesn't meet that bar.

---

## 4. External / Domain Research

### Backend Contract (already implemented — verified in-repo, no changes needed)

- **Endpoint**: `GET /users` — `apps/api/src/users/http/users.controller.ts:61-72`.
- **Request query DTO** — `apps/api/src/users/dto/list-users-query.dto.ts`:
  - `status?: UserStatus` — optional, validated against `UserStatusValues` (`'pending' | 'active' | 'deactivated'`).
  - `page?: number` — optional, zero-based, `@Min(0)`, default `0`.
  - `pageSize?: number` — optional, `@Min(1)` / `@Max(100)`, default `25`.
- **Response DTO** — `apps/api/src/users/dto/user-list-response.dto.ts`: `{ users: UserSummaryDto[], total: number }`. `total` is the count matching the applied `status` filter (or all users, if `status` is omitted) — **not** just the current page's length.
- **`status=pending` is an exact server-side filter** — the DTO validates against the closed `UserStatusValues` enum and the service passes it straight through to the query; no other status can leak in.

### Internal Precedent

- **`apps/web/src/pages/orders/orders-list-page.tsx`** is the reference implementation for URL-backed server-side pagination in this codebase:
  - `:256` — `const [searchParams, setSearchParams] = useSearchParams();`
  - `:281` — `const offset = Number(searchParams.get('offset') ?? '0');`
  - `:719-734` — a `setOffset(next)` helper that updates the URL param (deleting it when back to the default) via `setSearchParams`.
  - `:736-738` — `hasPrev` / `hasNext` computed from `total` and the page size.
  - `:1039-1051` — the rendered `<div className="pagination">...<div className="pagination__actions">` block with `Previous`/`Next` `Button`s, `disabled` wired to `hasPrev`/`hasNext`.
- **`docs/frontend-architecture.md` § State Management → URL State** explicitly lists pagination as URL-owned state, alongside filters, sort order, and selected tab.
- **No shared `shared/ui/pagination.tsx` primitive exists.** Every paginated list page (`orders`, `inventory`, `customers`, `products`, `listings`, `cursors`, `webhook-deliveries`, `invoicing`) hand-rolls its own Previous/Next block against the shared `.pagination` CSS classes. This plan follows the same convention rather than introducing a new shared primitive (see §7 Alternative 2 for the trade-off).
- **`DataTable`** (`apps/web/src/shared/ui/data-table.tsx`) has no built-in pagination — it renders whatever `rows` it's given. Pagination is entirely the caller's responsibility, which is exactly the shape this plan needs (each tab passes its own already-paginated row slice).

---

## 5. Questions & Assumptions

### Open Questions
- None blocking — the issue's Solution section fully specifies the query split, the count-derivation formula, and the acceptance criteria.

### Assumptions
1. **`PAGE_SIZE = 25`, fixed, no UI selector.** Matches the backend default; a configurable page size is out of scope per the issue.
2. **Per-tab page state lives in URL search params** (`allPage`, `pendingPage`; both zero-based integers, default `0`), not component-local `useState`. The issue itself doesn't mandate the storage mechanism, but `docs/frontend-architecture.md` documents pagination as URL state, and `OrdersListPage` already establishes the pattern. URL state also trivially satisfies the "switching tabs does not reset the other tab's page position" acceptance criterion, since both params coexist in the same URL and neither is cleared by the other.
3. **"Page X of Y" wording** (per the issue's own Solution text) is used instead of `OrdersListPage`'s "Showing X–Y of Z" copy, since the issue specifies it verbatim. Computed as `page + 1` for X and `Math.max(1, Math.ceil(total / PAGE_SIZE))` for Y.
4. **Empty-state detection keys off `total === 0`, not the current page's filtered row count.** This matters specifically for the "All users" tab: because that query has no `status` filter, a given page's raw rows may include some pending users that get filtered out client-side (per the issue's explicit design — see below), so the *visible* row count on a page can be less than `PAGE_SIZE` (in a pathological case, zero) even while `total` (and therefore the derived "all users excluding pending" count) is greater than zero. Keying the empty-state check off the derived total avoids a false "No users found."
5. **Mutations require no changes.** All six mutation hooks (`use-approve-user-mutation.ts`, `use-reject-user-mutation.ts`, `use-update-role-mutation.ts`, `use-deactivate-user-mutation.ts`, `use-reactivate-user-mutation.ts`, `use-delete-user-mutation.ts`) already call `queryClient.invalidateQueries({ queryKey: usersQueryKeys.all })`, i.e. the `['users']` prefix — this invalidates **both** the all-users and pending queries regardless of their exact key shape, so no invalidation logic needs to change.

### Documentation Gaps
- None. `docs/frontend-architecture.md` plus the `OrdersListPage` precedent fully cover the pattern this plan applies.

---

## 6. Proposed Implementation Plan

### Phase 1: Fix the query-key cache-collision bug
**Goal**: `usersQueryKeys.list` includes `pageSize`, so two calls that differ only in `pageSize` don't collide in the TanStack Query cache.

**Steps**:
1. **Add `pageSize` to the cache key**
   - **File**: `apps/web/src/features/users/api/users.query-keys.ts`
   - **Action**: change
     ```ts
     list: (filters?: UserListFilters) =>
       ['users', 'list', filters?.status ?? 'all', filters?.page ?? 0] as const,
     ```
     to
     ```ts
     list: (filters?: UserListFilters) =>
       ['users', 'list', filters?.status ?? 'all', filters?.page ?? 0, filters?.pageSize ?? 0] as const,
     ```
   - **Acceptance**: two `useUsersQuery` calls with identical `status`/`page` but different `pageSize` produce distinct cache entries.
   - **Dependencies**: none.

### Phase 2: Split `UsersPage` into two server-paginated queries
**Goal**: Each tab is backed by its own paginated query, its own URL-backed page, and its own Previous/Next controls; badges reflect backend totals.

**Steps**:
1. **Add URL-backed per-tab page state**
   - **File**: `apps/web/src/pages/users/users-page.tsx`
   - **Action**: import `useSearchParams` from `react-router-dom`. Read `allPage` / `pendingPage` via `Number(searchParams.get('allPage') ?? '0')` / `Number(searchParams.get('pendingPage') ?? '0')`. Add `setAllPage(next)` / `setPendingPage(next)` helpers mirroring `OrdersListPage`'s `setOffset` (`:719-734`) — update via `setSearchParams`, deleting the param when `next === 0` to keep the URL clean.
   - **Acceptance**: clicking Next/Previous changes the corresponding URL param; a direct URL with `?pendingPage=1` renders the pending tab's second page.
   - **Dependencies**: none.

2. **Replace the single query with two independent ones**
   - **File**: `apps/web/src/pages/users/users-page.tsx`
   - **Action**: replace
     ```ts
     const usersQuery = useUsersQuery({ status: undefined });
     ```
     with
     ```ts
     const PAGE_SIZE = 25;
     const allUsersQuery = useUsersQuery({ page: allPage, pageSize: PAGE_SIZE });
     const pendingUsersQuery = useUsersQuery({ status: 'pending', page: pendingPage, pageSize: PAGE_SIZE });
     ```
     (`PAGE_SIZE` as a module- or component-level `const`, matching the convention already used in `orders-list-page.tsx:75`, `inventory-list-page.tsx:16`, etc.)
   - **Acceptance**: two distinct network calls fire — one unfiltered (paged), one `status=pending` (paged) — each with independent `page` values.
   - **Dependencies**: Step 1 (needs `allPage`/`pendingPage`).

3. **Recompute derived rows, totals, and badge counts**
   - **File**: `apps/web/src/pages/users/users-page.tsx`
   - **Action**:
     ```ts
     const allRows = allUsersQuery.data?.users ?? [];
     const managedUsers = allRows.filter((u) => u.status !== 'pending');
     const pendingUsers = pendingUsersQuery.data?.users ?? [];
     const pendingTotal = pendingUsersQuery.data?.total ?? 0;
     const managedTotal = Math.max(0, (allUsersQuery.data?.total ?? 0) - pendingTotal);
     ```
     Replace the old `allUsers.filter(...)`-derived `managedUsers`/`pendingUsers` (current lines 57–59) with this.
   - **Acceptance**: `managedTotal` / `pendingTotal` are available for the badges and pagination math; `managedUsers` / `pendingUsers` remain the actual rows rendered per page.
   - **Dependencies**: Step 2.

4. **Update tab badges to use totals, not array length**
   - **File**: `apps/web/src/pages/users/users-page.tsx` (current lines 343–354)
   - **Action**: swap `managedUsers.length > 0 && ...{managedUsers.length}` → `managedTotal > 0 && ...{managedTotal}`, and `pendingUsers.length > 0 && ...{pendingUsers.length}` → `pendingTotal > 0 && ...{pendingTotal}`.
   - **Acceptance**: with 40 total users, 25 loaded on the current page, the "All users" badge reads a number derived from 40, not 25.
   - **Dependencies**: Step 3.

5. **Update `renderAllContent` / `renderPendingContent` to use their own query + add pagination controls**
   - **File**: `apps/web/src/pages/users/users-page.tsx`
   - **Action**: `renderAllContent` reads `allUsersQuery.isLoading` / `.error` / `.refetch()`; `renderPendingContent` reads the equivalent from `pendingUsersQuery`. Empty-state checks become `managedTotal === 0` / `pendingTotal === 0` (per Assumption 4). On the success path, render the existing `DataTable` followed by a small pagination block. Factor the repeated Previous/"Page X of Y"/Next markup into one local helper to avoid duplicating it for both tabs, e.g.:
     ```tsx
     function renderPagination(page: number, setPage: (p: number) => void, total: number): ReactElement {
       const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
       return (
         <div className="pagination">
           <span className="text-muted">Page {page + 1} of {pageCount}</span>
           <div className="pagination__actions">
             <Button disabled={page <= 0} onClick={() => setPage(page - 1)}>Previous</Button>
             <Button disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>Next</Button>
           </div>
         </div>
       );
     }
     ```
     Call `renderPagination(allPage, setAllPage, managedTotal)` below the "All users" `DataTable`, and `renderPagination(pendingPage, setPendingPage, pendingTotal)` below the "Pending" `DataTable`.
   - **Acceptance**: each tab shows its own Previous/Next + "Page X of Y"; Prev disabled at page 0; Next disabled on the last page; the pagination block does not render in the loading/error/empty branches (matches `OrdersListPage`'s pattern of only rendering pagination alongside a non-empty table).
   - **Dependencies**: Steps 1–4.

6. **No new CSS**
   - `.pagination` / `.pagination__actions` are already declared in `apps/web/src/index.css:2034-2049` and used by `OrdersListPage` — reused as-is.

### Phase 3: Tests
**Goal**: Existing behavioral coverage stays green; new tests cover the acceptance criteria explicitly.

**Steps**:
1. **Verify existing tests under the new query shape**
   - **File**: `apps/web/src/pages/users/users-page.test.tsx`
   - **Action**: every existing test mocks `list` with a single `vi.fn().mockResolvedValue(...)` regardless of call args. Under the new two-query design this mock now backs *both* calls (all-users and pending), but since Radix `TabsContent` unmounts the inactive tab's DOM (confirmed: `apps/web/src/shared/ui/tabs.tsx` wraps `@radix-ui/react-tabs` with no `forceMount`), and each existing test only asserts against the active tab's rendered content, these tests should require no code changes — run them and confirm.
   - **Acceptance**: all pre-existing tests (lines 23–190 of the current file) pass unmodified.

2. **Add pagination-specific tests**
   - **File**: `apps/web/src/pages/users/users-page.test.tsx`
   - **New cases** (mock `list` branching on `filters.status` / `filters.page`, e.g. `vi.fn((filters) => filters?.status === 'pending' ? pendingFixture(filters.page) : allFixture(filters.page))`):
     - `should show "Page 1 of 2" and an enabled Next button when total exceeds one page` — mock 25 rows + `total: 26` for the all-users query.
     - `should disable Previous on page 0 and Next on the last page` — assert the `disabled` attribute at both pagination boundaries for a 2-page fixture.
     - `should advance to the next page and refetch when Next is clicked` — click Next, assert `list` was called again with `page: 1` for the corresponding query (via `mock.mock.calls`).
     - `tab badges should reflect the backend total, not the row count of the loaded page` — mock a 25-row page with `total: 40` and assert the "All users" badge renders a value derived from 40 (not 25).
     - `switching tabs preserves the other tab's page position` — advance the pending tab to page 1 (via URL or a Next click), switch to the "All" tab and back, assert the pending tab is still on page 1 (no reset).
   - **Acceptance**: all six issue acceptance criteria (§ below) are each covered by at least one assertion.

---

## 7. Alternatives Considered

### Alternative 1: Keep one `useUsersQuery` call but request a much larger `pageSize` (e.g. 1000) and keep the current client-side tab derivation
- **Why Rejected**: the backend caps `pageSize` at 100 (`list-users-query.dto.ts` `@Max(100)`), so this doesn't actually solve the problem for any tenant with more than 100 users — it just raises the ceiling. It also directly contradicts the issue's explicit ask for "two independent server-paginated queries."
- **Trade-offs**: simpler code, but not a real fix and diverges from the issue's specified solution.

### Alternative 2: Component-local `useState` for each tab's `page` instead of URL search params
- **Why Rejected**: `docs/frontend-architecture.md` explicitly categorizes pagination as URL state, and `OrdersListPage` already establishes this exact pattern for a paginated list in this codebase. URL state also makes a given page bookmarkable/shareable and survives a page refresh, which `useState` would not.
- **Trade-offs**: `useState` would be marginally less code (two `useState` calls vs. `useSearchParams` wiring), but forgoes the URL-state benefits the architecture doc calls for.

### Alternative 3: Extend the backend to accept a multi-value or "exclude" status filter so "All users" can be fetched exactly (excluding pending) server-side
- **Why Rejected**: out of scope for this frontend-only issue (labeled `frontend`, not `backend`); the issue's own Solution section explicitly specifies the "no status filter on the All query + client-side pending exclusion" approach and accepts the resulting count as "approximate but correct for typical usage" since pending registrations are a small set.
- **Trade-offs**: a backend change would make the "All users" total and per-page row count exact, at the cost of a DTO/service change and a second migration-free backend PR. Revisit only if the approximation proves materially wrong in practice.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Confined to `apps/web`; `pages/users` composes `features/users`, consistent with `docs/frontend-architecture.md` § Folder Conventions.
- ✅ No raw `fetch()` — goes through the existing `UsersApi.list` → `useUsersQuery` chain.
- **Reference**: `docs/frontend-architecture.md`

### Naming Conventions
- ✅ No new files created; all edits follow the existing `use-*.ts`, `*.query-keys.ts`, `*-page.tsx`, `*.test.tsx` conventions already present in this feature/page.
- **Reference**: `docs/engineering-standards.md` § Naming Conventions

### Existing Patterns
- ✅ Mirrors `OrdersListPage`'s URL-search-param pagination structure and reuses its `.pagination` / `.pagination__actions` CSS verbatim.

### Risks
- **Stale out-of-range page after a mutation**: if a mutation (delete / approve / reject) shrinks a tab's `total` such that the current `page` becomes invalid, the next fetch could return zero rows for that page while `total > 0`, producing a "Page 3 of 2"-style indicator with an apparently-empty table. **Mitigation**: not required by the issue's acceptance criteria; flagged here for a follow-up (a `useEffect` that steps `page` back by one when a non-zero-`page` query returns zero rows with `total > 0` would close this cleanly) if it proves disruptive in practice.
- **"All users" per-page under-fill**: because the all-users query is unfiltered, a page's raw 25 rows can include some pending users that get excluded client-side, so the tab can render fewer than 25 rows on a page (in the extreme, zero, if a page happens to contain only pending rows). This is the issue's own accepted approximation. **Mitigation**: the empty-state check keys off `managedTotal` (not the filtered row count — see Assumption 4), so this never mis-reports "No users found" when users do exist.

### Edge Cases
- **0 users total**: `pageCount = Math.max(1, Math.ceil(0/25)) = 1` → "Page 1 of 1", both Prev/Next disabled, `EmptyState` renders (via the `total === 0` check) instead of the table.
- **Exactly 25 users**: `pageCount = 1` → Next disabled on page 0 (no dangling enabled Next into an empty page).
- **26 users** (the issue's own example): `pageCount = 2`; page 0 shows 25 rows, page 1 shows 1; Next enabled on page 0, disabled on page 1.

### Backward Compatibility
- ✅ No changes to `UsersApi`, `UserListFilters`, `UserListResponse`, or the backend contract.
- ✅ `usersQueryKeys.list` gains a tuple element (`pageSize`) — this reshapes the in-memory cache key, but TanStack Query keys are structural per-session (not persisted), so no migration is needed and no other consumer of `usersQueryKeys`/`useUsersQuery` exists outside `UsersPage` (verified via repo-wide search).

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- **Files**: `apps/web/src/pages/users/users-page.test.tsx`
- Existing behavioral coverage (loading/error/empty states, approve/reject/role-update/deactivate/reactivate/delete flows) must continue to pass unmodified. New pagination-focused cases are added per Phase 3 Step 2.

### Integration Tests
- None needed. This is a pure frontend composition change against an already-implemented, already-tested backend endpoint; per `docs/testing-guide.md`, integration tests target backend vertical slices via Testcontainers, which isn't applicable here.

### Mocking Strategy
- Mock `UsersApi.list` through the existing `createMockApiClient` helper (`apps/web/src/test/test-utils.tsx`). For pagination-specific tests, branch the mock's return value on `filters.status` / `filters.page` so the all-users and pending queries can be asserted independently.

### Acceptance Criteria (verbatim from the issue)
- [ ] 26+ users: "All users" shows rows 1–25 on page 1, rows 26+ accessible via Next
- [ ] 26+ pending registrations: Pending tab paginates independently
- [ ] Tab badges reflect backend `total`, not local array length
- [ ] Switching tabs does not reset the other tab's page position
- [ ] Prev button is disabled on page 0; Next disabled when on the last page
- [ ] Tests updated to cover paginated rendering and control states

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A for this change — pure frontend page/feature composition, no backend layers touched)
- [x] Respects CORE vs Integration boundaries (no CORE or Integration code touched)
- [x] Uses existing patterns (mirrors `OrdersListPage`'s URL-state pagination; no unnecessary abstractions, no new shared component)
- [x] Idempotency considered (N/A — read-only `GET` pagination, no writes introduced)
- [ ] Event-driven patterns used where applicable — N/A, no events involved
- [x] Rate limits & retries addressed — N/A, in-house REST endpoint, no external system
- [x] Error handling comprehensive (existing per-tab `ErrorState` + retry retained, now scoped per query)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards (no new files; edits stay within existing feature/page structure)
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
