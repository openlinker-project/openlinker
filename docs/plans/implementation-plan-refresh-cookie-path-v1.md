# Implementation Plan — Refresh-token cookie Path fix after /v1 API versioning (#1327)

## 1. Understanding

**Goal**: `apps/api/src/auth/auth.cookies.ts` scopes the HttpOnly `ol_refresh` cookie to
`Path=/auth`, but since the URI-versioning migration (#1133/#1316) `AuthController` is mounted at
`/v1/auth/*`. Per RFC 6265 §5.1.4 the browser never sends the cookie to `POST /v1/auth/refresh`,
so every cold page reload 401s and logs the user out despite a valid refresh token.

**Layer**: Interface (HTTP auth cookies). No domain/application/persistence change, no migration.

**Non-goals**:
- `CSRF_COOKIE_PATH` stays `'/'` (correct since #748).
- No FE change — `ol_refresh` is HttpOnly; the SPA never reads it.
- No change to token issuance/rotation logic.

## 2. Research

- `REFRESH_COOKIE_PATH` is consumed in exactly one file: `auth.cookies.ts` (set at :53, three
  `clearCookie` sites at :83/:89/:93).
- **Trap found**: the two CSRF *migration-cleanup* clears (`:83`, `:93`, from #748) reuse
  `REFRESH_COOKIE_PATH` as a stand-in for the **legacy `'/auth'`** CSRF path. Blindly re-pointing
  the constant to `/v1/auth` would silently retarget those cleanups and break the #748 recovery
  semantics. They need their own literal.
- `API_VERSION` / `API_VERSION_LABEL` (`apps/api/src/app-info/app-info.types.ts`) is the declared
  single source of truth for the version prefix — `main.ts:91` and the integration harness
  (`test/integration/setup.ts:35`) both feed it to `enableVersioning`. Deriving the cookie path
  from it satisfies the issue's "don't hardcode `/v1` a second time" criterion.
- `auth-refresh.int-spec.ts:122` currently asserts the **buggy** `Path=/auth` — it passes because
  supertest replays the `Cookie` header manually, bypassing browser path-matching. That assertion
  must flip to the versioned path.

## 3. Design

```
apps/api/src/auth/auth.cookies.ts
  import { API_VERSION_LABEL } from '../app-info/app-info.types';
  export const REFRESH_COOKIE_PATH = `/${API_VERSION_LABEL}/auth`;   // now exported for tests
  const LEGACY_AUTH_COOKIE_PATH = '/auth';                            // pre-#1327 refresh + pre-#748 csrf scope
```

- `setRefreshCookie()` additionally clears the stale `ol_refresh` at the legacy `'/auth'` path
  before setting the new one (same rationale and mechanism as the #748 CSRF cleanup already in
  this file: browsers from the buggy window otherwise carry a live-but-unreachable refresh token
  for its full TTL).
- The two CSRF migration-cleanup clears switch from `REFRESH_COOKIE_PATH` to
  `LEGACY_AUTH_COOKIE_PATH` (behavior-preserving).
- `clearAuthCookies()` clears `ol_refresh` at both the versioned and legacy paths.

**Drift guard (AC 2)**: unit test asserts
`REFRESH_COOKIE_PATH === '/' + API_VERSION_LABEL + '/' + Reflect.getMetadata(PATH_METADATA, AuthController)`
using the `PATH_METADATA` constant from `@nestjs/common/constants` (not the raw `'path'`
literal, so a Nest-internal key rename fails at import time instead of returning `undefined`),
plus an explicit guard that the resolved controller path is exactly `'auth'` so a silent
`undefined` can't make the assertion vacuous. A future controller-prefix change fails the
build; a future `API_VERSION` bump self-heals because the path is derived.

**Test-tautology guard (review finding)**: the int-spec must NOT derive its expected cookie
path from `API_VERSION_LABEL` — the implementation computes the path from that same constant,
so a derived assertion is true by construction and blind to mount-vs-cookie drift (e.g.
versioning removed while the constant still says `v1`). The int-spec's request paths are
literal (`.post('/v1/auth/login')`); assert the **literal** `Path=/v1/auth` against that
literal request path (RFC 6265 §5.1.4 prefix-match is then witnessed by the pair of literals).

## 4. Steps

1. **`apps/api/src/auth/auth.cookies.ts`** — derive + export `REFRESH_COOKIE_PATH`, add
   `LEGACY_AUTH_COOKIE_PATH`, add legacy-refresh cleanup in `setRefreshCookie` and
   `clearAuthCookies`, retarget the two CSRF cleanups to the legacy literal.
   Style constraints (mirror the in-file #748 precedent exactly): clear **before** set,
   options limited to `{ path: LEGACY_AUTH_COOKIE_PATH }`, *why* comment citing #1327 with the
   "affected users never reach logout" rationale; update the file header's `/auth/*` route
   references to the versioned paths.
   *Accept*: `Set-Cookie: ol_refresh=…; Path=/v1/auth` on login/refresh; clears cover both paths.
2. **`apps/api/src/auth/auth.controller.spec.ts`** — add drift-guard test (path derivation vs
   `PATH_METADATA` controller metadata); assert **which cookie gets deleted, not just how many
   times**: explicit `toHaveBeenCalledWith(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH })`
   and `toHaveBeenCalledWith(REFRESH_COOKIE_NAME, { path: '/auth' })` on the logout/reuse paths
   (a clear at the wrong path leaves a live HttpOnly refresh token after logout — call counts
   alone can't catch that); update `clearCookie` call-count expectations (login/refresh now also
   clear legacy `ol_refresh`; reuse/logout paths clear 4, not 3); keep `'/auth'` literals for the
   migration-cleanup assertions.
3. **`apps/api/test/integration/auth-refresh.int-spec.ts`** — assert the **literal**
   `Path=/v1/auth` on the refresh cookie line (no `API_VERSION_LABEL` import — see
   test-tautology guard above); extend the "skip epoch-expired clearing lines" filter (already
   used for csrf) to the refresh cookie lookup.
4. **`docs/operations/auth-cookies.md`** (pre-implement gate finding) — fix the stale
   "Both cookies share the same `Path=/auth`" paragraph (`:21-24`; csrf has been `/` since
   #748) and the `/auth/*` route mentions to the versioned reality.
5. Quality gate: `pnpm lint`, `pnpm type-check`, `pnpm test`, plus the relevant int-spec via
   Testcontainers:
   `pnpm --filter @openlinker/api exec jest --config test/jest-integration.cjs --testPathPattern=auth-refresh`.

## 5. Validation

- **Architecture**: interface-layer only; no boundary crossings; import direction
  `auth → app-info` already exists in the app layer (both under `apps/api/src`).
- **Security**: fix restores refresh-token delivery; legacy cleanup removes a lingering
  (path-orphaned) credential from browser jars. No secrets, no new surface.
- **Assumption carried from the issue**: no deployment pins proxy/CDN rules to the literal
  `/auth` cookie path.
