# Implementation plan - Shoper createOrder: header and lines (#3693)

Sub-issue of epic #3642. Stacked on #3696 (customer get-or-create). Idempotency is #3694, stock policy #3695.

## 1. Goal, layer, non-goals
Integration layer. `ShoperOrderProcessorAdapter.createOrder`: resolve user (done in #3692), create the order header (`POST /orders`) and one `POST /order-products` per line, at the buyer-paid price (ADR-014), returning the Shoper-native order id.
Non-goals: duplicate-order guard (#3694: a retry duplicates here, stated in the README), stock double-deduction policy (#3695), status writeback / fulfilment (other epic), customer addresses as separate resources.

## 2. Evidence (SPIKE-3638 + live GET probes on the trial shop)
- `POST /orders` requires `email`, `status_id`, `payment_id`, `shipping_id`, `user_id`, `shipping_tax_id` (O1). Address objects `billing_address` / `delivery_address` carry firstname, lastname, company, street1, street2, city, postcode, state, country, country_code, phone, `tax_identification_number`, `pesel` (O9).
- Line `price`/`tax`/`tax_value` are caller-controlled; `tax` is the tax NAME (`"23%"`), `tax_value` its number; lines also take `product_id`, `stock_id`, `quantity`, `name`, `code` (O4).
- `shipping_id`/`payment_id`/`status_id`/`currency_id` are ids of rows in the shop's own `/shippings`, `/payments`, `/statuses`, `/currencies`. A shipping row carries its own `tax_id` (-> `shipping_tax_id`). `/taxes` rows: `{tax_id, value, name}`.
- Stock is decremented the instant a line is created (O6): a half-created order has already moved stock.

## 3. Design
1. Variants: `OrderItem.variantId` -> `ProductVariant` mapping -> `stock_id`; `productId` -> `Product` mapping -> `product_id`. Unmapped = terminal `ShoperNotMappedException` BEFORE any write.
2. Price: line `price` = buyer-paid unit price per the order's `taxTreatment` (gross when `inclusive`); no recomputation (ADR-063). `tax`/`tax_value` from `item.taxRate` resolved against `/taxes` (existing `ShoperTaxTableProvider`); an item with no resolvable rate is a terminal error rather than a guessed default.
3. Header ids: `shipping_id`, `payment_id`, `status_id` resolved in order: operator mapping (`IMappingConfigService`: carrier by `order.shipping.methodId`, payment, order-state) -> connection config default (`config.defaults.{shippingId,paymentId,statusId}`) -> terminal `ShoperOrderConfigException` naming what to set. `shipping_tax_id` from the resolved shipping row's `tax_id`. `currency_id` from `/currencies` by `totals.currency`; unknown currency = terminal.
4. Partial create: validate and resolve everything first, then header, then lines. If a line fails after the header exists, best-effort `DELETE /orders/:id`; if that fails too, throw `ShoperPartialOrderException` carrying the order id and the number of lines written. Stock restoration on delete is unverified (see smoke).
5. Order total: Shoper computes `sum` from lines; compare to `totals.total` and warn (not fail) on mismatch so a marketplace discount/rounding is visible.

## 4. Steps (files)
1. `domain/types/shoper-api.types.ts`: order/line/address request + shipping/payment/status/currency rows.
2. `infrastructure/mappers/shoper-order.mapper.ts` (+spec): pure address / line / header mapping.
3. `infrastructure/providers/shoper-order-options.provider.ts` (+spec): shippings, currencies, memoised per bag.
4. `shoper-order-processor.adapter.ts` (+spec): createOrder flow incl. partial-create handling.
5. Exceptions + retry classifier (terminal: config/not-mapped/currency/tax; partial = retryable? see Q2).
6. Wiring: `IMappingConfigService` through the module/plugin deps; README; smoke.

## 5. Open questions (need a decision)
Q1 header id resolution: mappings + config default (as above) vs config-only for this slice (mappings UI needs a `DestinationOptionsReader` for Shoper, listCarriers/listPaymentMethods/listOrderStatuses, ~3 GET reads; propose a follow-up).
Q2 partial create + retry: after a failed delete a retry would create a second order; #3694 must treat `ShoperPartialOrderException` specially. Mark it terminal here (operator fixes) or retryable?
Q3 smoke: a real `POST /orders` + lines + DELETE on the trial shop to confirm the payload and whether DELETE restores stock.
