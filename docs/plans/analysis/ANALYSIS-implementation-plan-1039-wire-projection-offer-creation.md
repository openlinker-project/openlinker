# Pre-implement analysis: #1039 — Wire category + attribute projection into offer creation

**Gated**: `docs/plans/implementation-plan-1039-wire-projection-offer-creation.md` · #1039
**Date**: 2026-06-15
**Verdict**: ✅ **READY**

Read-only gate against the live worktree. No Critical findings; no contract break; no migration. One minor open question (type-alias vs distinct identical-shape type) and one documented transitional coupling, neither blocking.

---

## Reuse findings (Phase B)

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `OfferParameter` domain type (`listings/domain/types/offer-parameter.types.ts`) | **NEW (confirmed absent)** | No `OfferParameter` anywhere in `libs/ apps/`. Only `AllegroOfferParameter` (integration-isolated, `allegro/src/domain/types/allegro-api.types.ts:6`) and the application-layer `ResolvedParameter`. No domain-layer neutral offer-parameter type exists to reuse. |
| `CategoryParameterSection` (referenced by new type) | **ALREADY EXISTS → reuse** | `listings/domain/types/category-parameter.types.ts:52-53` (`['offer','product']`); exported from barrel `index.ts:225,229`. |
| `CreateOfferCommand.parameters?: OfferParameter[]` | **NEW field, additive** | `offer-create.types.ts:65` has no `parameters` field today; optional add is backward-compatible. |
| `AttributeProjectionService` / `ATTRIBUTE_PROJECTION_SERVICE_TOKEN` | **ALREADY EXISTS → reuse** | Token `listings.tokens.ts:7`; provider `listings.module.ts:115,168-170`; same module as `OfferBuilderService` (`:121`) → constructor injection needs no barrel change. |
| `CategoryResolutionService.resolveCategory(sourceCategoryIds)` | **ALREADY EXISTS → reuse** | accepts `sourceCategoryIds` post-#1037; no change. |
| `business_failure` mapping | **ALREADY EXISTS → reuse** | `offer-creation-execution.service.ts:271,221` maps `OfferBuilderValidationException` → `Failed` → `business_failure`. No change. |
| `Product.categories` / `ProductVariant.attributes` access | **ALREADY EXISTS → reuse** | both via `@openlinker/core/products` barrel already imported in `offer-builder.service.ts:26`; no new deep import. |

## Backward-compat findings (Phase C)

| Surface | Result | Severity |
|---|---|---|
| Top-level barrel `@openlinker/core/listings` | New `OfferParameter` export is a unique name; `ResolvedParameter` kept as alias → no duplicate/collision | ✅ none |
| Port method signatures | No `*Port` signature changes (additive optional command field only) | ✅ none |
| DTO shapes | No request/response DTO field removed/required/retyped | ✅ none |
| Symbol tokens | No token removed/renamed; reuses `ATTRIBUTE_PROJECTION_SERVICE_TOKEN` | ✅ none |
| ORM schema | No `*.orm-entity.ts` touched → **no migration** | ✅ none |
| `check:invariants` | `OfferBuilderService implements IOfferBuilderService` unchanged (ctor dep is orthogonal to `check-service-interfaces`); no cross-context/deep-barrel import introduced | ✅ none |

## Open questions (non-blocking)

1. **`ResolvedParameter` = `OfferParameter` alias vs. two distinct identical-shape types.** The reuse probe flagged a *semantic* preference to keep them distinct (projection-output vs command-input). They are structurally identical and the projected output literally becomes `command.parameters`, so the alias is correct and lowest-churn; keeping them distinct is also acceptable. **Decision deferred to implementation** — either satisfies the gate. Recommendation: alias now, split later only if the shapes diverge.
2. **Transitional dual-channel coupling.** Gate-2's "subtract operator-supplied param ids read from legacy `platformParams.parameters`/`productParameters`" makes the core builder read Allegro-shaped keys transitionally. Documented in the plan and slated for removal in **#1071** (FE migration collapses to the single neutral channel). Not a contract break; acceptable as a tracked transition.

## Notes
- Allegro is the **sole** live `createOffer` consumer (grep-verified) → the adapter-side change has a single consumer, minimal blast radius.
- Follow-ups already filed: **#1071** (FE neutral-param migration + single-channel collapse), **#1072** (shop `PublishProductCommand` carriage unification).
