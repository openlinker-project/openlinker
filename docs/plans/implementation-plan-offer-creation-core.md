# Implementation Plan — Offer Creation Core Logic (#255 + #256)

**Branch:** `255-256-allegro-create-offer-and-builder`
**Scope:** Implement `AllegroMarketplaceAdapter.createOffer` + core `OfferBuilderService` that assembles a `CreateOfferCommand` from an OL variant.

---

## 1. Understand the Task

### Goal
Make it possible to turn an OL variant id + marketplace connection id into a posted Allegro offer, going through two composable pieces:

- **#256** — `OfferBuilderService` (core application): fetches variant + parent product + resolved Allegro category, and produces a platform-neutral `CreateOfferCommand`.
- **#255** — `AllegroMarketplaceAdapter.createOffer` (integration): translates the neutral command into Allegro's POST `/sale/product-offers` API call and returns `CreateOfferResult`.

### Layers
- **#256**: CORE / application layer.
- **#255**: Integration layer (Allegro adapter), pure platform translation.

### Explicit non-goals (deferred)
- Worker job handler + lifecycle orchestration → #257
- REST endpoint → #259
- Seller policy listing endpoint → #260
- Frontend wizard → #261
- Publication follow-up (`PUT /sale/product-offers/{id}/publication`) for `publishImmediately=true` — **NOT** in this PR. Publication semantics need their own spec (Allegro returns an async publication command id); `publishImmediately` is persisted on the record and honored by a later worker handler. For this PR, `publishImmediately` is accepted on the command and threaded to the Allegro payload's `publication.status = 'ACTIVE' | 'INACTIVE'` *if* that field works inline; otherwise we log-warn and treat it as advisory.
  - **Decision up front**: per the [Allegro docs](https://developer.allegro.pl/documentation) `POST /sale/product-offers` accepts `publication.status = 'INACTIVE' | 'ACTIVE'` inline. Default is `INACTIVE`. We pass `'ACTIVE'` iff `publishImmediately: true`. Allegro itself resolves whether the offer actually goes live (may stay in validation). Adapter returns status based on the response's `publication.status` + `validation.errors` array.
- Offer parameter auto-population from variant attributes — **NOT** in this PR. Parameters are required per category, resolved via `fetchCategories`. For the MVP, parameters are only what the caller provides via `overrides.platformParams.parameters`. Offers without required parameters will be rejected by Allegro's validation — that's acceptable and surfaces as domain errors. A later issue can add attribute→parameter auto-mapping.

---

## 2. Research Findings (codebase-grounded)

### #255 — Allegro adapter surface

- `AllegroMarketplaceAdapter` (`libs/integrations/allegro/src/infrastructure/adapters/allegro-marketplace.adapter.ts`) constructor takes `connectionId`, `httpClient: IAllegroHttpClient`, `identifierMapping`, `_connection: Connection`, plus optional customer/command repos.
- HTTP pattern: `this.httpClient.post<TResponse>(path, body)`, `.patch<T>()`, `.put<T>()`.
- Closest reference for a mutation: `updateOfferFields` (lines 657–712) — build partial body, call `patch`, log, rethrow.
- Token refresh is handled by the HTTP client interceptor — adapter code doesn't deal with it.
- Allegro-specific exceptions live in `libs/integrations/allegro/src/domain/exceptions/` (pattern: `allegro-*.exception.ts` or `-.error.ts`). I'll add `allegro-offer-create.exception.ts` for validation / category errors surfaced from Allegro's response.
- Spec pattern: `__tests__/allegro-marketplace.adapter.spec.ts` — mocks `httpClient` (all HTTP methods as jest.fn), constructs adapter directly.
- Existing Allegro API types live in `libs/integrations/allegro/src/domain/types/allegro-api.types.ts` (not `infrastructure/types/` — research had this slightly off). All new types go there.

### #256 — Core builder surface

- `ProductVariantRepositoryPort.findById(id)` returns `ProductVariant | null` — gives `{ id, productId, sku, ean, gtin, attributes, createdAt, updatedAt }`. No price / name / description / images on the variant entity.
- `Product` interface (via `ProductMasterPort.getProduct(productId)`) carries `name, description?, price, currency?, images?`. **This is where name/description/images/price come from.**
- Master catalog connection is read from the marketplace connection's `config.masterCatalogConnectionId` — established pattern in `AutoMatchVariantOffersService` (`libs/core/src/products/application/services/auto-match-variant-offers.service.ts:266`).
- `ProductMasterPort` for a master connection is resolved via `IntegrationsService.getCapabilityAdapter(masterConnectionId, 'ProductMaster')`.
- `ICategoryResolutionService.resolveCategory({ connectionId, barcode?, sourceCategoryIds? })` → `{ allegroCategoryId: string | null, method }`. Already exists and handles the full barcode → mapping → manual fallback chain. **Reuse, don't duplicate.**
- Connection lookup: `ConnectionPort.get(connectionId)` returns connection with `config` blob.
- Service structure: interface in `application/interfaces/*.service.interface.ts`, impl in `application/services/*.service.ts`, types in `application/types/*.types.ts`, Symbol token in module tokens file. See `CategoryResolutionService` for the template.
- No existing `offer-builder*` files — greenfield.

---

## 3. Design

### File map

**Issue #255 (Allegro `createOffer`)**
- `libs/core/src/integrations/domain/types/marketplace-offer-create.types.ts` — **extend** the foundation types with `CreateOfferValidationError` (neutral shape) and add optional `validationErrors?: CreateOfferValidationError[]` to `CreateOfferResult`. Adapters that don't validate leave it empty/omit.
- `libs/integrations/allegro/src/domain/types/allegro-api.types.ts` — add `AllegroProductOfferCreateRequest`, `AllegroProductOfferCreateResponse`, `AllegroOfferPublicationStatusValues` (mirror of Allegro's response enum)
- `libs/integrations/allegro/src/domain/exceptions/allegro-offer-create.exception.ts` — `AllegroOfferCreateException` raised **only on non-2xx** responses; carries structured Allegro errors
- `libs/integrations/allegro/src/infrastructure/adapters/allegro-marketplace.adapter.ts` — implement `createOffer(cmd): Promise<CreateOfferResult>`
- `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-marketplace.adapter.spec.ts` — extend with `createOffer` tests (happy path, `publishImmediately` threading, 2xx-with-validation-errors, 422 error, `idempotencyKey` → `external.id` preference)
- `libs/integrations/allegro/src/index.ts` — re-export new exception type

**Issue #256 (`OfferBuilderService`)**
- `libs/core/src/listings/application/types/offer-builder.types.ts` — `BuildCreateOfferCommandInput`, `OfferBuilderValidationIssue`
- `libs/core/src/listings/application/interfaces/offer-builder.service.interface.ts` — `IOfferBuilderService`
- `libs/core/src/listings/application/services/offer-builder.service.ts` — `OfferBuilderService`
- `libs/core/src/listings/application/services/offer-builder.service.spec.ts`
- `libs/core/src/listings/domain/exceptions/offer-builder-validation.exception.ts` — `OfferBuilderValidationException` (list of field-level issues)
- `libs/core/src/listings/domain/exceptions/master-catalog-connection-not-configured.exception.ts` — thrown when connection lacks `masterCatalogConnectionId`
- `libs/core/src/listings/listings.tokens.ts` — add `OFFER_BUILDER_SERVICE_TOKEN`
- `libs/core/src/listings/listings.module.ts` — register provider (Symbol token only; no string fallback, per #264)
- `libs/core/src/listings/index.ts` — barrel exports

### `createOffer` adapter design (#255)

**Allegro request body shape** (minimal viable for `POST /sale/product-offers`):

```ts
interface AllegroProductOfferCreateRequest {
  name: string;                              // cmd.overrides.title or variant-derived
  category: { id: string };                  // cmd.overrides.categoryId (required)
  sellingMode: {
    price: { amount: string; currency: string };
    format: 'BUY_NOW';
  };
  stock: { available: number; unit: 'UNIT' };
  description?: {
    sections: Array<{
      items: Array<{ type: 'TEXT'; content: string }>;
    }>;
  };
  images?: Array<{ url: string }>;
  parameters?: Array<{ id: string; values?: string[]; valuesIds?: string[] }>;
  delivery?: { shippingRates?: { id: string }; handlingTime?: string };
  afterSalesServices?: {
    impliedWarranty?: { id: string };
    returnPolicy?: { id: string };
    warranty?: { id: string };
  };
  payments?: { invoice?: 'VAT' | 'NO_INVOICE' | 'VAT_MARGIN' };
  publication?: { status: 'INACTIVE' | 'ACTIVE' };
  external?: { id: string };                 // our internal variant id for traceability
}
```

**Platform-specific params read from `cmd.overrides.platformParams` (Allegro keys):**
- `deliveryPolicyId?: string` → `delivery.shippingRates.id`
- `handlingTime?: string` (ISO8601 duration) → `delivery.handlingTime`
- `returnPolicyId?: string` → `afterSalesServices.returnPolicy.id`
- `warrantyId?: string` → `afterSalesServices.warranty.id`
- `impliedWarrantyId?: string` → `afterSalesServices.impliedWarranty.id`
- `invoice?: 'VAT' | 'NO_INVOICE' | 'VAT_MARGIN'` → `payments.invoice`
- `parameters?: Array<{ id, values?, valuesIds? }>` → `parameters` passthrough
- Any unknown keys are ignored (with a debug log).

**Response → `CreateOfferResult` mapping:**
- Allegro response has `id`, `publication.status`, `validation.errors[]`.
- `status: 'active'` if `publication.status === 'ACTIVE'` and no validation errors
- `status: 'validating'` if `validation.errors` is empty but `publication.status === 'INACTIVE'` AND caller asked for publish (validation in progress)
- `status: 'draft'` if `publication.status === 'INACTIVE'` and caller did not ask for publish

**Error mapping:**
- On HTTP 422 (validation errors from Allegro) → throw `AllegroOfferCreateException` carrying the structured `validation.errors` list from the response body so downstream handlers can map into `OfferCreationError[]` on the record.
- On HTTP 400 (malformed request) → same exception with the 400 body; debug-log the request body.
- On HTTP 401/403 → let the existing `allegro-authentication.exception` path handle it (bubbles through the HTTP client).
- No silent swallowing — adapter always throws a domain exception on non-2xx.

### `OfferBuilderService` design (#256)

**Interface:**
```ts
export interface IOfferBuilderService {
  buildCreateOfferCommand(input: BuildCreateOfferCommandInput): Promise<CreateOfferCommand>;
}

export interface BuildCreateOfferCommandInput {
  internalVariantId: string;
  connectionId: string;                    // marketplace connection (e.g. Allegro)
  price?: { amount: number; currency: string };
  stock: number;                           // always required — caller decides inventory
  publishImmediately?: boolean;
  overrides?: CreateOfferOverrides;
  idempotencyKey?: string;
}
```

**Dependencies (constructor-injected via Symbol tokens):**
- `ProductVariantRepositoryPort` (via `PRODUCT_VARIANT_REPOSITORY_TOKEN`) — `findById(variantId)`
- `ConnectionPort` (via the existing symbol token) — `get(connectionId)` to read `config.masterCatalogConnectionId`
- `IntegrationsService` (via `INTEGRATIONS_SERVICE_TOKEN`) — resolves `ProductMasterPort` per master-catalog connection
- `ICategoryResolutionService` (via `CATEGORY_RESOLUTION_SERVICE_TOKEN`) — category resolution

**Flow:**
1. `variant = variantRepo.findById(input.internalVariantId)` → if null, throw `OfferBuilderValidationException({ field: 'internalVariantId', code: 'NOT_FOUND' })`.
2. `connection = connectionPort.get(input.connectionId)` → if null, throw `ConnectionNotFoundException` (existing).
3. `masterConnectionId = connection.config.masterCatalogConnectionId` → if missing, throw `MasterCatalogConnectionNotConfiguredException(input.connectionId)`.
4. `productMaster = integrationsService.getCapabilityAdapter<ProductMasterPort>(masterConnectionId, 'ProductMaster')`.
5. `product = await productMaster.getProduct(variant.productId)` — gives name, description, price (fallback), images.
6. Resolve category: if `overrides.categoryId` is provided, use it as-is; otherwise call `CategoryResolutionService.resolveCategory({ connectionId, barcode: variant.ean ?? variant.gtin })`. If result's `allegroCategoryId` is null, throw `OfferBuilderValidationException({ field: 'overrides.categoryId', code: 'REQUIRED', message: 'No automatic category match; provide overrides.categoryId' })`.
7. Determine `price`: if `input.price` is provided, use it. Else if `product.price` is set and `product.currency` is set → use both. Else throw `OfferBuilderValidationException({ field: 'price.currency', code: 'REQUIRED', message: 'Currency could not be resolved from input or master product; provide input.price explicitly' })`. No hardcoded currency defaults — the builder stays marketplace-neutral.
8. Determine `title`: `overrides.title ?? product.name`.
9. Determine `description`: `overrides.description ?? product.description` (optional).
10. Determine `imageUrls`: `overrides.imageUrls ?? product.images ?? []`.
11. Return `CreateOfferCommand` with `publishImmediately: input.publishImmediately ?? false`, merged overrides, and `platformParams` passed through untouched.

**Validation:** all missing-required checks collected into a single `OfferBuilderValidationException` with an array of `OfferBuilderValidationIssue` so the caller can show all problems at once. This matches the tone of existing domain exceptions in the codebase.

### Which status values does the adapter return vs which does the builder produce?

- Builder produces `CreateOfferCommand` (no status — that's adapter-returned).
- Adapter returns `CreateOfferResult.status: 'draft' | 'validating' | 'active'` per the existing `CreateOfferResultStatusValues` already defined in foundation PR.

---

## 4. Step-by-Step Implementation

### Part A — Issue #256 (OfferBuilderService)

#### A1. Builder types + exceptions
- Create `offer-builder.types.ts` with `BuildCreateOfferCommandInput` and `OfferBuilderValidationIssue`.
- Create `offer-builder-validation.exception.ts` with `OfferBuilderValidationException extends Error` carrying `issues: OfferBuilderValidationIssue[]`.
- Create `master-catalog-connection-not-configured.exception.ts`.

#### A2. Service interface
- `offer-builder.service.interface.ts` exports `IOfferBuilderService` with single `build(input)` method.

#### A3. Service implementation
- `offer-builder.service.ts` — full flow from Section 3. Uses `@openlinker/shared/logging` Logger.
- Error handling: catches nothing it doesn't know how to map; lets downstream exceptions bubble (e.g. `ConnectionNotFoundException` passes through).

#### A4. Token + module wiring
- Add `OFFER_BUILDER_SERVICE_TOKEN = Symbol('OfferBuilderService')` to `listings.tokens.ts`.
- Register in `listings.module.ts`: provider `{ provide: OFFER_BUILDER_SERVICE_TOKEN, useExisting: OfferBuilderService }` and add `OfferBuilderService` to providers. Export token. **No string fallback** (new port per #264).
- Barrel export from `listings/index.ts`: `IOfferBuilderService`, `OfferBuilderService`, types, exceptions, token.

#### A5. Unit tests
File: `offer-builder.service.spec.ts` — mock all four injected ports.
- Happy path: all data resolved from variant + product, category auto-detected
- `overrides.categoryId` present → skips `CategoryResolutionService`
- Variant not found → `OfferBuilderValidationException` with `NOT_FOUND` on `internalVariantId`
- Missing `masterCatalogConnectionId` → `MasterCatalogConnectionNotConfiguredException`
- No EAN/GTIN + no `overrides.categoryId` and resolution returns null → `OfferBuilderValidationException` on `overrides.categoryId`
- Missing price on variant and no `input.price` and `product.price == 0/undefined` → validation issue on `price`
- `platformParams` passed through unchanged

### Part B — Issue #255 (Allegro `createOffer`)

#### B1. API types
Add to `allegro-api.types.ts`:
- `AllegroProductOfferCreateRequest`
- `AllegroProductOfferCreateResponse` — `{ id, name, publication: { status }, validation?: { errors: AllegroValidationError[] } }`
- `AllegroValidationError` — `{ code: string; message: string; details?: string; path?: string; userMessage?: string }`
- `AllegroOfferPublicationStatusValues = ['INACTIVE','ACTIVE','ENDED','ACTIVATING','INACTIVATING'] as const`

#### B2. Domain exception
`allegro-offer-create.exception.ts`:
```ts
export class AllegroOfferCreateException extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errors: AllegroValidationError[],
  ) {
    super(`Allegro rejected offer creation (HTTP ${statusCode}, ${errors.length} errors)`);
    this.name = 'AllegroOfferCreateException';
    Error.captureStackTrace(this, this.constructor);
  }
}
```

#### B3. Adapter implementation
In `allegro-marketplace.adapter.ts`, add `createOffer(cmd: CreateOfferCommand): Promise<CreateOfferResult>`:
1. Build `AllegroProductOfferCreateRequest` body from `cmd`, pulling platform-specific fields from `cmd.overrides.platformParams`.
2. `publication.status = cmd.publishImmediately ? 'ACTIVE' : 'INACTIVE'`.
3. `external.id = cmd.idempotencyKey ?? cmd.internalVariantId` — prefers the per-attempt idempotency key (if set by the caller) for retry uniqueness, falls back to the internal variant id for first-attempt traceability in Allegro's admin UI.
4. Call `this.httpClient.post<AllegroProductOfferCreateResponse>('/sale/product-offers', body)`.
5. Catch HTTP errors: if 400/422 and response has `errors` → throw `AllegroOfferCreateException`. Let other errors bubble (auth, rate-limit exceptions already exist).
6. Map response → `CreateOfferResult`:
   - Any validation errors → throw (even on 2xx Allegro sometimes reports validation issues inline; for safety treat non-empty `validation.errors` as failure)
   - `publication.status === 'ACTIVE'` → `'active'`
   - `publication.status === 'INACTIVE'` and `cmd.publishImmediately === true` → `'validating'`
   - `publication.status === 'INACTIVE'` and `cmd.publishImmediately === false` → `'draft'`
   - Else (ACTIVATING/etc) → `'validating'` (async in progress)
7. Log success with offer id + status at `log` level.

#### B4. Adapter spec
In `allegro-marketplace.adapter.spec.ts`, add `describe('createOffer')` block:
- Happy path (draft): returns `status: 'draft'`, `externalOfferId` populated
- `publishImmediately: true` → request body has `publication.status = 'ACTIVE'`; response with `'ACTIVE'` → `status: 'active'`
- `publishImmediately: true` + response `publication.status = 'INACTIVE'` → `status: 'validating'`
- HTTP 422 with validation errors → throws `AllegroOfferCreateException` with the errors list
- `platformParams` → verify delivery/return/warranty IDs are correctly placed in request body
- `external.id` precedence: `cmd.idempotencyKey ?? cmd.internalVariantId` — both branches covered in tests

#### B5. Barrel export
Add `AllegroOfferCreateException` and `AllegroValidationError` (type) to `libs/integrations/allegro/src/index.ts`.

### Part C — Quality gate
```bash
pnpm lint && pnpm type-check && pnpm test
```

---

## 5. Validation

### Architecture compliance
- ✅ Builder in core application layer; depends only on ports (no infrastructure imports)
- ✅ Adapter in integration layer; uses existing `IAllegroHttpClient` pattern
- ✅ Neutral port command → adapter translates; reused Allegro `platformParams` for platform-specific IDs
- ✅ Domain exceptions live in `domain/exceptions/` (both modules)
- ✅ Repository/port injection via Symbol tokens only (no new string-fallback providers, per #264)
- ✅ No new capability value needed; adapters implement existing `Marketplace` capability
- ✅ Every new source file carries a module-path `@module` header per Engineering Standards §File Headers

### Testing strategy
- Unit tests for both pieces (builder + adapter).
- #256 does change module wiring (new provider + token in `ListingsModule`). The existing `app-boot.int-spec.ts` loads the full app module and will surface any DI misconfiguration — no new int-spec required for this round, but a DI failure there would block merge. Integration tests covering the request path arrive with #257 / #259.

### Risks / open questions
- **Allegro publication semantics** — the Allegro public-API docs state `publication.status = 'ACTIVE'` is accepted inline on POST `/sale/product-offers` but final publication is asynchronous (status transitions through `ACTIVATING`). This plan assumes the inline field is accepted and honored. If sandbox testing during #255 reveals `'ACTIVE'` is rejected inline or silently ignored, fall back to POST-with-INACTIVE + follow-up `PUT /sale/product-offers/{id}/publication` call inside the same adapter method. This is an implementation detail of `createOffer`, not a contract change — `CreateOfferResult` already exposes `'validating'` for async publication.
- **Stock unit handling** — hardcoded to `'UNIT'`. Other units (KG, PIECES) are a future concern.
- **Currency resolution** — builder now throws when currency can't be resolved from input or master product (see Step 7). No platform-specific default. `Connection.config.defaultCurrency` may be added in a follow-up to unblock callers that want a per-connection fallback.

### Commit plan
Two logical commits on this branch:
1. `feat(listings): OfferBuilderService — resolve variant into CreateOfferCommand` (#256)
2. `feat(allegro): implement MarketplacePort.createOffer in AllegroMarketplaceAdapter` (#255)

PR body: `Closes #255`, `Closes #256`.
