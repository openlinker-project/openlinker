# Implementation Plan: #370 — Allegro OAuth `fetch failed` swallows `error.cause`

## 1. Task Understanding

**Goal**: Make Allegro OAuth network failures diagnosable. When a `fetch()` to Allegro's token endpoint fails at the network layer, the API should log enough detail (`error.cause.code`, `error.cause.message`) for an operator to classify the failure (DNS, TLS, refused connection, timeout) without attaching a debugger. Additionally, bound the token-exchange request with a timeout so a hung endpoint doesn't pin the request.

**Layer**: Backend / Interface (API application service).

**Non-goals** (out of scope per the issue):
- The underlying Allegro/network failure itself.
- URL configuration changes or adding `ALLEGRO_BASE_URL` overrides.
- Rewriting the OAuth flow or changing the auth model.
- Moving to a different HTTP client (native `fetch` is deliberate per `docs/architecture-overview.md` for simple one-off calls).
- Changes to any other adapter or service.

## 2. Research findings

**File of interest**: `apps/api/src/integrations/application/services/allegro-oauth.service.ts`.

Two network-touching methods share the same defect:

1. **`exchangeCodeForToken`** (lines 139–195) — POST to `/auth/oauth/token` with `grant_type=authorization_code`.
2. **`refreshToken`** (lines 357–411) — POST to the same endpoint with `grant_type=refresh_token`.

Both catch blocks:
```ts
this.logger.error(`Error exchanging code for token: ${(error as Error).message}`, error);
throw new InternalServerErrorException('Failed to exchange authorization code for token');
```

For an undici network failure, `(error as Error).message` is the literal string `"fetch failed"`. The useful detail lives on `error.cause` (a sub-error with `code` like `ENOTFOUND`/`ECONNREFUSED`/`UND_ERR_CONNECT_TIMEOUT` and a human-readable `message`). Neither is ever read or logged.

Neither `fetch` call has an `AbortController` or timeout, so a hung endpoint pins the request until the OS-level TCP timeout (~2 minutes).

**Secret-safety audit** (of what currently reaches the log formatter):
- The error comes from `fetch()` itself, not from a response body — no Allegro-side payload in the error. Safe.
- `Authorization` header (Basic `clientId:clientSecret`) and the request body (`code`, `refresh_token`) live on the `RequestInit` object, not on any thrown `TypeError`. Safe.
- `error.cause` from undici is a small shape `{ code?: string; message?: string; errno?: number; syscall?: string }` — no secret material.
- The URL (`https://allegro.pl.allegrosandbox.pl/auth/oauth/token`) is not secret. We already log `environment` on the debug line at the top of each method, so we don't need to add the URL to the error log.

**Logger signature** (`libs/shared/src/logging/logger.ts`): wraps NestJS `Logger`; `error(message, trace?)` takes a string trace. The existing code passes the full `error` object as the second argument, which NestLogger will coerce to its string representation. That's a pre-existing ergonomic wart; we'll tighten it to pass `err.stack` in the modified catch blocks so the trace is a string, not a coerced object.

**Existing tests** (`allegro-oauth.service.spec.ts`): already stubs `global.fetch` and restores it in `afterEach`. One test for `exchangeCodeForToken`'s non-OK response branch exists. We'll extend the same test suite with new cases — no new test file needed.

## 3. Solution

### 3.1 Helper: format fetch errors with `cause` drained

Keep the helper private to the service (it's only used by the two methods that call `fetch`). Not worth extracting to shared code for two call sites.

Narrow `unknown` via `instanceof Error` (per `engineering-standards.md` → *Type Safety*) rather than casting. Also handle `AggregateError`-shaped causes (undici surfaces these on DNS fan-out / happy-eyeballs failures, where the useful info lives on `cause.errors[]`, not `cause.code`).

```ts
private formatFetchError(error: unknown): string {
  if (!(error instanceof Error)) {
    return `non-error thrown: ${String(error)}`;
  }
  if (error.name === 'AbortError') {
    return `request aborted after ${ALLEGRO_OAUTH_TIMEOUT_MS}ms`;
  }
  const baseMessage = error.message || 'unknown error';
  const cause = (error as Error & { cause?: unknown }).cause;

  if (cause && typeof cause === 'object') {
    // AggregateError-shaped: { errors: Error[] } — surface joined codes
    if ('errors' in cause && Array.isArray((cause as { errors: unknown[] }).errors)) {
      const codes = (cause as { errors: unknown[] }).errors
        .map((e) =>
          e && typeof e === 'object' && 'code' in e
            ? (e as { code?: unknown }).code
            : undefined,
        )
        .filter((c): c is string => typeof c === 'string');
      const codeSummary = codes.length > 0 ? codes.join(', ') : 'unknown';
      return `${baseMessage} (cause: aggregate — ${codeSummary})`;
    }

    const codeProp = (cause as { code?: unknown }).code;
    const messageProp = (cause as { message?: unknown }).message;
    const causeCode = typeof codeProp === 'string' ? codeProp : 'unknown';
    const causeMessage = typeof messageProp === 'string' ? messageProp : 'n/a';
    return `${baseMessage} (cause: ${causeCode} — ${causeMessage})`;
  }

  return `${baseMessage} (cause: unknown — n/a)`;
}
```

### 3.2 Helper: bounded fetch via `AbortController`

```ts
private async fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
```

### 3.3 Constants

Add a module-level constant near the top of the file:

```ts
const ALLEGRO_OAUTH_TIMEOUT_MS = 10_000;
```

10 seconds is well above typical Allegro token-endpoint latency and well below any caller's request timeout.

### 3.4 Updated catch blocks

Fold `environment` into the error line so a single log grep gives the full picture (debug-level lines may be filtered in prod). Use `error instanceof Error` for the `.stack` access instead of a cast.

Both `exchangeCodeForToken` and `refreshToken`:

```ts
} catch (error) {
  if (error instanceof BadRequestException) throw error;
  const formatted = this.formatFetchError(error);
  this.logger.error(
    `Error exchanging code for token (environment: ${environment}): ${formatted}`,
    error instanceof Error ? error.stack : undefined,
  );
  throw new InternalServerErrorException('Failed to exchange authorization code for token');
}
```

(In `refreshToken` the log prefix is `"Error refreshing token"` — matches the existing text.)

### 3.5 What's deliberately *not* changed

- The thrown `InternalServerErrorException` message stays generic — we don't want `error.cause` bleeding into an HTTP response body returned to the user.
- The non-OK branch (`if (!response.ok)`) is untouched — it already logs `status`, `statusText`, and the response body, which is the right level of detail there.
- No changes to public method signatures.

## 4. Step-by-step

### Step 1 — Add constant + helpers to `AllegroOAuthService`

**File**: `apps/api/src/integrations/application/services/allegro-oauth.service.ts`

- Add `const ALLEGRO_OAUTH_TIMEOUT_MS = 10_000;` near the other module-level constants (above the class).
- Add private method `formatFetchError(error: unknown): string`.
- Add private method `fetchWithTimeout(url, init, timeoutMs): Promise<Response>`.

**Acceptance**: File compiles; new helpers are private; no public API change.

### Step 2 — Wire helpers into `exchangeCodeForToken`

**Same file.**

- Replace `await fetch(tokenUrl.toString(), { … })` with `await this.fetchWithTimeout(tokenUrl.toString(), { … }, ALLEGRO_OAUTH_TIMEOUT_MS)`.
- Replace the catch block's log line with `formatFetchError(error)` and pass `(error as Error)?.stack` as the trace.

**Acceptance**: Happy-path test (OK response) still passes; the non-OK test still passes; new tests below pass.

### Step 3 — Wire helpers into `refreshToken`

**Same file.**

- Same change as Step 2, mirrored into `refreshToken`.
- Log prefix stays `"Error refreshing token"`.

**Acceptance**: No regression in existing behavior; new tests below pass.

### Step 4 — Tests: cause surfaces in log + timeout aborts + secret safety

**File**: `apps/api/src/integrations/application/services/allegro-oauth.service.spec.ts`

Spy on `service['logger']` with `jest.spyOn((service as unknown as { logger: Logger }).logger, 'error')` to inspect what was logged.

New test cases:

1. `exchangeCodeForToken`:
   - **fetch rejects with `cause.code`** → logger.error called with a message containing `ECONNREFUSED` and the cause message.
   - **fetch rejects with `cause` but no `code`** → logger.error falls back to `cause: unknown`.
   - **fetch rejects with AggregateError-shaped cause** → logger.error surfaces the joined error codes.
   - **fetch rejects with synthetic AbortError** → logger.error contains the timeout duration; environment is included in the log prefix.
   - **no secret leakage**: in each reject path, assert the logged message does NOT contain `clientSecret`, the authorization code, or the Basic Auth credentials string.

2. `refreshToken`:
   - **fetch rejects with `cause.code`** → logger.error contains `ENOTFOUND` (or whatever code we pick).
   - **no secret leakage**: the logged message does NOT contain `clientSecret` or the `refreshToken` value.

3. AbortError handling:
   - Stub `global.fetch` to reject with `Object.assign(new Error('aborted'), { name: 'AbortError' })`. Assert the call rejects with `InternalServerErrorException` and the logged message contains the timeout phrasing. No fake timers — directly exercises `formatFetchError`'s AbortError branch, which is what `fetchWithTimeout` will trigger in practice.

**Acceptance**: All new tests pass; previously-passing tests still pass; coverage for the two modified catch branches reaches 100%.

## 5. Validation

### Architecture compliance
- Backend API service change; no cross-layer violations.
- No new dependencies.
- Domain layer untouched.

### Naming & standards
- Two new private methods follow camelCase + match the surrounding style.
- Constant is `UPPER_SNAKE_CASE` per engineering standards.

### Secret safety
- Explicitly asserted in tests that `clientSecret`, authorization code, refresh token, and Basic credentials never appear in logged messages.
- No change to the `InternalServerErrorException` message, which is the user-facing surface.

### Testing
- Unit-test-only change; no integration test needed (no new DB or Redis interaction).
- Use Jest fake timers for the abort test (already a permitted pattern in this repo).

### Risks
- **Low.** Pure addition to catch-block logging + a bounded timeout. If the timeout is hit in practice, the user now gets a correctly-classified `InternalServerErrorException` after 10s instead of a hung request after ~120s — strictly an improvement.
- One possible subtlety: undici can surface `cause` as an array (`AggregateError`) in rare DNS scenarios. The `cause?.code` / `cause?.message` optional chains handle this gracefully (we'd log `cause: unknown — n/a` rather than throwing).

## 6. Acceptance criteria (from issue)

- [x] When a `fetch` to Allegro's token endpoint fails, logs include `error.cause.code` and `error.cause.message`.
- [x] Same treatment applied to `refreshToken` so refresh failures are equally diagnosable.
- [x] Token-exchange request aborts with a clear timeout after a bounded duration (10s) rather than hanging.
- [x] No secret material (client secret, authorization code, Authorization header, access/refresh tokens) appears in logs.
- [x] Unit test covering the "fetch rejects with a `cause`" path asserts the cause surfaces in the logged message.
