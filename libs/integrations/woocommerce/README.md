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
| `OrderProcessorManager` | Create orders in WooCommerce; supports `OrderFulfillmentUpdater`, `FulfillmentStatusReader`, `DestinationOptionsReader` |
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
  "baseUrl": "https://myshop.example.com",
  "version": "wc/v3"
}
```

## Documentation

- [docs/setup-guide.md](./docs/setup-guide.md) — setup guide
- [docs/master-shop-setup-guide.md](./docs/master-shop-setup-guide.md) — full master-shop walkthrough with screenshots
- [`docs/capabilities.md`](../../../docs/capabilities.md) — full capability catalog
- [`libs/integrations/prestashop/README.md`](../prestashop/README.md) — reference adapter (broader capability set)
