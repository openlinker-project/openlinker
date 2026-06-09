# Pre-implement gate — #849 Paczkomat cache v2

**Plan:** `docs/plans/implementation-plan-849-paczkomat-cache-v2.md`
**Gate run:** read-only, against the live worktree @ `13001fd1`.

## Verdict: `READY`

No reuse collisions, no contract-surface breaks. The change is purely additive (new ports/adapters/service/tokens/job-type + an additive method on one in-context interface). No DB/migration. The one feasibility risk flagged in `/tech-review` (raw `'REDIS_CLIENT'` injectable from the shipping context) was verified resolved before this gate — `RedisConfigModule` is `@Global()` + `exports: ['REDIS_CLIENT']`, already injected across `libs/core`.

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `PickupPointSearchCachePort` (port) | **NEW** | tree-wide grep: absent |
| `PickupPointQueryStatsPort` (port) | **NEW** | absent |
| `pickup-point-query.ts` (normalizer) | **NEW** | absent |
| `RedisPickupPointSearchCacheAdapter` | **NEW** | absent |
| `RedisPickupPointQueryStatsAdapter` | **NEW** | absent |
| `PickupPointRefreshService` / `IPickupPointRefreshService` | **NEW** | absent |
| `PickupPointRefreshHandler` (worker) | **NEW** | absent |
| `registerPickupPointRefreshTask` (scheduler) | **NEW** | absent |
| 3 tokens (`PICKUP_POINT_SEARCH_CACHE_TOKEN`, `…_QUERY_STATS_TOKEN`, `…_REFRESH_SERVICE_TOKEN`) | **NEW** | `shipping.tokens.ts` holds 10 tokens, none of these |
| job type `shipping.pickupPoint.refreshFrequent` | **NEW** | `JobTypeValues` (16 entries) has no `shipping.*` |
| **Reused (not recreated):** shared `CachePort` + `CACHE_PORT_TOKEN` (`@Global`), `'REDIS_CLIENT'` (`@Global` export), `SchedulerTaskConfig` registry + `SchedulerService`, `JobTypeValues` + `SyncJobHandlerRegistry`, `IIntegrationsService.listCapabilityAdapters({capability:'ShippingProviderManager'})`, `PickupPointLookupService` / `isPickupPointFinder` / `FindPickupPointsQuery` / `PickupPoint`, `ShippingModule` (already worker-imported) | **EXISTS → reuse** | confirmed in research + barrel |

No reinvention. The by-id `PickupPointCachePort` is correctly left untouched (sibling ports instead).

## Backward-compat findings

| Surface | Finding | Severity |
|---|---|---|
| `shipping.tokens.ts` + barrel | 3 tokens added; barrel re-exports via `export * from './shipping.tokens'` (line 15) → auto-exposed. Additive. New port-types + `IPickupPointRefreshService` need **explicit** named exports in `shipping/index.ts` (the barrel lists ports/interfaces explicitly) — additive, no removals. | OK (additive) |
| `IPickupPointLookupService` | Plan adds a `refreshSearch` method (and the impl gains 2 injected deps). Additive to an exported interface; the **only** implementer is the in-context service, and the sole external caller (`PickupPointController`) is unaffected. The existing `pickup-point-lookup.service.spec.ts` mock must add the method — expected test work, not a consumer break. | Warning (intended) |
| `JobTypeValues` | New union member `shipping.pickupPoint.refreshFrequent` — additive; introduces a `shipping.*` namespace (new but consistent with the context name). | OK (additive) |
| ORM schema / migration | None — Redis-only. | — |
| `check:invariants` | **cross-context-imports:** worker handler imports the `@openlinker/core/shipping` barrel + scheduler uses the already-injected `IIntegrationsService` — no deny-pattern (no cross-context `*RepositoryPort` / ORM-entity / adapter). **service-interfaces:** `PickupPointRefreshService` implements `IPickupPointRefreshService`; adapters implement their `*Port` — satisfied. **tokens-file rule:** only Symbols added to `shipping.tokens.ts`. **jest-integration-mappers:** no new package → no mapper change. | OK |

## Open questions

- None blocking. Implementation notes already captured in the plan: (1) `topQueries` must persist enough to reconstruct a `FindPickupPointsQuery` from the ZSET member (store `{city,postalCode,searchText}` as a stable-JSON member); (2) two normalizer derivations (freq excludes `limit`, search-cache includes it); (3) refresh service guards `isPickupPointFinder` up front; (4) add explicit barrel exports for the two new port types + the refresh-service interface.

## Bottom line

Plan is internally consistent, reuses the right seams, and breaks nothing. The ZSET-adapter feasibility (the one real risk) is confirmed. Proceed to implementation; build libs before the quality gate (cross-package `dist` resolution).
