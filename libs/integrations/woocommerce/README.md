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

See [`docs/capabilities.md`](../../../docs/capabilities.md) for the full sub-capability catalog.

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
| `price` | operator override ?? master | `regular_price` |
| `stock` | operator | `stock_quantity` (+ `manage_stock: true`) |
| `status` | operator | `status` (`publish` / `draft`) |
| `content.title` | operator ?? master | `name` |
| `content.description` | operator ?? master | `description` |
| `content.shortDescription` | operator | `short_description` |
| `content.tags` | operator | `tags` (`[{ name }]`, created on demand) |
| `content.imageUrls` | operator ?? master | `images` (**create only** — see Publish correctness below) |
| `content.seo.slug` | operator | `slug` (suffixed per-item — see below) |
| `content.seo.title` / `content.seo.description` | operator | `meta_data` (see SEO below) |
| `commerce.salePrice.amount` | operator | `sale_price` (store currency applies; amount only) |
| `commerce.saleStartsAt` / `saleEndsAt` | operator (UTC ISO-8601) | `date_on_sale_from_gmt` / `date_on_sale_to_gmt` (UTC; the site-local `date_on_sale_from`/`_to` are deliberately not used so the store timezone can't shift the window) |
| `commerce.dimensions` | operator | `dimensions.{length,width,height}` (strings) |
| `commerce.taxClass` | operator | `tax_class` |
| `commerce.taxStatus` | operator | `tax_status` (`taxable` / `shipping` / `none`) |
| `destinationCategoryIds` | resolved upstream | `categories` |
| `parameters` | projected attributes | `attributes` (custom, per-product) |

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
  create, so the variant recovers instead of failing permanently.
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
