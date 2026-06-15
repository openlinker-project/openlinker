# Pre-implement gate — Shop publish execution + neutral param channel (#1042 + #1072)

**Plan:** `docs/plans/implementation-plan-shop-publish-execution.md`
**Date:** 2026-06-15 · **Gate:** read-only readiness (no code, no plan edits)

## Verdict: ✅ READY

No reuse collisions; every edited contract surface is additive. Two minor implementation notes (below) — neither blocks; both are mechanical.

## Reuse findings (does it already exist?)

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `ProductPublishExecutionService` / `IProductPublishExecutionService` | **NEW** | absent |
| `ProductPublishBuilderService` / `IProductPublishBuilderService` | **NEW** | absent |
| `ListingCreationRecord` entity + types (`ListingCreationStatus*`, `LISTING_CREATION_STATUS`, `ListingCreationError`, `CreateListingCreationRecordInput`) | **NEW** | absent |
| `ListingCreationRecordRepositoryPort` + impl | **NEW** | absent |
| ORM `@Entity('listing_creation_records')` | **NEW** | absent |
| `BuildPublishProductCommandInput`, `ExecutePublishInput/Result` | **NEW** | absent |
| `ShopProductPublishHandler` (`shop-product-publish.handler.ts`) | **NEW** | absent |
| Migration touching `listing_creation_records` | **NEW** | absent |
| Tokens `LISTING_CREATION_RECORD_REPOSITORY_TOKEN`, `PRODUCT_PUBLISH_BUILDER_SERVICE_TOKEN`, `PRODUCT_PUBLISH_EXECUTION_SERVICE_TOKEN` | **NEW** | absent in `listings.tokens.ts` |
| `ProductPublishRejectedException` | **EXISTS → reuse** | `listings/domain/exceptions/product-publish-rejected.exception.ts` (shipped by #1041) — execution service throws/maps it; do not recreate |
| `ShopProductPublishPayloadV1`, `PublishProductCommand`, `ShopProductManagerPort`, `CategoryProvisioner`, `OfferParameter` | **EXISTS → reuse/extend** | all on `main` (#1041 + #1039) |

## Backward-compat findings (edited surfaces)

| Surface | Result | Detail |
|---|---|---|
| `CORE_ENTITY_TYPE` + `CoreEntityType` (`identifier-mapping.types.ts:19-63`) | **Additive** | `ShopProduct` absent; **zero** exhaustive consumers (no `switch`/`Record<CoreEntityType>`/`assertNever`). ⚠️ add to **both** `CoreEntityTypeValues` (the `as const` array) **and** the `satisfies Record<CoreEntityType, CoreEntityType>` guard or type-check fails. |
| `PublishProductCommand` (`product-publish.types.ts`) | **Additive** | only consumer is `ShopProductManagerPort`; optional `parameters?: OfferParameter[]` breaks nothing. Import `OfferParameter` **same-context relative** (`./offer-parameter.types`), not via the barrel. |
| `ShopProductPublishPayloadV1` (`shop-job-payloads.types.ts`) | **Additive** | already type-imports from `@openlinker/core/listings`; add `parameters?` there. |
| `CategoryResolutionInput` (`category-resolution.types.ts`) | **Additive** | 4 callers all construct selectively; optional `sourceCategoryPath?` is safe. |
| `tryProvision()` (`category-resolution.service.ts:132-136`) | **Additive** | private no-op today; filling it changes only the open/provision branch — marketplaces (no `CategoryProvisioner`) fall through unchanged. Constructor already injects `IIntegrationsService` — no new dep. |
| `listings/index.ts` + `listings.module.ts` (`services` subpath) | **Additive** | new exports/providers append-only. ⚠️ **barrel-purity spec** (`listings/__tests__/barrel-purity.spec.ts`) hard-codes a FORBIDDEN service-class list; add `ProductPublishExecutionService` + `ProductPublishBuilderService` to it, export those **classes only** from `@openlinker/core/listings/services`, and export their **interfaces/types/port + tokens** from the pure barrel. |
| Migration ordering | **Additive** | `1806000000000` > main tail `1805000000000` (invariant satisfied); sibling table — `offer_creation_records` untouched. |
| Worker registry / jest-mapper | **No break** | registry spec auto-covers `shop.product.publish` via the `JobTypeValues` loop; core-only handler needs no `moduleNameMapper` edit. |

## Open questions (non-blocking)

1. **`ListingCreationError` aliasing `OfferCreationError`** — the alias keeps the shop path off an offer-named import while avoiding a near-duplicate; acceptable, but if a reviewer prefers a standalone neutral type, define it fresh (trivial). Decide at implementation.
2. **`#1072` closure wording** — both #1072 ACs are met at the command/execution layer here; the adapter-shaping bullet is #1043. Plan targets `Closes #1042` + `Closes #1072` with an #1043 note; downgrade to `Part of #1072` at ship if over-claimed.
3. **Int-spec placement** — `apps/api/test/integration/listings/` (app harness covers type-check; avoids the worker-int-spec gate-escape noted in lessons). Fake `ShopProductManagerPort` registered via `AdapterRegistryService` + `AdapterFactoryResolverService` (carrier-mapping precedent).

## Summary

Clean, additive vertical slice with no reuse collisions and no contract breaks. The only watch-items are mechanical: keep the `CoreEntityType` array + `satisfies` guard in lockstep, and extend the barrel-purity FORBIDDEN list for the two new service classes. Proceed to implementation.
