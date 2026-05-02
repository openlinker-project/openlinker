# Implementation Plan — #499 Distinguish network failures from auth failures during Allegro token refresh

## 1. Goal

Stop classifying transient network failures (`TypeError: fetch failed`, ECONNREFUSED, DNS, AbortError) as permanent `AllegroAuthenticationException`. A 1-second blip on `auth.allegro.pl` currently kills `marketplace.orders.poll` on attempt 1/10 and requires manual intervention. After this change the runner retries with exponential backoff while genuine credential rejections (refresh-token revoked, client-creds wrong) continue to mark the job dead immediately.

## 2. Layer

Pure Integration. No CORE changes. No port-contract changes. Worker classifier (`SyncJobRunner.isNonRetryableError`) requires no change as long as we introduce the new exception class outside its non-retryable allowlist.

## 3. Non-goals (explicit)

- **No** broadening to other integrations. Same lossy boolean exists in PrestaShop adapters; track separately.
- **No** UI surfacing of transient-vs-permanent in the job-detail page. Worth a follow-up after BE classification is correct.
- **No** retry-policy changes — existing exponential backoff stays as-is.
- **No** changes to the proactive-refresh cooldown semantics. The cooldown is correct ("don't hammer a sick endpoint") regardless of cause; only the reactive path's lossy boolean is the bug.
- **No** new tests for sandbox connectivity. We mock `fetch` in unit tests.

## 4. Reuse map (codebase research)

| Existing artefact | Used as |
|---|---|
| `AllegroAuthenticationException` (`libs/integrations/allegro/src/domain/exceptions/allegro-authentication.exception.ts`) | Stays the genuine-credential-rejection class. Continues to be on the runner's non-retryable list. |
| `AllegroApiException` (existing exception with `statusCode`) | Untouched — already covers retryable 5xx via runner default + non-retryable specific 4xx via `NON_RETRYABLE_ALLEGRO_STATUS_CODES`. |
| `AllegroConnectionTokenState.refreshOnUnauthorized` (`allegro-connection-token-state.ts:108`) | Currently returns `boolean`. Will be replaced with a tagged result that distinguishes network failures from credential failures. |
| `AllegroConnectionTokenState.performProactiveRefresh` (`allegro-connection-token-state.ts:135`) | Already swallows-and-cooldowns; no change needed — proactive refresh failures fall through to the reactive 401 path which is where the fix lives. The log line gains specificity (network vs other) but behavior is preserved. |
| `AllegroHttpClient.handleError` 401 branch (`allegro-http-client.ts:411-424`) | Branch on the new tagged result; throw `AllegroNetworkException` for network-shaped failures, keep `AllegroAuthenticationException` for genuine rejection. |
| `AllegroTokenRefreshService.performTokenRefresh` (line ~208) | Wrap the bare `await fetch(tokenUrl, ...)` in try/catch and emit `AllegroNetworkException` on network errors. |
| `SyncJobRunner.isNonRetryableError` (`apps/worker/src/sync/sync-job.runner.ts:346`) | No change required — `AllegroNetworkException` is not on the non-retryable list, so it goes through the standard retry/backoff path. Add an explicit comment so future readers don't add it by mistake. |
| Public barrel `libs/integrations/allegro/src/index.ts` | Export `AllegroNetworkException` so the worker-side classifier can `instanceof`-check it if/when it ever needs to. |

## 5. Steps

### Step 1 — New domain exception
**File**: `libs/integrations/allegro/src/domain/exceptions/allegro-network.exception.ts` (new)

```ts
/**
 * Allegro Network Exception
 *
 * Thrown when an HTTP request to Allegro could not reach the endpoint
 * (DNS failure, TLS error, connection refused, timeout, abort). Distinct
 * from `AllegroAuthenticationException` (Allegro responded with 401) and
 * `AllegroApiException` (Allegro responded with non-2xx). Net-level
 * failures are transient and the runner SHOULD retry — never add this
 * class to non-retryable allowlists. (#499)
 */
export class AllegroNetworkException extends Error {
  constructor(
    message: string,
    public readonly url?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AllegroNetworkException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AllegroNetworkException);
    }
  }
}
```

Export from `libs/integrations/allegro/src/index.ts`.

### Step 2 — Tagged-result type for refresh outcome
**File**: `libs/integrations/allegro/src/infrastructure/http/allegro-http-client.types.ts` (extend)

Per `engineering-standards.md` §"Union Types: `as const` Pattern", enumerated reason values must be a `const … as const` array + derived union, not an inline string union:

```ts
export const RefreshOutcomeReasonValues = [
  'no-callback',
  'credential-rejected',
  'network-failure',
] as const;
export type RefreshOutcomeReason = (typeof RefreshOutcomeReasonValues)[number];

export type RefreshOnUnauthorizedOutcome =
  | { ok: true }
  | { ok: false; reason: RefreshOutcomeReason; cause?: Error };
```

Why a tagged result over re-throw: the reactive path's caller (`AllegroHttpClient.handleError` 401 branch) already has its own logging + exception-creation logic per branch. A tagged result lets the caller stay declarative.

### Step 3 — Token-refresh service: surface network failures
**File**: `libs/integrations/allegro/src/infrastructure/token-refresh/allegro-token-refresh.service.ts` (~line 208)

Wrap the bare `fetch()`:
```ts
let response: Response;
try {
  response = await fetch(tokenUrl.toString(), { ... });
} catch (cause) {
  // TypeError: fetch failed, AbortError, DNS, ECONNREFUSED — all transient.
  throw new AllegroNetworkException(
    `Token refresh network failure: ${(cause as Error).message}`,
    tokenUrl.toString(),
    { cause },
  );
}
if (!response.ok) {
  // Auth endpoint responded — credential genuinely rejected (or upstream
  // 5xx, but those are rare on auth endpoints; classify as
  // AllegroAuthenticationException so the job dies once and surfaces).
  ...existing string-throw stays for now (callers still treat it as auth failure)
}
```

The post-`!response.ok` `throw new Error(...)` path is **not** reclassified in this PR — that's a 4xx/5xx from Allegro's auth endpoint, which is the credential-rejection path that should stay non-retryable. Documented explicitly via the `// network failure → throw network exception; HTTP error → existing path` comment so the next reviewer doesn't widen it.

### Step 4 — Token state: tagged result on the reactive path
**File**: `libs/integrations/allegro/src/infrastructure/http/allegro-connection-token-state.ts` (line 108–128)

```ts
async refreshOnUnauthorized(
  traceId: string,
  logger: Logger,
): Promise<RefreshOnUnauthorizedOutcome> {
  if (!this.tokenRefreshCallback) {
    return { ok: false, reason: 'no-callback' };
  }
  try {
    logger.warn(`[${traceId}] Access token expired, attempting refresh ...`);
    const result = await this.tokenRefreshCallback(this.connectionId);
    this.applyRefreshResult(result);
    logger.log(`[${traceId}] Access token refreshed successfully ...`);
    return { ok: true };
  } catch (error) {
    if (error instanceof AllegroNetworkException) {
      logger.warn(`[${traceId}] Token refresh network failure (transient): ${error.message} ...`);
      return { ok: false, reason: 'network-failure', cause: error };
    }
    logger.error(`[${traceId}] Token refresh failed: ${(error as Error).message} ...`);
    return { ok: false, reason: 'credential-rejected', cause: error as Error };
  }
}
```

Note the log-level distinction: network failure → `warn` (transient, will retry), credential rejection → `error` (operator action needed).

### Step 5 — HTTP client: branch on the outcome
**File**: `libs/integrations/allegro/src/infrastructure/http/allegro-http-client.ts:411-424`

```ts
if (isTokenExpired) {
  const outcome = await this.tokenState.refreshOnUnauthorized(traceId, this.logger);
  if (outcome.ok) {
    throw new TokenRefreshedError('Token refreshed, retry request');
  }
  if (outcome.reason === 'network-failure') {
    // Transient — runner retries. Don't masquerade this as an auth failure.
    throw new AllegroNetworkException(
      `Allegro token refresh failed due to network error: ${outcome.cause?.message ?? 'unknown'}`,
      url,
      { cause: outcome.cause },
    );
  }
  // 'no-callback' or 'credential-rejected' → genuine auth failure path.
}

this.logger.error(`[${traceId}] Authentication failed: Invalid or expired access token`);
throw new AllegroAuthenticationException(
  `Authentication failed: Invalid or expired access token for ${url}`,
  statusCode,
  url,
);
```

### Step 6 — Worker runner: explicit comment on `AllegroNetworkException`
**File**: `apps/worker/src/sync/sync-job.runner.ts:346` (`isNonRetryableError`)

No code change. Add a comment alongside the existing "Retryable cases intentionally left out" block:

```
 * - AllegroNetworkException — transient network failure during token refresh /
 *   API request. Retry with backoff; never mark dead.
```

This is documentation-only but prevents the bug from re-emerging if a future contributor sees `AllegroAuthenticationException` non-retryable and decides to "be consistent" by adding the network class too.

### Step 7 — Tests
**Files**:
- `libs/integrations/allegro/src/infrastructure/token-refresh/__tests__/allegro-token-refresh.service.spec.ts` — extend (or create if missing) — `fetch` rejects with `TypeError: fetch failed` → `AllegroNetworkException` thrown; `fetch` resolves with 401 → existing `Error('Failed to refresh access token...')` thrown. Cover the `cause` chain assertion (`error.cause` is the underlying `TypeError`) here too — no need for a standalone `AllegroNetworkException.spec.ts` (existing sibling exceptions like `allegro-rate-limit.exception.ts` ship without colocated specs; consistency matters).
- `libs/integrations/allegro/src/infrastructure/http/__tests__/allegro-connection-token-state.spec.ts` — extend — refresh callback throws `AllegroNetworkException` → `refreshOnUnauthorized` returns `{ ok: false, reason: 'network-failure', cause }`; refresh callback throws `Error` → returns `{ ok: false, reason: 'credential-rejected' }`. **Regression assertion** for the proactive path: `performProactiveRefresh` callback throws `AllegroNetworkException` → cooldown still set (proactive behavior unchanged regardless of cause type).
- `libs/integrations/allegro/src/infrastructure/http/__tests__/allegro-http-client.spec.ts` — extend — 401 + network-failure outcome → thrown error is `AllegroNetworkException`; 401 + credential-rejected outcome → `AllegroAuthenticationException` (existing behavior preserved).
- `apps/worker/src/sync/__tests__/sync-job.runner.spec.ts` — extend — `AllegroNetworkException` thrown from a job → not classified non-retryable; `AllegroAuthenticationException` still classified non-retryable.

## 6. Risks

- **R1 — Existing tests rely on `refreshOnUnauthorized` returning `boolean`.** Audit + update. Consumer is only `AllegroHttpClient.handleError` 401 branch, so blast radius is contained.
- **R2 — A 5xx response from `auth.allegro.pl` (rare but possible) currently throws a generic `Error("Failed to refresh access token: 503 ...")` from the token-refresh service. That path is preserved — runner sees the error wrapped as `AllegroAuthenticationException` and marks dead. This may be wrong (5xx is transient), but fixing it widens scope. Track in a follow-up; today's bug is the network-level class which is far more common in practice.
- **R3 — Tagged-result return type adds a small API surface.** Mitigation: `RefreshOnUnauthorizedOutcome` is internal to `infrastructure/http/`; never exported across the package boundary. Public barrel only re-exports `AllegroNetworkException`.

## 7. Acceptance criteria

- [ ] `AllegroNetworkException` lives under `libs/integrations/allegro/src/domain/exceptions/` and is re-exported from the package barrel.
- [ ] `AllegroTokenRefreshService` wraps the bare `fetch(tokenUrl, ...)` call in try/catch and throws `AllegroNetworkException` for connection-level failures.
- [ ] `AllegroConnectionTokenState.refreshOnUnauthorized` returns a tagged `RefreshOnUnauthorizedOutcome` distinguishing `ok` / `network-failure` / `credential-rejected` / `no-callback`.
- [ ] `AllegroHttpClient.handleError` 401 branch throws `AllegroNetworkException` when refresh failed for network reasons; `AllegroAuthenticationException` only when the auth endpoint actually responded with 4xx (or no callback was registered).
- [ ] `SyncJobRunner.isNonRetryableError` continues to mark `AllegroAuthenticationException` non-retryable; `AllegroNetworkException` flows through normal retry/backoff.
- [ ] Unit tests:
  - Network failure during token refresh → `AllegroNetworkException` propagates → runner retries.
  - Auth endpoint responds 400 with `invalid_grant` → `AllegroAuthenticationException` → runner marks dead.
  - Reactive 401 path: refresh succeeds → `TokenRefreshedError` (existing behavior, unchanged).
- [ ] No regression in existing offer-create / orders-poll happy paths.
- [ ] Quality gate: `pnpm lint && pnpm type-check && pnpm test` green across the monorepo.

## 8. Out of scope (parking lot for follow-ups)

- Generalize the network-vs-auth distinction to non-token-refresh Allegro requests (e.g., a fetch failure on `GET /sale/offers` currently bubbles up as a generic Axios/fetch error and may already be retried; verify and document).
- Apply the same lossy-error audit to PrestaShop adapter token paths.
- Surface transient-vs-permanent in the job-detail FE.
- Reclassify auth-endpoint 5xx responses as transient (R2 above).
- **Type the credential-rejection path** — the bare `Error('Failed to refresh access token: ...')` thrown from `allegro-token-refresh.service.ts:222` is the credential-rejection path. Today it's flat: only the message string carries signal. A future PR could lift it to `AllegroCredentialRejectionException` (parallel to `AllegroNetworkException`), at which point downstream surfaces (operator UI, metrics) can classify properly.
