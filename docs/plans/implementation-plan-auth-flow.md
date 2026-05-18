# Implementation Plan: Build Authentication Flow (FE-006)

**Date**: 2026-03-28
**Status**: Ready for Review
**Issue**: [#59](https://github.com/openlinker-project/openlinker/issues/59)
**Estimated Effort**: 1–2 days

---

## 1. Task Summary

**Objective**: Build the complete frontend authentication flow — login page, logout, route guarding, session persistence, and current-user bootstrap — wiring the existing `SessionAdapter` abstraction to the real JWT backend.

**Context**: The backend auth API (`POST /auth/login`, `GET /auth/me`) is fully implemented. The frontend has a session adapter pattern with `SessionProvider`, `useSession()`, and `ApiClient` auth-header injection already in place, but currently wired to a `NoopSessionAdapter`. This task replaces the noop with a real `JwtBearerSessionAdapter`, adds a login page, protects routes, and adds logout.

**Classification**: Frontend

---

## 2. Scope & Non-Goals

### In Scope
- `JwtBearerSessionAdapter` implementation (token storage, session bootstrap via `/auth/me`)
- Auth API module (`auth.api.ts`) with login endpoint
- Login page with form (React Hook Form + Zod)
- Route guard: redirect anonymous users to `/login`
- Redirect authenticated users away from `/login`
- Logout action in the AppShell top bar
- Update `SessionUser` type to include `username` (matching backend contract)
- Unit tests for adapter, hook, form, and route guard logic
- CSS for login page (reusing existing design tokens)

### Out of Scope
- Token refresh / refresh tokens (backend issues single JWT, default 1-day expiry)
- Registration / forgot password flows
- Role-based access control (backend doesn't return roles yet)
- Backend changes (auth API is complete)
- Integration tests (no Docker-based FE integration tests in the current setup)

### Constraints
- Must use the existing `SessionAdapter` interface boundary — storage decisions stay behind the adapter
- Must follow frontend architecture: TanStack Query for server state, RHF + Zod for forms
- Must reuse existing shared UI primitives (`Button`, `Input`, `FormField`, `Alert`, etc.)
- No general-purpose global store

---

## 3. Architecture Mapping

**Target Layer**: Frontend (`apps/web/src/`)

**Layers Touched**:
- `shared/auth/` — session adapter, types (extend existing)
- `features/auth/` — new feature slice (API, hooks, components)
- `pages/auth/` — login page composition
- `app/` — router, layouts, providers (modify existing)
- `shared/ui/` — no new primitives needed; existing set is sufficient

**Existing Services Reused**:
- `SessionProvider` + `SessionContext` + `useSession()` — session state management
- `ApiClient` with auth-header injection — already calls `sessionAdapter.getAccessToken()`
- `ApiError` with `isUnauthorized()` — error classification
- Shared UI: `Button`, `Input`, `FormField`, `FieldError`, `FormErrorSummary`, `Alert`, `LoadingState`
- `useToast()` — feedback on logout
- `PageLayout` — page composition wrapper

**New Components Required**:
- `JwtBearerSessionAdapter` — real session adapter
- `auth.api.ts` + `auth.types.ts` — auth API module
- `use-login.ts` — login mutation hook
- `LoginForm.tsx` + `login-form.schema.ts` — login form
- `LoginPage.tsx` — page composition
- `login.route.tsx` — route definition
- `GuestLayout.tsx` — minimal layout for unauthenticated pages

**Core vs Integration Justification**: N/A — this is purely frontend, no backend CORE/Integration boundary changes.

---

## 4. Internal Patterns (Research)

### Similar Implementations Found

**Form pattern** (`features/connections/components/create-connection-form.tsx`):
- Zod schema in separate file → `zodResolver` in `useForm()`
- `form.handleSubmit()` wraps async submit
- `FormErrorSummary` for validation errors, `Alert` for API errors
- Toast on success

**API module pattern** (`features/connections/api/connections.api.ts`):
- Interface + factory function receiving `request` from `ApiClient`
- Types in separate `*.types.ts` file

**Mutation hook pattern** (`features/connections/hooks/use-create-connection-mutation.ts`):
- `useMutation()` with `mutationFn` calling API client
- `onSuccess` invalidates relevant query cache

**Provider wiring** (`app/providers/app-providers.tsx`):
- Session adapter created via `useMemo()`, passed to both `SessionProvider` and `createApiClient()`

### Backend API Contract

```
POST /auth/login
  Request:  { username: string, password: string }
  Response: { access_token: string }
  Errors:   400 (validation), 401 (invalid credentials)

GET /auth/me
  Headers:  Authorization: Bearer {token}
  Response: { id: string, username: string, email: string | null }
  Errors:   401 (unauthorized)
```

---

## 5. Questions & Assumptions

### Assumptions (Safe Defaults)

| # | Assumption | Rationale |
|---|-----------|-----------|
| A1 | Use `localStorage` for JWT persistence behind the adapter boundary | Frontend architecture doc permits this as long as it's hidden behind `SessionAdapter`. Can be swapped to HttpOnly cookies later without touching consuming code. |
| A2 | `SessionUser.username` should be added to the type | Backend returns `username` — the FE type currently omits it. Adding it is non-breaking. |
| A3 | `SessionUser.roles` stays as `string[]` (empty array for now) | Backend doesn't return roles yet. Keeping the field future-proofs the type. |
| A4 | The adapter should NOT expose a `login()` method | Login is a feature-level concern (calls API, then persists token). The adapter stays focused on storage/retrieval. The login mutation writes directly to `localStorage` via a thin adapter method `persistSession()`. |
| A5 | `persistSession(token: string)` is added to `SessionAdapter` | Needed so the login flow can store the token. The noop adapter's implementation is a no-op. |
| A6 | Global 401 interception is deferred | Automatic redirect on 401 from any API call is useful but out of scope — can be added later via a TanStack Query `onError` default or fetch interceptor. |
| A7 | Login page uses a centered card layout, not the full AppShell | Standard pattern for auth screens — minimal chrome, focused form. |

### Open Questions
- **Q1**: Should the login page display the OpenLinker brand/logo? **Default**: Yes, simple text brand heading (consistent with sidebar brand).
- **Q2**: Should failed login show a toast or inline error? **Default**: Inline `Alert` component above the form (not a toast), since the user is still on the same page.

### Documentation Gaps
- None blocking — `frontend-architecture.md` section "Auth And Session" describes the exact adapter pattern we're implementing.

---

## 6. Proposed Implementation Plan

### Phase 1: Session Layer (types + adapter)
**Goal**: Replace the noop adapter with a real JWT adapter. After this phase, the app bootstraps session from a stored JWT.

#### Step 1.1: Update `SessionUser` type
- **File**: `apps/web/src/shared/auth/session.types.ts`
- **Action**: Add `username: string` to `SessionUser` interface
- **Acceptance**: Type compiles, no runtime changes yet

#### Step 1.2: Extend `SessionAdapter` interface
- **File**: `apps/web/src/shared/auth/session-adapter.ts`
- **Action**: Add `persistSession(token: string): Promise<void>` to the interface
- **Acceptance**: Interface compiles. This is needed so the login flow can write the token.

#### Step 1.3: Update `NoopSessionAdapter`
- **File**: `apps/web/src/shared/auth/noop-session-adapter.ts`
- **Action**: Add no-op `persistSession()` method to satisfy updated interface
- **Acceptance**: No behavioral change; app still works as before

#### Step 1.4: Create `JwtBearerSessionAdapter`
- **File**: `apps/web/src/shared/auth/jwt-bearer-session-adapter.ts`
- **Action**: Implement `SessionAdapter` with:
  - `getAccessToken()` → reads token from `localStorage`
  - `getSession()` → reads token, calls `GET /auth/me` via a passed `fetchFn`, maps response to `Session` with `SessionUser`. If token is missing or `/auth/me` fails (401), returns `ANONYMOUS_SESSION`.
  - `persistSession(token)` → writes token to `localStorage`
  - `clearSession()` → removes token from `localStorage`
  - Storage key: `ol_access_token`
  - Constructor accepts `{ baseUrl: string; fetchFn?: typeof fetch }` so it doesn't depend on `ApiClient` (avoids circular dependency — `ApiClient` depends on adapter, adapter must not depend on `ApiClient`)
- **Acceptance**: Unit test — `getSession()` with valid token returns authenticated session; with no token returns anonymous; with expired/invalid token (401 from `/auth/me`) returns anonymous and clears stored token.

#### Step 1.5: Wire `JwtBearerSessionAdapter` in `AppProviders`
- **File**: `apps/web/src/app/providers/app-providers.tsx`
- **Action**: Replace `createNoopSessionAdapter()` with `createJwtBearerSessionAdapter({ baseUrl: env.VITE_API_BASE_URL })`. Keep `createNoopSessionAdapter` as-is (useful for tests).
- **Acceptance**: App loads. Without a stored token, session resolves to anonymous. `isReady` becomes `true` after bootstrap.

---

### Phase 2: Auth Feature Slice (API + mutation hook)
**Goal**: Create the auth feature module with login API call and mutation hook.

#### Step 2.1: Create auth types
- **File**: `apps/web/src/features/auth/api/auth.types.ts`
- **Action**: Define:
  ```typescript
  export interface LoginRequest {
    username: string;
    password: string;
  }
  export interface LoginResponse {
    access_token: string;
  }
  export interface MeResponse {
    id: string;
    username: string;
    email: string | null;
  }
  ```
- **Acceptance**: Types compile and match backend DTOs

#### Step 2.2: Create auth API module
- **File**: `apps/web/src/features/auth/api/auth.api.ts`
- **Action**: Follow the `connections.api.ts` pattern. Define a local `ApiRequest` interface (same as in `connections.api.ts`) to type the `request` function parameter:
  ```typescript
  interface ApiRequest {
    <T>(path: string, init?: RequestInit): Promise<T>;
  }
  export interface AuthApi {
    login: (input: LoginRequest) => Promise<LoginResponse>;
  }
  export function createAuthApi(request: ApiRequest): AuthApi { ... }
  ```
- **Acceptance**: Module exports compile

#### Step 2.3: Register auth API on `ApiClient`
- **File**: `apps/web/src/app/api/api-client.ts`
- **Action**: Add `auth: AuthApi` to `ApiClient` interface and wire `createAuthApi(request)` in the factory
- **Acceptance**: `apiClient.auth.login()` callable

#### Step 2.4: Update test utilities for new `auth` API sub-client
- **File**: `apps/web/src/test/test-utils.tsx`
- **Action**: The `DeepPartialApiClient` type and `createMockApiClient()` must include the new `auth` property so that the returned mock satisfies the `ApiClient` interface. Without this, **all existing tests using `createMockApiClient()` will break**.
  ```typescript
  // In DeepPartialApiClient:
  auth?: Partial<ApiClient['auth']>;

  // In createMockApiClient:
  auth: {
    login: vi.fn().mockResolvedValue({ access_token: 'mock-jwt-token' }),
    ...overrides.auth,
  } as ApiClient['auth'],
  ```
  Also extend `RenderWithProvidersOptions` to accept an optional `sessionAdapter` so that layout/guard tests can render with authenticated vs anonymous session states:
  ```typescript
  interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
    apiClient?: ApiClient;
    route?: string;
    sessionAdapter?: SessionAdapter;
  }
  ```
  And use it in the wrapper:
  ```typescript
  <SessionProvider adapter={sessionAdapter ?? createNoopSessionAdapter()}>
  ```
  Add a helper factory for tests that need an authenticated session:
  ```typescript
  export function createAuthenticatedSessionAdapter(
    user: SessionUser = { id: 'user_1', username: 'admin', email: 'admin@example.com', roles: [] },
  ): SessionAdapter {
    const token = 'test-jwt-token';
    return {
      async getSession() {
        return { status: 'authenticated', accessToken: token, user };
      },
      async getAccessToken() {
        return token;
      },
      async persistSession() {},
      async clearSession() {},
    };
  }
  ```
- **Acceptance**: All existing tests pass unchanged. New tests can use `sessionAdapter` option and `createAuthenticatedSessionAdapter()` to test authenticated/anonymous states.

#### Step 2.5: Create `useLogin` mutation hook
- **File**: `apps/web/src/features/auth/hooks/use-login.ts`
- **Action**: Implement a hook that:
  1. Calls `apiClient.auth.login(credentials)`
  2. On success, calls `adapter.persistSession(response.access_token)`
  3. Calls `refreshSession()` to re-bootstrap session from token
  4. Returns the `useMutation` result
- **Note**: This hook needs access to both `useApiClient()` and `useSession()`.
- **Acceptance**: Unit test — successful login persists token and triggers session refresh. Failed login (401) surfaces error.

---

### Phase 3: Login Page (UI)
**Goal**: Build the login page with form validation and error handling.

#### Step 3.1: Create login form schema
- **File**: `apps/web/src/features/auth/components/login-form.schema.ts`
- **Action**: Zod schema:
  ```typescript
  export const loginFormSchema = z.object({
    username: z.string().trim().min(1, 'Username is required'),
    password: z.string().min(1, 'Password is required'),
  });
  ```
- **Acceptance**: Schema validates correctly

#### Step 3.2: Create `LoginForm` component
- **File**: `apps/web/src/features/auth/components/LoginForm.tsx`
- **Action**: Form component using RHF + Zod following the `create-connection-form.tsx` pattern:
  - Two fields: username (`Input`), password (`Input` type="password")
  - Submit button (`Button` tone="primary") with loading state
  - `Alert` for API errors (e.g., "Invalid credentials")
  - `FormErrorSummary` for client-side validation errors
  - Calls `useLogin()` mutation on submit
  - On success: navigation happens via the route guard (session becomes authenticated → redirect away from `/login`)
- **Acceptance**: Renders correctly, validates fields, shows errors, submits to API

#### Step 3.3: Create `GuestLayout`
- **File**: `apps/web/src/app/layouts/guest-layout.tsx`
- **Action**: Minimal centered layout for unauthenticated pages:
  - Centered card container (vertically + horizontally)
  - OpenLinker brand heading
  - `<Outlet />` for child content
  - Redirect authenticated users to `/` (check `useSession()` — if authenticated and ready, `<Navigate to="/" replace />`)
- **Acceptance**: Renders centered content. Authenticated users are redirected away.

#### Step 3.4: Create `LoginPage`
- **File**: `apps/web/src/pages/auth/LoginPage.tsx`
- **Action**: Page composition:
  - Title/subtitle text
  - Renders `<LoginForm />`
  - No `PageLayout` (login uses the custom `GuestLayout` instead of the standard operator page shell)
- **Acceptance**: Renders login form inside guest layout

#### Step 3.5: Create login route
- **File**: `apps/web/src/app/routes/login.route.tsx`
- **Action**: Route definition:
  ```typescript
  export const loginRoute: RouteObject = {
    path: '/login',
    element: <GuestLayout />,
    children: [{ index: true, element: <LoginPage /> }],
  };
  ```
- **Acceptance**: `/login` renders the login page

#### Step 3.6: Register login route in router
- **File**: `apps/web/src/app/router.tsx`
- **Action**: Add `loginRoute` as a sibling to `rootRoute` in the `createBrowserRouter` array
- **Acceptance**: Both `/login` and `/` (with children) are routable

#### Step 3.7: Add login page CSS
- **File**: `apps/web/src/index.css`
- **Action**: Add minimal styles for the guest/login layout:
  - `.guest-layout` — full viewport centered flex container
  - `.guest-card` — constrained-width card with existing token values
  - `.guest-brand` — brand heading styling
  - Reuse existing `.control`, `.form-field__*`, `.button` classes for form elements
- **Acceptance**: Login page looks clean and professional, consistent with design tokens

---

### Phase 4: Route Guarding
**Goal**: Protect authenticated routes and redirect unauthenticated users to login.

#### Step 4.1: Add route guard to `AuthenticatedAppLayout`
- **File**: `apps/web/src/app/layouts/authenticated-app-layout.tsx`
- **Action**: After `isReady` resolves, check `session.status`:
  - If `'anonymous'` → `<Navigate to="/login" replace />`
  - If `'authenticated'` → render `<AppShell>` with `<Outlet />`
  - While `!isReady` → render loading state (already exists)
- **Acceptance**: Unauthenticated users hitting `/` or any child route are redirected to `/login`. Authenticated users see the app normally.

---

### Phase 5: Logout
**Goal**: Add a logout action in the app shell.

#### Step 5.1: Add logout to AppShell topbar
- **File**: `apps/web/src/shared/ui/app-shell.tsx`
- **Action**: In the session status area of the topbar:
  - Show the current user's username (from `session.user.username`)
  - Add a logout button (`Button` tone="ghost", small)
  - On click: call `clearSession()` from `useSession()` — this clears localStorage and resets session to anonymous, which triggers the route guard redirect to `/login`
  - Show a toast on logout: `showToast({ tone: 'info', description: 'You have been logged out.' })`
- **Acceptance**: Clicking logout clears session, redirects to `/login`, shows feedback

---

### Phase 6: Tests
**Goal**: Unit tests for all new logic.

#### Step 6.1: Test `JwtBearerSessionAdapter`
- **File**: `apps/web/src/shared/auth/jwt-bearer-session-adapter.test.ts`
- **Tests**:
  - `should return ANONYMOUS_SESSION when no token stored`
  - `should return authenticated session when valid token stored and /auth/me succeeds`
  - `should return ANONYMOUS_SESSION and clear token when /auth/me returns 401`
  - `should persist token to localStorage on persistSession()`
  - `should clear token from localStorage on clearSession()`
  - `should return stored token from getAccessToken()`

#### Step 6.2: Test `LoginForm`
- **File**: `apps/web/src/features/auth/components/LoginForm.test.tsx`
- **Tests**:
  - `should render username and password fields`
  - `should show validation errors when submitting empty form`
  - `should call login mutation on valid submission`
  - `should display API error on failed login`
  - `should disable submit button while login is pending`

#### Step 6.3: Test `useLogin` hook
- **File**: `apps/web/src/features/auth/hooks/use-login.test.ts`
- **Tests**:
  - `should call auth API login and persist session on success`
  - `should call refreshSession after persisting token`
  - `should surface error on login failure`

#### Step 6.4: Test route guard behavior
- **File**: `apps/web/src/app/layouts/authenticated-app-layout.test.tsx`
- **Setup**: Use `renderWithProviders` with `sessionAdapter` option. Pass `createNoopSessionAdapter()` for anonymous tests and `createAuthenticatedSessionAdapter()` for authenticated tests.
- **Tests**:
  - `should redirect to /login when session is anonymous` (default noop adapter)
  - `should render children when session is authenticated` (use `createAuthenticatedSessionAdapter()`)
  - `should show loading state while session is not ready`

#### Step 6.5: Test `GuestLayout` redirect
- **File**: `apps/web/src/app/layouts/guest-layout.test.tsx`
- **Setup**: Same approach — use `sessionAdapter` option in `renderWithProviders`.
- **Tests**:
  - `should redirect to / when session is authenticated` (use `createAuthenticatedSessionAdapter()`)
  - `should render children when session is anonymous` (default noop adapter)

---

### Implementation Details

**New Components Summary**:

| Layer | File | Purpose |
|-------|------|---------|
| shared/auth | `jwt-bearer-session-adapter.ts` | Real JWT session adapter |
| features/auth/api | `auth.types.ts` | Login request/response types |
| features/auth/api | `auth.api.ts` | Auth API module |
| features/auth/hooks | `use-login.ts` | Login mutation hook |
| features/auth/components | `login-form.schema.ts` | Zod validation schema |
| features/auth/components | `LoginForm.tsx` | Login form component |
| pages/auth | `LoginPage.tsx` | Login page composition |
| app/layouts | `guest-layout.tsx` | Unauthenticated page layout |
| app/routes | `login.route.tsx` | Login route definition |

**Modified Files Summary**:

| File | Change |
|------|--------|
| `shared/auth/session.types.ts` | Add `username` to `SessionUser` |
| `shared/auth/session-adapter.ts` | Add `persistSession()` method |
| `shared/auth/noop-session-adapter.ts` | Add no-op `persistSession()` |
| `app/providers/app-providers.tsx` | Wire `JwtBearerSessionAdapter` |
| `app/api/api-client.ts` | Add `auth` API sub-client |
| `test/test-utils.tsx` | Add `auth` to mock API client, add `sessionAdapter` option and `createAuthenticatedSessionAdapter()` helper |
| `app/router.tsx` | Add login route |
| `app/layouts/authenticated-app-layout.tsx` | Add anonymous → `/login` redirect |
| `shared/ui/app-shell.tsx` | Add username display + logout button |
| `index.css` | Add guest layout styles |

**Configuration Changes**: None — no new env vars needed. Uses existing `VITE_API_BASE_URL`.

**Database Migrations**: None — backend is already complete.

**Error Handling**:
- Invalid credentials → `ApiError` with status 401 → shown as `Alert` in login form
- Network failure → `ApiError` with status 0 → shown as `Alert` in login form
- Expired token on bootstrap → `/auth/me` returns 401 → adapter clears token, returns anonymous → route guard redirects to login
- Validation errors → Zod + RHF handle client-side → `FormErrorSummary` + `FieldError`

---

## 7. Alternatives Considered

### Alternative 1: In-memory token only (no localStorage)
- **Description**: Store JWT only in React state — no persistence across page refreshes
- **Why Rejected**: Users would have to re-login on every page refresh or tab close. Unacceptable UX for an admin SPA.
- **Trade-offs**: More secure (no token in storage), but impractical for daily operator use.

### Alternative 2: Add `login()` to `SessionAdapter`
- **Description**: Put the full login flow (API call + persist + refresh) inside the adapter
- **Why Rejected**: Couples transport logic (API call) with storage logic. The adapter should only handle storage/retrieval. Login is a feature-level concern that coordinates API + adapter + session refresh.
- **Trade-offs**: Simpler consumer code, but violates single responsibility.

### Alternative 3: Global 401 interceptor with auto-redirect
- **Description**: Catch all 401 responses globally and redirect to `/login`
- **Why Rejected**: Useful but adds complexity. Can be added as a follow-up. The route guard already handles the primary case (anonymous session → redirect). A 401 during an authenticated session is an edge case (token expiry mid-session) that can be addressed later.
- **Trade-offs**: Better UX for token expiry, but risks redirect loops and is harder to test.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Session logic stays behind `SessionAdapter` boundary (per `frontend-architecture.md`)
- ✅ Server state via TanStack Query (`useLogin` mutation)
- ✅ Form state via React Hook Form + Zod
- ✅ Session state via `SessionProvider` (not a global store)
- ✅ Dependency direction: `app` → `pages` → `features` → `shared`
- ✅ No secrets in browser code (token is user's own JWT, not a system secret)

### Naming Conventions
- ✅ Components: `PascalCase.tsx` (`LoginForm.tsx`, `LoginPage.tsx`, `GuestLayout.tsx`)
- ✅ Hooks: `use-*.ts` (`use-login.ts`)
- ✅ Route modules: `*.route.tsx` (`login.route.tsx`)
- ✅ Tests: `*.test.tsx` / `*.test.ts`
- ✅ Types: `*.types.ts` (`auth.types.ts`)
- ✅ Schema: `*.schema.ts` (`login-form.schema.ts`)

### Existing Patterns
- ✅ API module follows `connections.api.ts` pattern (interface + factory)
- ✅ Mutation hook follows `use-create-connection-mutation.ts` pattern
- ✅ Form follows `create-connection-form.tsx` pattern (RHF + Zod + shared UI)
- ✅ Page follows `PageLayout` / layout composition pattern

### Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Token stored in localStorage is accessible to XSS | Medium | Standard risk for SPAs. Mitigate with CSP headers, input sanitization. Adapter boundary allows future swap to HttpOnly cookies. |
| Token expiry mid-session causes confusing 401s | Low | Out of scope for this task. Follow-up: add global 401 interceptor. |
| `getSession()` calls `/auth/me` on every page load | Low (performance) | Single lightweight GET request on bootstrap. Token is cached in memory after initial load via `SessionProvider` state. |
| Circular dependency: ApiClient ↔ SessionAdapter | Blocked | Avoided by design — adapter uses raw `fetch()` directly for `/auth/me`, not the `ApiClient`. |

### Edge Cases
- **No network on bootstrap**: `getSession()` fetch fails → returns anonymous → user sees login page → can retry
- **Corrupted token in localStorage**: `/auth/me` returns 401 → adapter clears token → anonymous session
- **Multiple tabs**: Token changes in one tab are not reflected in others. Acceptable for MVP — future improvement via `storage` event listener.
- **Login while already authenticated**: `GuestLayout` redirects to `/` → prevents re-login

### Backward Compatibility
- ✅ Adding `username` to `SessionUser` is non-breaking (additive)
- ✅ Adding `persistSession()` to `SessionAdapter` requires updating `NoopSessionAdapter` (done in Step 1.3)
- ✅ Adding `auth` to `ApiClient` is non-breaking (additive)
- ✅ Existing routes unchanged — only new route (`/login`) and guard logic added

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests

| Test file | What it tests |
|-----------|--------------|
| `jwt-bearer-session-adapter.test.ts` | Token persistence, session bootstrap, error handling |
| `LoginForm.test.tsx` | Form rendering, validation, submission, error display |
| `use-login.test.ts` | Mutation flow: API call → persist → refresh |
| `authenticated-app-layout.test.tsx` | Route guard: anonymous redirect, authenticated render |
| `guest-layout.test.tsx` | Reverse guard: authenticated redirect, anonymous render |

### Mocking Strategy
- Mock `fetch` for `JwtBearerSessionAdapter` tests (mock `/auth/me` responses)
- Mock `localStorage` for adapter tests
- Use `createMockApiClient({ auth: { login: ... } })` for login form/hook tests
- Use `createAuthenticatedSessionAdapter()` from `test-utils.tsx` for layout/guard tests that need authenticated state
- Use `renderWithProviders(ui, { sessionAdapter })` to control session state in render tests
- Use `MemoryRouter` (via `renderWithProviders`) for layout/route guard tests

### Acceptance Criteria
- [ ] Unauthenticated user visiting any route is redirected to `/login`
- [ ] Login form validates username and password (both required)
- [ ] Successful login redirects to `/` (dashboard)
- [ ] Invalid credentials show inline error message
- [ ] Page refresh after login preserves session (token in localStorage, `/auth/me` re-validates)
- [ ] Logout clears session and redirects to `/login`
- [ ] Authenticated user visiting `/login` is redirected to `/`
- [ ] Loading state shown while session bootstraps
- [ ] `pnpm lint`, `pnpm type-check`, and `pnpm test` pass with zero errors

**Reference**: [Testing Guide](../testing-guide.md)

---

## 10. Alignment Checklist

- [x] Follows frontend architecture (`frontend-architecture.md`)
- [x] Uses existing session adapter pattern (no new global stores)
- [x] Uses existing UI primitives (no unnecessary new components)
- [x] Server state via TanStack Query
- [x] Form state via React Hook Form + Zod
- [x] Error handling comprehensive (validation, API, network)
- [x] Testing strategy complete (5 test files, all new logic covered)
- [x] Naming conventions followed (FE standards)
- [x] File structure matches standards
- [x] Dependency direction enforced (`app` → `pages` → `features` → `shared`)
- [x] No secrets in browser code
- [x] Plan is execution-ready

---

## Related Documentation

- [Frontend Architecture](../frontend-architecture.md)
- [Frontend UI Style Guide](../frontend-ui-style-guide.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
