# Implementation plan - Shoper OrderSource (#3711)

Branch `3711-shoper-order-source`, stacked on `3706-shoper-variant-options-attributes` (#3707), the top of the Shoper stack (so it also carries #3704 writeback and #3703 setup UI). Only `shoper-plugin.ts` / the factory can conflict when the stack below is re-cut.

## 1. Goal

Orders placed in a Shoper shop enter OpenLinker through `OrderSourcePort` (`listOrderFeed` + `getOrder`), the way WooCommerce and PrestaShop already do. `OrderSource` is declared in the manifest together with the adapter (Erli #980 rule).

**Layer:** Integration only (`libs/integrations/shoper`). No CORE change is proposed.

**Non-goals:** webhooks / `order.*` triggers (#3644), destination-side read-back (`FulfillmentStatusReader`, #3644 Slice A), `ProductPublisher` / `CategoryProvisioner` (#3712 / #3713), sales documents (Shoper has none).

## 2. Live verification (6 Oct 2026, read-only GETs against the trial shop) - resolves U1-U5

| # | Answer | Effect |
|---|---|---|
| U1 | **Yes.** `filters[order_id][>]=6` (and the JSON form `filters={"order_id":{">":6}}`) filter by comparison; `filters[order_id]=>6` does NOT (returns 0 rows). `date` and `status_date` filter too. | the cursor is a true `order_id` keyset, no page walk |
| U2 | **No inline lines.** `/orders` and `/orders/:id` carry only `total_products`; lines are `GET /order-products?filters[order_id]=N`. | two reads per `getOrder` |
| U3 | A list row is the FULL order: both addresses, `notes_priv`, `date`, `status_date`, `paid`, `sum`, `is_paid`, `is_cash_on_delivery`, `order_url`, `currency_id`, `shipping_id`, `shipping_tax_value`. Timestamps are naive, shop-local; the zone is `application-config.locale_timezone` (`Europe/Warsaw`). | echo filter works on the list row; time zone is read from the shop |
| U4 | An `order-products` row: `price` (gross, string), `quantity`, `name`, `code` (the SKU), `ean`, `tax` (name, `23%`), `tax_value`, `product_id`, `stock_id`. `stock_id` is the same id ProductMaster uses for a variant. | `productRef` is the variant |
| U5 | `/statuses` rows carry `type` 1 (złożone), 2 (przyjęte, oczekiwanie, kompletowanie, gotowe), 3 (wysłana), 4 (anulowane, odrzucone, zwrócone). | type -> neutral status; type 4 is lossy (cancelled/rejected/returned) |

`GET /orders/99999` answers `404 {"error":"invalid_request"}` (the `isResourceNotFound` shape). `GET /shippings/8` carries `name`; `GET /currencies` carries `name` = ISO code.

**Consequences for the design below**: no `fetchShoperWindow` fallback is needed; no `initialSyncFrom` is read (the first run starts at the lowest id, as the first poll of a fresh connection should); the scheduler question in 3.4 stays a deliberate non-goal.

## 2b. What was unknown before that check (kept for the record)

SPIKE-3638 verified live: `GET /orders`, `GET /orders/:id`, `GET /order-products`, `GET /statuses`, `GET /currencies`, `GET /object-mtime/order/:id`, and that the `order.create` webhook carries the whole order object (O1-O9, M7, X3). The Shoper adapter already knows (live): the `limit` ceiling of 50 with a silent fallback to 10 (`shoper-pagination.ts`), a bare `order=` sorts DESC, `filters[field]=value` equality, `GET /orders` rows carry `notes_priv` / `status_id`, and an order created by OpenLinker carries `notes_priv = "OpenLinker order <internalId>"` (`orderMarker`, `shoper-order-input.mapper.ts`).

**NOT verified, and each one decides a design choice** (issue step 1 - these need a real shop):

| # | Unknown | Decides |
|---|---|---|
| U1 | Can `GET /orders` filter by a comparison (`order_id > N` / `date > X`), and in which syntax? | whether the cursor is a keyset or a page walk |
| U2 | Does `GET /orders` return the order's lines inline, or only `GET /order-products?filters[order_id]=...`? | one request or two per `getOrder` |
| U3 | Field names of an order row: creation date (`date`), update marker (if any), `paid`, `sum`, `shipping_cost`, `currency_id`, `shipping_id`/`payment_id` and how to resolve their names | the whole `IncomingOrder` mapping |
| U4 | Shape of an `order-products` row: `tax`, `tax_value`, `price` (gross), `product_id`, `stock_id`, `code`/`sku` | line mapping, ADR-063 tax rate |
| U5 | `GET /statuses` `type` (1 new / 2 processing / 3 shipped / 4 terminal) per status id | `IncomingOrder.status`, cancelled detection |

The plan below is written against the most likely answers and **isolates every unknown behind one small function** (query builder, row types, mapper), so a wrong guess is a one-file correction, not a redesign. Implementation does not start on U1-U5 guesses: Phase 4 begins with the live check.

## 3. Design

### 3.1 Cursor (feed)

**An `order_id` keyset (verified, U1).** `order=order_id ASC`, `limit` = `min(input.limit, 50)`, resumed past the cursor. The cursor is the highest `order_id` of the page (an opaque string, as the port requires). New orders get monotonically increasing ids, so no date field, no timezone and no same-second edge is involved - which removes the whole class of watermark bugs the WooCommerce adapter documents.

- The comparison filter exists (U1): `filters[order_id][>]=<cursor>`.
- Empty page -> `nextCursor = input.fromCursor` (no regression), never `null` while a cursor exists (core holds the cursor on an unchanged value, see `docs/architecture-overview.md` § Returns, #2330).

**Known and accepted limit:** an id-ordered feed observes only NEW orders; a later edit of an already-read order is not re-observed by the poll. That is the same trade-off PrestaShop accepts when `date_upd` is unfilterable (#2877) and it is why the webhook backstop (#3644) matters: the webhook, not the poll, is the update channel. `GET /object-mtime/order/:id` exists but is per-object, so it cannot drive a feed (M7). The first-run window honours `config.orders.initialSyncFrom` only if U3 shows a usable creation date; otherwise the first run reads the whole collection (stated, as WooCommerce does).

Event type is `created`, except that an order already terminal (cancelled, rejected, returned) when first seen is reported as `cancelled` - core routes that through the cancellation relay and never through the create/update path (the PrestaShop and WooCommerce sources do the same). `eventKey = "<order_id>:<eventType>"` (a stable key, so a re-read page dedups).

### 3.2 `getOrder`

`GET /orders/:id` (+ `GET /order-products?filters[order_id]=:id` unless U2 says lines are inline). A non-numeric id is refused before URL construction (path safety, as WooCommerce does). 404 -> a not-found exception the retry classifier treats as terminal (reuse the one the Shoper package already throws for product 404s).

Mapping to `IncomingOrder`:

- `externalOrderId`, `orderNumber` (Shoper's own order number field if U3 shows one, else the id), `status` = the status NAME resolved through `/statuses` (cached per bag like the options provider), `customerExternalId` = `user_id` when > 0, `customerEmail`.
- **Lines:** `price` = what the buyer paid (the order-products `price`, ADR-014), `unitPriceGross` = same value, `taxRate` = the resolved code from `tax_value` ("23", "8", "0"...) **only when present** - absent stays absent (ADR-063, never defaulted), `sku` from the stock `code`, `productRef` = variant (`stock_id`) when present, else product.
- **Totals:** `currency` resolved from `currency_id` via `/currencies`, `taxTreatment: 'inclusive'` (Shoper prices are gross - O4), `shipping` / `total` from the order row.
- **Addresses:** `billing_address` / `delivery_address` -> `IncomingOrderAddress`; `taxId` through the shared `readSourceBuyerTaxId` coercer from `tax_identification_number`, so a blank value is *unknown*, never *asserted none* (ADR-073).
- **Payment:** `paymentStatus` from `paid` vs `sum` through the shared `PAYMENT_STATUS` constants; `shipping` method label from the shipping method name; `placedAt` only if a real creation date exists (it feeds invoicing's sale date, so no fabrication - the WooCommerce rule).

### 3.3 Echo exclusion

An order OpenLinker created in Shoper (#3701) carries `notes_priv = "OpenLinker order <id>"`. Re-reading it as a source order would ingest our own order as a new one. `listOrderFeed` therefore **drops rows whose `notes_priv` starts with that marker prefix**, but **still advances the cursor over them** (computed over all rows before filtering - the WooCommerce "cursor freeze" rule). The prefix comes from `orderMarker` (single source), not a second string literal. This is stated as the one cost: if `notes_priv` is not returned by the LIST endpoint, the filter must move to `getOrder` (U3).

### 3.4 Wiring

- `ShoperAdapterFactory.createAdapters` also builds `orderSource` on the same `ShoperHttpClient` (one client per bag, as for the other adapters). It needs no customer provisioner, so it is always present (unlike `orderProcessor`).
- `shoperAdapterManifest.supportedCapabilities` gains `'OrderSource'`. **`defaultEnabledCapabilities` is NOT widened**: like `OrderProcessorManager`, ingesting a shop's orders is opt-in, otherwise every Shoper connection that exists only as a catalogue master would start polling orders (#3350 mechanism, the comment already in the manifest).
- `createCapabilityAdapter` dispatch table: `OrderSource: async () => (await build()).orderSource`.
- **No scheduler task in this slice.** `OrderIngestionService` is driven by `marketplace.orders.poll`; a Shoper poll task would add recurring load against a shop whose request ceiling is unknown (`x-shop-api-limit: 10`, unit unknown, SPIKE-3638 risk 2). The adapter is made reachable and testable; enabling a recurring poll is a deliberate follow-up after the sustained-rate test. If the host already registers the poll task per `OrderSource` capability generically, confirm it is OFF by default for this platform - to be verified in Phase 4 against `apps/worker/src/scheduler`.

## 4. Files

New:
- `libs/integrations/shoper/src/infrastructure/adapters/order-source/shoper-order-source.adapter.ts`
- `libs/integrations/shoper/src/infrastructure/adapters/order-source/shoper-order-source.types.ts` (wire rows: order, order-product - U3/U4)
- `libs/integrations/shoper/src/infrastructure/mappers/shoper-incoming-order.mapper.ts` (pure)
- `libs/integrations/shoper/src/infrastructure/adapters/order-source/__tests__/shoper-order-source.adapter.spec.ts`
- `libs/integrations/shoper/src/infrastructure/mappers/__tests__/shoper-incoming-order.mapper.spec.ts`

Changed:
- `libs/integrations/shoper/src/application/shoper-adapter.factory.ts` (`orderSource` in `ShoperAdapters`)
- `libs/integrations/shoper/src/shoper-plugin.ts` (manifest + dispatch)
- `libs/integrations/shoper/src/__tests__/shoper-plugin.spec.ts` (manifest expectation)
- `libs/integrations/shoper/README.md` (capability table, the "poll sees new orders only" limit)
- `docs/architecture-overview.md` is NOT edited unless a CORE rule changes (it does not).

## 5. Tests

Unit, fully mocked HTTP (`jest.Mocked<ShoperHttpClient>`):
- feed: first page, resumed page, empty page keeps the cursor, page cap 50, cursor advances over echo rows that are filtered out, eventTypes filter.
- echo: a row with `notes_priv: "OpenLinker order ol_order_x"` is dropped, a row with an operator note is kept, a null `notes_priv` is kept.
- `getOrder`: happy path, 404 -> not found, non-numeric id refused before any request, missing tax rate stays absent, blank tax id stays unknown, `paid` vs `sum` -> payment status, unknown status id degrades (does not throw).
- manifest: `OrderSource` declared, NOT in `defaultEnabledCapabilities`; dispatch returns the adapter.

No integration test: nothing here touches Postgres or Redis.

## 6. Risks / open questions

1. **U1-U5 are unverified** (section 2). This is the main risk and the reason implementation is gated on a live check.
2. **Poll-only feed misses edits** (3.1) - accepted, mitigated by #3644; stated in the README so it is not rediscovered.
3. **The OpenLinker echo filter depends on `notes_priv` being on the list rows** (3.3); otherwise the filter moves to `getOrder`, which cannot drop an item from the feed and would require a different mechanism (an ingestion-level exclusion).
4. **Recurring poll load** is deliberately not enabled (3.4).
5. The stack base: this branch depends on #3701 not being rebased again; if the stack is re-cut, this plan's files are all new, so only `shoper-plugin.ts` / the factory can conflict.

## 7. Changes after review (supersede the text above where they differ)

- **Status**: type 4 is split by label into `cancelled` / `refunded` (refund vocabulary: `zwro`, `refund`, `return`, ...), the PrestaShop precedent, instead of reading every terminal type as `cancelled`. A terminal order reports no payment status.
- **Payment**: only `paid` (`is_paid`) or `cod` (`is_cash_on_delivery`) is reported; **`awaiting` is never reported**. It is in `DISPATCH_BLOCKING_PAYMENT_STATUSES`, so it would make OpenLinker refuse a shipping label, and Shoper cannot tell an unpaid prepay order from one paid at pickup (orders 4 and 9 of the trial shop are shipped with `paid 0.00`). PrestaShop and WooCommerce follow the same rule.
- **Reference tables**: statuses, currencies and shipping names are read through the host `CachePort` (key per connection, TTL 300 s, an empty table is never stored). `getCapabilityAdapter` builds a fresh bag per call, so a per-instance memo alone cost about six requests per order job against a shop whose request ceiling is unknown. `ShoperOrderStatusInfo` moved to `domain/types`.
- **Echo**: core's destination-echo guard (#940) already skips a re-read of an order owned by another connection; the `notes_priv` filter in the feed saves the job and its requests on top of that.
