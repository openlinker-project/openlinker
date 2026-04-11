# Implementation Plan: Cursor API & Cursors Visibility Page

**Date**: 2026-04-11  
**Status**: Ready for Review  
**Issues**: #77 (BE — Improve cursor API), #75 (FE — Build cursors visibility page)

---

## 1. Task Summary

**Objective**: Expose connection cursors via a read API and build a frontend page to display cursor state per connection.

**Context**: Cursors track incremental sync position (e.g., `allegro.orders.lastEventId`). They are currently backend-only with no API or UI. Operators need visibility into cursor state for debugging sync issues — stale cursors, regression detection, last-updated timestamps.

**Classification**: Interface (BE controller + DTOs) + Frontend (page + feature module)

---

## 2. Scope & Non-Goals

### In Scope
- `GET /cursors` — list all cursors, filterable by `connectionId`
- `GET /cursors/:connectionId/:cursorKey` — get single cursor detail
- Stable response format with `connectionId`, `cursorKey`, `value`, `updatedAt`
- Swagger documentation
- Frontend cursors list page with connection filter
- Read-only MVP

### Out of Scope
- Cursor reset/delete from UI (future: #72 retry/remediation APIs)
- Cursor edit/manual advance
- Real-time cursor updates (polling on page is sufficient)
- Cursor history/audit trail

---

## 3. Architecture Mapping

**Target Layers**: 
- CORE: Extend `ConnectionCursorRepositoryPort` with `findMany`
- Interface (BE): New `CursorsController` in `apps/api/src/cursors/`
- Frontend: New `cursors` feature module + page

**Existing Services Reused**:
- `ConnectionCursorRepositoryPort` / `ConnectionCursorRepository` — extend with list method
- `CONNECTION_CURSOR_REPOSITORY_TOKEN` — already exported from SyncModule

**New Components**:
- BE: `CursorsController`, query/response DTOs, `CursorsModule`
- BE: `findMany` method on cursor repository port + implementation
- FE: `cursors.api.ts`, `cursors.types.ts`, `cursors.query-keys.ts`, `use-cursors-query.ts`, `cursors-list-page.tsx`, `cursors.route.tsx`

---

## 4. Questions & Assumptions

### Assumptions
- Cursor count is small (tens per connection, not thousands) — no need for cursor-based pagination; offset pagination is sufficient
- `updatedAt` from the ORM entity is reliable for "last advanced" timestamp
- No detail page needed for MVP — list view shows all relevant info

---

## 5. Proposed Implementation Plan

### Phase 1: Backend — Extend Repository Port & Implementation

**Step 1.1**: Add `findMany` to `ConnectionCursorRepositoryPort`
- **File**: `libs/core/src/sync/domain/ports/connection-cursor-repository.port.ts`
- **Action**: Add `findMany(filters?: { connectionId?: string }, pagination?: { limit: number; offset: number }): Promise<{ items: ConnectionCursor[]; total: number }>`
- **Also**: Define `ConnectionCursor` domain type in `libs/core/src/sync/domain/types/connection-cursor.types.ts` with fields: `connectionId`, `cursorKey`, `value`, `createdAt`, `updatedAt`

**Step 1.2**: Implement `findMany` in `ConnectionCursorRepository`
- **File**: `libs/core/src/sync/infrastructure/persistence/repositories/connection-cursor.repository.ts`
- **Action**: Add `findMany` with TypeORM `findAndCount`, filter by `connectionId` if provided, order by `updatedAt DESC`

**Step 1.3**: Export new types from sync index
- **File**: `libs/core/src/sync/index.ts`
- **Action**: Export `ConnectionCursor` type and updated port

### Phase 2: Backend — Cursors Controller & Module

**Step 2.1**: Create response DTO
- **File**: `apps/api/src/cursors/http/dto/cursor-response.dto.ts`
- **Action**: `CursorResponseDto` with `connectionId`, `cursorKey`, `value`, `updatedAt` (ISO 8601)

**Step 2.2**: Create paginated response DTO
- **File**: `apps/api/src/cursors/http/dto/paginated-cursors-response.dto.ts`
- **Action**: `PaginatedCursorsResponseDto` wrapping `items`, `total`, `limit`, `offset`

**Step 2.3**: Create list query DTO
- **File**: `apps/api/src/cursors/http/dto/list-cursors-query.dto.ts`
- **Action**: Optional `connectionId` (UUID), `limit` (default 20, max 100), `offset` (default 0)

**Step 2.4**: Create CursorsController
- **File**: `apps/api/src/cursors/http/cursors.controller.ts`
- **Action**: `@Roles('admin')`, `@ApiTags('cursors')`, `@Controller('cursors')`
  - `GET /` — list cursors with filters
  - `GET /:connectionId/:cursorKey` — single cursor detail
- **Pattern**: Follow `InventoryController` exactly

**Step 2.5**: Create CursorsModule
- **File**: `apps/api/src/cursors/cursors.module.ts`
- **Action**: Import `SyncModule` (provides `CONNECTION_CURSOR_REPOSITORY_TOKEN`), declare controller

**Step 2.6**: Register in AppModule
- **File**: `apps/api/src/app.module.ts`
- **Action**: Add `CursorsModule` to imports

### Phase 3: Backend — Unit Tests

**Step 3.1**: Test CursorsController
- **File**: `apps/api/src/cursors/http/cursors.controller.spec.ts`
- **Action**: Mock `ConnectionCursorRepositoryPort`, test list with/without filters, test detail found/not-found

### Phase 4: Frontend — API Layer

**Step 4.1**: Define types
- **File**: `apps/web/src/features/cursors/api/cursors.types.ts`
- **Action**: `Cursor`, `CursorFilters`, `CursorPagination`, `PaginatedCursors` — mirror BE DTOs

**Step 4.2**: Create API client
- **File**: `apps/web/src/features/cursors/api/cursors.api.ts`
- **Action**: `createCursorsApi(request)` with `list(filters, pagination)` method

**Step 4.3**: Create query keys
- **File**: `apps/web/src/features/cursors/api/cursors.query-keys.ts`
- **Action**: `cursorsQueryKeys.all`, `.list(filters, pagination)`

**Step 4.4**: Create query hook
- **File**: `apps/web/src/features/cursors/hooks/use-cursors-query.ts`
- **Action**: `useCursorsQuery(filters, pagination)` — standard pattern

**Step 4.5**: Register in API client
- **File**: `apps/web/src/app/api/api-client.ts`
- **Action**: Add `cursors: createCursorsApi(request)` to `ApiClient`

### Phase 5: Frontend — Cursors Page

**Step 5.1**: Build cursors list page
- **File**: `apps/web/src/pages/cursors/cursors-list-page.tsx`
- **Action**: Follow `InventoryListPage` pattern
  - Filter: `connectionId` (debounced text input)
  - Columns: `cursorKey`, `value` (mono), `connectionId` (mono), `updatedAt` (relative time)
  - Pagination: offset-based, 20 per page
  - States: loading → error → empty → data

**Step 5.2**: Create route
- **File**: `apps/web/src/app/routes/cursors.route.tsx`
- **Action**: `path: 'cursors'`, index → `CursorsListPage`

**Step 5.3**: Register route
- **File**: `apps/web/src/app/routes/root.route.tsx`
- **Action**: Add `cursorsRoute` to children

**Step 5.4**: Add nav link (if sidebar exists)
- Check existing nav and add "Cursors" under Operations section

---

## 6. Alternatives Considered

### Alternative: Expose cursors as sub-resource of connections (`GET /connections/:id/cursors`)
- **Why Rejected**: Cursors span multiple connections in the list view; a top-level `/cursors` endpoint with optional `connectionId` filter is more flexible and matches the existing pattern (sync jobs also have a top-level endpoint with connection filter).

---

## 7. Testing Strategy

### Unit Tests
- `CursorsController`: mock repository, test list/detail endpoints, test 404

### Manual Testing
- Start dev API + web, verify cursor list loads, filter works, pagination works, empty state shows

### Acceptance Criteria
- [ ] `GET /cursors` returns paginated list with `connectionId`, `cursorKey`, `value`, `updatedAt`
- [ ] `GET /cursors?connectionId=X` filters correctly
- [ ] `GET /cursors/:connectionId/:cursorKey` returns single cursor or 404
- [ ] Swagger documents all endpoints
- [ ] Frontend page shows cursor list with connection filter
- [ ] Frontend handles loading, error, empty states
- [ ] Frontend pagination works
- [ ] Quality gate passes (lint, type-check, test)

---

## 8. Alignment Checklist

- [x] Follows hexagonal architecture (port extension in domain, implementation in infrastructure)
- [x] Respects CORE vs Integration boundaries (no integration code touched)
- [x] Uses existing patterns (mirrors InventoryController, InventoryListPage)
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Testing strategy complete
- [x] Plan is execution-ready
