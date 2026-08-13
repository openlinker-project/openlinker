# Pre-Implementation Gate: `implementation-plan-needs-attention-aggregates.md` (#1983)

**Date**: 2026-08-11
**Verdict**: **NEEDS-REVISION**

No breaking/critical contract issues were found (no schema change, no signature break, no barrel-export removal). The plan needs revision on **how three of its reads are consumed cross-context** — the codebase already has the exact seam this plan should route through, and building the plan's proposed shape instead would either duplicate an existing service or risk a cross-context repository-port import.

---

## Reuse Findings

| Plan artifact | Status | File / evidence |
|---|---|---|
| `CoverageGapReadService` (new) | **NEW** — confirmed absent | No `CoverageGap*` symbol anywhere in `libs/`/`apps/` |
| `StockAtRiskReadService` (new) | **NEW** — confirmed absent | No `StockAtRisk*` symbol anywhere |
| `NeedsAttentionService` / controller (new) | **NEW** — confirmed absent | `apps/api/src/analytics/http/` contains only `posthog-settings.*` |
| `OrderRecordRepositoryPort.getFailedSyncValueSummary` (new method) | **NEW**, but **wrong consumption path assumed** | See "Failed-sync value" finding below |
| "List/enumerate variant ids published on connection X" (Phase 1 step 2, Phase 2 step 2) | **PARTIAL — a related primitive exists, but not this exact shape** | See "Coverage-gap / stock-at-risk candidate pool" finding below |
| `IOfferMappingsService` / `IShopProductMappingsService` (the seam the plan should use) | **ALREADY EXISTS** | `libs/core/src/listings/application/services/offer-mappings.service.interface.ts`, `shop-product-mappings.service.interface.ts` — both are the documented #718 "cross-context read seam over `*RepositoryPort`" pattern |
| `IPublishedVariantsService.getPublishedVariantIds` | **ALREADY EXISTS**, directly reusable for a membership check | `libs/core/src/listings/application/services/published-variants.service.ts` |
| `readStockSafetyBuffer` / `applyStockSafetyBuffer` | **ALREADY EXISTS**, plan correctly reuses as-is | `libs/core/src/identifier-mapping/domain/types/stock-safety-buffer.types.ts` |
| `IInventoryQueryService.getAvailabilityByVariantIds` | **ALREADY EXISTS**, plan correctly reuses as-is | `libs/core/src/inventory/application/services/inventory-query.service.ts` |
| `OrderRecordRepository`'s `HAS_FAILED` / `NOT_MAPPING_OR_DELETED` / `TOTAL_EXPR` SQL fragments | **ALREADY EXISTS**, plan correctly reuses as-is | `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts` (private statics on `countByHealth`) |
| DI tokens (`COVERAGE_GAP_READ_SERVICE_TOKEN`, `STOCK_AT_RISK_READ_SERVICE_TOKEN`, etc.) | **NEW** — no collision | Checked `listings.tokens.ts`, `inventory.tokens.ts` in full; neither contains anything close |
| `IntegrationsService.listCapabilityAdapters<T>({ capability, lazy })` | **ALREADY EXISTS**, plan's assumed signature confirmed correct | `libs/core/src/integrations/application/interfaces/integrations.service.interface.ts:82` |

---

## Finding 1 — Coverage-gap / stock-at-risk candidate pool: route through the existing #718 seam, don't reinvent it (NEEDS-REVISION)

The plan's Phase 1 step 2 proposes adding `findRecentlyListedVariantIds(limit)` directly to `OfferMappingRepositoryPort` **and** `ShopProductMappingRepositoryPort`. The plan's Phase 2 step 2 correctly says the inventory-context `StockAtRiskReadService` must reach the listings context "via `@openlinker/core/listings`'s `I*Service` barrel export" — but no existing service method on that barrel today returns "all variant ids listed on connection X". The closest existing shapes are:

- `IPublishedVariantsService.getPublishedVariantIds(connectionId, variantIds)` — a **membership check** against an already-known variant-id set, not an enumeration. Directly reusable once you already have a candidate list, but it can't produce one.
- `IOfferMappingsService.countForVariants(connectionId, variantIds)` — same shape, count instead of boolean.
- `IOfferMappingsService.countListedVariantsByProducts` / `IShopProductMappingsService.countListedVariantsByProducts` — product-scoped, not connection-scoped enumeration.

None of these enumerate "every variant currently listed on connection X" — that read genuinely doesn't exist yet, so the plan is right that *something* new is needed. The revision is **where** it lives:

- **Don't** add the new method only to the raw `*RepositoryPort` interfaces and have `StockAtRiskReadService` (a different context) call them — `docs/architecture-overview.md § Cross-context dependencies in core` explicitly forbids `*RepositoryPort` as a cross-context import shape ("Cross-context callers go through I*Service").
- **Do** add the new enumeration method to `IOfferMappingsService` and `IShopProductMappingsService` (the existing #718 seam), each backed by a new repository-port method as today's pattern already does for every other method on those two services. `CoverageGapReadService` (which lives in `listings` itself) can call either the service or the repository port directly (both are intra-context and fine); `StockAtRiskReadService` (in `inventory`) **must** call the service, never the repository port.

This changes Phase 1 step 2 and Phase 2 step 2's file list: the new method is declared on `offer-mappings.service.interface.ts` / `shop-product-mappings.service.interface.ts` (implementation in the sibling `.service.ts`) in addition to the repository-port files, not instead of them.

## Finding 2 — Failed-sync value: the plan should explicitly pick a consumption path, matching (or deliberately deviating from) an existing precedent (NEEDS-REVISION)

`IOrderRecordService` does **not** expose `countByHealth` today, even though `OrderRecordRepositoryPort` and its repository implementation both have it. The existing consumer — `apps/api/src/orders/http/orders.controller.ts:190` — injects `OrderRecordRepositoryPort` **directly** (via its Symbol token) and calls `countByHealth` on it, bypassing `IOrderRecordService` entirely for this one aggregate read.

The plan's Phase 3 step 3 currently says "add one method implementing the new interface method" on `OrderRecordService` (i.e., add a pass-through on `IOrderRecordService`), which is a defensible layering choice but is **not** what the codebase already does for the sibling aggregate (`countByHealth`). The plan should state explicitly which it's doing:

- **Option A (match precedent)**: `NeedsAttentionService` (apps/api) injects `OrderRecordRepositoryPort` directly, exactly like `OrdersController` does. No `IOrderRecordService` change needed — only the repository port + repository implementation grow the new method. Less code, consistent with what's already shipped.
- **Option B (add the layering `countByHealth` itself skipped)**: add the pass-through on `IOrderRecordService` as the plan currently states, intentionally improving on the precedent rather than copying it.

Either is acceptable; the plan as written implies Option B without acknowledging Option A exists and is the path of least resistance already proven in this exact file. **Pick one explicitly in the plan.**

## Finding 3 — Verify the `apps/api` repository-port import against `check-cross-context-imports` (Warning, not blocking)

If the plan follows Option A above, `apps/api/src/analytics/application/services/needs-attention.service.ts` will import `OrderRecordRepositoryPort` from `@openlinker/core/orders`. This is the same shape `OrdersController` already does today, so it is very likely either (a) generically permitted for `apps/**` importers (the ban's stated rationale is protecting a *sibling core context*, and an app has no sibling context), or (b) already sitting in the script's `ALLOW_LIST` (`docs/architecture-overview.md` references a 64-entry apps/plugins allow-list tracked in #722). Either way this is **not a new pattern** — but run `pnpm lint` immediately after adding the import (before writing the rest of Phase 4) to confirm it passes, rather than discovering it at the end of implementation.

## Finding 4 — `docs/plans/implementation-plan-needs-attention-aggregates.md`'s own flagged open question (naming/module overlap) is real and unresolved

The plan's own § 8 already flags that `apps/api/src/analytics` + `libs/core/src/analytics` today mean "PostHog settings," not "the `/analytics` reporting page," and defers the decision to a maintainer. This gate can't resolve that either — it's a genuine open question, not a code-reuse or contract-break issue, so it doesn't block `READY` on its own, but it should be resolved (or explicitly reconfirmed as "reuse anyway") before Phase 4 touches `apps/api/src/analytics/analytics.module.ts`.

---

## Backward-Compatibility Checklist

| Surface | Check | Result |
|---|---|---|
| Top-level barrels | Any export removed/renamed? | None — every change is additive |
| Port method signatures | Any existing method's signature changed? | None — `OfferMappingRepositoryPort`, `ShopProductMappingRepositoryPort`, `OrderRecordRepositoryPort` all gain new methods only |
| DTO shapes | Any existing field removed/retyped? | N/A — the only DTO is new (`NeedsAttentionResponseDto`) |
| Symbol tokens | Any token removed/renamed? | None — all new tokens confirmed non-colliding (see Reuse Findings) |
| ORM schema | Migration needed? | No — every read is derived from existing tables/columns, confirmed via direct inspection of `order-record.orm-entity.ts`, `product-variant.entity.ts` (`isStale`), and `Connection.config` (JSONB, no schema) |
| `check:invariants` | Cross-context import risk? | Warning only — see Finding 3. `check-service-interfaces` is satisfied (every new `*.service.ts` implements an `I*Service` or a `*Port`, per the plan's own file list) |

---

## Open Questions (carried into implementation, not blocking)

- Finding 4's module-placement question (`apps/api/src/analytics` naming overlap) — plan already surfaces this; needs a decision before Phase 4 touches that module, not before Phase 4 starts.
- Whether `OfferMappingRepositoryPort`'s existing `findMany` (already ordered by `createdAt DESC`, already paginated) can serve as the "recently listed" ordering directly, deduplicated to distinct `internalId`s in the service layer, instead of a bespoke `DISTINCT`+`ORDER BY` repository method — a minor implementation-time efficiency question, not a design blocker either way.

---

## Verdict Rationale

No Critical items (no signature break, no schema change, no barrel removal) — so this does not reach `NEEDS-MAJOR-REVISION`. But Finding 1 and Finding 2 are genuine "the plan currently proposes something the codebase already has a documented seam for, in a different shape" issues that are cheaper to fix now, in the plan, than after the corresponding files exist. **NEEDS-REVISION**: update Phase 1 step 2 / Phase 2 step 2 to add the new enumeration method on `IOfferMappingsService` / `IShopProductMappingsService` rather than only on the raw repository ports, and make Phase 3 step 3 explicit about which of Option A / Option B it's choosing for the failed-sync-value read path.
