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

- [`docs/capabilities.md`](../../../docs/capabilities.md) — full capability catalog
- [`libs/integrations/prestashop/README.md`](../prestashop/README.md) — reference adapter (broader capability set)
