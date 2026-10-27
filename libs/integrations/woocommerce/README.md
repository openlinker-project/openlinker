# @openlinker/integrations-woocommerce

WooCommerce REST API v3 adapter for OpenLinker — product catalog, inventory, and order management.

## Adapter

| Property | Value |
|---|---|
| **Adapter key** | `woocommerce.restapi.v3` |
| **Platform type** | `woocommerce` |
| **Package** | `@openlinker/integrations-woocommerce` |

## Capabilities

| Capability | Notes |
|---|---|
| `ProductMaster` | Read/write product catalog and variants |
| `InventoryMaster` | Read and adjust stock levels |
| `OrderSource` | Cursor-based order feed + hydrate full order |
| `OrderProcessorManager` | Create orders in WooCommerce; supports `OrderFulfillmentUpdater` |
| `ProductPublisher` | Publish product content changes back to WooCommerce |
| `CategoryProvisioner` | Create / ensure a category exists in WooCommerce before publishing |
| `ShopCategoryBrowser` | Browse the store's existing category tree (drill-down by parent) so an operator can pick a placement |
| `ShopAttributeReader` | Read the store's global product attributes (`pa_*`) + their predefined terms so an operator can pick a structured attribute; linked on publish |

See [`docs/capabilities.md`](../../../docs/capabilities.md) for the full sub-capability catalog.

The order processor also declares `OrderCreateStockEffect`. WooCommerce lowers stock only when an order reaches a
paid-like status (`processing` / `completed` / `on-hold`, or `set_paid`), only with `woocommerce_manage_stock = yes`,
and only for products that manage stock - so a `pending` order OpenLinker creates for an unpaid sale lowers nothing.
Because that is a fact about the order rather than the store, the adapter answers from the created order itself:
`true` only when every line in the `POST /orders` response carries the `_reduced_stock` item meta WooCommerce writes
when it takes a line out of stock. Anything else - and an adapter that created no order, since core also asks after
a skipped create - answers `false`, keeping the order's holds until dispatch.

`ShopCategoryBrowser`, `ShopAttributeReader`, and `CategoryProvisioner` are
sub-capabilities of `ShopProductManagerPort` implemented on the same
`ProductPublisher` adapter instance; call sites narrow with
`isShopCategoryBrowser` / `isShopAttributeReader` / `isCategoryProvisioner`.
`ShopCategoryBrowser` reads `GET /wp-json/wc/v3/products/categories` scoped by
`parent` (root when omitted), paged at the WooCommerce maximum `per_page=100`,
and returns neutral `ShopCategory` nodes (`{ id, name, parentId }`) — every node
is a valid placement target (no leaf gate), unlike a marketplace taxonomy.

### Global vs custom attributes

`ShopAttributeReader` reads `GET /wp-json/wc/v3/products/attributes` and
`GET /wp-json/wc/v3/products/attributes/{id}/terms` (paged at `per_page=100`),
returning neutral `ShopAttribute` / `ShopAttributeTerm` nodes (`{ id, name, slug }`).
WooCommerce has two kinds of product attribute:

- **Global** (`pa_*` taxonomies with predefined terms) — store-wide, reusable,
  and the only kind that powers storefront filtering. On publish, a neutral
  `OfferParameter` carrying `valuesIds` (term ids) plus a numeric `id` (the
  global-attribute id) is emitted as `{ id, options: <term names>, visible }`,
  which links the product to that attribute's existing terms.
- **Custom** (free-text, per product) — the fallback for one-off attributes.
  A parameter with no global linkage is emitted as `{ name, options, visible }`.
  A custom parameter with no free-text values (or a global one with no chosen
  terms) is dropped rather than written as an empty, valueless attribute row.

## Credentials & config

**Credentials**:
```json
{
  "consumerKey": "ck_...",
  "consumerSecret": "cs_..."
}
```

Generate at **WooCommerce → Settings → Advanced → REST API**.

**Config**:
```json
{
  "siteUrl": "https://myshop.example.com"
}
```

| Field | Values | Notes |
|---|---|---|
| `siteUrl` | HTTPS URL (**required**) | The store's base URL. Must include the `https://` protocol (Basic Auth would leak credentials over plain http); the adapter appends the `wc/v3` REST paths itself |
| `inventory` | Object (optional) | Inventory tuning: `unmanagedStockQuantity` (integer >= 0, default 1000) - the quantity reported for in-stock products with stock management disabled |
| `orders` | Object (optional) | Order-ingestion tuning: `initialSyncFrom` (parseable date string, e.g. `"2024-01-01"`) - the earliest order date picked up by the first sync |

## Product publish field mapping

`ProductPublisher.publishProduct` maps the neutral `PublishProductCommand` onto the
WooCommerce `products` resource. Each field is sent only when a value is present;
an absent master/operator value **omits** the WooCommerce key (never sends an
empty string or zero), so an upsert never clears a field the operator did not touch.

| Neutral field | Source | WooCommerce field |
|---|---|---|
| `sku` | master variant | `sku` |
| `barcode` (GTIN/EAN) | master variant (`gtin` ?? `ean`) | `global_unique_id` (WooCommerce 9.2+) |
| `weight` | master variant (`weight`) ?? product | `weight` (string) |
| `price` | operator override ?? master | `regular_price` (converted to the store's basis - see Prices and tax below) |
| `stock` | operator | `stock_quantity` (+ `manage_stock: true`) |
| `status` | operator | `status` (`publish` / `draft`) |
| `content.title` | operator ?? master | `name` |
| `content.description` | operator ?? master | `description` |
| `content.shortDescription` | operator | `short_description` |
| `content.tags` | operator | `tags` (`[{ name }]`, created on demand) |
| `content.imageUrls` | operator ?? master | `images` (**create only** — see Publish correctness below) |
| `content.seo.slug` | operator | `slug` (suffixed per-item — see below) |
| `content.seo.title` / `content.seo.description` | operator | `meta_data` (see SEO below) |
| `commerce.salePrice.amount` | operator | `sale_price` (store currency applies; amount only; converted like `price`) |
| `commerce.saleStartsAt` / `saleEndsAt` | operator (UTC ISO-8601) | `date_on_sale_from_gmt` / `date_on_sale_to_gmt` (UTC; the site-local `date_on_sale_from`/`_to` are deliberately not used so the store timezone can't shift the window) |
| `commerce.dimensions` | operator | `dimensions.{length,width,height}` (strings) |
| `commerce.taxClass` | operator | `tax_class` |
| `commerce.taxStatus` | operator | `tax_status` (`taxable` / `shipping` / `none`) |
| `destinationCategoryIds` | resolved upstream | `categories` |
| `parameters` | projected attributes | `attributes` (custom, per-product) |

The table above describes a **single-variant / simple** product — one OL
variant, one WooCommerce `type:'simple'` product. A **multi-variant** product
publishes differently; see the next section.

## Prices and tax (#3737, ADR-077)

Every price inside OpenLinker is the price **with VAT** - what a buyer pays -
and excludes promotions. A WooCommerce store keeps whatever its own setting
**WooCommerce → Settings → Tax → Prices entered with tax** says. This adapter
converts at the boundary, in both directions, with the store's own rate:

- **Reading (product master)**: OpenLinker reads `regular_price` (never the
  sale-inclusive `price`). If the store has taxes switched off, enters prices
  with tax, or the product is `tax_status` `none` / `shipping`, the figure is
  used as is. Otherwise it is grossed up with the rate the store's tax table
  gives the product's tax class in the store's base country, rounded to the
  store's price decimals. A variation with tax class `parent` uses its parent's
  class.
- **Writing (publisher and price updates)**: the same rule in reverse. Into a
  store that enters prices without tax, `regular_price` and `sale_price` are
  written as net, to 6 decimals, so WooCommerce's own gross lands back on the
  exact OpenLinker price.
- When no single rate applies (no rule for the class and the store's country,
  or the store names no base country), a read reports **no price** - never a
  net one - and a write is refused with `TAX_RATE_UNRESOLVED`. A failed request
  to the store is retried instead, so a network error never blanks a price.

## Variable products / variations (#1836)

A multi-variant OL product (`getVariantsByProductId(...).length > 1`) publishes
as one shared WooCommerce `type:'variable'` **parent** product plus one
`products/{parentId}/variations` entry per sibling — not N unrelated `simple`
products. A single-variant / simple product is unaffected; it keeps the exact
table above.

`ProductPublishBuilderService` populates `PublishProductCommand.variantGroup`
whenever the variant has siblings, carrying: an opaque `groupId` (the OL
product id), this variant's own distinguishing attribute values, and the
**union** of every sibling's values per attribute name
(`groupAttributeValues`) — the parent's variation-flagged attributes must
declare the full option set up front, which no single sibling can supply
alone. `ProductPublishExecutionService` additionally resolves the parent's own
`ShopProduct` mapping (keyed on `groupId`, not the variant id) and threads it
back onto `variantGroup.externalParentProductId` so the adapter knows whether
to create or reuse the parent.

**Wire mapping:**

| Field | Lives on | WooCommerce shape |
|---|---|---|
| Content, category, SEO, plain category-parameter attributes | Parent (`type:'variable'`) | Same fields as the simple-product table above |
| Distinguishing attributes (`groupAttributeValues`) | Parent | `attributes[]` entries with `variation: true` and `options` = every sibling's value for that axis (custom, not global `pa_*` — `ProductVariant.attributes` are freeform names with no WC global-attribute id) |
| `price` / `sku` / `stock` / `barcode` / `weight` / commerce fields | Each sibling's variation | Same field names, on `products/{parentId}/variations[/{variationId}]` |
| This variant's own attribute values | Each sibling's variation | `attributes[]` entries with a singular `option` (not the parent's plural `options`) |
| `content.seo.slug` | Parent | `slug`, suffixed with the **group id** (not the variant id) — every sibling resolves to the same stable slug regardless of which one triggers the parent upsert |
| Image | Each sibling's variation | Single `image: { src }` (create-only, same re-import-churn guard as the simple-product path) |

**Mapping model.** No schema change — the existing variant-keyed `ShopProduct`
identifier mapping already supports a second row keyed on the *product's*
internal id (distinctly prefixed `ol_product_*` vs `ol_variant_*`, so no
collision with the variant's own mapping row). The parent mapping is written
the first time it resolves, with the same concurrency-safe swallow-or-conflict
handling (#1845) as the variant's own mapping.

**Known limitations (MVP, see ADR-024):** the parent's shared fields reflect
whichever sibling published most recently (no merge across concurrent
publishes); a 404 on the *parent* upsert (parent deleted shop-side) does not
yet auto-heal the way a stale *variation* target does (see Publish correctness
below) — it propagates for investigation/retry rather than silently
mis-linking.

### SEO title & description

Core WooCommerce has **no native product SEO title/description field** — those are
owned by whichever SEO plugin the store runs, stored as post meta. The adapter
therefore maps `content.seo.title` / `content.seo.description` to `meta_data`,
writing the keys for **both** dominant plugins so whichever is active picks them up:

- **Yoast SEO**: `_yoast_wpseo_title`, `_yoast_wpseo_metadesc`
- **Rank Math**: `rank_math_title`, `rank_math_description`

If neither plugin is installed, the rows are inert post meta (no effect). This
replaces the previous behaviour where `seo.title` / `seo.description` were accepted
and silently discarded (only `seo.slug` mapped, to the native `slug`).

## Publish correctness

The publisher/offer-manager enforce these correctness rules (#1846):

- **Stale-mapping recovery on publish.** An upsert (`PUT /products/{id}`) that
  404s means the mapped product was deleted shop-side. The adapter raises the
  neutral `ProductPublishTargetNotFoundException`; the core execution service
  deletes the stale `ShopProduct` identifier mapping and re-publishes as a
  create, so the variant recovers instead of failing permanently. For a
  grouped (multi-variant, #1836) publish this recovery applies to a stale
  **variation** target the same way; a stale **parent** target does not yet
  auto-heal (documented limitation, ADR-024).
- **Stale-mapping cleanup on stock write-back.** A 404 from the stock
  `PUT /products/{id}` deletes the stale `ShopProduct` mapping (the stock value
  for that run is not propagated); the next publish re-creates the product and
  writes a fresh mapping. Previously the write was silently skipped forever.
- **Transient errors are retried, not failed.** `429 Too Many Requests` and
  `408 Request Timeout` propagate (the worker retries the whole job) instead of
  being recorded as a terminal `business_failure`. Other 4xx remain terminal
  rejections. (The HTTP client also retries `429`/`5xx` internally first.)
- **Dictionary-typed parameters.** WooCommerce custom attributes carry only
  free-text option strings. A parameter that resolves to no free-text `values`
  (dictionary-only `valuesIds`, or empty) is **dropped**, not written as an empty
  `options: []` attribute (which was silent data loss).
- **Category provisioning.** The category search requests `per_page=100` (WC max)
  so an exact match beyond the default 10 fuzzy results is not missed and
  re-created. A concurrent `term_exists` rejection is recovered by re-resolving
  and reusing the racing winner's node — no duplicate categories.
- **Per-item slug.** A supplied `seo.slug` is suffixed with the item's stable
  internal variant id, so sibling variants published in bulk get distinct,
  deterministic slugs instead of WooCommerce silently auto-suffixing a shared
  slug (`-2`/`-3`). The variant id (not the SKU) is used because it is immutable
  for the life of the variant - a SKU can be gained after the first publish,
  which would drift the WC permalink on a later upsert.
- **Images (create only).** `images` are sent only on create. WooCommerce
  sideloads media by `src` and re-imports it on every update, so re-sending on
  upsert churns/duplicates media; image updates on upsert need media-id tracking
  and are a deferred enhancement.

## Documentation

- [docs/setup-guide.md](./docs/setup-guide.md) — setup guide
- [docs/master-shop-setup-guide.md](./docs/master-shop-setup-guide.md) — full master-shop walkthrough with screenshots
- [`docs/capabilities.md`](../../../docs/capabilities.md) — full capability catalog
- [`libs/integrations/prestashop/README.md`](../prestashop/README.md) — reference adapter (broader capability set)
