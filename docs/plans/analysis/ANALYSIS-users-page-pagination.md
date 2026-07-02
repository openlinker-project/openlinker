# Pre-Implementation Analysis: Users Page — Server-Side Pagination for All/Pending Tabs

**Plan**: `docs/plans/implementation-plan-users-page-pagination.md`
**Issue**: #1258
**Date**: 2026-07-01

---

## Verdict: READY

This is a self-contained frontend change (`apps/web` only, three files: `users.query-keys.ts`, `users-page.tsx`, `users-page.test.tsx`). No CORE ports, application services, DI tokens, or ORM entities are created or changed, so the standard Explore-agent fan-out for those artifact classes (Phase B) doesn't apply — the reuse audit below was done by direct grep against the exact three files (and their consumers) the plan touches, re-verified live in this worktree immediately before writing this report.

---

## Reuse Findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `useUsersQuery(filters)` hook | **EXISTS → reuse unchanged** | `apps/web/src/features/users/hooks/use-users-query.ts` — signature already accepts `{ status?, page?, pageSize? }` and returns `{ users, total }`; the plan calls it twice with different filter objects, no hook change needed. |
| `usersQueryKeys.list(filters)` | **PARTIAL → one-line extension** | `apps/web/src/features/users/api/users.query-keys.ts:5-6` — currently omits `pageSize` from the tuple, exactly the bug the plan fixes. Confirmed no other file constructs this key by hand (only `use-users-query.ts` calls it), so widening the tuple is safe. |
| `UsersApi.list(filters)` | **EXISTS → reuse unchanged** | `apps/web/src/features/users/api/users.api.ts:21-34` — `buildQuery` already forwards `status`/`page`/`pageSize` as query params. No change needed. |
| Backend `GET /users` (`page`/`pageSize`/`status`/`total`) | **EXISTS → reuse unchanged** | `apps/api/src/users/http/users.controller.ts:61-72`, `apps/api/src/users/dto/list-users-query.dto.ts` (zero-based `page`, 1–100 `pageSize`, both re-verified live), `apps/api/src/users/dto/user-list-response.dto.ts` (`{ users, total }`). No backend PR required. |
| Per-tab URL-backed pagination pattern (`useSearchParams`, Prev/Next, `.pagination` CSS) | **EXISTS → reuse verbatim** | `apps/web/src/pages/orders/orders-list-page.tsx:256,281,719-751,1039-1051`; CSS classes re-confirmed live at `apps/web/src/index.css:2034,2041`. No new shared `Pagination` component exists anywhere in `apps/web/src/shared/ui/` (confirmed via live `find` — zero matches) — consistent with the plan's decision to hand-roll it the same way every other list page does, not introduce a new primitive. |
| `DataTable` pagination support | **NEW is correctly *not* proposed** | The plan does not modify `DataTable`; it is confirmed page-agnostic (no `page`/`pageSize` props in its interface) — the two per-tab query results are handed to it as plain `rows`, matching the existing usage pattern. |
| Mutation-hook cache invalidation (`usersQueryKeys.all`) | **EXISTS → no change needed** | All six mutation hooks (`use-approve-user-mutation.ts`, `use-reject-user-mutation.ts`, `use-update-role-mutation.ts`, `use-deactivate-user-mutation.ts`, `use-reactivate-user-mutation.ts`, `use-delete-user-mutation.ts`) invalidate the `['users']` prefix, which will continue to invalidate both new per-tab query keys regardless of the added `pageSize` tuple element. |
| Other consumers of `useUsersQuery` / `usersQueryKeys` outside `UsersPage` | **NEW risk correctly ruled out** | Live repo-wide grep for `useUsersQuery|usersQueryKeys` returns only the feature's own files (hooks, api, index barrel) plus `apps/web/src/pages/users/users-page.tsx` — no other page or feature depends on the current single-query shape or the exact cache-key tuple. |

No reuse collisions. No artifact the plan assumes is new turns out to already exist elsewhere, and no artifact the plan assumes exists turns out to be missing.

---

## Backward-Compatibility Findings

| Surface | Check | Result |
|---|---|---|
| Top-level barrels (`@openlinker/core/<ctx>`) | N/A — no CORE code touched | Not applicable |
| Port method signatures | N/A — no ports involved | Not applicable |
| DTO shapes (backend) | Plan makes zero backend changes; `ListUsersQueryDto` / `UserListResponseDto` re-verified unchanged and already sufficient | No break |
| Symbol tokens | N/A — pure `apps/web`, no DI tokens | Not applicable |
| ORM schema / migrations | N/A — no entity or schema change | Not applicable, no migration needed |
| `check:invariants` (cross-context imports, service-interface check, deep-barrel imports) | `apps/web/**` is explicitly outside the cross-context-import walker per `docs/architecture-overview.md` § Scope; live-checked `scripts/check-*.mjs` for any rule touching `apps/web` — only `check-design-tokens.mjs` (CSS-token drift, irrelevant here — no new tokens) and `check-render-template-fixture-drift.mjs` (unrelated AI-template fixtures) reference the path | No trip expected |
| `UsersApi` / `UserListFilters` / `UserListResponse` (feature-internal contract) | Plan does not change any of these shapes — only how `UsersPage` calls `useUsersQuery` and what `usersQueryKeys.list` includes in its cache-key tuple | No break; the query-key tuple widening is an internal TanStack Query cache-key change (session-scoped, not persisted), and the only caller (`use-users-query.ts`) already passes `filters.pageSize` into the same `list()` call, so no call site needs updating for the key change itself |

**No Critical or Warning items.**

---

## Open Questions

None blocking. The plan's own "Assumptions" section (§5) already surfaces and resolves the two judgment calls that could otherwise be open questions:
1. URL state (`allPage`/`pendingPage`) vs. local `useState` — resolved in favor of URL state, matching `docs/frontend-architecture.md` and the `OrdersListPage` precedent.
2. Empty-state detection keyed off `total === 0` rather than the filtered row count — resolved to correctly handle the "All users" tab's client-side pending-exclusion quirk.

---

## Summary

This plan touches only `apps/web` (`users.query-keys.ts`, `users-page.tsx`, `users-page.test.tsx`), reuses every backend and frontend primitive it needs without reinventing any of them (`useUsersQuery`, `UsersApi.list`, the backend `page`/`pageSize`/`status`/`total` contract, and the `OrdersListPage` URL-pagination pattern all verified present and unchanged in the live repo), and makes zero changes to any published contract surface (no CORE ports, DTOs, Symbol tokens, or ORM schema are touched, and `apps/web` sits outside the `check:invariants` cross-context walker). Verdict: **READY** — implementation can proceed directly per the plan as written.
