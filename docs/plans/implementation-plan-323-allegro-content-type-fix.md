# Implementation Plan — #323 Allegro HTTP Client Content-Type + Retry Classification

## 1. Understand the Task

**Goal:** Fix `PATCH /sale/product-offers/{id}` failing with `415 Unsupported content type` by sending the vendor media type on the request body, and stop the sync runner from burning retry attempts on that deterministic 4xx.

**Layer:** Integration (Allegro adapter HTTP client) + Worker sync runner.

**Explicit non-goals:**
- No API/DTO/domain changes.
- No changes to `updateOfferFields` semantics or the sync job handler.
- No broader marketplace adapter retry redesign — only the narrow classification fix that turns deterministic 4xx into non-retryable.
- Not surfacing background job failures to the UI (the issue notes that gap; it's a separate concern).

## 2. Root Cause Summary

- `libs/integrations/allegro/src/infrastructure/http/allegro-http-client.ts:213-216` hardcodes request `Content-Type: application/json`. Allegro's `PATCH /sale/product-offers/{id}` requires the vendor media type `application/vnd.allegro.public.v1+json` on the request body (same as the existing `Accept`).
- Header precedence is backwards: caller-supplied `options.headers` are merged in first, then `set(...)` calls override them. Callers cannot configure per-request media types.
- The sync job runner (`apps/worker/src/sync/sync-job.runner.ts:331-349`) only classifies `AllegroAuthenticationException` (401) as non-retryable. Deterministic 4xx like 415/400/404/422 burn up to `maxAttempts` retries even though retrying never helps.

## 3. Design

### 3a. Header construction

Rebuild the header block in `executeRequest` as:

1. **Defaults first**: `Content-Type` and `Accept` both set to `application/vnd.allegro.public.v1+json`.
2. **Caller overrides**: merge `options.headers` on top, so a future endpoint-specific media type (e.g. `application/vnd.allegro.beta.v1+json`) can be injected at the call site without touching the client.
3. **Structural headers last (immutable)**: `Authorization: Bearer <token>` and `X-Trace-Id: <uuid>` set *after* caller overrides. These identify the client and correlate logs — they are not content-negotiation knobs and callers have no reason to override them. Keeping them immutable also protects the token-refresh contract.

### 3b. Retry classification

Extend `SyncJobRunner.isNonRetryableError` to treat `AllegroApiException` with a deterministic client-error status as non-retryable:

- Covered: **400, 403, 404, 405, 409, 415, 422**.
- Explicitly excluded: **408 (request timeout)** and **425 (too early)** — transient, retry is valid. **429** is raised as `AllegroRateLimitException` already and handled separately.
- Must match both the unwrapped exception and when wrapped as `SyncJobExecutionError.cause` (the current handler convention).

The set is expressed as a `const` `Set<number>` in-module; no new types file is warranted (one local const).

### 3c. What stays the same

- `IAllegroHttpClient` interface unchanged.
- `AllegroMarketplaceAdapter.updateOfferFields` unchanged — already relies on default client headers.
- `MarketplaceOfferFieldUpdateHandler` unchanged — continues to wrap failures as `SyncJobExecutionError` with `cause`.
- Existing POST `/sale/product-offers` (offer create) continues to work: Allegro's Public API accepts the vendor media type uniformly on writes.

## 4. Step-by-Step Implementation

### Step 1 — Fix `allegro-http-client.ts`

**File:** `libs/integrations/allegro/src/infrastructure/http/allegro-http-client.ts`

Replace the header-building block in `executeRequest` (around lines 212-217). Structural headers are deliberately set *after* caller overrides — this protects the token-refresh contract (`Authorization` is client-managed) and correlation-ID stability (`X-Trace-Id` must match log lines). A one-line comment in the code should explain this so a future reordering doesn't silently regress it.

```ts
// Build headers.
// Order matters: defaults → caller overrides → structural (immutable).
// Structural headers land last because Authorization is owned by the token-refresh
// flow and X-Trace-Id must match the log correlation ID — neither is a caller concern.
const headers = new Headers();
headers.set('Content-Type', 'application/vnd.allegro.public.v1+json');
headers.set('Accept', 'application/vnd.allegro.public.v1+json');

if (options?.headers) {
  for (const [key, value] of Object.entries(options.headers)) {
    headers.set(key, value);
  }
}

headers.set('Authorization', `Bearer ${this.accessToken}`);
headers.set('X-Trace-Id', traceId);
```

**Acceptance:**
- Default `Content-Type` is `application/vnd.allegro.public.v1+json`.
- Caller-supplied `Content-Type` via `options.headers` wins.
- `Authorization` and `X-Trace-Id` cannot be overridden by callers.

### Step 2 — Update retry classification in `sync-job.runner.ts`

**File:** `apps/worker/src/sync/sync-job.runner.ts`

Inside `isNonRetryableError(error: unknown)`:

- Import `AllegroApiException` (already imported alongside `AllegroAuthenticationException`).
- Add a module-level constant with an inline comment explaining inclusions/exclusions:
  ```ts
  // Deterministic Allegro 4xx — retrying never helps.
  // Excludes 408/425 (transient by spec), 429 (raised as AllegroRateLimitException
  // and handled with Retry-After inside the HTTP client), and 401 (handled above
  // via AllegroAuthenticationException + token refresh).
  const NON_RETRYABLE_ALLEGRO_STATUS_CODES = new Set([400, 403, 404, 405, 409, 415, 422]);
  ```
- After the existing 401 checks, add:
  ```ts
  const cause = error instanceof SyncJobExecutionError ? error.cause : error;
  if (
    cause instanceof AllegroApiException &&
    cause.statusCode !== undefined &&
    NON_RETRYABLE_ALLEGRO_STATUS_CODES.has(cause.statusCode)
  ) {
    return true;
  }
  ```
- Update the JSDoc comment block above the method to reflect the expanded policy.

**Placement note:** The constant is named for Allegro specifically, which is a small leak — the runner already has the same shape for the 401 handler (`AllegroAuthenticationException` imported directly). Extending it keeps the existing pattern consistent; a broader refactor (push retryability onto the exception, or a per-integration classifier registry) is tracked as a follow-up, not done here.

**Acceptance:**
- `AllegroApiException` with status in the deterministic set → `markDead` on first failure.
- `AllegroApiException` with 5xx or 408/425 → still retryable (behaviour unchanged).
- 429 still handled via `AllegroRateLimitException` (behaviour unchanged).
- Existing auth-failure behaviour unchanged.

### Step 3 — Update HTTP client tests

**File:** `libs/integrations/allegro/src/infrastructure/http/__tests__/allegro-http-client.spec.ts`

1. Update the existing GET content-type assertion (line ~131) from `'application/json'` to `'application/vnd.allegro.public.v1+json'`.
2. Add a `describe('headers')` group (or extend `'authentication'`) with:
   - `'should use vendor media type as default Content-Type on PATCH'` — drive a successful PATCH, assert `content-type === 'application/vnd.allegro.public.v1+json'`.
   - `'should honor caller-supplied Content-Type override'` — `client.post('/x', body, { headers: { 'Content-Type': 'application/vnd.allegro.beta.v1+json' } })`, assert override wins.
   - `'should not allow caller to override structural headers'` — pass `{ headers: { Authorization: 'Bearer evil', 'X-Trace-Id': 'attacker-controlled' } }`, assert final `authorization === 'Bearer test-access-token-12345'` **and** final `x-trace-id` matches the client-generated UUID (regex from the existing trace-id test), not `'attacker-controlled'`. One test, two asserts — covers the full structural-immutability contract.

### Step 4 — Add runner classification test

**File:** `apps/worker/src/sync/__tests__/sync-job.runner.spec.ts`

Add three tests in the failure-handling section — positive case plus two guardrails so the classifier can't silently widen or narrow later:

1. **Positive — non-retryable 4xx:** `'should mark job as dead on AllegroApiException with deterministic 4xx (415)'`
   - Throw `new SyncJobExecutionError('...', jobId, jobType, connId, new AllegroApiException('415', 415, 'body', 'url'))` from the handler.
   - Assert `jobRepository.markDead` was called and `jobRepository.markFailed` was **not**.

2. **Negative — 5xx stays retryable:** `'should keep retrying on AllegroApiException with 5xx (503)'`
   - Same shape, statusCode `503`. Assert `markFailed` was called and `markDead` was **not** (while `attempts + 1 < maxAttempts`).

3. **Negative — 4xx not in the set stays retryable:** `'should keep retrying on AllegroApiException with transient 4xx (408)'`
   - Same shape, statusCode `408`. Assert `markFailed` was called and `markDead` was **not**.

## 5. Validation

### Architecture & standards
- **Layer:** Integration + worker — no domain changes. ✅
- **Naming:** No new files. ✅
- **Imports:** `AllegroApiException` already imported in runner. ✅
- **No `any`, no `console.log`.** ✅
- **Logger usage:** existing `@openlinker/shared/logging` Logger. ✅

### Testing
- Two new unit test groups: HTTP client header precedence, runner 4xx classification.
- Existing tests adjusted for new default media type.
- No integration test needed — change is in the request-headers shape, covered by unit tests with mocked `fetch`.

### Security
- No new input surfaces.
- `Authorization` header remains non-overridable by callers (safer than before).

### Risk
- **Low.** Request Content-Type move from `application/json` → `application/vnd.allegro.public.v1+json` is a superset accepted across Allegro Public API. No current call site passes `options.headers['Content-Type']`.
- Retry-classification change only affects jobs that were previously burning attempts on deterministic 4xx — failure mode shifts from "10 retries then dead" to "dead immediately". That is the desired behaviour (less noise, faster surfacing).

### Open questions
- None — issue acceptance criteria are fully covered.

## 6. Acceptance Criteria (from #323)

- [x] PATCH `/sale/product-offers/{id}` succeeds with vendor media type (Step 1).
- [x] Unit test asserts PATCH uses vendor Content-Type (Step 3).
- [x] Unit test asserts caller-supplied Content-Type is honored (Step 3).
- [x] Existing POST `/sale/product-offers` and other calls unaffected (Step 1 — default now vendor media type; `Accept` unchanged).
- [x] 415 responses are non-retryable at runner level (Step 2 + Step 4).

## 7. PR body — manual sandbox smoke checklist

ACs #1 and #4 can't be unit-tested; the PR description must list them as a manual smoke checklist so a reviewer can confirm execution:

- [ ] Allegro sandbox: `PATCH /sale/product-offers/{offerId}` with `name` (title) succeeds — 200.
- [ ] Allegro sandbox: same endpoint with `sellingMode.price` succeeds — 200.
- [ ] Allegro sandbox: same endpoint with `description.sections[]` succeeds — 200.
- [ ] Allegro sandbox: `POST /sale/product-offers` (offer create) still succeeds — 201.
- [ ] Worker log: a forced 415 (e.g., transient config) terminates on attempt 1 with `markDead`, not 10.

## 8. Out-of-scope follow-ups (flag in PR, don't fix here)

- **Doc drift:** `docs/architecture-overview.md` §Technology Stack → Key Libraries claims "Adapter HTTP clients: Axios (`@nestjs/axios`)". `AllegroHttpClient` uses native `fetch` (see its file header). Pre-existing, not introduced by this change. Flag for a separate docs PR.
- **Retryability classifier refactor:** Consider pushing `isRetryable` onto the exception types themselves (or a per-integration registry) so the worker's `isNonRetryableError` stops naming specific integrations. Tracked as a future cleanup.
- **Background-job failure surfacing to UI:** Issue notes the UI reports success when the enqueue succeeds, masking downstream job failure. Separate scope.
