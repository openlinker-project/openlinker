# @openlinker/integrations-mirakl

Mirakl Seller API plugin for OpenLinker. Every Mirakl marketplace runs the same
Seller API, so this package holds the shared client and adapters, and each
marketplace is an **operator profile** (`src/operators/`) that becomes its own
connection type in OpenLinker. See ADR-086.

| Operator | Profile | Adapter key | Platform type |
|---|---|---|---|
| Empik Marketplace | `empik.profile.ts` | `empik.mirakl.v1` | `empik` |

## What ships today (#4274)

- Connection: config and credentials validation, a connection test (A01
  `GET /api/account`), retry and auth-failure classifiers.
- `MiraklHttpClient`: `Authorization: <key>` (no `Bearer`), optional `shop_id`,
  both Mirakl error shapes, 429 with `Retry-After`, multipart CSV uploads, an
  8 MiB response cap.
- Offset and seek pagination helpers.
- `MiraklImportTracker`: status and error reports for offer, stock, price and
  product imports.

## Orders (#4275)

The plugin advertises `OrderSource`. The `{platform}-orders-poll` scheduler task
runs every 5 minutes (`OL_EMPIK_ORDERS_POLL_SCHEDULER_ENABLED=false` turns it
off) and:

1. Accepts every order waiting for acceptance (OR21, every line accepted),
   unless the connection sets `orderAcceptance: 'off'`. Acceptance does not check
   stock. `ORDER_INVALID_STATE` counts as already handled; other refusals are
   logged and not retried.
2. Reads orders changed in a closed `last_updated_date` window (OR11), with a
   2-minute overlap and a 7-day lookback on the first run. Orders still in
   `STAGING` or `WAITING_ACCEPTANCE` are not read. A window that does not fit is
   halved, and the cursor advances only past what was read whole.

The mapper reads the buyer tax number from the order field `nip`, the email
from `customer-email`, the pickup point from `shipping_pudo_id` and
`delivery-point-name`, cash on delivery from a `_POD` shipping type, and the
line VAT from `taxes[]`. Order lines resolve through `Offer` mappings keyed by
the shop SKU (`offer_sku`).

The order shape follows the Mirakl spec; it is confirmed on the first real
Empik order. Offers arrive with #4277 (epic #4273).

## Order fulfilment writeback (#4276)

The order source also tells the operator what happened to an order, each part
in its own class behind `MiraklOrderSourceAdapter`:

- **Shipped** (`OrderStatusWriteback`, `dispatched`): OR23 with the tracking
  number, then OR24. Mirakl keeps one tracking number per order, so a second
  parcel's number is logged and not sent. The carrier code comes from the
  connection's `carrierCodes` (`platformType` -> SH21 code), else a built-in
  table (an InPost order to a parcel locker goes as `paczkomatyinpost`, any
  other as `inpostpaczkakurierska`); a carrier with no code is sent by name.
- **Cancelled**: OR29, the whole order. A shipped order is refused; it can only
  be refunded on the marketplace.
- **Delivered, in progress, paid**: `unsupported`. The operator moves an order
  to received itself and collects the payment.
- **Readback** (`OrderFulfillmentReadback`): the order's state and its tracking
  number from OR11, including a shipment the seller entered in the panel.
- **Delivery methods** (`SourceOptionsReader`): SH12 shipping types, keyed by
  the same code the order carries (Empik: `STORE`, `DIGITAL` among them).
- **Invoice** (`OrderBillingDocumentUploader`): OR74 as the profile's invoice
  type (Empik: `CUSTOMER_INVOICE`, read from DO01). OR72 is checked first, so a
  retry after a lost answer reads `already-present` instead of a second copy.

Every write reads the order first, so a replayed event does not write again.

## Offers: stock, price, linking, status (#4277)

`MiraklOfferManagerAdapter` keys every offer by its `shop_sku`, the same key
STO01, PRI01 and order lines use.

- **Stock and price are recorded, then sent in batches.** A stock change
  (`updateOfferQuantity`, `OfferQuantityBatchUpdater`) or a price change
  (`OfferFieldUpdater`, price only) goes into `mirakl_offer_writes`. Every
  5 minutes `marketplace.offerQuantity.reconcile` sends all pending stock as
  ONE STO01 file and all pending prices as ONE PRI01 file, then follows each
  import (`PendingQuantityAckReconciler`). Mirakl asks sellers not to import
  more often than every few minutes, so stock is not sent per change.
- **`COMPLETE` is not success.** When an import reports failed lines, the
  error report is read and those offers fail with Mirakl's reason; a line
  that names no SKU fails the whole import.
- **Never OF24.** OF24 resets every field it does not receive (on staging a
  partial write zeroed the quantity). A spec fails the build if any production
  file POSTs to `/api/offers`.
- **Linking** (`OfferLister`): OF21 pages with shop SKU and EAN, for
  `marketplace.offers.sync` (hourly).
- **Status** (`OfferStatusReader`): `active` and `inactivity_reasons` from OF21
  filtered by SKU, with the price and quantity the channel shows (hourly).
  `NO_MIN_SHIPPING_RATE` and `SHOP_NOT_OPEN` are reported once per connection,
  `ZERO_QUANTITY` per offer, and an unknown reason verbatim.

A value written twice is harmless (stock and price are absolute), so a file
whose answer was lost is simply sent again on the next pass.

## Listing from OpenLinker (#4278, part 1: existing cards)

On a Mirakl operator an offer points to a catalogue card. This part lists
products whose EAN already has one:

- **Taxonomy**: H11 categories (`CategoryBrowser`), PM11 card attributes with
  VL11 values (`CategoryParametersReader`), and the tree's identity
  (`empik` / `empik:staging`), so the destination taxonomy projection,
  category mappings and attribute rules work.
- **Card match** (`EanCategoryMatcher` in the wizard, `CategoryBarcodeMatcher`
  when the offer is built): P31 by EAN, up to 100 per request.
- **Create** (`OfferCreator`): OF24 once per offer with the full field set
  (EAN, state 11, price, quantity, lead time, logistic class, `gpsr-*` fields
  from `Product.gpsr`). The import is recorded, so the offer reads
  `activating` while it runs and `inactive` with Mirakl's reason if refused.
  Lead time and logistic class come from the wizard, else
  `config.offerDefaults`.
- **No card**: refused with `MIRAKL_PRODUCT_CARD_MISSING`, and the wizard
  blocks the row before submit.

Not yet: creating cards (P41), variant grouping (`VARIANT_GROUP_MKPL`) and
bundle or multipack cards. On staging a card import stayed waiting for the
operator indefinitely, so this waits on Empik's answer about card review. A
bundle or multipack whose own EAN already has a card is listed like any
product; core already sends the bundle availability as its stock.

## Returns (#4279)

The order source is also a `ReturnSourceReader` over RT11 (`GET /api/returns`):

- **Feed** (`marketplace.returns.poll`, every 15 minutes; Mirakl recommends
  RT11 at most every 5): closed `return_last_updated_from` / `_to` windows,
  the orders feed's window rules. A changed return comes back with a new
  `last_updated`, so the feed also carries transitions.
- **One return**: RT11 by `return_id`, plus the order (OR11), because RT11
  lines carry only the order line id, quantity and reason; the order adds the
  line's `offer_sku`, title and unit price that core matches lines on. A return
  the feed just read is answered from the host cache (20 minutes), so the
  per-return sync jobs after a feed cost no extra RT11 call. `return_id` comes
  from Mirakl's documentation and is not yet checked on Empik.
- **Status** (`marketplace.returns.statusSync`, hourly): re-reads up to 10 open
  returns per pass, one RT11 call each.
  Terminal states declared: `CLOSED`, `REFUSED`, `CANCELED`; `RECEIVED` and
  `NO_RECEPTION` keep being re-read.
- The reason stays Mirakl's code (`RETURN_BROKEN_ITEM`, ...).

Follows Mirakl's RT11 documentation; Empik staging has no return yet, so the
fixture is to be checked against the first real one.

## Refunds

- **Read** (`RefundSourceReader`, always on): the refunds already paid on an
  order, from OR11 `order_lines[].refunds` in state `REFUNDED`, one per line
  refund, with the payment instant (`transaction_date`) or none.
- **Send** (`RefundExecutor`, OR28 `PUT /api/orders/refund`): only on a
  connection with `refundsThroughMarketplace: true`; otherwise a confirmed
  refund is recorded as made outside OpenLinker. Core asks for one amount; it is
  spread over what is left to refund on the order's lines, product parts first,
  then shipping, with line taxes in proportion. More than is left is refused
  before sending. The reason maps to the operator's refund codes (Empik: RE02
  `REFUND`, in the operator profile).
- Mirakl takes no idempotency key, so the key is kept in the host cache: a
  retry answers from the first refund, and a retry of an attempt that did not
  finish throws (outcome unknown) instead of refunding again. No cache, no
  refund. A sent refund is `accepted`: the operator pays it out later.
- A refund OpenLinker sent is not reported by the reader once paid out, or
  core would record it a second time as made outside OpenLinker and relay it
  to the order's other channels again. The sender marks the line refunds it
  created (ids in the OR28 answer, plus ids new on the order when it is read
  back) in the host cache for 180 days, and the reader skips marked ids.

Not checked live: staging has no orders to refund.

## Catalogue and stock master (#4284)

A connection can treat the seller's Mirakl offers as the catalogue and the
stock source of truth: enable `ProductMaster` and `InventoryMaster` on it and
turn `OfferManager` off (a stock master is never also a stock write-back
target, #1498). Both are off on a new connection, which stays a marketplace.

- **Products**: each offer (OF21) is a product with one variant, keyed by
  `shop_sku`: title, description, brand, EAN, gross price and category.
  Images are the catalogue card's pictures, read from P11
  (`/api/products/offers`, up to 100 cards a call) because OF21 has none; a
  card without a picture (most Empik book cards) gives none. No VAT rate (not
  on the offer). A description that is only CSS, which some Empik cards
  return instead of text, is left out. Writing the catalogue from OpenLinker
  is refused. An
  offer that disappears from OF21 is a product deleted at the master, so its
  listings elsewhere pause.
- **Stock**: the offer quantity, pooled. A change from OpenLinker (a routed
  sale, a manual correction) reads the current quantity and queues
  `current + delta` in `mirakl_offer_writes`, under a per-offer lock, with a
  seven-day idempotency key. Mirakl takes one STO01 file per shop about every
  30 seconds (a second one inside the window answers 429, measured on Empik
  staging), so changes are never sent one by one: the `empik-master-stock-writes`
  task (every minute, `marketplace.offerQuantity.reconcile`) sends everything
  queued as one file and settles it from the import report, the #4277 path.
  Until a write is settled, the queued number stands in for OF21. Known window:
  a sale made on the marketplace between that read and Mirakl applying the
  file is written over.
- **Orders**: on such a connection order lines name the product
  (`shop_sku`) instead of the offer.
- The core master sweeps (every 20 / 15 minutes) drive both; OF21 has no
  multi-sku filter, so a sweep costs one OF21 call per product.

## Connecting

Step-by-step guide with screenshots: [docs/empik-setup-guide.md](./docs/empik-setup-guide.md).

1. In the operator's seller panel, open the user menu and generate an API key
   (Empik: "Klucz API"). One key per shop.
2. Create the connection in OpenLinker with the key and the environment
   (`production` or `staging`). Set `shopId` only when one key reaches several
   shops.
3. Set up at least one shipping zone in the seller panel (Settings, Shipping
   configuration, Shipping charges). Without one every offer stays inactive
   with `NO_MIN_SHIPPING_RATE`, and Mirakl offers no API to set it.

Empik's test platform is `https://stg1.marketplace.empik.com`; a staging key
answers 401 on production.

## Call frequency

Mirakl documents a recommended and a maximum frequency per call (Seller API
reference, "Call Frequency"); a call above the maximum answers 429 with
`Retry-After`. What the plugin does against it:

| Call | Mirakl maximum | Plugin |
|---|---|---|
| STO01 stock import | once per minute (recommended every 5) | offer writes every 5 min; master stock writes every minute, one file |
| PRI01 price import | once per minute | with the offer writes, every 5 min |
| OR11 orders | once per minute | every 5 min |
| RT11 returns | every 5 minutes | feed every 15 min (follow-up reads from the cache); status sync up to 10 calls an hour |
| A01 account | once per day | connection test only |
| OF21 / P31 | per page view | master sweeps: one OF21 per product |

Empik staging refused a second STO01 file inside about 30 seconds. The hourly
total per shop is not published in the reference, so no connection rate limit
is set. A 429 that outlives the client's own retries is deferred by the
retry classifier (Mirakl's `Retry-After`, else one minute) without spending a
job attempt.

## Mirakl rules the adapters rely on

- Webhooks are operator-only, so everything polls.
- Every write is an async import. `COMPLETE` means the file was read, not that
  every line applied: read the error lines.
- OF24 replaces the whole offer, so stock and prices go through STO01 and PRI01.
