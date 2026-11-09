# Production API audit — Amazon / Shopify / eBay / TikTok Shop

Part of epic #2878.

## Why this file exists

What follows is read **only from each platform's production API documentation** — what is
available for each OpenLinker capability, and where something isn't, why, with a direct doc link.
No sandbox testing, no comparison to sandbox behaviour — `SPIKE-2879-shopify-admin-api.md`,
`SPIKE-2880-ebay-sell-apis.md`, `SPIKE-2881-amazon-sp-api.md` and `SPIKE-2882-tiktok-shop-open-api.md`
cover that (dev-store, eBay sandbox, SP-API static sandbox, and registration-only respectively).
This file answers a narrower question — what does the vendor's own production documentation say —
using only doc pages, never a live call.

`developer.ebay.com` returns `HTTP 403` to automated fetchers (curl, scripted fetch); the mirror
host `www.edp.ebay.com` serves the same content and was used instead. `partner.tiktokshop.com/docv2`
is a client-side-rendered SPA that returns an empty shell to a plain fetch; it was read with a
real rendered browser session instead — no sign-in is required for any of it.

**Legend**: ✅ available in production · ❌ not available · ⚠️ available with a real caveat · 🔒 gated behind vendor approval

---

## Capability matrix

| OL capability | Amazon | Shopify | eBay | TikTok |
|---|---|---|---|---|
| `ProductMaster` | ❌ every offer attaches to an Amazon-owned ASIN, a single record shared across every seller who offers that item — see below | ✅ `Product` carries variants, options, media, metafields | ⚠️ `inventory_item` is a full, seller-owned product record (title, description, images, attributes, identifiers) — see below | ❌ products are grouped into categories predefined by TikTok — TikTok Shop is a destination, not a master |
| `InventoryMaster` | ❌ every FBA inventory-read operation is a GET; no write operation found | ✅ 8 documented states — `incoming, on_hand, available, committed, reserved, damaged, safety_stock, quality_control` | ❌ `inventory_item.availability.quantity` is seller-owned and writable, but nothing on eBay independently tracks stock the way a warehouse system does — the quantity is only ever what the seller last wrote | ❌ same reasoning as `ProductMaster` |
| `OrderSource` | ⚠️ rate-limited (0.0167 req/s, burst 20 on the current version) | ✅ | ✅ `ORDER_CONFIRMATION` push notification, sent to the seller on checkout completion | ⚠️ the Orders API requires a prior webhook subscription before it answers at all |
| `OfferManager` (stock write) | ✅ | ✅ `inventorySetQuantities` | ✅ two-level: `inventory_item` (SKU quantity, shared across marketplaces) is separate from `offer` (per-marketplace listing) | ✅ dedicated `Update Price` + `Update Inventory` (+ a Global Inventory variant for cross-border) |
| `OfferCreator` | ⚠️ 🔒 works for an existing ASIN or a new one with a GTIN; a brand-new product with no GTIN needs a manual, non-API exemption request (see below) | n/a | ✅ `createOffer` + `publishOffer` | ⚠️ asynchronous: `Draft → Pending → Activate\|Failed`; a failed re-review after an edit keeps the previous live version rather than pulling the listing |
| `OfferStatusReader` | ✅ | ✅ | ✅ | ✅ |
| `OfferDeactivator` | ❌ `deleteListingsItem` is a hard delete — no deactivate verb or status enum exists | n/a | ✅ | ✅ `Deactivate Products`/`Activate Product` with `Seller_deactivated`/`Platform_deactivated` states |
| `CategoryBrowser` | ⚠️ the whole browse-node hierarchy is retrievable via a Reports API report, not a live paginated REST call — see below | ✅ | ✅ | ✅ `Get Category Rules` + `Get Attributes` (+ global-market variants) |
| `CatalogProductReader` | ✅ `searchCatalogItems` resolves an ASIN by GTIN/UPC/EAN via `identifiers`+`identifiersType` | n/a | ⚠️ requires the `commerce.catalog.readonly` scope on an authorization-code token — a client-credentials or under-scoped token is rejected | ❌ |
| `ProductPublisher` | ❌ (see note below) | ✅ `publishablePublish` | ❌ | ❌ |
| `OrderProcessorManager` | ❌ (see note below) | ✅ `orderCreate` — one real limitation: only one discount code per order, automatic discounts don't apply unless replicated by hand | ❌ | ❌ |
| `FulfillmentExecutor` | ⚠️ 🔒 Multi-Channel Fulfillment (`createFulfillmentOrder`/`getFulfillmentOrder`/`cancelFulfillmentOrder`) lets a seller submit an order from any channel for FBA to execute — single-axis status only, gated behind a separate "Amazon Fulfillment" SP-API role | ✅ near-exact ADR-054 match (`FulfillmentOrder`, `status`×`requestStatus`, server `supportedActions`) | ❌ | ⚠️ 🔒 the same shape as Amazon MCF: `Create/Get/Cancel FBT MCF Order` lets a seller submit an order from another sales channel for TikTok's FBT warehouses to fulfill — gated behind the `seller.fbt.info` scope and FBT enrollment |
| `ReturnSourceReader` | ⚠️ readable via Reports API's general MFN returns reports (RMA/ASIN/reason, 60-day window) and the External Fulfillment API; writing a refund is possible only as a full-amount Feeds API flat-file feed, not a targeted return-decision call | ✅ | ⚠️ core read/process/refund operations are live via Post-Order API; the pre-submission draft/label sub-flow is not (see below) | ✅ dedicated read/write resource (`Search/Create/Approve/Reject Return`) |
| `ShippingProviderManager` | ⚠️ works for US/UK/DE/ES/FR/IT/JP/AU sellers buying their own label through the API; neither Merchant Fulfillment nor Amazon Shipping v2 covers a Polish seller — FBA and manual/own-carrier labelling are unaffected | n/a | 🔒 Limited Release, no country coverage stated | ✅ `Get Warehouse List`, `Get Global Seller Warehouse`, `Get Warehouse Delivery Options`, `Get Shipping Providers`, plus Fulfilled by TikTok (FBT) |
| Tax rate **on order line** | ❌ | ✅ `TaxLine.rate` (decimal) and `ratePercentage` (Float) | ❌ | ❌ |
| Tax rate **written at publish** | ✅ `product_tax_code` — a category code (`A_GEN_TAX`, `A_GEN_NOTAX`, `A_CLTH_GEN`, …), never a numeric percentage; Amazon's VAT Calculation Service derives the rate from the code plus jurisdiction | n/a | ✅ `vatPercentage` — a number, so it cannot carry an exemption code | ❌ no such field found in the Create Product schema or Category Rules |
| Buyer PII | ⚠️ 🔒 relay email; PII must be deleted within 30 days of delivery (not of ingestion); annual pentest + a vulnerability scan every 180 days | ⚠️ custom (single-merchant) apps skip Shopify's formal app-review process, but the merchant must still grant each protected-data field per app in the Partner Dashboard | ✅ | ❌ masked, no decrypt endpoint — see the redaction table below |
| Usable sandbox | ⚠️ | ⚠️ | ⚠️ | ❌ |

**On `ProductPublisher` and `OrderProcessorManager` for Amazon/eBay/TikTok**: both model a
shop-backend relationship — publishing a product's own content to a destination's storefront, or
creating an order record on a destination that owns its own order system for a sale made
elsewhere. None of the three marketplaces has either: every listing attaches to a platform-owned
catalog identity (ASIN / eBay Catalog / TikTok category) rather than a seller-hosted storefront,
and every order on all three originates from a buyer checking out on that platform's own site —
there is no operation on any of them that lets a seller inject an externally-originated sale into
the platform's order system. Only Shopify, which is a genuine shop backend rather than a pure
marketplace, answers ✅ on both.

**Two things a market/region check turns up that the table above has no row for:**

- TikTok Shop's official "Regions and languages" page (last updated 2026-07-06) does not list
  Poland — no `PL` row, no `pl-PL` locale. The page scopes itself to text localization rather than
  explicitly to market/selling availability, so this alone doesn't prove a Polish shop can't be
  authorized, but it's the one directly-dated production statement available on the question.
- TikTok Shop and eBay both have a genuine push notification for a brand-new order
  (`ORDER_STATUS_CHANGE` and `ORDER_CONFIRMATION` respectively). Amazon's push is SQS/EventBridge
  only — no HTTP webhook exists in SP-API at all.
- Amazon and TikTok Shop both have a Multi-Channel-Fulfillment-shaped capability: a seller submits
  an order that originated on another sales channel and the platform's own fulfillment network
  (FBA / FBT) picks, packs and ships it. Amazon's is `Fulfillment Outbound API`
  (`createFulfillmentOrder`); TikTok's is `Create FBT MCF Order`, with an explicit
  `external_order_id` field for "the corresponding order ID in your OMS." Both are gated behind a
  separate role/scope and program enrollment — neither is available to every seller by default.

---

## eBay

| Capability | Status | Note |
|---|---|---|
| Publish (`inventory_item → offer → publish`) | ✅ | |
| Return / case / cancellation management | ⚠️ | Core seller-facing operations are live via Post-Order API; a specific pre-submission draft/label sub-flow is gone (see below) |
| Refund money | ✅ | Via the Post-Order API's return/inquiry refund operations, or the Fulfillment API's `issueRefund` |
| Order read | ⚠️ | Excludes any order that never completed checkout |
| New-order push notification | ✅ | `ORDER_CONFIRMATION` (Notification API), sent to the seller on checkout completion |
| RFC 9421 signing | ⚠️ | Mandatory for EU/UK sellers, wider than refunds alone |
| Logistics (shipping labels) | 🔒 | Limited Release |
| Catalog API (GTIN/EAN match) | ⚠️ | Needs a specific OAuth scope |
| Store's own category tree | ✅ | Needs an eBay Store subscription |

### Post-Order API — what's live and what was decommissioned

The current Sell API index lists these Post-Order operations as live today:

| Resource | Live operations |
|---|---|
| `return` | `searchReturns`, `getReturn`, `createReturnRequest`, `processReturnRequest`, `issueReturnRefund`, `markItemReceived`, `escalateReturn`, `addShippingLabelInfo`, `uploadReturnFile`, `getReturnFiles`, `getReturnPreferences`/`setReturnPreferences`, `getShipmentTrackingInfo`, `sendReturnMessage` |
| `casemanagement` | `getCase`, `appealCaseDecision`, `searchCases` |
| `inquiry` | `getInquiry`, `escalateInquiry`, `issueInquiryRefund`, `provideInquiryShipmentInfo`, `searchInquiries`, `sendInquiryMessage` |
| `cancellation` | `createCancellationRequest`, `checkCancellationEligibility`, `searchCancellations`, `getCancellation`, `approveCancellation`, `rejectCancellation` |

https://developer.ebay.com/develop/api/sell/post_order_api

The deprecation-status page lists four groups of Post-Order methods as decommissioned, all sitting
on the same **pre-submission draft / return-shipping-label / older refund-confirmation** sub-flow
rather than on the resources above:

| Decommission date | Methods |
|---|---|
| 2026-01-20 | `Cancel Return Request`, `Check Return Eligibility`, `Check Shipping Label Print Eligibility`, `Create Return Draft`, `Delete Return Request Draft File`, `Get Return Draft`, `Get Return Request Draft Files`, `Initiate Return Shipping Label`, `Mark Return Refund Received`, `Mark Return Refund Sent`, `Mark Return Shipped`, `Send Return Shipping Label`, `Update Shipment Tracking Info`, `Update Return Draft`, `Upload Return Request Draft File`, `Void Shipping Label` |
| 2026-02-02 | `Get Return Estimate`, `Get Return Shipping Label`, `Submit Return File`, `Check Inquiry Eligibility` |
| 2026-03-02 | `Close Case`, `Issue Case Refund`, `Provide Case Shipment Info`, `Provides Return Address`, `Confirm Cancellation Refund` |
| 2026-03-16 | `Close Inquiry`, `Confirm Inquiry Refund`, `Create Inquiry`, `Provide Inquiry Refund Info` |

https://developer.ebay.com/develop/get-started/api-deprecation-status

None of these named methods appear in the live-operations table above — the pattern is a buyer
drafting/estimating a return and generating its own shipping label before formally submitting it,
plus a handful of older refund/close variants each superseded by a still-live equivalent
(`Confirm Inquiry Refund`/`Provide Inquiry Refund Info` → `issueInquiryRefund`; `Confirm
Cancellation Refund` → the cancellation resource's `approveCancellation`/`rejectCancellation`).
What has no live equivalent found is `Close Case` and `Issue Case Refund` specifically — a case can
still be read, searched and appealed (`getCase`/`searchCases`/`appealCaseDecision`), but not closed
or refunded directly through this resource.

### Fulfillment API

- `GET /sell/fulfillment/v1/order[/{orderId}]` — https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrders
  Excludes any order that never completed checkout.
- `POST .../issue_refund` — https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/issueRefund
  A general refund path independent of any return/case/inquiry record. Requires RFC 9421 signing
  for EU/UK sellers. Post-Order's own `issueReturnRefund`/`issueInquiryRefund` (above) are the
  refund paths tied to a specific return or inquiry.

### Notification API topics

The Order Management group includes a genuine new-order push topic:

- `ORDER_CONFIRMATION` — *"Notification sent to seller when buyer completes checkout."*
- `ORDER_CANCELLATION_ACTIVITY` — *"sent to a seller when an order cancellation is initiated"*
- `ITEM_COMMITMENT_CANCELLATION_ACTIVITY`
- `ORDER_RETURN_ACTIVITY` — *"sent to a seller when a return lifecycle activity occurs"*
- `ORDER_INQUIRY_ACTIVITY` — *"sent to a seller when an inquiry lifecycle activity occurs"*
- `ITEM_MARKED_SHIPPED`
- `BUYER_REQUESTED_PURCHASE_QUOTE`, `PURCHASE_QUOTE_CANCELLATION_ACTIVITY`

Other groups on the same page cover listing (`LISTING`, `ITEM_AVAILABILITY`,
`LISTING_PREVIEW_CREATION_TASK_STATUS`), account (`SELLER_STANDARDS_PROFILE_METRICS`,
`AUTHORIZATION_REVOCATION`, `FEEDBACK_STAR_RATING`, `MARKETPLACE_ACCOUNT_DELETION`,
`SELLER_CUSTOMER_SERVICE_METRIC_RATING`), and others. The page groups topics into disclosure
sections by functional area; a plain text search of the collapsed page misses topics inside an
unopened section — each group has to be expanded to see its topic list.

Access to a topic can require an approved-partner OAuth scope; `getTopics` returns the scope each
topic needs.
https://developer.ebay.com/develop/api/buy/notification_events ·
https://developer.ebay.com/api-docs/commerce/notification/resources/topic/methods/getTopics

### RFC 9421 digital signatures

Mandatory for EU/UK sellers on: all Finances API methods, `Fulfillment.issueRefund`,
`Trading.GetAccount`, and specific Post-Order methods — `processReturnRequest`,
`issueReturnRefund`, `approveCancellation`, `createCancellationRequest`, `issueInquiryRefund` (all
still live) and `Issue Case Refund` (decommissioned above, so this one no longer applies in
practice). Four headers per call, keypairs via the Key Management API.
https://developer.ebay.com/develop/guides/sell/digital-signatures-for-apis

### Account, Finances and Taxonomy APIs

- Account: policy CRUD, opt-in, privileges, KYC, payments-program status, and a `sales_tax`
  resource (`getSalesTax`/`getSalesTaxes`/`createOrReplaceSalesTax`) — https://developer.ebay.com/api-docs/sell/account/overview.html
- Finances: earnings, payouts, funds, transactions, billing, transfers — https://developer.ebay.com/api-docs/sell/finances/overview.html
- Taxonomy: category tree, item aspects, category suggestions — https://developer.ebay.com/api-docs/commerce/taxonomy/resources/category_tree/methods/getCategoryTree

The Account API's `sales_tax` resource is explicitly scoped away from GB/DE/FR/PL: *"Sales-tax
tables are only available for the US (EBAY_US) and Canada (EBAY_CA) marketplaces."* It's also
largely inactive even for the US, per the same page: *"eBay now calculates, collects, and remits
sales tax to the proper taxing authorities in all 50 states... Sellers can no longer specify
sales-tax rates for these jurisdictions using a tax table."* The only tax mechanism relevant to the
four target markets is the offer-level `vatPercentage` field covered above.
https://developer.ebay.com/api-docs/sell/account/resources/sales_tax/methods/getSalesTax

### Logistics API

Limited Release: *"available only to select developers approved by business units."* No country
coverage stated either way.
https://developer.ebay.com/api-docs/sell/logistics/overview.html

### Catalog API

`GET /commerce/catalog/v1_beta/product_summary/search` needs an authorization-code-grant token
carrying the `commerce.catalog.readonly` scope specifically — a client-credentials or
under-scoped token is documented to be rejected.
https://developer.ebay.com/api-docs/commerce/catalog/resources/product_summary/methods/search

### Stores API

Manages the seller's own store-navigation categories (like a shop's internal category tree) — not
the listing Taxonomy tree, not GTIN/Catalog matching. Needs an active eBay Store subscription.
https://developer.ebay.com/api-docs/sell/stores/overview.html · https://developer.ebay.com/develop/api/sell/stores_api

### `inventory_item` as a product record

`createOrReplaceInventoryItem`'s own reference page describes the fields it sets: *"Product
details, including any product identifier(s), such as a UPC, ISBN, EAN, or Brand/Manufacturer Part
Number pair, a product description, a product title, product/item aspects, and links to images."*
That record is readable back in full (`getInventoryItem`, `bulkGetInventoryItem`) and enumerable
across the whole account (`getInventoryItems`, paged). It belongs to the seller's own account —
matching it to an eBay Catalog product by GTIN/ePID only pre-fills fields on the seller's own
record; it does not merge the record into anything shared with other sellers.

What is not seller-defined is the *structure* the record is organized into: which `aspects` a
category accepts and requires is eBay's own per-category taxonomy
(`get_item_aspects_for_category`), not a schema the seller controls.

A related, separate feature: the "Multi-warehouse program" (`createInventoryLocation`,
`createOrReplaceSkuLocationMapping`) lets a seller map one SKU to multiple of their own physical
warehouse/fulfillment-center locations, for improved delivery-date estimates. This is still
seller-supplied location data — eBay does not pick, pack or ship anything itself — so it doesn't
change the `FulfillmentExecutor` or `InventoryMaster` conclusions, but it's a genuine
multi-location inventory concept beyond a flat per-SKU quantity.
https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/createOrReplaceInventoryItem

---

## Amazon

| Capability | Status | Note |
|---|---|---|
| Refund / return-write | ⚠️ | Full refunds only, via a Feeds API flat-file feed — see below |
| Order push notification | ⚠️ | No HTTP webhook — SQS/EventBridge only |
| Offer deactivation | ❌ | `deleteListingsItem` is a hard delete; quantity-0 is the only pause |
| Browsable category tree | ⚠️ | Whole tree retrievable, but only as an async Reports API report |
| Offer on an existing ASIN | ✅ | Plain `putListingsItem`, no exemption needed |
| New ASIN, product has no GTIN | ❌ | Manual, out-of-band Seller Central exemption request — no API for this step |
| Merchant Fulfillment (own labels) | ⚠️ | Works for US/UK/DE/ES/FR/IT/JP/AU; Poland is not in the coverage table |
| Amazon Shipping v2 (labels) | ⚠️ | Works elsewhere; explicitly refuses a Polish `shipFrom` |
| Multi-Channel Fulfillment (order → FBA execution) | ⚠️ 🔒 | See below |
| Rate-limit observability | ❌ | No query endpoint at all |
| Invoicing | ⚠️ | For Poland/EU: `UPLOAD_VAT_INVOICE` (Feeds API); the Invoices API's `createGovernmentInvoice` is Brazil-only |
| Tax rate at publish | ✅ | `product_tax_code` — a category code, not a percentage |
| PII deletion window | ⚠️ | 30 days after delivery, not after ingestion |

### Creating an offer

| Scenario | Needs a GTIN exemption? | Automatable via API? |
|---|---|---|
| Attach an offer to an ASIN that already exists | No — just eligibility checks | ✅ plain `putListingsItem` |
| Create a brand-new ASIN, product has a GTIN/UPC/EAN | No | ✅ |
| Create a brand-new ASIN, product has no GTIN | Yes | ❌ manual Seller Central request, brand-specific, no API endpoint |

https://developer-docs.amazon/sp-api/docs/listings-apis-faq

### The ASIN is one record shared across every seller of that item

The Listings APIs FAQ states directly: *"An ASIN represents the same physical item in every Amazon
store"*, and the Catalog Items API "provides information at the ASIN level, which is reconciled
from various listings against that item" — i.e. data submitted by different sellers offering the
same product is reconciled onto one shared record, not kept as separate seller-owned copies.
Precedence over that shared record's content is explicit: *"Brand owners have the highest
precedence to update data on the product details page on Amazon."*

This is the specific difference from eBay's `inventory_item`, where content is scoped to and
retained by the individual seller's own account. On Amazon, a seller attaching an offer to an
existing ASIN is contributing to (and can have its submission superseded within) one shared
catalog entity, rather than owning an independent product record.
https://developer-docs.amazon/sp-api/docs/listings-apis-faq

### Refunds and returns

A refund is possible, through the Feeds API's **Flat File Order Adjustments Feed**
(`POST_FLAT_FILE_PAYMENT_ADJUSTMENT_DATA`): *"The feed allows you to issue a full refund
(adjustment) for an order. You must provide a reason for the adjustment, such as Customer Return,
and the adjustment amount with specified price components, such as the principle, shipping, and
tax."* Two real constraints: it's a **full refund only** (no partial-amount adjustment), and it's
submitted as a flat file (a downloaded Excel template, populated with `order-id`,
`order-item-id`, `adjustment-reason-code`, currency, and price-component columns, saved as `.txt`
and uploaded) — not a single JSON REST call.
https://developer-docs.amazon/sp-api/docs/submit-a-feed

Returns are readable through two separate mechanisms: the Reports API's general MFN returns
reports (`GET_XML_RETURNS_DATA_BY_RETURN_DATE`/`GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE` and
Prime-specific variants) — RMA ID, ASIN, return reason code, label details, up to 60 days per
request — and the External Fulfillment API, scoped to that program only.
https://developer-docs.amazon/sp-api/docs/report-type-values-returns ·
https://developer-docs.amazon.com/sp-api/docs/external-fulfillment-api-v2024-09-11-reference

Finances API (payouts, seller funds, transactions, `initiatePayout` — pays the seller, not a
buyer) and Orders API remain read-only for money movement; the feed above is the only write path.
https://developer-docs.amazon.com/sp-api/reference/finances-v0

### Orders API

- `GET /orders/v0/orders` — 0.0167 req/s, burst 20; migration deadline **2027-03-27** — https://developer-docs.amazon.com/sp-api/docs/orders-api-v0-reference
- `GET /orders/2026-01-01/orders` (`searchOrders`) + `getOrder` — https://developer-docs.amazon.com/sp-api/reference/searchorders
- No HTTP webhook exists in SP-API. Push is SQS/EventBridge only, via `ORDER_CHANGE` — https://developer-docs.amazon.com/sp-api/docs/tutorial-subscribe-to-order-change-notification
- No rate-limit-query endpoint exists — read per-operation from the docs or the `x-amzn-RateLimit-Limit` response header.

### Listings pause/deactivate

`putListingsItem` (full replace) and `patchListingsItem` (merge-patch) both exist; `deleteListingsItem`
is a hard delete with no deactivate/withdraw verb or status enum.
https://developer-docs.amazon.com/sp-api/docs/listings-items-api-v2021-08-01-reference

### Category browsing

Two live-call APIs don't provide a root-down browse: Catalog Items API returns a parent chain on
an item you already have, and Product Type Definitions is keyword search over product types.
https://developer-docs.amazon.com/sp-api/docs/catalog-items-api-v2022-04-01-reference

A third mechanism does provide one: the Reports API's **Browse Tree Report**
(`GET_XML_BROWSE_TREE_DATA`) — *"Contains browse tree hierarchy information and node refinement
information for the Amazon retail website in any Amazon store."* Requesting it with no
`BrowseNodeId` and `RootNodesOnly` unset returns *"the entire browse node hierarchy"* for a
marketplace; passing a `BrowseNodeId` scopes it to that node's subtree, and `RootNodesOnly: true`
returns just the top level. This is genuinely a full category tree, but it arrives as an
asynchronously-generated XML report (request → poll → download), not a live paginated REST
browse call the way eBay's or Shopify's category endpoints work.
https://developer-docs.amazon/sp-api/docs/report-type-values-browse-tree

### Buying a shipping label directly through the API — works, except for Poland

Both APIs here do the same narrow thing: let a seller who ships an order themselves (MFN,
merchant-fulfilled — as opposed to FBA, where Amazon ships it) buy a carrier label through
Amazon's own API rather than generating one manually or through a separate carrier integration.
Selling on Amazon.pl, FBA, and every other capability in this document are unaffected either way —
this is specifically about that one label-purchase step.

| API | Coverage |
|---|---|
| Merchant Fulfillment API (FBM Ship+ program availability table) | US, UK, DE, ES, FR, IT, JP, AU — Poland is not in the table — https://developer-docs.amazon.com/sp-api/docs/merchant-fulfillment-api#fbm-ship-program-availability |
| Amazon Shipping v2 | Works elsewhere; a Polish `shipFrom` gets `400 "There is no marketplaceId configured to AmazonShippingIdentifier = AmazonShipping_PL"` — https://developer-docs.shipping.amazon.com/apis/docs/shipping-api-v2-reference |

A Polish MFN seller still has FBA, manual label purchase in Seller Central, or a separate carrier
API as options — none of those routes go through either of these two APIs.

### Invoicing

| Path | What it does | Applies to Poland/EU? |
|---|---|---|
| Invoices API `createGovernmentInvoice` | Lets a Brazilian FBA seller submit an invoice for inbound shipments | No — this API is scoped to the Brazil marketplace only |
| Feeds API `UPLOAD_VAT_INVOICE` | Seller uploads their own VAT invoice document | Yes |
| External Fulfillment `generateInvoice`/`retrieveInvoice` | Scoped to the External Fulfillment program | Only if enrolled in that program |

For a Polish/EU seller, `UPLOAD_VAT_INVOICE` is the relevant path — `createGovernmentInvoice` does
not apply outside Brazil.
https://developer-docs.amazon.com/sp-api/docs/create-and-upload-invoices

### Multi-Channel Fulfillment

`createFulfillmentOrder` / `getFulfillmentOrder` / `cancelFulfillmentOrder` /
`updateFulfillmentOrder` let a seller submit an order that originated on any sales channel for
Amazon's FBA network to pick, pack and ship. Status is single-axis: `RECEIVED, PLANNING,
PROCESSING, CANCELLED, COMPLETE, COMPLETE_PARTIALLED, UNFULFILLABLE, INVALID` — there is no
separate negotiation axis or server-declared action set the way Shopify's `FulfillmentOrder` has;
an order either proceeds or lands on `UNFULFILLABLE`/`INVALID`. Gated behind a distinct "Amazon
Fulfillment" SP-API role. Region coverage is NA/EU/FE — EU covers the EU marketplaces including
Poland.
https://developer-docs.amazon.com/sp-api/docs/fulfillment-outbound-api-v2020-07-01-use-case-guide

### Tax rate at publish

`product_tax_code` — set as a shop-wide default or overridden per-SKU, via the offer property group
in the Listings Items API attributes (also reachable through the legacy `ProductTaxCode` XML
element / `product_tax_code` flat-file column). A categorical code (`A_GEN_TAX`, `A_GEN_NOTAX`,
`A_CLTH_GEN`, and others listed in the category flat files), never a numeric rate — Amazon's VAT
Calculation Service derives the percentage from the code plus the buyer's jurisdiction.
https://developer-docs.amazon.com/sp-api/docs/vat-calculation-service-product-tax-code

### Data Protection Policy

PII deletion window is 30 days after delivery, not 30 days from ingestion. Annual penetration test
and vulnerability scans every 180 days apply to any developer/solution provider handling PII.
https://sellercentral.amazon.com/mws/static/policy?documentType=DPP · https://developer-docs.amazon.com/sp-api/docs/security-compliance-overview

---

## Shopify

| Capability | Status | Note |
|---|---|---|
| `FulfillmentOrder` model | ✅ | Current, standard |
| HTTP webhooks | ✅ | New "Events" mechanism runs alongside, not instead |
| `@idempotent` directive | ⚠️ | Mandatory since API 2026-04, enforced at runtime, invisible in the schema |
| REST Admin API | ❌ | Deprecated platform-wide since 2024-10; GraphQL-only for new orgs since 2025-04 |
| Returns Processing API | ✅ | `returnProcess` current; `returnRefund` deprecated |
| Buyer PII access | ⚠️ | Custom apps skip formal review; the merchant still opts each field in per app |

### `@idempotent`

> *"Even though the idempotency directive doesn't show up as mandatory at the schema level,
> calling these mutations without it will result in an error at runtime."*

Applies to inventory-adjustment and refund mutations, mandatory since API version 2026-04.
https://shopify.dev/changelog/making-idempotency-mandatory-for-inventory-adjustments-and-refund-mutations

### REST Admin API

Deprecated platform-wide since 2024-10-01; new orgs are GraphQL-only for custom and public apps
since 2025-04-01; per-resource REST sunset waves began 2025-10 and continue annually. No single
final sunset date announced for pre-cutover apps.
https://shopify.dev/docs/apps/build/graphql-admin-api

### Other confirmed facts

- `FulfillmentOrder` (`status` × `requestStatus`, server `supportedActions`) is auto-created per
  order and cannot be created manually — https://shopify.dev/docs/api/admin-graphql/latest/objects/FulfillmentOrder
- GraphQL rate limit (points/sec): Standard 100 · Advanced 200 · Plus 1000 · Enterprise 2000 —
  exact bucket/restore rate not published beyond that — https://shopify.dev/docs/api/usage/limits
- Returns Processing API: `returnRequest` + `returnProcess` (current); `returnRefund` deprecated
  since 2025-07 — https://shopify.dev/docs/api/admin-graphql/latest/mutations/returnProcess
- `Product` carries variants, options, media, metafields as first-class fields —
  https://shopify.dev/docs/api/admin-graphql/latest/objects/Product
- Inventory: 8 documented states — `incoming, on_hand, available, committed, reserved, damaged,
  safety_stock, quality_control` (`on_hand` is the sum of the physical ones; the rest are mutually
  exclusive) — https://shopify.dev/docs/apps/build/orders-fulfillment/inventory-management-apps/manage-quantities-states
- `inventorySetQuantities` (stock write) is one of the mutations the `@idempotent` rule above
  governs — https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventorySetQuantities
- `publishablePublish` (publish product/collection to a sales channel, needs `write_publications`) —
  https://shopify.dev/docs/api/admin-graphql/latest/mutations/publishablePublish
- `orderCreate` creates an order as a destination — real limitation: only one discount code per
  order, automatic discounts don't apply unless replicated by hand —
  https://shopify.dev/docs/api/admin-graphql/latest/mutations/orderCreate
- `TaxLine.rate` (decimal) and `ratePercentage` (Float) both exist as numeric rate fields, distinct
  from the amount fields — https://shopify.dev/docs/api/admin-graphql/latest/objects/TaxLine

### Buyer PII on a custom app

Custom (single-merchant) apps skip Shopify's formal app-review process for protected customer
data: *"You don't need to submit a request for review for apps that are installed only on
development stores."* The merchant must still explicitly grant each protected-data field to that
specific app in the Partner Dashboard, and the app must still meet Shopify's handling/security
requirements regardless of app type.
https://shopify.dev/docs/apps/launch/protected-customer-data

---

## TikTok Shop

| Capability | Status | Note |
|---|---|---|
| New-order push notification | ✅ | `ORDER_STATUS_CHANGE` |
| Returns API | ✅ | Named, read and write resource |
| Poland in the regions table | ❌ | Not listed in the dated "Regions and languages" doc |
| Order API without a prior webhook subscription | ❌ | Subscribe first, then read |
| Buyer address reveal / decrypt | ❌ | No such endpoint |
| Offer deactivation | ✅ | Real `Deactivate Products`/`Activate Product` endpoints |
| Category browsing | ✅ | `Get Category Rules` + `Get Attributes` |
| Fulfilled by TikTok (FBT) MCF | ⚠️ 🔒 | Same shape as Amazon MCF — see below |
| Tax rate as a field at publish | ❌ | No such field in the Create Product schema or Category Rules |
| Webhook signing citation | ⚠️ | Sourced from a different TikTok domain than the rest of this section |

### Regions and languages

The official page, last updated 2026-07-06, lists: Brazil, France, Germany, Indonesia, Ireland,
Italy, Japan, Malaysia, Mexico, Philippines, Singapore, Spain, Thailand, UK, US, Vietnam. No `PL`
row, no `pl-PL` locale. The page scopes itself to text localization rather than explicitly to
market/selling availability.
https://partner.tiktokshop.com/docv2/page/regions-and-languages

### Order API

> *"To utilize the Orders API, you must subscribe to the Orders Webhook."*

Order ids are discovered via webhook, then hydrated via the Order API — there is no standalone
list call that enumerates orders on its own.
https://partner.tiktokshop.com/docv2/page/order-api-overview

### Buyer address redaction

| `fulfillment_type` | shipping type | Redacted? |
|---|---|---|
| `FULFILLMENT_BY_TIKTOK` | any | Yes |
| `FULFILLMENT_BY_SELLER` | TikTok | Yes |
| `FULFILLMENT_BY_SELLER` | Seller Shipping | No |

No decrypt/reveal endpoint exists for any of these. For `ON_HOLD` orders (the 1-hour buyer remorse
window) the address is unavailable at all, redacted or not.
https://partner.tiktokshop.com/docv2/page/order-api-overview

### Webhooks and Returns API

- `ORDER_STATUS_CHANGE` fires on order creation among other transitions; also
  `PACKAGE_UPDATE`, `RECIPIENT_ADDRESS_UPDATE`, `CANCELLATION_STATUS_CHANGE`,
  `RETURN_STATUS_CHANGE`, `PRODUCT_AUDIT_STATUS_CHANGE`, `INVOICE_STATUS_CHANGE`, and more —
  https://partner.tiktokshop.com/docv2/page/tts-webhooks-overview
- Returns has its own read/write resource (`Search/Create/Approve/Reject Return`) —
  https://partner.tiktokshop.com/docv2/page/return-refund-and-cancel-api-overview

### Offer deactivation and category browsing

`POST Deactivate Products` / `Activate Product` with `Seller_deactivated`/`Platform_deactivated`
states. Category browsing is real (`Get Category Rules`, `Get Attributes`, plus global-market
variants). Product creation is asynchronous: `Draft → Pending → Activate|Failed`, and a failed
re-review after an edit keeps the previous live version rather than pulling the listing.
https://partner.tiktokshop.com/docv2/page/products-api-overview

### Fulfilled by TikTok (FBT) — a real Multi-Channel-Fulfillment equivalent

`Create FBT MCF Order`: *"For orders created on other sales channels that require fulfillment via
FBT, this API enables you to create corresponding orders (hereinafter referred to as MCF Orders).
Once MCF Orders are successfully created, they will be automatically submitted to the FBT system
for fulfillment."* `external_order_id` is documented as *"the corresponding order ID in your
OMS"* — the same shape as Amazon's Multi-Channel Fulfillment. Companion operations exist for the
full lifecycle: `Get FBT MCF Order Status`, `Cancel FBT MCF Order`, `Query Goods Inventory For
MCF`, `Get FBT Merchant MCF Status` (checks whether the seller is even enrolled), plus a separate
inbound-shipment side (`Create or Update Inbound Plan`, `Ship Inbound Order`, `Get FBT Warehouse
List`) for stocking TikTok's warehouses in the first place. Gated behind the `seller.fbt.info`
scope and FBT enrollment — not available to every seller by default.
https://partner.tiktokshop.com/docv2/page/create-fbt-mcf-order-202607

### Tax rate at publish

The `Create Product` request-body documentation (38,178 characters, checked in full) contains no
genuine occurrence of "tax" — the only string matches are inside "syntax", "Activate",
"Deactivate". `Get Category Rules` (8,025 characters) contains none either, and a site-wide search
for "tax rate"/"tax_rate" on `partner.tiktokshop.com` returns nothing relevant. No tax-code or
tax-rate field exists anywhere in the Product API.
https://partner.tiktokshop.com/docv2/page/create-product-202309 ·
https://partner.tiktokshop.com/docv2/page/get-category-rules-202309

### Signing

API-request HMAC-SHA256 scheme, confirmed with runnable Go/Java sample code on the page: sort
query params (excluding `sign`/`access_token`), concatenate, prepend the request path, append the
raw body for non-GET/non-multipart requests, wrap as `app_secret + <string> + app_secret`,
HMAC-SHA256 keyed with `app_secret`, hex-encoded.
https://partner.tiktokshop.com/docv2/page/sign-your-api-request

The webhook signing scheme (`HMAC_SHA256(key=app_secret, message=app_key + raw_request_body)`,
delivered in the `Authorization` header with no `Bearer` prefix) is documented at
`developers.tiktok.com/doc/webhooks-verification` — a different TikTok domain than the Partner
Center pages above, read via search rather than a rendered browser session.

### Not investigated in this pass

The `code: 0` in-body success-reporting behaviour and the silent product-audit-failure-on-edit
behaviour — neither appears in `SPIKE-2882`; both originate in the epic issue text.
