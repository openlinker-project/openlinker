# @openlinker/integrations-prestashop

PrestaShop WebService v1 adapter for OpenLinker.

## This is the OpenLinker reference adapter

If you're here to **build a new integration** (Shopify, WooCommerce,
BigCommerce, …), start by copying this package's layout — it implements
the broadest set of capabilities (`ProductMaster`, `InventoryMaster`,
`OrderSource`, `OrderProcessorManager`) and registers the full
side-service set (connection tester, webhook provisioner, two shape
validators). The walkthrough lives at
[`docs/plugin-author-guide.md`](../../../docs/plugin-author-guide.md) —
read it alongside this code, not before.

Two pointers for special cases this package doesn't demonstrate:

- **OAuth + token refresh** — see
  [`libs/integrations/allegro/`](../allegro/). Adds token-state
  sharing across HTTP clients, refresh-on-401 retry, and a
  plugin-owned migration.
- **Stateless port-router** (single dynamic-module shape, no
  per-connection adapter) — see
  [`libs/integrations/ai/`](../ai/). Reference only if your platform
  is provider-switched rather than per-connection.

## What this package contains

| Capability                | Adapter file                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProductMaster`           | [`infrastructure/adapters/prestashop-product-master.adapter.ts`](./src/infrastructure/adapters/prestashop-product-master.adapter.ts)                                                       |
| `InventoryMaster`         | [`infrastructure/adapters/prestashop-inventory-master.adapter.ts`](./src/infrastructure/adapters/prestashop-inventory-master.adapter.ts)                                                   |
| `OrderSource`             | [`infrastructure/adapters/prestashop-order-source.adapter.ts`](./src/infrastructure/adapters/prestashop-order-source.adapter.ts)                                                           |
| `OrderProcessorManager`   | [`infrastructure/adapters/prestashop-order-processor-manager.adapter.ts`](./src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts)                                     |

Plus the registered side services:

- Connection tester — [`prestashop-connection-tester.adapter.ts`](./src/infrastructure/adapters/prestashop-connection-tester.adapter.ts)
- Webhook provisioner — [`prestashop-webhook-provisioning.adapter.ts`](./src/infrastructure/adapters/prestashop-webhook-provisioning.adapter.ts)
- Connection-config shape validator — [`prestashop-connection-config-shape-validator.adapter.ts`](./src/infrastructure/adapters/prestashop-connection-config-shape-validator.adapter.ts)
- Credentials shape validator — [`prestashop-connection-credentials-shape-validator.adapter.ts`](./src/infrastructure/adapters/prestashop-connection-credentials-shape-validator.adapter.ts)

The plugin descriptor and NestJS module are at
[`src/prestashop-plugin.ts`](./src/prestashop-plugin.ts) and
[`src/prestashop-integration.module.ts`](./src/prestashop-integration.module.ts)
respectively. Both are referenced in the
[plugin author guide](../../../docs/plugin-author-guide.md) as the
canonical examples.

## Operator / runtime docs

For setting up a PrestaShop connection in production (PHP module
install, WebService API key creation, webhook configuration), see the
operator-facing docs:

- [`docs/prestashop-module-testing-guide.md`](../../../docs/prestashop-module-testing-guide.md)
  — testing the OpenLinker PHP module against a live PrestaShop.
- [`docs/connections-and-adapter-resolution.md`](../../../docs/connections-and-adapter-resolution.md)
  — how a connection resolves to this adapter at request time.
