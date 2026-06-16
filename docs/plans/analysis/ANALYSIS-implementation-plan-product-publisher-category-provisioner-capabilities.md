# Pre-implement gate — ProductPublisher + CategoryProvisioner capabilities (#1041)

**Plan:** `docs/plans/implementation-plan-product-publisher-category-provisioner-capabilities.md`
**Date:** 2026-06-15 · **Gate:** read-only readiness (no code, no plan edits)

## Verdict: ✅ READY

No reuse collisions, no contract-surface breaks. Every proposed artifact is confirmed
absent; every edited surface is additive. The merged ADR-023 category-resolution service
already names the exact contract this plan defines, corroborating the naming.

## Reuse findings (does it already exist?)

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `ShopProductManagerPort` (base port) | **NEW** | no `*Port` of that name under `libs/core/src/**/domain/ports/**` |
| `CategoryProvisioner` capability + `isCategoryProvisioner` | **NEW** | no `*.capability.ts`, no `provisionCategory` method anywhere |
| `publishProduct` method | **NEW** | absent in libs/core + libs/integrations |
| `PublishProductCommand/Result/Status/Content` | **NEW** | absent |
| `ProvisionCategoryCommand/Result` | **NEW** | absent |
| `ProductPublishRejectedException` | **NEW** | absent |
| `ShopProductPublishPayloadV1` + `shop-job-payloads.types.ts` | **NEW** | only `marketplace-job-payloads.types.ts` / `master-job-payloads.types.ts` exist |
| `'shop.product.publish'` job type | **NEW** | absent from `JobTypeValues` |
| `'ProductPublisher'` / `'CategoryProvisioner'` capability names | **NEW** | absent from `CoreCapabilityValues` (current: ProductMaster, InventoryMaster, OrderProcessorManager, OrderSource, OfferManager) |

**Adjacent (not a collision):** `ProductMasterPort.assignCategories` (`products/domain/ports/product-master.port.ts:148`) *attaches* a product to existing categories — it does **not create/mirror** a category tree. Distinct from `CategoryProvisioner.provisionCategory`. ADR-024 §2 explicitly calls this out ("Today no capability *creates* categories"). No overlap.

**Corroborating signal (strengthens the plan):** the merged `listings/application/services/category-resolution.service.ts` already ships a no-op `tryProvision()` seam whose JSDoc states it will be *"Gated on the `CategoryProvisioner` capability (ADR-024) … uses `isCategoryProvisioner`, calls `provisionCategory(...)`"* and returns `provenance: 'open'`. The plan's names (`CategoryProvisioner`, `isCategoryProvisioner`, `provisionCategory`) match this downstream consumer exactly — #1042 wires straight into it.

## Backward-compat findings

| Surface | Result | Detail |
|---|---|---|
| Top-level barrels | **No break** | `listings/index.ts` + `sync/index.ts` + `integrations/index.ts` gain exports only (additive). `CoreCapabilityValues`/`CoreCapability` already re-exported from `integrations/index.ts:49-50`; `JobTypeValues`/`JobType` from `sync/index.ts:43,55`. |
| Port signatures | **No break** | `ShopProductManagerPort` is net-new; no existing port changes. |
| Symbol tokens | **No break** | no new tokens (capabilities are guard-resolved); `listings.tokens.ts` untouched. |
| DTOs | **No break (additive)** | `create-connection.dto.ts:114` + `update-connection.dto.ts:56` use `@IsIn(CoreCapabilityValues, { each: true })` → adding members only widens the accepted set; `connection-response.dto.ts:53,61` is Swagger `enum` only. |
| ORM schema | **N/A** | no ORM entity touched → no migration required. |
| `check:invariants` | **No trip** | additions are within-context (listings, sync, integrations) + same-context relative imports; sync→listings value import of `PublishProductStatus`/`PublishProductContent` follows the existing precedent (`marketplace-job-payloads.types.ts` already imports `CreateOfferOverrides` from `@openlinker/core/listings`). No cross-context repo-port import; barrel-purity unaffected (no service classes added). |
| Exhaustiveness | **No break** | repo-wide search found **zero** `assertNever` / `Record<JobType>` / `Record<CoreCapability>` / `[K in …]` maps keyed on `JobType` or `CoreCapability`. Adding union members is safe. |

## Open questions (non-blocking)

1. **Name↔interface skew** — capability name `'ProductPublisher'` maps to interface `ShopProductManagerPort` (because `publishProduct` is the base port's mandatory method, mirroring `OfferManagerPort` + `updateOfferQuantity`). This is the one place a core capability name diverges from its interface name. Accepted by design (umbrella scalability); must be documented in the `ShopProductManagerPort` header so #1042/#1044/#1043 authors resolve `getCapabilityAdapter<ShopProductManagerPort>(id, 'ProductPublisher')` without confusion.
2. **`'CategoryProvisioner'` as a first-class registry name** — unlike `OfferCreator` (a sub-capability NOT in `CoreCapabilityValues`), #1041 registers `CategoryProvisioner` as a name so the brain can resolve it independently and the FE can gate on it. Deliberate divergence from the OfferCreator precedent; fine.
3. **Result naming** — plan uses `ProvisionCategoryResult`; ADR-024 §2 writes `CategoryProvisionResult`. Plan already records the alias in the type-file header. Cosmetic.

## Summary

The slice is a clean, additive contract-surface expansion with zero reuse collisions and zero
backward-compat breaks. The umbrella `ShopProductManagerPort` + `CategoryProvisioner`
sub-capability design matches the 20/20 base-port-anchored guard invariant and the names the
already-merged category-resolution seam expects. Proceed to implementation.
