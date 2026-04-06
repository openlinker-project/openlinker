# Implementation Plan: Settings Page MVP

**Date**: 2026-04-06
**Status**: Ready for Review
**Estimated Effort**: 2–3 hours
**Issue**: [#104 — FE: Implement settings page](https://github.com/SilkSoftwareHouse/openlinker/issues/104)

---

## 1. Task Summary

**Objective**: Replace the settings page stub with an MVP that shows real environment metadata, current session/account info, and clearly labelled placeholder sections for future settings.

**Context**: `apps/web/src/pages/settings/settings-page.tsx` exists and is wired into the shell navigation as a "live" route but contains only architectural commentary as static text. Users landing on it see meaningless placeholder prose. The goal is to surface the data that is already available (build-time env vars and the current session context) without building features that have no backend support yet.

**Classification**: Frontend / Feature — `apps/web/src/pages/settings/`

---

## 2. Scope & Non-Goals

### In Scope

- Rewrite `settings-page.tsx` to display:
  - **Environment section**: `VITE_APP_ENV` and `VITE_API_BASE_URL` from `env.ts`
  - **Account section**: current user from `SessionProvider` — with loading, anonymous, and authenticated states
  - **Placeholder sections**: Notifications, Organization, Preferences — visible but clearly marked as upcoming
- Component test for `SettingsPage`

### Out of Scope

- Any new API endpoint or backend feature
- User profile editing or password change
- Notification preferences (backend not yet available)
- Organisation management
- Any TanStack Query usage — there are no async API calls on this page

### Constraints

- No external data fetching — data comes only from `env` (build-time) and `useSession()` (context)
- Must follow `docs/frontend-ui-style-guide.md` shell layout and density principles
- Must handle session loading state (`isReady=false`) even if the noop adapter resolves instantly

---

## 3. Architecture Mapping

**Target Layer**: `apps/web` — `pages/settings/`

**Capabilities Involved**: None (no ports, no API client, no mutations)

**Existing Services Reused**:
- `env` from `apps/web/src/shared/config/env.ts` — build-time config (`VITE_APP_ENV`, `VITE_API_BASE_URL`)
- `useSession()` from `apps/web/src/shared/auth/use-session.ts` — session context (`isReady`, `session`)
- `PageLayout` from `apps/web/src/shared/ui/page-layout.tsx` — standard page wrapper
- Shared UI: `LoadingState` from `feedback-state.tsx` (inline loading within account panel)

**New Components Required**:
- None beyond the rewritten page itself — all data is read from existing synchronous/context sources

**No feature module needed**: The page reads synchronous data from `env` and from the context tree. The `features/` layer is for API-backed vertical slices (hooks, mutations, query keys). A settings page that reads only env vars and session context does not qualify.

**Core vs Integration Justification**: N/A — this is frontend-only, no backend boundary interaction.

---

## 4. Internal Patterns Research

### Similar Implementations

**Dashboard page** (`pages/dashboard/dashboard-page.tsx`):
- Uses `PageLayout` with eyebrow, title, description, actions
- Multiple `panel panel--dense` articles in a `workspace-grid`
- Panel structure: `.panel__header` → `.section-title` + `.panel__meta` → content

**Connections detail page** (`pages/connections/connection-detail-page.tsx`):
- Inline loading within a panel (not full-page `LoadingState` when it's a secondary concern)
- Definition list (`<dl>`) pattern for key-value metadata display

**ModulePlaceholderPage** (`pages/placeholders/module-placeholder-page.tsx`):
- Designed for whole route placeholders — not appropriate here
- Inline "coming soon" panels should follow the `panel panel--dense` pattern with a `toolbar-chip` label, not a full-page `EmptyState`

### Existing Patterns

- **Session state consumption**: `const { session, isReady } = useSession()` — no `useEffect` or async needed in the page
- **Env display**: `env.VITE_APP_ENV`, `env.VITE_API_BASE_URL` — import directly, render as `.mono-text` for technical values per style guide
- **Loading state inline**: use a simple `<p className="muted-text">Loading session…</p>` within the account panel rather than full-page `LoadingState` — avoids jarring layout shifts since env info renders immediately

---

## 5. Questions & Assumptions

### Open Questions

- **`SessionUser.role` vs `roles`**: `session.types.ts` declares `role: string` but `test-utils.tsx` uses `roles: []`. This is likely a stale discrepancy in test-utils — **assumption**: `session.types.ts` is authoritative; use `session.user.role` in the UI. Verify before merging.

### Assumptions

- The noop session adapter resolves `isReady` synchronously in tests; the page handles `isReady=false` for correctness with future real adapters.
- Permissions list from `SessionUser.permissions[]` will be shown only if non-empty (it will be empty with the noop adapter).
- Future settings sections (notifications, org, preferences) render as inline panels with a `Coming soon` toolbar chip — no `EmptyState` component, just a short explanatory copy inside the panel body.
- Page-level summary toolbar shows chips labelling the sections present (Environment, Account, Future settings).

### Documentation Gaps

- `docs/frontend-ui-style-guide.md` defines the shell layout but does not specifically document how a "settings page with mixed live and coming-soon sections" should be structured — the plan infers from the dashboard and ModulePlaceholderPage patterns.

---

## 6. Proposed Implementation Plan

### Phase 1 — Rewrite the settings page

**Goal**: Replace architectural commentary with real, observable data.

**Step 1.1 — Rewrite `settings-page.tsx`**

- **File**: `apps/web/src/pages/settings/settings-page.tsx`
- **Action**:
  1. Import `env` from `../../shared/config/env`
  2. Import `useSession` from `../../shared/auth/use-session`
  3. Use `PageLayout` with `eyebrow="Settings"`, `title="Settings"`, and a `summary` toolbar showing section chips
  4. Render three sections inside a `workspace-grid`:

     **Section A — Environment** (`panel panel--dense`):
     - Header: eyebrow "Runtime", title "Environment", meta "Build-time config"
     - Two rows: `VITE_APP_ENV` and `VITE_API_BASE_URL`, values rendered in `.mono-text`
     - No loading state needed — data is synchronous

     **Section B — Account** (`panel panel--dense`):
     - Header: eyebrow "Session", title "Account", meta "Read-only"
     - Three sub-states driven by `isReady` and `session.status`:
       - `!isReady` → `<p className="muted-text">Loading session…</p>`
       - `status === 'anonymous'` → `<p className="muted-text">No active session.</p>`
       - `status === 'authenticated'` → definition list with username, email (or "—" if null), role, and permissions (if any)

     **Section C — Future Settings** (`panel panel--dense` × 3):
     - Notifications, Organization, Preferences panels
     - Each has a header with the section title and a `Coming soon` toolbar chip
     - Body: one sentence describing the planned purpose
     - No `EmptyState`, no link — just static informational copy

- **Acceptance**: Page renders without errors; env values are visible; session states render correctly per state; three placeholder sections visible with "Coming soon" chips.
- **Dependencies**: none

---

### Phase 2 — Component test

**Goal**: Verify all meaningful render states without reaching the network.

**Step 2.1 — Create `SettingsPage.test.tsx`**

- **File**: `apps/web/src/pages/settings/SettingsPage.test.tsx`
- **Action**: Write Vitest + Testing Library tests using `renderWithProviders`:

  | Test | Arrangement | Assertion |
  |------|-------------|-----------|
  | Shows env values | default noop adapter | `VITE_APP_ENV` value and `VITE_API_BASE_URL` text present |
  | Shows loading | custom adapter that returns a never-resolving promise | "Loading session" text present |
  | Shows anonymous state | default noop adapter (anonymous) | "No active session" text present |
  | Shows authenticated user | `createAuthenticatedSessionAdapter()` | username and email visible |
  | Shows placeholder sections | default | "Notifications", "Organization", "Preferences" headings present |

- **Pattern**: follows `connections-overview.test.tsx` exactly — `renderWithProviders` + `screen` queries
- **Acceptance**: `pnpm test` passes for this file; all 5 tests green

---

### Implementation Details

**Modified files**:
| File | Change |
|------|--------|
| `apps/web/src/pages/settings/settings-page.tsx` | Full rewrite |

**New files**:
| File | Purpose |
|------|---------|
| `apps/web/src/pages/settings/SettingsPage.test.tsx` | Component tests |

**No new CSS needed** — all structural classes (`workspace-grid`, `panel`, `panel--dense`, `panel__header`, `section-title`, `panel__meta`, `mono-text`, `muted-text`, `toolbar-chip`) already exist in `index.css`.

**No env var changes** — both `VITE_APP_ENV` and `VITE_API_BASE_URL` are already declared in `env.ts` and `.env.example`.

**No routing changes** — `/settings` route is already registered and working.

**No migration needed** — no backend changes.

---

## 7. Alternatives Considered

### Alternative 1: Separate feature module `features/settings/`

**Description**: Create a full feature slice with hooks and components even though there's no API call.

**Why Rejected**: The `features/` layer is for API-backed slices (TanStack Query, mutations, query keys). A page that reads only synchronous env config and context has no justified reason to go through that layer. Creating an empty feature module would add structural noise without benefit.

**Trade-offs**: Would align with the file structure pattern mechanically, but violates the principle of not adding unnecessary abstraction.

---

### Alternative 2: Use `ModulePlaceholderPage` for the whole page

**Description**: Render the whole settings page as a `ModulePlaceholderPage` until more backend features exist.

**Why Rejected**: The issue explicitly requires env and session data to be visible. `ModulePlaceholderPage` is designed for routes where there is zero real content. Here we have two real data sections.

---

### Alternative 3: Full-page `LoadingState` while `!isReady`

**Description**: Show `<LoadingState>` covering the whole page until session is ready.

**Why Rejected**: Environment info is synchronous and always available. Blocking the whole page on session resolution would cause an unnecessary flash and degrade perceived performance. Inline loading within the account panel is more appropriate.

---

## 8. Validation & Risks

### Architecture Compliance

- ✅ Page in `pages/` layer, reads from `shared/` — dependency direction satisfied
- ✅ No direct API call from the page — no `fetch` or `useApiClient` needed
- ✅ Session state via `SessionProvider` context — not copied to local state

### Naming Conventions

- ✅ Component file: `settings-page.tsx` (kebab, `.tsx`) — matches existing convention
- ✅ Test file: `SettingsPage.test.tsx` (PascalCase, `.test.tsx`) — matches `*.test.tsx` convention

### Existing Patterns

- ✅ `PageLayout` used consistently with other pages
- ✅ `panel panel--dense` structure follows dashboard page
- ✅ Test uses `renderWithProviders` with `sessionAdapter` option — existing pattern

### Risks

- **`SessionUser.role` discrepancy**: `test-utils.tsx` uses `roles: []` but the type says `role: string`. If `role` is missing from the session object at runtime, the UI would show `undefined`. **Mitigation**: check `session.user.role ?? '—'`; flag the type discrepancy in the PR for resolution.

### Edge Cases

- **`session.user.email` is `null`**: Render as `—` (em dash). Covered by `session.user.email ?? '—'`.
- **`session.user.permissions` is empty**: Omit the permissions row rather than showing an empty list.
- **`env.VITE_API_BASE_URL` is very long**: Wrap in `.mono-text` which has `overflow-wrap: break-word`; no truncation needed for an admin internal tool.

### Backward Compatibility

- ✅ No API contract changes
- ✅ No shared component changes
- ✅ Only the settings page stub is replaced — no regressions elsewhere

---

## 9. Testing Strategy & Acceptance Criteria

### Unit / Component Tests

**File**: `apps/web/src/pages/settings/SettingsPage.test.tsx`

| Test case | Adapter | Expected |
|-----------|---------|----------|
| Env info always visible | noop (default) | `development` text and `localhost:3000` text present |
| Loading state | never-resolving `getSession` | "Loading session" copy present |
| Anonymous state | noop (default — anonymous) | "No active session" copy present |
| Authenticated state | `createAuthenticatedSessionAdapter()` | `admin` username and `admin@example.com` email visible |
| Placeholder sections visible | noop (default) | "Notifications", "Organization", "Preferences" section titles present |

### Mocking Strategy

- No API mocking needed — the page makes no API calls
- Session state controlled via `sessionAdapter` option in `renderWithProviders`
- Env values are module-level constants from `env.ts`; they use `.env.example` defaults in test (no mock needed)

### Acceptance Criteria (from issue #104)

- [x] Settings page shows real environment and session data
- [x] Future sections are visible but clearly marked as upcoming
- [x] Follows shell layout from `docs/frontend-ui-style-guide.md`
- [x] Loading and error states handled for any async data (session `isReady` loading state)

### Quality Gate

```bash
pnpm lint        # zero errors
pnpm type-check  # zero errors
pnpm test        # SettingsPage.test.tsx passes
```

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (frontend dependency direction: `pages` → `shared`)
- [x] Respects CORE vs Integration boundaries (no boundary crossing — pure FE)
- [x] Uses existing patterns (no unnecessary abstractions)
- [x] Idempotency considered (N/A — no mutations)
- [x] Event-driven patterns used where applicable (N/A — read-only page)
- [x] Rate limits & retries addressed (N/A — no API calls)
- [x] Error handling comprehensive (session loading/anonymous/authenticated all handled)
- [x] Testing strategy complete (5 test cases covering all render states)
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Frontend Architecture](../frontend-architecture.md)
- [Frontend UI Style Guide](../frontend-ui-style-guide.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
