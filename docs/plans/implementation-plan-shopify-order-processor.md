# Implementation Plan: Shopify as order destination (#3978)

Stacked on #3977 (OrderSource), #3976, #3975 and #3974 (foundation, PR #4042).
Branch `3978-shopify-order-processor`.

## 1. Task

Shopify as an order destination (role D): a marketplace order (Allegro, Erli) is
created in the merchant's store at the price the buyer paid, with addresses,
pickup point and payment state; dispatch and cancellation are written back.
Integration layer only; no core change.

### Non-goals

- Creating or linking a Shopify customer (Shopify links by email itself).
- Presentment currencies: an order in another currency is refused.
- Passing on a payment that arrives at the source after the create (#3963).
- Retrying a destination create that failed for good (#3984).

## 2. Research

Prototype (`origin/3928-shopify-prototype`) re-read: order processor adapter and
order input mapper. The prototype had its own copy of the fulfil/cancel logic;
#3977 moved that into `ShopifyOrderStatusWriteback`, which this adapter reuses.

### Shopify API (2026-10), checked against the reference

| Point | Reference says | Effect |
|---|---|---|
| `OrderCreateOrderInput` | `lineItems`, `shippingLines`, addresses (`countryCode`, `zip`), `email`, `phone`, `currency`, `taxesIncluded`, `financialStatus`, `transactions`, `sourceIdentifier`, `tags`, `note`, `customAttributes`; `taxLines` on the order OR the lines, not both | tax lines on lines and shipping only |
| `OrderCreateLineItemInput` | `requiresShipping` defaults to **false** | a custom line sets it to `true` |
| `OrderCreateOptionsInput` | `inventoryBehaviour` defaults to `BYPASS`; `DECREMENT_OBEYING_POLICY` exists | sent explicitly |
| Idempotency | `orderCreate` is not on the `@idempotent` list | own `source_identifier:` lookup before the create |
| `orders` query | `source_identifier` is a supported filter | dedup lookup |
| Scope | `write_orders`, offline token only | already required |
| Rate limit | 5 created orders per minute on a development store | noted for E2E |
| Options lists | no API lists manual payment methods; carriers are delivery-profile methods | reuse `ShopifyMappingOptionsReader` |

## 3. Design

- `infrastructure/adapters/order-processor/shopify-order-processor.adapter.ts`:
  `OrderProcessorManagerPort`, `OrderStatusWriteback`, `OrderFulfillmentUpdater`,
  `DestinationOptionsReader`, `OrderCreateStockEffect`.
- `infrastructure/mappers/shopify-order-input.mapper.ts`: `OrderCreate` -> variables.
- `readers/shopify-order.queries.ts`: `ORDER_BY_SOURCE_IDENTIFIER_QUERY`, `ORDER_CREATE_MUTATION`.
- `readers/shopify-external-id.ts`: `findShopifyExternalId` (null instead of a throw).
- Factory `createOrderProcessor`; plugin dispatch + manifest `OrderProcessorManager`
  (not default-enabled); `IMappingConfigService` passed in through
  `CreateShopifyPluginDeps` from the Nest module (the Shoper shape).

## 4. Steps

1. Queries and `findShopifyExternalId`.
2. Mapper with spec (gross/net, tax lines, custom line, pickup point, payment).
3. Adapter with spec (dedup, currency refusal, location move, mappings, status).
4. Factory, plugin, module, plugin spec.
5. README, architecture overview.

## 5. Validation

- Hexagonal: adapter implements core ports only; no core change.
- Security: no secrets; buyer data goes only to the merchant's own store.
- Tests: mapper and adapter specs, plugin spec. E2E on a development store pending.
