# Pre-implement Gate: MCP Phase 1 — Read-only domain tools

**Plan**: `docs/plans/implementation-plan-mcp-read-only-domain-tools.md`
**Issue**: #1487
**Date**: 2026-07-29
**Verdict**: ✅ **READY**

> Gated against the plan as revised following the deep `/tech-review`. The
> pre-revision draft would have gated `NEEDS-MAJOR-REVISION` — see §3.

---

## 1. Reuse audit

Every artifact the plan proposes to create, checked against the live tree.

| Plan artifact | Classification | Evidence |
|---|---|---|
| `ToolRegistryService` + `IToolRegistryService` | **NEW** | No `*ToolRegistry*` anywhere under `apps/` or `libs/` |
| `McpToolDefinition` types | **NEW** | — |
| 4 read tools + `list_connections` (`*.tool.ts`) | **NEW** | No `*.tool.ts` files exist; suffix is unregistered (plan step 8 registers it) |
| `redactPrincipal` + audit logger | **NEW** | Phase 0 shipped `McpAuthInfoExtra` / `isMcpAuthInfoExtra` (`apps/api/src/mcp/auth/mcp-principal.types.ts`) to build on — **PARTIAL: reuse those, don't redefine** |
| Redis rate limiter | **NEW** | No `@nestjs/throttler`; `CachePort` is KV-only. Precedent for reaching past `CachePort` to raw `'REDIS_CLIENT'`: `RedisPickupPointQueryStatsAdapter` |
| Product read | **ALREADY EXISTS → reuse** | `IProductsService.listProducts` / `.getProduct` / `.getVariantsByProductId` (`PRODUCTS_SERVICE_TOKEN`) |
| Availability read | **ALREADY EXISTS → reuse** | `IInventoryQueryService.getAvailabilityByVariantIds` (`INVENTORY_QUERY_SERVICE_TOKEN`) |
| Order read | **ALREADY EXISTS → reuse** | `IOrderRecordService.getOrderRecord` / `.findMany` (`ORDER_RECORD_SERVICE_TOKEN`) |
| Connection list | **ALREADY EXISTS → reuse** | `IConnectionService.list(filters?)` (`CONNECTION_SERVICE_TOKEN`, `apps/api/src/integrations/application/interfaces/connection.service.interface.ts:23`) |
| Capability gating | **ALREADY EXISTS → reuse** | `IIntegrationsService.listCapabilityAdapters({ capability, lazy })`; precedent `ConnectionInfraHealthService` |
| Search filter | **ALREADY EXISTS → reuse** | `ProductListFilters.search` (case-insensitive name/SKU) + `.sourceConnectionId` — exact fit for `search_catalog` |

**No reuse collisions.** The four net-new artifacts are genuinely absent — `find -name "*.tool.ts"` and `grep -r ToolRegistry` both return **zero** hits across `apps/` and `libs/`. Every domain read the plan needs already has a published `I*Service` + Symbol token.

### 1.1 Consumability of the four reused surfaces (verified end-to-end)

The plan is only viable if each reused service is reachable *from `apps/api`* through the sanctioned barrel + module path. Checked all three hops for each:

| Surface | Token on barrel | Interface on barrel | Token in module `exports:` |
|---|---|---|---|
| `IProductsService` | ✅ `products/index.ts:14` (`export * from './products.tokens'`) | ✅ `products/index.ts:45` | ✅ `products.module.ts:77` |
| `IInventoryQueryService` | ✅ `inventory/index.ts:14` | ✅ `inventory/index.ts:30` | ✅ `inventory.module.ts:83` |
| `IOrderRecordService` | ✅ `orders/index.ts:144` | ✅ `orders/index.ts:131` | ✅ `orders.module.ts:98` |
| `IConnectionService` | n/a (host app, not a core barrel) | ✅ `connection.service.interface.ts:23` | ✅ `apps/api/.../integrations.module.ts:75` |

All three core contexts follow the `export * from './<ctx>.tokens'` convention (`engineering-standards.md § Symbol DI Token Re-export`), so the tokens are on the top-level barrel with no deep-path import required.

`CoreCapabilityValues` (`libs/core/src/integrations/domain/types/adapter.types.ts:22`) contains `ProductMaster`, `InventoryMaster`, and `OrderSource` — all three registration gates the plan uses are well-known capabilities, not open-world strings.

## 2. Backward-compatibility checklist

| Surface | Finding | Severity |
|---|---|---|
| Top-level barrels | No symbol removed/renamed. Plan only *consumes* existing barrel exports | None |
| Port method signatures | **No port is modified or implemented.** Phase 1 introduces no port and calls no adapter on the read path | None |
| DTO shapes | No existing DTO touched; tool input schemas are net-new | None |
| Symbol tokens | None removed/renamed; four existing tokens consumed | None |
| ORM schema | **No entity change ⇒ no migration.** Confirms plan §1 | None |
| `check-cross-context-imports` | All four cross-context imports are `I*Service` + `*_TOKEN` — explicitly on the allow list per `architecture-overview.md § Cross-context dependencies in core`. No `*RepositoryPort`, no `*OrmEntity`, no `*Adapter` | None |
| `check-service-interfaces` | Scans `libs/core/src/<ctx>/application/services/` **only** (script line 34) — new services live in `apps/api`, so unenforced. Plan §8 already discloses this and follows the convention anyway | None |
| Migration timestamps | N/A (no migration) | None |

**No Critical items. No Warnings.**

## 3. What the deep review changed

Recorded because it is the substantive finding of this gate:

The pre-revision plan sourced all four reads through capability **ports**
(`ProductMasterPort.searchProducts`, `InventoryMasterPort.getAvailableQuantity`,
`OrderSourcePort.getOrder`). That would have been a live platform round-trip per
tool call, and — decisively — it **structurally defeats `OL_STORE_PII`**:
`IOrderRecordService.persistOrder` nulls buyer PII at ingestion when the operator
disables PII storage, whereas `OrderSourcePort.getOrder` re-fetches it raw
regardless. One of the three PII options the plan offered for decision was
therefore not implementable at all.

Revised §3.3 keeps capability-declared *registration* (which is what makes
`tools/list` dynamic per ADR-033) and moves the *data* to OL's own store, with
`connectionId` narrowing rather than selecting an adapter. Both decisions the
plan had escalated dissolved rather than needing an answer.

## 4. Open questions

**None blocking.** Two notes carried into implementation:

1. Both `apps/api/.../integrations.module.ts` and
   `libs/core/.../integrations.module.ts` export a class named
   `IntegrationsModule`. The host one re-exports `CoreIntegrationsModule`, so a
   single aliased import suffices — but an unaliased import is a live shadowing
   footgun. Plan §3.7 now calls this out.
2. ~~`get_availability` is variant-keyed…~~ **RESOLVED** by the second
   `/tech-review` pass. `IInventoryQueryService.getProductStockAggregates(productIds)`
   (`inventory-query.service.interface.ts:56` → `ProductStockAggregate`
   `{ productId, totalAvailable, totalReserved, stockUpdatedAt }`) is the
   product-level read, with `getAvailabilityByVariantIds` →
   `VariantAvailability { productVariantId, totalAvailable, locationCount }`
   for the variant case. No fan-out needed. Both are **global** reads with no
   connection axis — hence §3.3.2.
3. **`OrdersModule` exports the concrete `OrderRecordService` class** alongside
   its token (`orders.module.ts:94`, commented "Export service class for direct
   injection"). That is a live temptation to inject the class. Inject
   `ORDER_RECORD_SERVICE_TOKEN` instead — `engineering-standards.md § Ports vs.
   Concrete Implementations`. Worth an explicit line in the step-4 acceptance
   criteria since the wrong path compiles cleanly.
