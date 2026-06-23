# KSeF HTTP & Auth Layer (C3)

Hand-rolled `fetch`-based transport for the KSeF Public API v2 (no axios), plus
the authentication handshake. Mirrors the in-tree `AllegroHttpClient` precedent:
retries, rate-limit backoff, token lifecycle, structured logging — never logging
credential material.

## Environment → base URL

`resolveKsefBaseUrl(env)` (`ksef-hosts.ts`) maps the connection's `env` to the
`/api/v2` base. An unknown environment throws `KsefConfigException` before any
request leaves.

| env  | base URL                              |
|------|---------------------------------------|
| test | `https://ksef-test.mf.gov.pl/api/v2`  |
| demo | `https://ksef-demo.mf.gov.pl/api/v2`  |
| prod | `https://ksef.mf.gov.pl/api/v2`       |

> The exact hostnames are best-effort from the documented KSeF 2.0 sequence and
> are validated against the live test endpoint when the client is first exercised.

## Auth handshake (ksef-token flow)

1. `POST /auth/challenge` → `{ challenge, timestamp }`
2. `KsefTokenEncryptor` RSA-OAEP-wraps `token|timestamp` under the MF
   `KsefTokenEncryption` public key
3. `POST /auth/ksef-token` → `{ referenceNumber }` (async)
4. poll `GET /auth/{referenceNumber}` until `status=completed`
   (exponential backoff to 5 s, 300 s deadline)
5. `POST /auth/token/redeem` → `{ accessToken, refreshToken }` (JWTs)
6. `parseJwtExpiry(accessToken)` → cache TTL (read from `exp`, never hardcoded)

The **qualified-seal** flow (XAdES signing → `POST /auth/xades-signature`) is
DEFERRED to C4: it needs real X.509/HSM material and a vetted XML signing
library. `KsefAuthXmlBuilder.signXades` and the factory both throw
`KsefConfigException` for a qualified-seal connection until then.

## Token lifecycle

- The access token is produced lazily on the first authenticated request, then
  cached with a TTL read from the JWT `exp`.
- **Proactive refresh**: within 60 s of expiry the `refresh` callback rotates
  the token before the request (single-flight per client).
- **Reactive 401/403**: the client refreshes once and retries. The tagged
  `RefreshOnUnauthorizedOutcome` distinguishes `credential-rejected`
  (→ `KsefAuthenticationException`, non-retryable; the host's
  `AuthFailureClassifierPort` flips the connection to `needs_reauth`) from
  `network-failure` (→ `KsefNetworkException`, retryable).
- `/auth/*` and `/security/public-key-certificates` are unauthenticated — the
  client skips bearer injection so the handshake can bootstrap before any token.

## Retry + rate-limit policy

- Idempotent calls (`GET`, or `POST` with `options.idempotent`) retry transient
  failures (5xx / network) with exponential backoff (1 s → 30 s).
- Non-idempotent `POST` fails fast on 5xx/network.
- `429` always backs off (`Retry-After`-aware) and retries within the budget.
- Deterministic 4xx (other than 401/403) fail fast as `KsefApiException`.

## Security

No log line carries the access/refresh token, the `Authorization` header, the
plaintext ksef-token, or request/response bodies that may carry credential
material. Logs carry the trace id, method, path, status, and duration only.
