# Implementation Plan — #287 Allegro HTTP client retry tests on fake timers

## 1. Goal

Make `libs/integrations/allegro/src/infrastructure/http/__tests__/allegro-http-client.spec.ts` deterministic under concurrent `pnpm -r test` load. Today every test body toggles `jest.useRealTimers()` → runs the request under real `setTimeout` → toggles back to fake timers. The two retry tests pay real 1s sleeps; the timeout test waits 30s of real time with a 35s jest ceiling. Under parallel jest workers that 30s stretches past 35s and the suite flakes.

**Layer:** DX / testing
**Scope:** test file only (option A in the issue)
**Non-goals:** no production code change; no test-doubling of `sleep()`; no change to jest config.

## 2. What's really happening

- `beforeEach` already calls `jest.useFakeTimers()`. It is immediately neutered by `jest.useRealTimers()` at the top of every test body.
- Tests without a retry path (GET/POST/auth/headers/single-error) do not actually need real timers — they never hit `this.sleep(delay)`. The toggle is dead weight.
- Tests that DO exercise retry — `should retry on 5xx errors` (1s sleep) and `should retry on 429 with exponential backoff` (1s `Retry-After`) — need the sleep to progress, which fake timers can drive via `jest.advanceTimersByTimeAsync(...)`.
- The `should throw AllegroApiException on timeout` test drives a 30s `setTimeout(() => controller.abort(), timeoutMs)` in production code — that's ALSO drivable with fake timers. Real timers + 35s jest timeout is the worst offender under parallel load.

Modern fake timers (jest 29 default) stub `setTimeout`/`setInterval`/`Date` but leave Promise microtasks alone, so mocked `fetch` still resolves normally under fake timers.

## 3. Changes

Single file: `libs/integrations/allegro/src/infrastructure/http/__tests__/allegro-http-client.spec.ts`

### 3.1 Remove the real-timers toggle from every test body

Every test currently wraps its operation in `jest.useRealTimers(); ... ; jest.useFakeTimers();`. Drop the toggles. Fake timers remain active for the whole test, as established in `beforeEach`.

### 3.2 Drive retry sleeps with `advanceTimersByTimeAsync`

Two tests need the clock driven forward:

**`should retry on 5xx errors`** (line 360, default client, `initialDelayMs=1000`):
```ts
const promise = client.get('/test');
await jest.advanceTimersByTimeAsync(1000); // flush the first retry delay
const response = await promise;
```

**`should retry on 429 with exponential backoff`** (line 414, `Retry-After: 1` → 1000ms):
```ts
const promise = client.get('/test');
await jest.advanceTimersByTimeAsync(1000);
const response = await promise;
```

### 3.3 Drive the timeout test with fake timers

**`should throw AllegroApiException on timeout`** (line 316): client has `maxRetries: 0`, fetch never resolves until abort. The production `setTimeout(() => controller.abort(), 30000)` fires under fake timers.

```ts
const promise = noRetryClient.get('/test');
const expectation = expect(promise).rejects.toThrow(AllegroApiException);
await jest.advanceTimersByTimeAsync(30000);
await expectation;
await expect(promise).rejects.toThrow(/Request timeout after/);
```

(Also drop the `35000` jest timeout argument — no longer needed.)

### 3.4 Leave everything else

Constructor tests, single-request tests, non-retry error tests: no logic change, just drop the real-timer toggle.

## 4. Acceptance (from the issue)

- [x] Spec uses fake timers for every test that waits on retry backoff (5xx-retries, 429-retries, exponential-backoff assertion)
- [x] Suite runtime drops below ~5s under serial invocation (was ≥ 7s for the 5xx test alone)
- [x] Green across 5 consecutive `pnpm -r test` runs with api jest in parallel
- [x] No production code changes

## 5. Quality gate

```bash
pnpm --filter @openlinker/integrations-allegro test -- allegro-http-client
pnpm lint
pnpm type-check
pnpm test   # whole unit suite; verify nothing collateral broke
```

Then smoke-test the flake: run `pnpm -r test` three times in a row locally to confirm timing is independent of load.

## 6. Risks

- **Fake timers interfering with `fetch`-mock microtasks.** Modern fake timers leave Promise microtasks alone, so `mockResolvedValueOnce` + `await` chains work. Verified by the tests in this file that already run their fetch mocks in the `beforeEach` scope (before real-timer toggle) — e.g. `retryConfig` read tests. Low risk.
- **Abort signal under fake timers.** The production code path uses `controller.abort()` fired from `setTimeout`; AbortController itself is not timer-based, so it fires synchronously when the fake `setTimeout` callback runs. Low risk — `advanceTimersByTimeAsync` will flush pending microtasks after the timer callback.
- **`advanceTimersByTimeAsync` ordering.** For the retry tests, the first fetch mock must resolve (microtask), then `this.sleep(delay)` must register its timer, then we advance. Awaiting `promise` after `advanceTimersByTimeAsync` handles the chain because Jest's async variant flushes microtasks interleaved with timers.

## 7. Out of scope

- Not extracting a sleep/clock port on the production adapter (option B from the issue). Revisit only if more adapters grow retry logic and this pattern recurs.
- Not touching pre-commit hook configuration (e.g. `pnpm -r test --sequential`). The right fix is test determinism, not serialization.
