# Implementation Plan — #3486: returns restock per owning product master

Epic #3460. Branched from #3453 (PR #3489), whose owner read this reuses.

## 1. Understand

**Goal.** With two product masters feeding one warehouse (#3457 v1), a returned
line must be restocked in the master that owns its variant. Today
`ReturnCustodyService` resolves ONE global `InventoryMaster` and blocks every
restock as `ambiguous-inventory-master` once there are two.

**Layer.** CORE (returns + inventory, application).

**Non-goals (per the issue).** The return-detail disclosure `getRestockTarget()`
and the frontend. The disclosure stays return-level, so with several masters the
UI still shows Restock as unavailable — recorded as a known gap for a follow-up.

## 2. Research

- #3453 ships the owner rule (`resolveSaleDecrementOwner`) and the provenance
  read (`InventoryRepositoryPort.findLiveOwnerPositions`).
- A sibling context may not read a `*RepositoryPort`; the cross-context seam is
  `IInventoryQueryService`.
- `ReturnsModule` does not import `InventoryModule`; `InventoryModule` imports
  Products / Integrations / IdentifierMapping / Sync / Events — acyclic.

## 3. Design

- Extract the rule to a neutral pure function
  `resolveInventoryPositionOwner` (`inventory/domain/types/inventory-owner.types.ts`),
  returning a closed reason (`no-position` / `unattributed-owner` /
  `ambiguous-owner`) and counts; `resolveSaleDecrementOwner` delegates and keeps
  its own sentences (behaviour unchanged).
- `IInventoryQueryService.resolveStockOwner(query)` — the cross-context read.
- `ReturnCustodyService.planRestock(line)` replaces `resolveInventoryMaster`:
  0 masters → `no-inventory-master`; 1 → that master, provenance NOT consulted
  (single-master behaviour unchanged, including `NULL`/`legacy` positions);
  several → resolve product, then owner; blocked owner → named block; owner not an
  active `InventoryMaster` → `adapter-unresolved`.
- New `ReturnRestockBlockReason` values: `no-position`, `unattributed-owner`,
  `ambiguous-owner`. The frontend reads `reason` as a plain string, so nothing
  downstream drops them.

## 4. Steps

1. `inventory-owner.types.ts` + spec; `resolveSaleDecrementOwner` delegates.
2. `IInventoryQueryService.resolveStockOwner` + implementation; barrel exports.
3. `ReturnsModule` imports `InventoryModule`; custody service injects the query
   service; `planRestock` + `RestockPlan`; block reasons widened.
4. Specs: single master unchanged (owner never read), owner-routed restock,
   mixed lines to different owners, ambiguous / unattributed / no-position,
   owner not an active master, owner read failure, unresolved product.
5. `docs/architecture-overview.md` — Returns bullet, dependency map, edge count.

## 5. Validate

- No repository port crosses a context; one new acyclic module edge.
- No migration.
- Quality gate: workspace type-check, lint on changed files, `check:invariants`
  (the migration-timestamp check fails on #3453's `1893…` migration, which is
  behind `origin/main`'s `1901…`; that is #3489's to bump, not this change's).
- Rebase note: `origin/main` has since gained #3451 and #3477 in
  `return-custody.service.ts`; this diff was verified to apply cleanly on top of
  `origin/main` + #3453.
