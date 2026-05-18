# Implementation Plan — JWT refresh-token rotation (#710)

**Issue**: [#710 — Replace localStorage JWT with refresh-token rotation](https://github.com/openlinker-project/openlinker/issues/710)
**Severity**: Security / CRITICAL
**Branch**: `710-jwt-refresh-token-rotation`
**Approach**: single PR — BE + FE land together; Postgres-backed `refresh_tokens` table.

---

## 0. Goal

Close the "one XSS → 24h admin compromise" cascade by eliminating the
localStorage JWT and adding refresh-token rotation. After this PR:

- Access tokens live in memory only (`useState`/React context); reload =
  silent refresh against `POST /auth/refresh`.
- Access-token TTL drops from `1d` → `15m`.
- Refresh tokens are opaque random strings, stored hashed in Postgres,
  sent only as `Secure; HttpOnly; SameSite=Strict; Path=/auth/refresh` +
  `Path=/auth/logout` cookies.
- Each refresh rotates the token; presenting a previously-rotated token
  revokes the entire ancestor chain (stolen-cookie detection).
- Logout revokes the current refresh-token row server-side.
- CSRF double-submit token guards `/auth/refresh` and `/auth/logout`.

**Non-goals** (deferred):

- Helmet / CSP middleware — separate finding, separate PR.
- Multi-device refresh-token UI (list-and-revoke). Server-side data
  shape supports it; admin surface lands in a follow-up.
- Per-route per-user revocation lists for access tokens. The 15-min TTL
  + rotating refresh chain is the trade-off; we don't need a JWT
  blacklist.
- Session bumping (single-active-session). Allowed for follow-up.

---

## 1. Architecture mapping

| Layer | What lands here |
|---|---|
| **CORE — Users context** | `RefreshToken` domain entity + repository port; `RefreshTokenReuseDetectedException`. |
| **CORE — Users infrastructure** | `RefreshTokenOrmEntity` + `RefreshTokenRepository` impl. Migration. |
| **CORE — Auth (apps/api)** | `RefreshTokenService` (issue / rotate / revoke / detect-reuse) implementing `IRefreshTokenService`. CSRF guard. Controller wiring. |
| **Interface (apps/api)** | `AuthController.login` (sets cookies), `.refresh`, `.logout`. `main.ts` — switch from `enableCors()` to credentials-aware CORS + `cookie-parser`. |
| **Frontend (apps/web)** | Rewrite `jwt-bearer-session-adapter.ts`: in-memory storage, silent refresh, 401-retry-once. `ApiClient` — 401 interceptor + CSRF header. `useLogin` updates. |

Refresh-token persistence lives in `libs/core/src/users/` because the
shape is user-scoped, mirrors the existing `password-reset-token`
precedent (same domain, same shape), and lets the auth service stay
thin. Service classes (issue/rotate/revoke) stay in `apps/api/src/auth/`
because they coordinate cookie I/O — that's interface-layer concern.

---

## 2. Data model

### 2.1 `refresh_tokens` table

```
CREATE TABLE refresh_tokens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash        varchar(64) NOT NULL UNIQUE,
  issued_at         timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  rotated_from_id   uuid NULL REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  revoked_at        timestamptz NULL,
  revoked_reason    varchar(64) NULL          -- 'rotated' | 'logout' | 'reuse_detected'
);
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens(user_id);
CREATE INDEX refresh_tokens_rotated_from_id_idx ON refresh_tokens(rotated_from_id);
```

Notes:
- `token_hash` is SHA-256 (hex, 64 chars) of the raw token. Raw token
  never persisted. Lookups are `WHERE token_hash = sha256(presented)`.
- `rotated_from_id` is the parent in the rotation chain. NULL on the
  initial issue (login). Tracing this chain is how we revoke ancestors
  on reuse-detection.
- `revoked_reason` is a small `as const` set for audit logs.
- `user_agent` / `ip_address` deferred per review (tech-review
  SUGGESTION §2.1): audit-only columns add review surface without a
  consumer. Add them when the "active sessions" admin page lands
  (§10).

### 2.2 Migration

`apps/api/src/migrations/1796000000000-add-refresh-tokens.ts` —
generated via TypeORM CLI then hand-reviewed. `up()` creates the table
+ indexes; `down()` drops the table.

---

## 3. CORE — domain layer

### 3.1 `RefreshToken` entity (domain)

`libs/core/src/users/domain/entities/refresh-token.entity.ts`

```typescript
export class RefreshToken {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly tokenHash: string,
    public readonly issuedAt: Date,
    public readonly expiresAt: Date,
    public readonly rotatedFromId: string | null,
    public readonly revokedAt: Date | null,
    public readonly revokedReason: RefreshTokenRevocationReason | null,
  ) {}

  isActive(now: Date = new Date()): boolean {
    return this.revokedAt === null && this.expiresAt > now;
  }

  isRevoked(): boolean {
    return this.revokedAt !== null;
  }
}
```

### 3.2 Types

`libs/core/src/users/domain/types/refresh-token.types.ts`

```typescript
export const RefreshTokenRevocationReasonValues = [
  'rotated',
  'logout',
  'reuse_detected',
] as const;
export type RefreshTokenRevocationReason =
  (typeof RefreshTokenRevocationReasonValues)[number];
```

### 3.3 Repository port

`libs/core/src/users/domain/ports/refresh-token-repository.port.ts`

```typescript
export interface RefreshTokenRepositoryPort {
  /** Insert a freshly-issued token row. */
  insert(token: RefreshToken): Promise<RefreshToken>;

  /** Look up by hash; returns null if not found. */
  findByHash(tokenHash: string): Promise<RefreshToken | null>;

  /** Mark a single token revoked with the given reason. */
  revoke(id: string, reason: RefreshTokenRevocationReason, at?: Date): Promise<void>;

  /**
   * Revoke the entire rotation chain reachable from `tokenId` —
   * the token itself, all its ancestors (`rotated_from_id` chain),
   * and all its descendants. Idempotent; already-revoked rows are
   * left as-is. Used on reuse-detection.
   */
  revokeChain(tokenId: string, reason: RefreshTokenRevocationReason): Promise<void>;

  /** Revoke every active token for a user (logout-all-devices, future). */
  revokeAllForUser(userId: string, reason: RefreshTokenRevocationReason): Promise<void>;
}

export const REFRESH_TOKEN_REPOSITORY_TOKEN = Symbol('RefreshTokenRepositoryPort');
```

### 3.4 Exception

`libs/core/src/users/domain/exceptions/refresh-token-reuse-detected.exception.ts`

Thrown by the service when a previously-revoked token is presented at
`/auth/refresh`. Maps to 401 + chain-wide revocation.

### 3.5 Barrel updates

`libs/core/src/users/index.ts` re-exports the entity, types, port,
token symbol, exception.

---

## 4. CORE — infrastructure layer

### 4.1 ORM entity

`libs/core/src/users/infrastructure/persistence/entities/refresh-token.orm-entity.ts`

Mirrors the `password-reset-token.orm-entity.ts` shape — TypeORM
decorators, snake_case columns, indexes on `user_id` and
`rotated_from_id`.

### 4.2 Repository implementation

`libs/core/src/users/infrastructure/persistence/repositories/refresh-token.repository.ts`

Standard `Repository<T>` + `toDomain`/`toOrm` private methods. The
`revokeChain` method walks the rotation chain in both directions
(descendants + ancestors) via two `WITH RECURSIVE` CTEs unioned before
the `UPDATE`. Splitting the directions avoids the per-row correlated
subquery the naive form would emit (review IMPORTANT §4.2):

```sql
WITH RECURSIVE descendants AS (
  SELECT id, rotated_from_id FROM refresh_tokens WHERE id = $1
  UNION
  SELECT rt.id, rt.rotated_from_id
    FROM refresh_tokens rt
    JOIN descendants d ON rt.rotated_from_id = d.id
),
ancestors AS (
  SELECT id, rotated_from_id FROM refresh_tokens WHERE id = $1
  UNION
  SELECT rt.id, rt.rotated_from_id
    FROM refresh_tokens rt
    JOIN ancestors a ON a.rotated_from_id = rt.id
)
UPDATE refresh_tokens
   SET revoked_at = now(), revoked_reason = $2
 WHERE id IN (
   SELECT id FROM descendants UNION SELECT id FROM ancestors
 )
   AND revoked_at IS NULL;
```

Implemented via the entity-manager's `query()` (not `Repository<T>`) —
TypeORM has no clean API for recursive CTEs. The repository wraps the
call in a `try/catch` and translates any `QueryFailedError` into a
domain error (`RefreshTokenRepositoryError` in `domain/exceptions/`,
shape mirrors `engineering-standards.md § Repository Error Handling`).
Infrastructure errors never leak through the port.

### 4.3 Module wiring

`libs/core/src/users/users.module.ts` — register
`RefreshTokenOrmEntity` + repository, expose under
`REFRESH_TOKEN_REPOSITORY_TOKEN` (`useExisting`).

---

## 5. Backend — auth service + controller

### 5.1 `RefreshTokenService` + interface

`apps/api/src/auth/refresh-token.service.interface.ts`

```typescript
export interface IRefreshTokenService {
  /**
   * Issue a fresh top-of-chain token. Returns the raw token + expiry
   * (caller sets the cookie). `rotated_from_id` is NULL — this is the
   * login-time issuance path.
   */
  issue(userId: string): Promise<IssuedRefreshToken>;

  /**
   * Rotate: validate the presented token, revoke it with reason
   * 'rotated', insert a new one with `rotated_from_id = presented.id`.
   * Returns the new raw token + the userId for the access-token
   * payload. Throws on expired / not-found / already-revoked.
   *
   * If `already-revoked`: throw RefreshTokenReuseDetectedException
   * AFTER calling `revokeChain` on the offender.
   */
  rotate(rawToken: string): Promise<RotatedRefreshToken>;

  /** Revoke the current token (logout). No-op if already revoked. */
  revoke(rawToken: string): Promise<void>;
}

export interface IssuedRefreshToken {
  rawToken: string;
  expiresAt: Date;
}

export interface RotatedRefreshToken {
  userId: string;
  rawToken: string;
  expiresAt: Date;
}
```

`apps/api/src/auth/refresh-token.service.ts` implements it. Random
token bytes via `crypto.randomBytes(32).toString('base64url')` (~43
chars, URL-safe). Hash via `crypto.createHash('sha256').update(raw)`.

The service builds the rotation chain directly — `issue()` and
`rotate()` both delegate to a private `persist()` helper that
constructs the `RefreshToken` domain entity (with or without a
`rotatedFromId`) and calls `repository.insert(token)`. The port has
no `rotatedFromId` parameter — chain linkage is on the entity.

Reuse detection branch (the security-critical path):

```typescript
async rotate(rawToken: string): Promise<RotatedRefreshToken> {
  const presented = await this.repository.findByHash(hashToken(rawToken));
  if (!presented) {
    throw new UnauthorizedException('Invalid refresh token');
  }
  if (presented.isRevoked()) {
    // The user presented a token we already invalidated. Either someone
    // stole the cookie before we rotated, or the legitimate client has
    // a stale tab. Both look identical from the server side. Conservative
    // response: blow up the whole chain for this user and force re-login.
    await this.repository.revokeChain(presented.id, 'reuse_detected');
    throw new RefreshTokenReuseDetectedException();
  }
  if (!presented.isActive()) {
    throw new UnauthorizedException('Refresh token expired');
  }

  await this.repository.revoke(presented.id, 'rotated');
  const next = await this.persist(presented.userId, presented.id);
  return { userId: presented.userId, rawToken: next.rawToken, expiresAt: next.expiresAt };
}

private async persist(
  userId: string,
  rotatedFromId: string | null,
): Promise<IssuedRefreshToken> {
  const rawToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  const entity = new RefreshToken(
    /* id */ randomUUID(),
    userId,
    /* tokenHash */ hashToken(rawToken),
    /* issuedAt */ new Date(),
    expiresAt,
    rotatedFromId,
    /* revokedAt */ null,
    /* revokedReason */ null,
  );
  await this.repository.insert(entity);
  return { rawToken, expiresAt };
}
```

### 5.2 CSRF guard

`apps/api/src/auth/guards/csrf.guard.ts`

Double-submit pattern:
- On login response, server sets a non-HttpOnly cookie `ol_csrf` =
  random 32-byte hex (separate from refresh token).
- Client mirrors that cookie value into an `X-CSRF-Token` request
  header on every state-mutating cookie-authenticated request.
- Guard checks `req.cookies.ol_csrf === req.headers['x-csrf-token']`.
- Guard applied via `@UseGuards(CsrfGuard)` decorator on
  `AuthController.refresh()` and `AuthController.logout()`.

### 5.3 `AuthService` updates

`apps/api/src/auth/auth.service.ts`:
- `JwtModule.signOptions.expiresIn` env default changes from `'1d'` →
  `'15m'`. (One-line `auth.module.ts` change.)
- `login()` stays mostly unchanged — still returns the access-token
  DTO. Refresh-token issuance happens at the controller layer because
  it needs the `Response` object.

### 5.4 `AuthController` rewrites

`apps/api/src/auth/auth.controller.ts`:

```typescript
@Public()
@Post('login')
async login(
  @Body() dto: LoginDto,
  @Req() req: Request,
  @Res({ passthrough: true }) res: Response,
): Promise<LoginResponseDto> {
  const user = await this.authService.validateUser(dto.username, dto.password);
  if (!user) throw new UnauthorizedException('Invalid credentials');

  const accessTokenDto = this.authService.login(user);
  const refresh = await this.refreshTokenService.issue(user.id);
  setRefreshCookie(res, refresh);
  setCsrfCookie(res);
  return accessTokenDto;
}

@Public()
@Post('refresh')
@UseGuards(CsrfGuard)
async refresh(
  @Req() req: Request,
  @Res({ passthrough: true }) res: Response,
): Promise<LoginResponseDto> {
  const raw = req.cookies?.ol_refresh;
  if (!raw) throw new UnauthorizedException('Missing refresh cookie');

  let rotated: RotatedRefreshToken;
  try {
    rotated = await this.refreshTokenService.rotate(raw);
  } catch (error) {
    if (error instanceof RefreshTokenReuseDetectedException) {
      clearRefreshCookie(res);
      clearCsrfCookie(res);
    }
    throw error;
  }

  setRefreshCookie(res, rotated);
  setCsrfCookie(res); // rotate the CSRF too
  const user = await this.authService.getMe(rotated.userId);
  return this.authService.login(user);
}

@Public()
@Post('logout')
@UseGuards(CsrfGuard)
@HttpCode(HttpStatus.NO_CONTENT)
async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
  const raw = req.cookies?.ol_refresh;
  if (raw) await this.refreshTokenService.revoke(raw);
  clearRefreshCookie(res);
  clearCsrfCookie(res);
}
```

Helpers (`setRefreshCookie`, `setCsrfCookie`, `clearRefreshCookie`,
`clearCsrfCookie`) live in a small `auth.cookies.ts` module next to
the controller. The refresh cookie carries:

```
Secure; HttpOnly; SameSite=Strict (prod) | Lax (dev); Path=/auth; Max-Age=<rtTtlSeconds>
```

`Path=/auth` (not `/auth/refresh`) so `/auth/logout` shares the cookie
without a second `Set-Cookie`. Trade-off: the cookie also ships to
`/auth/me`, `/auth/forgot-password`, `/auth/reset-password` (review
IMPORTANT §5.4). None mutate refresh state, and the cookie is
`HttpOnly` + `SameSite=Strict` in prod — exfiltration surface widens
only marginally vs. a two-cookie split, and we accept that trade in
exchange for one round-trip per login/refresh/logout. Documented in
`docs/operations/auth-cookies.md`.

### 5.5 `main.ts` plumbing

Replace `app.enableCors()` with:

```typescript
app.use(cookieParser());
const allowedOrigins = configService
  .get<string>('OL_CORS_ORIGIN', 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim());
app.enableCors({
  origin: allowedOrigins,
  credentials: true,                // required for cookies + Authorization header round-trip
  exposedHeaders: [],
});
```

Adds `cookie-parser` to `apps/api/package.json` (already in
`@types/cookie-parser` ecosystem; one-time dependency).

The wildcard CORS is removed — `*` is incompatible with
`credentials: true` per the spec. `OL_CORS_ORIGIN` defaults to the Vite
dev port; production sets it via env.

### 5.6 Module wiring

`apps/api/src/auth/auth.module.ts` adds:

```typescript
providers: [
  // ... existing ...
  RefreshTokenService,
  { provide: REFRESH_TOKEN_SERVICE_TOKEN, useExisting: RefreshTokenService },
],
```

The `REFRESH_TOKEN_REPOSITORY_TOKEN` is already exported from
`UsersModule` (per § 4.3).

---

## 6. Frontend — session adapter rewrite

### 6.1 `jwt-bearer-session-adapter.ts`

Closure-scoped in-memory state. No `localStorage`. Public surface:

```typescript
export function createJwtBearerSessionAdapter({
  baseUrl,
  fetchFn = fetch,
}: JwtBearerSessionAdapterConfig): SessionAdapter {
  let accessToken: string | null = null;
  let inFlightRefresh: Promise<string | null> | null = null;

  async function refresh(): Promise<string | null> {
    if (inFlightRefresh) return inFlightRefresh;
    inFlightRefresh = (async () => {
      try {
        const res = await fetchFn(`${baseUrl}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'X-CSRF-Token': readCsrfCookie() ?? '',
          },
        });
        if (!res.ok) {
          accessToken = null;
          return null;
        }
        const data = (await res.json()) as { access_token: string };
        accessToken = data.access_token;
        return accessToken;
      } catch {
        accessToken = null;
        return null;
      } finally {
        inFlightRefresh = null;
      }
    })();
    return inFlightRefresh;
  }

  return {
    async getAccessToken(): Promise<string | null> {
      if (accessToken) return accessToken;
      return refresh();
    },

    async getSession(): Promise<Session> {
      const token = await this.getAccessToken();
      if (!token) return ANONYMOUS_SESSION;
      // ... existing /auth/me fetch but use the in-memory token
    },

    async persistSession(token: string): Promise<void> {
      accessToken = token;
    },

    async clearSession(): Promise<void> {
      accessToken = null;
      try {
        await fetchFn(`${baseUrl}/auth/logout`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-CSRF-Token': readCsrfCookie() ?? '' },
        });
      } catch {
        // best-effort
      }
    },
  };
}

function readCsrfCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)ol_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
```

`inFlightRefresh` dedupes the silent-refresh race that fires when two
401s arrive simultaneously (e.g., the dashboard mounts 4 queries on the
same tick after an idle tab regains focus).

### 6.2 `ApiClient` — 401 retry interceptor

`apps/web/src/app/api/api-client.ts` request flow:

```typescript
// Try once, on 401 ask the adapter to refresh and retry once.
let response = await fetchFn(url, { ...init, headers, credentials: 'include' });
if (response.status === 401 && !init.headers?.['X-No-Retry']) {
  const fresh = await sessionAdapter.refresh?.(); // optional hook on the adapter
  if (fresh) {
    const retryHeaders = new Headers(headers);
    retryHeaders.set('Authorization', `Bearer ${fresh}`);
    response = await fetchFn(url, { ...init, headers: retryHeaders, credentials: 'include' });
  }
}
```

To do this cleanly, `SessionAdapter` grows one optional method:

```typescript
export interface SessionAdapter {
  // existing...
  /**
   * Optional. Implement when the adapter backs a refresh-token flow
   * (HttpOnly cookie + silent refresh). The host's API client calls
   * this once on 401; if it returns null, the request fails. Adapters
   * without server-side refresh (e.g. NoopSessionAdapter) omit it.
   */
  refresh?(): Promise<string | null>;
}
```

The `JwtBearerSessionAdapter` implements it; `NoopSessionAdapter`
omits it (the optional method is `undefined`, the 401-retry no-ops).
Loops are avoided because the `/auth/refresh` call uses
`credentials: 'include'` but no `Authorization` header — it can't
re-trigger its own 401-retry.

`session-adapter.ts` carries a file-header comment documenting when an
implementation needs `refresh()` (review IMPORTANT §6.1) so future
plugin authors writing alternate session adapters have an explicit
decision point.

CSRF: every state-mutating request also reads `ol_csrf` and sets
`X-CSRF-Token`. Currently only the `/auth/refresh` and `/auth/logout`
paths need it, but adding it to all writes is cheap and forward-compat
for future cookie-auth endpoints.

### 6.3 `useLogin` updates

`apps/web/src/features/auth/hooks/use-login.ts` — unchanged surface,
but the new `persistSession()` writes to memory. The browser already
gets the refresh + CSRF cookies via `Set-Cookie` from the login
response.

The login `fetch` in `createAuthApi(request)` must use
`credentials: 'include'` so the browser stores the cookies. Today the
core `request()` doesn't set credentials at all → relies on default
("same-origin"). Once `main.ts` flips CORS to credentials-aware, all
API requests need `credentials: 'include'`. Centralize in
`createApiClient`.

### 6.4 Boot — silent refresh

`apps/web/src/app/providers/app-providers.tsx` (or
`SessionProvider`'s mount effect) calls `adapter.getSession()` at
mount, which transparently triggers `refresh()` if no in-memory token
yet. No new UI states needed — existing `Session = 'loading' |
'authenticated' | 'anonymous'` covers it.

### 6.5 No leak guarantee

Grep + assertion test:
- `apps/web/src/test/no-localstorage-jwt.test.ts` — scans
  `apps/web/src/**/*.{ts,tsx}` for the substring `ol_access_token` and
  fails if any non-test file matches. Hard guard against regression.

---

## 7. Testing

### 7.1 Backend unit specs

| File | Coverage |
|---|---|
| `refresh-token.service.spec.ts` | issue → rotate happy path; rotate of already-revoked → reuse exception + chain revoke; rotate of expired → 401; revoke is idempotent. |
| `refresh-token.repository.spec.ts` | `toDomain`/`toOrm` round-trip; `revokeChain` SQL shape via mocked `QueryRunner`. The recursive-CTE behaviour is verified in the int-spec, not here. |
| `csrf.guard.spec.ts` | passes when header equals cookie; rejects when missing / mismatched. |
| `auth.controller.spec.ts` | extend existing — login sets both cookies; refresh sets new cookies; logout clears cookies. Use Nest's `getResponse()` mock. |

### 7.2 Backend integration spec

`apps/api/test/integration/auth-refresh.int-spec.ts` against the
Testcontainers harness:

1. Login → assert `access_token` in body; assert `Set-Cookie` includes
   `ol_refresh` (HttpOnly Secure SameSite=Strict Path=/auth) and
   `ol_csrf` (non-HttpOnly).
2. Use the access token until `JWT_EXPIRES_IN=2s` (override env in
   harness for this spec); after expiry, `/auth/me` returns 401.
3. Call `POST /auth/refresh` with the cookies + CSRF header; assert new
   access token + new cookies.
4. Call `POST /auth/refresh` with the **old** refresh cookie (the one
   from step 1, not step 3); assert 401 + assert the chain rooted at
   step-1's token is fully revoked in DB.
5. Logout: `POST /auth/logout` → 204; subsequent refresh attempts
   return 401.
6. CSRF mismatch (header missing or != cookie) → 403 from CsrfGuard.

### 7.3 Frontend unit specs

| File | Coverage |
|---|---|
| `jwt-bearer-session-adapter.test.ts` | rewrite: persistSession holds in memory; getAccessToken triggers refresh when empty; refresh dedupes concurrent calls (single `fetch` for N concurrent `.getAccessToken()`s). |
| `api-client.test.ts` | 401 → retry once with refreshed token → succeeds. 401 again after retry → propagates ApiError. |
| `no-localstorage-jwt.test.ts` | grep guard described in § 6.5. |

### 7.4 CORS regression check

The CORS swap in §5.5 (wildcard → explicit-origin + `credentials: true`)
is a behavioural change. Add to the implementation checklist:

- Run `pnpm test:integration` end-to-end after the CORS change. Existing
  int-specs use supertest in same-origin mode, so they shouldn't trip
  the credentials gate, but the verification step catches regressions
  in webhook int-specs and `prestashop-harness-smoke` that might
  implicitly rely on permissive CORS.

### 7.5 JwtModule TTL verification for int-spec

The int-spec in §7.2 sets `JWT_EXPIRES_IN=2s` to test the expiry flow.
`JwtModule.registerAsync.useFactory` captures `signOptions.expiresIn` at
module-init time, so changing `process.env` after the harness boots
won't bump TTL. Two options:

1. Set `JWT_EXPIRES_IN=2s` in the harness `setupOnce()` env block
   before `app.init()` so every spec inherits it. Drawback: other
   int-specs that hit `/auth/login` and use the access token across
   ≥2 s become flaky.
2. Override the `JwtService` provider in a spec-local `Test.createTestingModule`
   that reuses the harness's DataSource but rebinds `JwtService` with
   a 2 s TTL.

Pick (2). Document the override at `auth-refresh.int-spec.ts` setup.

---

## 8. Acceptance criteria (from issue)

- [x] Login returns access token in body, sets refresh token as
      `Secure; HttpOnly; SameSite=Strict` cookie → §5.4 + int-spec
      step 1.
- [x] Access token expires in ≤15 min; expiry → 401 → silent refresh →
      retry → §6.2 + int-spec steps 2-3.
- [x] Refresh token rotates on every refresh; already-rotated token
      rejected + chain revoked → §5.1 reuse branch + int-spec step 4.
- [x] Logout revokes refresh-token server-side → §5.4 + int-spec step 5.
- [x] No JWT / refresh / session secret in localStorage / sessionStorage
      → §6.5 grep guard + playwright is overkill for this; the grep test
      covers the regression vector.
- [x] CSRF enforced on cookie-authenticated state-mutating endpoints →
      §5.2 + int-spec step 6.

---

## 9. Risks & open questions

- **CORS `credentials: true`** breaks the current wildcard. Existing
  dev setup uses `http://localhost:5173`; production should set
  `OL_CORS_ORIGIN` explicitly. Document in `apps/api/.env.example`.
- **`SameSite=Strict` + cross-origin SPA**: if the FE is served from a
  *different origin* than the API (dev: `localhost:5173` →
  `localhost:3000`), `SameSite=Strict` blocks the cookie on every
  cross-origin fetch. In dev, we need `SameSite=Lax` OR identical
  origins via a Vite proxy. Decision: use `Lax` in dev/test
  (`NODE_ENV !== 'production'`), `Strict` in prod. Document the trade-off
  in `docs/operations/auth-cookies.md` (new doc, short). The CSRF
  guard contract (cookie value equals `X-CSRF-Token` header) is
  identical under `Lax` and `Strict`, so int-specs (which run under
  `NODE_ENV=test` and see `Lax`) test the same code path.
- **Cookie domain**: not set explicitly → browser defaults to the
  origin host. Fine for both dev and prod (same-host deploys); document
  for the future ALB/CDN case.
- **Stale tabs after rotation**: a long-idle tab still holds the old
  in-memory access token (15 min max). On the first 401 it tries to
  refresh with whatever cookie the browser has — which is the latest
  one. So stale tabs auto-heal as long as no other tab triggered a
  reuse-detection event. If reuse was tripped, the stale tab gets 401
  from refresh and lands on `/login`. Acceptable.
- **Bootstrap-admin tests / int-test fixtures**: many specs hit
  `/auth/login` and use the returned token directly. They keep working
  unchanged — the `access_token` in the body is still the auth credential
  for the test runs.

---

## 10. Out-of-scope follow-ups

- Helmet / CSP middleware (separate finding from same audit).
- Admin UI for "active sessions" listing + per-session revoke.
- Per-user "logout everywhere" affordance — `revokeAllForUser` is
  already on the port; just no UI yet.
- E2E Playwright test that hits the live login flow. The grep + unit
  + int-spec coverage closes the regression vectors without the
  Playwright cost.
