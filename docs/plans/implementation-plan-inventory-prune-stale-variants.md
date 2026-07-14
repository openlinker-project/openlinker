# Implementation Plan — Prune stale `inventory_items` for variants deleted at the master (#1478)

## 1. Understand the task

**Goal.** When a variant is deleted at the inventory master (e.g. a PrestaShop combination is removed), `MasterInventorySyncService.syncFromMasterByExternalId` upserts one row per entry `listInventory` returns but never diffs against what is already stored — so the row for a now-deleted variant lingers forever with stale stock. Close that backend data-integrity gap by **soft-marking** orphaned rows `isStale` and excluding them from the availability read the bulk offer wizard acts on.

**Layer.** CORE — Domain (entity), Application (service + sync orchestration), Infrastructure (ORM entity, repository, migration).

**Non-goals (explicit).**
- No hard delete — soft `isStale` flag preserves debugging history (per reporter + repo conventions).
- No FE surfacing of stale rows (a badge on the product page) — deferred.
- No new variant-deletion detection in the `products` context — the diff is inferred purely from the master's `listInventory` response.

## 2. Research (findings)

- `MasterInventorySyncService.syncFromMasterByExternalId` (`master-inventory-sync.service.ts:43-83`) loops `listInventory` → `toDomainInventoryItem` → `inventoryService.setInventory` (upsert only). No diff/prune step.
- `InventoryItem` domain entity (`inventory-item.entity.ts`) is a 7-field readonly data holder.
- `InventoryRepositoryPort` exposes `findByProductAndVariant / upsert / findById / findMany / findAvailabilityByVariantIds` — **no delete/prune**.
- `IInventoryService` exposes only `setInventory` (upsert) + `getInventory`.
- `upsert` (`inventory.repository.ts:131`) finds existing by `(productId, productVariantId, locationId)` then `save`s — so a reappearing variant naturally reuses its row **iff** the lookup still finds the stale row.
- `findAvailabilityByVariantIds` (`inventory.repository.ts:103`) is the aggregate the bulk wizard / product page availability read consumes (`VariantAvailability`).
- Barrel: domain entity is re-exported as `InventoryItemEntity`; ORM entity via `@openlinker/core/inventory/orm-entities`.
- Migration convention (`docs/migrations.md` §Ordered/#1013): synthetic sequential prefix, strictly greater than tail. Current tail = `1818000000006` → **use `1818000000007`**. Self-healing `ADD COLUMN IF NOT EXISTS`.
- Existing tests to touch: `master-inventory-sync.service.spec.ts` (mock needs the new service method), `inventory.service.spec.ts`. Existing int-spec patterns: `inventory-availability.int-spec.ts`, `inventory-multivariant-cleanup.int-spec.ts`.

## 3. Design

### `isStale` flag lifecycle
- **Mark stale:** after the per-inventory upsert loop, the sync calls `pruneStaleVariants(productId, keptVariantIds)` where `keptVariantIds` = the resolved `productVariantId` of every item written this run (includes `null` for a product-level row). The repo marks every non-stale row for that product whose `productVariantId` is not in the kept set as `isStale = true`. Empty response ⇒ every row for the product is marked stale.
- **Clear stale (reappear):** the sync always constructs domain items with `isStale = false`; `upsert` maps that through, and because `findByProductAndVariant` (the upsert's existing-row lookup) **does not** filter on `isStale`, the reappearing variant's existing stale row is found by its `(product, variant, location)` key and overwritten `isStale = false` — no duplicate row.

### Read-side exclusion (design fork — see §Open question)
- **`findAvailabilityByVariantIds` excludes `isStale = true`** — this is the read the bulk wizard *acts on*; it is the actual blast radius of the bug.
- `findByProductAndVariant` **must stay inclusive** — the upsert reappear-clear path depends on it finding stale rows.
- `findMany` / `findById` **stay inclusive** — the raw product-page list keeps returning stale rows so a future (deferred) FE badge can surface them; hiding them is an FE concern, not a data-integrity one.

### Data flow
```
syncFromMasterByExternalId
  for each master inventory → build item(isStale=false) → setInventory (upsert, clears stale)
                                                        → keptVariantIds.push(item.productVariantId)
  → inventoryService.pruneStaleVariants(productId, keptVariantIds)
        → repo.markStaleExceptVariants(productId, keptVariantIds)   // UPDATE ... SET is_stale=true
```

## 4. Step-by-step

1. **Domain entity** `inventory-item.entity.ts` — add `public readonly isStale: boolean = false` as the **last** constructor param (default keeps all existing `new InventoryItem(...)` call sites compiling).
2. **ORM entity** `inventory-item.orm-entity.ts` — add `@Column({ type: 'boolean', default: false }) isStale!: boolean;`.
3. **Migration** `apps/api/src/migrations/1818000000007-add-inventory-item-is-stale.ts` — `ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "is_stale" boolean NOT NULL DEFAULT false` (+ `DROP COLUMN IF EXISTS` down). Class `AddInventoryItemIsStale1818000000007`. *(Column name: confirm TypeORM's default naming maps `isStale` → `isStale`; the ORM entity uses camelCase property names with no naming strategy override — so the DDL column must match whatever the entity resolves to. Verify with `migration:show` / a generate dry-run and align the ALTER to the actual column name.)*
4. **Repository port** `inventory-repository.port.ts` — add `markStaleExceptVariants(productId: string, keepVariantIds: readonly (string | null)[]): Promise<number>` (returns affected-row count).
5. **Repository impl** `inventory.repository.ts`:
   - Implement `markStaleExceptVariants` via an UPDATE query builder: `WHERE productId = :pid AND isStale = false AND (row's variant not in keep set)`, with explicit NULL handling (product-level row kept only if `null ∈ keepVariantIds`; empty keep set ⇒ all rows stale).
   - Add `.andWhere('inv.isStale = false')` to `findAvailabilityByVariantIds`.
   - Map `isStale` in `toDomain` and `toOrmEntity`.
6. **Service interface** `inventory.service.interface.ts` — add `pruneStaleVariants(productId: string, currentVariantIds: readonly (string | null)[]): Promise<number>`.
7. **Service impl** `inventory.service.ts` — implement `pruneStaleVariants`, delegating to `repo.markStaleExceptVariants` (with a debug log of affected count).
8. **Wire into sync** `master-inventory-sync.service.ts` — collect `keptVariantIds` in the loop; after the loop call `pruneStaleVariants(internalProductId, keptVariantIds)` unconditionally.
9. **Tests:**
   - `master-inventory-sync.service.spec.ts` — add `pruneStaleVariants: jest.fn()` to the `inventoryService` mock (required — the service now calls it); new test: after sync, `pruneStaleVariants` is called with `(internalProductId, [<written variant ids>])`.
   - `inventory.service.spec.ts` — `pruneStaleVariants` delegates to `markStaleExceptVariants`.
   - New int-spec `apps/api/test/integration/inventory-stale-prune.int-spec.ts` (real Postgres): (a) variant removed from master response → its row marked stale, surviving variant untouched; (b) reappear → `isStale` cleared, no duplicate row; (c) `findAvailabilityByVariantIds` omits stale rows; (d) product-level `null` row pruned when a simple product's synthetic variant disappears.

## 5. Validate

- **Architecture:** all changes CORE-side; port stays minimal (intent-named `markStaleExceptVariants`, not a generic delete); no CORE↔Integration boundary crossed; no framework leak into domain.
- **Naming:** matches `docs/engineering-standards.md` (port method intent-named; migration prefix + class-suffix invariant).
- **Security:** parameterised query builder — no raw SQL interpolation.
- **Migration:** additive, self-healing, `NOT NULL DEFAULT false` safe for existing rows; `migration:show` clean after generate.
- **Testing:** unit covers orchestration + delegation; int-spec covers the SQL (mark / clear / exclude / product-level).

## Open question (design fork)
Read-side exclusion is scoped to **`findAvailabilityByVariantIds` only** (the read the wizard acts on). The product-page list (`findMany`) stays inclusive so a deferred FE badge can surface stale rows. Alternative: also filter `findMany`, hiding stale rows everywhere now. Recommendation: **keep `findMany` inclusive** — matches the issue's "FE surfacing is deferred / out of scope" assumption and avoids silently dropping rows an operator may want to see. Flagging for confirmation.
