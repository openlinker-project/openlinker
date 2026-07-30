# Implementation Plan — Category per family and per variant in bulk offer creation

- **Issue**: [#1924](https://github.com/openlinker-project/openlinker/issues/1924)
- **Branch**: `1924-bulk-category-per-family-per-variant`
- **Layers**: Interface (API DTO), CORE (integrations + listings application), Integration (Allegro/Erli/WooCommerce manifests), Frontend

## 1. Understand the task

Two bugs in the same field, same flow, fixed together:

- **Part 1 (blocking bug)**: `perProductOverrides` (family tier) is validated with a DTO class that strips `categoryId`, but the core service and the FE both already treat `categoryId` as family-tier data. Every multi-variant bulk-publish submit 400s at the HTTP boundary. Single-variant products are unaffected (the FE never pins a family category for them), which is why this shipped unnoticed.
- **Part 2 (feature)**: category is currently resolved once per **product**. Some destinations let a specific variant (e.g. a "tester" SKU) live in its own category. Whether that is even meaningful, and what happens when it diverges, is destination-shape-dependent:
  - **Allegro** (`catalog-implicit`): grouping happens by linking each offer to the same catalog product; siblings must share a category for that catalog product to resolve. Giving a variant its own category is a **real, consequential choice** — it splits that variant out of the grouped listing.
  - **Erli** (`explicit-group`): grouping is carried explicitly (`externalVariantGroup.groupId`), independent of category. A per-variant category is just metadata — no confirm, no split. (Out of scope to actually *ship* interactively — Erli has no `CategoryBrowser`, so even the base scope's picker is read-only today. Declared for discovery; unavailable in practice until a borrowed-taxonomy browse capability exists, #1045 follow-up.)
  - **WooCommerce** (`parent-child`): a WC product *variation* has no `categories` field in the REST API — category is structurally parent-only. Not a policy choice, a hard no.

**Non-goals** (explicit, from the issue):
- Category browsing through a borrowed-taxonomy owner (Erli's actual interactive picker) — separate, unfiled follow-up.
- A batch-level summary of which product goes to which category.
- Any change to `POST /listings/bulk-shop-publish` (the shop-publish endpoint is unaffected — WC gets correct behavior for free from the locked default, no code path there needs to change).
- A real Erli interactive variant-category bar — model is declared, FE renders the same locked/no-override shape as WooCommerce (there's no functional picker to hand off to regardless of the declared model).

## 2. Research summary (already verified against the live repo at `origin/main`)

| Concern | File:line | Current state |
|---|---|---|
| Family-tier DTO strips categoryId | `apps/api/src/listings/http/dto/bulk-offer-create.dto.ts:130-170` (`PerVariantOverrideDto` reused for both maps, nested `overrides: OverridesNoCategoryDto`) | Confirmed live; `perProductOverrides` and `perVariantOverrides` both point at the same restrictive class |
| Core service already treats categoryId as family-tier | `libs/core/src/listings/application/services/bulk-listing-submit.service.ts:659-666` (`buildEnqueueInput`), `:733-740` (`stripVariantCategoryId`) | Unconditional strip on variant tier only; family tier keeps it |
| Adapter metadata shape | `libs/core/src/integrations/domain/types/adapter.types.ts:67-108` (`AdapterMetadata` interface) | No grouping-model field today; `supportedCapabilities: string[]`, `displayName?`, `version?`, `isDefault?` |
| Static manifests | `libs/integrations/allegro/src/allegro-plugin.ts:74-107` (`allegroAdapterManifest`), `libs/integrations/erli/src/erli-plugin.ts:54-77` (`erliAdapterManifest`), `libs/integrations/woocommerce/src/woocommerce-plugin.ts:51-91` (`woocommerceAdapterManifest`) | Plain object literals; one-line addition each once the interface gains the field |
| Manifest → FE surfacing | `apps/api/src/integrations/http/connection.controller.ts:84-111` (`toResponse`, calls `resolveAdapterMetadata`), `apps/api/src/integrations/http/dto/connection-response.dto.ts:14-100` (`ConnectionResponseDto`, `supportedCapabilities` field + `fromDomain`) | `resolveAdapterMetadata` already injected everywhere needed; adding a field is the same shape as `supportedCapabilities` |
| Service already resolves the adapter | `bulk-listing-submit.service.ts:149-152` (`getCapabilityAdapter<OfferManagerPort>`) inside `submit()` | Need a **second**, sibling call to `resolveAdapterMetadata` (metadata, not capability-adapter — `variantGrouping` isn't a capability) — new plumbing, threaded from `submit()` into `buildEnqueueInput`/`stripVariantCategoryId` (currently a free function without access to instance state) |
| Existing 3-state ladder precedent | `apps/web/src/features/listings/components/bulk/bulk-edit-modal.tsx:124` (`BASE_ONLY_PARAM_NAMES`), `:1732-1733` (`warnParamIds`/`unlockedParamIds` state), `:1850-1939` (`renderVariantParam` — 3 render branches: inherited-readonly-with-override-link / warn-confirm-callout / unlocked-picker-with-split-badge) | Mirror this pattern exactly for the category bar |
| Reusable category picker | `apps/web/src/features/listings/components/bulk/bulk-edit-modal.tsx:1023-1030` (`BulkCategoryChooseModal`, used by `BaseScopeForm`) | Same component reusable for the variant-scope override |
| `connection` already reaches the base scope | `bulk-edit-modal.tsx:936` (`connection={connection}` passed to `BaseScopeForm`), `:1552` (`connection.supportedCapabilities?.includes(...)`) | `VariantScopeForm` (props at `:1678-1691`, render call `:974-990`) does **not** currently receive `connection` — needs adding |
| Per-product category-param schema resolved once | `bulk-edit-modal.tsx:554-560` (`useCategoryParametersQuery(connectionId, baseValues.categoryId)`), result passed identically to `BaseScopeForm` (`:953`) and every `VariantScopeForm` (`:983`) | Only one query call in the whole file — variant override needs its own second query, scoped to that variant only |
| Bulk-wizard blocker validation already variant-aware | `apps/web/src/features/listings/components/bulk/bulk-wizard.tsx:169-183` (`noCardCategoryIds`, already reads `variant.override.overrides?.categoryId ?? variant.resolvedCategoryId` per-variant) | The 422-blocker gate (`useBulkRequiredProductParams`) already collects per-variant category ids into one set — needs verification (not yet confirmed) that it validates each variant against **its own** category's required-param schema rather than a merged pool |
| `VariantEdit.categoryId` is dead today | `bulk-edit-modal.tsx:409` (field), `:431` (read from existing override), `:689` (written to `perVariantOverrides` at submit) | Confirmed no `onPatch` call site ever sets it — it round-trips a pre-seeded value only, never operator-set. This plan makes it live. |
| Erli/WC adapter category wire shapes | `libs/integrations/erli/src/infrastructure/adapters/erli-offer-manager.adapter.ts:791-794` (`externalCategories`, per-offer), `:848-855` (`externalVariantGroup.id`, independent of category); `libs/integrations/woocommerce/src/infrastructure/adapters/product-publisher/woocommerce-product-publisher.adapter.ts:478-479`/`530-531` (`categories` on parent/simple only), `:574-589` (`buildVariationBody` — no `categories` field) | Confirmed — matches the 3-model design exactly |
| FE `Connection` type | `apps/web/src/features/connections/api/connections.types.ts:46-56` (`interface Connection`, `supportedCapabilities: string[]`) | Needs a `variantGrouping?: VariantGroupingModel` field alongside `supportedCapabilities` |

## 3. Design

### 3.1 Declared grouping model (new cross-cutting type)

New `as const` union in `libs/core/src/integrations/domain/types/adapter.types.ts` (extends the existing types file, same file the `AdapterMetadata` interface lives in — no new file needed since it's one tightly-coupled concept):

```ts
export const VariantGroupingModelValues = [
  'catalog-implicit',   // grouping via a shared catalog product keyed by category (Allegro)
  'explicit-group',     // grouping via an explicit group id, category is ordinary metadata (Erli)
  'parent-child',       // variant is not a taxonomy-bearing object; category is parent-only (WooCommerce)
] as const;
export type VariantGroupingModel = (typeof VariantGroupingModelValues)[number];
```

Add optional field to `AdapterMetadata`:
```ts
variantGrouping?: VariantGroupingModel;
```

Pure resolver (co-located in the same file, mirroring the `pricing-rule.types.ts` / `stockSafetyBuffer` precedent of small pure helpers living beside their type):
```ts
/** Most-restrictive default: an adapter that declares nothing is treated as parent-child (locked). */
export function resolveVariantGroupingModel(metadata: Pick<AdapterMetadata, 'variantGrouping'> | undefined | null): VariantGroupingModel {
  return metadata?.variantGrouping ?? 'parent-child';
}
```

This is the **single seam** every layer (service strip logic, connection response, FE bar) reads through — never `platformType` comparisons (acceptance criterion, ESLint-checkable by grep in review).

### 3.2 Manifests

One line each:
- `allegroAdapterManifest` (`allegro-plugin.ts:75` area) → `variantGrouping: 'catalog-implicit'`
- `erliAdapterManifest` (`erli-plugin.ts:56` area) → `variantGrouping: 'explicit-group'`
- `woocommerceAdapterManifest` (`woocommerce-plugin.ts:52` area) → `variantGrouping: 'parent-child'` (documents the structural default explicitly, even though omitting it would resolve the same via `resolveVariantGroupingModel`)

### 3.3 Connection response surfacing

- `ConnectionResponseDto` (`connection-response.dto.ts`): add `variantGrouping!: VariantGroupingModel` field (`@ApiProperty({ enum: VariantGroupingModelValues })`), populate in `fromDomain` from a new `variantGrouping` parameter.
- `connection.controller.ts` `toResponse`: after resolving `metadata`, compute `resolveVariantGroupingModel(metadata)` (defaulting the same way on the resolve-failure catch branch, so an unrecognized adapter also reports the locked shape) and pass it to `fromDomain`.
- FE `Connection` type (`connections.types.ts`): add `variantGrouping: VariantGroupingModel` (import the union — re-exported through whatever the FE's existing capability-string import path is, or a local FE literal union mirroring the 3 values; confirm during implementation whether FE types import BE unions or hand-roll them — follow whatever `supportedCapabilities`' sibling fields do today).

### 3.4 Final DTO shape (Part 1 folded into the Part-2 end-state)

Since both parts land together, the DTO goes straight to its final form rather than through the Part-1-only interim (which would reject variant-tier `categoryId` and need a second migration commit). Decision, called out explicitly for review:

- Delete `OverridesNoCategoryDto` (no longer needed — no tier is DTO-restricted anymore).
- Rename `PerVariantOverrideDto` → `PerOverrideDto` (one shape, used by **both** `perProductOverrides` and `perVariantOverrides`), with `overrides?: CreateOfferOverridesDto` (the full shape, `categoryId` included).
- `perProductOverrides` and `perVariantOverrides` both type as `Record<string, PerOverrideDto>`.
- Enforcement of "can this variant actually keep its own category" moves entirely to the **application layer** (conditional `stripVariantCategoryId`), never the HTTP boundary — because whether a variant may diverge depends on the *destination adapter*, which the DTO layer has no visibility into (it validates shape, not cross-field business rules against a resolved connection).
- Update the module header comment + the doc comment that used to sit on `OverridesNoCategoryDto`.

### 3.5 Conditional strip in the core service

`BulkListingSubmitService.submit()` already resolves `adapter` via `getCapabilityAdapter`. Add a sibling resolve:
```ts
const metadata = await this.integrationsService.resolveAdapterMetadata({ ... });
const variantGroupingModel = resolveVariantGroupingModel(metadata);
```
Thread `variantGroupingModel` as a parameter into `buildEnqueueInput` (currently reads only `input`/`bulkBatchId`/`job`/`masterStock`) and into `stripVariantCategoryId` (currently a bare free function). New signature:
```ts
function stripVariantCategoryId(overrides, variantGroupingModel: VariantGroupingModel) {
  if (variantGroupingModel !== 'parent-child') return overrides; // Allegro + Erli both keep it
  // ... existing strip logic, unchanged
}
```
Only `'parent-child'` (WooCommerce, and the locked default for anything undeclared) strips. `'catalog-implicit'` (Allegro) and `'explicit-group'` (Erli) both pass the variant-tier `categoryId` through — Allegro's consequence (splitting the grouped listing) is a downstream/FE-only concern, not something the submit service needs to police (the offer builder / adapter already resolve category per-offer field-for-field once it reaches them).

### 3.6 Bulk wizard blocker validation (`bulk-wizard.tsx` + `useBulkRequiredProductParams`)

Investigate at implementation time (not fully confirmed by research) whether `useBulkRequiredProductParams` already validates each variant's required-params against **its own** resolved category schema, or lumps `noCardCategoryIds` into one merged pool and cross-attributes params. If the latter, it needs to key its resolved-schema lookup per variant id (not just per distinct category id merged flat) so a tester's required params are checked against the tester's category, not the family's.

### 3.7 FE bar (`bulk-edit-modal.tsx`)

- Thread `connection` (already fetched) into `VariantScopeForm` (new prop, passed at the render call site `:974-990` alongside the existing props).
- Derive `variantGroupingModel = connection.variantGrouping` once in `VariantScopeForm`.
- Only `'catalog-implicit'` (Allegro) renders the interactive 3-state ladder — mirroring `warnParamIds`/`unlockedParamIds` exactly, but as **new, category-specific state** (not reusing the param-id sets, since `categoryId` isn't a `CategoryParameter`):
  ```ts
  const [categoryWarn, setCategoryWarn] = useState(false);
  const [categoryUnlocked, setCategoryUnlocked] = useState(edit.categoryId !== undefined);
  ```
  - **State 1 (inherited)**: read-only chip showing the base category path + "Override for this variant" link → sets `categoryWarn = true`.
  - **State 2 (warn)**: consequence callout ("Splits this variant into its own Allegro listing") + "Override anyway" (→ `categoryUnlocked = true`, seed `edit.categoryId` from base) / "Keep shared" (→ `categoryWarn = false`).
  - **State 3 (unlocked)**: `BulkCategoryChooseModal` (same component the base scope already uses) scoped to this variant, a "splits listing" badge, reset link (clears `edit.categoryId`, `categoryUnlocked = false`).
- Any other `variantGroupingModel` (`'explicit-group'`, `'parent-child'`, or the field missing) renders **only** state 1's read-only chip, no override link — Erli gets no functional picker today (no `CategoryBrowser`) so there's nothing useful to hand off to regardless of its declared model; WooCommerce additionally states "set on the parent product" per acceptance criteria. Distinguish the two only by copy, not by behavior.
- Second `useCategoryParametersQuery(connectionId, edit.categoryId)` inside `VariantScopeForm`, gated on `edit.categoryId !== undefined && edit.categoryId !== baseValues.categoryId`; when active, its result set replaces the shared `categoryParameters` prop for that variant's own param rendering (`renderVariantParam` / `requiredParams`/`optionalParams` computation) — every other variant keeps reading the shared query.
- No `platformType` comparisons anywhere in this component — only `variantGroupingModel === 'catalog-implicit'` (or equivalent switch).

### 3.8 Outcome strip

Per the issue's approved mock: a small strip inside the category bar stating what the current choice publishes as (`one card` / `separate` / `one group` / `parent-only`), driven by `variantGroupingModel` + `categoryUnlocked`. Small, presentational — implemented as part of 3.7, no separate step.

## 4. Step-by-step plan

Each step includes its acceptance check.

| # | Step | File(s) | Acceptance |
|---|---|---|---|
| 1 | Add `VariantGroupingModelValues`/`VariantGroupingModel`/`resolveVariantGroupingModel` | `libs/core/src/integrations/domain/types/adapter.types.ts` | Exported from `@openlinker/core/integrations` barrel (already re-exports the types file's other exports — confirm) |
| 2 | Add `variantGrouping?: VariantGroupingModel` to `AdapterMetadata` | same file | Type-checks; existing manifests still conform (field optional) |
| 3 | Declare `variantGrouping` on the 3 manifests | `allegro-plugin.ts`, `erli-plugin.ts`, `woocommerce-plugin.ts` | Each manifest's existing `*.spec.ts` (if any asserts full manifest shape) still passes or is updated |
| 4 | Surface `variantGrouping` on `ConnectionResponseDto` + `toResponse` | `connection-response.dto.ts`, `connection.controller.ts` | `connection.controller.spec.ts` covers a connection whose adapter declares each of the 3 models + the resolve-failure fallback (locked) |
| 5 | Add `variantGrouping` to FE `Connection` type | `apps/web/src/features/connections/api/connections.types.ts` | Type-checks against the API response shape |
| 6 | Rewrite `bulk-offer-create.dto.ts`: delete `OverridesNoCategoryDto`, rename/merge into `PerOverrideDto`, both maps point at it | `apps/api/src/listings/http/dto/bulk-offer-create.dto.ts` | `bulk-offer-create.dto.spec.ts`: family-tier `categoryId` accepted, variant-tier `categoryId` now also accepted at the DTO layer (validation moved to the service); every other field's existing validation (title MaxLength, imageUrls IsUrl, price positivity, ean digit-shape, platformParams cap, parameters bounds) still enforced on both maps |
| 7 | Thread `variantGroupingModel` resolution into `BulkListingSubmitService.submit()` → `buildEnqueueInput` → `stripVariantCategoryId` | `bulk-listing-submit.service.ts` | `bulk-listing-submit.service.spec.ts`: catalog-implicit + explicit-group → categoryId survives; parent-child + undeclared/unresolvable → stripped |
| 8 | Verify/fix `useBulkRequiredProductParams` per-variant category schema attribution | `apps/web/src/features/listings/hooks/use-bulk-required-product-params.ts` (confirm path) | A variant with its own category is validated against that category's required params, not the family's — add/adjust a test case |
| 9 | Thread `connection` into `VariantScopeForm`; add category 3-state bar + second `useCategoryParametersQuery` | `bulk-edit-modal.tsx` | New render branch per `variantGroupingModel`; `bulk-edit-modal.test.tsx` covers all 3 models |
| 10 | Mixed-batch + multi-variant submit end-to-end sanity | `bulk-wizard.test.tsx` or a new focused test | A multi-variant product submits without a 400; a mixed batch (1 single-variant + 1 multi-variant) submits in full |

No DB migration: `variantGrouping` lives in code (manifest), same as every other capability declaration — consistent with "Capability Assignment (Implicit Capabilities)" in the architecture doc.

## 5. Validate

- Architecture: capability/model resolution is manifest-declared and read through a single pure resolver — never `platformType` string comparisons outside `plugins/<platformType>/` (acceptance criterion; verify by grep before opening the PR).
- Naming: `VariantGroupingModelValues`/`VariantGroupingModel` follows the `as const` + union convention (engineering-standards.md); `resolveVariantGroupingModel` is a pure, side-effect-free function colocated with its type, matching the `stockSafetyBuffer`/pricing-rule precedent.
- Testing: unit tests at every layer touched (DTO, service, connection response, FE modal). Per `resource-constrained-pc-test-prefs` memory, scope test runs to the affected packages rather than the full `pnpm test`; skip `pnpm test:integration` unless explicitly requested (no schema/migration change, so low risk there).
- Security: no new user input surface beyond what already exists (`categoryId` was always acceptable as a string at the family tier; this only widens where it's *allowed*, no new validation gap — GS1/currency/key-shape guards untouched).

## 6. Risks / open questions

1. **DTO scope decision (3.4)**: going straight to the end-state (deleting `OverridesNoCategoryDto` rather than keeping Part 1's interim restriction) changes behavior beyond the issue's Part-1-only acceptance criterion ("perVariantOverrides still rejects categoryId with a 400"). Since Part 2 supersedes that within the same PR, this is intentional — flagging for explicit sign-off before implementation.
2. **Erli's declared-but-unavailable model**: confirmed by the issue itself as intentional (no `CategoryBrowser` yet), so the FE renders it identically to the locked WooCommerce shape today. Revisit once the borrowed-taxonomy browse capability (#1045 follow-up) exists.
3. **`useBulkRequiredProductParams` exact behavior** (step 8) is unconfirmed — needs a short Explore pass at the start of implementation before deciding whether it's a no-op verification or a real fix.
4. **FE `Connection` type import path** for the new union (step 5) — whether FE hand-rolls a mirrored literal union or there's an existing cross-package type-sharing convention for such enums; resolve during implementation by checking how `supportedCapabilities`' sibling FE fields are typed.
