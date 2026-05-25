# Implementation Plan — #823 Per-combination master stock for multi-variant products

## 1. Understand the task

**Goal:** Make PrestaShop master inventory **per-combination**. After #822, simple products are variant-keyed but multi-variant (combination) products stay product-level (`productVariantId = NULL`) and read as 0 by variant in the bulk wizard. #823 makes the adapter enumerate per-combination stock and emit one `Inventory` per `ProductVariant`, so the master sync writes one variant-keyed `inventory_items` row per combination.

**Layer classification:** Integration (PrestaShop adapter) + CORE (capability-port shape + sync orchestration) + one data-cleanup migration. **No new identity** — the combination↔variant mapping already exists (product sync maps each combination to `entityType='ProductVariant'`, externalId = combination id; simple products to a synthetic `product:<id>` variant).

**Non-goals:**
- The Allegro destination half (#824) — listing per-variant offers is separate.
- Live simple→multi-variant transition reconciliation (a product that was simple, got a #822 synthetic-variant inventory row, then gains combinations) — the stale synthetic row is an edge case left to a future inventory-reconciliation pass; documented below.
- Multi-location inventory (PrestaShop `stock_available` has no location; unchanged).

## 2. Research findings

- **Single port implementer** — only `PrestashopInventoryMasterAdapter implements InventoryMasterPort`. Adding a method touches the interface + that one adapter.
- **`getInventory` callers** — only `MasterInventorySyncService` (external) + `getAvailableQuantity` (internal). `getAvailableQuantity` has no external callers.
- **`MasterInventorySyncResult` is discarded** by `MasterInventorySyncHandler` (`await … ; return { outcome: 'ok' }`) — shape can evolve.
- **Combination → variant identity already exists** (`prestashop-product-master.adapter.ts` `getProductVariants`): `getOrCreateInternalId('ProductVariant', String(combination.id), connectionId, {parent…})`; simple products → `getOrCreateInternalId('ProductVariant', 'product:<psId>', …)`. So the inventory adapter resolves a combination/synthetic external id to the same internal variant id via `getOrCreateInternalId` (idempotent; self-reconciles if inventory sync precedes product sync).
- **`PrestashopStockAvailable`** = `{ id, id_product, id_product_attribute, quantity, … }`. `id_product_attribute = 0` is the product-level aggregate; `> 0` is a combination. Listing `stock_availables?id_product=<psId>` returns the aggregate row + one row per combination.
- **`mapInventory(stockAvailable, productId, variantId?)`** already accepts `variantId` (currently unused by the adapter) — the per-combination path just passes it.
- **Sync (post-#822)** `toDomainInventoryItem` → `resolveVariantId` already prefers `inventory.variantId` when set; once the adapter sets it per combination, the `getVariantsByProductId` fallback is bypassed (no conflict with #822).
- **Next free migration prefix:** `1799000000004` (latest on `main` is `1799000000003-backfill-inventory-variant-id`).

## 3. Design

### Port shape (the decision the issue flags) — add `listInventory`

Add to `InventoryMasterPort`:

```ts
/**
 * All inventory for a product, one entry per variant. A simple product yields
 * one entry (its synthetic variant); a combination product yields one per
 * combination, each with `variantId` set. Marketplace-agnostic: a future
 * inventory master expresses per-variant stock the same way.
 */
listInventory(productId: string): Promise<Inventory[]>;
```

Rationale vs the alternative (sync resolves variants → N per-variant `getInventory` calls): `listInventory` is **one round-trip** (the adapter fetches all `stock_availables` for the product in a single call), keeps the variant-resolution inside the adapter (where the PrestaShop combination knowledge lives), and is the cleaner marketplace-agnostic abstraction. `getInventory` / `getAvailableQuantity` are **retained** (single-value convenience, no external sync caller anymore) to keep the change additive.

### Adapter — `PrestashopInventoryMasterAdapter.listInventory`

1. Resolve `productId` → PrestaShop product id (`getExternalIds('Product', productId)`, connection match; strip legacy `product:` prefix defensively).
2. `listResources('stock_availables', { custom: { id_product: psProductId } })` — all rows. Empty → `PrestashopResourceNotFoundException`.
3. `combinationRows = rows.filter(r => Number(r.id_product_attribute) !== 0)`.
   - **Combinations present** → for each combination row: resolve `getOrCreateInternalId('ProductVariant', String(id_product_attribute), connectionId, {parent…})`, `mapInventory(row, productId, variantId)`, attach an `Inventory` internal id. Emit one `Inventory` per combination. The `id_product_attribute = 0` aggregate is **ignored** (per-combination rows carry the real stock).
   - **No combinations** (simple product, only the `=0` row) → resolve the synthetic variant `getOrCreateInternalId('ProductVariant', 'product:<psId>', …)`, emit one variant-keyed `Inventory`.

### Sync — `MasterInventorySyncService.syncFromMasterByExternalId`

- Replace the single `getInventory` call with `listInventory(internalProductId)`; loop `toDomainInventoryItem` + `setInventory` per entry (each already resolves/uses `inventory.variantId`).
- Return an evolved result:
  ```ts
  interface MasterInventorySyncResult {
    internalProductId: string;
    itemsWritten: number;          // one per variant/combination
    availableQuantity: number;     // summed across written rows
    reservedQuantity: number;      // summed across written rows
  }
  ```

### Orphan cleanup (AC3) — data migration `1799000000004`

Multi-variant products still carry a pre-#823 product-level (`productVariantId = NULL`) row (#822 skipped them). Delete those — they're invisible to the variant-keyed read (already read 0) and superseded by per-combination rows on the next sync, so deletion is a no-regression cleanup:

```sql
DELETE FROM "inventory_items"
WHERE "productVariantId" IS NULL
  AND "productId" IN (
    SELECT "productId" FROM "product_variants" GROUP BY "productId" HAVING COUNT(*) > 1
  );
```

`down()` is a documented no-op (deleted aggregate rows are re-derived by the next sync; the original per-product quantity isn't recoverable and isn't needed). Going forward the adapter never emits a NULL-variant row for multi-variant products, so no new orphans are created.

## 4. Step-by-step implementation

1. `libs/core/src/inventory/domain/ports/inventory-master.port.ts` — add `listInventory(productId): Promise<Inventory[]>` with doc comment.
2. `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-inventory-master.adapter.ts` — implement `listInventory` per §3; factor variant-id resolution into a private helper. **AC:** adapter spec covers simple (1 synthetic), multi (N per combination, correct qty), aggregate-ignored-when-combinations-present, not-found.
3. `libs/core/src/inventory/application/services/master-inventory-sync.service.interface.ts` — evolve `MasterInventorySyncResult` (`itemsWritten` + summed totals).
4. `libs/core/src/inventory/application/services/master-inventory-sync.service.ts` — loop over `listInventory`; aggregate the result. **AC:** spec updated to mock `listInventory`; asserts N writes + summed result + per-entry variant keying; existing single-variant case still green (itemsWritten=1).
5. `apps/api/src/migrations/1799000000004-cleanup-multivariant-product-level-inventory.ts` — the cleanup `DELETE` + no-op `down()` with rationale. **AC:** `migration:show` lists it; lint timestamp invariant passes.
6. **Tests:**
   - `prestashop-inventory-master.adapter.spec.ts` — `listInventory` cases above (mock the webservice client + identifier mapping).
   - `master-inventory-sync.service.spec.ts` — rewrite the adapter mock to `listInventory`; N-row write + aggregate result.
   - `apps/api/test/integration/` — a new int-spec: seed a multi-variant product + a stale product-level NULL row, run the cleanup migration `up()`, assert the NULL row is deleted and single-variant rows are untouched. (Sync-writes-N-rows is covered at unit level via the adapter mock; a full PS-container slice is out of scope per testing-guide's "mock the port unless PS is the source of truth.")
7. **Docs:** update `docs/architecture-overview.md` Inventory section (master inventory is per-variant incl. multi-variant via `listInventory`); note #824 remains for the Allegro destination half. Consider whether ADR-010 needs a follow-up note (likely a one-line amendment rather than a new ADR — this realizes ADR-010's deferred half, no new decision).

## 5. Validation

- **Architecture:** port lives in domain (framework-free); adapter in the plugin; sync depends on the port; identity via `IdentifierMappingPort` (existing seam). No cross-context violations.
- **Naming:** `listInventory` (port), `1799000000004-cleanup-…` migration class/file match.
- **Testing:** adapter + sync unit + migration int-spec; coverage targets (adapter 70%+, app service 80%+).
- **Security:** read-only adapter; migration SQL static (no interpolation); no secrets.
- **Idempotency/safety:** `getOrCreateInternalId` idempotent; `setInventory` upserts by `(product, variant, location)`; migration `DELETE` idempotent (re-run finds nothing).

## Risks / open questions

- **`stock_availables?id_product=<id>` returns the aggregate + per-combination rows** — confident from the existing adapter's usage + PS webservice behavior, but worth a sanity check against the PS testcontainer or a manual probe before merge (memory: verify external API shapes).
- **Simple→multi transition orphan** — a product that gained combinations after a #822 synthetic-variant inventory row leaves that row stale. Out of scope (broader inventory-reconciliation-on-variant-change concern); note in ADR/issue if it bites.
- **Result-shape change** — safe today (handler discards it); flagged in the PR description since it's a public service-interface change.
