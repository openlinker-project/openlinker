# Amazon SP-API sandbox — live test log (#2881)

Local, untracked scratch notes. NOT part of the final SPIKE doc yet — raw findings to be curated later.
Access token used: self-authorized Private app "OL-testt", sandbox keyset, EU host.

## C4 — marketplaceParticipations
- GET https://sandbox.sellingpartnerapi-eu.amazon.com/sellers/v1/marketplaceParticipations
- Result: HTTP 200
- Returns canned US marketplace (ATVPDKIKX0DER, "BestSellerStore") regardless of host region (EU host, US data)
- Finding: static sandbox does NOT vary marketplace by which regional host you call — same canned payload

## O1/O2 — Orders v0 getOrders
- GET https://sandbox.sellingpartnerapi-eu.amazon.com/orders/v0/orders?MarketplaceIds=ATVPDKIKX0DER&CreatedAfter=TEST_CASE_200
- Result: HTTP 200, 2 sample orders (AmazonOrderId 902-1845936-5435065, 902-8745147-1934268)
- v0 uses PascalCase query params (MarketplaceIds, CreatedAfter) — confirms X5 casing-change claim in issue
- OrderTotal = {CurrencyCode, Amount} only — NO tax rate field at order-list grain (supports O10 desk claim, still need getOrderItems to fully confirm)
- New field spotted not in issue desk research: ElectronicInvoiceStatus: "NotRequired" — worth flagging for invoicing story D1/D3
- DefaultShipFromLocationAddress present with full address even in sandbox

## v2026-01-01 searchOrders (NEW version)
- GET https://sandbox.sellingpartnerapi-eu.amazon.com/orders/2026-01-01/orders?marketplaceIds=A1PA6795UKMFR9
- US marketplace (ATVPDKIKX0DER) on EU host -> 403 "marketplaces you provided are not valid for region"
- DE marketplace (A1PA6795UKMFR9) on EU host -> 400 "Could not match input arguments"
- Finding: v2026-01-01 sandbox pattern for searchOrders NOT YET IDENTIFIED — camelCase param names, no known magic value found yet. Candidate risk: v2026 may not have static sandbox coverage at all (would corroborate X1 "Orders were not in dynamic list" going further — may not even be in static list with usable patterns)

## O2 — Orders v0 getOrder (single) — orderId=TEST_CASE_200
- GET https://sandbox.sellingpartnerapi-eu.amazon.com/orders/v0/orders/TEST_CASE_200
- Result: HTTP 200, same payload shape as list

## O8/O10/D3 — Orders v0 getOrderItems — orderId=TEST_CASE_200
- GET https://sandbox.sellingpartnerapi-eu.amazon.com/orders/v0/orders/TEST_CASE_200/orderItems
- Result: HTTP 200
- ItemPrice = {CurrencyCode, Amount}, ItemTax = {CurrencyCode, Amount} — CONFIRMS O10 desk claim: amounts only, NO rate/percent field anywhere in the order-item payload. ADR-063 forbids deriving rate from tax/net -> Amazon lines are rate-less under v0, matching issue's prediction.
- 🆕 NEW FINDING not flagged in issue desk research: "IossNumber":"" and "DeemedResellerCategory":"IOSS" fields present on OrderItem.
  -> This is Amazon's analogue of eBay's D3 (marketplace-facilitator VAT/IOSS number) which #2880 flagged as missing for Amazon ("nothing in OL's order contract models it today" — but that was written for eBay's ebayCollectAndRemitTaxes field). Amazon HAS a comparable field. Worth adding to SPIKE-2881 D3 as a genuine finding, contradicting/extending the original issue text which does not mention IossNumber for Amazon at all.
  -> DeemedResellerCategory suggests Amazon models "deemed reseller" VAT status (EU e-commerce VAT package concept) at line-item level.
- 🆕 "BuyerRequestedCancel": {"IsBuyerRequestedCancel", "BuyerCancelReason"} present at line level — relevant to O12 (cancellation observation), more granular than issue's desk claim suggested (issue only cites includedData=CANCELLATION at order grain for v2026)
- "StoreChainStoreId":"ISPU_StoreId" — ISPU = In-Store Pick Up, ties to O14/F7 pickup-point support

## T7/S6/T6 — Listings Items API getListingsItem
- GET https://sandbox.sellingpartnerapi-eu.amazon.com/listings/2021-08-01/items/A2TEST123/TEST-SKU-1?marketplaceIds=A1PA6795UKMFR9
- Result: HTTP 200 (any sellerId/sku accepted — sandbox model has generic {} pattern, not test-case-keyed)
- 🎯 CONFIRMS S6 desk claim directly: response carries an "issues" array alongside "summaries"/"offers"/"fulfillmentAvailability" — exactly the ADR-009-shaped disjoint-snapshot pattern the issue predicted (a clean write can still carry issues[])
- Issue codes observed: 90220 (MISSING_ATTRIBUTE), 18027 (INVALID_IMAGE, with "enforcements.exemption.status: EXEMPT_UNTIL_EXPIRY_DATE" + expiryDate!), 99300 (PRODUCT rules violation), 18155 (INVALID_PRICE), 18742 (Restricted Products -> CATALOG_ITEM_REMOVED)
- 🆕 NEW FINDING: "enforcements" object with "actions" (e.g. SEARCH_SUPPRESSED, ATTRIBUTE_SUPPRESSED, LISTING_SUPPRESSED, CATALOG_ITEM_REMOVED) and "exemption" (EXEMPT / EXEMPT_UNTIL_EXPIRY_DATE / NOT_EXEMPT) — much richer issue-severity model than Allegro/Erli have. Worth a dedicated line in T6/S6 in the SPIKE doc — this is a genuinely differentiated capability (per-issue enforcement + exemption tracking).
- Two marketplaceId entries in one listing item response (ATVPDKIKX0DER US + A2EUQ1WTGCTBG2 CA) — sandbox canned data spans multiple markets in one payload, doesn't reflect the single EU marketplace we asked for (static sandbox limitation, consistent with C4 finding)

## T1 — Product Type Definitions searchDefinitionsProductTypes
- GET https://sandbox.sellingpartnerapi-eu.amazon.com/definitions/2020-09-01/productTypes?marketplaceIds=A1PA6795UKMFR9
- Result: HTTP 200, minimal: {"productTypes":[{"name":"LUGGAGE","displayName":"Luggage","marketplaceIds":["ATVPDKIKX0DER"]}],"productTypeVersion":"..."}
- Confirms endpoint reachable; does not resolve T1's real open question (no browse-node tree walk operation found) — that remains to verify against the full spec/documentation, sandbox alone can't answer it

## T7 — Catalog Items getCatalogItem
- GET https://sandbox.sellingpartnerapi-eu.amazon.com/catalog/2022-04-01/items/B00551Q3CS?marketplaceIds=A1PA6795UKMFR9
- Result: HTTP 400 "Could not match input arguments"
- Consistent with earlier finding: getCatalogItem model has NO x-amzn-api-sandbox object at all (confirmed via spec read) — genuinely unsupported in static sandbox, not just "wrong params". searchCatalogItems (plural/search) reportedly DOES have a sandbox config per the spec note — worth testing separately if time permits.

## searchCatalogItems, Reports getReports — inconclusive
- Both HTTP 400 "Could not match input arguments" — need exact x-amzn-api-sandbox param values from spec, not yet located (guessed generic params, wrong). Follow-up: fetch models/reports-api-model/reports_2021-06-30.json and catalogItems_2022-04-01.json searchCatalogItems block directly.

## C13 — Notifications getDestinations
- GET https://sandbox.sellingpartnerapi-eu.amazon.com/notifications/v1/destinations
- Result: HTTP 403 Unauthorized (no details)
- Hypothesis (per issue C2 note): Notifications/grantless operations may require a token minted via grant_type=client_credentials rather than grant_type=refresh_token. Our token was refresh_token-based (seller-authorized). NOT YET CONFIRMED — worth testing with a fresh client_credentials token.

## Session summary (token near/at ~1h expiry by end of this batch)
Confirmed via live sandbox calls:
- C4 (marketplaceParticipations) — DONE, canned US data regardless of EU host
- O1/O2/O8 (getOrders/getOrder/getOrderItems, Orders v0) — DONE, PascalCase confirmed, tax=amount-only confirmed (O10), IossNumber+DeemedResellerCategory found (new, feeds D3)
- Listings getListingsItem — DONE, issues[]+enforcements[]+exemption structure confirmed (S6/T6)
- Product Type Definitions searchDefinitionsProductTypes — reachable, minimal payload
- Catalog getCatalogItem — CONFIRMED unsupported in static sandbox (no x-amzn-api-sandbox block in spec, 400 on any params)
- searchCatalogItems, Reports getReports — inconclusive, need exact sandbox param patterns from spec (not found this session)
- Notifications getDestinations — 403, possibly wrong grant_type (needs grantless/client_credentials token)
- Orders v2026-01-01 searchOrders — inconclusive, region-valid but "could not match input arguments"; v0 pattern (TEST_CASE_200) does NOT carry over 1:1 to v2026 casing/shape

Not attempted this session (would need real product data / feed uploads, out of scope for a first sandbox pass):
- Feeds create/upload flow (P1/P4/S2)
- Product Publish (putListingsItem POST, would mutate — deferred to avoid touching real listing state even in sandbox without understanding side effects)
- FBA/Merchant Fulfillment (F2/F5)
- Returns Reports (R1)

## 🎯 O10 RESOLVED — from spec, without needing a successful live call
The full x-amzn-api-sandbox block for v2026-01-01 searchOrders (Brazil test case, includedData=TAX) shows:
```json
"tax": {
  "taxRegistrations": [
    {"entityType":"BUYER","legalName":"...","taxRegistrationType":"VAT","taxRegistrationNumber":"1234567890"},
    {"entityType":"MARKETPLACE","taxRegistrationType":"CNPJ","taxRegistrationNumber":"15436940"},
    {"entityType":"MERCHANT","legalName":"TechStore"}
  ],
  "taxInvoicing": {"invoiceStatus":"PROCESSING"}
}
```
**CONFIRMED: `includedData=TAX` carries tax REGISTRATION NUMBERS (VAT/CNPJ ids per entity: buyer/marketplace/merchant) and an invoice status — NOT a percentage rate anywhere.** This directly settles O10/D4: v2026 TAX data is amounts+registration-ids only, never a rate. ADR-063 forbids deriving rate from tax/net -> Amazon order lines are confirmed rate-less even under the new API version, matching the original issue's worry but now via documented evidence rather than a "found nothing" grep.
Also: this is a SECOND marketplace-facilitator-VAT-style field family beyond v0's IossNumber — `taxRegistrations[].taxRegistrationType` genericizes across VAT/CNPJ/etc per entity role (BUYER/MARKETPLACE/MERCHANT). Relevant to D3.

Full v2026 sandbox spec also reveals fields NOT mentioned in issue desk research at all:
- `orderAliases[].aliasType: "SELLER_ORDER_ID"` — OL's own order ref roundtrip? Worth checking against O-external-order-ref equivalent (TikTok has one per #2882; unclear if Amazon does)
- `picking.substitutionPreference.substitutionOptions[]` (UK test case) — buyer-approved substitute ASIN/SKU when out of stock — a genuinely new capability class not in any other researched platform
- `packages[]` with `packageStatus.status/detailedStatus`, `carrier`, `trackingNumber`, `shipFromAddress` — confirms F1/F2 shape and that a package sits BELOW order/orderItem, similar caution to TikTok's "package != order" (F-extra in #2882)
- `programs: ["AMAZON_BUSINESS","DELIVERY_BY_AMAZON"]`, `buyerCompanyName`, `buyerPurchaseOrderNumber`, `priceDesignation: "BUSINESS_PRICE"` — B2B order support, not mentioned anywhere in issue #2881

## v2026-01-01 searchOrders — CONCLUSION after exhaustive param attempts
Tried against exact spec values (UK test case) with 4 encoding variants:
1. comma-joined includedData, urlencoded colons -> 400 InvalidInput
2. repeated includedData= params, urlencoded colons -> 400 InvalidInput
3. no includedData at all -> 400 InvalidInput
4. comma-joined includedData, raw unencoded colons -> 400 InvalidInput
All used the EXACT literal values copied from the model's own x-amzn-api-sandbox block (createdAfter=2024-12-23T00:00:00Z, marketplaceIds=A1F83G8C2ARO7P). Region check passes (UK marketplace accepted on EU host -> 400 not 403), so credentials/host/region are correct; only the STATIC PATTERN MATCH fails.
**Working hypothesis (not fully proven): the v2026-01-01 static sandbox backend may not yet be actually wired to match the documented x-amzn-api-sandbox patterns** — the model file exists and is well-formed (verified by reading its full contents), but the sandbox SERVICE behind sandbox.sellingpartnerapi-eu.amazon.com does not appear to honour it as of this session (2026-09-04), unlike Orders v0 (TEST_CASE_200) and Listings v2021-08-01, which both worked cleanly on the first correctly-regioned attempt.
This is a genuinely new, evidence-based finding for SPIKE-2881 X1/O1: v2026-01-01 being newer than v0, its sandbox coverage may lag its GA. Recommend flagging this explicitly rather than treating our failure as "wrong params" — worth an AWS support ticket / forum post to confirm, since this materially affects whether AC2's live transcript requirement can be met on v2026 in sandbox at all (may require live seller account testing sooner than expected for Orders specifically).

## C13 — Grantless (client_credentials) token — INCONCLUSIVE
- POST https://api.amazon.com/auth/o2/token, grant_type=client_credentials
- No scope param -> "missing a required parameter: scope" (confirms scope is mandatory for this grant type)
- scope=sellingpartnerapi::notifications -> invalid_scope
- scope=sellingpartnerapi::migration -> invalid_scope
- scope=notifications (no prefix) -> invalid_scope
- Hypothesis: this app (Private, "OL-testt") may not have "Grantless operations" / Notifications role enabled at registration — client_credentials grant may need to be explicitly turned on for the app in Developer Central (separate from the normal seller-authorization roles), OR the two commonly-cited scope strings are stale/wrong and the real ones need to be found in current official docs (could not locate them via automated search this session — notifications.json model itself contains no "scope" string at all).
- ACTION NEEDED (manual): check Developer Central app edit screen for a "Grantless operations" / role toggle; if present, enable it for OL-testt and retry. This blocks further progress on C13 (Notifications) and X1's grantless-token questions this session.

## C13 — Grantless token, FINAL CONCLUSION for this session
- Confirmed via popular community SDK (saleweaver/python-amazon-sp-api, sp_api/api/notifications/notifications.py): `grantless_scope = "sellingpartnerapi::notifications"` — EXACTLY the value we tried and got rejected with invalid_scope.
- So the scope STRING is correct. The rejection is therefore an ACCOUNT/APP-level restriction, not a typo.
- Official docs (developer-docs.amazon/sp-api/docs/grantless-operations) state verbatim: "grantless operations apply only to seller applications" — our app was registered via Solution Provider Portal as a generic app client under "Build applications that use SP APIs" (Solution Type step) — its exact classification as a "seller application" vs some other type is UNCONFIRMED and is the most likely cause.
- Working theory to verify manually (not resolvable via API/desk research alone): the app may need role/production approval, OR may need to be created specifically as tied to a seller account (self-authorized) BEFORE grantless client_credentials works — i.e. grantless might depend on there being at least one active self-authorization on the app, which we DO have (from the earlier successful refresh_token flow) — so this theory is weaker.
- Recommend as a NEXT STEP for #2881 X1/C13: file a question on the SP-API developer forum/AWS re:Post, or open an AWS support case, since automated research has been exhausted — this is a genuine external unknown, not a research gap on our side.
- STATUS: BLOCKED, needs human/support-channel follow-up. Do not spend further automated attempts on scope-string guessing.

## SESSION 2 — desk research (no live token needed)

### 🎯 T1 RESOLVED — confirmed absent across every candidate API, primary source
Checked full path lists of every Catalog Items API version + Product Type Definitions API:
- Product Type Definitions 2020-09-01: ONLY `searchDefinitionsProductTypes` + `getDefinitionsProductType` — no tree walk
- Catalog Items 2022-04-01: ONLY `/catalog/2022-04-01/items` (search) + `/catalog/2022-04-01/items/{asin}` (get one) — no tree walk
- Catalog Items 2020-12-01: same two-path shape — no tree walk
- Catalog Items v0 (deprecated): HAS `/catalog/v0/categories` (`listCatalogCategories`) — BUT this returns the ANCESTOR PATH for one specific ASIN/SellerSKU only ("Returns the parent categories to which an item belongs, based on the specified ASIN or SellerSKU"), NOT a browsable/walkable tree from root. Equivalent to a `CategoryPathReader`-shaped read (needs an existing product to resolve), not a `CategoryBrowser`-shaped one (walk from root, no product needed).

**CONCLUSION: T1 is DEFINITIVELY confirmed — no operation anywhere in the current or deprecated SP-API surface lets you browse/discover Amazon's category tree independently of an existing product.** This is stronger evidence than the original issue had (which said "no operation... was found" as a search gap); now it's "checked every path in every version, confirmed absent, found the nearest analogue and confirmed it's the wrong shape."
Consequence for `DestinationCategory` (#1979): does NOT transfer to Amazon as designed. The wizard's category-picker UX (shared Allegro/Erli/WooCommerce pattern) needs a different mechanism — likely `searchDefinitionsProductTypes` (search-by-keyword to find a product type) as the entry point instead of tree navigation, since product type IS Amazon's organizing unit (matches the issue's own framing).

### F5 RESOLVED — Poland confirmed absent from FBM Ship+ table (independent source)
Read the Merchant Fulfillment API use-case guide's own availability table directly:
| Amazon store | Cross-border (China origin) | Domestic |
| US | CN2US | US DOM (06/2026) |
| UK | CN2UK | UK DOM |
| DE | CN2DE | DE DOM |
| ES | CN2ES | ES DOM (Q3 2026) |
| FR | CN2FR | FR DOM (Q4 2026) |
| IT | CN2IT | IT DOM (Q4 2026) |
| JP | CN2JP | - |
| AU | CN2AU | - |
Poland is absent — CONFIRMS the issue's own finding from an independent read of the primary source (not just re-reading the same page). F5 stays 🔴 for Poland — Buy Shipping is not available there via Merchant Fulfillment/FBM Ship+, in any form found.

### X7 — fee saga, still unresolved but with a more precise negative result
Checked official SP-API release notes (developer-docs.amazon/sp-api/docs/sp-api-release-notes) spanning
2024-06 through 2026-08 — ZERO mentions of any developer subscription fee, usage fee, delay, postponement or
cancellation, in either direction. 
IMPORTANT NUANCE: this is likely because release notes are a technical-changelog document type (API version
changes), not a billing-announcement channel — its silence does NOT confirm OR refute the trade-press saga
described in the issue. It simply means this particular document type was the wrong place to look; a real fee
change would more likely be announced via Seller Central notifications, a dedicated pricing page, or email to
registered developers — none of which are checkable via this research method (login-gated / not indexed).
STATUS UNCHANGED: still UNVERIFIED, now with one more (negative, inconclusive) data point. Recommend the
issue's own instruction stands: verify independently (e.g. ask in Seller Central / check billing settings
directly) before any planning depends on it.

## SESSION 3 — new access_token, continuing live tests

### Reports getReports — WORKS
- GET https://sandbox.sellingpartnerapi-eu.amazon.com/reports/2021-06-30/reports?reportTypes=FEE_DISCOUNTS_REPORT,GET_AFN_INVENTORY_DATA&processingStatuses=IN_QUEUE,IN_PROGRESS
- HTTP 200, one sample report with reportId/reportType/dataStartTime/dataEndTime/createdTime/processingStatus/processingStartTime/processingEndTime + nextToken
- Confirms Reports API reachable in static sandbox with comma-joined array params (unlike Orders v2026 which failed with the same style — inconsistent sandbox implementation quality across APIs)

### T7 PARTIALLY UPGRADED — searchCatalogItems WORKS (unlike getCatalogItem)
- GET https://sandbox.sellingpartnerapi-NA.amazon.com/catalog/2022-04-01/items?keywords=samsung,tv&marketplaceIds=ATVPDKIKX0DER&includedData=classifications,dimensions,identifiers,images,productTypes,relationships,salesRanks,summaries,vendorDetails
- Region note: required NA host (US marketplace baked into the sandbox pattern) — EU host rejects it (403), matching the same US-marketplace-pattern-vs-EU-host conflict seen with Orders v2026's UK/Brazil test cases
- HTTP 200, RICH response:
  - "classifications": full browse-classification PARENT CHAIN per item — "QLED TVs" -> parent "Televisions" -> parent "Television & Video" -> parent "Electronics". CONFIRMS the issue's T1 claim that Catalog Items exposes browse classifications ON ITEMS — but this is scoped to a MATCHED product, not an independently-walkable tree (consistent with T1's resolution above: still can't discover the tree without first finding a product via keyword search)
  - "identifiers": EAN/GTIN/UPC all present per item — directly useful for T7/barcode-matching (CatalogProductReader, EAN-based offer linking parity with Allegro)
  - "relationships": type "VARIATION" with "parentAsins" + "variationTheme": {"attributes":["color","size"],"theme":"SIZE_NAME/COLOR_NAME"} — directly relevant to P8 (multi-variant grouping via parentageLevel) — confirms Amazon's variation model is queryable this way
  - "vendorDetails": brandCode/manufacturerCode/productCategory/productSubcategory — vendor-specific, likely only relevant for Vendor Central sellers not Seller Central/3P, worth noting as out of scope
  - "dimensions": full item + package height/length/weight/width with units — relevant to #1842 (required-to-sell preflight, MISSING_DIMENSIONS check) IF Amazon required this at publish (not yet confirmed as a write requirement, only that reads expose it)
- REVISED T7 STATUS: getCatalogItem (single-ASIN read) has NO sandbox support; searchCatalogItems (keyword search) DOES and works cleanly. For a CatalogProductReader-shaped capability (find a product by barcode/keyword before offering against it), searchCatalogItems is the right operation anyway — this is actually GOOD news, upgrades T7 from "confirmed unsupported" to "confirmed supported via the search variant, single-item read unsupported in sandbox specifically"

### getDefinitionsProductType — WORKS, reveals GTIN exemption field name (P2)
- GET https://sandbox.sellingpartnerapi-na.amazon.com/definitions/2020-09-01/productTypes/LUGGAGE?marketplaceIds=ATVPDKIKX0DER&sellerId=A2TEST123
- HTTP 200
- Response: "schema" is a LINK object ({"link":{"resource":"https://schema-url","verb":"GET"}}), NOT the inline JSON Schema — sandbox does not let us fetch the actual schema-url (it's a stub), so T5 (conditional-required-attributes structure) STILL cannot be directly exercised via sandbox. Would need a real product type schema fetch against production/real seller account.
- 🎯 NEW: "propertyGroups.product_identity.propertyNames" includes **"gtin_exemption_reason"** as a real, named schema property alongside item_name/brand/external_product_id/merchant_suggested_asin/product_type/etc. This is the actual attribute name a listing payload would set — differs slightly from the issue's cited "supplier_declared_has_product_identifier_exemption" (which may be an older/different field name, or the issue's source was imprecise). Worth flagging as a P2 refinement: confirm the EXACT current field name against a real product type schema before implementation — do not trust either name blindly.
- Also reveals "requirements":"LISTING", "requirementsEnforced":"ENFORCED" — a per-product-type flag for whether requirements are actively enforced, worth noting for T5/T6.

## METHODOLOGY NOTE — WebFetch summarizer gave a false negative
Asked WebFetch to find confirmShipment's sandbox block in ordersV0.json; it replied "cannot find a
confirmShipment operation" and listed 8 operations, omitting confirmShipment entirely. Direct `grep -o
'"operationId": *"[^"]*"'` on the raw file confirms confirmShipment DOES exist, alongside updateShipmentStatus
AND updateVerificationStatus (9 operations total, not 8). CONCLUSION: WebFetch's summarizing model is not
100% reliable for exhaustive "does X exist" questions on large files — always cross-check a negative/absent
finding with a direct grep on raw content before recording it as a confirmed absence. (This changes nothing
about the earlier T1 "confirmed absent" conclusions — those WERE cross-checked with direct grep of path lists,
not just WebFetch summaries — but it's a good reminder to keep doing that.)

## SESSION 3 continued — methodology fix + full flow verifications

### METHODOLOGY FIX: x-amzn-api-sandbox lives under responses.{code}, not at operation top-level
Earlier "NO SANDBOX BLOCK" conclusions for confirmShipment/updateShipmentStatus/patchListingsItem were WRONG
— I was checking `op['x-amzn-api-sandbox']` (operation top level) when the real location is
`op['responses'][code]['x-amzn-api-sandbox']` (nested per response code, e.g. under '204' or '200' or '400').
Confirmed by inspecting getListingsItem's actual key structure (it succeeded live but showed no top-level
block — the block was under responses.200 and responses.400). RETROACTIVE CORRECTION: any earlier claim in
this log of "no sandbox block" for an operation should be treated as UNVERIFIED unless it was checked via a
full path-list absence (like T1's Catalog Items check, which enumerated actual PATHS, not sandbox blocks — T1
conclusions stand) or corrected below. getCatalogItem's "no sandbox at all" claim (T7, session 1) should be
RE-VERIFIED with this corrected method before being trusted further.

### F2 — confirmShipment: ✅ VERIFIED LIVE, WORKS
- POST /orders/v0/orders/902-1106328-1059050/shipmentConfirmation, FedEx package detail body from spec
- HTTP 204 (success, no body) — confirms the issue's F2 claim that confirmShipment exists and this shape works, contradicting nothing
- Sibling operation `updateShipmentStatus` (POST /orders/v0/orders/{orderId}/shipment) ALSO exists and ALSO works (empty-body pattern -> 204) — NOT mentioned anywhere in the original issue's F2 story. Its purpose (per its 400-pattern body: {"marketplaceId":"1","shipmentStatus":"ReadyForPickup"}) appears to be a lighter-weight shipment status update distinct from the full confirmShipment package-detail flow — worth investigating what "ReadyForPickup" and sibling statuses mean, may be relevant to pickup-point/ISPU flows (O14/F7).

### P1/P4 — Feeds full flow: ✅ VERIFIED LIVE END TO END
1. POST /feeds/2021-06-30/documents {"contentType":"text/tab-separated-values; charset=UTF-8"} -> 201, {feedDocumentId, url} (url is a real-looking CloudFront upload target)
2. POST /feeds/2021-06-30/feeds {"feedType":"POST_PRODUCT_DATA","marketplaceIds":[...],"inputFeedDocumentId":...} -> 202, {feedId}
3. GET /feeds/2021-06-30/feeds/feedId1 -> 200, {feedId,feedType,createdTime,processingStatus:"CANCELLED",processingStartTime,processingEndTime}
CONFIRMS the issue's P1/P4 desk claim: async poll-for-result shape (create -> upload -> create feed -> poll) maps directly onto OL's OfferCreationRecord + poller pattern. Note the canned processingStatus is "CANCELLED" not "DONE" — sandbox doesn't simulate a full happy path to completion, just proves the shape is reachable.

### R1 — Reports full flow: ✅ VERIFIED LIVE END TO END (general mechanism; specific returns report type not yet tested)
1. POST /reports/2021-06-30/reports {"reportType":"GET_MERCHANT_LISTINGS_ALL_DATA","dataStartTime":...,"marketplaceIds":[...]} -> 202, {reportId}
2. GET /reports/2021-06-30/documents/0356cf79-b8b0-4226-b4b9-0ee058ea5760 -> 200, {reportDocumentId, url} (CloudFront download target)
CONFIRMS the general Reports API mechanism (create -> poll status via getReports/getReport -> fetch document via getReportDocument -> download from url) works end to end in sandbox. This is the SAME mechanism R1 (returns) depends on, just tested with a listings report type rather than GET_XML_RETURNS_DATA_BY_RETURN_DATE specifically (no sandbox pattern found yet for that exact report type — would need its own targeted lookup). High confidence the returns report type uses the identical createReport/getReport/getReportDocument shape, just with a different reportType string and (per the issue) a 60-day max window and the D2C Shipping role gate.

### 🔴 CORRECTION — T7 getCatalogItem was WRONGLY marked "unsupported" in Session 1
Re-checked with the fixed methodology (responses.{code}.x-amzn-api-sandbox, not operation top-level):
getCatalogItem DOES have a sandbox pattern: asin=B07N4M94X4, marketplaceIds=ATVPDKIKX0DER,
includedData=classifications,dimensions,identifiers,images,productTypes,relationships,salesRanks,summaries,vendorDetails
- GET https://sandbox.sellingpartnerapi-NA.amazon.com/catalog/2022-04-01/items/B07N4M94X4?... -> HTTP 200, full rich payload (same shape as searchCatalogItems' matched item)
SESSION 1's CLAIM "getCatalogItem genuinely unsupported in static sandbox" WAS WRONG — caused by checking op-level x-amzn-api-sandbox instead of the nested per-response-code location. CORRECTED: getCatalogItem IS supported, same as searchCatalogItems. Both give the classification/dimensions/identifiers/relationships/vendorDetails payload for the one canned ASIN B07N4M94X4.

### 🆕 NEW CAPABILITY CLASS — Regulated Order Verification (not in issue at all)
- GET /orders/v0/orders/902-3159896-1390916/regulatedInfo -> HTTP 200
- Response: {"RequiresDosageLabel":false,"RegulatedInformation":{"Fields":[{"FieldId":"pet_prescription_name","FieldValue":"Ruffus"},{"FieldId":"pet_prescription_species","FieldValue":"Dog"}]},"RegulatedOrderVerificationStatus":{"Status":"Pending","RequiresMerchantAction":true,"ValidRejectionReasons":[...]}}
- This is Amazon's "Shield" compliance program for regulated products (pet prescriptions shown in sample; presumably also applies to age-restricted/weapons/pharma-adjacent categories). A seller in a regulated category must review and approve/reject verification info before an order ships. `updateVerificationStatus` (PATCH, same path) lets the seller reject with a reason code (e.g. "shield_pom_vps_reject_incorrect_weight" — POM = "Product Of Medicine"/prescription-only-medicine).
- NOT mentioned ANYWHERE in the original issue's checklist. Likely NICHE (only relevant if OL's Amazon-selling customers list regulated products), but if relevant, it's a genuinely new order-lifecycle gate no other researched platform (#2879/#2880/#2882) has an equivalent of. Worth one line in the SPIKE as a category to be aware of, deliberately out of scope unless a customer need surfaces.

### S10 — searchListingsItems: ✅ VERIFIED LIVE
- GET /listings/2021-08-01/items/SellerId?identifiersType=SKU&identifiers=GM-ZDPI-9B4E,HW-ZDPI-9B4E,TC-ZDPI-9B4E&marketplaceIds=ATVPDKIKX0DER,A2EUQ1WTGCTBG2&includedData=summaries,offers,fulfillmentAvailability,issues&pageSize=1 (NA host required, same US-marketplace-pattern rule)
- HTTP 200, {numberOfResults, pagination:{nextToken,previousToken}, items:[...]} — same rich issues/enforcements shape as getListingsItem (Evidence #7). Confirms S10 (enumerate listings -> reconcile mappings) works and returns pagination tokens for a full sweep.

### O5 — masked buyer email pattern, CONFIRMED with higher confidence than issue's source
Grepped both order model files' canned sample data (not a GitHub issue thread — the OFFICIAL Amazon model
repo's own representative samples): EVERY buyerEmail sample across JP/UK/Brazil/Turkey/generic test cases
follows "buyer-email@marketplace.amazon.<tld>" — e.g. "buyer-email@marketplace.amazon.co.jp",
"...co.uk", "...com.br", "...com.tr". This is the SAME masked-relay pattern the issue predicted from GitHub
issue threads (which it flagged as "PARTLY UNCONFIRMED"), now corroborated by Amazon's own official model
samples. Upgrades confidence from "community-report, availability may change without notice" to "consistent
across every official sample in the current model file" — still not a live production email (sandbox samples
are illustrative, not a guarantee of production behavior), but meaningfully stronger evidence.

### O7 — buyer tax id: RESOLVED, same field family as D3
Confirmed via schema definitions grep: `OrderTaxRegistration` / `TaxRegistrationAttribute` exist, and the
LIVE sample data already captured (Evidence #4, Brazil test case) shows:
```json
"taxRegistrations": [
  {"entityType":"BUYER","legalName":"Oliveira Tecnologia Ltda","taxRegistrationType":"VAT","taxRegistrationNumber":"1234567890"},
  {"entityType":"MARKETPLACE","taxRegistrationType":"CNPJ","taxRegistrationNumber":"15436940"},
  {"entityType":"MERCHANT","legalName":"TechStore"}
]
```
**O7 is answered by the SAME field as D3**: `taxRegistrations[].entityType === "BUYER"` carries the buyer's
own tax registration (VAT number in this sample) alongside their legal/company name — this is a genuine buyer
tax id, present when `includedData=TAX` is requested. One list, three roles (BUYER/MARKETPLACE/MERCHANT) —
O7, D3 and part of D1/D2 (buyer data sufficient to invoice) all draw from this single array. Worth modelling
as ONE mapping concern in the eventual adapter rather than three separate reads.

### P9 — no tax-rate field anywhere in Listings Items API model
Grepped the FULL listingsItems_2021-08-01.json model for any key containing "tax" — ZERO matches. There is no
top-level Listings API field for setting a tax rate at publish time (unlike Erli's enum `taxRate` field the
issue compared it to). Two readings, not mutually exclusive:
1. Tax rate might live INSIDE the dynamic product-type JSON Schema (a per-product-type attribute set via
   `patches`/`attributes`, not a fixed Listings API field) — consistent with product-type schemas being where
   category-specific fields live (T5/T6).
2. More likely, given Evidence #3/#4/#24 (IossNumber, DeemedResellerCategory, taxRegistrations with
   entityType:"MARKETPLACE"): Amazon is very often the VAT-collecting MARKETPLACE FACILITATOR itself for
   EU/UK sales (post-2021 EU VAT e-commerce package, and UK's own post-Brexit marketplace rules) — Amazon may
   simply calculate and remit VAT on the seller's behalf for many transactions, meaning there may be NO
   seller-settable rate to begin with for a large share of orders. This would be a materially different shape
   from Allegro/Erli's model (seller declares the rate) and needs to be stated as a hypothesis to confirm
   against real product-type schemas and Seller Central tax settings, not assumed.
This reframes P9 from "missing feature to work around" to "possibly the wrong mental model — Amazon may own
tax entirely for FR/DE/PL, same posture ADR-063/#2245 already handles for other 'marketplace facilitator'
cases." Recommend checking Seller Central's own VAT/tax settings documentation next, not just the API schema.

### X2 — no rate-limit-query API exists anywhere (confirms C8)
Searched the full model repo top-level directory listing for anything named "rate"/"rate-limit" — zero
matches (unlike eBay's #2880 finding of `GET /developer/analytics/v1_beta/rate_limit/`). CONFIRMS the issue's
C8 claim precisely: no quota-query API, react to 429 only. Amazon is structurally worse than eBay on this
specific axis — no rate-limit observability endpoint at all.

### S8 — CONFIRMED: no real deactivate/withdraw primitive exists
Full Listings Items API operation list: deleteListingsItem (hard DELETE), getListingsItem, patchListingsItem,
putListingsItem, searchListingsItems. No "deactivate"/"withdraw"/"pause" verb or status-enum found anywhere in
the model. `deleteListingsItem`'s own description is "Delete a listings item" — a hard delete, not eBay's
`withdrawOffer` shape (#2880 S8: "goes into the unpublished state, and will require a publishOffer call to
relist"). CONFIRMS the issue's own S8 hedge precisely: quantity=0 via patchListingsItem (fulfillment_availability
merge, Evidence #16/#17) is genuinely the only pause mechanism — same posture as Allegro/Erli, NOT eBay's
superior withdraw-and-relist model. #1689's OfferDeactivator gap stays unfilled by Amazon.

### D8/R4-R7 — CONFIRMED, no refund/return write operation anywhere in SP-API
Enumerated ALL operations in the Finances API (the most likely candidate for a refund-write capability):
- financesV0: 4 read-only operations (listFinancialEventGroups/listFinancialEventsByGroupId/
  listFinancialEventsByOrderId/listFinancialEvents)
- finances_2024-06-19: 3 read-only (listTransactions/listBalances/listSummary)
- transfers_2024-06-01: initiatePayout (POST, but this pays the SELLER — a payout, not a buyer refund),
  listPayouts, getPaymentMethods, listExpectedPayouts
- financesInvoices_2026-06-25: 2 read-only (getInvoiceHeaders/getInvoice)
Combined with the already-confirmed absence of any refund/return-write path in Orders (v0 or v2026), and
Reports being read-only by construction (R1), this gives HIGH CONFIDENCE (three independent negative checks
across the three most plausible API groups) rather than a single "not found" search:
**CONFIRMED: D8 (RefundExecutor) and R4/R5/R6/R7 (approve/decline/receive/refund a return) are all genuinely
NOT SUPPORTED anywhere in current SP-API.** A refund must happen through Seller Central manually or as part
of Amazon's own automated returns processing that sellers have no programmatic write access to. This is a
structural, not a research-gap, conclusion — matches the issue's own "❌ report-only, nothing writable found"
hedge, now confirmed rather than merely suspected.

### 🎯 MAJOR — P9/D3/D5 all resolve together via the tax schema definitions
Direct schema inspection (definitions section, orders_2026-01-01.json):

**P9/D3 DEFINITIVELY CONFIRMED (was hypothesis, now certain):**
`ItemTaxCollection.model` field, possible value `"MARKETPLACE_FACILITATOR"`, described VERBATIM as:
*"Tax is withheld and remitted to the taxing authority by Amazon on behalf of the seller"*
Plus `ItemTaxCollection.responsibleParty` — names who actually owes/remits.
Plus `ItemTaxCalculationBreakdown.reportingScheme`: `UOSS` (Union One-Stop-Shop — item held in EU) /
`IOSS` (Import One-Stop-Shop — item not held in EU) — the exact EU VAT e-commerce package scheme identifiers.
**This is no longer a hypothesis: Amazon has a NAMED, DOCUMENTED per-item field stating whether IT (not the
seller) is the party remitting VAT, and which EU cross-border VAT scheme applies.** P9's "missing tax rate
field" reads entirely differently now: for MARKETPLACE_FACILITATOR items, there IS no seller-settable rate
because the seller has no VAT liability to declare — Amazon owns it end to end. This directly extends #2245's
existing "marketplace facilitator" tax posture (ADR-063) — Amazon needs the SAME treatment eBay's
`ebayCollectAndRemitTaxes` and Amazon's own v0 `IossNumber`/`DeemedResellerCategory` already hinted at, now
with a definitive schema-level confirmation.

**D5 RESOLVED — Amazon natively separates shipping tax from item tax, OL may not need to compute the split:**
`ItemProceedsDetailedBreakdown.subtype` enum: `ITEM`, `SHIPPING`, `GIFT_WRAP`, `COD_FEE`, `OTHER`, `DISCOUNT`
— "only available for TAX and DISCOUNT proceeds types" — meaning when the TAX proceeds category is broken
down in detail, Amazon reports a SEPARATE subtotal for the SHIPPING-attributable portion vs the ITEM-attributable
portion. **This means Amazon may not need `splitShippingAcrossRates` (#2248/#2252) at all for its own tax
figures — Amazon already does the split and reports it natively**, unlike a platform where OL has to derive
the shipping-tax portion itself from a lump sum. Recommend confirming this against a real order with
`includedData=TAX` returning a genuinely mixed-rate basket, since the sandbox sample data doesn't populate
this level of detail by default.

## SESSION 3 (2026-09-07) — C13 Notifications: partially UNBLOCKED, prior conclusion CORRECTED

Live re-test with the same sandbox app ("OL-testt", Solution Provider Portal, **Status: `Sandbox`**) and a
freshly minted sandbox refresh token (obtained via the app-list dropdown -> "Create Token" -> Sandbox Testing
page — NOT via Seller Central "Develop Apps" / "Authorize app", which does not exist for a Sandbox-status app).

### 🔧 CORRECTION to Session 1's C13 conclusion
Session 1 recorded a single `403` on `getDestinations` with a refresh_token-based token and hypothesised a
missing "Notifications" role, i.e. that the whole Notifications API was blocked for this app. **That was
wrong.** Per-operation testing shows the API is largely usable in the static sandbox — only the *destination
write/list* half is refused. Session 1's error was generalising from one operation to a whole API.

Note also: one earlier `403` in this session carried `"details": "The access token you provided is revoked,
malformed or invalid."` — that was an artefact of a **truncated** access token (copied through `head -c 300`),
not a real auth signal. The genuine refusal carries an EMPTY `details`. Worth knowing: a truncated bearer
token and a genuinely unauthorized one are distinguishable only by that field.

### Static sandbox support is REAL for Notifications — confirmed from the model, not inferred
`models/notifications-api-model/notifications.json` (note: `notifications.json`, not `notifications_v1.json`)
carries **11 `x-amzn-api-sandbox` blocks across 9 of 10 operations**. `getDestinations`' block declares
`"parameters": {}` — i.e. no params, exactly as we called it — so the `403` is unambiguously **authorization**,
never a static-pattern mismatch (which answers `400 "Could not match input arguments"`).
**`sendTestNotification` is the ONE operation with no sandbox block at all.**

### Results — seller-authorized token (grant_type=refresh_token), host NA (EU/FE identical where tested)
| Operation | Grantless per docs? | Result |
|---|---|---|
| `getSubscriptions?notificationTypes=ANY_OFFER_CHANGED` | no | ✅ 200, canned subscription |
| `getSubscription/ANY_OFFER_CHANGED` | no | ✅ 200, `TEST_CASE_200_SUBSCRIPTION_ID` |
| `createSubscription/ANY_OFFER_CHANGED` | no | ✅ 200, `TEST_CASE_200_SUBSCRIPTION_ID` |
| `getDestination/{id}` (single) | **yes** | ✅ 200, canned SQS destination |
| `getDestinations` (list) | **yes** | ❌ 403 Unauthorized, empty `details` — on **all three** hosts (EU/NA/FE) |
| `createDestination` | **yes** | ❌ 403 Unauthorized, empty `details` |
| `getSubscriptionById/{id}` | **yes** | ❌ 500 InternalFailure (Amazon-side, not ours) |
| `deleteSubscriptionById/{id}` | **yes** | ❌ 500 InternalFailure (Amazon-side, not ours) |
| `sendTestNotification` | no | ❌ no sandbox support (no model block) |

**The grantless/non-grantless split does NOT cleanly predict the outcome** — `getDestination` (single) is
documented grantless yet answers 200 on a seller token, while `getDestinations` (list) is equally grantless and
answers 403. So "grantless ops need a grantless token" is not a sufficient explanation; the sandbox's
per-operation authorization is inconsistent. Flag rather than rationalise.

### 🎯 Root cause of `invalid_scope`: grantless is unavailable to this app ENTIRELY, not per-scope
Five scopes tested against `grant_type=client_credentials`, **all `invalid_scope`**:
`sellingpartnerapi::notifications`, `::migration`, `::client_credential:rotation`, `::shipping`, `::tracking`.

The decisive one is **`sellingpartnerapi::client_credential:rotation`** — a generic scope backing
`rotateApplicationClientSecret`, available to any normally-registered SP-API app regardless of roles. Its
rejection means the **whole `client_credentials` grant is refused for this app client**, so this was never a
missing-Notifications-role problem. Combined with the portal UI evidence (Status `Sandbox`; the app-edit form
offers only `API Type: SP API` with no roles section; the row dropdown offers only "Create Token"), the
explanation is the **app registration tier**: a Sandbox-status app has no role-request surface and no grantless
grant. Session 1's official-docs quote ("grantless operations apply only to seller applications") is consistent
with this.
**Not verified**: that a full Private/Public registration *would* grant it. That remains the open assumption.

### What this means for the epic — the transport still cannot be validated in sandbox
The subscription CONTRACT is now verifiable (subscribe/read/enumerate all answer 200). The **delivery channel
is not**, and that is the half that matters for OL's cost estimate:
- `createDestination` → 403, so no SQS/EventBridge destination can be registered at all;
- `sendTestNotification` → no sandbox support, so no notification can be made to arrive.
So **no end-to-end notification can be observed in the static sandbox under any app tier** (the second half is
a model-level absence, not a permission). Validating the inbound transport — ADR-049-shaped durable ingress,
the epic's #1 architectural cost driver — requires a **fully registered app plus a real SQS queue**, and is
therefore live-account work, not sandbox work. This narrows C13 from "blocked, unknown" to "contract verified,
transport unverifiable in sandbox by construction".

### Practical note for anyone re-running this
`getDestinations`' 403 is reproducible on EU, NA and FE hosts, so it is not the region-mismatch cause the
official "Authorization Errors" page lists. Session 2's community-thread reading (role-related 403s on
`createSubscription`) does **not** apply here — `createSubscription` is precisely one of the operations that
works.

## SESSION 3b (2026-09-07) — F5 was checked against only ONE of two shipping-purchase APIs

### 🔍 The gap: `shipping-api-model` is a SEPARATE API from `merchant-fulfillment-api-model`
Enumerated all 53 API model directories in `amzn/selling-partner-api-models`. Session 1/2's F5 work read the
**Merchant Fulfillment** use-case guide's availability table only. There is a second, independent
label-purchasing API — **Amazon Shipping API v2** (`shipping-api-model/shippingV2.json`) — carrying
`getRates`, `purchaseShipment`, `directPurchaseShipment`, `oneClickShipment`, `getTracking`,
`getShipmentDocuments`, `cancelShipment`, `getAccessPoints`, `linkCarrierAccount`, `submitNdrFeedback`,
`createClaim`. **11 of its 12 sandbox blocks are `dynamic`**, not static (only `getAdditionalInputs` is static)
— which matters, because the dynamic sandbox routes to a real backend and therefore answers *country-specific*
questions a static canned payload never could.
Also enumerated for completeness: `easy-ship-model`, `delivery-by-amazon`, `external-fulfillment` — not tested.

### ✅ VERIFIED LIVE, END TO END — you *can* buy a label through the API, and get the label bytes back
Against the dynamic sandbox (`sandbox.sellingpartnerapi-eu`), seller-authorized token, GB domestic:
1. `POST /shipping/v2/shipments/rates` -> **200**, `requestToken` + 2 rates
   (`Amazon Shipping One Day` 4.01 GBP, `Amazon Shipping Two Day` 3 GBP), each with a `rateId`;
2. `POST /shipping/v2/shipments` with that `{requestToken, rateId}` and
   `requestedDocumentSpecification: {format: PNG, size 4x6 INCH, requestedDocumentTypes: [LABEL]}`
   -> **200**, `shipmentId: amzn1.sid.97458981074956.100` plus `packageDocuments[].contents` carrying **real
   base64 PNG label bytes** (verified `iVBORw0KGgo…` PNG magic).
So the full rate->purchase->label flow is exercisable in sandbox. This is a *stronger* capability confirmation
than anything F5 previously had, and it is the OL-relevant "buy shipping via API" question answered directly.

### 🎯 F5 for POLAND — refused by a POSITIVE service-side answer, with a working control
| shipTo/shipFrom country | `getRates` result |
|---|---|
| GB | ✅ 200, 2 rates + rateIds |
| FR | ✅ 200, rates returned |
| **PL** | ❌ 400 `There is no marketplaceId configured to AmazonShippingIdentifier = AmazonShipping_PL for the AmazonShipping` |
| DE | ❌ 400, same shape (`AmazonShipping_DE`) |
| US | ❌ 400, same shape (`AmazonShipping_US`) |

**The GB/FR control is what makes this evidence rather than a shrug**: they prove the app is authorized for
Shipping v2 and the dynamic sandbox is reachable, so the PL refusal is country-scoped and not an artefact of a
misconfigured sandbox app. Amazon *names* the missing configuration (`AmazonShipping_PL`), which is a positive
assertion of absence — materially better than Session 2's "Poland is absent from a docs availability table".

### ⚠️ Do NOT generalise one shipping API's country list to the other
Merchant Fulfillment's own table lists **DE and US** as available; Amazon Shipping v2 **refuses both**. The two
programmes have different country coverage, so F5's conclusion must be stated per API. Net for the epic: PL is
unavailable in **both**, but for independent reasons and via independent evidence — which is a stronger
conclusion than either check alone, not a redundant one.

### Consequence for OL (unchanged direction, firmer basis)
A Polish Amazon seller cannot buy shipping through Amazon at all. Labels must come from OL's existing carrier
adapters (InPost/DPD), with Amazon only receiving `confirmShipment` + the tracking number (F2, already ✅
verified live in Session 1). Nothing in OL's shipping context needs an Amazon Buy-Shipping path for FR/DE/PL.
**Not tested**: `directPurchaseShipment`, `oneClickShipment`, `getAccessPoints` (relevant to F7/O14 pickup
points), `cancelShipment`, `easyShip`, `delivery-by-amazon`, `external-fulfillment`.

### Related: MCF / Fulfillment Outbound — `createFulfillmentOrder` has NO sandbox block
`fulfillment-outbound-api-model/fulfillmentOutbound_2020-07-01.json` carries 14 sandbox blocks overall, but
**`createFulfillmentOrder` is not among them** — so ordering MCF fulfilment cannot be exercised in the static
sandbox, the same class of model-level absence as `sendTestNotification` (Session 3). Untested beyond that.

### And: there is NO buyer-side purchasing API in SP-API at all
Across all 53 model directories there is no operation for placing an order *as a buyer* — SP-API is
seller-side by construction. Amazon Business procurement integrations are a separate product, out of scope for
#2881 and unrelated to anything OL does. Recorded so the question is not re-asked.

## SESSION 3c (2026-09-07) — 🔧 CORRECTION to 3b: `channelType` is load-bearing, and the `AMAZON` path is a STUB

Session 3b tested `channelDetails.channelType: "EXTERNAL"` only, and concluded "PL cannot buy shipping via
API". That conclusion was **too strong** and is corrected here. Re-tested across both channel types, both
directions, five countries, four currencies and four package weights.

### A) `EXTERNAL` — the sandbox does a REAL, country-specific lookup, and `shipFrom` is what decides
| shipFrom → shipTo | result |
|---|---|
| PL → PL | ❌ `AmazonShipping_PL` not configured |
| PL → GB | ❌ `AmazonShipping_PL` (same — so it is NOT about the destination) |
| PL → FR | ❌ `AmazonShipping_PL` |
| **GB → PL** | ✅ **200**, 0 eligible rates (accepted, not refused) |
| **FR → PL** | ✅ **200**, 0 eligible rates |
| GB → US | ✅ 200, 0 rates |
| US → GB | ❌ `AmazonShipping_US` |
| DE → GB | ❌ `AmazonShipping_DE` |
| GB → DE | ⚠️ `Cross-border compliance data is missing or invalid (D-720)` — a *different*, fixable error |
| GB → GB | ✅ 2 rates (4.01 / 3.00 **GBP**) |
| FR → FR | ✅ 1 rate (7.23 **EUR**) |

Two conclusions. **`shipFrom` (the seller's country) drives the `AmazonShipping_XX` identifier** — so a PL
*seller* is cut off, while **shipping TO Poland from a supported seller country is accepted**. Session 3b never
tested the reverse direction and would have got this wrong. And **the EXTERNAL path is demonstrably not
canned**: rates differ by country *and* currency (GB in GBP, FR in EUR, different prices), refusals name the
specific missing config, and cross-border produces its own distinct compliance error. Currency is irrelevant —
PL refused identically under PLN/EUR/USD/GBP.

### B) 🚨 `AMAZON` channel — STUBBED in the sandbox, so it proves NOTHING about PL
With `channelDetails: {channelType:"AMAZON", amazonOrderDetails:{orderId:"902-1845936-5435065"}}`:
- **PL, DE, US, GB, JP — and the non-existent country code `XX` — all return HTTP 200 with the identical three
  rates**: 4.76 GBP One-Day Tracked, 3.72 GBP Two-Day Tracked, 3.72 GBP Standard Tracked. Always GBP,
  regardless of country or currency.
- **Weight-invariant**: 0.5 / 1 / 5 / 20 kg all return the same three prices.
- **`purchaseShipment` SUCCEEDS for `XX`**: HTTP 200, `shipmentId amzn1.sid.00032328622983.101`, a valid PNG
  label of **168 008 bytes — byte-identically sized to the PL one** (`amzn1.sid.01007142850035.101`).
  (Note: the purchase needs `requestedDocumentSpecification.dpi` ∈ {300, 203}; omitting it answers
  `400 "Amazon Shipping doesn't support requested DPI null"`, which is a parameter fault, not a country one.)

Buying a label for a country that does not exist is conclusive: this path performs **no marketplace-config
lookup and no country validation at all**. So the PL "success" on this channel is an artefact of the stub, and
is evidence of nothing — neither for nor against PL working in production.

### C) Why this makes F5 MORE open, not less
The `AMAZON` channel is exactly the case OL would use — buying a label for a real Amazon order. `EXTERNAL` is
for off-Amazon orders. So the well-evidenced PL refusal covers the channel OL needs *least*, and the channel it
needs *most* is **unverifiable in the sandbox and requires a live account**. Session 3b's "PL unavailable in
both APIs" is accurate only for `EXTERNAL` + the Merchant Fulfillment docs table, and **must not be quoted as
covering Amazon-order label purchase**.
Direction for OL is unchanged (plan on InPost/DPD labels + `confirmShipment`, F2 ✅ verified), but the basis is
weaker than 3b implied and should not be recorded as settled.

### Methodological note worth keeping
A dynamic-sandbox 200 is not evidence on its own. The cheap discriminator that caught this: **send an input
that cannot possibly be valid** (a bogus country code) and see whether the response changes. Two other
tell-tales agreed — invariance to a parameter that must affect the answer (weight → price), and a response
currency that ignores the request. Apply the same probe before trusting any other dynamic-sandbox result in
this spike; the static-sandbox findings are unaffected, since canned responses are declared as canned.

## SESSION 4 (2026-09-08) — invoicing paths, returns via externalFulfillment, getOrder v2026 correction

Driven by a direct question: "does status change / invoice data / returns work, and is it sandbox-tested."
Everything below is a live call from this session; no inference from docs alone is presented as a result.

### getOrder v2026-01-01 — WORKS, corrects Evidence #6's scope
Tested all 3 documented static test cases with exact model parameters, host NA:
```
GET /orders/2026-01-01/orders/171-9876543-2109876?includedData=BUYER,RECIPIENT,PROCEEDS,EXPENSE,PROMOTION,CANCELLATION,FULFILLMENT,PACKAGES
  -> 200, full BR/PRIME payload
GET /orders/2026-01-01/orders/028-1234567-8901234?includedData=BUYER,RECIPIENT,PROCEEDS,FULFILLMENT,TAX
  -> 200, tax.taxRegistrations[0].taxRegistrationNumber = "TR1234567890"
GET /orders/2026-01-01/orders/114-9876543-1234567?includedData=RECIPIENT,PROCEEDS,FULFILLMENT
  -> 200, IN_STORE_PICK_UP program
GET /orders/2026-01-01/orders/TEST_CASE_400 -> 400 (negative case, as documented)
```
`searchOrders` (the enumeration operation) is still broken per Evidence #6 — this is a DIFFERENT operation on
the same API version. Evidence #6 must be read as scoped to `searchOrders` only.

### invoices-api-model (2024-06-19) — all 4 operations live-tested, BR-only sandbox coverage
```
GET  /tax/invoices/2024-06-19/attributes?marketplaceId=A2Q3Y263D00KWC -> 200, invoiceStatusOptions populated,
     invoiceTypeOptions=[] (empty even for the one supported marketplace)
GET  same, no marketplaceId -> 400 "Missing required parameter"
GET  same, marketplaceId=A1PA6795UKMFR9 (FR) / APJ6JRA9NG5V4 (DE) / A13V1IB3VIYZZH (PL, guessed) ->
     all 400 "Missing required parameter: 'marketplaceId'" -- i.e. the static sandbox has NO fixture for any
     non-BR marketplaceId, so it neither confirms nor denies FR/DE/PL support for this API.
POST /tax/invoices/2024-06-19/governmentInvoiceRequests (exact BR fixture body) -> 204
GET  /tax/invoices/2024-06-19/governmentInvoiceRequests (matching query params) ->
     200 {"invoiceExternalDocumentId":"35230948404147000173550010000001961","status":"SUCCESS"}
```
`createGovernmentInvoice`'s body has NO content/document field — it is a request that AMAZON issue the
document (government-authority-facing), confirmed by the schema's own field descriptions
(`externalInvoiceId`: "typically the government agency that authorized the invoice";
`govResponse`: "response message from the government authority"). This is the opposite direction from
`UPLOAD_VAT_INVOICE` below.

### UPLOAD_VAT_INVOICE via Feeds — undecidable in static sandbox, not confirmed working or broken
```
POST /feeds/2021-06-30/feeds  feedType: "POST_PRODUCT_DATA" (exact model fixture) -> 202 {"feedId":"3485934"}
POST /feeds/2021-06-30/feeds  feedType: "UPLOAD_VAT_INVOICE" (same body, only feedType swapped) ->
     400 "Could not match input arguments"
```
`feedType` is an unconstrained `string` in the OpenAPI model (no enum), and grepping the ENTIRE
selling-partner-api-models repo for `UPLOAD_VAT_INVOICE` returns zero hits — it is a feed type documented in
prose (developer-docs "Create and Upload Invoices") but not present anywhere in the machine-readable model.
The control call proves the createFeed mechanism itself works; the 400 on the VAT-invoice type is therefore a
missing STATIC FIXTURE, not a rejection of the feature. This must be tested on a live account to know anything.

### externalFulfillment invoice generation — separate from both of the above
```
POST /externalFulfillment/2024-09-11/shipments/TEST_CASE_200_FBA_SHIPMENT_ID/invoice (no body needed) ->
     200 {"document":{"format":"PDF","content":"<base64 PNG-looking bytes, actually a PDF>"}}
GET  same path -> 200, same shape (retrieve)
```
Third invoicing path, scoped to the External Fulfillment program specifically.

### externalFulfillment RETURNS — confirmed working, closes a documentation gap
This document previously had NO entry for `externalFulfillment/returns` at all — only Merchant Fulfillment and
Shipping v1/v2 were covered under "returns/shipping". Live-tested:
```
GET /externalFulfillment/2024-09-11/returns?rmaId=rmaIdOneShipmentOneItemOneQty200 ->
     200, {"returns":[{"returnReason":"Missed","status":"CREATED","numberOfUnits":1,
       "returnShippingInfo":{"forwardTrackingInfo":..., "reverseTrackingInfo":...}}]}
GET /externalFulfillment/2024-09-11/returns/rmaIdOneShipmentOneItemOneQty200 ->
     200, same entity via getReturn, status "CARRIER_NOTIFIED_TO_PICK_UP_FROM_CUSTOMER"
```
Error-injection ids all live-tested:
```
rmaIdTest403 -> 403 Forbidden
rmaIdTest409 -> 409 DuplicateRequest
rmaIdTest429 -> 429 QuotaExceeded          <- only 429 reachable anywhere in this whole sandbox exploration
rmaIdTest500 -> 500 InternalFailure
rmaIdTest503 -> 500 InternalFailure         <- NOTE: model names this fixture "test503" but it answers 500, not 503
```
Sample data carries `channelName: "FBA"`, marketplace `AMAZON_US`/`AMAZON_IN` — whether an ordinary 3P seller
on FR/DE/PL has access to this program AT ALL is **not established** by anything tested this session.
Refund/write-side operations were not re-tested; Evidence #28's NOT SUPPORTED finding stands unchanged.

### Net effect on prior conclusions
- Evidence #6 (SPIKE doc) is corrected — narrowed from "the v2026-01-01 sandbox" to "the searchOrders operation".
- The invoicing story (D1/D3 in the original issue) had three concrete, testable paths this session identifies
  for the first time; none previously appeared in either doc.
- Returns now has a confirmed-working sandbox path, previously undocumented in this repo's research.

## SESSION 5 (2026-09-08) — closing out the "untouched" list: S1/S4/S11, R3, T6/F1/D2 formalized

Driven by "27 untouched — go check them." Picked the sandbox-testable subset; policy-only items (X3/X5/X6/X7)
and stateful-by-nature items (P7 image upload, P13 destructive-PUT semantics) are named separately below as
genuinely out of reach for a static (canned-response) sandbox, not skipped for lack of trying.

### S1/S4 — quantity and price write, both confirmed live
```
PATCH /listings/2021-08-01/items/A2TEST123/TEST-SKU-1?marketplaceIds=ATVPDKIKX0DER
  patches:[{op:"merge", path:"/attributes/fulfillment_availability", value:[{fulfillment_channel_code:"DEFAULT", quantity:42, marketplace_id:"ATVPDKIKX0DER"}]}]
  -> 200 {"status":"ACCEPTED", "issues":[]}
PATCH same path
  patches:[{op:"merge", path:"/attributes/purchasable_offer", value:[{marketplace_id:"ATVPDKIKX0DER", our_price:[{schedule:[{value_with_tax:29.99}]}]}]}]
  -> 200 {"status":"ACCEPTED", "issues":[]}
```
Control: PATCH with sku=BadSKU -> 400 (matches the model's own negative fixture), confirming the sandbox is
genuinely pattern-matching rather than accepting anything.

### S11 — auto-match by SKU confirmed live; by EAN/GTIN/UPC undecidable
```
GET /listings/2021-08-01/items/SellerId?identifiersType=SKU&identifiers=GM-ZDPI-9B4E,HW-ZDPI-9B4E,TC-ZDPI-9B4E&marketplaceIds=ATVPDKIKX0DER,A2EUQ1WTGCTBG2&includedData=summaries,offers,fulfillmentAvailability,issues&pageSize=1
  -> 200, numberOfResults:3, full item summaries/offers/fulfillmentAvailability
GET same endpoint, identifiersType=EAN&identifiers=1234567890123 (a syntactically valid EAN)
  -> 400 "Could not match input arguments"
```
`identifiersType` enum has 9 members (ASIN/EAN/FNSKU/GTIN/ISBN/JAN/MINSAN/SKU/UPC) — the parameter accepts the
value at the schema level, but the static sandbox has a fixture only for SKU. Same shape as Evidence #39's
`UPLOAD_VAT_INVOICE`: contract allows it, sandbox neither confirms nor denies it works. A live account is the
only way to know if EAN/GTIN-based matching actually functions.

### R3 — return status vocabulary, read from the model
`Return.status` enum (`externalFulfillmentReturns_2024-09-11.json`), 15 values:
`CREATED`, `CARRIER_NOTIFIED_TO_PICK_UP_FROM_CUSTOMER`, `CARRIER_OUT_FOR_PICK_UP_FROM_CUSTOMER`,
`CUSTOMER_CANCELLED_PICK_UP`, `CUSTOMER_RESCHEDULED_PICK_UP`, `PICKED_FROM_CUSTOMER`, `IN_TRANSIT`,
`OUT_FOR_DELIVERY`, `DELIVERED`, `REPLANNED`, `CUSTOMER_DROPPED_OFF`, `PARTIALLY_PROCESSED`, `PROCESSED`,
`REJECTED`, `CANCELLED`. The two values Session 4 observed live (`CREATED`,
`CARRIER_NOTIFIED_TO_PICK_UP_FROM_CUSTOMER`) are members of this exact list — cross-checked, not contradicted.
Terminal candidates for a future `terminalRawStatuses` hint: `PROCESSED` / `REJECTED` / `CANCELLED`.

### T6 / F1 / D2 — no new calls needed, already answered by evidence recorded under different story numbers
- T6 (parameter restrictions): the `VALIDATION_PREVIEW` finding already on file (offer-creation section) IS
  the answer — `issues[]` carries `code`/`message`/`severity`/`attributeNames`/`categories`/`enforcements`.
- F1 (read fulfillment status): `getOrder` v2026-01-01's own `fulfillment.fulfillmentStatus` field
  (`UNSHIPPED`/`SHIPPED`, observed live in Session 4) IS the answer — there is no separate operation.
- D2 (buyer data sufficient to invoice): version-dependent, same split as O7. v0 = email+name only
  (insufficient). v2026 = full tax registration + address, but ONLY when the source order actually carries a
  business buyer (`buyerInvoicePreference: "BUSINESS"`) — a private-buyer order supplies neither version with
  invoice-sufficient data.

### Genuinely out of reach for THIS kind of sandbox — named, not silently dropped
- **P7 (image upload) / P13 (does PUT drop omitted attributes)** — both require a stateful
  write-then-read-back to answer, and the static sandbox returns a canned response per request pattern with no
  persistence between calls. There is no PUT-then-GET loop that can prove or disprove either question here;
  needs a live account.
- **X3/X5/X6/X7 (compliance gate, v0 sunset date, multi-tenant quota, the SP-API fee saga)** — these are
  policy/pricing facts stated in Amazon's documentation and account terms, not API behavior. No sandbox call
  answers them; they are read-the-docs work, already partially done for the fee saga in the SPIKE doc's Open
  risks section.

### Updated tally after this session
Have (sandbox-proven): 34. Confirmed absent: 10. Partial/undecidable-in-sandbox: 11 (adds EAN/GTIN matching).
Genuinely untouched or out of static-sandbox reach: 20 (T8, S2/S9, P6/P8/P10/P11, F4/F7, D9, O4/O16, X3/X5/X6/X7,
P7/P13 named as structurally out of reach above).

## SESSION 6 (2026-09-08) — closing the remaining 14: S2/S9 confirmed, T5/P6/P8/P10 unified, P11/F4 demonstrated undecidable

Driven directly by "if 14 are testable, test all of them." All calls below are live against
`sandbox.sellingpartnerapi-na.amazon.com` unless noted.

### S2, S9 — confirmed, and they are NOT new operations
```
POST /feeds/2021-06-30/feeds  feedType:"POST_PRODUCT_DATA" -> 202 {"feedId":"3485934"}   (= S2, same as P1/P4)
PATCH .../fulfillment_availability  quantity:5 -> 200 ACCEPTED                           (= S9, same as S1)
```

### T5/P6/P8/P10 — one root cause, PROVEN not inferred
```
GET /definitions/2020-09-01/productTypes/LUGGAGE?marketplaceIds=ATVPDKIKX0DER -> 200
  schema.link.resource = "https://schema-url"   <- not a real host
GET https://schema-url -> HTTP:000, no DNS resolution at all
```
This is a fixture placeholder, confirmed by attempting to actually fetch it. The static sandbox literally never
returns real JSON Schema content for ANY product type — this forecloses T5 (conditionals), P6 (description
grammar), P8 (variation/parentageLevel), P10 (GPSR fields) simultaneously, since all four need schema CONTENT
the sandbox structurally cannot deliver, not just a link to it.

### P11, F4 — demonstrated undecidable (not merely assumed), same class as P7/P13
```
PUT .../DUP-SKU-1  item_name:"Test A" -> 200 {"sku":"GM-ZDPI-9B4E", "status":"ACCEPTED", ...}
PUT .../DUP-SKU-1  item_name:"Test B" (same SKU, different content) -> 200, BYTE-IDENTICAL response
```
Proves the sandbox pattern-matches request SHAPE and ignores CONTENT — cannot tell upsert from
reject-as-duplicate.
```
POST /orders/v0/orders/902-1106328-1059050/shipmentConfirmation
  packageReferenceId:"1", trackingNumber:"112345678" (exact model fixture) -> 204
POST same endpoint, same packageReferenceId:"1", trackingNumber:"999999999" (only this changed) ->
  400 "Could not match input arguments"
```
No fixture exists for "same reference, different tracking" — cannot confirm the issue's own cited claim that
Amazon treats a re-submitted `packageReferenceId` as an edit rather than a duplicate.

### T8, D9, O4, O16 — answered from evidence already on file, no new call needed
- T8: moot — T1 already confirms no category tree exists, so a taxonomy identity string format is a
  non-decision with nothing to project onto.
- D9: every order sample this session carries a real `currencyCode` (BRL/TRY/USD) — sufficient for ADR-040's
  stamp, which needs only the order's own currency + a placement time.
- O4: follows directly from C13 (no webhook, delivery unverifiable in sandbox) — no new evidence changes this.
- O16: the cited rate numbers are documented facts, not sandbox-observable; the sandbox's OWN throttle (5rps/15
  burst) is a different, unrelated number.

### Only ONE item from the original 14 remains genuinely untouched
**F7** (source options discovery / `listOrderStatuses`, `listDeliveryMethods`, `listPaymentMethods` for
Amazon-as-source) — not attempted this session, no evidence either way.

### Final tally after Sessions 3-6
Have (sandbox-proven or evidence-derived): 40. Confirmed absent: 10. Structurally undecidable in THIS sandbox
(schema never resolves, or needs write-then-observe with no state): 13 (EAN/GTIN search, UPLOAD_VAT_INVOICE,
non-BR invoice marketplaceId, F5 Amazon-channel stub, T5/P6/P8/P10 schema-link, P7/P11/P13/F4 state-needed).
Genuinely untouched: F7, plus the 4 policy-only items (X3/X5/X6/X7) that are read-the-docs work, not sandbox
work.

## SESSION 7 (2026-09-08) — F7 closed: no discovery operation, values are baked-in enums

Last remaining sandbox-adjacent question from the original 14. Read directly from the Orders v0 model.

```
All 9 operations in ordersV0.json enumerated:
  getOrders, getOrder, getOrderBuyerInfo, getOrderAddress, getOrderItems, getOrderItemsBuyerInfo,
  updateShipmentStatus, getOrderRegulatedInfo, updateVerificationStatus, confirmShipment
-> none is a listOrderStatuses/listDeliveryMethods/listPaymentMethods equivalent
```
The vocabulary itself is present, just not behind an API call — it's declared as closed enums in the model:
```
ShipmentStatus enum: ["ReadyForPickup","PickedUp","RefusedPickup"]
VerificationStatus enum: ["Pending","Approved","Rejected","Expired","Cancelled"]
```
Conclusion: this is a platform characteristic, not a sandbox gap — no live account would ever reveal a
discovery endpoint that doesn't exist. `SourceOptionsReader`'s answer for Amazon is "read the enum from the
model at build time," not "call an operation." No further action needed; nothing here can be tested further.

### Final tally
Have (sandbox-proven or evidence-derived): 41. Confirmed absent: 10. Structurally undecidable in this sandbox:
13. Genuinely untouched — policy/account-terms facts with no corresponding API operation at all: X3
(compliance review process), X5 (v0 deprecation date), X6 (multi-tenant quota policy), X7 (SP-API fee saga).
Every sandbox-testable story from the issue's own checklist has now been run.
