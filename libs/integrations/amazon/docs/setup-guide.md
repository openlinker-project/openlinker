# Amazon (SP-API) setup guide

How to connect an Amazon seller account to OpenLinker, from registering an app to a working
connection, in either role:

- **Sales channel**: products come from your catalogue (a shop or another master); OpenLinker
  publishes offers on Amazon, keeps their stock and price, and imports Amazon orders.
- **Catalogue master**: Amazon is where your products and stock live; OpenLinker reads them and
  publishes them to your other channels.

> Amazon changes its portals often. The steps follow Amazon's documentation as of November 2026;
> if a label differs, trust Amazon's screen and update this guide. Most capabilities have only been
> checked against Amazon's static sandbox; see "What is verified" at the end.

## What you need

- A **Professional** seller account. Amazon groups marketplaces into three regions (Europe including
  the UK, Middle East and India; North America including Brazil; Far East). One connection is one
  seller account in one region. In Europe and North America one account sells in all the region's
  marketplaces; in the Far East (Japan, Australia, Singapore) each country is a separate account, so
  such a connection names one marketplace.
- Access to **Solution Provider Portal** with a developer profile approved for private use.
- Your **merchant token** (Seller Central: Settings > Account Info > Your Merchant Token). The
  listings API addresses every listing by it and no API returns it, so OpenLinker asks for it.

## 1. Register a private SP-API app and request roles

In Solution Provider Portal, create an app client with **API Type: SP API** and request the roles
for the capabilities you will use:

| You want | Roles |
|---|---|
| Orders (sales channel) | Inventory and Order Tracking; **Direct-to-Consumer Shipping** for the buyer's name and address (restricted: Amazon reviews your business and how you handle personal data) |
| Offers, catalogue, stock | Product Listing, Pricing, Inventory and Order Tracking |
| FBA stock, Multi-Channel Fulfillment | **Amazon Fulfillment** |
| Returns and refunds | Selling Partner Insights (reports), Product Listing |
| Order notifications (SQS) | Notifications are open to every app; no extra role |

Without Direct-to-Consumer Shipping, orders arrive without a delivery address and cannot be sent to
a shop or a carrier.

Open the app's **LWA credentials** and copy the **client identifier** and **client secret**.

## 2. Authorize the app

In the app list choose **Authorize**. Amazon issues a **refresh token** (`Atzr|...`). Copy it right
away; Amazon allows ten self-authorizations per app. If Amazon later revokes it, the connection
moves to **Needs reauth**: authorize again and paste the new token on the connection page.

## 3. Create the connection

**Connections > Add connection > Amazon** opens the guided form:

1. **Region** and **environment**. Production talks to your account; sandbox to Amazon's static
   sandbox (canned answers only, see below). Both are fixed after saving: another region is another
   seller account with its own refresh token, so authorize the app in that region's Seller Central
   and create another connection.
2. **Marketplaces** you sell in, picked from a searchable list of the chosen region's marketplaces
   (e.g. PL `A1C3SOZRARQ6R3`, DE `A1PA6795UKMFR9`). Prices read from a marketplace keep its currency.
3. The **role**: a sales channel (**Orders** and/or **Offers**) or the catalogue master (below). With
   offers on, or as the catalogue master, the **merchant token** is required.
4. The **LWA client id**, **client secret** and **refresh token** from steps 1-2.
5. **Test connection**: it passes when the credentials work and the account sells in every
   marketplace you listed. If it names a marketplace, remove it or enable selling there.

Credentials are stored encrypted and never shown again; replace them in the connection's
credentials panel.

### Catalogue master role

Choose **Catalogue master** as the role in the guided form (orders optional, offers off), or on an
existing connection open the edit page and, under **Enabled roles**, turn on:

- **ProductMaster**: your listings become OpenLinker products. A variation parent is a product and
  its child SKUs are the variants; a standalone listing is a product with one variant. Title,
  description, images and EAN come from your listing, falling back to the ASIN's catalogue entry
  only for what the listing lacks. Amazon carries a tax code rather than a VAT rate: under **VAT
  rates of Amazon tax codes** in the Amazon section, give each code your account uses its rate
  (e.g. `A_GEN_STANDARD` 23, `A_BOOKS_GEN` 5), or the rate reads as not known. The same map sends
  the code back with every offer OpenLinker publishes, and a tax rate change on an offer changes
  its code; a rate no code (or two codes) maps to sends none.
- **InventoryMaster**: seller-fulfilled (FBM) stock from your listings becomes OpenLinker stock and
  is published to your other channels. A manual stock correction in OpenLinker is written back to
  Amazon. While a connection is the stock master, OpenLinker does not write quantities back to its
  own listings.

Then run a catalogue sync from the connection page. Point your other channels' connections at this
one as their catalogue source.

### FBA stock (optional, stock master)

To see Amazon-warehouse (FBA) stock, create a location for it on OpenLinker's **Inventory locations** page (`/inventory/locations`),
then on the Amazon connection:

1. In the Amazon section, choose the **Location of the stock you ship (FBM)**. (With the OMS routing
   UI on, the same setting is "Assign a location to this connection's stock" under **Stock and price
   on this destination** instead.)
2. Choose the **FBA stock location**, a different one.

OpenLinker refuses the FBA location without the FBM one: both kinds of stock must be at separate
locations or one would replace the other. FBA stock is never written from OpenLinker. It counts
toward what your other channels may sell, so until you also use Multi-Channel Fulfillment (below)
keep the FBA location one you do not route orders from.

## 4. Order notifications (optional)

Without notifications OpenLinker polls orders every five minutes. With an Amazon SQS queue an order
arrives within about a minute:

1. In AWS, create a standard SQS queue in the region of your marketplaces (EU: `eu-west-1`).
2. Give Amazon permission to send to it: in the queue's access policy allow
   `sqs:SendMessage` and `sqs:GetQueueAttributes` for principal
   `arn:aws:iam::437568002678:root` (Amazon's notification account).
3. Create an IAM user for OpenLinker with `sqs:ReceiveMessage`, `sqs:DeleteMessage` and
   `sqs:GetQueueAttributes` on that queue, and an access key for it.
4. On the connection: paste the **SQS queue URL**, the **AWS access key id** and **secret access
   key**, save, then press **Register queue**.

Amazon has no HTTP webhooks for orders; the queue is the only push channel.

## 5. Returns and refunds (optional)

- **Returns** of orders you ship yourself are read from Amazon's returns report: OpenLinker requests
  it at most once an hour and reads it when Amazon has built it, so a return appears within about
  an hour or two. Returns of orders Amazon ships (FBA) are handled by Amazon.
- **Refunds**: tick **Send refunds to Amazon** on the connection. A refund confirmed in OpenLinker is
  sent through Amazon's payment adjustment feed, split over the returned items, once even after a
  retry. Each item takes at most what the buyer paid for it after discounts; where tax is added on
  top of the price (US, Canada) the refund is split into price and tax. Shipping is not refunded
  this way, so an amount above the items' price is refused. Without it, OpenLinker only records that you refunded in Seller Central. Amazon refunds FBA
  orders itself; such a refund is refused.

## 6. Multi-Channel Fulfillment (optional)

With the **Amazon Fulfillment** role and FBA stock, Amazon can pack and ship orders from your other
channels. The connection must be the stock master with an FBA location (above): that is where
OpenLinker learns which Amazon SKU each variant is.

1. Turn on **FulfillmentExecutor** under **Enabled roles**, and enable the OpenLinker OMS with
   routing to the FBA location. Orders go to Amazon on the marketplace the catalogue and FBA stock
   are read from.
2. OpenLinker must store buyer data (`OL_STORE_PII=true`, the default): Amazon needs the delivery
   address, and OpenLinker sends it only to the holder that ships the parcel.
3. Optional: **Multi-Channel Fulfillment shipping speed** in the Amazon section (Standard,
   Expedited or Priority; Standard when unset). Fees and packaging are set in Seller Central.

An order Amazon cannot fulfil (not in FBA stock, an unknown SKU) is refused with Amazon's reason,
and routing tries elsewhere. Cancelling in OpenLinker cancels the Amazon order until Amazon starts
processing it.

Known gap: OpenLinker does not yet ask Amazon for the progress of an MCF order, so shipped units
and the tracking number do not come back to OpenLinker or to the order's channel on their own.

## 7. Background tasks

Every Amazon task is off by default; turn on what you use in the worker's environment:

| Variable | What it does |
|---|---|
| `OL_AMAZON_ORDERS_POLL_SCHEDULER_ENABLED` | imports orders every 5 minutes |
| `OL_AMAZON_NOTIFICATIONS_DRAIN_SCHEDULER_ENABLED` | reads the SQS queue every minute |
| `OL_AMAZON_OFFERS_SYNC_SCHEDULER_ENABLED` | links your listings to OpenLinker variants by SKU, hourly |
| `OL_AMAZON_OFFER_STATUS_SYNC_SCHEDULER_ENABLED` | refreshes each listing's status, price and stock, hourly |
| `OL_AMAZON_RETURNS_POLL_SCHEDULER_ENABLED` | reads the returns report |
| `OL_AMAZON_RETURNS_STATUS_SYNC_SCHEDULER_ENABLED` | refreshes open returns, hourly |

Amazon's quotas are low (order search allows about one call every three minutes with a burst of 20),
which is why the tasks run as slowly as they do.

## Personal data

Amazon's Data Protection Policy allows keeping a buyer's personal data at most 30 days after
delivery. OpenLinker removes buyer addresses, email, note and tax id from Amazon orders 30 days
after the order's ship-by deadline (earlier than Amazon's limit, since OpenLinker does not always
know the delivery date), and a later re-import does not store them again.

## Sandbox and probes

`environment: sandbox` points at Amazon's **static sandbox**: it answers only requests whose
parameters match Amazon's canned examples, and otherwise answers 400 "Could not match input
arguments". Use it to check that credentials and requests are formed correctly, not to test
behaviour; nothing it returns describes your account.

To see what Amazon answers for each capability, run the probes with your app's credentials:

```bash
AMAZON_CLIENT_ID=... AMAZON_CLIENT_SECRET=... AMAZON_REFRESH_TOKEN=... \
AMAZON_ENVIRONMENT=sandbox AMAZON_SELLER_ID=... AMAZON_SKU=... \
pnpm amazon:probe
```

They are read-only and print the structure of each answer, never its values. `--values` prints the
sandbox's canned data and is refused in production, where answers carry buyer data. `--only=orders,listings` runs a subset. Never run them in CI.

## What is verified

Checked against the static sandbox: connection test, listing reads, product types, a single-listing
catalogue import. Not yet checked on a live account: the order feed with real orders, the FBA
inventory, returns report and adjustment feed columns, and every Multi-Channel Fulfillment call
(which has no sandbox).
