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
| `content.imageUrls` | operator ?? master | `images` |
| `content.seo.slug` | operator | `slug` |
| `content.seo.title` / `content.seo.description` | operator | `meta_data` (see SEO below) |
| `commerce.salePrice.amount` | operator | `sale_price` (store currency applies; amount only) |
| `commerce.saleStartsAt` / `saleEndsAt` | operator | `date_on_sale_from` / `date_on_sale_to` |
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

## Documentation

- [docs/setup-guide.md](./docs/setup-guide.md) — setup guide
- [docs/master-shop-setup-guide.md](./docs/master-shop-setup-guide.md) — full master-shop walkthrough with screenshots
- [`docs/capabilities.md`](../../../docs/capabilities.md) — full capability catalog
- [`libs/integrations/prestashop/README.md`](../prestashop/README.md) — reference adapter (broader capability set)
