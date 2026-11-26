# Manual walkthrough - Amazon (Selling Partner API)

Marketplace connection to Amazon through `@openlinker/integrations-amazon` (adapter key `amazon.spapi.v1`, platform type `amazon`, Login with Amazon refresh-token auth). Target markets of the first release are DE, then FR and PL; the plugin knows 23 marketplaces in three regions.

This is a checklist to be walked by hand, not a record of a finished run. Format follows `01-presta-woo-allegro-erli-inpost-dpd-ksef/`: Part A / B / C, each point an action and its expected result, `> **Finding:**` blocks where the code, the docs and the plan disagree. A tickable version with screenshot slots exists as a published artifact built from the same point list.

**Point kinds**: `ui` click through the admin UI; `api` curl, DB or worker check; `auto` run an existing spec; `live-only` needs real Amazon credentials (and often a production app with extra roles) and cannot be done on the static sandbox. For every `live-only` point the line says what to check instead.

## Prerequisites

- A running demo stack (`pnpm demo:up` or the isolated stack you use), web on :8090 (admin / admin), API on :3000, worker running with the scheduler role.
- Branch `4176-amazon-integration` (or a stack built from it) with the four parallel fixes included: **order line mapper (seller SKU is the product reference and resolves to the master variant), order sync start modes (now / from / all) plus window import, publicConfig arrays (marketplaceIds shown as a list), and the refund dialog for Amazon (send to Amazon when refundsEnabled)**. Points below describe the FIXED behaviour; a failure on exactly those four on an unfixed build is expected and should be recorded, not filed.
- A master catalogue connection (PrestaShop or WooCommerce) with a few products carrying EAN and a SKU that you can also create as Amazon SKUs, for the offer and order-mapping points.
- Roles: one admin, one operator, one viewer account (Settings > Users).
- For anything not marked live-only: Amazon's **static sandbox** (`environment: "sandbox"`) answers canned data whatever is asked; it only proves wiring, not behaviour. Fake LWA credentials are fine for form, validation and failure-path points.
- For live-only points: a Professional seller account in the EU, a private SP-API app authorized for it (refresh token `Atzr|...`), roles Direct-to-Consumer Shipping (restricted; without it orders arrive without buyer address), Amazon Fulfillment (MCF), Notifications; for SQS an IAM user with `sqs:ReceiveMessage` and `sqs:DeleteMessage` and a queue whose policy lets Amazon send to it. See `libs/integrations/amazon/docs/setup-guide.md`.
- Worker env vars (all default OFF, read by the worker, not the API): `OL_AMAZON_ORDERS_POLL_SCHEDULER_ENABLED`, `OL_AMAZON_RETURNS_POLL_SCHEDULER_ENABLED`, `OL_AMAZON_RETURNS_STATUS_SYNC_SCHEDULER_ENABLED`, `OL_AMAZON_NOTIFICATIONS_DRAIN_SCHEDULER_ENABLED`, `OL_AMAZON_OFFERS_SYNC_SCHEDULER_ENABLED`, `OL_AMAZON_OFFER_STATUS_SYNC_SCHEDULER_ENABLED`.

## How to run

1. Boot the stack and the worker; log in as admin.
2. Walk the sections in order. Parts A and C need no Amazon account except where a point says live-only. Section 12 (scheduler) is easiest right after section 5 because it reuses that connection.
3. Tick each point; put the connection id, job id or order id in the note. Take a screenshot for every `ui` point that surprises you.
4. Offline substitute for the whole plugin: `pnpm --filter @openlinker/integrations-amazon test` and `pnpm --filter @openlinker/web test amazon`.

## Discrepancies found while preparing this checklist

1. Tasks: code registers 6 scheduler tasks (orders-poll, returns-poll, returns-status-sync, notifications-drain, offers-sync, offer-status-sync). README and setup guide describe 4. No document found on the branch lists two tasks that are absent from code; the checklist treats the 6 in code as the truth and flags that no inventory/MCF task exists.
2. amazon:probe: not present anywhere (no package.json script, no file). Only dev:stack:shopify-probe exists. Section 12 says so.
3. README is stale: its status paragraph stops at #4178 (OrderSource) and says "Creating new listings (#4181)" is not yet built, while the code ships OfferCreator, CategoryBrowser, EanCategoryMatcher (#4181), ProductMaster (#4182), InventoryMaster (#4183), ReturnSourceReader and refunds (#4184), the MCF executor (#4185) and a web setup form (#4186). It also lists no returns tasks and no refundsEnabled, mcfShippingSpeed, fbaLocationId, catalogueMarketplaceId or taxCodeRates keys.
4. notificationQueueUrl vs notificationQueue: the stored key is notificationQueueUrl everywhere; notificationQueue is only the parsed in-memory shape. See the note in Part A section 3.
5. orderSyncStartModes is [] in the manifest on this branch (comment: no start choice, fixed 7-day bootstrap). The parallel fix adds modes now / from / all and window import; points in section 5 assume the fixed behaviour.
6. Bundles: nothing in libs/integrations/amazon mentions bundles. The refusal expected in section 7 must come from core (bulk wizard / bundle rules); the checklist asks the tester to record the actual wording.

## Part A - Connection and configuration

### 1. Connection wizard

Guided form at Connections > New connection > Amazon. One connection is one seller account in one region.

1. [ ] `ui` **Open the connection catalogue and find the Amazon card.** (`Connections > New connection`)  
   -> Card "Amazon" with badge "Marketplace" and the description "Sell on Amazon: import orders, link and publish listings, keep stock and prices in sync."
2. [ ] `ui` **Open the Amazon setup page.** (`Connections > New connection > Amazon`)  
   -> Notice "One connection is one Amazon seller account in one region" with the three lines (one account per region, Far East exception, region fixed).
3. [ ] `ui` **Leave every field empty and press "Create connection".**  
   -> Required-field errors under name, marketplaces, LWA client id, client secret and refresh token; nothing is created.
4. [ ] `ui` **Choose region Europe (EU) and open the marketplace picker.**  
   -> Only EU marketplaces are listed (16); each option reads "{country} ({currency})".
5. [ ] `ui` **Select DE, change the region to North America, then back to EU.**  
   -> Switching region drops the marketplaces the new region does not serve; the form never keeps a mixed set.
6. [ ] `ui` **Choose region Far East (FE) and try to select two marketplaces.**  
   -> The picker accepts one only; the hint explains that each country is a separate seller account.
7. [ ] `ui` **Choose environment Sandbox.**  
   -> Notice that the sandbox answers with Amazon sample data only; nothing real is read or changed.
8. [ ] `ui` **Under "What Amazon does in OpenLinker" pick "Sales channel", then "Catalogue master".**  
   -> Sales channel offers Orders and Offers; Catalogue master offers products and stock and keeps Offers off, with the hint that a master's stock is not written back to its own listings.
9. [ ] `ui` **Tick Offers and leave the merchant token empty.**  
   -> Error "The merchant token is required to manage offers"; with Offers unticked the token is optional.
10. [ ] `ui` **Enter a merchant token with lower-case letters or fewer than 8 characters.**  
   -> Error "Enter the merchant token ... 8 to 20 capital letters and digits".
11. [ ] `ui` **Enter an SQS queue URL that is not of the form https://sqs.<region>.amazonaws.com/<12-digit account>/<name>.**  
   -> Error "Enter an SQS queue URL, such as ..."; an empty field is accepted (queue is optional).
12. [ ] `ui` **Enter only one of the two AWS keys.**  
   -> Error "Enter both AWS keys, or neither."
13. [ ] `ui` **Fill a valid EU / production / DE connection (Orders ticked, fake credentials) and create it.**  
   -> Toast "Amazon connection created", link "Open the connection", the connection is listed with platform Amazon and status Active.
14. [ ] `api` **Read the stored connection through the API.** (`GET /v1/connections/:id`)  
   -> GET /v1/connections/:id shows platformType amazon, adapterKey amazon.spapi.v1, config with region, environment, marketplaceIds as an array; no secret field anywhere in the response.
15. [ ] `ui` **Log in as a viewer and open the Amazon setup page.**  
   -> The form is replaced by "Read-only access" (your account can view connections but not create them).

### 2. Marketplaces (23 known)

The plugin knows 23 marketplaces: NA 4 (CA US MX BR), EU 16 (IE ES GB FR BE NL DE IT SE ZA PL EG TR SA AE IN), FE 3 (SG AU JP). An id outside the table is accepted by format alone.

16. [ ] `auto` **Run the config-policy and web marketplace specs.** (`pnpm --filter @openlinker/integrations-amazon test; pnpm --filter @openlinker/web test amazon`)  
   -> Both pass; the web list (features/amazon/lib/amazon-marketplaces.ts) and the backend table (AMAZON_KNOWN_MARKETPLACES) agree on all 23 ids, countries and currencies.
17. [ ] `api` **POST a connection with region eu and marketplace ATVPDKIKX0DER (US).** (`POST /v1/connections`)  
   -> 400 with issue marketplaceIds.0 "marketplace ATVPDKIKX0DER (US) is served by the na region, not eu".
18. [ ] `api` **POST a connection with an unknown but well-formed id (10-14 upper-case letters/digits).** (`POST /v1/connections`)  
   -> 201; the id is accepted by format alone. A lower-case or 5-character id gets 400 "must be an Amazon marketplace id".
19. [ ] `api` **POST a connection with an empty marketplaceIds array.** (`POST /v1/connections`)  
   -> 400 "must list at least one Amazon marketplace id".
20. [ ] `api` **POST an fe connection with two marketplaces.** (`POST /v1/connections`)  
   -> 400 "the fe region has a separate seller account per marketplace; choose one marketplace ...".
21. [ ] `api` **POST an eu connection listing DE twice.** (`POST /v1/connections`)  
   -> Accepted; the stored list is de-duplicated (DE once).
22. [ ] `ui` **On the offer wizard for an EU connection with DE + PL, pick offer currency EUR, then PLN.** (`Listings > Create offer`)  
   -> EUR lists the offer on DE only; PLN on PL only ("Offers go to: ..."). A connection with no known marketplace shows "no offer can be listed".

### 3. Config keys on the connection page

Edit connection renders the plugin section from enabledCapabilities, never from platformType. Every key is also validated server-side (PATCH /v1/connections/:id).

23. [ ] `ui` **Open Edit on the connection from section 1.**  
   -> Region and environment are shown but not editable ("Set when the connection was created").
24. [ ] `api` **PATCH the connection changing region eu -> na.** (`PATCH /v1/connections/:id`)  
   -> 400 "cannot change from eu to na: another region is another seller account; create a new connection for it". An unrelated save on a connection stored without region does not trip it.
25. [ ] `ui` **Add a marketplace (PL) to a connection that already ingested orders and save.**  
   -> Note "Orders from a marketplace you add are read from the last 7 days"; after the next poll PL orders from the last 7 days arrive and the existing watermark is not moved forward.
26. [ ] `ui` **Enable Offers on the connection without a merchant token.**  
   -> Hint "Without the merchant token, offers cannot be read or written."; saving a malformed token is refused.
27. [ ] `api` **PATCH config.sellerId = "a2bad".** (`PATCH /v1/connections/:id`)  
   -> 400 "must be the merchant token from Seller Central, such as A2EXAMPLE12345".
28. [ ] `ui` **With the catalogue enabled, open "Catalogue marketplace" and choose the second marketplace.**  
   -> catalogueMarketplaceId is saved; price, currency and tax-rate country now follow that marketplace. "First marketplace (...)" is the default. Reordering marketplaceIds never moves the catalogue.
29. [ ] `api` **PATCH catalogueMarketplaceId to an id that is not in marketplaceIds.** (`PATCH /v1/connections/:id`)  
   -> 400 "must be one of the connection's marketplaceIds".
30. [ ] `ui` **Add taxCodeRates rows: A_GEN_STANDARD = 23, A_GEN_REDUCED = 8, then one invalid row.**  
   -> Valid rows save (codes stored upper-case, rates canonical); the invalid row shows "Each row needs a tax code and a rate such as 23, 8, 0 or zw." With no rows: "the VAT rate of Amazon products is not known".
31. [ ] `api` **PATCH taxCodeRates as an array, and as {"X": "abc"}.** (`PATCH /v1/connections/:id`)  
   -> Array: 400 "must map Amazon product tax codes to rates"; bad rate: 400 on taxCodeRates.X. A rate of zw / np / oo is accepted.
32. [ ] `ui` **As stock master, set "Location of the stock you ship (FBM)" (stockLocationOverride) and then "FBA stock location" (fbaLocationId) to a different location.**  
   -> Both save. Choosing FBA first, without FBM, shows the hint that FBM location is needed too.
33. [ ] `api` **PATCH fbaLocationId equal to stockLocationOverride, and fbaLocationId without stockLocationOverride.** (`PATCH /v1/connections/:id`)  
   -> Both 400: "must differ from the stock location of the seller-fulfilled stock" and "needs a stock location for the seller-fulfilled stock (stockLocationOverride) as well".
34. [ ] `ui` **Tick "Send refunds to Amazon" (refundsEnabled), save, reload.**  
   -> The checkbox persists; unticking stores an explicit false, not a deleted key. A non-boolean through the API gets 400 "must be true or false".
35. [ ] `ui` **Set "Multi-Channel Fulfillment shipping speed" to Priority, save, reload; then clear it.**  
   -> Standard / Expedited / Priority are offered; cleared means Standard. API value "Overnight" gets 400.
36. [ ] `ui` **Enter a notificationQueueUrl in the form, save, reopen Edit.**  
   -> The URL round-trips unchanged. Findings: see the note below on the key name.
37. [ ] `ui` **Open a connection whose stored config carries marketplaceIds as an array and inspect the public config shown on the page.**  
   -> After the publicConfig fix the array renders as a list of marketplaces (not "[object Object]" or dropped); before it, marketplaces were missing from the read-only view.
38. [ ] `ui` **Log in as a viewer and open Edit on the Amazon connection.**  
   -> Values are visible, inputs are disabled, no save button.

> **Finding:** notificationQueueUrl vs notificationQueue: the key an operator stores (API, form, schema, scheduler filter, webhook install) is notificationQueueUrl. The name notificationQueue appears only on the PARSED config object inside the plugin (parseAmazonConfig turns the URL into { url, region, arn } and the factory reads config.notificationQueue). So there is no second stored key; if you find notificationQueue in a stored config, that is a manual-edit mistake and the queue will be ignored. Keep a check on this when reading logs or code.

### 4. Credentials and connection test

39. [ ] `api` **POST credentials without refreshToken, then with an unknown source value.** (`POST /v1/connections`)  
   -> 400 "must include a non-empty `refreshToken` string" and "`source` must be one of: ...". The message never echoes a secret.
40. [ ] `api` **POST credentials with awsAccessKeyId but no awsSecretAccessKey.** (`POST /v1/connections`)  
   -> 400 "must include both `awsAccessKeyId` and `awsSecretAccessKey` ..., or neither".
41. [ ] `ui` **Open the credentials panel on the Edit page.** (`Edit connection > Credentials`)  
   -> Status "Stored" (encrypted); fields clientId, clientSecret, refreshToken, optional AWS pair; "Leave both AWS keys empty to keep the ones already stored".
42. [ ] `ui` **Save new credentials (fake) and reopen.**  
   -> Toast "Credentials saved - the connection uses the new credentials from now on"; the panel shows "Stored" again and shows no value.
43. [ ] `live-only` **Run Test connection with real production credentials and every configured marketplace participating.** (`Edit connection > Test connection`)  
   -> Green: "The connection works". live-only. Without credentials: against the sandbox the test passes and skips the participation check; with fake credentials expect a bounded "unauthorized" message.
44. [ ] `live-only` **Run Test connection on production with a marketplace the seller does not sell in.**  
   -> Fails and names the missing marketplace. live-only; offline check: the connection-tester spec covers it.
45. [ ] `ui` **Run Test connection with fake credentials (production).**  
   -> Failed state with a short sentence ("unauthorized"); no host name, token or secret in the message. Record whether the connection status flips to Needs reauth (the auth-failure classifier does so for jobs; the plain test may not).
46. [ ] `ui` **Re-authorize: replace the credentials after a Needs reauth.**  
   -> Re-authorize in the panel saves new credentials; after a green test the status returns to Active.

## Part B - Data flows

### 5. Orders

OrderSource is opt-in (defaultEnabledCapabilities is empty). Feed = Orders API v2026-01-01 searchOrders by lastUpdatedAfter; the cursor is a watermark plus pagination token. After the order start modes fix the wizard offers now / from / all plus a window import, matching the other marketplaces.

47. [ ] `ui` **Create a connection with Orders ticked; open the order-sync start choice.** (`Setup form / Edit connection`)  
   -> After the fix: modes now, from (date) and all are offered, as for Allegro. Before it the manifest declared none and the first poll silently read a fixed recent window.
48. [ ] `ui` **Choose start mode "now" and save.**  
   -> Existing Amazon orders are not imported; only orders updated after the connection was created arrive on later polls.
49. [ ] `ui` **Choose start mode "from" with a date 14 days ago.**  
   -> Only orders updated on or after that date are imported on the first poll; older ones are not.
50. [ ] `ui` **Choose start mode "all".**  
   -> The first poll walks the whole available history in pages; no page is skipped (cursor advances only after every enqueue succeeded).
51. [ ] `ui` **Run a window import for a closed date range.**  
   -> The orders of that window are imported once; re-running the same window creates no duplicates.
52. [ ] `live-only` **Enable amazon-orders-poll and wait one tick (5 min).** (`Jobs page; /orders`)  
   -> A marketplace.orders.poll job per connection succeeds; new orders appear in /orders with source Amazon. live-only; offline check: run the order-source specs and read the job row created by a manual enqueue.
53. [ ] `api` **Read the stored cursor after a poll.** (`DB: connection_cursors`)  
   -> connection_cursors key amazon.orders.feedCursor holds JSON { since, paginationToken?, tokenIssuedAt?, marketplaceIds }; since is the window end minus the 2-minute overlap.
54. [ ] `auto` **Run the feed-cursor policy specs.** (`amazon-order-feed-cursor.policy.spec.ts`)  
   -> Cases pass: no cursor = 7 days back; expired token (24 h) restarts the window from the watermark; unreadable cursor bootstraps instead of wedging; a new marketplace moves the watermark back, never forward.
55. [ ] `ui` **Open an imported FBM order in /orders.**  
   -> Lines show seller SKU as the product reference (productRef = SKU; ASIN only as a fallback when a line has no SKU) and resolve to the master variant of that SKU after the mapper fix. An unresolved SKU shows the order as awaiting mapping, not as a failure.
56. [ ] `ui` **Check the money on that order.**  
   -> Each line is what the buyer paid after discounts; shipping carries gift wrap, COD fee and similar; lines + shipping equal the grand total; total tax treatment is inclusive. For European marketplaces line prices are gross; no tax rate is shown (Amazon reports amounts, never a rate).
57. [ ] `live-only` **Open an order whose seller app has the Direct-to-Consumer Shipping role.**  
   -> Shipping address, buyer name and relay e-mail (...@marketplace.amazon.<tld>) are stored. live-only.
58. [ ] `ui` **Open an order imported without that role (or from the sandbox fixtures).**  
   -> No shipping address; metadata amazonShippingAddressWithheld is true; nothing is guessed. Record what a dispatch or MCF dispatch from that order says.
59. [ ] `ui` **Open an FBA order (fulfilled by Amazon).**  
   -> Marked as fulfilled by the source; routing never sends it to the pack bench; no label or dispatch action is offered.
60. [ ] `ui` **Open a cash-on-delivery order and a PENDING order.**  
   -> COD shows the CashOnDelivery payment method; PENDING (payment not authorized) is not marked paid, every other online order is paid.
61. [ ] `ui` **Dispatch an FBM order with a label that has a tracking number.** (`/orders > order > Shipment`)  
   -> Order status write-back sends confirmShipment for every line with Amazon's carrier code; the order shows the status as relayed. Dispatch without a tracking number is reported unsupported, then relayed once the waybill appears.
62. [ ] `ui` **Dispatch a multi-parcel order with a second tracking number.**  
   -> Known limit: the event names no lines, so the order is confirmed in full with the first parcel and Amazon refuses the second. Record the behaviour; do not report as a regression.
63. [ ] `ui` **Cancel or mark delivered an Amazon order in OpenLinker.**  
   -> Write-back is reported unsupported for cancelled, delivered, in-progress and paid (no seller call exists); nothing is sent and nothing fails.
64. [ ] `ui` **Open the mapping UI option lists for the Amazon connection (order statuses, delivery methods, payment methods).** (`Settings > Mappings`)  
   -> Lists load without error and contain Amazon's vocabulary.

### 6. Buyer data retention (30 days)

The manifest declares buyerDataRetentionDays: 30. The worker maintenance role runs the order buyer-data retention pass hourly.

65. [ ] `api` **Read the adapter manifest.** (`GET /v1/adapters`)  
   -> GET /v1/adapters lists amazon.spapi.v1 with buyerDataRetentionDays 30.
66. [ ] `ui` **Look for any retention statement on the Amazon connection page and in the setup form.**  
   -> None is shown on this branch (no retention text in the Amazon locale files). Record whether the page should say that buyer data is removed 30 days after the ship-by deadline; this is a gap to decide, not a failure.
67. [ ] `auto` **Run the retention service specs and the worker maintenance integration spec.** (`buyer-data-retention.service.spec.ts`)  
   -> Pass: addresses reduced to the country, e-mail, buyer note, tax id, operator address edit and search-text buyer removed; lines, amounts, statuses and ids stay; a re-import stores none of it again.
68. [ ] `api` **Backdate an Amazon order's ship-by deadline to 31 days ago in the DB and wait for the hourly pass (or trigger the maintenance task).** (`DB: order_records`)  
   -> The order keeps lines and amounts but shows only the country as address and no e-mail; the delivery records of its buyer-e-mail and document e-mail have the recipient cleared; customer projections last seen through Amazon before the cutoff lose e-mail, names and street.
69. [ ] `api` **Re-import the same order (poll or manual sync) after retention.**  
   -> None of the removed personal data comes back.

> **Finding:** The anchor is ship-by + 30 days (placement when no deadline), both earlier than delivery. Whether this or "30 days after delivery" is the legal anchor is a decision for the owner; the test above only verifies the implemented rule. Not covered yet: a shipment recipient and the history of an address edit keep their copy; issued sales documents keep theirs by law; a label already generated keeps the printed recipient.

### 7. Offers and listings

OfferManager needs the merchant token (sellerId). An Amazon offer is addressed by the seller SKU: the offer id in OpenLinker IS the SKU. Reads use the first configured marketplace.

70. [ ] `ui` **Enable amazon-offers-sync (hourly) or run marketplace.offers.sync by hand for a connection with OfferManager and a sellerId.** (`Jobs; /listings`)  
   -> The seller's listings are listed 20 a page by SKU and offer mappings are created for variants whose SKU matches; linking by EAN is not done.
71. [ ] `ui` **Check a connection with OfferManager but no sellerId.**  
   -> amazon-offers-sync and amazon-offer-status-sync are not scheduled for it at all (no job rows).
72. [ ] `ui` **Open /listings for the Amazon connection.** (`/listings`)  
   -> Linked listings show with the SKU as external id; an FBA listing is marked fulfilledByAmazon.
73. [ ] `ui` **Open the bulk offer wizard for an Amazon connection with one product that has an EAN known to Amazon.** (`Listings > Create offer`)  
   -> Category step resolves the product type and the ASIN as product card (EAN match through Catalog Items); the offer currency selector lists the connection's marketplace currencies.
74. [ ] `ui` **Browse categories in the wizard for Amazon.**  
   -> Product types are listed as a flat list for the marketplace; selecting one loads its required simple attributes as parameters.
75. [ ] `live-only` **Submit an offer on an existing ASIN.**  
   -> Offer-only listing created (LISTING_OFFER_ONLY), SKU derived from the variant, record shows "validating" then the real status after the status sync. live-only; offline check: OfferCreator specs for payload and SKU derivation.
76. [ ] `live-only` **Submit an offer with no ASIN (new catalogue item) with title, brand, EAN, description, images.**  
   -> LISTING under the chosen product type. live-only.
77. [ ] `ui` **Submit an offer for a product with no barcode and no ASIN.**  
   -> Refused with a clear message (Amazon's GTIN exemption is granted in Seller Central only).
78. [ ] `ui` **Submit the same variant twice.**  
   -> The second create addresses the same derived SKU and is reported as already existing, not overwritten.
79. [ ] `ui` **Try to create an Amazon offer from a bundle or multipack product.**  
   -> The wizard blocks it or the batch refuses it with a bundle-specific reason; an offer is not created. Record exactly what the wizard says; if it is accepted, report it.
80. [ ] `live-only` **Change master stock for a linked FBM SKU and wait for propagation.**  
   -> patchListingsItem replaces fulfillment_availability on channel DEFAULT with the buffered quantity; quantity 0 pauses the listing; the listing is never deleted. live-only; offline check: offer-manager spec asserts the patch body.
81. [ ] `ui` **Change stock for an FBA SKU.**  
   -> The write is skipped with a warning log (its stock is Amazon's), the job succeeds, no failed write remains.
82. [ ] `live-only` **Change the offer price in OpenLinker.**  
   -> purchasable_offer is replaced, gross, for each marketplace whose currency equals the price currency (FR/DE EUR, PL PLN); title, description and tax rate are refused. Note: replacing the attribute clears a sale price and min/max bounds set in Seller Central. live-only.
83. [ ] `live-only` **Enable amazon-offer-status-sync and wait for a tick.**  
   -> BUYABLE reads as active, ERROR issues become validation errors, live price and quantity appear as "on channel"; a listing Amazon no longer has (404) becomes ended and can be listed again. live-only.
84. [ ] `api` **Make Amazon answer INVALID on a patch (static sandbox or a stub).**  
   -> The write is rejected with Amazon's issue text; putListingsItem is never used for an update.

### 8. Catalogue master and FBA inventory

ProductMaster reads the seller's own listings as a catalogue (read side only). InventoryMaster reads FBM from the listings and FBA from FBA Inventory API at fbaLocationId. A connection cannot be InventoryMaster and OfferManager together.

85. [ ] `ui` **Create an Amazon connection as "Catalogue master" and run the product sweep (master.product.syncAll).**  
   -> Products appear with SKU as external id; variation parents are products, child SKUs are variants; a standalone listing is a product with one variant.
86. [ ] `ui` **Open an Amazon-sourced product.**  
   -> Seller listing attributes fill content; the ASIN's catalogue entry only fills a missing title, images or EAN; price is gross in the catalogue marketplace's currency.
87. [ ] `ui` **Try to enable both Offers and Inventory master on one Amazon connection.**  
   -> Refused (rule #1498): the master is never a write-back target; the form keeps Offers off for a catalogue master.
88. [ ] `live-only` **Run the inventory sweep for a master connection with stockLocationOverride set and no fbaLocationId.**  
   -> One FBM position per variant at the override location; FBA stock is not read. live-only; offline: inventory-master spec.
89. [ ] `live-only` **Set fbaLocationId (different from the FBM location) and sweep again.**  
   -> FBA fulfillable units appear as available and Amazon's reservations as reserved at the FBA location; every variant gets a FBA position (zero when Amazon lists none). live-only.
90. [ ] `ui` **Set fbaLocationId without a stock location override in the DB directly and sweep.**  
   -> FBA stock is not reported (the contradiction guard); the sweep does not retire the FBM position.
91. [ ] `ui` **Check the stock-at-risk and availability for a variant with FBA stock at a location "you do not sell from".**  
   -> FBA stock counts toward what other channels may sell (the page warns about it); the quantity matches FBM + FBA available.
92. [ ] `api` **Call adjustInventory (stock adjustment) on an FBM variant, then on a FBA position and on an FBA listing.**  
   -> FBM: patch with the new quantity, idempotency honoured for 7 days when a cache exists (else reported unsupported), appliedAt null. FBA position and FBA listing: refused. Not atomic by Amazon design (a sale between read and patch is overwritten) - note, do not file.
93. [ ] `api` **Delete a listing at Amazon (or use a stub 404) and re-sweep the product.**  
   -> MasterProductNotFoundError path: variants become stale, master.product.stale is emitted, offers on other channels are paused; a missing identifier mapping or an unreadable quantity stays a retryable error, never zero and never a deletion.
94. [ ] `auto` **Run the taxCodeRates reader specs.**  
   -> A mapped tax code gives a rate; an unmapped one reports "not configured"; the rate is never defaulted.

### 9. Multi-Channel Fulfillment (executor)

FulfillmentExecutor over Amazon MCF with the polling FulfillmentStatusSource. Needs the "Amazon Fulfillment" role and no static sandbox exists, so most of this is live-only.

95. [ ] `ui` **Assign Amazon as the fulfilment executor in Who decides for a test order routed to this connection.**  
   -> Work is dispatched to Amazon; the connection must also be the stock master (the work's SKU is the variant's ProductVariant mapping on this connection).
96. [ ] `live-only` **Dispatch routed work whose variant is in FBA stock.**  
   -> Amazon previews then creates the MCF order; the id is derived from the idempotency key, so a retry finds the same order and answers the same acceptance; acceptedAt is Amazon's receivedDate. live-only.
97. [ ] `ui` **Dispatch work whose variant has no Amazon SKU mapping (a connection that only links offers).**  
   -> Rejected, blocking, reason sku-not-on-amazon.
98. [ ] `ui` **Dispatch work for an order with no delivery address (buyer data not stored or incomplete).**  
   -> Rejected, blocking, with the missing-address reason.
99. [ ] `live-only` **Dispatch work Amazon cannot fulfil (not in FBA stock).**  
   -> Preview fails and the work is rejected, blocking, with Amazon's reasons. live-only.
100. [ ] `live-only` **Cancel work while the MCF order is New / Received / Planning, then once Amazon is processing.**  
   -> First: cancelled and accepted. Second: refused, not blocking ("the parcel is Amazon's to send"). An already-cancelled or never-created order answers accepted. live-only.
101. [ ] `auto` **Run the MCF executor and contract-kit specs.** (`amazon-mcf-fulfillment-executor.adapter.spec.ts`)  
   -> Pass, including the replay-same-key contract and the status counters (one line per order item, shipped from SHIPPED shipments, cancelled and unfulfillable as cancelled).
102. [ ] `ui` **Set mcfShippingSpeed to Priority and dispatch (or inspect the createFulfillmentOrder payload in the spec).**  
   -> ShippingSpeedCategory is Priority; with the key cleared it is Standard.

### 10. Returns and refunds

Amazon has no returns API for seller-fulfilled orders; the only read is the report GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE, built asynchronously. Both returns tasks default OFF.

103. [ ] `live-only` **Enable amazon-returns-poll (every 15 min) and wait for a few ticks.** (`/returns`)  
   -> First tick requests a report and keeps the cursor; later ticks report no returns until Amazon finishes building; then returns arrive page by page in /returns. A new report is requested at most once an hour. live-only.
104. [ ] `auto` **Run the return reader and cursor specs.**  
   -> Pass: window never starts more than 60 days back, recheck window re-reads changed statuses, eventKey carries the status so a changed status is a new item and an unchanged one is not.
105. [ ] `live-only` **Enable amazon-returns-status-sync (hourly :20) after a poll.**  
   -> Open returns are re-read from the cached reports (40-day lookback, 50 per tick); one no longer in the cache reads as not found and the sweep moves on. live-only.
106. [ ] `ui` **Open an ingested return.** (`/returns`)  
   -> Raw status verbatim, lines with SKU, reason carried through, unmatched returns land in the orphan bucket and block downstream triggers until matched.
107. [ ] `ui` **On a connection WITHOUT refundsEnabled, confirm a refund on an Amazon return.**  
   -> The refund dialog states that OpenLinker only records that the refund was done out of band in Seller Central; no money is moved.
108. [ ] `ui` **On a connection WITH refundsEnabled, open the refund dialog for a seller-fulfilled Amazon order.** (`/returns > refund`)  
   -> After the refund dialog fix the dialog offers sending the refund to Amazon, with the amount split over the returned items; confirming reports submitted/accepted with the feed id as provider reference.
109. [ ] `live-only` **Confirm a refund with refundsEnabled and wait for the feed result.**  
   -> The payment adjustment feed (POST_FLAT_FILE_PAYMENT_ADJUSTMENT_DATA) is created once per idempotency key; the call waits up to the configured window for the result; refundedAt is the feed processingEndTime; still running after the wait = accepted. live-only; whether partial amounts are accepted is unverified on a live account.
110. [ ] `ui` **Refund an Amazon-fulfilled order, a refund in another currency, and an amount larger than the items.**  
   -> All three are denied before anything is sent, with a reason; nothing is submitted.
111. [ ] `api` **Run a refund with refundsEnabled but no host cache wired (unit/int setup).**  
   -> Fail-closed: the executor cannot guarantee one submission per key, so it does not submit blindly; a retry that finds a "submitting" marker throws (outcome unknown, resolved by hand) instead of creating a second feed.

### 11. Order notifications (SQS)

Amazon delivers change notifications only to SQS or EventBridge. With notificationQueueUrl set, amazon-notifications-drain (every minute, OFF by default) turns each ORDER_CHANGE into an order sync. The poll stays the delivery guarantee.

112. [ ] `ui` **On Edit, before saving a queue URL, look at the "Register queue" action.** (`Edit connection > Order notifications`)  
   -> Disabled with "Save an SQS queue URL first."
113. [ ] `ui` **Save a valid queue URL and press "Register queue".**  
   -> Toast "Queue registered - Amazon now reports order changes to the queue." Running it again changes nothing.
114. [ ] `live-only` **Register the queue with a production app that has the Notifications role.**  
   -> A destination is reused or created for the queue ARN, ORDER_CHANGE is subscribed; an existing subscription pointing at another destination is reported, not replaced. live-only.
115. [ ] `ui` **Register with a Sandbox-status app, an app without the Notifications role, or no queue.**  
   -> A warning naming the fix (grantless scope refused / 403 role missing / save a queue first) instead of a raw error.
116. [ ] `live-only` **Enable the drain task, change an order at Amazon and wait about a minute.**  
   -> The order is re-synced within about a minute of the ORDER_CHANGE; the SQS message is deleted after its events were enqueued; duplicates dedup on NotificationId. live-only.
117. [ ] `api` **Run the drain job for a connection with a queue but no AWS keys.**  
   -> The job ends as a business failure naming the missing key (not a retry loop).
118. [ ] `auto` **Run the SQS client / SigV4 / queued order source specs.**  
   -> Pass: requests are signed with SigV4 without an AWS SDK; other notification types are acknowledged and ignored; a message is deleted only after routing succeeded.
119. [ ] `api` **Check that a drained event lands on the jobs.sync stream, not the sync_jobs gate.**  
   -> As documented the event is enqueued on the jobs.sync Redis stream; therefore keep amazon-orders-poll on whenever the drain is on.

## Part C - Roles, scheduler and failure behaviour

### 12. Scheduler tasks (all default OFF)

The plugin registers exactly six tasks. Each is gated by an OL_AMAZON_* env var read by the WORKER (scheduler role), not the API, with enabledDefault false.

120. [ ] `api` **Boot the worker with no OL_AMAZON_* variable set and list scheduler activity.**  
   -> None of the six Amazon tasks enqueues a job; no marketplace.* job for an Amazon connection appears.
121. [ ] `api` **Set OL_AMAZON_ORDERS_POLL_SCHEDULER_ENABLED=true and restart the worker.**  
   -> amazon-orders-poll enqueues marketplace.orders.poll every 5 minutes (limit 100, cursor key amazon.orders.feedCursor) for connections with OrderSource.
122. [ ] `api` **Set OL_AMAZON_NOTIFICATIONS_DRAIN_SCHEDULER_ENABLED=true.**  
   -> amazon-notifications-drain enqueues marketplace.notifications.drain every minute, only for active connections with OrderSource and a notificationQueueUrl (max 10 messages).
123. [ ] `api` **Set OL_AMAZON_OFFERS_SYNC_SCHEDULER_ENABLED=true and OL_AMAZON_OFFER_STATUS_SYNC_SCHEDULER_ENABLED=true.**  
   -> marketplace.offers.sync at :15 and marketplace.offer.statusSync at :45 hourly, only for active connections with OfferManager and a valid sellerId (page limit 20).
124. [ ] `api` **Set OL_AMAZON_RETURNS_POLL_SCHEDULER_ENABLED=true and OL_AMAZON_RETURNS_STATUS_SYNC_SCHEDULER_ENABLED=true.**  
   -> marketplace.returns.poll every 15 minutes and marketplace.returns.statusSync at :20 hourly, for connections with OrderSource.
125. [ ] `api` **Disable the connection (status disabled) while a task is on.**  
   -> The connection is skipped by the connection filter; no job is enqueued for it.
126. [ ] `auto` **Run the scheduler-task specs.** (`amazon-scheduler-tasks.spec.ts`)  
   -> Idempotency keys are marketplace:{connectionId}:{...}:{timestamp}; connection filters match the table above.
127. [ ] `api` **Check that worker .env.example documents all six variables.** (`apps/worker/.env.example`)  
   -> Findings: see the note below.

> **Finding:** Six tasks exist in code: amazon-orders-poll, amazon-returns-poll, amazon-returns-status-sync, amazon-notifications-drain, amazon-offers-sync, amazon-offer-status-sync. The README and the setup guide document only four of them (no returns tasks). No scheduler task exists for the inventory or catalogue sweeps (those ride the generic master.* sweeps) or for MCF (fulfillment.work.* jobs). If an older plan or guide lists two further Amazon tasks (for example an inventory sync and an MCF status sync), they are NOT in the code: do not wait for jobs by those names; the equivalent behaviour is the generic sweeps. None of the six OL_AMAZON_* variables was found in an .env.example on the branch, so operators have no in-repo place that lists them.

> **Finding:** There is no amazon:probe script. The package.json scripts are build, test, test:watch, test:cov, lint, type-check, and the repo has only dev:stack:shopify-probe for Shopify. Do not try to run it; the offline substitute is the jest suite plus the static Amazon sandbox (environment "sandbox").

### 13. Roles (viewer, operator, admin)

128. [ ] `ui` **As admin: create, edit, test and re-authorize an Amazon connection.**  
   -> All actions available.
129. [ ] `ui` **As operator: open the Amazon connection, run Test connection, press Register queue.**  
   -> Per the connections:write permission the operator's write controls follow the existing role model; record which controls appear and confirm they match what the API accepts (no control that then returns 403, no hidden control the API would allow).
130. [ ] `ui` **As viewer: open the connection list, detail, orders and returns for Amazon.**  
   -> Read-only everywhere; no create, edit, test, register or refund button; the setup page shows "Read-only access".
131. [ ] `api` **As viewer, PATCH the connection and POST /connections/:id/webhooks/install.** (`API`)  
   -> 403 on both.
132. [ ] `api` **As viewer, GET the connection.**  
   -> Credentials, access tokens and AWS keys are never in any response; only "Stored / Not stored".

### 14. Errors and retries

Retry table: LWA refusal = terminal and needs_reauth; unusable config = terminal; SP-API 4xx (not 408/429) = terminal; 429 QuotaExceeded = deferred 240 s without spending an attempt; 503 = deferred 300 s; network, 408, other 5xx = retry ladder.

133. [ ] `api` **Make LWA answer invalid_grant (use a revoked refresh token) and run any Amazon job.**  
   -> Job ends terminal (no retry ladder); the connection moves to Needs reauth; the UI offers Re-authorize.
134. [ ] `api` **Make the access token expire mid-run (clear the token cache, or wait 1 h) with valid credentials.**  
   -> A new token is minted transparently (cached 60 s short of its hour, one LWA call shared by concurrent jobs) and the job succeeds. The SP-API client itself has no 401-retry: a stubbed 401 is a 4xx and therefore terminal. Record any 401 that reaches the operator in normal use.
135. [ ] `api` **Stub a 429 QuotaExceeded on searchOrders.**  
   -> The job is requeued penalty-free about 240 s later (attempt counter unchanged, deferral visible in the job error); after the 24 h deferral budget it rejoins the ordinary ladder.
136. [ ] `api` **Stub a 503 from SP-API.**  
   -> Deferred 300 s penalty-free.
137. [ ] `api` **Stub 400 InvalidInput, 403 Unauthorized (missing role) and 404.**  
   -> All terminal (business failure / dead without retries); a 403 is reported as that error, never as bad credentials.
138. [ ] `api` **Cut the network (or stub a 500).**  
   -> Retry on the normal ladder with backoff; the job eventually succeeds when the stub is removed.
139. [ ] `api` **Break the stored config (remove marketplaceIds directly in the DB) and run a job.**  
   -> Terminal "config unusable"; operator edit needed; no retry storm.
140. [ ] `api` **Check that no log line or job error contains a token, client secret, refresh token or AWS key.**  
   -> None found; network failures collapse to a fixed sentence.

> **Finding:** Token refresh and 401: the brief expects a 401 -> token refresh -> retry path. In code the token provider refreshes proactively (cache dropped 60 s before expiry, shared in-flight mint, fingerprint key so rotated credentials never reuse an old token) and the SP-API client deliberately has no retries; a 401 from SP-API is classified as a terminal 4xx. If a 401 occurs in normal operation, treat it as a defect candidate.

---

Total: 140 points.
