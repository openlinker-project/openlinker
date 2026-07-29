# Implementation Plan - Master-prune connection-ownership guard (#1904)

## 1. Understand the task

**Goal.** Both master-deletion prune paths sweep staleness keyed on the internal
`productId` alone, with no connection scoping:

- `MasterProductSyncService` (`libs/core/src/products/application/services/master-product-sync.service.ts`)
  - normal path: `markVariantsStaleExcept(internalProductId, keepIds)`
  - deletion path: `handleMasterDeletion` → `markVariantsStaleExcept(internalProductId, [])`
- `MasterInventorySyncService` (`libs/core/src/inventory/application/services/master-inventory-sync.service.ts`)
  - normal path: `pruneStaleVariants(internalProductId, currentVariantIds)`
  - deletion path: `handleMasterDeletion` → `pruneStaleVariants(internalProductId, [])`

Neither `product_variants` nor `inventory_items` carries connection provenance, so
if two `ProductMaster` / `InventoryMaster` connections ever converged on one
internal product id, one connection's 404 (or a partial-removal response) would
stale rows a sibling connection still considers live, with no way to attribute or
scope the prune.

**Layer.** CORE (application services + one new core application service in the
`integrations` context). No adapter, no interface-layer, no frontend change.

**Non-goals.**
- No `connectionId` provenance column / migration on `inventory_items` or
  `product_variants` (rejected as non-MVP for a condition that is unreachable
  through any supported workflow - see the issue's "Why this is not reachable
  today").
- No config-time restriction on enabling `InventoryMaster` / `ProductMaster` on a
  second connection (multi-store masters are a supported scenario, and catalog
  overlap is not knowable at config time).
- No change to the upsert half of either sync (last-write-wins stays as-is); the
  guard covers only the destructive prune.

## 2. Research findings (reuse, not new machinery)

- `IIdentifierMappingService.getExternalIds(entityType, internalId)` already
  returns **every** connection-scoped mapping for an internal id - exactly the
  "who claims this id" read the guard needs. No new repository method.
- `IIntegrationsService.listCapabilityAdapters({ capability, lazy: true })`
  (#1206) returns active connections that both *support* and have *enabled* a
  capability, with zero adapter construction when only `.connection` is read.
  That is the "is the rival actually a master" read.
- Identifier mappings for `CORE_ENTITY_TYPE.Product` are written only by
  master-side flows (PrestaShop/WooCommerce `ProductMaster` + `InventoryMaster`
  adapters and the two core sync services); destination flows key on
  `ShopProduct` / `Offer`. The capability filter is nonetheless kept so a future
  destination flow that writes `Product` mappings cannot silently disable
  pruning.
- Both `ProductsModule` and `InventoryModule` already import the core
  `IntegrationsModule`, so the new service needs no new module edges.

## 3. Design

A new core application service in the **integrations** context answers the
neutral question "which *other* connections with capability X claim this internal
entity id?". The integrations context is the right owner: it already depends on
`identifier-mapping` (no new dependency edge, no cycle), and neither `products`
nor `inventory` owns connection/capability knowledge.

```
IEntityClaimService.findRivalClaimants({
  entityType, internalId, capability, excludeConnectionId
}): Promise<string[]>
```

Resolution:
1. `getExternalIds(entityType, internalId)` → distinct connection ids, minus
   `excludeConnectionId`.
2. **Short-circuit**: no other claimant ⇒ `[]` (the overwhelmingly common case,
   so the hot sync path costs one indexed read and never touches the connection
   list).
3. Otherwise intersect the remaining candidates with
   `listCapabilityAdapters({ capability, lazy: true })` connection ids.

Both master sync services call it immediately before every prune. On a non-empty
result they **skip the prune** (never stale a live sibling's rows), log an error
under a stable token, skip the corresponding `master.*.stale` event (nothing was
marked), and report `pruneSkipped: true` on the sync result. Skipping is the
conservative direction: the destructive half is withheld, the condition is named
loudly for the operator, and staleness stays recoverable (a later sync marks it).

## 4. Steps

1. `libs/core/src/integrations/application/types/entity-claim.types.ts` (new) -
   `EntityClaimQuery` input type (`entityType`, `internalId`, `capability`,
   `excludeConnectionId`). Follows the `products/application/types/*.types.ts`
   precedent.
2. `libs/core/src/integrations/application/interfaces/entity-claim.service.interface.ts`
   (new) - `IEntityClaimService`, single method `findRivalClaimants`.
3. `libs/core/src/integrations/application/services/entity-claim.service.ts`
   (new) - `EntityClaimService implements IEntityClaimService`; injects
   `IDENTIFIER_MAPPING_PORT_TOKEN` + `INTEGRATIONS_SERVICE_TOKEN`.
4. `libs/core/src/integrations/integrations.tokens.ts` -
   `ENTITY_CLAIM_SERVICE_TOKEN = Symbol('IEntityClaimService')`.
5. `libs/core/src/integrations/integrations.module.ts` - provider +
   `useExisting` binding + export.
6. `libs/core/src/integrations/index.ts` - export the interface + query type
   (the token rides the existing `export * from './integrations.tokens'`).
7. `master-product-sync.service.ts` - inject the claim service; guard both prune
   sites with capability `'ProductMaster'`; add `pruneSkipped` to
   `MasterProductSyncResult`.
8. `master-inventory-sync.service.ts` - same with capability
   `'InventoryMaster'`; add `pruneSkipped` to `MasterInventorySyncResult`.
9. Worker handlers (`apps/worker/src/sync/handlers/master-{product,inventory}-sync.handler.ts`)
   - log a job-correlated warning when `result.pruneSkipped` is set. `outcome`
   is unchanged (a skipped prune is not a business failure by itself; a master
   deletion still maps to `business_failure`).
10. Tests: new `entity-claim.service.spec.ts`; extend both master-sync specs
    (guard trips ⇒ no prune + no event + `pruneSkipped: true`; guard clear ⇒
    unchanged behaviour; non-master rival ignored); update the two handler specs'
    result literals.
11. Docs: `docs/architecture-overview.md` (Products + Inventory context bullets),
    `docs/lessons.md` entry.

## 5. Validation

- Architecture: no new cross-context edge (`products`/`inventory` →
  `integrations` already exist); the cross-context surface used is an `I*Service`
  + `*_TOKEN`, which `scripts/check-cross-context-imports.mjs` allows.
- Naming: `*.service.interface.ts` / `*.service.ts` / `*.types.ts`, Symbol token
  named `{CONTEXT}_{INTERFACE}_TOKEN`.
- No schema change ⇒ no migration.
- Security: no new external input, no credential access (the lazy adapter list
  never constructs adapters).
- Quality gate: `pnpm lint && pnpm type-check && pnpm test`.
