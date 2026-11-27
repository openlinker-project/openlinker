# Implementation Plan: Shopify OrderSource and returns (#3977)

Stacked on #3976 (InventoryMaster), #3975 (ProductMaster) and #3974 (foundation,
PR #4042). Branch `3977-shopify-order-source`.

## 1. Task

Shopify as an order source (role C): orders and returns into OpenLinker; status,
tracking, return declines and (opt-in) refunds back. Integration layer only; no
core change.

### Non-goals

- Order webhooks (#3981), order creation in Shopify (#3978).
- `delivered` / `in-progress` writeback (Shopify fulfillment events, not verified live).
- Linking a refund to a Shopify return (`returnProcess`), shipping/line refunds.

## 2. Research

Prototype files re-read (reference only): order source adapter, refund executor,
order/return mappers, both feed cursors, tracking mapper, mapping options reader,
order/return queries, scheduler tasks, feed/return types. The prototype has no
tests for this area; all specs are new.

### Shopify API (2026-10), checked against the reference

| Point | Reference says | Change from the prototype |
|---|---|---|
| `Order` fields | all selected fields exist; `customerEmail` does not (use `email`); money via `*Set` | none |
| B2B tax id | `PurchasingCompany.location.taxSettings.taxRegistrationId` (`CompanyLocation.taxRegistrationId` deprecated); no tax id on `MailingAddress` or B2C order | none |
| `orders` filters | `updated_at` with comparators, `return_status` values `return_requested, in_progress, inspection_complete, returned, return_failed, no_return`, sort `UPDATED_AT` | none (`return_failed` left out of the feed: a failed return carries no goods) |
| Fulfillment | `fulfillmentOrderMove(id, newLocationId)`, `fulfillmentCreate(fulfillment: {lineItemsByFulfillmentOrder, trackingInfo{company number url}, notifyCustomer})`; `fulfillmentCreateV2` deprecated | none |
| `orderCancel` | `refund: Boolean` deprecated in favour of `refundMethod` | `refund: false` dropped; no `refundMethod` means no refund |
| Returns | `returnReasonDefinition{handle name}` (`returnReason` deprecated, not removed); `ReturnStatus` CANCELED/CLOSED/DECLINED/OPEN/REQUESTED; no top-level `returns` query; only `REQUESTED` can be declined | the "already declined?" re-read goes through `node(id:)`: a `return(id:)` query is not confirmed |
| `refundCreate` | `@idempotent` required since 2026-04; `transactions{orderId parentId gateway kind amount}`; `suggestedRefund(suggestFullRefund)` | none |
| Delivery methods | `deliveryProfiles ... methodDefinitions{name active}` needs shipping access; no API lists payment gateways | `read_shipping` added as an OPTIONAL scope |

## 3. Design

- `infrastructure/adapters/order-source/shopify-order-source.adapter.ts` (+ `ShopifyRefundingOrderSourceAdapter`)
- `infrastructure/adapters/order-source/shopify-refund-executor.ts`
- `infrastructure/adapters/order-status/shopify-order-status-writeback.ts` (shared with #3978)
- mappers: incoming order, incoming return, order feed cursor, return feed cursor, tracking
- readers: order queries, return queries, mapping options
- scheduler: orders poll (on), returns poll + returns status sync (off by default)
- config: `refundsThroughShopify` (boolean, default false)
- manifest: `OrderSource` + advertised `ReturnSourceReader`, `ReturnDecliner`; not default-enabled
- retry classifier: order / return not found are terminal

## 4. Decisions

- First poll with no cursor reads the whole order history, as every other source does
  (core #4040 tracks the retry storm that can cause).
- `OrderSource` is opt-in: ingesting orders creates them in every destination.
- A pending COD order is `cod`, not awaiting payment.

## 5. Validation

Type-check, eslint and invariants on the package. Unit tests run on CI. E2E on a
dev store is the open acceptance item.
