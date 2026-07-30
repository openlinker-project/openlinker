# Pre-implement analysis — Category per family and per variant in bulk offer creation

- Plan: `docs/plans/implementation-plan-bulk-offer-category-family-variant.md`
- Issue: [#1924](https://github.com/openlinker-project/openlinker/issues/1924)
- Date: 2026-07-29

## Verdict: READY (with 2 plan corrections applied below, no re-gate needed)

No reuse collisions, no undisclosed contract breaks. Two factual corrections to the plan surfaced during this gate — both narrow the scope of work, not widen it. No architectural rework needed.

## Reuse findings

| Plan artifact | Status | File |
|---|---|---|
| `VariantGroupingModelValues` / `VariantGroupingModel` / `resolveVariantGroupingModel` | NEW (confirmed absent — no existing grouping-model concept anywhere in `adapter.types.ts` or sibling type files) | `libs/core/src/integrations/domain/types/adapter.types.ts` |
| `variantGrouping?` field on `AdapterMetadata` | NEW | same file |
| Manifest field additions (Allegro/Erli/WooCommerce) | NEW (one-line each); manifests are plain object literals, no factory indirection to fight | `allegro-plugin.ts:75-107`, `erli-plugin.ts:55-77`, `woocommerce-plugin.ts:51-91` |
| `ConnectionResponseDto.variantGrouping` | NEW field; existing `supportedCapabilities` field is the direct precedent to copy | `connection-response.dto.ts:14-100` |
| `PerOverrideDto` (merge of `PerVariantOverrideDto`/`OverridesNoCategoryDto`) | PARTIAL — renames/deletes two existing classes rather than adding a third; confirmed no other file imports `OverridesNoCategoryDto` or `PerVariantOverrideDto` by name outside this DTO file and its spec | `apps/api/src/listings/http/dto/bulk-offer-create.dto.ts` |
| Conditional `stripVariantCategoryId` | PARTIAL — extends an existing free function's signature | `bulk-listing-submit.service.ts:733-740` |
| FE `VariantGroupingModel` mirror type | NEW, but the **exact pattern to copy already exists** for `CoreCapability`: `apps/web/src/features/connections/api/connections.types.ts:22-40` (`CORE_CAPABILITY_VALUES` / `CoreCapability` — FE hand-rolls its own literal-union mirror of the BE `as const`, no cross-package import). Resolves the plan's open question #4: add `VARIANT_GROUPING_MODEL_VALUES` / `VariantGroupingModel` the same way, plus `variantGrouping: VariantGroupingModel` (required, not optional, since the BE always resolves a default) on `Connection` at line ~53. |
| Category 3-state ladder pattern | EXISTS, reuse confirmed → `bulk-edit-modal.tsx:1732-1939` (`warnParamIds`/`unlockedParamIds`, `renderVariantParam`) |
| `BulkCategoryChooseModal` | EXISTS, reuse confirmed → `bulk-edit-modal.tsx:1023-1030` |

### Correction 1 — `OverridesNoCategoryDto`/`PerVariantOverrideDto` have no other consumers

Grepped every file in the repo for both names outside `bulk-offer-create.dto.ts` and its own spec — zero hits. The rename/delete in plan §3.4 is fully self-contained; no ripple into `BulkListingSubmitInput`/`PerProductOverride` (those core-side types are separately defined in `libs/core/src/listings/application/types/bulk-listing-submit.types.ts` and already type `overrides` as the core `CreateOfferOverrides`, unaffected by the HTTP-layer rename).

### Correction 2 — Plan step 8 (`useBulkRequiredProductParams` per-variant attribution) is **already correct today, no fix needed**

The plan flagged this as unconfirmed and a possible real fix. Traced the full call chain:

- `useBulkRequiredProductParams` (`apps/web/src/features/listings/hooks/use-bulk-required-product-params.ts:33-60`) returns `requiredByCategory: Map<categoryId, requiredParamIds>` — already keyed **per distinct category id**, not merged into one pool.
- The consumer, `recomputeVariantBlockers` (`apps/web/src/features/listings/components/bulk/bulk-policy.ts:461-497`), already computes `submitCategoryId = variant.override.overrides?.categoryId ?? variant.resolvedCategoryId` **per variant** (line 468) and looks up `requiredByCategory.get(submitCategoryId)` (line 483) — i.e. a variant with its own category override is already validated against that category's own required-param set, not the family's.

This was built defensively ahead of the FE bar existing (likely as part of #1741's own per-variant `categoryId` plumbing, even though nothing wrote to it yet). **Downgrade plan step 8 from "verify/fix" to "verify only, expect no change"** — remove it as an implementation risk; keep one assertion in `bulk-edit-modal.test.tsx` or `bulk-wizard.test.tsx` proving it (a variant on its own category surfaces/clears blockers independently of the family's required params), since today nothing exercises this path end-to-end (no code writes `edit.categoryId` yet).

### Test-file path correction

`bulk-listing-submit.service.spec.ts` exists at `libs/core/src/listings/application/services/__tests__/bulk-listing-submit.service.spec.ts` (a `__tests__/` subfolder, not directly beside the service file as the plan's table implied). No content risk — just the path for step 7's edits.

## Backward-compatibility findings

| Surface | Check | Severity | Note |
|---|---|---|---|
| `AdapterMetadata` interface (barrel-exported type) | Adding an **optional** field | None | Every existing manifest object literal still conforms; no call site destructures an exhaustive field list |
| `ConnectionResponseDto` (response DTO) | Adding a **new required** field (`variantGrouping!: VariantGroupingModel`) | Warning | Additive for JSON consumers (extra field, non-breaking wire-wise), but any FE test that does an exact-shape snapshot/deep-equal against a `Connection` fixture will need updating — expected, not a hidden break. Swagger schema gains one property, non-breaking for existing clients. |
| `PerVariantOverrideDto` / `OverridesNoCategoryDto` (deleted/renamed) | These are **not** re-exported from any barrel (`apps/api` doesn't publish a package barrel the way `libs/core` does) and have zero external consumers per Correction 1 | None (Critical-surface checklist doesn't apply — this is an API-app-internal DTO, not a `@openlinker/core/*` barrel export) | Confirmed via grep, not assumption |
| `stripVariantCategoryId` (private free function, module-internal) | Signature gains a required second parameter | None | Not exported; only one call site (`buildEnqueueInput`, same file) |
| ORM schema | No entity/column change anywhere in the plan | None | No migration needed — matches the plan's own §4 note and the architecture doc's "capabilities are code-driven, not DB-persisted" principle |
| `check-cross-context-imports` | `resolveVariantGroupingModel` is consumed by `libs/core/src/listings/**` from `@openlinker/core/integrations` — an existing, already-allowed cross-context pattern (the file already imports `IIntegrationsService`/`INTEGRATIONS_SERVICE_TOKEN` from the same barrel) | None | No new cross-context shape introduced — a plain exported function joins existing named exports from the same barrel |
| `check-service-interfaces` | No new `*.service.ts` added | None | N/A |

## Open questions (none blocking)

The plan's own §6 items are resolved:
1. DTO end-state scope — user already signed off (see conversation).
2. Erli declared-but-unavailable — intentional, matches issue text.
3. `useBulkRequiredProductParams` — resolved above (Correction 2), already correct.
4. FE `Connection` type import path — resolved above (mirror-literal-union pattern, same as `CoreCapability`).

No remaining open questions. Proceed to implementation as planned, applying Corrections 1 and 2 above (both reduce scope: no ripple-import cleanup needed, and step 8 becomes a verification-only test rather than a fix).
