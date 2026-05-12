# Implementation Plan — Allegro catalog-product lookup by EAN (BE capability + FE wizard prefill)

**Issues**: #633 (BE) + #635 (FE) — shipping together in a single PR.
**Parent threads**: Listings · Allegro · CreateOfferWizard prefill (#410/#412/#631/#632 family).

---

## 1. Understanding the task

### Goal

When an operator picks a variant whose EAN matches an entry in Allegro's product catalog, surface that match to the wizard so:

- Step 2's product-section parameters auto-fill from the catalog product (Brand, Model, Manufacturer-code, etc.).
- The operator sees what Allegro will inherit on the server side, can validate it, and can pick between ambiguous matches.
- A panel above the parameter list shows the matched product (name, thumbnail) with an `Unlink` escape hatch.

The BE half is invisible plumbing today — `resolveAllegroProductCardByEan` already runs at submit time to attach `productSet[0].product.id`, but only returns `{ id, ean, name }` summaries, no parameters/images, and has no HTTP surface.

### Layer

CORE (capability + neutral types) + Integration (Allegro adapter implementation) + Interface (HTTP routes + DTOs) + Frontend (feature/listings hooks, panel, prefill helper extension).

### Explicit non-goals

- **Full catalog browser** — only EAN-driven lookup. No "search by name" UX.
- **Image auto-attach** — catalog images shown in the panel for operator validation only; do not push them into the offer's image list. (Copyright + freshness concerns.)
- **Description auto-fill from catalog** — out of scope; description has its own write-through flow (#342). Catalog prefill is parameters-only.
- **Pagination for ambiguous list** — Allegro's `/sale/products?phrase={ean}` typically returns ≤ a handful. If real-world data disproves this, add `limit` as a follow-up.
- **New cache backend** — reuse the existing 24h in-memory `CachePort` the Allegro adapter already uses for `resolveAllegroProductCardByEan`.
- **Backwards-compat for offer creation** — the existing smart-link path in `allegro-offer-manager.adapter.ts:1398-1416` continues to work unchanged; the new capability must reuse the same resolver, not duplicate `/sale/products` calls.

---

## 2. Research findings

### Sub-capability template (#594/F7 conventions still apply)

```ts
// libs/core/src/listings/domain/ports/capabilities/category-barcode-matcher.capability.ts
export interface CategoryBarcodeMatcher {
  matchCategoryByBarcode(barcode: string): Promise<string | null>;
}
export function isCategoryBarcodeMatcher(adapter: OfferManagerPort): adapter is OfferManagerPort & CategoryBarcodeMatcher {
  return typeof (adapter as Partial<CategoryBarcodeMatcher>).matchCategoryByBarcode === 'function';
}
```

The new `CatalogProductReader` mirrors this exactly: interface + co-located guard.

### `listings.controller.ts` precedent (just-merged #631)

```ts
@Post('connections/:connectionId/categories/resolve')
@HttpCode(HttpStatus.OK)
async resolveCategory(...) {
  await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(connectionId, 'OfferManager');
  // ... delegate to application service
}
```

- `IntegrationsService.getCapabilityAdapter` throws `NotFoundException` (404) for missing connection, `UnprocessableEntityException` (422) for capability-not-supported.
- Sub-capability check happens *after* via `isXxx(adapter)` guard; throws 422 if missing.
- DTOs live in `apps/api/src/listings/http/dto/`; use `@ApiProperty({ enum: XxxValues })` for unions backed by `as const` arrays.
- **Status semantics**: 422 for "connection exists but doesn't support the capability" — I'll follow #631's precedent here. The #633 issue text says "404 when the connection is missing or doesn't support" but conflates two cases; I'll match the established pattern.

### Allegro resolver to wrap

`libs/integrations/allegro/src/infrastructure/util/resolve-allegro-product-card-by-ean.ts` returns a 3-state discriminant `{ kind: 'unique' | 'ambiguous' | 'no_match', ... }`. Caches `unique` and `no_match` at `allegro:product-card:${categoryId}:${ean}` for 24h. Never throws — HTTP errors collapse to `no_match`.

**Reuse strategy**: `findProductsByBarcode` calls this util and maps the result onto `CatalogProductMatchResult`. For `unique`, it ALSO fetches `GET /sale/products/{productId}` to populate the full `CatalogProduct` (parameters, images). The existing smart-link path at line 1398 doesn't need the full detail — it only uses the productId — so the new code path adds a second cache layer for the detail fetch keyed by `(connectionId, productId)`.

### Existing smart-link call (lines 1398-1416 of `allegro-offer-manager.adapter.ts`)

```ts
if (cardLinkResult.kind === 'unique') {
  body.productSet = [{ product: { id: cardLinkResult.productId }, quantity: stock }];
  return; // Allegro inherits name/parameters/images from card
}
```

Unchanged by this PR — the new capability is a separate read path that simply reuses the same lookup.

### FE wizard

- File: `apps/web/src/features/listings/components/AllegroCreateOfferWizard.tsx` (not `CreateOfferWizard.tsx` — the explore agent's correction).
- Step indices (0-based): 0 = variant, 1 = offer details + category, 2 = parameters (← prefill happens here), 3 = policies, 4 = review.
- State: form state (RHF) for `categoryId`, `parameters.{paramId}`, variant; local state for `pickedVariantEan`, `prefilledIds`.

### `auto-prefill-parameters.ts` extension model

Today's helper does name-pattern matching (`EAN_NAME_PATTERNS`, `CONDITION_NAME_PATTERNS`, etc.) against `CategoryParameter[]`. For catalog prefill, the merge key is `parameterId` (Allegro's parameter IDs are stable per category), NOT name patterns — so this is a **new, separate prefill source**, not an extension of the existing fuzzy-match list. New helper: `prefillFromCatalogProduct(form, product)` that merges by `parameterId`, skipping dirty fields.

### Existing `CategoryParameter` type to mirror

```ts
// libs/core/src/listings/domain/types/category-parameter.types.ts
export interface CategoryParameter {
  id: string;
  name: string;
  type: 'dictionary' | 'string' | 'integer' | 'float';
  // ... dictionary entries, restrictions, dependsOn, section
}
```

`CatalogProductParameter` mirrors the value shape so FE merge logic can do `paramId → values` lookup symmetrically: `{ parameterId, name, valueIds?: string[], valueStrings?: string[] }`.

---

## 3. Design

### BE — capability surface

`libs/core/src/listings/domain/ports/capabilities/catalog-product-reader.capability.ts`:

```ts
export interface CatalogProductReader {
  findProductsByBarcode(input: FindProductsByBarcodeInput): Promise<CatalogProductMatchResult>;
  getProduct(input: { productId: string }): Promise<CatalogProduct>;
}
export function isCatalogProductReader(adapter: OfferManagerPort): adapter is OfferManagerPort & CatalogProductReader {
  return (
    typeof (adapter as Partial<CatalogProductReader>).findProductsByBarcode === 'function' &&
    typeof (adapter as Partial<CatalogProductReader>).getProduct === 'function'
  );
}
```

Two methods because `findProductsByBarcode` on the `ambiguous` branch returns summaries only — the FE pays the detail-fetch cost only when the operator picks one.

`libs/core/src/listings/domain/types/catalog-product.types.ts`:

```ts
export const CatalogProductMatchKindValues = ['unique', 'ambiguous', 'no_match'] as const;
export type CatalogProductMatchKind = (typeof CatalogProductMatchKindValues)[number];

export interface FindProductsByBarcodeInput {
  barcode: string;
  categoryId?: string;
}

export type CatalogProductMatchResult =
  | { kind: 'unique'; product: CatalogProduct }
  | { kind: 'ambiguous'; products: CatalogProductSummary[] }
  | { kind: 'no_match' };

export interface CatalogProductSummary {
  id: string;
  name: string;
  ean?: string;
  imageUrl?: string;
}

export interface CatalogProduct extends CatalogProductSummary {
  description?: string;
  images?: string[];
  parameters: CatalogProductParameter[];
}

export interface CatalogProductParameter {
  parameterId: string;
  name: string;
  valueIds?: string[];
  valueStrings?: string[];
}
```

Both files exported from `libs/core/src/listings/index.ts`. No platform-specific fields anywhere.

### BE — Allegro adapter

New file `libs/integrations/allegro/src/infrastructure/util/fetch-allegro-product.ts` — fetches `GET /sale/products/{productId}`, maps the Allegro response to `CatalogProduct`, caches at `allegro:product-detail:${productId}` for 24h. Cache key omits `connectionId` because Allegro's catalog is global, not seller-scoped; the existing card-by-ean util also omits it. (Issue text suggests `(connectionId, productId)` — I'll deviate and key by productId only, with a short comment explaining: the catalog is shared across all sellers on Allegro PL.)

In `AllegroOfferManagerAdapter`:
- `findProductsByBarcode({ barcode, categoryId })`: if `categoryId` provided, delegate to `resolveAllegroProductCardByEan({ ean: barcode, categoryId })`. Map kinds:
  - `unique` → eager-fetch detail via `fetchAllegroProduct` and return `{ kind: 'unique', product: <full> }`.
  - `ambiguous` → return `{ kind: 'ambiguous', products: summaries }` (no detail fetch).
  - `no_match` → return `{ kind: 'no_match' }`.
  - If `categoryId` is absent, return `{ kind: 'no_match' }` (the existing resolver requires categoryId; the issue's `FindProductsByBarcodeInput.categoryId?` makes it optional but our adapter has no category-less search).
- `getProduct({ productId })`: delegate to `fetchAllegroProduct`. Throws `CatalogProductNotFoundException` (new) if Allegro returns 404.

Adapter `class AllegroOfferManagerAdapter implements OfferManagerPort, OfferLister, OfferEventReader, OfferFieldUpdater, CategoryBrowser, CategoryBarcodeMatcher, OfferCreator, OfferStatusReader, SellerPoliciesReader, CatalogProductReader` — append to the existing list at the class signature.

### BE — HTTP

`apps/api/src/listings/http/dto/`:
- `find-products-by-barcode-request.dto.ts`: `{ barcode: string; categoryId?: string }` with `@IsString @IsNotEmpty` etc.
- `find-products-by-barcode-response.dto.ts`: discriminated-union DTO with `@ApiProperty({ enum: CatalogProductMatchKindValues })`. Two nested DTOs for the variants.
- `catalog-product-response.dto.ts`: full product shape for the `getProduct` route.

`apps/api/src/listings/http/listings.controller.ts` — add two routes:

```ts
@Post('connections/:connectionId/products/find-by-barcode')
@HttpCode(HttpStatus.OK)
async findProductsByBarcode(@Param('connectionId') connectionId: string, @Body() dto: FindProductsByBarcodeRequestDto): Promise<FindProductsByBarcodeResponseDto> { ... }

@Get('connections/:connectionId/products/:productId')
async getCatalogProduct(@Param('connectionId') connectionId: string, @Param('productId') productId: string): Promise<CatalogProductResponseDto> { ... }
```

Both `@UseGuards(JwtAuthGuard)`. Resolution flow inside each:
1. `await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(connectionId, 'OfferManager')` — throws 404 (missing connection) or 422 (no OfferManager).
2. `if (!isCatalogProductReader(adapter)) throw new UnprocessableEntityException(...)` — 422.
3. Delegate, map to DTO, return.

`no_match` is `200` with `{ kind: 'no_match' }` — normal outcome, not an error.

### BE — application service (or inline?)

For #631's `resolveCategory` route there's a dedicated `CategoryResolutionService`. For these two routes the logic is thin enough (capability guard → delegate → return) that I'll keep it inline in the controller — same shape as a typical thin pass-through. If a second consumer emerges (e.g., a future bulk-prefill job), promote to a service. Trade-off documented in the controller header comment.

### FE — API client + hooks

`apps/web/src/features/listings/api/listings.api.ts`:

```ts
findProductsByBarcode(connectionId: string, body: { barcode: string; categoryId?: string }): Promise<CatalogProductMatchResult>;
getCatalogProduct(connectionId: string, productId: string): Promise<CatalogProduct>;
```

`listings.types.ts` — mirror the BE neutral types (preserve `camelCase`).

`listings.query-keys.ts`:

```ts
catalogProductMatch: (connectionId: string, barcode: string, categoryId: string) =>
  ['listings', 'connections', connectionId, 'products', 'match', barcode, categoryId] as const;
catalogProduct: (connectionId: string, productId: string) =>
  ['listings', 'connections', connectionId, 'products', productId] as const;
```

`apps/web/src/features/listings/hooks/use-catalog-product-match-query.ts` and `use-catalog-product-query.ts`:
- Enabled gated on truthy `(connectionId && barcode && categoryId)`.
- `retry: false` — failures are silent.
- Default staleTime: 5 min (catalog data is slow-moving; user can refresh page if needed).

### FE — wizard wiring

In `AllegroCreateOfferWizard.tsx`:

1. Add `const [unlinkedFromCatalog, setUnlinkedFromCatalog] = useState(false);` — operator-controlled escape hatch.
2. Compute `pickedVariantEan` and `currentCategoryId` (already in scope).
3. `const matchQuery = useCatalogProductMatchQuery(currentConnectionId, pickedVariantEan, currentCategoryId, { enabled: !unlinkedFromCatalog });`.
4. On `matchQuery.data?.kind === 'unique'`: run `prefillFromCatalogProduct(form, matchQuery.data.product, dirtyFields)` in an effect, track `prefilledIds`.
5. On category change OR variant change: reset `unlinkedFromCatalog`, reset `prefilledIds`, re-run prefill.
6. Render `<CatalogProductMatchPanel result={matchQuery.data} unlinked={unlinkedFromCatalog} onUnlink={...} onPickAmbiguous={...} />` above the parameter list in Step 2.

### FE — panel component

`apps/web/src/features/listings/components/CatalogProductMatchPanel.tsx` — new file. Three render branches:

| Branch | Content |
|---|---|
| `unique` (linked) | Thumbnail (if `imageUrl`) + name + "N fields auto-filled from Allegro catalog" + `Unlink` button. |
| `unique` (unlinked) | Compact "Catalog match available — Relink" affordance. Keeps the panel visible so the operator can recover. |
| `ambiguous` | Header + radio-list of summaries (thumbnail + name + ean) + `Skip` button. On pick, parent fetches detail and the panel switches to the `unique` branch. |
| `no_match` | Panel does not render. |

Styling uses existing `index.css` tokens. No new external libraries.

### FE — prefill helper extension

`apps/web/src/features/listings/components/auto-prefill-parameters.ts` — add a new exported function:

```ts
export function prefillFromCatalogProduct(
  parameters: CategoryParameter[],
  catalogProduct: CatalogProduct,
  dirtyFields: Partial<Record<string, true>>,
): { values: CategoryParameterFormValues; prefilledIds: Set<string> } { ... }
```

Merge rule: iterate `catalogProduct.parameters`. For each `{ parameterId, valueIds, valueStrings }`, if `dirtyFields[parameterId]` is true, skip. Otherwise write the value(s). Return the new partial values map + the set of IDs that were touched, so the panel can show `N fields auto-filled` and `Unlink` can revert precisely those.

Precedence rule (issue's "conflict rules"):
- Catalog prefill takes precedence over variant-attribute prefill (#412) on overlapping `parameterId`s.
- When the catalog match is `unique`, the wizard's prefill effect resets to #410 (EAN/Stan) baseline, then runs #412 on top (if shipped), then catalog on top of that.
- `Unlink` reverts to the (#410 + #412) baseline, not blank.
- Dirty fields are never overwritten regardless of source.

### Tests

**BE unit tests**:
- `catalog-product-reader.capability.spec.ts` — guard returns `false` if either method is missing.
- `allegro-offer-manager.adapter.spec.ts` (extend) — `findProductsByBarcode` returns `unique` with eager detail fetch; `ambiguous` returns summaries only; `no_match` returns no_match. Existing smart-link tests unchanged.
- `fetch-allegro-product.spec.ts` — Allegro response → neutral `CatalogProduct` mapping (parameters, images, description).
- `listings.controller.spec.ts` (extend) — 404 missing connection, 422 missing capability, 200 + `no_match` is fine, 200 + full product on `unique`.

**BE int-spec**: defer — the existing `prestashop-container.helper.ts` Testcontainer is PrestaShop-specific; there's no Allegro Testcontainer, and the issue doesn't require one. Unit-test coverage is sufficient given the issue's acceptance criteria.

**FE vitest tests**:
- `catalog-product-match-panel.test.tsx` — renders thumbnail+name+unlink for unique, radio-list for ambiguous, nothing for no_match.
- `auto-prefill-parameters.test.ts` — `prefillFromCatalogProduct` skips dirty fields, returns correct prefilledIds, takes precedence over variant-attribute prefill.
- `allegro-create-offer-wizard.test.tsx` (extend) — unique → silent prefill; ambiguous → pick → prefill; no_match → existing behaviour; unlink → revert to #410/#412 baseline; category change → re-query; variant change → reset.

### Doc updates

- `docs/architecture-overview.md § OfferManagerPort` table (around line 463-473) — add `CatalogProductReader` row.

---

## 4. Step-by-step implementation

### Step 1 — Capability + neutral types (CORE)

Files:
- `libs/core/src/listings/domain/ports/capabilities/catalog-product-reader.capability.ts` (new)
- `libs/core/src/listings/domain/types/catalog-product.types.ts` (new)
- `libs/core/src/listings/index.ts` (extend)

**Acceptance**: `tsc -b libs/core` clean; `import { CatalogProductReader, isCatalogProductReader, CatalogProduct, CatalogProductMatchResult } from '@openlinker/core/listings'` resolves.

### Step 2 — Allegro adapter implementation (Integration)

Files:
- `libs/integrations/allegro/src/infrastructure/util/fetch-allegro-product.ts` (new) — detail fetch + Allegro→neutral mapper, cached.
- `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` (extend) — implement `findProductsByBarcode` and `getProduct`. Append `CatalogProductReader` to the class's `implements` clause.

**Acceptance**: existing smart-link path at line 1398 makes one `/sale/products?phrase=…` call per submit (unchanged). The new `findProductsByBarcode` route reuses the same util — no duplicate calls in tests.

### Step 3 — BE HTTP routes + DTOs (Interface)

Files:
- `apps/api/src/listings/http/dto/find-products-by-barcode-request.dto.ts` (new)
- `apps/api/src/listings/http/dto/find-products-by-barcode-response.dto.ts` (new — discriminated)
- `apps/api/src/listings/http/dto/catalog-product-response.dto.ts` (new)
- `apps/api/src/listings/http/listings.controller.ts` (extend with two routes)

**Acceptance**: Swagger reflects both endpoints; capability guard fires 422 in unit tests; `no_match` returns 200.

### Step 4 — BE unit tests

Files in `__tests__/` next to each touched implementation. See §3 Tests for the cases.

**Acceptance**: `pnpm test` adds new green tests; existing Allegro adapter tests still pass.

### Step 5 — FE API client + types + query keys + hooks

Files:
- `apps/web/src/features/listings/api/listings.types.ts` (extend with mirrored neutral types)
- `apps/web/src/features/listings/api/listings.api.ts` (extend with two methods)
- `apps/web/src/features/listings/api/listings.query-keys.ts` (extend)
- `apps/web/src/features/listings/hooks/use-catalog-product-match-query.ts` (new)
- `apps/web/src/features/listings/hooks/use-catalog-product-query.ts` (new)

**Acceptance**: `pnpm --filter @openlinker/web type-check` clean.

### Step 6 — FE prefill helper extension

File: `apps/web/src/features/listings/components/auto-prefill-parameters.ts` (extend).

Add `prefillFromCatalogProduct(parameters, catalogProduct, dirtyFields)` returning `{ values, prefilledIds }`. Existing `autoPrefillParameters` function unchanged.

**Acceptance**: new vitest covers happy path, dirty-field skip, deterministic precedence over variant-attribute prefill.

### Step 7 — FE panel component

File: `apps/web/src/features/listings/components/CatalogProductMatchPanel.tsx` (new).

Renders all 4 states (unique-linked, unique-unlinked, ambiguous, no_match→null). Token-driven CSS in `index.css` (extending the existing wizard styles, no new external libs).

**Acceptance**: vitest covers all 4 render branches.

### Step 8 — FE wizard wiring

File: `apps/web/src/features/listings/components/AllegroCreateOfferWizard.tsx` (extend).

Mount the panel above the parameter list in Step 2. Wire the match query, the prefill effect, and the reset triggers (category change, variant change, unlink).

**Acceptance**: existing wizard tests still pass; new tests cover the catalog-match flow (unique, ambiguous→pick, unlink, reset triggers, dirty-field preservation).

### Step 9 — Doc update

File: `docs/architecture-overview.md` § OfferManagerPort sub-capability table (line ~463-473).

Add row: `| `CatalogProductReader` | `findProductsByBarcode(input)` / `getProduct({productId})` |`. Include a short paragraph above the table noting `CatalogProductReader` complements `CategoryBarcodeMatcher` (one resolves category, the other resolves catalog product within a category).

### Step 10 — Quality gate

```
pnpm lint
pnpm type-check
pnpm test
```

All three must pass with zero errors. (Skip `pnpm test:integration` — no Allegro Testcontainer exists; unit tests cover the surface.)

---

## 5. Validation

### Architecture compliance

- ✅ CORE: capability interface + guard + neutral types only. No `allegro*` fields.
- ✅ Integration: Allegro mapping confined to `libs/integrations/allegro/src/infrastructure/`. Reuses existing `resolveAllegroProductCardByEan` — no duplicate API calls.
- ✅ Interface: HTTP routes thin pass-through; capability guard handled at the controller boundary; DTOs in `apps/api/src/listings/http/dto/`.
- ✅ FE: feature-scoped (`features/listings/`); no `plugins/` imports; no raw `fetch`; uses TanStack Query for server state, React Hook Form for the wizard's form state.

### Naming

- Capability follows the established `{Capability}` interface + `is{Capability}` guard pattern.
- Types use `as const` + union (`CatalogProductMatchKindValues` / `CatalogProductMatchKind`).
- BE route paths match the existing `/listings/connections/:connectionId/...` shape.
- FE hooks follow `use-*-query.ts` convention; query keys are tuples ending with the distinguishing inputs.

### Testing strategy

- BE: unit-test every new file (capability, util, adapter methods, controller routes). No integration test — no Allegro Testcontainer; HTTP routes are thin pass-throughs.
- FE: vitest covers the panel component, the prefill helper, and the wizard wiring's behavioural rules (unique/ambiguous/no_match/unlink/reset triggers/dirty-field preservation).

### Security

- Both HTTP routes guarded by `@UseGuards(JwtAuthGuard)`.
- No new secrets; reuses existing per-connection Allegro credentials.
- DTOs validated by `class-validator`.

### Risks & open questions

- **Allegro `/sale/products/{productId}` parameter shape** — the mapper has to handle dictionary IDs vs. free-text values, plus the offer-section vs product-section distinction (#415). Verify against the API docs before writing the mapper; if Allegro returns mixed sections, the neutral `CatalogProductParameter` deliberately doesn't carry section info (catalog-prefill targets product-section parameters by design; if section disambiguation is needed downstream the wizard already has it from the `/categories/:id/parameters` query).
- **Cache key for getProduct** — I'm keying by `productId` only (not `(connectionId, productId)`) because Allegro's catalog is global. If the future brings region-scoped catalogs (e.g., Allegro CZ vs PL with diverging product IDs), bump the cache key. Documented in the cache header.
- **HTTP status for missing capability** — issue says 404, #631 precedent says 422. Following 422. Documented in the controller header comment.
- **Wizard reset semantics** — when the operator changes the category in Step 1, the param form values for the old category are discarded (already true in existing wizard). Catalog prefill follows that reset; no special handling needed.
- **Cache invalidation** — both card-by-ean and product-detail caches are best-effort 24h. The existing util doesn't expose an invalidation hook; if catalog data goes stale, operators wait out the TTL or restart the API. Acceptable for an MVP; revisit if real-world support load complains.
