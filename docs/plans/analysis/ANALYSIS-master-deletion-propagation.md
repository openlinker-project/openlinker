# Pre-implement Gate — Master-deletion propagation (#1599)

**Plan:** `docs/plans/implementation-plan-master-deletion-propagation.md`
**Date:** 2026-07-15
**Verdict:** ✅ **READY** (no Critical findings; several in-PR mechanical Warnings)

---

## Reuse audit (does it already exist?)

| Plan artifact | Class | Evidence |
|---|---|---|
| `product_variants.isStale` / `staleAt` columns | **NEW** | No `isStale`/`staleAt` anywhere under `libs/core/src/products/` |
| `ProductVariantRepositoryPort.markStaleExceptVariants` | **NEW** | Port has `findById/findByProductId/…/upsert/upsertMany/findMany` only |
| `IProductsService.markVariantsStaleExcept` | **NEW** | Absent from interface |
| `MasterProductNotFoundError` | **NEW** | grep empty; no `products/domain/exceptions/` dir yet |
| `StaleOrderItemError` | **NEW** | grep empty |
| Event names `master.variant.stale` / `master.product.stale`, stream `events.master.deletion` | **NEW** | grep empty |
| `MasterProductSyncResult.masterDeleted` | **PARTIAL (extend)** | Current shape `{ internalProductId, variantsUpserted }` — add field |
| Stale-column pattern / `markStaleExceptVariants` query / `pruneStaleVariants` / event-publish shape | **REUSE** | `inventory-item.orm-entity.ts`, `inventory.repository.ts:133`, `master-inventory-sync.service.ts:78`, `sync-job-bulk-retry.service.ts:54`, migration `…007-add-inventory-item-is-stale.ts` |

No reuse collisions — every proposed new artifact is confirmed absent.

## Backward-compatibility checklist

| Surface | Finding | Severity | Migration path |
|---|---|---|---|
| `product_variants` ORM schema | 2 new columns | **Warning (expected)** | Migration `1818000000008-add-product-variant-is-stale.ts` (next sequential prefix; latest is `…007`) |
| `IProductsService` (barrel-exported) | **Add** `markVariantsStaleExcept` (additive method) | **Warning** | Purely additive to the contract. Breaks 1 typed mock literal: `products.controller.spec.ts:46 createMockProductsService()` (`jest.Mocked<IProductsService>` requires all keys) → add `markVariantsStaleExcept: jest.fn()`. The worker handler mock (`marketplace-offer-create.handler.spec.ts:71`) uses `as unknown as` cast → unaffected. |
| `ProductVariantRepositoryPort` (barrel-exported) | **Add** `markStaleExceptVariants` | **Warning** | Additive. Update 2 typed mock literals: `products.service.spec.ts:57`, `listings.controller.spec.ts:65`. |
| `IInventoryService.pruneStaleVariants` (barrel-exported) | **Change return** `Promise<number>` → `Promise<{ markedCount; variantIds }>` | **Warning** | Only in-context production caller is `master-inventory-sync.service.ts:78`. Update return type + these tests: `master-inventory-sync.service.spec.ts:70` (`mockResolvedValue(0)`), `inventory.service.spec.ts:182`, `inventory-stale-prune.int-spec.ts` (assert on `.markedCount`). No external method consumers. |
| `ProductMasterPort.getProduct` thrown type | Adapters translate platform 404 → neutral `MasterProductNotFoundError` (signature unchanged) | **None** | The 4 `productMaster.getProduct(...)` callers are all **core** services (`master-product-sync`, `product-publish-builder`, `offer-builder`, `content-suggestion`) — none can `instanceof` a platform exception (cross-boundary ban), so none break; `master-product-sync` gains an explicit catch. Net improvement. Verify no adapter-internal caller of product-master `getProduct` catches the platform type (low risk — the existing PS catchers are in the order-processor adapter, a different file). |
| `MasterProductSyncResult` (barrel-exported) | Add required `masterDeleted` | **Warning-low** | Return type; sole consumer is the worker handler (updated in-PR). All producer paths set it. |
| Top-level barrels | New exports added (`MasterProductNotFoundError`, event constants/types); none removed/renamed | **None** | Additive |
| Symbol tokens | None changed | **None** | |
| `check:invariants` (cross-context) | `inventory → products` (import event constants) already an allowed edge; `products → events` and `inventory → events` land on the allowed infrastructure spine; all via top-level barrels; event constants are `UPPER_SNAKE_CASE as const` (allowed cross-context shape) | **None** | Should pass |

## Open questions / notes for implementation

1. **`markStaleExceptVariants` RETURNING** — use `.returning('id')` (products) / `.returning('productVariantId')` (inventory) to return the marked ids for event payloads. Confirm the driver returns `raw` rows; map to `string[]` (filter nulls on the inventory side).
2. **Migration authoring** — hand-author `1818000000008-…` with the synthetic sequential prefix (per `docs/migrations.md` #1013) rather than relying on a generated timestamp prefix; verify `migration:show` is clean.
3. **Test-mock fan-out** — the three typed `jest.Mocked<…>` literals above (2 for the added port/service methods, plus the inventory return-type ripple) must be updated in the same PR or `type-check`/`pnpm test` fails. This is expected mechanical churn, not a design problem.
4. **`domain/exceptions/` dir** is created fresh in the products context (none exists today).

**Bottom line:** the plan reinvents nothing and breaks no published contract. All Warnings are additive-method mock updates, one low-blast-radius return-type widening, and the expected migration — all contained within this PR. Proceed.
