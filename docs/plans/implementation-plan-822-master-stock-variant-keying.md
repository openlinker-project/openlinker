# Implementation Plan — #822 Bulk wizard "NO MASTER STOCK" (variant-keyed inventory — Option 2)

## 1. Understand the task

**Goal:** The bulk Allegro offer-creation wizard reports `NO MASTER STOCK` for every product even when stock exists, because `inventory_items` rows are keyed by **product** (`productVariantId = NULL`) while the wizard reads availability by **variant**. The architecture's canonical target for offers/mappings is the **variant** (simple products get a deterministic synthetic variant). Option 2 removes the anomaly: **make master-inventory sync write variant-keyed rows**, and backfill existing rows, so reads-by-variant find stock. No read-side heuristic.

**Chosen approach (Option 2 — write-side normalization):**
1. At sync time, resolve the product's canonical variant. For a **single-variant product** (the synthetic variant of a simple product), key the inventory row to that variant id.
2. Backfill existing product-level rows (`productVariantId IS NULL`) to variant-keyed via a data migration, for single-variant products.
3. No read-path change — the existing `findAvailabilityByVariantIds` query finds the now-variant-keyed rows.

**Layer classification:** CORE — inventory application (sync service) + products application (one read method) + one **data migration** (`apps/api/src/migrations/`). **No schema change** (the `productVariantId` column and both partial unique indexes already exist — the ORM entity already "Supports both product-level and variant-level inventory"). No FE/API contract change.

**Non-goals:**
- **Multi-variant (combination) products.** The PrestaShop `InventoryMasterAdapter.getInventory(productId)` returns a single product-level aggregate (`id_product_attribute=0`) and never enumerates per-combination stock. Splitting one aggregate across multiple variants is not possible without an adapter change, so multi-variant products keep a product-level row and continue to read as 0 (honest, not over-reported). This deferred scope is split into two filed follow-ups, referenced from ADR-010 and from a code comment at the resolver fallback in `master-inventory-sync.service.ts` so the gap is discoverable, not silently permanent:
  - **#823 (master half)** — PrestaShop adapter enumerates per-combination `stock_availables` → emits one `Inventory` per combination with `variantId`; sync writes one variant-keyed row per combination.
  - **#824 (destination half)** — bulk flow lists one Allegro offer per variant, sharing the catalog product + emitting the variant parameter so Allegro **auto-groups** them. Note (verified against developer.allegro.pl): Allegro's explicit variant-set API (`/sale/offer-variants`) was removed on 2026-04-14 (returns 404); stock on Allegro is per-offer, so OL's existing 1-variant→1-offer model is already the right shape and #824 must use auto-grouping, not the dead API.
- No read-side fallback (deliberately — variant-keyed storage is the durable fix).

## 2. Research findings

- **Schema already supports variant-keyed inventory** — `inventory-item.orm-entity.ts` declares two partial unique indexes: `(productId, locationId) WHERE productVariantId IS NULL` and `(productId, productVariantId, locationId) WHERE productVariantId IS NOT NULL`. Variant-keyed rows are first-class today; only the *data* and the *write path* default to NULL.
- **Write path is the root cause** — `MasterInventorySyncService.toDomainInventoryItem` (`master-inventory-sync.service.ts:89`) sets `productVariantId = inventory.variantId ?? null`. The PrestaShop adapter calls `mapInventory(stockRecord, productId)` **without** a `variantId` arg (`prestashop-inventory-master.adapter.ts:113`), so `inventory.variantId` is always `undefined` → every row lands NULL. `Inventory.variantId?` is optional, so an adapter that later supplies it should win.
- **DI already wired** — `ProductsModule` is imported by `inventory.module.ts:42` and (transitively) by the worker via `InventoryModule` (`sync-worker.module.ts:14`). Injecting `IProductsService` into `MasterInventorySyncService` needs **no module change**.
- **Variant resolution available** — `ProductVariantRepository.findByProductId(productId)` already exists on the port; expose it through `IProductsService.getVariantsByProductId`.
- **Read path unchanged** — `InventoryQueryService.getAvailabilityByVariantIds` → `findAvailabilityByVariantIds` (`inventory.repository.ts:103`) groups by `productVariantId`; once rows are variant-keyed it returns stock with zero new code.
- **Next free migration prefix:** `1799000000003` (latest on `main` is `1799000000002-add-offer-status-snapshots-table.ts`).

## 3. Design

### Variant resolution (write path)

In `MasterInventorySyncService.toDomainInventoryItem(inventory, productId)`:

```
resolvedVariantId =
  inventory.variantId                                  // adapter-supplied wins (future-proof)
  ?? (variants.length === 1 ? variants[0].id : null)   // single-variant ⇒ synthetic variant
  // else null  ⇒ product-level (multi/zero-variant, logged)
```

where `variants = await productsService.getVariantsByProductId(productId)` (skip the call when `inventory.variantId` is already set). Use `resolvedVariantId` both for the existing-row lookup (`inventoryService.getInventory(productId, resolvedVariantId, locationId)`) and for the persisted `InventoryItem`. Emit a `logger.debug` when resolution falls back to product-level (`master_inventory_product_level_fallback product=… variants=N`).

### Backfill migration (data only)

Convert existing product-level rows to variant-keyed for single-variant products, in place (no new rows → no orphan duplicates):

```sql
UPDATE inventory_items i
SET "productVariantId" = sub.variant_id
FROM (
  SELECT v."productId" AS product_id, MIN(v.id) AS variant_id
  FROM product_variants v
  GROUP BY v."productId"
  HAVING COUNT(*) = 1
) sub
WHERE i."productId" = sub.product_id
  AND i."productVariantId" IS NULL
  AND NOT EXISTS (                       -- defensive: never collide with an existing variant row
    SELECT 1 FROM inventory_items i2
    WHERE i2."productId" = i."productId"
      AND i2."productVariantId" = sub.variant_id
      AND i2."locationId" IS NOT DISTINCT FROM i."locationId"
  );
```

`down()` reverts the same single-variant rows back to `productVariantId = NULL`, scoped with the *same* predicate as `up()` (single-variant products, `productVariantId IS NOT NULL`). It carries an inline comment noting the inherent lossiness: a data-migration `down()` cannot distinguish rows this migration converted from rows that were already variant-keyed (none exist today, so it is exact now).

**Why the migration is required (not just convenient):** without it, a re-sync of a single-variant product would look up its existing row by the *resolved variant key*, miss the legacy NULL-variant row, and **insert a second, variant-keyed row** — leaving an orphan product-level duplicate (the two partial indexes both permit it). Converting rows in place makes the next sync find-and-update them. CI runs migrations before app start ("migrate then start", `docs/migrations.md`).

## 4. Step-by-step implementation

### Products context — expose variant lookup by product

1. `libs/core/src/products/application/services/products.service.interface.ts`
   - Add `getVariantsByProductId(productId: string): Promise<ProductVariant[]>` with a doc comment.

2. `libs/core/src/products/application/services/products.service.ts`
   - Implement → `this.variantRepository.findByProductId(productId)`.
   - **AC:** unit test in `products.service.spec.ts` — delegates and returns the repo result.

### Inventory context — variant-keyed write

3. `libs/core/src/inventory/application/services/master-inventory-sync.service.ts`
   - Inject `@Inject(PRODUCTS_SERVICE_TOKEN) productsService: IProductsService` (import from `@openlinker/core/products`, top-level barrel — same seam `InventoryQueryService` already uses).
   - In `toDomainInventoryItem`, compute `resolvedVariantId` per the design; use it for the existing-row lookup and the persisted entity; `logger.debug` on product-level fallback. The multi/zero-variant fallback branch carries a code comment referencing the multi-variant follow-up issue (see Non-goals).
   - Skip the `getVariantsByProductId` call entirely when `inventory.variantId` is already set (adapter-supplied), so the common adapter path adds at most one indexed query per product sync.
   - **AC:** `master-inventory-sync.service.spec.ts` (new) — (a) single-variant product ⇒ row keyed to that variant id; (b) multi-variant ⇒ `productVariantId = null` + fallback logged; (c) zero-variant ⇒ null; (d) adapter-supplied `inventory.variantId` ⇒ used verbatim (no products call); (e) `available` derivation unchanged.
   - **Note (not a regression):** the migration triggers **no** propagation — `InventoryService.set` skips when quantity is unchanged (`previous.availableQuantity === upserted.availableQuantity`), and the first post-migration sync finds the converted row with the same quantity. The propagation dedupe key (`buildPropagationDedupeKey`, includes `variantId`) simply becomes variant-scoped for *future* stock changes — strictly more precise, not a re-fire. Call this out in the PR description.

### Data migration

4. `apps/api/src/migrations/1799000000003-backfill-inventory-variant-id.ts`
   - Hand-authored data migration (no schema change) with the `up()` / `down()` SQL above. Class `BackfillInventoryVariantId1799000000003`.
   - **AC:** `pnpm --filter @openlinker/api migration:show` lists it; `migration:run` then `migration:revert` succeed locally; `pnpm lint` timestamp-invariant passes.

### Tests / regression

5. `apps/api/test/integration/inventory-availability.int-spec.ts`
   - Add a vertical-slice case: seed a product + single variant + a **variant-keyed** inventory row, assert `/inventory/availability` returns the stock for that variant (guards the end-to-end shape the bulk wizard depends on). Existing cases stay green.

6. Backfill-migration integration test (the harness runs migrations against an empty DB at boot, so the `UPDATE` never executes on seeded data otherwise). After harness boot, seed a product-level row (`productVariantId NULL`) + a single variant for that product **and** a multi-variant product with a product-level row, run the backfill SQL via the `DataSource`, then assert: single-variant row becomes variant-keyed; multi-variant row stays NULL; the `NOT EXISTS` collision guard skips a pre-existing variant row.
   - **AC:** both branches asserted against real Postgres; locks the load-bearing `HAVING COUNT(*) = 1` + collision-guard logic.

7. Pre-flip verification (implementation step, recorded in PR description): grep for *external* readers that treat null-variant rows as "the product's stock" — FE `/inventory` list (handles `string | null`) and any order-reservation path. Expected clean (the inventory module is already variant-agnostic); confirm before flipping the write key.

### Docs & follow-up

8. `docs/architecture-overview.md` — Inventory context: note master-inventory sync keys rows to the product's canonical (synthetic) variant; product-level rows remain only for multi-variant products pending per-combination support.
9. `docs/architecture/adrs/010-variant-keyed-master-inventory.md` — short ADR: decision (variant-keyed inventory), rejected alternative (read-side fallback, the original Option 1), trade-off (multi-variant deferred → #823 master / #824 destination, incl. the Allegro `/sale/offer-variants` deprecation finding), migration consequence. Add to `adrs/README.md` index.
10. **Reference the filed multi-variant follow-ups** — #823 (PrestaShop per-combination stock) and #824 (Allegro auto-grouped variant offers) — in ADR-010 and in the `master-inventory-sync.service.ts` fallback comment, so the deferred scope is discoverable from the code. (Issues already filed; no new issue to create.)

## 5. Validation

- **Architecture:** sync service depends on `IProductsService` (allowed cross-context seam — `inventory → products` is in the documented dependency map); domain/ports stay framework-free; ORM mapping stays in the repo; no new SQL join across contexts.
- **Naming:** `getVariantsByProductId` mirrors `getVariant` / `getProductsByIds`; migration class/file timestamp match (lint invariant).
- **Testing:** unit (products service, sync service) + integration (availability slice); coverage targets — core app services 80%+.
- **Security:** no new input surface; no secrets; endpoint unchanged.
- **Migrations:** data-only, reversible `up`/`down`, defensive against index collisions, next-free unique timestamp.

## Risks / open questions

- **Multi-variant products stay at 0** in the bulk wizard (product-level rows, read-by-variant misses). Honest (no over-report) and unchanged from today; durable fix is the adapter per-combination follow-up. Documented + ADR.
- **Migration is load-bearing** — skipping it risks orphan duplicate rows on re-sync (see §3). CI migrate-then-start covers prod; dev must `migration:run`.
- **Worker DI** — `MasterInventorySyncService` gains a constructor dep; the worker resolves it via `InventoryModule` (already imports `ProductsModule`). Per the #786 lesson, confirm the worker boots (the sync service is exercised by `MasterInventorySyncHandler`).
