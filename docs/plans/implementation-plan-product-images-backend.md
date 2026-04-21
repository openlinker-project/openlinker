# Implementation Plan — Product Images Backend Slice (#271 + #272)

**Branch:** `271-272-product-images-backend`
**Issues:** Closes #271, closes #272
**Scope:** Backend only. Consumers ship separately: `ProductThumbnail` primitive (#273), Products-list thumbnails (#274), Inventory-list thumbnails (#275), FE wizard storefront-URL override field (#283).

---

## 1. Goal

Populate `Product.images` end-to-end for PrestaShop connections, and expose `productImageUrl` on the Inventory list response so the frontend can render product thumbnails on `/products` and `/inventory`.

### Non-goals
- Image storage/upload/proxy infrastructure — we only emit URLs that point at PrestaShop's storefront.
- Variant-level images (`ProductVariant` has no image field).
- Authenticated image proxy for private storefronts — degraded behaviour is `images: undefined` (persisted as `null`) when storefront URL resolution fails.
- FE rendering work.
- FE wizard UX for the storefront-URL override (tracked in #283) — this PR uses the `baseUrl` fallback so the common case still works with zero operator action.
- Reconciling the two `Product` type declarations — see "Known limitations" below.

## 2. Layer classification

- **CORE** — `Product.coverImageUrl` getter (domain entity).
- **Integration** — PrestaShop mapper + config schema changes.
- **Interface** — Inventory DTO + controller mapping.

## 3. Research findings

- `Product` is overloaded across the codebase: the **domain entity class** lives at `libs/core/src/products/domain/entities/product.entity.ts` (re-exported as `ProductEntity` from `@openlinker/core/products`); the **port interface** lives at `libs/core/src/products/domain/ports/product-master.port.ts` (re-exported as `Product`). The inventory controller already imports the entity class via `ProductEntity as Product` — the `coverImageUrl` getter goes on the entity class.
- Mapper is framework-free, instantiated once per connection in `PrestashopAdapterFactory.createAdapters()` with no args. Cheapest extension is to pass `storefrontBaseUrl` via constructor — per-connection factory creates per-connection mapper, so no cross-request state leaks.
- Inventory controller (`apps/api/src/inventory/http/inventory.controller.ts:92-103`) already builds a `productMap` from `ProductRepositoryPort.findById` and maps `productName`/`productSku` in `toDto()`. Adding `productImageUrl` is one line.
- `PrestashopConnectionConfig` already validates `baseUrl` as a URL. We add optional `storefrontBaseUrl` with the same validation and the ergonomic default of falling back to `baseUrl` when absent (webservice and storefront share a hostname in the common case).
- PrestaShop image URL format used: `{storefrontBaseUrl}/img/p/{split}/{imageId}-home_default.jpg`, where `split` is the image id with digits separated by `/` (e.g. `123` → `1/2/3`). Numeric path works regardless of "Friendly URL" config. `home_default` is PrestaShop's standard thumbnail size (~250×250) — safe default for list rows and detail pages.
- `PrestashopProduct.associations.images` shape (per PrestaShop XML/JSON serialization): `{ image: { id: '1' } }` or `{ image: [{ id: '1' }, { id: '2' }] }` (single-element collections can collapse to a bare object).
- Engineering standards require types to live in `*.types.ts` files — the mapper options type goes in a colocated types file, not inline.

## 4. Design

### Data flow (unchanged structurally)

```
PrestaShop API → PrestashopProductMasterAdapter
              → PrestashopProductMapper.mapProduct() — now emits real image URLs
              → MasterProductSyncService → ProductRepository.save()
              → Product.images jsonb in Postgres

GET /inventory → InventoryController → ProductRepositoryPort.findById (batched)
             → Product (domain entity) — exposes .coverImageUrl getter
             → InventoryItemResponseDto { ..., productImageUrl }
```

### Port ownership

The rule "the cover image is the first element of `images`" belongs to the Products domain. Inventory does not replicate that rule — it calls `product.coverImageUrl`. This is the core architectural intent of the PR (mirrored in #272's body).

### Connection config

`storefrontBaseUrl` is optional. If present, use it. If absent, fall back to `baseUrl` at the factory layer — the mapper never sees `null`. This covers the common case (webservice + storefront at the same host) without requiring any operator action. The operator-facing override field (wizard UX) ships in #283.

### Mapper construction

```ts
// factory
const productMapper = new PrestashopProductMapper({
  storefrontBaseUrl: config.storefrontBaseUrl ?? config.baseUrl, // always a valid URL
});
```

Constructor takes an options object so we can add mapper config in the future without churning call sites. The options type is **non-nullable** (`string`, not `string | null`) because the factory is the only call site and always passes a valid URL — no dead branches in the mapper.

### Null/undefined handling convention (existing)

`mapProduct` converts `null → undefined` for fields destined for the port interface (see existing lines 28, 32). The new `extractImages` returns `string[] | undefined` to match that convention. Downstream the domain entity persists as `string[] | null` — the port↔entity impedance is existing and out of scope here.

## 5. Implementation steps

### Step 1 — `Product.coverImageUrl` getter

**File:** `libs/core/src/products/domain/entities/product.entity.ts`

- Add `get coverImageUrl(): string | null { return this.images?.[0] ?? null; }`
- JSDoc: "First image URL by convention — the cover. Null if the product has no images."

### Step 2 — `Product` entity unit spec

**File (new):** `libs/core/src/products/domain/entities/product.entity.spec.ts`

- File header per `docs/engineering-standards.md#file-headers`.
- Cover the getter: `null` (null images), `null` (empty array), first element (populated).

### Step 3 — Extend `PrestashopConnectionConfig`

**File:** `libs/integrations/prestashop/src/domain/types/prestashop-config.types.ts`

- Add `storefrontBaseUrl?: string` with JSDoc explaining purpose, default-to-`baseUrl` fallback, and the split-host use case.

### Step 4 — Validate `storefrontBaseUrl` in factory

**File:** `libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts`

- In `validateAndParseConfig`: when `storefrontBaseUrl` is present, validate it's a string + valid URL (same pattern as `baseUrl`). Throw `PrestashopConfigException` otherwise.
- Include it in the returned `PrestashopConnectionConfig` object.

### Step 5 — Mapper options type (separate file)

**File (new):** `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-product.mapper.types.ts`

- File header.
- Export `PrestashopProductMapperOptions`:
  ```ts
  export interface PrestashopProductMapperOptions {
    /**
     * Base URL used to build public product-image URLs.
     * Always a valid URL at runtime — the adapter factory falls back
     * to PrestaShop's webservice baseUrl when storefrontBaseUrl is unset.
     * Never null.
     */
    storefrontBaseUrl: string;
  }
  ```

Per `docs/engineering-standards.md#type-definitions-in-separate-files`: types must not be inline.

### Step 6 — `PrestashopProductMapper` constructor + URL helper

**File:** `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-product.mapper.ts`

- Add `constructor(private readonly options: PrestashopProductMapperOptions)`.
- Add a pure private helper `splitImageId(id: string): string` (digits separated by `/`: `123` → `1/2/3`, `42` → `4/2`, `7` → `7`).
- Add a private `buildImageUrl(imageId: string): string`:
  - Strips trailing slash from `options.storefrontBaseUrl` defensively.
  - Returns `${base}/img/p/${split}/${imageId}-home_default.jpg`.
  - `// TODO: image type ('home_default') is fixed for v1. Expose via options when detail-page or retina sizes land.`

### Step 7 — Real `extractImages()` implementation

Same file as Step 6.

- Replace the stubbed method. Inputs: `PrestashopProduct`. Output: `string[] | undefined` (**not** `null` — matches existing `null → undefined` convention in this file).
- Read `associations.images.image`; normalize object → single-element array.
- For each entry, extract `id` tolerating both `id` and `@_id` attribute key variants (mirror the `extractLanguageId` pattern).
- Build URLs via `buildImageUrl`. Skip entries with missing/invalid id (don't throw, don't short-circuit — one bad image shouldn't kill the whole product).
- Preserve PrestaShop order (first element = cover).
- No null-branch — `storefrontBaseUrl` is always a valid URL by type.

### Step 8 — Update factory call site

**File:** `libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts`

- `new PrestashopProductMapper({ storefrontBaseUrl: config.storefrontBaseUrl ?? config.baseUrl })`.

### Step 9 — Mapper unit tests

**File:** `libs/integrations/prestashop/src/infrastructure/mappers/__tests__/prestashop-product.mapper.spec.ts`

All existing tests must pass after updating `new PrestashopProductMapper()` to `new PrestashopProductMapper({ storefrontBaseUrl: 'https://shop.test' })` (a shared fixture constant reduces churn).

New cases:
- `extractImages`: single image object → 1-element array with correctly built URL.
- `extractImages`: multi-image array → multi-element array, cover first.
- `extractImages`: attribute-style id (`@_id`) → URL built correctly.
- `extractImages`: no `associations.images` → `undefined`.
- `extractImages`: entry with missing id → skipped, other entries still processed.
- `buildImageUrl` via observable output: `1` → `.../img/p/1/1-home_default.jpg`, `42` → `.../img/p/4/2/42-home_default.jpg`, `123` → `.../img/p/1/2/3/123-home_default.jpg`, `1234` → `.../img/p/1/2/3/4/1234-home_default.jpg`.
- `storefrontBaseUrl` with trailing slash → URL has exactly one slash between host and path.

### Step 10 — Inventory DTO field

**File:** `apps/api/src/inventory/http/dto/inventory-item-response.dto.ts`

- Add `productImageUrl!: string | null` with `@ApiPropertyOptional({ nullable: true, description: 'Cover image URL from the master catalog (null if product has no images or not found)' })`.

### Step 11 — Inventory controller mapping

**File:** `apps/api/src/inventory/http/inventory.controller.ts`

- In `toDto()` (around line 105-117): add `productImageUrl: product?.coverImageUrl ?? null`.
- **Do not** write `product?.images?.[0] ?? null` in the controller — ownership stays on the entity.

### Step 12 — Inventory controller spec update

**File:** `apps/api/src/inventory/http/inventory.controller.spec.ts`

- Extend the two "Test Product" cases (lines 92, 155): add `images: ['https://shop.test/img/p/1/1-home_default.jpg']` on the mock Product fixture; assert `productImageUrl === 'https://shop.test/img/p/1/1-home_default.jpg'` in both list and detail.
- Extend the "product not found" case (line 96): assert `productImageUrl === null`.
- Add a case where product has `images: null` → `productImageUrl` is `null`.

### Step 13 — Inventory integration test

**File:** `apps/api/test/integration/inventory-read.int-spec.ts`

- Extend the happy-path fixture: seed a product with `images: ['https://shop.test/img/p/1/1-home_default.jpg', 'https://shop.test/img/p/1/1-medium_default.jpg']`, hit `GET /inventory`, assert `productImageUrl` equals the first element.
- Seed a product with `images: null` → `productImageUrl` is `null`.

### Step 14 — Frontend type sync (contract only, no UI wiring)

**File:** `apps/web/src/features/inventory/api/inventory.types.ts`

- Add `productImageUrl: string | null;` to the `InventoryItem` interface so the FE contract stays in lockstep. Not consumed in this PR — #275 picks it up.

## 6. Validation checklist

- [ ] Domain layer has no framework deps (`product.entity.ts` still a plain class).
- [ ] Mapper has no framework deps (no `@Injectable()`, no NestJS imports).
- [ ] `ProductRepositoryPort` unchanged — getter is derived data, not a port-shape change.
- [ ] No `any` types introduced; narrow `unknown` with type guards for `associations.images` parsing.
- [ ] No `console.log` — use `Logger`.
- [ ] Mapper options type lives in a `*.types.ts` file (not inline).
- [ ] No schema migration needed (ORM column unchanged).
- [ ] Inventory DTO change is additive (nullable field); no breaking change to existing consumers.
- [ ] FE type sync keeps FE–BE contract in lockstep.

## 7. Known limitations / deliberate out-of-scope

- **`Product` port interface vs domain entity class drift.** `@openlinker/core/products` re-exports both: the port interface (`images?: string[]`) and the entity class (`images: string[] | null`). This PR adds `coverImageUrl` only to the entity class — correct for the inventory controller's use case (reads via `ProductRepositoryPort` → entity class), but widens the drift that #281 already flags for `ProductVariant`. **Proposed follow-up:** file a Product-equivalent of #281 to reconcile the two `Product` types. Not required for this PR to be correct.
- **Custom PrestaShop URL paths.** Stores with heavy front-office customization (CDNs, rewritten image paths) may 404 the canonical `/img/p/…` URL. `ProductThumbnail`'s `onError` fallback (#273) handles this gracefully.
- **Connection `/test` endpoint doesn't probe the storefront URL.** The field is best-effort; URL shape is validated at submit time, not live.

## 8. Commit plan

Two logical commits on one branch:

1. `feat(products): add Product.coverImageUrl getter for display convention` — Steps 1–2.
2. `feat(prestashop): populate Product.images via storefront URLs; feat(api): expose productImageUrl on inventory list response` — Steps 3–14.

## 9. PR body outline

- What: one-liner per issue.
- Why: unlocks product thumbnail UI (#273/#274/#275) and FE wizard override field (#283).
- Key design call: port ownership — `coverImageUrl` on Product entity, not in the inventory layer.
- Follow-ups flagged: #283 (FE wizard override), and new Product port/entity reconciliation issue to be filed.
- Closes #271, closes #272.
