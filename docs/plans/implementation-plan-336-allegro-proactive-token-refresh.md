# Implementation Plan — #336 Proactive Allegro access-token refresh

**Issue:** [#336](https://github.com/openlinker-project/openlinker/issues/336) — Proactive Allegro access-token refresh using `expiresAt` (avoid first-request 401)
**Layer:** Integration (`libs/integrations/allegro`)
**Branch:** `336-allegro-proactive-token-refresh`

---

## 1. Goal

Make `AllegroHttpClient` refresh the access token *before* it hits an Allegro API request, using the `expiresAt` already persisted on `AllegroCredentials`. Today the client only refreshes reactively on a 401 — every first request after idle eats an extra round-trip. Keep the reactive 401 path as a safety net.

### In scope
- Thread `expiresAt` into `AllegroHttpClient` (already on `AllegroCredentials`).
- Proactively refresh when `Date.now() >= expiresAt - 60_000`.
- Serialize concurrent refresh attempts inside one client instance (single-flight).
- Update the cached `expiresAt` after a successful refresh so the next request sees fresh expiry.
- Unit test coverage for: near-expiry refreshes, valid token doesn't refresh, concurrent single-flight, reactive fallback preserved, missing-expiry = no-op.

### Non-goals
- Distributed single-flight across processes — already handled by `AllegroTokenRefreshService`'s Redis lock. Per-instance single-flight here is an additional guard against thundering herd inside a single Node process.
- Changing the token refresh mechanism itself (`AllegroTokenRefreshService`).
- Background refresh worker. Pre-request check is enough for the target workloads.
- Changing credential storage shape.

---

## 2. Current behaviour (from the issue)

- `AllegroHttpClient` constructor (`libs/integrations/allegro/src/infrastructure/http/allegro-http-client.ts:67-81`) reads `credentials.accessToken` only; `credentials.expiresAt` is ignored.
- `handleError` (lines 332-382) is the sole refresh path — runs only on 401 with "token"-ish body text.
- `AllegroCredentials.expiresAt` (`domain/types/allegro-credentials.types.ts:32`) is `Date | string | undefined`. Populated by `allegro-oauth.service.ts` and `allegro-token-refresh.service.ts`.
- Factory (`application/allegro-adapter.factory.ts:55-73`) builds `tokenRefreshCallback: (connectionId) => Promise<string>` from `AllegroTokenRefreshService.refreshToken()` — the service actually returns `TokenRefreshResponse { accessToken, refreshToken?, expiresAt? }`, but the callback currently throws away everything except `accessToken`.

Callsites of `new AllegroHttpClient(...)`:
1. `application/allegro-adapter.factory.ts:67` — production path (sync/runtime), passes the refresh callback.
2. `infrastructure/adapters/allegro-connection-tester.adapter.ts:45` — short-lived, one-shot probe against `/me`. No refresh callback. Must stay unchanged behaviorally.

---

## 3. Design

### 3.1 Cached expiry

Store `expiresAt` inside `AllegroHttpClient` as a normalized epoch-ms number:

```ts
private tokenExpiresAt: number | undefined;
```

Normalize in the constructor:

```ts
this.tokenExpiresAt = this.normalizeExpiresAt(credentials.expiresAt);
```

- `Date` → `.getTime()` (check `Number.isFinite` in case of an Invalid Date)
- `string` → `Date.parse(v)`, then `Number.isFinite(n)` — if not finite, return `undefined`
- `undefined` → `undefined` (proactive refresh becomes a no-op — preserves backward compat for connections without `expiresAt`)

**Invalid-value handling:** `Date.parse('garbage')` returns `NaN`. An un-guarded `tokenExpiresAt = NaN` would make every `Date.now() >= NaN - 60_000` comparison evaluate to `false`, silently disabling proactive refresh. Worse, if we ever flipped the comparison, `NaN` could make it always true. So: **always reduce NaN / Invalid Date to `undefined`** and let the backward-compat no-op handle it. Test coverage includes a garbage-string case.

### 3.2 Single-flight refresh promise

```ts
private refreshInFlight: Promise<void> | null = null;
```

One in-flight refresh at a time per client instance. Callers await the same promise; they don't start new ones.

**Scope note:** this is **per-instance** single-flight. Cross-process / cross-instance protection is already provided by `AllegroTokenRefreshService`'s Redis `SET NX EX` lock (`allegro-token-refresh.service.ts:252-272`). Per-instance single-flight only matters if one `AllegroHttpClient` lives long enough to see truly-parallel requests (e.g., a sync worker running `Promise.all([...])` over a list of offer updates). Verify during Phase 4 whether `IntegrationsService` / `AdapterRegistryService` caches adapters per-connection or constructs a new one per operation:

- **If cached per-connection**: per-instance single-flight is a real latency win on bursty workloads.
- **If one-adapter-per-operation**: the guard is still cheap & correct but does little beyond what the Redis lock already does. In that case the PR description should frame it as "defense-in-depth" rather than "no thundering herd".

Either way the implementation is unchanged — only the PR narrative adjusts to what's true.

### 3.2.1 Negative cache on proactive-refresh failure

When `performProactiveRefresh` throws, `refreshInFlight` clears in `.finally()`. If the token is already past `expiresAt - 60s` and the refresh endpoint is consistently failing, every subsequent request re-attempts the proactive refresh before falling through to the reactive 401 path. Not a correctness problem — the reactive path is still the ceiling — but it creates N-times the call volume on the refresh endpoint during an outage.

Add a small negative cache:
```ts
private proactiveRefreshCooldownUntil: number | undefined;
private static readonly PROACTIVE_REFRESH_FAILURE_COOLDOWN_MS = 5_000;
```

On failure, set `proactiveRefreshCooldownUntil = Date.now() + PROACTIVE_REFRESH_FAILURE_COOLDOWN_MS`. In `ensureFreshToken`, short-circuit if `Date.now() < proactiveRefreshCooldownUntil`. This caps proactive attempts at one every 5 seconds during an endpoint outage while keeping the reactive 401 path fully functional.

### 3.3 Widen the refresh callback return type

Today:
```ts
tokenRefreshCallback?: (connectionId: string) => Promise<string>;
```

New: introduce a dedicated types file `libs/integrations/allegro/src/infrastructure/http/allegro-http-client.types.ts` (per Engineering Standards "Type Definitions in Separate Files" — types don't belong in the implementation file):

```ts
// allegro-http-client.types.ts
export interface TokenRefreshResult {
  accessToken: string;
  expiresAt?: Date | string;
}

export type TokenRefreshCallback = (connectionId: string) => Promise<TokenRefreshResult>;
```

Then in the HTTP client:
```ts
import { TokenRefreshCallback } from './allegro-http-client.types';

tokenRefreshCallback?: TokenRefreshCallback;
```

**Why:** proactive refresh must also update `tokenExpiresAt`, otherwise the client keeps thinking the (now-refreshed) token is expiring and re-refreshes every request. The factory already has this data — `AllegroTokenRefreshService.refreshToken()` returns `TokenRefreshResponse` which includes `expiresAt`. We just stop discarding it.

**Type placement note:** `AllegroHttpRequestOptions` / `AllegroHttpResponse` currently sit inside `allegro-http-client.interface.ts` — pre-existing deviation from the `.types.ts` rule. Out of scope for this issue; we don't reshuffle unrelated code. The new types go in `allegro-http-client.types.ts` and we stop adding to the interface file.

### 3.4 Pre-request `ensureFreshToken()`

Called at the top of `executeRequest` *before* the `Authorization` header is built:

```ts
private async ensureFreshToken(traceId: string): Promise<void> {
  if (!this.tokenRefreshCallback || this.tokenExpiresAt === undefined) {
    return; // no callback or no expiry → nothing to do (reactive path still applies)
  }
  if (
    this.proactiveRefreshCooldownUntil !== undefined &&
    Date.now() < this.proactiveRefreshCooldownUntil
  ) {
    return; // recent proactive refresh failed; wait out the cooldown and let reactive 401 handle it
  }
  const refreshAt = this.tokenExpiresAt - TOKEN_REFRESH_WINDOW_MS;
  if (Date.now() < refreshAt) {
    return; // well within validity
  }
  if (this.refreshInFlight) {
    await this.refreshInFlight; // piggyback on in-flight refresh
    return;
  }
  this.refreshInFlight = this.performProactiveRefresh(traceId)
    .finally(() => { this.refreshInFlight = null; });
  await this.refreshInFlight;
}

private async performProactiveRefresh(traceId: string): Promise<void> {
  try {
    this.logger.debug(
      `[${traceId}] Proactive token refresh (connection: ${this.connectionId})`,
    );
    const { accessToken, expiresAt } = await this.tokenRefreshCallback!(this.connectionId);
    this.accessToken = accessToken;
    this.tokenExpiresAt = this.normalizeExpiresAt(expiresAt);
    this.proactiveRefreshCooldownUntil = undefined; // success clears any cooldown
  } catch (error) {
    // Swallow: reactive 401 path is the fallback (per AC).
    this.proactiveRefreshCooldownUntil =
      Date.now() + AllegroHttpClient.PROACTIVE_REFRESH_FAILURE_COOLDOWN_MS;
    this.logger.warn(
      `[${traceId}] Proactive token refresh failed, will fall back to reactive 401 path: ${(error as Error).message}`,
    );
  }
}
```

**Constant:** `const TOKEN_REFRESH_WINDOW_MS = 60_000;` top-of-file alongside other constants.

**Trace-id caveat:** under single-flight, concurrent requests B and C await the refresh started by A and so the refresh log line carries A's traceId. Downstream logs for B/C still carry their own traceIds. Correlation stays sensible because B and C log their own request lines separately; the shared refresh just shows up under A's trace. Matches the reactive-path semantics. Not worth minting a dedicated refresh traceId.

### 3.5 Reactive 401 path update

In `handleError`, when a reactive refresh succeeds, also update `tokenExpiresAt` using the same widened callback. This keeps the two paths consistent — after *any* refresh, the cached expiry reflects the new token.

```ts
const { accessToken, expiresAt } = await this.tokenRefreshCallback(this.connectionId);
this.accessToken = accessToken;
this.tokenExpiresAt = this.normalizeExpiresAt(expiresAt);
```

### 3.6 Factory callback widening

`allegro-adapter.factory.ts` — simplify to just return the full response:

```ts
const tokenRefreshCallback = this.tokenRefreshService
  ? async (_connectionId: string): Promise<TokenRefreshResult> => {
      const res = await this.tokenRefreshService!.refreshToken(connection, credentialsResolver);
      return { accessToken: res.accessToken, expiresAt: res.expiresAt };
    }
  : undefined;
```

Also pass the full `credentials` (already does — just making sure `expiresAt` flows).

### 3.7 Connection tester adapter

No change needed. It constructs the client without a refresh callback; `ensureFreshToken()` short-circuits in that case. Signature-wise, the new `credentials.expiresAt` is already accepted.

---

## 4. Step-by-step

### File: `libs/integrations/allegro/src/infrastructure/http/allegro-http-client.types.ts` (new)

1. Export `interface TokenRefreshResult { accessToken: string; expiresAt?: Date | string }`.
2. Export `type TokenRefreshCallback = (connectionId: string) => Promise<TokenRefreshResult>`.

### File: `libs/integrations/allegro/src/infrastructure/http/allegro-http-client.ts`

3. Import `TokenRefreshCallback` from `./allegro-http-client.types`.
4. Add `TOKEN_REFRESH_WINDOW_MS = 60_000` module-level constant.
5. Add `static readonly PROACTIVE_REFRESH_FAILURE_COOLDOWN_MS = 5_000` on the class.
6. Change `tokenRefreshCallback` parameter & field type from `(connectionId: string) => Promise<string>` to `TokenRefreshCallback`.
7. Add `private tokenExpiresAt: number | undefined`, initialize from `credentials.expiresAt` via new private `normalizeExpiresAt`.
8. Add `private refreshInFlight: Promise<void> | null = null`.
9. Add `private proactiveRefreshCooldownUntil: number | undefined`.
10. Add `private async ensureFreshToken(traceId: string)` (logic in §3.4).
11. Add `private async performProactiveRefresh(traceId: string)` (logic in §3.4).
12. Add `private normalizeExpiresAt(v: Date | string | undefined): number | undefined` — guard NaN / Invalid Date to `undefined` (§3.1).
13. Call `await this.ensureFreshToken(traceId)` at the top of `executeRequest` (just after `traceId` is created, before building headers).
14. Update the reactive 401 branch in `handleError` to unpack `{ accessToken, expiresAt }` and update both `this.accessToken` and `this.tokenExpiresAt` (and clear `proactiveRefreshCooldownUntil` on success, for symmetry).

**AC for this file:**
- No behavior change when `credentials.expiresAt` is absent or when no `tokenRefreshCallback` is provided (backward compat).
- Proactive refresh fires only once per expiry window even under concurrent `request()` calls.
- Reactive 401 path still works.

### File: `libs/integrations/allegro/src/application/allegro-adapter.factory.ts`

15. Import `TokenRefreshResult` from `../infrastructure/http/allegro-http-client.types`.
16. Update the `tokenRefreshCallback` definition to return the full result (accessToken + expiresAt).

### File: `libs/integrations/allegro/src/infrastructure/http/__tests__/allegro-http-client.spec.ts`

17. Add a new `describe('proactive token refresh')` block with the following tests:
    - `does not trigger proactive refresh when no expiresAt is set (backward compat)`
    - `does not trigger proactive refresh when no refresh callback is provided`
    - `treats a garbage expiresAt string as no expiry (no-op, no refresh)` — covers the NaN guard from §3.1
    - `does not trigger refresh when token is well within validity`
    - `triggers proactive refresh when token is within 60s of expiry`
    - `uses refreshed accessToken on subsequent requests`
    - `updates cached expiresAt from refresh result so it does not re-refresh immediately`
    - `serializes concurrent refresh attempts (single-flight)` — 3 parallel `get()` calls with an expiring token and a slow refresh should result in exactly 1 refresh callback invocation and 3 fetches with the new token
    - `falls through to reactive 401 path when proactive refresh throws`
    - `honours proactive-refresh cooldown after a failure` — two quick requests after a failed proactive refresh trigger exactly 1 callback invocation (the second hits the cooldown short-circuit), and advancing time past `PROACTIVE_REFRESH_FAILURE_COOLDOWN_MS` allows a new proactive attempt

   Fake timers + `jest.setSystemTime()` to control `Date.now()`. Existing suite uses fake timers already.

18. Update the existing reactive 401 tests (if any) to the new widened callback shape. A quick grep of the current file shows the reactive path is not unit tested today — only the 401 *rejection without callback* case is tested (`'should not retry on authentication errors'`). Good: the widened signature doesn't break anything that already exists. No edits needed in the existing tests.

---

## 5. Architecture & standards check

- ✅ Integration boundary preserved — all changes in `libs/integrations/allegro`, CORE untouched.
- ✅ `AllegroHttpClient` already has file header, matches naming (`*-http-client.ts`, not a port).
- ✅ No `any`, no `console.log`, no hardcoded secrets.
- ✅ Types: new `TokenRefreshResult` exported from the http client module (co-located with the callback signature it describes; small interface used only there).
- ✅ Logging: reuse existing `Logger`, include `traceId` and `connectionId` in messages.
- ✅ Tests use fake timers pattern already established in the spec (see file header comment, #287 history).

## 6. Risks & open questions

- **Callback signature widening is a micro-breaking change** for anyone constructing `AllegroHttpClient` with a custom refresh callback. Only one production callsite (the factory) and zero in tests — low blast radius.
- **Proactive refresh error handling**: swallowing the error means the request continues with the old token and may 401, which then triggers the reactive path. This matches the AC ("Reactive 401 refresh path is preserved as a fallback"). I'm intentionally *not* re-throwing from `performProactiveRefresh` so a transient refresh-endpoint hiccup doesn't block requests that might still have a valid token (clock skew, etc.). The 5s negative cache (§3.2.1) caps re-attempts during a sustained refresh-endpoint outage.
- **Clock skew**: the 60s window gives enough buffer for typical clock drift. Not worth making configurable for now.
- **Adapter caching scope for single-flight** (verify in Phase 4): `IntegrationsService` / `AdapterRegistryService` caching determines whether per-instance single-flight is a real latency win or defense-in-depth. Either outcome leaves the implementation unchanged — only the PR description adjusts (see §3.2).

## 7. Quality gate

Before commit:
```
pnpm lint
pnpm type-check
pnpm test
```

All three must be green. Integration tests not needed — no DB/Redis changes.
