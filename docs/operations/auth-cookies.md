# Auth Cookies (Refresh-Token Rotation)

OpenLinker's admin authentication uses a **dual-token flow** introduced
in #710:

- **Access token** — short-lived JWT (15 min default), held in
  memory by the SPA, sent as `Authorization: Bearer …` on every API
  request. Never persisted client-side.
- **Refresh token** — long-lived (14 days), opaque random string,
  delivered to the browser as an `HttpOnly` cookie. Each successful
  refresh **rotates** the token; reusing a previously-rotated token
  trips a chain-revocation and forces re-login.

Two cookies are set at login and rotated at every refresh:

| Cookie       | HttpOnly | Purpose                                                   |
|--------------|----------|-----------------------------------------------------------|
| `ol_refresh` | yes      | The refresh-token value itself.                           |
| `ol_csrf`    | no       | Mirror for the double-submit CSRF check.                  |

Both cookies share the same `Path=/auth` so a single `Set-Cookie`
round-trip covers `/auth/refresh` and `/auth/logout`. They are not
sent to non-auth routes, but they ARE sent to `/auth/me`,
`/auth/forgot-password`, and `/auth/reset-password` (broader path
in exchange for one cookie pair instead of two). The cookies remain
`HttpOnly` (`ol_refresh`) and `SameSite=Strict` (production), so the
broader path widens the exfiltration surface only marginally — see
#710 review for the documented trade-off.

## SameSite policy

- **Production (`NODE_ENV=production`)** — `SameSite=Strict; Secure`.
  Blocks cookies on any cross-origin navigation.
- **Dev / test (`NODE_ENV !== 'production'`)** — `SameSite=Lax`,
  `Secure` off. Required because the SPA at `http://localhost:5173`
  makes cross-origin requests to the API at `http://localhost:3000`.
  `Strict` would prevent the cookie from ever reaching the API on a
  cross-origin POST.

The CSRF guard contract (`ol_csrf` cookie value equals
`X-CSRF-Token` header) is identical under both modes, so the
int-spec under `NODE_ENV=test` covers the same code path that ships
to production.

## CORS

The cookie flow requires `credentials: true` on CORS. The legacy
wildcard `app.enableCors()` is replaced with an explicit allow-list
via the `OL_CORS_ORIGIN` env var (comma-separated). Defaults to
`http://localhost:5173` for local Vite dev. Production deploys must
set it.

```
OL_CORS_ORIGIN=https://admin.example.com,https://staging.example.com
```

`*` is **not** a valid value under `credentials: true` per the CORS
spec; the API will reject any cross-origin request whose `Origin`
isn't in the allow-list.

## Threat model

What the flow protects:

- **XSS → token theft**. With the access token in memory and the
  refresh token in `HttpOnly`, neither is reachable from JavaScript.
  An XSS payload can call the API as long as the page is open, but
  it cannot exfiltrate a token for offline use.
- **Stolen cookie**. If a refresh cookie leaks (e.g. a browser
  history sync to a compromised device), the first time both the
  attacker and the victim try to refresh, one of them presents a
  token that's been rotated. Reuse-detection wipes every
  `refresh_tokens` row in the chain and forces re-login on every
  device — the victim notices.

What the flow does **not** protect:

- **Account takeover via password leak**. Out of scope for this
  control. Password-reset rate-limiting + MFA are the relevant
  defenses.
- **CSRF on non-cookie endpoints**. The `CsrfGuard` runs only on
  `/auth/refresh` and `/auth/logout`. State-mutating endpoints that
  rely on `Authorization: Bearer …` aren't CSRF-exposed because the
  bearer header is not auto-attached by the browser.
- **Server compromise**. If the API host is rooted, every active
  refresh token is decryptable from the DB (we store SHA-256 hashes,
  not the raw tokens, so the actual values are not recoverable —
  but the attacker can mint new refresh tokens at will).

## Operations

### Rotating the JWT signing secret

JWT secret lives in `JWT_SECRET`. To rotate:

1. Pick a new value (≥32 random bytes).
2. Deploy with both old and new accepted simultaneously (requires a
   future "jwks-style" rollover; not implemented yet — single-secret
   only today).
3. Single-secret rotation today: deploy the new secret; every active
   access token (max 15 min old) becomes invalid; clients silently
   refresh against the still-valid refresh cookie; users see no
   disruption.

### Forcing a global logout

There is no admin UI yet. To revoke every refresh token for a single
user manually:

```sql
UPDATE refresh_tokens
   SET revoked_at = now(), revoked_reason = 'logout'
 WHERE user_id = '<uuid>' AND revoked_at IS NULL;
```

After this, the next refresh attempt for any of the user's tabs
returns 401 + the SPA redirects to login.

## Configuration reference

| Env var                | Default                  | Notes                                                          |
|------------------------|--------------------------|----------------------------------------------------------------|
| `JWT_SECRET`           | (required)               | HS256 signing key for access tokens.                           |
| `JWT_EXPIRES_IN`       | `15m`                    | Access-token TTL. Override only with a clear threat-model PR.  |
| `OL_CORS_ORIGIN`       | `http://localhost:5173`  | Comma-separated allow-list. Production must set explicitly.    |

Refresh-token TTL is hard-coded at 14 days in
`apps/api/src/auth/refresh-token.types.ts` (`REFRESH_TOKEN_TTL_MS`)
— change it in code, not env, so the trade-off is reviewable.
