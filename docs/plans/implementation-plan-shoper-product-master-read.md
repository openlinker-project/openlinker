# Implementation Plan: Shoper ProductMaster — read products and variants (#3675)

Epic: #3640. Depends on #3639 (PR #3674, already on the epic branch). Evidence: SPIKE-3638 (PR #3645) **plus live probes of the trial shop made for this task** (below; they replace several spike assumptions).

## 1. Understand

**Goal.** `ShoperProductMasterAdapter implements ProductMasterPort` — the read side: `getProduct`, `getProducts`, `getProductVariants`, `searchProducts`, `listExternalIds`. `ProductMaster` joins `supportedCapabilities` together with the adapter.

**Non-goals** (own sub-issues or out of milestone): categories (#3676: `getProductCategories`, `getCategories`), tax rate (#3677), deletion translation to `MasterProductNotFoundError` and sweep proof (#3678), all write methods, `ModifiedProductLister`, `BulkProductReader`, additional images beyond the main one, webhooks.

Because `getProduct` is the port boundary where a deleted product must become `MasterProductNotFoundError`, this task lets a Shoper `404` surface as a plain `ShoperApiError`; the narrow translation is #3678.

## 2. Live findings that shape the design (trial shop, 1 Oct 2026)

| Fact | Consequence |
|---|---|
| List envelope `{count: "36", pages: 12, page: 1, list: [...]}`; **numbers are strings** | One typed envelope; every numeric field parsed explicitly, never trusted as `number`. |
| Paging is **page-based** (`page`, `limit`); default order is ascending `product_id` | `listExternalIds({limit, offset})` maps `offset` to a page; a non-page-aligned offset is **refused**, not shifted. |
| **`limit` max is 50; above it Shoper silently falls back to 10/page** (`limit=51`, `500` -> 10) | The adapter never sends > 50 and refuses a larger request (`exceedsAdapterPageSize`) - a silent clamp would make `readPagedIds` believe a short page is the end of the catalogue. |
| Bare `order=product_id` sorts **descending**; `order=product_id ASC` ascending | Always send an explicit direction. |
| `GET /products` rows embed `stock` (the default variant), `options`, `main_image`, `categories`, `tax_id`, `translations` | `getProducts` needs no per-product follow-up call. |
| `GET /product-stocks?filters[product_id]=93` works and returns that product's variants | `getProductVariants` = one filtered request. |
| `product-stocks` row: `stock_id`, `product_id`, `price`, `stock`, `weight`, `active`, `default`, `code`, `ean`, `options` (all strings) | Variant grain confirmed (M1). |
| Name/description live in `translations.<lang>`; `isdefault` is `"0"` on **both** languages | The default language comes from `GET /application-config` -> `default_language_name` (`pl_PL`), not from `isdefault`. Fallback: first translation with a name. |
| `application-config` also carries `default_currency_name` (`PLN`) and `locale_default_weight` (`KILOGRAM`) | Currency and weight unit are read from it once per adapter instance. |
| Public image URL: `https://<host>/userdata/public/gfx/<unic_name>.<extension>` (HTTP 200, `image/png`) | `images` = the main image URL built from `main_image`. |
| **No multi-variant product exists on the trial shop**; 35 of 36 variants have an empty EAN | Multi-variant mapping is covered by fixtures built from the desk docs and is flagged as not live-verified. |

## 3. Design

**Variant identity.** Every Shoper product owns at least one `product-stocks` row with a real `stock_id`, so **no synthetic variant is minted** (unlike PrestaShop/WooCommerce, which have no variant id for a simple product). A variant's external id is `stock_id`, mapped with `CORE_ENTITY_TYPE.ProductVariant` and the product as parent context. A product that later gains options keeps its existing variant's identity.

**Product id handling** follows `WooCommerceProductMasterAdapter`: `getProduct(productId)` takes the **internal** id, resolves the external one through `identifierMapping.getExternalIds`, fetches, maps, and returns with the internal id; `getProducts` uses `batchGetOrCreateInternalIds`; `listExternalIds` returns external ids.

**Mapper** (`shoper-product.mapper.ts`, pure functions, no I/O): `mapShoperProduct(raw, ctx)` and `mapShoperStock(raw, productId)`; `ctx` carries `{ baseUrl host, language, currency }`. Price = the default stock's `price`; `sku` = `code` (null when empty); `ean` = stock `ean` (null when empty, never `""`); `weight` in kg from `weight`, `weightGrams` derived; `attributes` from the stock's `options` (null when none). `taxRate` is not set here (#3677). Dimensions are left unset: unit unconfirmed and the shop stores `0.0000` for unset.

**Shop context** (language, currency) is read once per adapter instance from `application-config` and memoised as a promise (so concurrent calls share one request, and a failure is not cached).

**HTTP.** `ShoperHttpClient.get` gains query-parameter support (typed, URL-encoded; `filters[...]` keys kept bracketed); a shared `fetchShoperPage<T>` helper owns the envelope parsing. No retries, no invented rate limit (spike C6).

**Wiring.** `application/shoper-adapter.factory.ts` (per connection: parse `baseUrl`, resolve `ShoperCredentials`, build the client over `host.http.forConnection(connection)`, construct the adapter) and `createCapabilityAdapter` dispatches `{ ProductMaster }`. `supportedCapabilities: ['ProductMaster']`.

**Write methods** (`createProduct`, `updateProduct`, `deleteProduct`, `upsertProductVariant`, `assignCategories`) throw `ShoperNotSupportedException` naming the method. `getProductCategories` / `getCategories` are #3676: until then `getProductCategories` throws the same not-supported error rather than returning `[]` (an empty list would read as "this product has no categories").

## 4. Steps

1. `domain/exceptions/shoper-not-supported.exception.ts`; `domain/types/shoper-api.types.ts` (envelope, product, stock, config shapes - all-string numerics).
2. `infrastructure/http`: query params on `get`; `fetchShoperPage` + `ShoperPageEnvelope` parsing; tests.
3. `infrastructure/mappers/shoper-product.mapper.ts` + tests (single variant, multi variant from desk-doc fixture, empty EAN/code, missing translation, numeric-string parsing, image URL).
4. `infrastructure/adapters/product-master/shoper-product-master.adapter.ts` + shop-context reader + tests (each read method, paging maths, refusal cases, language fallback).
5. `application/shoper-adapter.factory.ts` (+ interface); `shoper-plugin.ts`: manifest + dispatch table; plugin spec updated (`supportedCapabilities` is no longer empty).
6. README/CHANGELOG-style note in the package README (capability list, live findings, known gaps).
7. Gate: `pnpm check:invariants`, lint, type-check for the package and both apps; fixtures sanitised from the live samples.

## 5. Risks and stated gaps

- Multi-variant mapping and `options` -> `attributes` shape are **not live-verified** (no such product on the trial shop). Recorded in the PR; fixtures from the Postman schema.
- Only the main image is exposed; the rest need `product-images` (one extra call per product) and are a follow-up.
- `price` semantics (gross vs net) for `price_type` are assumed gross-as-catalogue-price, consistent with the spike's order test (O4); to be confirmed with #3677's tax work.
- Description is passed through as stored HTML; sanitisation belongs to the inbound boundary (`sanitizeStoredHtml`), not the adapter.
