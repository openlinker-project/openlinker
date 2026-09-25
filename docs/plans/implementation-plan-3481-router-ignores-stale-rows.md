# Implementation Plan — #3481: the OMS router ignores stale inventory rows

Epic #3460. Branched from `origin/main`.

## 1. Understand
`OlFulfillmentRouter.loadStock` reads positions via
`IInventoryQueryService.listInventoryItems` → `InventoryRepository.findMany`,
which has no `isStale = false` filter. Routing therefore counts stale rows
(#2322 / #3206 repairs, products deleted at the master #1689) and can route
units that do not exist. **Layer:** CORE (inventory persistence) + OMS plugin.
**Non-goal:** subtracting OL's published holds in the router (#3480).

## 2. Research
Every other availability read (`findAvailabilityByVariantIds`,
`findStockAggregatesByProductIds`, `findLivePositionsByProductIds`) already
filters `isStale = false`. `findMany` also backs the operator inventory list,
which intentionally shows stale rows, so the filter must be opt-in.

## 3. Design
`InventoryFilters.excludeStale?: boolean` — when `true`, `findMany` adds
`isStale = false`; absent keeps today's behaviour. The router passes
`{ productVariantId, excludeStale: true }`. No new port, token, schema or
migration. `/pre-implement` skipped: a one-field opt-in on an existing filter
type, no new identifier beyond the field itself.

## 4. Steps
1. `inventory.types.ts` — `excludeStale` field.
2. `inventory.repository.ts` — honour it in `findMany`.
3. `ol-fulfillment-router.ts` — pass it in `loadStock`.
4. Specs: repository (opt-in only), router (filter passed; stale row not
   counted; live location chosen over stale-only one).
5. `docs/architecture-overview.md` — one bullet.

## 5. Validate
Workspace type-check, lint on changed files, `check:invariants`; tests on CI.
