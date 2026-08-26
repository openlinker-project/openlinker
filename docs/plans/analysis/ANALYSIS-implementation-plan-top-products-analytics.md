# Pre-Implement Gate: Top Products Analytics (#1988)

**Gated against**: `docs/plans/implementation-plan-top-products-analytics.md`
**Repo state**: HEAD `0d1c3b2e5` on branch `1988-top-products-analytics`, forked from
`origin/1987-sales-channel-aggregates` (PR #2151, DRAFT)
**Date**: 2026-08-18

---

## Verdict: **READY**

Every artifact the plan assumes exists (or assumes is absent) was verified directly against the live
repository at this exact commit — not against research snapshots. No critical contract breaks, no
reuse collisions requiring plan revision. One DI wiring detail not spelled out in the plan is resolved
below (needed for Phase 3, not a plan defect).

---

## Reuse Findings

| Plan artifact | Status | File |
|---|---|---|
| `OrderLineItemRepositoryPort` (extend with 2 methods) | **EXISTS → extend** | `libs/core/src/orders/domain/ports/order-line-item-repository.port.ts` — already carries `findByOrderId` + `getUnitsSoldByConnection`, and its own doc comment explicitly names itself the #1988 extension point |
| `OrderLineItemRepository` impl | **EXISTS → extend** | `libs/core/src/orders/infrastructure/persistence/repositories/order-line-item.repository.ts` |
| `OrderLineItemOrmEntity` (`productId`, `variantId`, `quantity`, `unitPrice`, `sourceConnectionId`, `placedAt`) | **EXISTS, no migration needed** | `libs/core/src/orders/infrastructure/persistence/entities/order-line-item.orm-entity.ts` — every column the plan needs is already there |
| `OrderRecordOrmEntity.reportingCurrency`/`reportingTotalAmount`/`totalAmount` | **EXISTS** | confirmed via `getDailyOrderAggregates`'s live SQL, `order-record.repository.ts:376-470` |
| `SalesAnalyticsFilters`, `applySalesAnalyticsScope` pattern | **EXISTS → reuse shape, don't duplicate string** | `libs/core/src/orders/domain/types/order-sales-analytics.types.ts`, `order-record.repository.ts:470` |
| `IOrderRecordService.getTopProducts` (new method) | **NEW (confirmed absent)** | `libs/core/src/orders/application/interfaces/order-record.service.interface.ts` — only `getSalesAndChannelAnalytics` exists today |
| `top-products.types.ts`, `top-products-aggregation.ts` | **NEW (confirmed absent)** | no `*top-product*` file exists anywhere in the tree except the plan doc itself |
| `IProductsService.getProductsByIds` | **EXISTS → reuse as-is** | `libs/core/src/products/application/services/products.service.interface.ts:57` — signature and "missing ids silently dropped" contract match the plan's assumption exactly |
| `IProductsService.getVariantsByProductId` | **EXISTS → reuse as-is** | same file, line 72 — needed for the coverage-flag's variant-id resolution (Phase 3) |
| `IPublishedVariantsService.getPublishedVariantIds` | **EXISTS → reuse as-is** | `libs/core/src/listings/application/services/published-variants.service.interface.ts` — signature matches plan exactly (`connectionId`, `variantIds` → `string[]`) |
| `IIntegrationsService.listCapabilityAdapters` | **EXISTS → reuse as-is** | confirmed live call shape in `coverage-gap-read.service.ts:120-131` (`{ capability, lazy: true }`) — the plan's Phase 3 Step 1.3 should copy this exact call shape, including the `OfferManager` ∪ `ProductPublisher` union pattern |
| `TopProductsController`, `TopProductsQueryDto`, `TopProductsResponseDto`, `TopProductsService` | **NEW (confirmed absent)** | no `apps/api/src/analytics/**top-product*` file exists |
| `SalesAnalyticsController`/`SalesAnalyticsQueryDto`/`SalesAnalyticsResponseDto` (template to mirror) | **EXISTS, verified 1:1 against plan's excerpts** | `apps/api/src/analytics/http/sales-analytics.controller.ts` + its two DTO files — every field and validator the plan describes matches the live file byte-for-byte |
| `NeedsAttentionService` `settleSection`/`Promise.allSettled`-shaped degrade pattern (template) | **EXISTS, verified** | `apps/api/src/analytics/application/services/needs-attention.service.ts:56-88` |
| `AnalyticsApiModule` | **EXISTS → extend** | `apps/api/src/analytics/analytics.module.ts` — already imports `ListingsModule` (core, `/services` sub-barrel); does **not** yet import `ProductsModule` or the apps/api `IntegrationsModule` (see Backward-Compat/Open Questions below) |
| `getFailedSyncValueSummary` (#1983, out of scope per plan) | **EXISTS, confirmed out of #1988's call graph** | `order-record.service.interface.ts:169` — plan correctly treats this as a separate, unrelated follow-up |

No plan artifact turned out to already exist under a different name (no reinvention risk), and no
existing method needed for the plan was found missing.

---

## Backward-Compatibility Findings

Nothing this plan touches is an existing published contract — every change is additive (new port
methods, new service method, new controller/DTOs, new module providers/imports). No Critical findings.

| Surface | Check | Result |
|---|---|---|
| Top-level barrels | Does the plan remove/rename an exported symbol? | No — purely additive exports on `@openlinker/core/orders` (`getTopProducts` types) |
| Port method signatures | Any existing `OrderLineItemRepositoryPort` method changed? | No — plan only *adds* `getTopProductRanking`/`getProductChannelBreakdown` |
| DTO shapes | Any existing DTO field removed/retyped? | No — `SalesAnalyticsQueryDto`/`SalesAnalyticsResponseDto` untouched; new DTOs only |
| Symbol tokens | Any token removed/renamed? | No new token needed at all — the plan correctly reuses `ORDER_RECORD_SERVICE_TOKEN`, `PRODUCTS_SERVICE_TOKEN`, `PUBLISHED_VARIANTS_SERVICE_TOKEN`, and (per the DI note below) `INTEGRATIONS_SERVICE_TOKEN` transitively |
| ORM schema | New column/table? | None — confirmed `order_line_items` already carries every needed column. **No migration required.** |
| `check:invariants` | Cross-context import risk? | **Confirmed safe.** `apps/api` will inject `IProductsService`/`IPublishedVariantsService`/`IIntegrationsService` — all `I*Service` tokens, the exact shape `scripts/check-cross-context-imports.mjs` allows for `apps/**` importers. No repository port crosses the apps/api boundary. |

### DI wiring gap (Warning, not Critical — a plan-execution detail, not a plan defect)

The plan's Phase 3 Step 2 says `AnalyticsApiModule` needs `ProductsModule` and `ListingsModule` imported
"alongside the module's existing imports." Verified precisely:

- **`ListingsModule` (core, `/services` sub-barrel) is already imported** by `AnalyticsApiModule` and
  **does export** `PUBLISHED_VARIANTS_SERVICE_TOKEN` (`listings.module.ts:454`) — so `IPublishedVariantsService`
  is already resolvable with zero new module wiring.
- **`ProductsModule` is NOT yet imported** by `AnalyticsApiModule` — must be added
  (`import { ProductsModule } from '@openlinker/core/products';`, top-level barrel, matches
  `ListingsModule`'s own import of it).
- **`INTEGRATIONS_SERVICE_TOKEN` is NOT reachable through `ListingsModule`'s exports** — `ListingsModule`
  imports the core `IntegrationsModule` for its *own* internal providers (`CoverageGapReadService`) but does
  not re-export `INTEGRATIONS_SERVICE_TOKEN` in its `exports: [...]` array. `AnalyticsApiModule` must import
  the **apps/api-layer** `IntegrationsModule` (`apps/api/src/integrations/integrations.module.ts`), which
  re-exports the core `IntegrationsModule` itself (`exports: [PluginRegistryModule, CoreIntegrationsModule,
  CONNECTION_SERVICE_TOKEN]`), which in turn exports `INTEGRATIONS_SERVICE_TOKEN`. This is exactly how
  `AppModule` already gets it — importing the apps/api `IntegrationsModule` (not the core one directly) is
  the established pattern in this codebase for HTTP-layer modules.

**Action for implementation**: `AnalyticsApiModule`'s `imports: [...]` gains `ProductsModule` (core) and
`IntegrationsModule` (apps/api's own, aliased e.g. `ApiIntegrationsModule` to avoid a name clash with the
core one already imported under its own name inside `AnalyticsModule as CoreAnalyticsModule`'s pattern —
follow that existing aliasing convention).

---

## Open Questions

- None blocking. The plan's own § 5 Open Questions (coverage-flag connection scope, revenue-sort
  currency-exclusion policy) remain product-level judgment calls, not implementation blockers — both
  already have a stated, defensible default in the plan.

---

## Summary

The plan is **READY** to implement as written, with one clarified DI wiring detail (import the apps/api
`IntegrationsModule`, not just `ListingsModule`, to reach `INTEGRATIONS_SERVICE_TOKEN` in
`AnalyticsApiModule`) folded into Phase 3 Step 2. Every port, service, ORM column, and controller/DTO
pattern the plan cites was verified byte-for-byte against the live repository at this exact commit — no
reinvention risk, no contract breaks, no migration required.
