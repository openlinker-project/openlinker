# Implementation Plan — #849 Paczkomat cache v2 (background refresh + query-result caching)

## 1. Understand the task

Deferred from #766. Two acceptance criteria from the #766 spec were carved out because they didn't fit the deliberately-narrow by-id `PickupPointCachePort` that shipped:

1. **Background refresh** — a scheduled job that daily re-warms the **most-frequently-queried** pickup-point searches (configurable cron).
2. **Per-search-query result caching** — cache whole `query → PickupPoint[]` results (shorter TTL than the 24h per-point entry), so repeated identical searches don't always hit the provider (ShipX / DPD).

**Layer:** CORE (shipping context) + Interface (API scheduler) + a worker handler. **Capability-scoped, not InPost-specific** — `PickupPointFinder` is now implemented by both InPost **and** DPD (#973), so the feature keys off the `ShippingProviderManager` + `PickupPointFinder` capability, never a `platformType` string.

**Non-goals (unchanged from #766):** full ~15k-locker PL snapshot; geo-radius / map search; cache invalidation on provider update; widening the by-id `PickupPointCachePort` (it stays as-is).

## 2. Research (findings)

- **By-id cache (shipped, #766):** `PickupPointCachePort` (get/put by `providerId`) → `RedisPickupPointCacheAdapter` over the shared `CachePort`, key `paczkomat:point:{id}`, 24h TTL. `PickupPointLookupService.search()` runs a live provider search and write-throughs each point. Token `PICKUP_POINT_CACHE_TOKEN`.
- **Shared `CachePort`** (`libs/shared/src/cache/cache.port.ts`): **KV only** — `get<T>`, `set<T>(…, ttlSec)`, `delete`. No sorted-set / increment / SCAN. ⇒ frequency *ranking* cannot go through it; needs a dedicated port. The Redis adapter injects the raw `'REDIS_CLIENT'` token.
- **Scheduler pattern:** `SchedulerTaskConfig` (`libs/core/src/sync/domain/types/scheduler-task.types.ts`): `{ taskId, jobType, cronExpression, enabledEnvVar?, connectionFilter?, generatePayload, generateIdempotencyKey }`. Core tasks are registered inline in `apps/api/src/sync/application/services/scheduler.service.ts` (`registerInventorySyncTask()` is the template — capability filter via `integrationsService.listCapabilityAdapters({ capability })` → `Connection[]`, enqueues one job per connection). Plugin tasks come from `schedulerTaskRegistry`.
- **Job types:** `JobTypeValues` union in `libs/core/src/sync/domain/types/sync-job.types.ts`; worker handler registered in `apps/worker/src/sync/handlers/handler-registration.service.ts` (`handlerRegistry.register(jobType, handler)`); a handler implements `SyncJobHandler.execute(job): SyncJobHandlerResult`.
- **Worker wiring:** `ShippingModule` is already imported by `apps/worker/src/sync/sync-worker.module.ts` (for the status-sync service, #838); it exports the pickup-point tokens — so a worker handler can inject a new shipping service token.
- **Orchestration belongs in core** (architecture §Sync Manager): the worker handler stays thin and delegates to a core application service.
- **No DB / migration** — everything is Redis-backed.

## 3. Design

Two new single-purpose **sibling ports** (the by-id `PickupPointCachePort` stays untouched, per its own "add when a real consumer surfaces" note), one new core service, one worker handler, one core scheduler task.

### New domain ports (`libs/core/src/shipping/domain/ports/`)
- **`PickupPointSearchCachePort`** — `get(connectionId, query): Promise<PickupPoint[] | null>`, `put(connectionId, query, points): Promise<void>`. Caches the whole result list.
- **`PickupPointQueryStatsPort`** — `record(connectionId, query): Promise<void>`, `topQueries(connectionId, limit): Promise<FindPickupPointsQuery[]>`. Frequency tracking + top-N ranking.

### New normalizer (`libs/core/src/shipping/domain/pickup-point-query.ts`, pure)
**Two derivations** (tech-review IMPORTANT — `limit` must be handled differently for the two keyspaces; do NOT share one key):
- `pickupPointFrequencyKey(query): string` — lowercase/trim `city`/`postalCode`/`searchText`, **excludes `limit`** (popularity of a locality query must not fragment by page size).
- `pickupPointSearchCacheKey(query): string` — same normalization but **includes `limit`** (simplest correct option). Excluding it would let a `limit=5` cache entry wrongly satisfy a later `limit=50` query with a truncated list. (Alternative considered: cache the full list and slice on read — more code; deferred. `limit` values are a small fixed set in practice, so key fragmentation is negligible.)

Both are pure functions, domain-safe (runtime code → a `pickup-point-query.ts`, not a `*.types.ts`).

### New adapters (`libs/core/src/shipping/infrastructure/adapters/`)
- **`RedisPickupPointSearchCacheAdapter`** (over shared `CachePort`): key `paczkomat:search:{connectionId}:{pickupPointSearchCacheKey(query)}` (limit-inclusive), TTL `OL_PICKUP_POINT_SEARCH_CACHE_TTL_SECONDS` (default 3600 = 1h; shorter than the 24h per-point entry because lists go stale faster). Token `PICKUP_POINT_SEARCH_CACHE_TOKEN`.
- **`RedisPickupPointQueryStatsAdapter`** — **option A confirmed feasible** (tech-review IMPORTANT resolved): `RedisConfigModule` is `@Global()` and `exports: ['REDIS_CLIENT']`, and the raw client is already injected across `libs/core` (`RedisSyncLockService`, the Redis-Streams job-enqueue + event-publisher adapters) for exactly the ops the KV `CachePort` can't express. This adapter follows that established precedent — `@Inject('REDIS_CLIENT')`, `ZINCRBY` on `paczkomat:freq:{connectionId}` keyed by `pickupPointFrequencyKey(query)`, `EXPIRE` for a rolling ~7-day window, `ZREVRANGE 0 N-1` for `topQueries`, optional `ZREMRANGEBYRANK` to cap cardinality. File header must state the rationale (atomic top-N; KV port can't rank) and cite the `RedisSyncLockService` precedent so it isn't "fixed" back to `CachePort`. Token `PICKUP_POINT_QUERY_STATS_TOKEN`. The port stays adapter-agnostic, so a `CounterCachePort` promotion to `@openlinker/shared/cache` remains the future path if a second ranking consumer appears.

  **`topQueries` returns `FindPickupPointsQuery[]`** — since the ZSET member is the normalized frequency key (limit-excluded), the adapter must store enough to reconstruct a `FindPickupPointsQuery` (store the original `{city,postalCode,searchText}` as the member via a stable JSON encoding, or a `paczkomat:freq:meta` hash mapping key→query). The refresh re-search runs without an explicit `limit` (provider default), so the limit-exclusion on the frequency key is consistent with how the warm re-runs the search.

### Changed: `PickupPointLookupService`
- `search(connectionId, query)` (operator path, controller-facing): **(1)** `stats.record(connectionId, query)`; **(2)** `searchCache.get` → on hit, return cached list (skip provider call); **(3)** on miss, live provider search → `searchCache.put` + per-point `cache.put` write-through (existing). Frequency is recorded for *operator* searches only.
- New `refreshSearch(connectionId, query)`: live search → write-through both caches, **bypassing** the result-cache read and **not** recording frequency (so the daily re-warm doesn't self-reinforce its own counts). Shares a private `runLiveSearchAndCache`.

### New core service: `PickupPointRefreshService` (`IPickupPointRefreshService`, token `PICKUP_POINT_REFRESH_SERVICE_TOKEN`)
`refreshFrequentForConnection(connectionId): Promise<{ refreshed; failed }>` — **guards `isPickupPointFinder` up front** (tech-review SUGGESTION): resolves the connection's `ShippingProviderManager` adapter, early-returns `{refreshed:0,failed:0}` if it isn't a `PickupPointFinder` (so a stray recorded query can't trigger `PickupPointFinderNotSupportedException` mid-loop, and non-finder SPM connections no-op cleanly). Then reads `stats.topQueries(connectionId, N)` (`N` = `OL_PICKUP_POINT_REFRESH_TOP_N`, default 50, clamped), calls `lookup.refreshSearch` per query, isolates per-query failure (a dead query must not abort the batch), returns counts. Registered + exported from `ShippingModule`.

### New job type + worker handler
- Add `'shipping.pickupPoint.refreshFrequent'` to `JobTypeValues`.
- `PickupPointRefreshHandler` (`apps/worker/src/sync/handlers/`): thin — reads `job.connectionId`, calls `PickupPointRefreshService.refreshFrequentForConnection`, returns `{ outcome: 'ok' }`. Registered in `handler-registration.service.ts`.

### New core scheduler task (`SchedulerService.registerPickupPointRefreshTask`)
Mirrors `registerInventorySyncTask`: env-gated `OL_PICKUP_POINT_REFRESH_ENABLED` (default on), `cronExpression` = `OL_PICKUP_POINT_REFRESH_CRON` (default `0 3 * * *`, daily 03:00), `connectionFilter` = `listCapabilityAdapters({ capability: 'ShippingProviderManager' })` → `Connection[]`, one `shipping.pickupPoint.refreshFrequent` job per connection. Idempotency key `shipping:{connectionId}:pickupPoints:refresh:{timestamp}`. (Connections that are SPM but not `PickupPointFinder` → the handler/service no-ops with `topQueries` empty; harmless.)

### Data flow
```
operator → GET /pickup-points → PickupPointLookupService.search
    → stats.record  → searchCache.get (hit? return) → live search → searchCache.put + point cache.put

daily cron (SchedulerService) → enqueue shipping.pickupPoint.refreshFrequent per SPM connection
    → PickupPointRefreshHandler → PickupPointRefreshService.refreshFrequentForConnection
        → stats.topQueries(N) → per query: lookup.refreshSearch (fresh) → re-warm both caches
```

## 4. Step-by-step

1. **Ports + normalizer** — create `pickup-point-search-cache.port.ts`, `pickup-point-query-stats.port.ts`, `pickup-point-query.ts` (normalizer + unit spec). AC: domain-only, no framework imports; normalizer excludes `limit`, stable across key reorder.
2. **Tokens** — add `PICKUP_POINT_SEARCH_CACHE_TOKEN`, `PICKUP_POINT_QUERY_STATS_TOKEN`, `PICKUP_POINT_REFRESH_SERVICE_TOKEN` to `shipping.tokens.ts`. AC: token-only file rule preserved.
3. **Search-cache adapter** + spec (over shared `CachePort`, env TTL with default+clamp). AC: round-trips a `PickupPoint[]`; key uses normalized query; TTL honored (mocked CachePort assertion).
4. **Query-stats adapter** + spec — per OQ-1 decision. AC: `record` increments; `topQueries(n)` returns the n most-frequent normalized queries as `FindPickupPointsQuery[]`, most-frequent first; bounded.
5. **`PickupPointLookupService`** — inject the 2 new ports; implement record→cache-first→write-through in `search`; add `refreshSearch`; update interface + spec. AC: cache-hit skips provider; refresh path neither reads result-cache nor records frequency; existing tests still green.
6. **`PickupPointRefreshService`** + interface + spec. AC: reads top-N, per-query isolation (one throwing query doesn't abort), returns counts; N clamped.
7. **Job type** — add `'shipping.pickupPoint.refreshFrequent'` to `JobTypeValues`. AC: union updated; downstream `JobType` checks compile.
8. **Worker handler** `PickupPointRefreshHandler` + spec; register in `handler-registration.service.ts`. AC: delegates to core service, returns `ok`; registered for the job type.
9. **Scheduler task** `registerPickupPointRefreshTask` in `SchedulerService` + spec coverage. AC: env-gated; capability-filtered connection fan-out; one job per connection; idempotency key shape.
10. **Module wiring + barrel** — `ShippingModule` providers/exports for the 3 new tokens; export the refresh-service token (+ any types the worker needs) from `@openlinker/core/shipping`. AC: worker resolves `PICKUP_POINT_REFRESH_SERVICE_TOKEN`.
11. **Docs/env** — document the 4 new `OL_PICKUP_POINT_*` env vars (`.env.example` + a line in the shipping/testing or dev-environment doc); one-line note in `architecture-overview.md` §Listings/Shipping if warranted.
12. **Quality gate** — build libs first (`pnpm -r --filter "./libs/**" build`), then `pnpm lint && pnpm type-check && pnpm test`; `migration:show` = no pending (no schema change, sanity only).

## 5. Validation

- **Architecture:** new ports in `domain/ports/`, adapters in `infrastructure/adapters/`, orchestration in a core service; worker handler stays thin (delegates to core, per §Sync Manager). Capability-scoped (no `platformType` literal). Tokens follow the Symbol convention. No `any`; `Logger` from `@openlinker/shared/logging`.
- **Testing:** unit specs for normalizer, both adapters (mock `CachePort` / Redis client), lookup-service new paths, refresh service (isolation), worker handler, scheduler task. No integration test strictly required (Redis-only, no DB vertical slice) — mirror #766's unit-level coverage.
- **Security:** no secrets; pickup-point data is non-sensitive; the controller path is unchanged (already `@Roles('admin')`).
- **Migrations:** none (Redis only).

## Resolved decisions (from user + tech-review)

- **OQ-1 (frequency-tracking adapter) → (A) Redis ZSET, confirmed feasible.** Long-term-correct: top-N ranking is intrinsically a sorted-set problem (atomic `ZINCRBY`, server-side `ZREVRANGE`, bounded via `ZREMRANGEBYRANK`); the JSON-map alternative loses increments under concurrency and needs manual capping. Feasibility verified: `RedisConfigModule` is `@Global()` + `exports: ['REDIS_CLIENT']`, already injected in `libs/core` (`RedisSyncLockService`, Redis-Streams adapters) — established precedent, not a novel coupling. Future path if a 2nd ranking consumer appears: promote a `CounterCachePort` to `@openlinker/shared/cache` (YAGNI now).
- **`limit` keying (tech-review IMPORTANT).** Frequency key excludes `limit`; search-cache key includes it. Two normalizer helpers, not one shared key.
- **OQ-2 (result-cache-hit semantics):** a hit returns the cached list and **skips the live provider call** within the short TTL — the point of the feature. Trades a little freshness for latency/rate-limit relief; 1h default TTL bounds staleness (issue framing: "lists go stale faster… shorter TTL"). `search()` thus shifts from always-live to cache-first — intended.
- **OQ-3 (env knob count):** 4 new `OL_PICKUP_POINT_*` knobs (enabled, cron, top-N, search-TTL), sensible defaults, numeric ones clamped — matches #766's operability posture.

## Remaining open questions
- None blocking. Optional: a single `*.int-spec.ts` exercising the ZSET stats adapter against the Testcontainer Redis (mocking `ZINCRBY`/`ZREVRANGE` is low-value). Will add if the unit-level coverage feels thin after implementation.
