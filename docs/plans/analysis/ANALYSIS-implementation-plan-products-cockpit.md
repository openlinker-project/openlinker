# Pre-implement Analysis: implementation-plan-products-cockpit (#1720)

Gated: 2026-07-17. Plan: `docs/plans/implementation-plan-products-cockpit.md`.

## Verdict: NEEDS-REVISION (one Critical - resolved by moving composition to the API layer; plan updated in the same session)

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `IInventoryQueryService.getProductStockAggregates` | NEW | interface has only `listInventoryItems`, `getInventoryItem`, `getAvailabilityByVariantIds` (`inventory-query.service.interface.ts:19-51`); no product-level aggregate exists |
| `IOfferMappingsService.countListedVariantsByProducts` | NEW | interface has only `findForVariant`, `countForVariants` (variant-level, per-connection) (`offer-mappings.service.interface.ts:15-36`) |
| Variant counts by product ids | NEW | no count method on `ProductRepositoryPort` / `ProductVariantRepositoryPort`; closest is `findByProductId` (single product) |
| Sort types in products context | NEW | `ProductListFilters = { search? }`, no sort anywhere in `product.types.ts` |
| `ProductStockAggregate`, `ListingsCoveragePills`, `ProductRowDetail`, `.products-segments`, `.cov--*` | NEW | zero grep hits repo-wide |
| Expandable rows / manualSorting / cardView | EXISTS - reuse | `shared/ui/data-table.tsx` (#1620/#944); orders-list-page is the shipped template |
| KPI-as-filter tiles | EXISTS - reuse pattern | `.orders-segment` buttons wrapping `MetricCard` (orders-list-page:804-828) |
| Per-variant drawer content | EXISTS - reuse | `pages/products/variant-stock-table.tsx` (stock + listings subtable) |
| Stock status derivation | PARTIAL - extend | `product-stock-status.ts` lacks `oversold`; additive extension |
| KPI counts endpoint | EXISTS - pattern | no `/stats` endpoints; `limit=1` probe pattern (`use-nav-counts.ts`) |
| `OfferCreator` connection filter | EXISTS - reuse verbatim | products-list-page:86-96 |

## Backward-compatibility findings

**Critical - NestJS module cycle (plan §3.1 wiring).** `InventoryModule` already imports `ProductsModule` (`inventory.module.ts:43`) and `ListingsModule` imports both `ProductsModule` and `InventoryModule` (`listings.module.ts:119-143`). No core module uses `forwardRef` today. The plan's "core `ProductsModule` imports inventory + listings" creates `products <-> inventory` and `products <-> listings` module cycles.
**Migration path (adopted):** keep core `ProductsService`/`ProductsModule` dependency-free of siblings. The page SQL (sort/filter/stock subqueries, variant counts) stays inside the products context (own repo). The cross-context display enrichment (`getProductStockAggregates`, `countListedVariantsByProducts`) is composed at the **interface layer**: `apps/api/src/products/products.module.ts` (ProductsApiModule) additionally imports `CoreInventoryModule` + the listings services module, and `ProductsController` injects the two `I*Service` tokens - mirroring how it already injects `IdentifierMappingPort` for the detail path. No forwardRef, no core module-graph change.

Warnings / non-breaking notes:
- `ListProductsQueryDto` / `ProductResponseDto` / `ProductListFilters` / FE `ProductFilters` changes are all **additive optional** - no break.
- Removing `getInventoryItem` from `IInventoryQueryService` (published barrel interface): verified single caller (`inventory.controller.ts:113`); `InventoryRepository.findById` becomes orphaned after removal (only caller is `getInventoryItem`, `inventory-query.service.ts:59`) - remove port method + impl together.
- Table-name-string subqueries: DB columns are **camelCase** (no naming strategy in `data-source.ts`; tables snake_case, columns camelCase, e.g. `inventory_items."availableQuantity"`, `identifier_mappings."internalId"`) - quote identifiers in raw fragments.
- `check:invariants`: new interface methods ride existing `I*Service` files (service-interface check unaffected); cross-context imports stay in allowed shapes (interfaces + tokens from top-level barrels, listings runtime via `@openlinker/core/listings/services` in the API module only).
- `route-lazy.test.ts` `EXPECTED_LAZY_ROUTE_COUNT` 50 -> 49 is an intentional, test-enforced change.

## Open questions (non-blocking)

- EAN in search placeholder: BE search covers name/SKU only - plan already keeps placeholder truthful and defers EAN search.
- Integration spec for the new SQL: add only if an existing products repo int-spec harness exists (resource-constrained policy); otherwise unit-level wiring tests + CI.
