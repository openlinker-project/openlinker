# Implementation Plan: Allegro Onboarding Wizard (FE-011)

**Date**: 2026-04-06
**Status**: Ready for Review
**Estimated Effort**: 4–6 hours
**Issue**: [#66 — FE: Build Allegro onboarding wizard](https://github.com/SilkSoftwareHouse/openlinker/issues/66)

---

## 1. Task Summary

**Objective**: Turn the fully-implemented Allegro OAuth backend into a usable operator workflow. The wizard collects Allegro app credentials and a connection name, initiates the OAuth flow, handles the browser callback, and shows a success/failure result screen.

**Context**: The backend is complete — `POST /integrations/allegro/oauth/connect` and `GET /integrations/allegro/oauth/callback` both work. The FE has a placeholder callback page at `/integrations/allegro/connect/callback`, a registered route, and a wired `useStartAllegroOAuthMutation` hook. What's missing is the setup form, the callback handler, and the wiring between them.

**Classification**: Frontend / Feature — `apps/web/src/`

---

## 2. Scope & Non-Goals

### In Scope

- `AllegroSetupForm` — collects connection name, environment, client ID, client secret
- Calling `POST /integrations/allegro/oauth/connect` and redirecting the browser to the returned `authorizationUrl`
- `AllegroConnectCallbackPage` — reads `?code` and `?state` from the URL, calls the backend callback API, shows loading / success / error states
- New route `/connections/new/allegro` for the wizard entry point
- Redirect hint in the generic `CreateConnectionForm` when Allegro platform is selected
- FE API contract fix: add `clientId`/`clientSecret` to `StartAllegroOAuthInput`, add `handleCallback` to `AllegroApi`
- Tests for the setup form and callback page

### Out of Scope

- Any backend changes — all endpoints are already implemented
- Connection validation step (exists at `GET /integrations/allegro/connections/:id/validate`, deferred to #63)
- Redesigning the generic "New connection" page
- Allegro token refresh or expiry handling
- Support for multiple Allegro connections in the same wizard session

### Constraints

- No `clientId`/`clientSecret` may be embedded in FE code or env files — they are operator-entered at setup time
- `redirectUri` must use `window.location.origin` at runtime — cannot be a static env var because the FE domain varies per deployment
- The callback route `/integrations/allegro/connect/callback` already exists in the router and must not change

---

## 3. Architecture Mapping

**Target Layer**: `apps/web` — `features/allegro/`, `pages/connections/`, `pages/integrations/`

**Capabilities Involved**: None (no backend ports involved — purely FE orchestration of existing REST endpoints)

**Existing Services Reused**:
- `useStartAllegroOAuthMutation` hook (`features/allegro/hooks/`) — calls `POST /integrations/allegro/oauth/connect`
- `AllegroApi` + `createAllegroApi` (`features/allegro/api/allegro.api.ts`) — needs two additions
- `PageLayout`, `Alert`, `Button`, `FormField`, `Input`, `Select`, `LoadingState`, `ErrorState` from `shared/ui/`
- `renderWithProviders` + `createMockApiClient` from `test/test-utils.tsx`

**New Components Required**:
| File | Purpose |
|---|---|
| `features/allegro/api/allegro.api.ts` | Add `clientId`/`clientSecret` to input type; add `handleCallback` |
| `features/allegro/hooks/use-handle-allegro-callback-mutation.ts` | Mutation hook for the callback API call |
| `features/allegro/components/allegro-setup.schema.ts` | Zod schema for the setup form |
| `features/allegro/components/AllegroSetupForm.tsx` | Step 1 form component |
| `features/allegro/components/AllegroSetupForm.test.tsx` | Unit tests for the form |
| `pages/connections/allegro-setup-page.tsx` | Page wrapping the setup form |
| `pages/integrations/allegro-connect-callback-page.tsx` | Replace stub — real callback handler |
| `pages/integrations/allegro-connect-callback-page.test.tsx` | Tests for the callback page |
| `app/routes/allegro-setup.route.tsx` | Route declaration for `/connections/new/allegro` |

**Modified Files**:
| File | Change |
|---|---|
| `app/routes/root.route.tsx` | Register `allegroSetupRoute` |
| `features/connections/components/create-connection-form.tsx` | When Allegro selected, show redirect notice |

**Core vs Integration Justification**: N/A — purely FE. The backend boundary is not crossed architecturally; the FE consumes existing REST endpoints.

**Dependency direction**: `pages` → `features/allegro` → `shared` ✅

---

## 4. External / Domain Research

### Allegro OAuth Flow (as implemented in backend)

1. FE calls `POST /integrations/allegro/oauth/connect` with `{ clientId, clientSecret, redirectUri, environment, connectionName }`
2. Backend generates a random state, stores `{ clientId, clientSecret, redirectUri, environment, connectionName }` in Redis with a 10-minute TTL
3. Backend returns `{ authorizationUrl, state }` — the `authorizationUrl` already includes all required Allegro OAuth params
4. FE redirects browser to `authorizationUrl`
5. Operator authorizes on Allegro
6. Allegro redirects browser to `redirectUri` with `?code=...&state=...`
7. **`redirectUri` must be the FE callback URL** (`window.location.origin + "/integrations/allegro/connect/callback"`) — the FE receives the code and state, then calls the backend
8. FE callback page calls `GET /integrations/allegro/oauth/callback?code=...&state=...`
9. Backend validates state against Redis (one-time use), exchanges code for tokens, creates the connection, returns `{ message, connectionId, connectionName }`

### Error cases to handle on the callback page:
- `?error=access_denied` — operator denied authorization on Allegro (Allegro adds this param)
- Missing `?code` or `?state` — malformed redirect
- Backend returns 400 — invalid/expired state (operator took more than 10 minutes)
- Backend returns 5xx — unexpected server error
- Network failure

### Internal Patterns
- **Setup form**: follows `LoginForm.tsx` / `CreateConnectionForm.tsx` — Zod schema + React Hook Form + mutation
- **Mutation hook**: follows `use-start-allegro-oauth-mutation.ts`
- **Callback URL params**: use `useSearchParams()` from React Router (established in the router setup)
- **All four states**: loading / error / empty / data per `fe-pages.md` rules

---

## 5. Questions & Assumptions

### Open Questions

- Should the callback page auto-redirect to `/connections/{connectionId}` after a few seconds, or stay on the success screen? **Assumption**: stay on success screen with an explicit "Go to connection" link — less surprising than automatic redirect.
- Should the `AllegroSetupForm` show/hide the `clientSecret` field (password masking)? **Assumption**: yes — use `type="password"` on the secret input since this is a sensitive credential.

### Assumptions

- `redirectUri = window.location.origin + "/integrations/allegro/connect/callback"` — constructed at form submit time in the browser. Operators must register this URL in their Allegro app settings.
- The backend `GET /integrations/allegro/oauth/callback` is `@Public()` — no auth token needed for the callback call. This is confirmed in the controller.
- The POST endpoint requires `@Roles('admin')` — the operator must be logged in as admin to initiate the flow. The `AuthenticatedAppLayout` already enforces authentication for all child routes.
- We do NOT support the `?error` query param from Allegro in the existing `AllegroOAuthCallbackQueryDto` — handle it purely on the FE by checking for its presence before calling the backend.
- `connectionName` is optional at setup time. If omitted, the backend generates a default name.

### Documentation Gaps

- The backend comment says "In production, this could redirect to a success page" — this design defers that to future work. The FE-mediated callback flow (FE receives code, FE calls backend) is the right MVP approach.

---

## 6. Proposed Implementation Plan

### Phase 1 — Fix the API contract

**Goal**: Make the FE API match what the backend actually expects.

**Step 1.1 — Update `allegro.api.ts`**

- **File**: `apps/web/src/features/allegro/api/allegro.api.ts`
- **Action**:
  1. Add `clientId: string` and `clientSecret: string` to `StartAllegroOAuthInput` (required, because the backend DTO requires them)
  2. Add `AllegroCallbackResponse` interface: `{ message: string; connectionId: string; connectionName: string }`
  3. Add `handleCallback(code: string, state: string): Promise<AllegroCallbackResponse>` to `AllegroApi` interface
  4. Implement `handleCallback` in `createAllegroApi` — calls `GET /integrations/allegro/oauth/callback?code=...&state=...`
- **Acceptance**: TypeScript compiles; the updated `allegro` property in `createMockApiClient` in `test-utils.tsx` needs `handleCallback` added

**Step 1.2 — Update `test-utils.tsx`**

- **File**: `apps/web/src/test/test-utils.tsx`
- **Action**: Add `handleCallback: vi.fn().mockResolvedValue({ message: 'OK', connectionId: 'conn_1', connectionName: 'Allegro sandbox' })` to the mock `allegro` object
- **Acceptance**: `pnpm type-check` passes; existing tests still pass

**Step 1.3 — Add `use-handle-allegro-callback-mutation.ts`**

- **File**: `apps/web/src/features/allegro/hooks/use-handle-allegro-callback-mutation.ts`
- **Action**: Create mutation hook that calls `apiClient.allegro.handleCallback(code, state)`
- **Acceptance**: Hook exports `useHandleAllegroCallbackMutation`; follows `use-start-allegro-oauth-mutation.ts` pattern

---

### Phase 2 — Allegro setup form

**Goal**: Collect operator credentials and initiate the OAuth redirect.

**Step 2.1 — Create `allegro-setup.schema.ts`**

- **File**: `apps/web/src/features/allegro/components/allegro-setup.schema.ts`
- **Action**: Define Zod schema with fields:
  - `name: z.string().trim().min(1)` — connection name
  - `environment: z.enum(['sandbox', 'production'])` — default `'sandbox'`
  - `clientId: z.string().trim().min(1)` — Allegro OAuth client ID
  - `clientSecret: z.string().trim().min(1)` — Allegro OAuth client secret
- **Acceptance**: Export `AllegroSetupFormValues`, `AllegroSetupFormSubmission`, and `toStartOAuthInput(values, redirectUri): StartAllegroOAuthInput`

**Step 2.2 — Create `AllegroSetupForm.tsx`**

- **File**: `apps/web/src/features/allegro/components/AllegroSetupForm.tsx`
- **Action**:
  1. React Hook Form with zodResolver
  2. Fields: connection name (text), environment (select: sandbox / production), client ID (text), client secret (password)
  3. On submit: call `useStartAllegroOAuthMutation`, compute `redirectUri = window.location.origin + "/integrations/allegro/connect/callback"`, then `window.location.href = authorizationUrl`
  4. Show `Alert tone="error"` on mutation failure
  5. Disable submit while pending; show `FormErrorSummary` after first submit attempt
  6. Informational note: "You will be redirected to Allegro to authorize this connection."
- **Acceptance**: Form renders; submitting calls `startOAuth`; on success `window.location.href` is set to `authorizationUrl`

**Step 2.3 — Create `allegro-setup-page.tsx`**

- **File**: `apps/web/src/pages/connections/allegro-setup-page.tsx`
- **Action**: Wrap `AllegroSetupForm` in `PageLayout` with eyebrow "Integrations", title "Connect Allegro", description, summary toolbar chips ("OAuth 2.0", "Allegro API"), and a back link to `/connections/new`
- **Acceptance**: Page renders correctly inside the shell

**Step 2.4 — Create route and register**

- **File**: `apps/web/src/app/routes/allegro-setup.route.tsx`
- **Action**: `{ path: 'connections/new/allegro', element: <AllegroSetupPage /> }`
- **File**: `apps/web/src/app/routes/root.route.tsx`
- **Action**: Import and add `allegroSetupRoute` to the children array (before `allegroCallbackRoute`)
- **Acceptance**: Navigating to `/connections/new/allegro` renders `AllegroSetupPage`

**Step 2.5 — Add redirect hint in `CreateConnectionForm`**

- **File**: `apps/web/src/features/connections/components/create-connection-form.tsx`
- **Action**: When `platformType === 'allegro'` is selected, render an `Alert tone="info"` inside the form that reads: "Allegro uses OAuth — [use the Allegro setup wizard]" (link to `/connections/new/allegro`). The rest of the generic form fields stay hidden while this notice is shown to prevent the operator entering meaningless credentials.
- **Acceptance**: Selecting Allegro in the generic form shows the info alert and hides the other fields

---

### Phase 3 — Callback handler

**Goal**: Process the OAuth return, show success or a clear failure message.

**Step 3.1 — Rewrite `allegro-connect-callback-page.tsx`**

- **File**: `apps/web/src/pages/integrations/allegro-connect-callback-page.tsx`
- **Action**:
  1. Read `code`, `state`, and `error` from `useSearchParams()`
  2. If `error` param present: show `ErrorState` with "Authorization denied" message and a "Try again" link to `/connections/new/allegro`
  3. If `code` or `state` missing: show `ErrorState` with "Invalid callback — missing parameters"
  4. Otherwise: call `useHandleAllegroCallbackMutation` on mount (via `useEffect` with the mutation `mutate` function) — show `LoadingState` while pending
  5. On mutation success: show a success panel — connection name, connection ID in mono-text, "Go to connection" button linking to `/connections/{connectionId}`, "View all connections" secondary link
  6. On mutation error: show `ErrorState` with the server error message, retry link to `/connections/new/allegro`
- **Acceptance**: All four states render correctly; mutation is called once on mount when code+state are present

---

### Phase 4 — Tests

**Step 4.1 — `AllegroSetupForm.test.tsx`**

- **File**: `apps/web/src/features/allegro/components/AllegroSetupForm.test.tsx`
- **Tests**:
  | Test | Arrangement | Assertion |
  |---|---|---|
  | Shows all four form fields | default render | name, environment, client ID, client secret inputs present |
  | Disables submit while pending | mutation pending | submit button disabled |
  | Shows API error on failure | mutation rejects | `Alert tone="error"` appears |
  | Calls startOAuth with correct input | valid form submit | `apiClient.allegro.startOAuth` called with `clientId`, `clientSecret`, `redirectUri`, `environment`, `connectionName` |
  | Redirects on success | mutation resolves | `window.location.href` set to `authorizationUrl` |

**Step 4.2 — `allegro-connect-callback-page.test.tsx`**

- **File**: `apps/web/src/pages/integrations/allegro-connect-callback-page.test.tsx`
- **Tests**:
  | Test | Arrangement | Assertion |
  |---|---|---|
  | Shows error when `?error=access_denied` present | route with `?error=access_denied` | "Authorization denied" error state |
  | Shows error when code missing | route with `?state=abc` only | error state about missing parameters |
  | Shows loading while mutation pending | route with `?code=x&state=y`, never-resolving mutation | loading state |
  | Shows success with connection info | route with `?code=x&state=y`, mutation resolves | connection name and ID visible |
  | Shows error on mutation failure | route with `?code=x&state=y`, mutation rejects | error state with retry link |

---

### Implementation Details

**`allegro.api.ts` final shape:**
```typescript
export interface StartAllegroOAuthInput {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment?: 'sandbox' | 'production';
  connectionName?: string;
}

export interface AllegroCallbackResponse {
  message: string;
  connectionId: string;
  connectionName: string;
}

export interface AllegroApi {
  startOAuth: (input: StartAllegroOAuthInput) => Promise<StartAllegroOAuthResponse>;
  handleCallback: (code: string, state: string) => Promise<AllegroCallbackResponse>;
}
```

**`handleCallback` implementation:**
```typescript
handleCallback(code, state): Promise<AllegroCallbackResponse> {
  return request<AllegroCallbackResponse>(
    `/integrations/allegro/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
  );
}
```

Note: `GET` with no body — use query string.

**`redirectUri` construction in `AllegroSetupForm`:**
```typescript
const redirectUri = `${window.location.origin}/integrations/allegro/connect/callback`;
```

This is computed at submit time so it works for any deployment (local, staging, production).

**Callback page mutation trigger — key pattern:**
```typescript
const callbackMutation = useHandleAllegroCallbackMutation();

useEffect(() => {
  if (code && state) {
    callbackMutation.mutate({ code, state });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []); // Intentionally empty — run once on mount only
```

**No new CSS needed** — all required classes are already in `index.css`.

**No backend changes needed** — `POST /integrations/allegro/oauth/connect` and `GET /integrations/allegro/oauth/callback` are complete.

**No migration needed** — no schema changes.

---

## 7. Alternatives Considered

### Alternative 1: Backend-mediated callback (redirectUri = API URL)

The `redirectUri` points to the backend `GET /integrations/allegro/oauth/callback`. After processing, the backend 302-redirects to a FE success page.

**Why Rejected**: Requires backend changes (adding redirect logic). The FE already has a reserved callback route. The FE-mediated approach (FE receives code, calls backend) requires zero backend changes and keeps the UI concerns in the FE layer.

---

### Alternative 2: Platform selection cards replacing the generic form

Replace `/connections/new` entirely with a platform-selection card grid (Allegro card → OAuth wizard, PrestaShop card → generic form).

**Why Rejected**: Scope creep beyond issue #66. The generic form remains useful for PrestaShop and future platforms. The redirect hint approach achieves the goal with minimal disruption to existing flows.

---

### Alternative 3: Inline wizard steps on the same page

Single `/connections/new` page with step-based rendering (step 1: select platform, step 2: platform-specific form, step 3: callback result).

**Why Rejected**: The OAuth flow requires a real browser navigation to Allegro and back. You cannot keep the user on the same page during OAuth. The `/connections/new/allegro` + `/integrations/allegro/connect/callback` two-page model maps naturally to the OAuth redirect dance.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ `pages` → `features` → `shared` dependency direction preserved
- ✅ No API calls from page components — all through feature hooks
- ✅ No global store introduced — mutation state is local to the component

### Naming Conventions
- ✅ `allegro-setup.schema.ts` — matches `*.schema.ts` form schema convention
- ✅ `use-handle-allegro-callback-mutation.ts` — matches `use-{action}-mutation.ts` hook convention
- ✅ `allegro-setup-page.tsx` — matches kebab-case page convention
- ✅ `allegro-connect-callback-page.test.tsx` — matches kebab-case test convention

### Risks

- **`window.location.href` assignment in tests**: Assigning to `window.location.href` in JSDOM requires mocking. Use `vi.spyOn(window.location, 'assign')` or `Object.defineProperty(window, 'location', { writable: true, value: { href: '' } })` in form tests.
- **`useEffect` + `useMutation` on mount**: The callback page fires the mutation once on mount. React Strict Mode double-invokes effects. This is fine here because `handleCallback` is idempotent server-side (Redis state is one-time use — the second invocation would return a 400 but the first already succeeded). In test, use a never-resolving mutation to test loading state.
- **10-minute state TTL**: If the operator takes more than 10 minutes between starting and completing the OAuth, the backend returns 400. The callback page's error state handles this gracefully with a retry link.
- **`credentialsRef` still shown in generic form when Allegro redirected**: The generic form hides its fields when Allegro is selected but the redirect hint is shown — no stale credentials can be entered.

### Edge Cases
- `?error=access_denied` from Allegro → show denial state (not a backend error)
- Network failure during backend callback call → `ErrorState` with retry
- User navigates directly to `/integrations/allegro/connect/callback` without params → show clear "Invalid callback" state (no blank page)
- `authorizationUrl` opens as top-level navigation (not popup) — standard OAuth pattern, correct

### Backward Compatibility
- ✅ Generic `CreateConnectionForm` remains functional for PrestaShop
- ✅ Existing `allegroCallbackRoute` path unchanged
- ✅ `useStartAllegroOAuthMutation` type change is additive (new required fields) — no existing callers to break

---

## 9. Testing Strategy & Acceptance Criteria

### Component Tests (Vitest + Testing Library)

**`AllegroSetupForm.test.tsx`** — 5 tests covering: field rendering, submit-disabled-when-pending, API error display, correct mutation call, redirect on success

**`allegro-connect-callback-page.test.tsx`** — 5 tests covering: `?error` param, missing params, loading state, success state with connection info, mutation error state

### Mocking Strategy
- `apiClient.allegro.startOAuth` and `apiClient.allegro.handleCallback` — mocked via `createMockApiClient`
- `window.location` — mocked in form test to capture redirect
- URL search params — passed via `renderWithProviders({ route: '/integrations/allegro/connect/callback?code=x&state=y' })`

### Acceptance Criteria (from issue #66)
- [x] Setup form collects connection name, environment, client ID, client secret
- [x] Calling the OAuth connect endpoint and receiving authorizationUrl
- [x] Redirect flow — browser navigates to Allegro authorization page
- [x] Callback success UX — shows connection name, ID, link to detail
- [x] Callback failure UX — clear error message with retry path
- [x] Validation result screen — success panel on the callback page

### Quality Gate
```bash
pnpm lint        # zero errors
pnpm type-check  # zero errors
pnpm test        # all tests pass
```

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (FE dependency direction)
- [x] Respects CORE vs Integration boundaries (no boundary crossing)
- [x] Uses existing patterns (mutation hooks, schema files, `renderWithProviders`)
- [x] Idempotency considered (callback mutation fires once on mount; backend state is one-time-use)
- [x] Event-driven patterns used where applicable (N/A — synchronous user flow)
- [x] Rate limits & retries addressed (N/A — OAuth callback is a one-shot flow; retry via "try again" link)
- [x] Error handling comprehensive (5 distinct error cases covered)
- [x] Testing strategy complete (10 tests covering all meaningful states)
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
