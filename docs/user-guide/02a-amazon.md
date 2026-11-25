# Connecting Amazon

How to connect an Amazon seller account to OpenLinker and configure it. For the other platforms see [Connecting a Platform](./02-connecting-a-platform.md).

Amazon is connected through the Selling Partner API (SP-API) with a private app you register in Seller Central. The steps on Amazon's side (registering the app, the roles to request, authorizing it to get a refresh token) are in the [Amazon setup guide](../../libs/integrations/amazon/docs/setup-guide.md#1-register-a-private-sp-api-app-and-request-roles). Have these ready before you start:

- the app's **LWA client id** and **LWA client secret**,
- the **refresh token** from authorizing the app,
- your **merchant token** (Seller Central: **Settings > Account info > Merchant token**), needed for offers and for the catalogue master.

## Step 1 — Region, environment and marketplaces

Go to **Connections > Add connection** and pick **Amazon**. The **Connect Amazon** form opens:

<!-- screenshot: Connect Amazon form - Connection name, Region (Europe), Environment (Production) and the Marketplaces picker with Germany and Poland chosen -->
![Amazon connection form — region and marketplaces](./images/02-amazon-setup-form.png)

| Field | Description |
|---|---|
| **Connection name** | A label, e.g. `Amazon EU` |
| **Region** | The SP-API region that serves your marketplaces (Europe, North America, Far East) |
| **Environment** | **Production** for your account; **Sandbox** answers with Amazon's sample data only |
| **Marketplaces** | Where orders are read and offers written. In the Far East each country is a separate account, so choose one |

Region, environment and (in the Far East) the marketplace cannot be changed after saving: another region is another seller account, so it needs another connection.

## Step 2 — What Amazon does in OpenLinker

<!-- screenshot: Connect Amazon form - "What Amazon does in OpenLinker" with Sales channel selected and "What OpenLinker handles" with Orders and Offers ticked -->
![Amazon connection form — role](./images/02-amazon-role.png)

- **Sales channel**: products come from your catalogue (for example PrestaShop); Amazon receives offers and sends orders. Tick **Orders**, **Offers** or both.
- **Catalogue master**: products and stock come from your Amazon listings and are sold on your other channels. Offers stay off.

## Step 3 — Which orders to import

When **Orders** is ticked, the form asks where order sync starts:

<!-- screenshot: Connect Amazon form - "Which orders should OpenLinker import?" with the three cards, New orders only selected (Recommended) -->
![Amazon connection form — order history](./images/02-amazon-order-history.png)

- **New orders only** (recommended): nothing placed before the connection is copied to your other shops and systems.
- **Orders since a date**: for Amazon this reads every order **updated** since that day (midnight UTC), so an older order that changed after it comes too.
- **Every order the shop has**: the whole account history. Amazon allows about one order search every three minutes, so a large history takes a long time.

Orders past Amazon's 30-day limit for buyer data arrive without the buyer's name, email and address. You can move the start or import older orders later from the connection's **Sync** tab (**Change where syncing starts...**).

## Step 4 — Credentials

<!-- screenshot: Connect Amazon form - Merchant token, LWA client id, LWA client secret, Refresh token fields and the collapsed "Order notifications (optional)" section -->
![Amazon connection form — credentials](./images/02-amazon-credentials.png)

| Field | Description |
|---|---|
| **Merchant token** | Required for offers and the catalogue master |
| **LWA client id** / **LWA client secret** | From your SP-API app |
| **Refresh token** | Issued when you authorize the app; stored encrypted |
| **Order notifications (optional)** | An SQS queue URL and AWS keys, so order changes arrive within a minute instead of at the next poll. You can add them later |

Click **Create connection**.

## Step 5 — Test the connection

Click **Test connection**. It passes (**The connection works**) when the credentials work and the account sells in every marketplace you chose; if it names a marketplace, remove it from the connection or enable selling there in Seller Central. When Amazon refuses the credentials, the test says so:

<!-- screenshot: "Amazon connection created" followed by the red "The connection test failed - Amazon refused the credentials" result -->
![Amazon connection — test failed on credentials](./images/02-amazon-test-connection.png)

Check the LWA client id and secret, or authorize the app again in Seller Central for a new refresh token, then replace them in the connection's credentials panel. **Open the connection** takes you to the connection page.

## After the connection is created

The connection works with its defaults, but most accounts need a few settings on the connection page before orders and offers flow the way you want. The buttons at the top of the connection page lead to each of them: **Edit connection**, **Mappings** and **Pricing & sync**.

## Step 6 — Amazon settings (Edit connection)

<!-- screenshot: Edit connection for an Amazon sales channel - Marketplaces, Merchant token, VAT rates of Amazon tax codes, SQS queue URL, Send refunds to Amazon, Product catalog connection -->
![Amazon connection — edit settings](./images/02-amazon-edit-settings.png)

| Setting | What it does |
|---|---|
| **Marketplaces** | Add or remove marketplaces. The order feed shares one position across marketplaces, so adding one re-reads the history of all of them (already imported orders are updated, not duplicated). |
| **Merchant token** | Needed for offers and the catalogue master. |
| **VAT rates of Amazon tax codes** | Amazon gives a listing a product tax code (e.g. `A_GEN_STANDARD`), not a rate. Add a row for each code your account uses with its VAT rate: OpenLinker reads a product's rate from it and sends the code with every offer it publishes. |
| **SQS queue URL** | Optional queue for order notifications (Step 8). |
| **Send refunds to Amazon** | When on, a refund you confirm in OpenLinker is sent to Amazon for orders you ship yourself. When off, OpenLinker only records that you refunded in Seller Central. |
| **Product catalog connection** | For a sales channel: the catalogue (for example your shop) OpenLinker uses to match Amazon listings to your products by EAN/GTIN. If the connection page shows **Product catalogue not linked**, pick one here. |
| **Outbound rate limit** / **Stock and price on this destination** | Optional: pace requests, publish less stock than you hold, or publish a different price than your catalogue. |

Region, environment and (in the Far East) the marketplace are shown but cannot be changed: another region is another seller account and needs another connection.

## Step 7 — Stock locations and Multi-Channel Fulfillment (catalogue master)

When the connection is the **Catalogue master**, the edit page also asks where Amazon's stock goes:

<!-- screenshot: Edit connection for an Amazon catalogue master - Location of the stock you ship (FBM), FBA stock location, Multi-Channel Fulfillment shipping speed -->
![Amazon connection — stock locations](./images/02-amazon-edit-stock-locations.png)

- **Location of the stock you ship (FBM)**: the warehouse location your own stock is kept in.
- **FBA stock location**: stock Amazon keeps in its warehouses is read into this location and never written from OpenLinker. FBA stock counts toward what other channels may sell, so until Amazon ships those orders for you (Multi-Channel Fulfillment), keep it at a location you do not sell from. **Do not read FBA stock** leaves it out.
- **Multi-Channel Fulfillment shipping speed**: Standard, Expedited or Priority for orders OpenLinker hands to Amazon to ship. Faster costs more. Details are in the [setup guide, section 6](../../libs/integrations/amazon/docs/setup-guide.md#6-multi-channel-fulfillment-optional).

Create the locations first: **Settings**, tile **Inventory locations** (`/inventory/locations`).

## Step 8 — Enabled roles and order notifications

The **Overview** tab lists what the connection does:

<!-- screenshot: Amazon connection Overview - Enabled roles: Order source and Marketplace offers ticked, Stock levels unavailable while OfferManager is selected -->
![Amazon connection — enabled roles](./images/02-amazon-enabled-roles.png)

Tick or untick **Order source**, **Marketplace offers**, **Product catalog**, **Stock levels** and **Order fulfilment** here. **Stock levels** and **Marketplace offers** cannot both be on: a connection that is the source of stock is never also a target OpenLinker writes stock to.

Order notifications make order changes arrive within a minute instead of at the next scheduled check. Save the **SQS queue URL** (Step 6), enter the AWS access keys under **Credentials > Re-authorize** on the same edit page (or in **Order notifications** when you create the connection), then open the **Actions** tab and click **Register queue**:

<!-- screenshot: Amazon connection Actions tab - Test connection, Edit connection, Order notifications (Register queue), Trigger sync, Disable connection -->
![Amazon connection — Actions tab](./images/02-amazon-actions-tab.png)

Registering is safe to run again. The **Actions** tab also has **Test connection**, **Trigger sync** (run any sync job now) and **Disable connection**.

## Step 9 — Mappings

**Mappings** sets how Amazon orders land in the system they are sent to:

<!-- screenshot: Mapping configuration Amazon -> Shopify - Fulfilment tab "Who ships each delivery method" with the Amazon delivery methods and a carrier per method -->
![Amazon connection — mappings](./images/02-amazon-mappings.png)

- **Fulfilment**: who ships each Amazon delivery method (`STANDARD`, `EXPEDITED`, `NEXT_DAY`, ...). Anything you leave unchanged is shipped the way it is today.
- **Order statuses**, **Carriers**, **Payments**, **Order states**: how Amazon's values are named in the destination.
- **Attribute rules**, **Delivery on documents**, **Gifts on documents**: listing attributes and what invoices and receipts show.

An order Amazon ships itself (FBA) is recorded as sent and needs no carrier.

## Step 10 — Pricing & sync

<!-- screenshot: Pricing & sync for an Amazon connection - Default pricing rule, Manual Review / Automatic, Give one source its own settings -->
![Amazon connection — pricing and sync](./images/02-amazon-pricing-sync.png)

The price published to Amazon is your catalogue price unless you set a rule here. **Manual Review** holds new prices on the **Price changes** page until you approve them; **Automatic** publishes them at once. **Give one source its own settings** sets a different margin for one supplier or warehouse.

## Step 11 — Turn on the background tasks

Amazon's background tasks (importing orders, linking listings, refreshing stock and prices, returns) are **off by default** and switched on in the worker's environment, for example `OL_AMAZON_ORDERS_POLL_SCHEDULER_ENABLED=true` for importing orders every 5 minutes. The full list and what each one does is in the [setup guide, section 7](../../libs/integrations/amazon/docs/setup-guide.md#7-background-tasks).

<!-- screenshot: Amazon connection page - Sync tab, Order import panel: "Not checked yet", "Starts on the next check: orders since 1 Nov 2026", Check for new orders -->
![Amazon connection — Sync tab](./images/02-amazon-orders-tab.png)

The connection's **Sync** tab (**Order import**) shows where syncing starts, the last check, orders imported in the last 24 hours and anything that could not be imported. **Check for new orders** runs the import at once instead of waiting for the next scheduled check; **Change where syncing starts...** moves the start to a date or the whole history.
