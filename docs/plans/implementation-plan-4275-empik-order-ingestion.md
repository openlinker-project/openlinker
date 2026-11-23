# Implementation Plan: Empik order ingestion with automatic acceptance (#4275)

Epic #4273, spike #4268, builds on #4274 (Mirakl plugin foundation, ADR-086).

## 1. Task

**Goal.** An Empik connection becomes an `OrderSource`: new Empik orders are accepted
automatically, read through Mirakl OR11 and ingested into OpenLinker like any other
marketplace order.

**Layer.** Integration (`libs/integrations/mirakl`). No change to `libs/core`.

**Non-goals (this issue).**
- A core `OrderAcceptor` sub-capability, a stock-checked or manual acceptance. Follow-up
  (needs an ADR and a job type).
- Writing fulfilment back to Empik (OR23 / OR24): #4276.
- Offers, stock, prices and the `Offer` mappings the order lines resolve through: #4277.
- Returns: #4279.
- Frontend: the acceptance setting has no UI field yet (default `auto`); the Empik wizard
  keeps two steps. A sales-documents step like Erli's is a follow-up.

## 2. Research findings

- `OrderSourcePort` = `listOrderFeed({fromCursor, limit, eventTypes?})` + `getOrder({externalOrderId})`
  (`libs/core/src/orders/domain/ports/order-source.port.ts`).
- `OrderIngestionService.ingestOrders` takes the poll lock, reads the cursor, calls
  `listOrderFeed`, enqueues one `marketplace.order.sync` per item under the key
  `marketplace:{connectionId}:order:{eventKey}`, then advances the cursor. An ISO instant
  cursor gets the regression guard (`order-cursor.types.ts`).
- `syncOrderFromSource` routes `eventType: 'cancelled'` to `handleSourceCancellation`
  (relay plus late ingest, #4100); everything else calls `getOrder`.
- Erli is the template: `erli-order-source.adapter.ts`, pure `erli-order.mapper.ts`,
  `erli-scheduler-tasks.ts` (`marketplace.orders.poll`, `*/5`, env gate disabling only on
  `'false'`), plugin dispatch table, `ErliEmailNormalizerAdapter` (`normalizeEmail`),
  int-spec harness `apps/api/test/integration/helpers/erli-test-order-source.helper.ts`
  (real adapter behind a fake HTTP client, test adapter key).
- Staging facts (saved responses, SPIKE-4268):
  - OR11 filters `order_state_codes`, `start_update_date`, `end_update_date`, `order_ids`;
    offset paging `max` / `offset` / `total_count`; the only sort is `dateCreated`.
  - OR21 `PUT /api/orders/{id}/accept` `{order_lines:[{id, accepted}]}`; empty body 400,
    unknown order 404 `ORDER_NOT_FOUND`.
  - Order additional fields (`entity: ORDER`): `nip`, `customer-email`,
    `delivery-point-name`, `order-type`, `pni`.
  - Shipping types (SH12): `COURIER`, `PACKSTATION`, `DPD_PICKUP`, `POST`, `POST_OFFICE`,
    `ZABKA`, `ORLEN_STATION`, `ORLEN`, `GLS_PICKUP`, `STORE`, `DIGITAL`, ... and a `*_POD`
    variant for cash on delivery.
  - No real order has been placed on staging yet, so the order shape is the OR11 spec.

## 3. Design

### 3.1 Feed (`listOrderFeed`)

1. **Accept first** (unless `config.orderAcceptance === 'off'`): read OR11
   `order_state_codes=WAITING_ACCEPTANCE` (bounded pages) and send OR21 for each order,
   every line still `WAITING_ACCEPTANCE` → `accepted: true`.
   - `ORDER_INVALID_STATE` → counted as already handled (a retry after a lost response).
   - `ORDER_LINE_*` and other `MiraklApiException` → error log, counted, not retried, the
     feed continues.
   - Auth, network, rate-limit failures propagate: the poll job retries, the cursor stays.
   - One summary log per run: `accepted / alreadyHandled / failed`.
   - Header comment states this is a deliberate write inside a read path and why: every
     other source delivers accepted orders, the deadline is 5 days, and the poll is the
     only thing that sees new Empik orders.
2. **Read changes in a closed window** `[from, to]`:
   - `to = now - 30 s`; `from = cursor - 2 min` overlap, or `now - 7 days` without a cursor.
   - OR11 with `start_update_date`, `end_update_date`, `order_state_codes` = every
     ingestible state (all except `STAGING`, `WAITING_ACCEPTANCE`), offset paging, page
     budget from `limit`.
   - If the read is truncated, halve the window (`to = from + (to - from) / 2`) and read
     again, up to 6 times; the cursor advances only to the end of a window that was read
     whole. If even the smallest window is truncated, advance with an error log (only at
     thousands of order changes per minute).
3. **Items**: one per order, `eventKey = {order_id}:{last_updated_date}` (the overlap
   re-reads collapse on the job key), `eventType = 'cancelled'` for `CANCELED` / `REFUSED`,
   otherwise `'updated'`; honour `input.eventTypes`.
4. **Cursor** = `to` of the last whole window, ISO instant with `Z`.

Pure helpers in `domain/policies/mirakl-order-feed.policy.ts`: window computation, the
ingestible-state list, `eventType` and `eventKey` derivation.

### 3.2 `getOrder`

OR11 `order_ids={id}`. No order → `MiraklApiException(404, 'ORDER_NOT_FOUND')`
(non-retryable). Then the pure mapper.

### 3.3 Mapper (`mirakl-order.mapper.ts`, pure)

| IncomingOrder | Mirakl |
|---|---|
| `externalOrderId`, `orderNumber` | `order_id` |
| `status` | `WAITING_DEBIT*` → pending, `SHIPPING` → processing, `SHIPPED` / `TO_COLLECT` → shipped, `RECEIVED` / `CLOSED` → delivered, `REFUSED` / `CANCELED` → cancelled, `STAGING` / `WAITING_ACCEPTANCE` / unknown → pending |
| `paymentMethod` | `shipping_type_code` ends with `_POD` → `cash_on_delivery`, else `online` |
| `paymentStatus` | `fully_refunded` → refunded; COD (not cancelled) → `cod`; `WAITING_DEBIT*` → awaiting; `SHIPPING` onward → paid; cancelled → absent |
| `codToCollect` | only for `cod`, via `toCodToCollect(total, currency)` |
| `customerExternalId` | `customer.customer_id` |
| `customerEmail` | additional field `customer-email`, else `customer_notification_email` |
| addresses | `customer.shipping_address` / `billing_address`; country alpha-3 → alpha-2 table (Mirakl sends alpha-3), passthrough of a 2-letter value |
| billing `taxId` | additional field `nip`, else `customer.organization.tax_identification_number`, via `readSourceBuyerTaxId` |
| `shipping` | `shipping_type_code` / `shipping_type_label` |
| `pickupPoint` | `shipping_pudo_id`, else additional field `delivery-point-name`; name from `delivery-point-name`; `PACKSTATION*` → `apm` |
| `dispatchTime.to` | `shipping_deadline` (Empik's own deadline, not estimated) |
| items | lines not `REFUSED` / `CANCELED` (all lines if none remain); `id` `order_line_id`; `productRef {type: 'offer', externalId: offer_sku}`; `price` / `unitPriceGross` `price_unit`; `taxRate` when `taxes[]` carries exactly one rate; `name` `product_title`; `imageUrl` first `product_medias` |
| totals | `total` `total_price`, `shipping` `shipping_price`, `subtotal` `total - shipping`, `tax 0`, `currency_iso_code`; `taxTreatment` from `order_tax_mode` (`TAX_EXCLUDED` → exclusive, else inclusive); `shippingGross` when inclusive; `shippingTaxRate` when every line's `shipping_taxes` has one and the same rate |
| `buyerNote` | absent (Mirakl has no checkout note) |
| `placedAt` / `createdAt` / `updatedAt` | `created_date` / `created_date` / `last_updated_date` |
| `metadata` | `{ orderState, orderType }` (no PII) |

Rate format: `23` → `'23'`, `8.0` → `'8'`, `5.5` → `'5.5'`.

**Constraint on #4277**: order lines resolve through `Offer` mappings keyed by the
**shop SKU** (`offer_sku`), so the offer sync must map `Offer: <shop sku> → variant`.

### 3.4 Config

`MiraklConnectionConfig.orderAcceptance?: 'auto' | 'off'` (absent = `auto`), validated by
the config shape validator.

### 3.5 Plugin

- Manifest: `supportedCapabilities: ['OrderSource']`.
- Factory: `createAdapters(...)` returns `{ orderSource }` built on the shared clients.
- Dispatch table `OrderSource → adapter`.
- Register the email normalizer (`normalizeEmail`, like Erli) and the scheduler task
  `{platformType}-orders-poll`: `marketplace.orders.poll`, `*/5 * * * *`, limit 200,
  cursor key `{platformType}.orders.lastUpdateDate`, env gate
  `OL_{PLATFORM}_ORDERS_POLL_SCHEDULER_ENABLED`, `requiredCapability: 'OrderSource'`.

## 4. Steps

| # | File | Acceptance |
|---|---|---|
| 1 | `domain/types/mirakl-order.types.ts` | Wire types for OR11 order, line, address, additional field, OR21 body |
| 2 | `domain/types/mirakl-connection.types.ts`, `infrastructure/adapters/mirakl-connection-config-shape-validator.adapter.ts` | `orderAcceptance` typed and validated; spec cases |
| 3 | `domain/policies/mirakl-order-feed.policy.ts` (+ spec) | window, states, eventKey, eventType |
| 4 | `domain/policies/mirakl-country.policy.ts` (+ spec) | alpha-3 → alpha-2 |
| 5 | `infrastructure/adapters/mirakl-order.mapper.ts` (+ spec) | table above, COD, NIP, pickup, VAT, totals |
| 6 | `infrastructure/adapters/mirakl-order-acceptor.ts` (+ spec) | accept all, `ORDER_INVALID_STATE` handled, line errors logged, counts |
| 7 | `infrastructure/adapters/mirakl-order-source.adapter.ts` (+ spec) | accept-then-read, window halving, `off` reads only, `getOrder` 404 |
| 8 | `infrastructure/adapters/mirakl-email-normalizer.adapter.ts` | trim + lowercase |
| 9 | `infrastructure/scheduler/mirakl-scheduler-tasks.ts` (+ spec) | one task per profile |
| 10 | `application/...factory(.interface).ts`, `mirakl-plugin.ts` (+ specs) | OrderSource advertised and dispatched; registrations |
| 11 | `apps/api/test/integration/helpers/mirakl-*` + `apps/api/test/integration/empik/empik-orders-vertical-slice.int-spec.ts` | accept + poll → `ready` order, replay no duplicate, `off` untouched, `ORDER_INVALID_STATE` ok, cancel event |
| 12 | `README.md` of the package, `architecture-overview.md` § 10 note, spike doc status | docs updated |

## 5. Validation

- Hexagon: everything inside the plugin; core reached only through barrels and ports.
- No `any`, no `console.log`; the mapper logs nothing, so no PII reaches a log line.
- Tests: unit specs per step, one vertical slice. Not run locally (CI); type-check and
  lint are run.
- Security: `customer-email` and addresses go only into the typed fields, never `metadata`
  or logs.

## 6. Risks and open questions

- The order shape is spec-derived until Empik places a staging order (the AC records it
  as pending).
- Whether `country_iso_code` is alpha-3 on Empik is unconfirmed; the policy accepts both.
- `order_state_codes` takes a comma-separated list per the Mirakl docs; to be confirmed on
  the first live read.
- Accepting without a stock check: two orders racing for the last unit (issue assumption).
