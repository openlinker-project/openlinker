# Implementation Plan: Redis-Backed `RateLimiterPort` for Cross-Process Rate Limiting

**Date**: 2026-08-10
**Status**: Draft
**Estimated Effort**: 1–1.5 days
**Source Issue**: [#2015](https://github.com/openlinker-project/openlinker/issues/2015)

---

## 1. Task Summary

**Objective**: Add a Redis-backed implementation of the existing `RateLimiterPort` (`libs/shared/src/rate-limit/rate-limiter.port.ts`) and swap it in behind `RateLimiterRegistry`, so `apps/api` and `apps/worker` — today two independent Node processes with two independent in-memory `RateLimiter` pools — throttle the same connection's outbound traffic against one shared bucket.

**Context**: `HttpTransportFactory.forConnection(connection)` caches one `RateLimiter` per `connection.id`, keyed through `RateLimiterRegistry` (`libs/shared/src/rate-limit/rate-limiter-registry.ts`). Every migrated integration (Allegro, PrestaShop, Erli, WooCommerce, InPost, DPD Polska, infakt, KSeF, Subiekt nexo — #2006/#2004/#1981/#1978/#1977) goes through it. Because `apps/api` and `apps/worker` each own a `RateLimitModule` (`@Global()` only within its own process), a connection configured for e.g. 60 req/min can see up to ~120 req/min of real outbound traffic when both processes call it concurrently. This is a known, already-documented gap — [ADR-038](../architecture/adrs/038-per-connection-outbound-rate-limiting.md) § "Cross-process coordination" names a Redis-backed `RateLimiterPort` as the intended follow-up, with no new infra dependency (Redis is already used for sync locks and event streams).

**Classification**: Infrastructure / Shared (`libs/shared/src/rate-limit/`), with a small DI-wiring change in `libs/plugin-sdk/src/rate-limit.module.ts`.

---

## 2. Scope & Non-Goals

### In Scope
- `RedisRateLimiterAdapter implements RateLimiterPort` in `libs/shared/src/rate-limit/`.
- Cross-process pacing (`requestsPerMinute`), concurrency cap (`maxConcurrent`), and `noteRetryAfter` propagation, all backed by Redis so both processes observe the same state.
- Fail-open behaviour on Redis outage (mirrors the shipped `McpRateLimiter` precedent).
- Wiring `RateLimiterRegistry`'s construction site (`rate-limit.module.ts`) to build Redis-backed limiter instances instead of in-memory ones.
- Removing the now-redundant `OL_WORKER_REPLICAS` cap division once the bucket is shared.
- Updating [ADR-038](../architecture/adrs/038-per-connection-outbound-rate-limiting.md) to mark the cross-process gap as closed, with a note on the chosen Redis data structures.
- Unit tests for the new adapter (Lua/atomicity, fail-open, retry-after propagation) plus one test that exercises two independent `RedisRateLimiterAdapter` instances (simulating "api" and "worker") against the same connection id and the same real/embedded Redis, proving they share one bucket.

### Out of Scope
- Any change to `HttpTransportFactory`'s public shape or call sites, or to any integration adapter (Allegro, PrestaShop, Erli, WooCommerce, InPost, DPD Polska, infakt, KSeF, Subiekt) — the port contract does not change, only its backing implementation.
- Exact reproduction of the in-memory `RateLimiter`'s **strict priority queue ordering** (interactive callers always jump ahead of queued background ones) across processes. See § Questions & Assumptions — this is a deliberate, documented degradation for v1, consistent with the issue's own stated assumption ("strict token-bucket semantics are not required... only its effective cap").
- A live, exactly-consistent cross-process `getStatus()` read. `RateLimiterPort.getStatus()` is a **synchronous** method in the existing contract; a Redis-backed adapter cannot do a live network round-trip inside a sync call. See § Questions & Assumptions for the resolution.
- Redesigning `RateLimitStatusService` (#1941) or any FE rate-limit observability surface.
- Introducing a runtime toggle/feature-flag between in-memory and Redis-backed limiters — this is a direct cutover, per `CLAUDE.md`'s guidance against backwards-compatibility shims when a straight change suffices, and because a toggle would reintroduce exactly the coordination gap this issue closes.

### Constraints
- No new infrastructure dependency — reuse the existing `'REDIS_CLIENT'` `@Global()` token from `RedisConfigModule` (`libs/shared/src/redis/redis-config.module.ts`), already available to both `apps/api` and `apps/worker`.
- No schema/migration change — this is process-local + Redis state, no Postgres involvement.
- Must not change `RateLimiterPort`'s public method signatures (the issue's stated AC).

---

## 3. Architecture Mapping

**Target Layer**: Shared (`libs/shared/src/rate-limit/`), with DI wiring in Infrastructure/plugin-sdk (`libs/plugin-sdk/src/rate-limit.module.ts`). No CORE or Integration-layer change.

**Capabilities Involved**: None of the CORE capability ports (`OfferManagerPort`, `OrderSourcePort`, etc.) — this is a cross-cutting shared-library concern consumed transitively through `HostServices.http`, which every plugin already depends on.

**Existing Services Reused**:
- `'REDIS_CLIENT'` (`RedisClientType` from `redis` v4.6.12) — already `@Global()`-exported by `RedisConfigModule`, already injected into `RedisSyncLockService`, `RedisStreamsEventPublisherService`, `RedisStreamsJobEnqueueService`, and (closest precedent) `McpRateLimiter` (`apps/api/src/mcp/tools/ratelimit/mcp-rate-limiter.ts`).
- `RateLimiterPort`, `ConnectionRateLimit`, `RateLimitPriority`, `RateLimitStatus`, `RateLimitRelease` types — unchanged, reused verbatim.
- `RateLimitTimeoutError` / `RateLimitAbortedError` — reused verbatim for the same rejection semantics.
- The claim-then-rank ZSET pattern already proven in `McpRateLimiter.claimRank` for atomic, race-safe admission under concurrent callers — this plan reuses the same primitive for the concurrency-cap half.

**New Components Required**:
- `libs/shared/src/rate-limit/redis-rate-limiter.adapter.ts` — `RedisRateLimiterAdapter implements RateLimiterPort`.
- `libs/shared/src/rate-limit/redis-rate-limiter.adapter.spec.ts` — unit tests (mocked `RedisClientType`, plus one test with a real/embedded Redis client if the package already has one for integration-style unit coverage — see § Testing Strategy).
- A small `createRedisRateLimiterRegistry(deps)` factory (same file as `rate-limiter-registry.ts`, or a sibling `redis-rate-limiter-registry.ts` — see Phase 2) implementing the existing `RateLimiterRegistry` interface, backed by `RedisRateLimiterAdapter` instead of the in-memory `RateLimiter`.
- Updated `libs/plugin-sdk/src/rate-limit.module.ts` — resolves the Redis-backed registry, injects `'REDIS_CLIENT'`, and stops dividing the policy by `OL_WORKER_REPLICAS`.

**Core vs Integration Justification**: This is neither CORE domain logic nor an integration adapter — it is infrastructure shared across every plugin via the existing `@openlinker/shared/rate-limit` package, exactly where the in-memory `RateLimiter` already lives. `HttpTransportFactory` and every integration adapter remain untouched because they only ever see the port interface, never the concrete limiter class (`HttpTransportFactory` calls `this.registry.get(...)`, which returns a `RateLimiterPort`-typed value).

---

## 4. External / Domain Research

### Internal Patterns (this repo already answers most open questions)

- **Redis client shape**: `redis` v4.6.12 (`node-redis`), injected via `@Inject('REDIS_CLIENT') private readonly redisClient: RedisClientType`. Lua scripts run via `this.redisClient.eval(lua, { keys: [...], arguments: [...] })` — exact precedent in `RedisSyncLockService.release` (`libs/core/src/sync/application/services/redis-sync-lock.service.ts:52-63`).
- **Atomic claim-then-rank ZSET pattern**: `McpRateLimiter.claimRank` (`apps/api/src/mcp/tools/ratelimit/mcp-rate-limiter.ts:130-145`) is the proven, already-shipped answer to "how do N racing callers across processes admit exactly `limit` of themselves without a livelock". It:
  1. `ZREMRANGEBYSCORE` to evict members older than the window/lifetime (self-healing against a crashed caller that never released).
  2. `ZADD` to claim a slot for this call, scored by arrival time.
  3. `EXPIRE` the whole key so an abandoned bucket doesn't leak forever.
  4. `ZRANK` to read this caller's own rank; admit iff `rank < limit`.
  This plan reuses the identical pattern for the `maxConcurrent` half of `RedisRateLimiterAdapter.acquire()`.
- **Minimum-interval pacing** (the `requestsPerMinute` half) is a different shape from a windowed counter: the in-memory `RateLimiter` is not a bursty token bucket — it enforces a single "next-available-at" timestamp advanced by `60_000 / requestsPerMinute` on every admission (`rate-limiter.ts:186-190`). The Redis equivalent is a single string key holding that timestamp, advanced atomically by a small Lua script (CAS-style: read current value, compute `next = max(now, current) + interval`, `SET` it, return whether `now >= previousValue` i.e. whether this caller may proceed immediately or must wait `previousValue - now` ms). This is a simpler, cheaper primitive than a ZSET sliding window and preserves the exact pacing semantics of the code being replaced, rather than swapping in an unrelated windowed-counter algorithm.
- **`noteRetryAfter` propagation**: the same "next-available-at" key doubles as the Retry-After sink — `noteRetryAfter(delayMs)` is just `next = max(current, now + delayMs)`, written with the same CAS Lua script. Any process's next pacing check against that key picks it up.
- **Fail-open precedent**: `McpRateLimiter.acquire`'s outer `try { ... } catch (error) { this.logger.warn(...); return NOOP_LEASE; }` (`mcp-rate-limiter.ts:225-232`) is the exact shape to mirror — on any Redis error, log a warning via the shared `Logger` and let the call proceed unthrottled rather than block.

### External System
Not applicable — no external API is involved. Redis itself is already a first-party dependency of this deployment (sync locks, event streams, MCP rate limiting), so no new operational surface is introduced.

---

## 5. Questions & Assumptions

### Open Questions

1. **Should `RedisRateLimiterAdapter` be constructed per-connection (one instance per `connectionId`, holding no per-connection state itself since everything lives in Redis) or as a single shared instance keyed internally by `connectionId` in every method call?**
   Recommendation (assumed below): mirror the existing `RateLimiterRegistry` shape exactly — one adapter instance per `connectionId`, lazily created and cached by the registry, exactly like today's `Map<string, RateLimiter>`. This keeps the registry's public contract (`get`, `getStatus`, `evict`, `clear`) unchanged and keeps `RedisRateLimiterAdapter` itself connection-agnostic (it receives `connectionId` — or rather, is scoped to one — at construction, consistent with the in-memory `RateLimiter`'s shape). Since all real state lives in Redis, "evicting" a Redis-backed adapter from the registry Map is cheap (drops the local object; the Redis keys themselves expire via their own TTLs, so no explicit `DEL` is required on evict).

2. **`getStatus()` is a synchronous method on `RateLimiterPort` — how does a Redis-backed adapter answer it without blocking on I/O?**
   This is a real contract tension the issue's proposed solution does not address (it assumes "no changes to `HttpTransportFactory`'s call sites" implies no changes anywhere in the port, but `getStatus()`'s current signature is incompatible with a truly live Redis read). Two options:
   - **(a)** Keep `getStatus()` synchronous and have `RedisRateLimiterAdapter` return a locally-tracked, best-effort approximation — updated opportunistically every time `acquire()`/`release()` runs *in this process* (i.e. it reports what this process itself has observed, not the live cross-process truth).
   - **(b)** Widen `RateLimiterPort.getStatus()` to `Promise<RateLimitStatus>`, which is a breaking signature change propagating to `RateLimiterRegistry.getStatus()` and its one known consumer, `RateLimitStatusService` (#1941).
   **Assumption (recommended default): option (a).** The issue's stated AC list does not include a live cross-process status readout — only `acquire`/`noteRetryAfter`/fail-open are tested. Changing a public port method's signature is exactly the kind of ripple the issue explicitly tries to avoid ("no changes to `HttpTransportFactory`'s call sites or to any integration adapter"). Option (a) is called out explicitly in the ADR-038 update (Phase 4) as a known, accepted limitation: the observability surface becomes per-process-approximate under Redis backing, whereas it was exactly correct under the single-process in-memory limiter. This is a genuine regression in observability precision that should be stated plainly, not silently accepted.

3. **Does strict priority ordering (`interactive` jumps the queue ahead of already-queued `background` callers) need to survive the move to Redis?**
   **Assumption (recommended default): no, not exactly.** The in-memory `RateLimiter` maintains an explicit in-process priority queue (`insertByPriority`) because it holds every waiter as a live JS `Promise` it controls. A Redis-backed adapter has no such queue to reorder — each process's callers still queue locally (in-process priority is preserved for callers *within the same process*), but a cross-process "who goes next" decision cannot cheaply respect priority without a much heavier scheme (e.g. two priority-weighted global queues with a Lua script that always drains `interactive` first — materially more complex, and not required by any acceptance criterion in the issue). This plan preserves priority as a **local, per-process** tiebreak (a process's own callers still queue in the existing priority order before each individually contends for the shared Redis pacing/concurrency gate) and explicitly does not attempt cross-process priority fairness. This mirrors the issue's own stated assumption ("strict token-bucket semantics are not required... only its effective cap") and is called out as a known trade-off, not silently dropped.

4. **Where should the Redis key namespace live, and what TTLs?**
   **Assumption**: `ratelimit:pace:{connectionId}` (string) and `ratelimit:inflight:{connectionId}` (ZSET), mirroring the existing `mcp:ratelimit:` / `mcp:inflight:` naming convention in `mcp-rate-limiter.ts`. TTL on the pace key: a small multiple of the pacing interval (self-heals if a connection's policy is removed or the key is otherwise abandoned). TTL/`EXPIRE` on the inflight ZSET: refreshed on every claim, same as `McpRateLimiter`.

5. **Should the `OL_WORKER_REPLICAS` division be deleted outright, or just made a no-op?**
   **Assumption**: deleted outright from `rate-limit.module.ts` (the env var is read nowhere else — confirmed via repo-wide grep). Once the bucket is shared across every process/replica, dividing it further would under-throttle nothing but would silently shrink the operator's configured cap for no reason. `HttpTransportFactory`'s `dividePolicy`/`replicas` parameter itself is **left in place** (unmodified file, per the issue's AC) — `rate-limit.module.ts` simply always constructs it with `replicas: 1` (or omits the option, since `1` is already the default), which is a wiring change, not a `http-transport-factory.ts` change.

### Assumptions Summary (safe defaults used throughout this plan)
- Redis-backed adapter is per-connection-scoped, registry-cached, exactly like today (§ Q1).
- `getStatus()` stays synchronous and reports a process-local best-effort approximation under Redis backing (§ Q2) — documented as a known limitation in the ADR-038 update, not silently glossed over.
- Cross-process priority ordering is NOT attempted; only the effective rate/concurrency cap is shared (§ Q3).
- Redis key namespace: `ratelimit:pace:{connectionId}`, `ratelimit:inflight:{connectionId}` (§ Q4).
- No feature flag / dual-path toggle — direct cutover (§ Scope).
- `OL_WORKER_REPLICAS` reading is removed from `rate-limit.module.ts` (§ Q5).

### Documentation Gaps
- ADR-038 documents the gap this issue closes but does not specify a concrete Redis data structure — Phase 4 below is the first place that decision gets written down.
- No existing doc states the `getStatus()` sync-vs-Redis tension; Phase 4's ADR-038 update is the natural place to record it so a future reader doesn't rediscover it as a "bug."

---

## 6. Proposed Implementation Plan

### Phase 1: `RedisRateLimiterAdapter` core

**Goal**: A working, unit-tested `RateLimiterPort` implementation backed by Redis, with pacing, concurrency, retry-after, and fail-open all correct in isolation (single process, mocked Redis).

**Steps**:

1. **Create the adapter file**
   - **File**: `libs/shared/src/rate-limit/redis-rate-limiter.adapter.ts`
   - **Action**: `RedisRateLimiterAdapter implements RateLimiterPort`, constructed with `(connectionId: string, redisClient: RedisClientType, deps?: { now?: () => number })`. Implements:
     - `acquire(policy, priority, signal)`: bounded polling loop (respecting `MAX_TOTAL_WAIT_MS` from the existing `rate-limiter.ts` constant — reuse it, don't redefine) that on each iteration:
       1. Runs the pacing CAS Lua script against `ratelimit:pace:{connectionId}` (skipped entirely if `policy.requestsPerMinute` is undefined) — returns either "admitted, next pace timestamp written" or "must wait N ms".
       2. If paced-admitted (or pacing is not configured), runs the claim-then-rank ZSET script against `ratelimit:inflight:{connectionId}` (skipped entirely if `policy.maxConcurrent` is undefined) — mirrors `McpRateLimiter.claimRank` exactly, evicting stale entries older than a `MAX_CALL_LIFETIME_SECONDS`-style bound.
       3. If both gates pass: return a `RateLimitRelease` that `ZREM`s this call's inflight member (idempotent, matching the port's documented `RateLimitRelease` contract).
       4. If either gate blocks: if a concurrency claim was made but pacing hadn't passed (shouldn't happen given ordering above, but defensive), roll it back; sleep for the smaller of the computed wait and a bounded poll interval; re-check `signal.aborted` before and after the sleep (reject with `RateLimitAbortedError`); if total elapsed exceeds `MAX_TOTAL_WAIT_MS`, reject with `RateLimitTimeoutError`.
     - `noteRetryAfter(delayMs)`: CAS-advance the same `ratelimit:pace:{connectionId}` key to `max(current, now + delayMs)` via a small Lua script (no separate key — reuses the pacing key so any in-flight `acquire()` loop, in this or another process, observes it on its next poll).
     - `getStatus()`: synchronous, returns a locally-tracked snapshot (last known `inFlight`/`queued`/`lastAcquiredAt` as observed *by this process instance*), per § Questions & Assumptions Q2. Document this limitation in the method's docstring.
   - **Acceptance**: adapter compiles, implements the port with no `any`, has a file header per `docs/engineering-standards.md § File Headers` documenting the pacing-vs-concurrency-gate split and the fail-open posture, and documents the priority/getStatus trade-offs from § 5 inline (matching this codebase's convention of putting non-obvious rationale in the file's top comment, as `mcp-rate-limiter.ts` does).
   - **Dependencies**: none (new file).

2. **Wrap the whole `acquire()` body in fail-open handling**
   - **File**: same as above.
   - **Action**: any Redis error (connection refused, timeout, script error) inside `acquire()` is caught, logged via `new Logger(RedisRateLimiterAdapter.name).warn(...)` (per `docs/engineering-standards.md § Logging`), and the call resolves immediately with a no-op `RateLimitRelease` — mirroring `McpRateLimiter`'s `NOOP_LEASE` pattern. `noteRetryAfter` similarly swallows and warns on a Redis error rather than throwing (it is fire-and-forget informational input per the port doc).
   - **Acceptance**: a unit test that makes the injected Redis mock throw on every call proves `acquire()` still resolves (not hangs, not throws) and logs a warning.
   - **Dependencies**: Step 1.

3. **Unit tests**
   - **File**: `libs/shared/src/rate-limit/redis-rate-limiter.adapter.spec.ts` (colocated, per `docs/engineering-standards.md`).
   - **Action**: mock `RedisClientType` (`jest.Mocked<...>`, mirroring the existing `mcp-rate-limiter.spec.ts` mocking style) and assert:
     - `acquire()` admits immediately when the pacing/concurrency Lua responses indicate no wait needed.
     - `acquire()` waits and retries when the pace script reports a future timestamp, then admits once the mocked clock/Redis response indicates readiness.
     - `maxConcurrent` is respected: N+1th concurrent `acquire()` call (mocked ZRANK response `>= limit`) waits; releasing one frees a slot for the next poll.
     - `noteRetryAfter` pushes the pace key forward (asserted via the Lua script's arguments).
     - Redis throwing on any call → `acquire()` fails open (`NOOP`-style release, warning logged), `noteRetryAfter` swallows silently-but-warns.
     - `AbortSignal` aborts a queued wait with `RateLimitAbortedError`.
     - Exceeding `MAX_TOTAL_WAIT_MS` rejects with `RateLimitTimeoutError`.
   - **Acceptance**: `pnpm --filter @openlinker/shared test redis-rate-limiter.adapter` green; coverage matches the existing bar for `libs/shared` infrastructure adapters (≥70%, per `docs/engineering-standards.md § Testing Standards`).
   - **Dependencies**: Steps 1–2.

### Phase 2: Registry wiring

**Goal**: `RateLimiterRegistry` can be backed by either implementation without changing its own public interface; DI wiring resolves the Redis-backed one.

**Steps**:

1. **Add a Redis-backed registry factory**
   - **File**: `libs/shared/src/rate-limit/rate-limiter-registry.ts` (extend, don't fork) — add `createRedisRateLimiterRegistry(redisClient: RedisClientType, deps?: RateLimiterDeps): RateLimiterRegistry` alongside the existing `createRateLimiterRegistry`. Same `Map<string, RedisRateLimiterAdapter>` lazy-create-and-cache shape as today's `get()`, just constructing `RedisRateLimiterAdapter` instead of `RateLimiter`. `evict()`/`clear()` behave identically (drop the local object; no explicit Redis key cleanup needed since keys carry their own TTLs — see § Questions & Assumptions Q1).
   - **Acceptance**: `RateLimiterRegistry` interface itself is unchanged (both factories satisfy it); a unit test proves `createRedisRateLimiterRegistry(...).get(id, policy)` returns a `RedisRateLimiterAdapter` instance implementing `RateLimiterPort`.
   - **Dependencies**: Phase 1.

2. **Export from the package barrel**
   - **File**: `libs/shared/src/rate-limit/index.ts`
   - **Action**: add `export { createRedisRateLimiterRegistry } from './rate-limiter-registry';` and `export { RedisRateLimiterAdapter } from './redis-rate-limiter.adapter';` alongside the existing exports.
   - **Acceptance**: `@openlinker/shared/rate-limit` resolves both new symbols.
   - **Dependencies**: Step 1.

3. **Wire `rate-limit.module.ts` to the Redis-backed registry**
   - **File**: `libs/plugin-sdk/src/rate-limit.module.ts`
   - **Action**:
     - Inject `'REDIS_CLIENT'` into the `RATE_LIMITER_REGISTRY_TOKEN` provider's factory (`useFactory(redisClient: RedisClientType) => createRedisRateLimiterRegistry(redisClient)`, `inject: ['REDIS_CLIENT']`).
     - Remove `resolveReplicaCount()` and the `replicas` option passed into `HttpTransportFactory` (or pass a hardcoded `1` — equivalent, since `1` is already `HttpTransportFactory`'s no-op default; removing the option entirely is cleaner and matches § Questions & Assumptions Q5).
     - Update the module's file-header comment (it currently documents the static-replica-division rationale in detail) to describe the Redis-shared-bucket model instead, referencing this issue/ADR-038 update.
   - **Acceptance**: `RateLimitModule` still exports `HTTP_TRANSPORT_FACTORY_TOKEN` and `RATE_LIMITER_REGISTRY_TOKEN` with the same shapes; both `apps/api` and `apps/worker` (which both already have `RedisConfigModule` in their module graphs, confirmed via existing `'REDIS_CLIENT'` consumers in each) resolve `'REDIS_CLIENT'` without any new module import — verify by grep for `RedisConfigModule` in both apps' root module graphs during implementation.
   - **Dependencies**: Steps 1–2.

### Phase 3: Cross-process proof test

**Goal**: Directly verify the acceptance criterion "a request issued from `apps/api` and a request issued from `apps/worker` against the same `connectionId` are throttled against one shared bucket."

**Steps**:

1. **Add a cross-instance unit/integration test**
   - **File**: `libs/shared/src/rate-limit/redis-rate-limiter.adapter.spec.ts` (extend) or, if a real Redis connection is preferred over mocks for this specific test (recommended — the whole point is to prove real atomicity, and mocking Redis here would just re-assert the mock's own behaviour), a new `apps/api/test/integration/*.int-spec.ts` or `libs/shared` Testcontainers-backed spec.
   - **Action**: construct two independent `RedisRateLimiterAdapter` instances (simulating "api process" and "worker process") pointed at the same real (Testcontainers) Redis and the same `connectionId`/policy. Fire concurrent `acquire()` calls split across both instances with `maxConcurrent: 2`; assert exactly 2 admit immediately and the rest queue/wait — proving the cap is shared, not doubled. Repeat for `requestsPerMinute` pacing (two instances alternating `acquire()` calls must together respect the single combined interval, not each independently pacing at the full configured rate).
   - **Acceptance**: this test fails against the *old* in-memory `RateLimiter` (two separate `RateLimiter` instances would each independently admit up to the cap — 2x over-admission) and passes against `RedisRateLimiterAdapter` — i.e., it is a genuine regression test for the bug this issue fixes, not just a smoke test.
   - **Dependencies**: Phase 1. Per `docs/testing-guide.md`, if this needs a real Redis it belongs under `*.int-spec.ts` / Testcontainers, run via `pnpm test:integration`, not `pnpm test`.

### Phase 4: Cutover verification + ADR update

**Goal**: Confirm zero blast radius outside `libs/shared`/`libs/plugin-sdk`, and record the resolved design decision.

**Steps**:

1. **Verify no adapter/consumer changes are needed**
   - **Action**: run every migrated integration's existing test suite (`Allegro`, `PrestaShop`, `Erli`, `WooCommerce`, `InPost`, `DPD Polska`, `infakt`, `KSeF`, `Subiekt nexo`) unmodified. Since none of them import anything from `rate-limit/` directly (confirmed during discovery — they only ever see `HttpTransportFactoryPort` via `HostServices.http`), this should be a pure pass-through; the acceptance criterion is that no adapter file needs to change at all.
   - **Acceptance**: `pnpm test` green across every `libs/integrations/*` package with zero diffs to those packages.

2. **Update ADR-038**
   - **File**: `docs/architecture/adrs/038-per-connection-outbound-rate-limiting.md`
   - **Action**: in the "Cons / trade-offs" bullet describing the cross-process gap, add a short resolved-by note pointing at this issue/PR, and record:
     - The chosen Redis data structures (pacing: single CAS'd timestamp string key; concurrency: claim-then-rank ZSET, reusing the `McpRateLimiter` pattern).
     - The `getStatus()` limitation from § Questions & Assumptions Q2 (per-process-approximate under Redis backing).
     - The priority-ordering limitation from § Q3 (local-only priority tiebreak; no cross-process priority fairness).
     - That `OL_WORKER_REPLICAS` division is removed as redundant once the bucket is shared.
   - **Acceptance**: ADR-038 accurately describes the *implemented* state, not just the previously-identified gap. No new ADR number is needed — this amends the existing decision record for a fully-resolved follow-up item it already named, not a new cross-cutting architectural choice.
   - **Dependencies**: Phases 1–3 complete (the ADR should describe what was actually built).

3. **Update the file-header / inline docs that reference the old static-division model**
   - **Files**: `libs/plugin-sdk/src/rate-limit.module.ts` (already covered in Phase 2 Step 3), and a grep pass for `OL_WORKER_REPLICAS` across `docs/` (confirmed today: not referenced elsewhere in prose docs — only in `rate-limit.module.ts` and ADR-038's Cons section, both already covered above).
   - **Acceptance**: no dangling reference to the removed replica-division mechanism outside the ADR's historical "what we used to do" framing.

### Implementation Details

**New Components**:
- **Shared (Infrastructure-shaped, no CORE/Integration layers apply)**: `RedisRateLimiterAdapter` (`redis-rate-limiter.adapter.ts`), `createRedisRateLimiterRegistry` (extends `rate-limiter-registry.ts`).
- **DI wiring**: `libs/plugin-sdk/src/rate-limit.module.ts` factory update.

**Configuration Changes**: None new — reuses existing `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB` env vars already consumed by `RedisConfigModule`. `OL_WORKER_REPLICAS` is removed (no longer read anywhere).

**Database Migrations**: None.

**Events**: None emitted or consumed — this is a synchronous throttling primitive, not an event-driven flow.

**Error Handling**:
- Fail-open on any Redis error inside `acquire()`/`noteRetryAfter()` — logged via `Logger.warn`, never thrown to the caller (matches the existing `RateLimiterPort` doc's contract that `acquire()` only rejects with `RateLimitTimeoutError` / `RateLimitAbortedError`, never a raw infrastructure error).
- No new domain exceptions needed — `RateLimitTimeoutError` / `RateLimitAbortedError` are reused verbatim.

---

## 7. Alternatives Considered

### Alternative 1: Redis Sorted-Set sliding window for BOTH pacing and concurrency (uniform primitive)
- **Description**: Use the same ZSET-based sliding-window approach for `requestsPerMinute` that `McpRateLimiter` uses for its rate limit (member-per-call, evict-then-rank), rather than a single CAS'd timestamp key.
- **Why Rejected**: it changes the *effective* algorithm from minimum-interval pacing (smooth, one request per interval, matching the shipped in-memory `RateLimiter`'s exact behaviour and the ADR-038 rationale against "a burst-tolerant token bucket... a cold capacity-100 bucket fires 100 requests instantly") to a windowed counter that *does* tolerate a burst up to the window's full count at the window's start. The issue's own assumption ("a sliding-window or fixed-window-with-Lua approach is acceptable precision") permits this, but the single-timestamp CAS approach is both simpler (one key, one small script, O(1) memory) and semantically closer to the code it replaces. Rejected in favour of preserving exact behavioural parity where it costs nothing extra to do so.

### Alternative 2: Widen `RateLimiterPort.getStatus()` to async
- **Description**: Change `getStatus(): RateLimitStatus` to `getStatus(): Promise<RateLimitStatus>`, doing a live Redis read (pace key + `ZCARD` on the inflight set) on every call.
- **Why Rejected**: this is a breaking signature change to a port every existing `RateLimiter` (in-memory) caller also implements, rippling into `RateLimiterRegistry.getStatus()` and `RateLimitStatusService` (#1941) for a capability no acceptance criterion in the issue requires. The in-memory `RateLimiter`'s `getStatus()` would also need to become async for interface consistency, touching code with no reason to change. Deferred as a genuinely separate, opt-in follow-up if live cross-process observability is later required — tracked as an open question in § 5, not silently dropped.

### Alternative 3: A distributed lock (e.g. Redlock) guarding a single in-memory-style critical section per acquire
- **Description**: Wrap each `acquire()` in a cross-process mutex, then run the existing `RateLimiter`'s exact logic against Redis-persisted state read/written inside the lock.
- **Why Rejected**: strictly more complex (lock acquisition + release adds two more round-trips and its own failure modes) than the claim-then-rank / CAS approach for no behavioural gain — both a Lua script and a lock achieve atomicity, but the Lua-script approach is single-round-trip and matches the codebase's existing precedent (`RedisSyncLockService` itself uses a Lua CAS for release rather than a nested lock).

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No CORE ↔ Integration boundary crossed — change confined to `libs/shared` + `libs/plugin-sdk` DI wiring.
- ✅ `RateLimiterPort` contract unchanged (method signatures preserved) — verified by `RedisRateLimiterAdapter implements RateLimiterPort` type-checking without modification to the port file.
- ✅ Ports vs. concrete implementations: `HttpTransportFactory` and every integration adapter continue depending only on `RateLimiterPort`/`RateLimiterRegistry`, never on `RedisRateLimiterAdapter` directly.

### Naming Conventions
- ✅ `redis-rate-limiter.adapter.ts` follows `*.adapter.ts` naming (Engineering Standards § Files and Folders — Infrastructure Layer Files).
- ✅ `RedisRateLimiterAdapter` follows `{System}{Capability}Adapter` naming (Engineering Standards § Class Names — Adapters), consistent with `RedisSyncLockService`/`RedisStreamsEventPublisherService` naming for other Redis-backed infra in this codebase (those predate the strict `*Adapter` convention; the new file follows the current standard).

### Existing Patterns
- ✅ Reuses the proven `McpRateLimiter.claimRank` ZSET pattern rather than inventing a new concurrency primitive.
- ✅ Reuses the `RedisSyncLockService` Lua-via-`eval()` calling convention.
- ✅ Registry shape (`get`/`getStatus`/`evict`/`clear`) is unchanged — `RedisRateLimiterAdapter` slots into the existing `RateLimiterRegistry` interface without modification.

### Risks

- **`getStatus()` observability regression** (§ Questions & Assumptions Q2): under Redis backing, a process's `getStatus()` read no longer reflects the true cross-process `inFlight`/`queued` count — only what that process itself has locally observed. Mitigation: document prominently in the adapter's docstring and in the ADR-038 update; this does not affect correctness of throttling, only the accuracy of the operator-facing status readout (`RateLimitStatusService`, #1941).
- **Priority-ordering degradation** (§ Q3): a `background` caller in process A can now be admitted ahead of an `interactive` caller queued in process B, whereas today (single process) `interactive` always wins. Mitigation: explicitly scoped out in this plan and the ADR-038 update; not a regression the issue's acceptance criteria test for, and worker traffic (background) already retries by design per the existing `RateLimiter` file header's own reasoning.
- **Redis round-trip latency added to every outbound call's `acquire()` path**: each `acquire()` now costs at least one (likely two, for pacing + concurrency) Redis round-trips instead of a pure in-process check. Mitigation: Redis is already in the hot path for sync locks/streams in this deployment; round-trip cost (sub-millisecond to low-single-digit ms on a co-located Redis) is negligible relative to the outbound HTTP call itself. Not a new class of dependency — if Redis is down, `noteRetryAfter`/`acquire` already fail open (mitigating a hard outage, not shaving normal-case latency).
- **Testcontainers-based Phase 3 test flakiness**: real-Redis timing-sensitive assertions (two instances racing) can be flaky if not carefully bounded. Mitigation: assert on admission *counts* within a cap (deterministic via the claim-then-rank primitive's guarantee — see `McpRateLimiter`'s own doc comment on why rank, not count-based check-then-act, is race-safe), not on wall-clock timing windows.
- **Key-space growth / leaks**: an abandoned connection's pace/inflight keys must not accumulate forever. Mitigation: both keys carry `EXPIRE` refreshed on write (pace key: TTL a small multiple of the interval; inflight ZSET: TTL refreshed on every claim, members self-evict via the stale-eviction step even without an explicit `evict()` call).

### Edge Cases
- `policy.requestsPerMinute` and/or `policy.maxConcurrent` both `undefined` (unlimited): both Redis gates are skipped entirely — `acquire()` resolves near-instantly, matching the in-memory `RateLimiter`'s behaviour for the same policy shape.
- A connection is disabled/deleted mid-flight (`RateLimiterRegistry.evict(connectionId)`): in-flight/queued callers in *other* processes still hold their own `RedisRateLimiterAdapter` reference and complete normally (matches the existing registry doc's stated eviction contract) — the Redis keys themselves simply age out via TTL once nothing references them anymore.
- `noteRetryAfter(delayMs)` called with `delayMs <= 0`: no-op, matching the in-memory `RateLimiter.noteRetryAfter`'s existing guard — preserved verbatim in the Redis adapter.
- Clock skew between `apps/api` and `apps/worker` hosts: both processes should trust Redis's own clock for CAS decisions where possible (Lua scripts run inside Redis and can use `redis.call('TIME')` rather than each caller's local `Date.now()`) to avoid a fast/slow-clocked process under- or over-throttling relative to the other. **Flag this as an implementation-time decision**: using Redis server time inside the Lua script for the "now" reference removes the clock-skew risk entirely at negligible cost, and is recommended over passing each caller's own `Date.now()` as a Lua argument.

### Backward Compatibility
- ✅ No breaking change to any public contract. `RateLimiterPort`, `RateLimiterRegistry`, `HttpTransportFactoryPort`, and every integration adapter are unchanged.
- ⚠️ Operational behaviour change: `OL_WORKER_REPLICAS` stops having any effect once this ships (it is deleted, per § 5 Q5). Any deployment currently relying on it to keep the aggregate rate correct under horizontal scaling will see its **effective per-replica** rate increase back up to the full configured cap per replica — but since the whole point of this change is that the cap is now shared across all replicas/processes, the *aggregate* behaviour is exactly what the operator configured, which is strictly more correct than today (removes the #1772-adjacent double-throttling side effect where a correctly-set `OL_WORKER_REPLICAS` was still wrong for the `apps/api` process). Worth a one-line release note.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- **File**: `libs/shared/src/rate-limit/redis-rate-limiter.adapter.spec.ts`
- Mock `RedisClientType`; cover pacing admit/wait, concurrency admit/wait, `noteRetryAfter` CAS, fail-open on Redis error (both `acquire` and `noteRetryAfter`), `AbortSignal` rejection, `MAX_TOTAL_WAIT_MS` timeout rejection.
- **File**: `libs/shared/src/rate-limit/rate-limiter-registry.spec.ts` (extend existing, if present, or add coverage for `createRedisRateLimiterRegistry`)
- Assert `get()` lazily creates and caches a `RedisRateLimiterAdapter`, `evict()`/`clear()` drop local references without erroring.

### Integration Tests
- **File**: new `*.int-spec.ts` under `apps/api/test/integration/` (or a Testcontainers-backed spec in `libs/shared` if the package already supports one — confirm during implementation which harness is idiomatic for a `libs/shared`-only concern) per `docs/testing-guide.md`.
- The Phase 3 cross-instance proof test: two `RedisRateLimiterAdapter` instances (simulating api + worker) against one real Redis (Testcontainers), same `connectionId`, asserting the shared cap holds under concurrent load from both "processes" simultaneously.

### Mocking Strategy
- Unit tests: mock `RedisClientType` entirely (no real Redis) — matches `mcp-rate-limiter.spec.ts`'s existing style for this exact class of Redis-ZSET logic.
- Integration test: real Redis via Testcontainers — this is the one test in this plan where mocking Redis would defeat the purpose (the property under test *is* real cross-process atomicity).

### Acceptance Criteria
(mirrors the issue's own AC list, restated as verifiable steps for this plan)
- [ ] `RedisRateLimiterAdapter implements RateLimiterPort` exists in `libs/shared/src/rate-limit/` with atomic per-`connectionId` window/token accounting in Redis.
- [ ] A request issued from a simulated `apps/api`-side limiter instance and a simulated `apps/worker`-side limiter instance against the same `connectionId` are throttled against one shared bucket (Phase 3 test).
- [ ] `noteRetryAfter` signaled by one process-instance is observed by `acquire()` calls from the other instance within the same backoff window.
- [ ] On Redis unavailability, `acquire()` fails open (does not block indefinitely) and logs a warning via the shared `Logger`.
- [ ] `HttpTransportFactory` and all migrated integration adapters require no code changes — verified by running the existing adapter test suites unmodified (Phase 4 Step 1).
- [ ] ADR-038 updated to reflect the resolved cross-process-coordination limitation, including the two newly-surfaced trade-offs (`getStatus()` approximation, priority-ordering scope) this plan identified beyond the issue's original text.
- [ ] Tests added for the Lua/CAS pacing logic, the ZSET concurrency logic, the fail-open path, and retry-after propagation.
- [ ] No architecture boundary violations — confined to `libs/shared` and `libs/plugin-sdk` DI wiring.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — this is an infrastructure adapter behind an unchanged port; no domain/application layer touched.
- [x] Respects CORE vs Integration boundaries — no file under `libs/core/**` or `libs/integrations/**` changes.
- [x] Uses existing patterns (no unnecessary abstractions) — reuses `McpRateLimiter`'s ZSET claim-then-rank pattern and `RedisSyncLockService`'s Lua-via-`eval` convention rather than inventing new primitives.
- [x] Idempotency considered — `RateLimitRelease` remains idempotent (`ZREM` twice is a safe no-op the second time); `noteRetryAfter`'s CAS is naturally idempotent (monotonic max).
- [ ] Event-driven patterns used where applicable — N/A, this is a synchronous throttling primitive, not an event flow.
- [x] Rate limits & retries addressed — this issue IS the rate-limit mechanism; `Retry-After` propagation is explicitly in scope.
- [x] Error handling comprehensive — fail-open on every Redis failure mode, bounded wait with explicit timeout/abort errors.
- [x] Testing strategy complete — unit (mocked Redis) + integration (real Redis, cross-instance) both specified.
- [x] Naming conventions followed — `*.adapter.ts` / `{System}{Capability}Adapter`.
- [x] File structure matches standards — colocated `*.spec.ts`, file headers per module.
- [x] Plan is execution-ready — every step names its file(s), action, and acceptance check.
- [x] Plan is saved as markdown file.

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- [ADR-038: Per-connection outbound rate limiting](../architecture/adrs/038-per-connection-outbound-rate-limiting.md) — the decision this plan closes the documented follow-up for.
