# Implementation plan — Sync Jobs / Dashboard `limit` cap fix (#270)

**Issue:** https://github.com/SilkSoftwareHouse/openlinker/issues/270
**Layer:** Frontend only (no backend changes)

## Goal

The backend validator on `GET /sync/jobs` (and every other list endpoint) caps the `limit` query parameter at 100 via `@Max(100)` on `list-sync-jobs-query.dto.ts` and siblings. Two frontend callers request higher values and break with `limit must not be greater than 100`:

- `apps/web/src/pages/sync-jobs/sync-jobs-page.tsx` → `PAGE_SIZE = 200`
- `apps/web/src/pages/dashboard/dashboard-page.tsx` → `DEAD_JOB_GROUPING_LIMIT = 500`

Both pages currently render an error card and are unusable.

## Non-goals

- Raising the backend cap. 100 is consistent across every list DTO (orders, webhooks, products, customers, inventory, listings, cursors) — changing it touches every endpoint.
- Introducing a shared `PAGINATION_MAX_LIMIT` constant exported from backend to frontend. The backend has no such export; plumbing it properly crosses the backend-to-frontend boundary via the OpenAPI schema, which is out of scope for a one-line bug fix. A code comment pointing at the backend validator is sufficient.
- Server-side grouping for the dashboard (#268) — that's the real long-term fix for the 500 cap.

## Root cause

`list-sync-jobs-query.dto.ts:34` — `@Max(100)`. Applied via NestJS `ValidationPipe`, returns HTTP 400 with the literal error message the user sees.

## Change set

### 1. `apps/web/src/features/sync-jobs/api/sync-jobs.types.ts` (new constant)

- Introduce `export const SYNC_JOBS_MAX_LIMIT = 100;` with a JSDoc pointing at the backend `@Max(100)` validator. Single source of truth for the frontend — follows the `*.types.ts` constants pattern already used in this file (`JOB_STATUS_VALUES`, `JOB_TYPE_VALUES`).

### 2. `apps/web/src/pages/sync-jobs/sync-jobs-page.tsx`

- Replace the hardcoded `PAGE_SIZE = 200` with `const PAGE_SIZE = SYNC_JOBS_MAX_LIMIT;` and a comment citing the backend cap.
- Pagination already handles `offset`, so this is a display-only change — the virtualized table handles 100 rows easily.

### 3. `apps/web/src/pages/dashboard/dashboard-page.tsx`

- Replace `DEAD_JOB_GROUPING_LIMIT = 500` with `const DEAD_JOB_GROUPING_LIMIT = SYNC_JOBS_MAX_LIMIT;` and update the comment to reference #268 as the long-term fix.
- The "N signatures in first M · X total failures" copy added in the Phase 6 tech-review pass already handles the capped-groups case — no UI change needed beyond the constant drop.

### 4. `apps/web/src/features/sync-jobs/api/sync.api.ts`

- Add a JSDoc note on `SyncJobsApi.list` pointing at `SYNC_JOBS_MAX_LIMIT` so the next consumer (e.g., Jobs & Logs filters, future admin tools) doesn't rediscover the ceiling.

### 5. Tests

**Regression guard — assert the request, not the response.** The mock's `{ limit: ... }` return value is cosmetic; it doesn't enforce the request contract. The real assertion belongs on `listMock.mock.calls[N][1].limit`:

- `apps/web/src/pages/dashboard/dashboard-page.test.tsx` — new test: renders the dashboard, waits for the dead-job query, finds the call with `filters.status === 'dead'`, and asserts its pagination argument satisfies `limit <= SYNC_JOBS_MAX_LIMIT && limit === SYNC_JOBS_MAX_LIMIT`. Also update all existing `limit: 500` response-envelope values to `100` so the mocks mirror the real server shape.
- `apps/web/src/pages/sync-jobs/sync-jobs-page.test.tsx` — new test: same pattern, asserts the page's first list call pages with `limit === SYNC_JOBS_MAX_LIMIT`.

Both tests reference `SYNC_JOBS_MAX_LIMIT` so they move in lock-step with the constant.

## Quality gate

- `pnpm --filter @openlinker/web lint` — expect 13 warnings (main baseline), 0 errors
- `pnpm --filter @openlinker/web type-check` — clean
- `pnpm --filter @openlinker/web test` — expect all passing

## Risks / open questions

- **User-visible regression: grouping scope shrinks 5×.** The dashboard incidents surface previously grouped the first 500 dead jobs; it now groups the first 100. For the audit reference scenario (468 failures) this is effectively fine — signatures are count-ordered so the largest groups still surface. For tenants with a long tail of rare signatures (≫ 100 distinct signatures), some will drop out of the grouped view and only show via `/jobs-logs?status=dead`. The "signatures in first M" panel meta renders this honestly, but the PR body should call it out as a reason to prioritise #268 (server-side grouping).
- No new code paths; request payloads shrink.

## Out of scope / follow-ups

- #268 — server-side failed-job aggregation (removes the need for a page-based cap entirely)
- #269 — bulk-retry for a failed-job group
