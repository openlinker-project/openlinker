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

## Documentation

- [docs/setup-guide.md](./docs/setup-guide.md) — setup guide
- [docs/master-shop-setup-guide.md](./docs/master-shop-setup-guide.md) — full master-shop walkthrough with screenshots
- [`docs/capabilities.md`](../../../docs/capabilities.md) — full capability catalog
- [`libs/integrations/prestashop/README.md`](../prestashop/README.md) — reference adapter (broader capability set)
