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
- **Card match** (`EanCategoryMatcher`): P31 by EAN, up to 100 per request.
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

## Connecting

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

## Mirakl rules the adapters rely on

- Webhooks are operator-only, so everything polls.
- Every write is an async import. `COMPLETE` means the file was read, not that
  every line applied: read the error lines.
- OF24 replaces the whole offer, so stock and prices go through STO01 and PRI01.
