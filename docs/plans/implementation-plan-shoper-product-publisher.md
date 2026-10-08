# Implementation plan - Shoper: ProductPublisher (#3712)

Layer: Integration (adapter + wiring). No CORE change. Branch `3712-shoper-product-publisher`, stacked on `3644-shoper-webhooks` (#3716).

Non-goals: category provisioning (#3713; a publish with no category is refused until it lands), global-attribute linking, multi-variant products, AI descriptions. Images were first left out and added in a follow-up commit of the same PR (see § Images).

## Live verification (trial shop, 2026-10-07)

Shop languages `pl_PL` + `en_US`; API root `/webapi/rest`; Bearer token. Test products were created and deleted again (shop back at 36 products).

| Question | Observed |
|---|---|
| Create | `POST /products` answers the bare product id (`130`). Required: `translations.<lang>.name`, `category_id`, `stock.price`. `tax_id` is optional (defaults to `1` = 23%). `stock.weight` optional (0). |
| Multi-category | `category_id` is the main category and is REQUIRED (also with `categories`); `categories: [..]` places the product in several. `category_id: 0` / `null` -> 400 `Key 'category_id' is required`. Unknown category -> 400 `Category '99999' does not exist`. |
| Update | `PUT /products/:id` accepts a PARTIAL body (translations, `stock` price/stock, `categories`, `tax_id`); answers `1`. Unknown id -> 404 `Resource not found` (Shoper envelope). |
| Status | `translations.<lang>.active` is the visibility: `0` draft, default is `0` when omitted. `stock.active` is `1`. |
| Validation | Duplicate `code` -> 400 `Wartość 'OL-TEST-1' już istnieje`. Invalid EAN (check digit) -> 400 `Wymagany jest poprawny kod kreskowy`. Messages are Polish and name the field. |
| Variants | Model is a default `product-stocks` row (`options: []`) plus one `extended=1` row per variant with `options {"<option_id>":"<ovalue_id>"}`; `POST /product-stocks {product_id, options, price, stock, code, ean, extended:1}` works and the product's `options` lists the stock ids. It needs OPTION and OPTION-VALUE ids that already exist; creating them was not verified. A new variant stock is `active: 0` until `PUT /product-stocks/:id {active:1}`. |
| Description | Shoper sanitises server-side. Kept: h1-h4, p, b/strong, i/em, br, hr, s (-> styled span), u (-> styled span), sub/sup, code, pre, blockquote, ul/ol/li, table/thead/tbody/tr/th/td, div, span, `class`, `style` (colours normalised), `a[href,target]`, img[src,alt], video. Stripped: `script`, `iframe src`, `on*` handlers, `javascript:` hrefs. No size limit found. |

## Decisions

1. **Single-variant only.** `variantGroup` -> `ProductPublishRejectedException` (status 0, code `shoper_variants_unsupported`) with an actionable message. Reason: variants need pre-existing option ids and the default-plus-extended stock model; the issue allows refusing when the live check does not show it is expressible without side effects on shop configuration.
2. **A create needs a category.** `destinationCategoryIds` empty on create -> rejected (`shoper_category_required`) naming #3713 / the picker. On update an empty list leaves categories alone.
3. **Never default silently.** No `tax_id` is sent on create (shop default applies, documented) and never on update; the command carries no Shoper tax class.
4. **Unsupported fields are reported as `warnings`**, not dropped silently: tags, parameters, sale price, dimensions (images, see § Images).
5. Language key = `ShoperShopContextProvider` `language` (default shop language, e.g. `pl_PL`); weight is sent in the shop's unit.
6. Errors: `ShoperApiError` 404 (`isResourceNotFound`) on upsert -> `ProductPublishTargetNotFoundException`; 4xx (not 408/429) -> `ProductPublishRejectedException` carrying Shoper's own description; everything else propagates for the retry classifier.

## Steps

1. `product-publisher/shoper-product-publisher.adapter.ts` - `ShoperProductPublisherAdapter implements ShopProductManagerPort`: `publishProduct`, `getDescriptionFormat`.
2. `product-publisher/shoper-description-format.ts` - declared grammar from the observed table (flat allowlist, `href`/`target` on `a`, `src`/`alt` on `img`, no content model).
3. `mappers/shoper-product-write.mapper.ts` - pure `buildShoperProductBody(cmd, ctx)` + `collectUnsupportedWarnings(cmd, ctx)`.
4. `domain/types/shoper-product-write.types.ts` - request body types.
5. `application/shoper-adapter.factory.ts` - `productPublisher` in `ShoperAdapters`.
6. `shoper-plugin.ts` - `ProductPublisher` in `supportedCapabilities` + dispatch entry, together with the adapter. Not in `defaultEnabledCapabilities` (writes to the shop are opt-in).
7. Specs: create, update, status mapping, refusals (variantGroup, no category, no name), Shoper 400 -> rejected, 404 -> target-not-found, warnings, plugin dispatch.
8. Docs: one bullet in `docs/architecture-overview.md` (Listings) recording the live findings.

## Risks / open

- Variants stay unsupported; a follow-up needs option/option-value provisioning verified live.
- Per-connection `weight`/`dimensions` units assumed to match the shop's configured unit.

## Images (live-verified 2026-10-07)

| Question | Observed |
|---|---|
| Upload | `POST /product-images {product_id, url}`: Shoper fetches the image itself. The first image of a product becomes the main one (`main: 1`), the next get the next `order`. `content` (base64) is the alternative (`Nie można zdekodować zawartości pliku` for a bad payload). `name` is the alternative text. |
| Unfetchable URL | `localhost` / an internal host -> 400 `Url '...' is not valid`; a URL that 404s -> 500 `Operation Failed`. |
| Listing a product's images | `filters[product_id]=` on `/product-images` answers 500; the JSON `filters={...}` form works. Not used: `GET /products/:id` carries `main_image`, which is `null` for a product with no image. |

Decisions: after the product exists, `content.imageUrls` are sent in order (at most 10, de-duplicated, absolute http(s) only; the title is the alternative text). A product that already has images keeps them (a re-publish would otherwise append the same pictures again and Shoper cannot say which image came from which URL). **Every image failure is a warning and never an error**: the caller persists the product mapping only after `publishProduct` returns, so a throw here would make the job retry into a second product. Consequence for a dev stack: images served from an internal host (a Docker PrestaShop) cannot be fetched by Shoper and come back as warnings; the shop must serve them from a public URL.

## Review follow-ups

- A price in another currency than the shop's is refused (`shoper_currency_mismatch`), not written unconverted.
- A create answered without an id is refused (terminal), because the product may exist and a retry would duplicate it.
- Known limit: a partial image upload leaves a main image, so a re-publish does not add the missing ones.
- Merge order: do not merge before #3719 (`CategoryProvisioner`); until then every create without a category is refused.
