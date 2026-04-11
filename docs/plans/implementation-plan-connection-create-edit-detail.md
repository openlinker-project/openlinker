# Implementation Plan: Connection Create/Edit Flows & Detail Page

**Date**: 2026-04-11  
**Status**: Draft  
**Issues**: #62, #63  
**Estimated Effort**: ~6 hours

---

## 1. Task Summary

**Objective**: Complete the connection management UI — allow operators to create, edit, disable, and inspect connections from the frontend.

**Context**: The connections list page and adapter catalog were just shipped (#128). The backend CRUD API is fully implemented (`POST`, `GET`, `PATCH`, `PATCH :id/disable`, diagnostics). The frontend has the create form and a skeleton detail page. What's missing: update mutation, disable mutation+API method, edit form, enriched detail page with config/diagnostics/actions.

**Classification**: Frontend (Interface layer — `apps/web`)

---

## 2. Scope & Non-Goals

### In Scope
- **#62**: Edit connection form (name, config, adapterKey), disable connection action with confirmation, validation and error handling, success UX
- **#63**: Connection detail page with: overview panel, config display, diagnostics/health panel (using existing diagnostics API), actions area (edit link, disable button)

### Out of Scope
- Credential management (#64) — `credentialsRef` is read-only on edit
- Connection health checks / validation endpoint
- Platform-specific onboarding wizards (#67)
- Status change to `active` from `error` (requires backend changes)

### Constraints
- Must follow existing frontend patterns (form schema, mutation hooks, page layout)
- Backend API is complete — no backend changes needed
- `platformType` and `credentialsRef` are immutable after creation

---

## 3. Architecture Mapping

**Target Layer**: Frontend (`apps/web/src/`)

**Existing Services Reused**:
- `connections.api.ts` — add `disable` method
- `connections.query-keys.ts` — already complete
- `use-connection-query.ts`, `use-connection-diagnostics-query.ts` — for detail page
- All shared UI components (PageLayout, FormField, Button, Alert, ConfirmDialog, StatusBadge, etc.)

**New Components Required**:
- `use-update-connection-mutation.ts` — mutation hook
- `use-disable-connection-mutation.ts` — mutation hook
- `EditConnectionForm.tsx` + `edit-connection.schema.ts` — edit form + validation
- `ConnectionConfigPanel.tsx` — JSON config display
- `ConnectionDiagnosticsPanel.tsx` — health/diagnostics display
- `ConnectionActionsPanel.tsx` — edit + disable actions
- `edit-connection.route.tsx` — new route `/connections/:connectionId/edit`
- `edit-connection-page.tsx` — page composition

---

## 4. Internal Patterns

**Similar Implementations Found**:
- `CreateConnectionForm.tsx` — exact pattern to follow for edit form (RHF + Zod + mutation + toast)
- `create-connection.schema.ts` — schema pattern to reuse/adapt
- `use-create-connection-mutation.ts` — mutation hook pattern
- `connection-detail-page.tsx` — skeleton to enrich
- `connections-list-page.test.tsx` — test pattern with `renderWithProviders`

---

## 5. Questions & Assumptions

### Assumptions
- `platformType` and `credentialsRef` are immutable after creation (shown read-only on edit form)
- Edit form pre-populates from the existing connection data via `useConnectionQuery`
- Disable action uses `PATCH /connections/:id/disable` (not `PATCH` with `status: 'disabled'`)
- Diagnostics panel shows `lastSucceededAt`, `lastFailedAt`, `recentErrors`, and `recentJobs` table
- Config panel displays JSON in a read-only `<pre>` block (editing config is done via the edit form)

---

## 6. Proposed Implementation Plan

### Phase 1: API Layer & Mutation Hooks

**Goal**: Complete the data layer needed by the UI.

1. **Add `disable` method to connections API**
   - **File**: `features/connections/api/connections.api.ts`
   - **Action**: Add `disable(connectionId: string): Promise<Connection>` method calling `PATCH /connections/{id}/disable`
   - **Also**: Update `ConnectionsApi` interface
   - **Acceptance**: Type-checks, method exists on apiClient

2. **Create `use-update-connection-mutation` hook**
   - **File**: `features/connections/hooks/use-update-connection-mutation.ts`
   - **Action**: Mutation hook wrapping `apiClient.connections.update(connectionId, input)`, invalidates `connectionsQueryKeys.all`
   - **Acceptance**: Hook compiles, invalidates cache on success

3. **Create `use-disable-connection-mutation` hook**
   - **File**: `features/connections/hooks/use-disable-connection-mutation.ts`
   - **Action**: Mutation hook wrapping `apiClient.connections.disable(connectionId)`, invalidates `connectionsQueryKeys.all`
   - **Acceptance**: Hook compiles, invalidates cache on success

### Phase 2: Edit Connection Flow (#62)

**Goal**: Working edit form accessible from the detail page.

4. **Create edit connection Zod schema**
   - **File**: `features/connections/components/edit-connection.schema.ts`
   - **Action**: Schema with `name` (required), `configText` (valid JSON), `adapterKey` (optional). Export `EditConnectionFormValues`, `EditConnectionFormSubmission`, `toUpdateConnectionInput()`.
   - **Acceptance**: Schema validates correctly, transforms to `UpdateConnectionInput`

5. **Create `EditConnectionForm` component**
   - **File**: `features/connections/components/EditConnectionForm.tsx`
   - **Action**: RHF form pre-populated with connection data. Shows `platformType` and `credentialsRef` as read-only fields. Editable: `name`, `configText`, `adapterKey`. Uses `useUpdateConnectionMutation`. Toast on success, Alert on API error, FormErrorSummary on validation errors.
   - **Props**: `connection: Connection` (the current connection to edit)
   - **Acceptance**: Form renders with pre-filled values, submits PATCH, shows feedback

6. **Create edit connection page**
   - **File**: `pages/connections/edit-connection-page.tsx`
   - **Action**: Page with `PageLayout`, fetches connection via `useConnectionQuery`, renders `EditConnectionForm`. Handles loading/error/empty states.
   - **Acceptance**: Page loads connection and renders edit form

7. **Create edit connection route**
   - **File**: `app/routes/edit-connection.route.tsx`
   - **Action**: Route at `connections/:connectionId/edit` pointing to `EditConnectionPage`
   - **Also**: Register in `root.route.tsx`
   - **Acceptance**: Navigation to `/connections/:id/edit` renders the edit page

### Phase 3: Connection Detail Page (#63)

**Goal**: Enriched detail page with config, diagnostics, and actions.

8. **Create `ConnectionConfigPanel` component**
   - **File**: `features/connections/components/ConnectionConfigPanel.tsx`
   - **Action**: Panel displaying config JSON in a styled `<pre>` block with monospace text. Shows "No configuration" empty state if config is empty.
   - **Acceptance**: Renders JSON readably

9. **Create `ConnectionDiagnosticsPanel` component**
   - **File**: `features/connections/components/ConnectionDiagnosticsPanel.tsx`
   - **Action**: Panel using `useConnectionDiagnosticsQuery`. Shows `lastSucceededAt`/`lastFailedAt` timestamps, `recentErrors` list, `recentJobs` in a small DataTable (jobType, status, attempts, lastError, updatedAt). Handles loading/error states.
   - **Acceptance**: Diagnostics data renders, loading/error handled

10. **Create `ConnectionActionsPanel` component**
    - **File**: `features/connections/components/ConnectionActionsPanel.tsx`
    - **Action**: Panel with "Edit connection" link (`/connections/:id/edit`), "Disable connection" button (danger tone) with `ConfirmDialog`. Uses `useDisableConnectionMutation`. Disable button hidden when connection already disabled. Toast on success.
    - **Props**: `connection: Connection`
    - **Acceptance**: Edit navigates, disable shows confirmation, executes mutation, toasts

11. **Enrich `ConnectionDetailPage`**
    - **File**: `pages/connections/connection-detail-page.tsx`
    - **Action**: Replace placeholder panels with: overview panel (existing, refined), `ConnectionConfigPanel`, `ConnectionDiagnosticsPanel`, `ConnectionActionsPanel`. Add "Edit" link in page actions. Update title to show connection name.
    - **Acceptance**: Detail page shows all 4 panels with real data

### Phase 4: Tests

12. **Test edit connection form**
    - **File**: `features/connections/components/EditConnectionForm.test.tsx`
    - **Action**: Tests: renders pre-filled values, submits update, shows validation errors, shows API error, read-only fields not editable
    - **Acceptance**: All tests pass

13. **Test connection detail page**
    - **File**: `pages/connections/connection-detail-page.test.tsx`
    - **Action**: Tests: renders connection data, shows diagnostics, shows config, edit link navigates, disable button works with confirmation
    - **Acceptance**: All tests pass

14. **Update test utils if needed**
    - **File**: `test/test-utils.ts`
    - **Action**: Add `disable` to mock API client if not already present, add `sampleConnectionDiagnostics` fixture
    - **Acceptance**: Mock API complete for new methods

---

## 7. Alternatives Considered

### Alternative: Inline editing on detail page (no separate edit route)
- **Why Rejected**: The create form already uses a full-page form pattern. Inline editing adds complexity (toggle states, partial saves) for little benefit at MVP stage. A separate edit page is consistent with the existing create flow.

### Alternative: Tabs on detail page
- **Why Rejected**: No existing tab component in shared UI. Using panels in a grid layout is consistent with the existing detail page skeleton and dashboard patterns. Tabs can be added later if needed.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ All new code lives in `apps/web/src/` (frontend only)
- ✅ Follows `pages` → `features` → `shared` dependency direction
- ✅ Server state via TanStack Query, form state via RHF

### Naming Conventions
- ✅ Components: `PascalCase.tsx`
- ✅ Hooks: `use-*.ts`
- ✅ Routes: `*.route.tsx`
- ✅ Schemas: `*.schema.ts`
- ✅ Tests: `*.test.tsx`

### Risks
- **Diagnostics endpoint may be slow**: Mitigated by separate query hook with independent loading state
- **Config JSON could be large**: `<pre>` block with `overflow: auto` and max-height

### Backward Compatibility
- ✅ No breaking changes — only additions to existing pages and new files

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `EditConnectionForm.test.tsx` — form rendering, submission, validation, API errors
- `connection-detail-page.test.tsx` — page composition, all panels render, actions work

### Mocking Strategy
- Mock API client via `createMockApiClient()` with `update`, `disable`, `getDiagnostics` methods

### Acceptance Criteria
- [ ] Create connection flow unchanged (no regression)
- [ ] Edit form pre-fills from existing connection, submits PATCH, shows success toast
- [ ] Disable button shows confirmation dialog, disables connection, shows success toast
- [ ] Detail page shows overview, config, diagnostics, and actions panels
- [ ] All states handled: loading, error, empty, success
- [ ] `pnpm lint && pnpm type-check && pnpm test` passes

---

## 10. Alignment Checklist

- [x] Follows frontend architecture conventions
- [x] Uses existing patterns (form schema, mutation hooks, page layout)
- [x] No unnecessary abstractions
- [x] Error handling comprehensive (API errors, validation, empty states)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
