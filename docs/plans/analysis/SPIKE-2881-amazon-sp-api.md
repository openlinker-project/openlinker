# Spike #2881 — Amazon SP-API (FR/DE/PL): capabilities, flows, verdict

> **Status: IN PROGRESS, not final.** Issue #2881's own day-0 desk research (2026-09-04) has been partially
> live-verified against the Amazon SP-API **static sandbox** on 2026-09-04 and 2026-09-07. The app used is a
> **`Sandbox`-status app** registered in the Solution Provider Portal — *not* a Private app, which the original
> header claimed; that distinction turned out to be load-bearing (Evidence #32), so it is corrected here.
> Several stories remain unconfirmed or blocked — see "Open risks" and the per-group status
> below. Do **not** treat any box here as satisfying the issue's own DONE rule ("a live-call transcript +
> the endpoint + one line on *why that endpoint*, or an explicit NOT SUPPORTED") unless explicitly marked
> ✅ VERIFIED LIVE below. Everything else is either the original desk claim (unverified) or a live probe that
> came back inconclusive.

## Verdict — provisional, leaning 4A-shaped (marketplace-only, high cost, high strategic value)

Confirms the issue's own framing: Amazon is a **marketplace-only** destination (not `ProductMaster`, not
`InventoryMaster` — this spike did not find evidence to overturn either exclusion; see Evidence #1). Cost
drivers are structural (ingestion transport, PII retention, no browsable taxonomy) rather than adapter-shaped,
exactly as the issue predicted. One structural finding **not** in the original issue meaningfully changes the
risk picture: **the newer Orders API version (v2026-01-01) appears to have incomplete static-sandbox coverage**
as of this session (Evidence #6) — this was not anticipated and affects how AC2 can be satisfied for Orders
specifically.

No adopt/don't-adopt recommendation is made yet — AC7 (public vs private app), AC8 (commercial sanity check)
and full FR/DE/PL parity (AC2) are all still open.

**One finding materially reframes several tax-related stories at once (Evidence #29/#30)**: Amazon carries a
named, documented `ItemTaxCollection.model: "MARKETPLACE_FACILITATOR"` field, stated verbatim as *"Tax is
withheld and remitted to the taxing authority by Amazon on behalf of the seller."* For a large share of FR/DE/PL
orders, Amazon likely owns VAT collection and remittance entirely — P9's "no tax rate field to write" is very
possibly not a gap but the correct behaviour for this tax model, and D5's shipping-tax-split concern may be
moot because Amazon already reports it natively. This needs confirming against a real mixed-rate order, but it
meaningfully lowers the estimated cost of the tax-integration slice of this epic if it holds.

## Evidence

Numbered, each either a **live-verified** finding from this session or an **unresolved** desk claim carried
over from the issue (marked accordingly).

1. **✅ VERIFIED LIVE** — `getMarketplaceParticipations` (`GET /sellers/v1/marketplaceParticipations`) returns
   HTTP 200 against the EU sandbox host regardless of the actual regional host called — static sandbox returns
   a single canned US marketplace (`ATVPDKIKX0DER`, storeName `"BestSellerStore"`) irrespective of region.
   **Confirms**: static sandbox does not vary its `marketplaceParticipations` payload by host region — this
   payload cannot be used to prove multi-marketplace (FR/DE/PL) coverage in sandbox; that requires production
   or a real seller account.

2. **✅ VERIFIED LIVE** — Orders API **v0** `GET /orders/v0/orders` with `MarketplaceIds=ATVPDKIKX0DER` (note:
   **US** marketplace ID accepted on the **EU** sandbox host without a region error, unlike every other API
   tested — see Evidence #4) and `CreatedAfter=TEST_CASE_200` returns HTTP 200 with two sample orders.
   **Confirms**: v0 uses **PascalCase** query parameters (`MarketplaceIds`, `CreatedAfter`) — matches the
   issue's X5 casing-change claim for v2026.

3. **✅ VERIFIED LIVE** — Orders v0 `getOrderItems` (`orderId=TEST_CASE_200`) returns `ItemPrice` and `ItemTax`
   as `{CurrencyCode, Amount}` only — **no percentage/rate field anywhere**. Directly confirms the issue's O10
   worry (ADR-063 forbids deriving a rate from tax/net) for v0.
   **New finding, not in the original issue**: the same payload carries `"IossNumber":""` and
   `"DeemedResellerCategory":"IOSS"` at the order-item level — this is Amazon's analogue of eBay's
   `ebayCollectAndRemitTaxes` (#2880's D3) and directly answers part of this issue's D3 ("whether the API
   exposes a machine-readable marketplace-facilitator-VAT flag" — **it does, at least in v0, for IOSS**).
   Nothing in OL's order contract models this today, same gap eBay's spike flags.

4. **✅ VERIFIED LIVE** — Orders API **v2026-01-01** `searchOrders`. Full contents of the model's own
   `x-amzn-api-sandbox` block were read (three documented static test cases: Japan, UK-with-pagination,
   Brazil-with-TAX). The **Brazil test case's `includedData=TAX` response** carries:
   ```json
   "tax": {
     "taxRegistrations": [
       {"entityType":"BUYER","taxRegistrationType":"VAT","taxRegistrationNumber":"..."},
       {"entityType":"MARKETPLACE","taxRegistrationType":"CNPJ","taxRegistrationNumber":"..."}
     ],
     "taxInvoicing": {"invoiceStatus":"PROCESSING"}
   }
   ```
   **🎯 This resolves O10/D4 definitively, from the documented spec itself**: `TAX` carries tax
   **registration numbers** (VAT/CNPJ per entity role: buyer/marketplace/merchant) and an invoice status —
   **never a percentage rate**, in either API version. Amazon order lines are confirmed rate-less; Net Sales
   eligibility depends entirely on the shop side of the chain, exactly as the issue predicted, now with primary
   evidence rather than an absence-grep.

5. **⚠️ Region validation is inconsistent across APIs.** Orders v0 accepted a US marketplace ID on the EU
   sandbox host (no region check enforced); Listings Items, Catalog Items and Product Type Definitions all
   **reject** a US marketplace ID on the EU host with `403 Unauthorized — "The marketplaces you provided are
   not valid for region"`, and accept an EU one (tested: DE `A1PA6795UKMFR9`). **Not previously documented in
   the issue** — worth stating explicitly so a future implementer doesn't assume uniform region behaviour
   across the whole SP-API surface.

6. **🔴 NEW, negative finding — v2026-01-01 `searchOrders` static sandbox may not be wired up.** Four
   parameter-encoding variants were tried against the **exact literal values published in the operation's own
   `x-amzn-api-sandbox` block** (UK test case: `createdAfter=2024-12-23T00:00:00Z`,
   `marketplaceIds=A1F83G8C2ARO7P`, `includedData=[...]`, both comma-joined and repeated-key array styles,
   both URL-encoded and raw): all four returned `400 InvalidInput — "Could not match input arguments"`.
   Region validation passed (UK marketplace accepted on the EU host, so credentials/host/region are not the
   cause). Orders v0 and Listings v2021-08-01 both worked on the **first** correctly-regioned attempt with
   equivalent effort. **Working hypothesis** (not proven): the v2026-01-01 sandbox *backend* does not yet
   honour the documented static patterns, even though the model file is well-formed and current. This is
   material to AC2: Orders v2026 sandbox coverage cannot currently be demonstrated by this method, and may
   require escalation (AWS support / SP-API forum) or a live seller account sooner than the issue anticipated.

7. **✅ VERIFIED LIVE** — Listings Items API `getListingsItem` (`GET /listings/2021-08-01/items/{sellerId}/{sku}`,
   any sellerId/sku accepted — the sandbox model uses a generic pattern, not test-case-keyed) returns HTTP 200
   with a rich `issues[]` array alongside `summaries`/`offers`/`fulfillmentAvailability`.
   **Confirms S6's ADR-009-shaped disjoint-snapshot claim directly**: a clean-looking listing item response
   still carries active issues.
   **New finding**: each issue carries an `enforcements` object (`actions`: `SEARCH_SUPPRESSED` /
   `ATTRIBUTE_SUPPRESSED` / `LISTING_SUPPRESSED` / `CATALOG_ITEM_REMOVED`) and an `exemption` status (`EXEMPT` /
   `EXEMPT_UNTIL_EXPIRY_DATE` with an expiry date / `NOT_EXEMPT`) — a materially richer per-issue severity model
   than Allegro or Erli expose. Worth a dedicated callout in T6/S6.

8. **🔴 CORRECTED (see Evidence #20) — this entry originally claimed `getCatalogItem` was unsupported in
   static sandbox. That claim was WRONG**, caused by checking the sandbox extension at the wrong JSON path
   (operation top-level instead of nested under `responses.{code}`). It **is** supported — see Evidence #20 for
   the corrected finding and live transcript. Left here, struck through in spirit rather than deleted, per the
   issue's own instruction that a wrong claim be corrected in place rather than silently removed.

9. **🔴 BLOCKED — C13 / Notifications grantless token.** `POST https://api.amazon.com/auth/o2/token` with
   `grant_type=client_credentials` requires a `scope` parameter (confirmed: omitting it returns
   `invalid_request — missing a required parameter: scope`). The scope value `sellingpartnerapi::notifications`
   — independently confirmed correct via the community SDK `saleweaver/python-amazon-sp-api`
   (`grantless_scope = "sellingpartnerapi::notifications"` hardcoded in `sp_api/api/notifications/notifications.py`)
   — was rejected with `invalid_scope` on this app. `sellingpartnerapi::migration` and bare `notifications` were
   also rejected. Amazon's own docs state grantless operations "apply only to seller applications" — whether
   this app's registration type qualifies is unconfirmed and not resolvable via further automated probing.
   **This blocks live verification of the entire Notifications API (C13), which is the epic's highest-priority
   architectural unknown** (no HTTP webhooks at all; SQS/EventBridge only). Needs a human follow-up (AWS
   support case or SP-API developer forum) before C13 can be closed.

10. **✅ T1 RESOLVED — no category/browse-node tree walk exists anywhere in SP-API, current or deprecated.**
    Checked the complete path list of every version of the two candidate APIs directly from their OpenAPI
    models:
    - Product Type Definitions 2020-09-01: exactly two operations, `searchDefinitionsProductTypes` and
      `getDefinitionsProductType` — neither walks a tree.
    - Catalog Items 2022-04-01 and 2020-12-01: exactly two paths each (`items` search, `items/{asin}` get) —
      neither walks a tree.
    - Catalog Items **v0** (deprecated): has `/catalog/v0/categories` (`listCatalogCategories`), described
      verbatim as *"Returns the parent categories to which an item belongs, based on the specified ASIN or
      SellerSKU"* — this is a `CategoryPathReader`-shaped lookup (needs an existing product to resolve its
      ancestor path), **not** a `CategoryBrowser`-shaped one (walk from root with no product needed).
    **This is a stronger, primary-source-confirmed version of the original issue's "no operation... was
    found" claim** — every path in every version was enumerated and checked, not just searched for. `T1's
    consequence stands as the issue predicted: `DestinationCategory` (#1979) does not transfer to Amazon.
    The likely replacement entry point is `searchDefinitionsProductTypes` (keyword search), since product
    type is Amazon's actual organizing unit — this needs its own UX design pass, not a port of the existing
    tree-picker.

11. **✅ F5 RESOLVED (independent confirmation) — Poland absent from FBM Ship+.** Read the Merchant
    Fulfillment API use-case guide's own availability table directly (not just re-reading the issue's cited
    source): US/UK/DE/ES/FR/IT/JP/AU all listed (various cross-border/domestic combinations, several
    "launching" in 2026), **Poland absent entirely**. Confirms the issue's finding from a second, independent
    read of the primary source.

12. **New findings spotted in the v2026-01-01 sandbox response bodies, not flagged anywhere in the original
    issue:**
    - `picking.substitutionPreference.substitutionOptions[]` — a buyer can pre-approve a substitute ASIN/SKU
      when the ordered item is unavailable. No equivalent capability exists in any other platform researched
      in this epic (#2879/#2880/#2882).
    - B2B order support: `programs: ["AMAZON_BUSINESS"]`, `buyerCompanyName`, `buyerPurchaseOrderNumber`,
      `orderItems[].product.price.priceDesignation: "BUSINESS_PRICE"`.
    - `orderAliases[].aliasType: "SELLER_ORDER_ID"` — a seller-supplied order alias field; unclear whether this
      is a write-your-own-reference mechanism analogous to TikTok Shop's `external_orders` API (#2882's O-note)
      — needs a targeted probe.
    - `packages[]` sits below the order/order-item grain, carries its own `packageStatus.status/detailedStatus`,
      `carrier`, `trackingNumber`, `shipFromAddress` — confirms F1/F2's shape, and echoes the same "a package is
      not the same as an order" caution TikTok Shop's spec (#2882 F-extra) states explicitly. Not called out as
      a caution in the original #2881 text.

13. **✅ Reports API `getReports` verified live** — comma-joined array query params work cleanly (unlike
    Orders v2026, which rejected the identical style). Sandbox implementation quality is inconsistent
    per-API, not a single global pattern to rely on.

14. **✅ T7 upgraded — `searchCatalogItems` works even though `getCatalogItem` does not.** Required the **NA**
    sandbox host (the documented pattern is baked to `ATVPDKIKX0DER`, a US marketplace ID — same
    pattern-vs-host-region conflict as Evidence #6's Orders v2026 test cases). Response is rich: a full
    browse-**classification parent chain** per matched item (e.g. "QLED TVs" → "Televisions" → "Television &
    Video" → "Electronics" — confirms the issue's claim that Catalog Items exposes browse classifications *on
    items*, still not independently walkable, consistent with Evidence #10/T1), `identifiers` with
    EAN/GTIN/UPC (directly usable for barcode-based offer linking, Allegro-parity), and `relationships` with
    `type: "VARIATION"` + `parentAsins` + `variationTheme` (directly relevant to P8/multi-variant grouping).
    **Revised conclusion**: for a `CatalogProductReader`-shaped capability (find-by-barcode/keyword before
    offering), `searchCatalogItems` is the right operation regardless — the single-ASIN `getCatalogItem`'s lack
    of sandbox support is less material than it first appeared.

15. **✅ `getDefinitionsProductType` verified live — reveals the real GTIN-exemption field name.** Response's
    `propertyGroups.product_identity.propertyNames` includes **`gtin_exemption_reason`** as a live, named
    schema property. This differs from the field name the original issue cited
    (`supplier_declared_has_product_identifier_exemption`) — **do not trust either name without confirming
    against a real product-type schema fetch**, since sandbox only returns a schema *link* (a stub URL, not
    fetchable), not the actual JSON Schema document. T5 (conditional-required-attributes) therefore **still
    cannot be exercised via sandbox** — this needs a live seller account to pull a real schema.

16. **⚠️ Methodology correction, applies retroactively.** The `x-amzn-api-sandbox` extension lives nested
    under `responses.{code}.x-amzn-api-sandbox` in the OpenAPI model, not at the operation's top level. Two
    earlier findings in this document that claimed "no sandbox block" for `patchListingsItem` were based on
    checking the wrong location and are **corrected below** (Evidence #17). The T1 conclusion (Evidence #10)
    is unaffected — it was based on enumerating actual API *paths*, not sandbox blocks. `getCatalogItem`'s
    "no sandbox at all" claim (Evidence #8) has **not yet been re-checked** with the corrected method and
    should be treated as provisional until it is.

17. **✅ F2 (`confirmShipment`) verified live — works cleanly.** `POST
    /orders/v0/orders/{orderId}/shipmentConfirmation` with the documented FedEx package-detail body returns
    HTTP 204. A sibling operation, **`updateShipmentStatus`** (`POST /orders/v0/orders/{orderId}/shipment`,
    **not mentioned anywhere in the original issue**), also exists and also works — an empty-body pattern
    returns 204, and its validation-error pattern reveals a lighter-weight `shipmentStatus` field (e.g.
    `"ReadyForPickup"`) distinct from the full package-detail confirm flow. Worth investigating for O14/F7
    (pickup-point/ISPU) relevance. `patchListingsItem` also verified live: HTTP 200,
    `{"status":"ACCEPTED","issues":[]}` with an empty-patch body.

18. **✅ P1/P4 — Feeds async flow verified live, end to end.** `createFeedDocument` (201) →
    `createFeed` (202, `{feedId}`) → `getFeed` (200, full status object) all chain correctly against their
    documented sandbox patterns. Confirms the issue's shape claim (maps onto OL's `OfferCreationRecord` +
    poller) directly rather than by inference. The canned `processingStatus` returned is `"CANCELLED"`, not a
    happy-path terminal state — sandbox proves the shape is reachable, not the full success path.

19. **✅ R1 — Reports general mechanism verified live, end to end** (with a listings report type, not yet the
    specific returns report type). `createReport` (202, `{reportId}`) → `getReportDocument` (200,
    `{reportDocumentId, url}`, a real-looking CloudFront download target) both work. High confidence this is
    the identical shape `GET_XML_RETURNS_DATA_BY_RETURN_DATE` uses — the mechanism, not just the returns-
    specific report type, is now confirmed reachable in static sandbox.

20. **✅ CORRECTION to Evidence #8 — `getCatalogItem` IS supported in static sandbox.** Re-checked with the
    fixed methodology (Evidence #16): the model's `responses.200.x-amzn-api-sandbox` block documents
    `asin=B07N4M94X4`, `marketplaceIds=ATVPDKIKX0DER`,
    `includedData=classifications,dimensions,identifiers,images,productTypes,relationships,salesRanks,summaries,vendorDetails`.
    Live test on the **NA** host (US marketplace baked into the pattern, same host-region rule as every other
    US-keyed pattern in this document) returns HTTP 200 with the identical rich payload shape
    `searchCatalogItems` returned (Evidence #14). **T7 is now fully confirmed positive**: both the search and
    single-item read operations work in static sandbox, for the one canned ASIN.

21. **🆕 New capability class, not in the original issue at all — Regulated Order Verification ("Shield").**
    `getOrderRegulatedInfo` / `updateVerificationStatus` (`GET`/`PATCH
    /orders/v0/orders/{orderId}/regulatedInfo`) verified live. Sample payload is a pet-prescription order:
    `RegulatedInformation.Fields` (e.g. `pet_prescription_species`), `RegulatedOrderVerificationStatus.Status:
    "Pending"`, `RequiresMerchantAction: true`, and a closed set of `ValidRejectionReasons` (e.g.
    `shield_pom_vps_reject_incorrect_weight`). This is an order-lifecycle **gate** — a regulated-category order
    apparently cannot ship until the seller reviews and approves/rejects it. No equivalent exists in any other
    platform researched in this epic (#2879 Shopify, #2880 eBay, #2882 TikTok Shop). Likely niche (only
    relevant if a seller lists regulated categories — pharma-adjacent, age-restricted, etc.), but flagged here
    so it isn't silently missed if a future OL customer sells in such a category.

22. **✅ S10 (`searchListingsItems`) verified live.** Same rich `issues[]`/`enforcements` shape as
    `getListingsItem` (Evidence #7), plus `pagination.nextToken`/`previousToken` for a full-catalogue sweep —
    confirms the enumerate-then-reconcile-mappings pattern works.

23. **✅ O5 (masked buyer email) confidence upgraded — corroborated in Amazon's own official model samples.**
    Every `buyerEmail` sample across the v0/v2026 model files' canned test data (JP/UK/Brazil/Turkey/generic)
    follows `buyer-email@marketplace.amazon.<tld>`. The issue's original source was a GitHub issue thread it
    flagged as "PARTLY UNCONFIRMED, availability may change without notice" — this is now corroborated by
    Amazon's own official model repository, a materially stronger source (though still illustrative sample
    data, not a live-production guarantee).

24. **✅ O7 resolved — same field family as D3, not a separate read.** The `taxRegistrations[]` array
    (Evidence #4) carries one entry per `entityType` role: `BUYER` (with `taxRegistrationType`/
    `taxRegistrationNumber`, e.g. a VAT id, plus `legalName`), `MARKETPLACE`, and `MERCHANT`. This single array
    answers O7 (buyer tax id), most of D3 (facilitator VAT signal), and contributes to D1/D2 (buyer data
    sufficient to invoice) — worth modelling as one mapping concern in the eventual adapter rather than three
    separate reads against three separate issue stories.

25. **⚠️ P9 reframed, not just answered.** No key containing "tax" exists anywhere in the Listings Items API
    model — there is no fixed top-level field for a seller to set a tax rate at publish, unlike Erli's simple
    enum. Combined with Evidence #3/#4/#24 (`IossNumber`, `DeemedResellerCategory`,
    `taxRegistrations[entityType=MARKETPLACE]`), the more likely explanation isn't a missing feature but a
    **different tax model entirely**: Amazon is frequently the VAT-collecting marketplace facilitator itself
    for EU/UK sales (post-2021 EU VAT e-commerce package, UK's post-Brexit marketplace rules), meaning there
    may be **no seller-settable rate for a large share of FR/DE/PL orders** in the first place — the same
    "marketplace owns tax" posture ADR-063/#2245 already has a shape for. This needs confirming against
    Seller Central's actual VAT settings documentation (not the API schema alone) before treating it as a gap
    to build around.

26. **✅ X2 confirmed — no rate-limit-query API exists anywhere in SP-API.** Searched the full model
    repository for anything rate-limit-shaped; zero matches. Unlike eBay (`GET
    /developer/analytics/v1_beta/rate_limit/`, per #2880's spike), Amazon offers no quota observability
    endpoint at all — confirms the issue's C8 claim precisely, and is a genuine, structural disadvantage
    relative to the epic's other researched platforms.

27. **✅ S8 confirmed — no real deactivate/withdraw primitive exists.** Full Listings Items API operation list
    is exactly `deleteListingsItem` (hard delete), `getListingsItem`, `patchListingsItem`, `putListingsItem`,
    `searchListingsItems` — no deactivate/withdraw verb or status-enum anywhere in the model.
    `deleteListingsItem` is a genuine delete, not eBay's `withdrawOffer` shape (unpublish-and-relist, #2880's
    S8). **Confirms the issue's own hedge**: quantity=0 via `patchListingsItem` is the only pause mechanism —
    same posture as Allegro/Erli, not eBay's superior model. #1689's `OfferDeactivator` capability gap stays
    unfilled by Amazon.

28. **✅ D8/R4–R7 confirmed NOT SUPPORTED — three independent negative checks, not a single search gap.**
    Enumerated every operation across the full Finances API (v0, 2024-06-19, transfers, invoices — 13
    operations total): all reads, plus `initiatePayout` (pays the *seller*, not a buyer refund). Combined with
    Orders (confirmed no refund/return-write path anywhere in its operation list, Evidence #16's methodology)
    and Reports (read-only by construction, R1). **No refund or return-write capability exists anywhere in
    current SP-API.** A refund must go through Seller Central manually, or is handled entirely by Amazon's own
    automated returns processing with no seller-side write access — structural, not a research gap.

29. **🎯 P9/D3 DEFINITIVELY confirmed (Evidence #25 upgraded from hypothesis to certainty).** Direct schema
    inspection finds `ItemTaxCollection.model`, possible value `"MARKETPLACE_FACILITATOR"`, described verbatim
    as *"Tax is withheld and remitted to the taxing authority by Amazon on behalf of the seller"* — plus
    `responsibleParty`, and `ItemTaxCalculationBreakdown.reportingScheme` (`UOSS`/`IOSS`, the exact EU VAT
    e-commerce package scheme identifiers). **This is no longer a hypothesis.** For
    `MARKETPLACE_FACILITATOR`-model items there is no seller-settable rate because the seller has no VAT
    liability to declare in the first place — Amazon owns it end to end. P9's "missing field" reads
    completely differently now: it needs the same marketplace-facilitator posture #2245/ADR-063 already
    handles for other platforms, not a workaround for a genuine gap.

30. **🎯 D5 resolved — Amazon natively separates shipping tax from item tax.**
    `ItemProceedsDetailedBreakdown.subtype` enum (`ITEM`/`SHIPPING`/`GIFT_WRAP`/`COD_FEE`/`OTHER`/`DISCOUNT`)
    applies to the `TAX` proceeds category specifically — meaning Amazon reports a **separate tax subtotal
    for the shipping-attributable portion** natively. OL likely does **not** need `splitShippingAcrossRates`
    (#2248/#2252) for Amazon's own figures — Amazon already performs and reports the split. Needs confirming
    against a real mixed-rate basket (sandbox sample data doesn't populate this granularity by default), but
    the schema capability is confirmed to exist.

31. **🔧 C13 PARTIALLY UNBLOCKED, and Evidence-#9-era reasoning CORRECTED — Notifications *is* testable in the
    static sandbox; only its delivery half is not.** The earlier read (one `403` on `getDestinations` ⇒ a
    missing "Notifications" role ⇒ the API is blocked) generalised from one operation to a whole API and was
    wrong. Per-operation live testing on a seller-authorized token (`grant_type=refresh_token`, sandbox app
    "OL-testt"): `getSubscriptions` **200**, `getSubscription` **200**, `createSubscription` **200**,
    `getDestination/{id}` **200** — while `getDestinations` (list) and `createDestination` answer **403** on
    **all three** hosts (EU/NA/FE, so not the region-mismatch cause the official Authorization Errors page
    lists), and `getSubscriptionById` / `deleteSubscriptionById` answer **500 InternalFailure** (Amazon-side).
    Sandbox support is confirmed **from the model, not inferred**: `models/notifications-api-model/`
    `notifications.json` carries 11 `x-amzn-api-sandbox` blocks across 9 of 10 operations, and
    `getDestinations`' block declares `"parameters": {}` — exactly how it was called — so its `403` is
    unambiguously authorization and never a static-pattern mismatch (which answers `400 "Could not match input
    arguments"`). **`sendTestNotification` is the one operation with no sandbox block at all.**
    Note the grantless/non-grantless split does **not** predict the outcome: `getDestination` (single) is
    documented grantless yet answers 200 on a seller token, while `getDestinations` (list) is equally grantless
    and answers 403 — so "grantless ops require a grantless token" is not a sufficient explanation, and the
    sandbox's per-operation authorization is simply inconsistent. Flagged rather than rationalised.

32. **🎯 Root cause of the Evidence-#9 `invalid_scope`: the `client_credentials` grant is refused for this app
    ENTIRELY — it was never a per-scope or per-role problem.** Five scopes tested, all `invalid_scope`:
    `sellingpartnerapi::notifications`, `::migration`, `::client_credential:rotation`, `::shipping`,
    `::tracking`. The decisive one is **`::client_credential:rotation`**, a generic scope backing
    `rotateApplicationClientSecret` that any normally-registered SP-API app holds regardless of roles — its
    rejection means the whole grant is unavailable, which no missing-Notifications-role theory explains.
    Combined with portal evidence (app **Status: `Sandbox`**; the app-edit form offers only `API Type: SP API`
    with no roles section; the app-row dropdown offers only "Create Token"), the explanation is the
    **registration TIER**: a Sandbox-status app has no role-request surface and no grantless grant. This is
    consistent with the official docs line already quoted at Evidence #9 ("grantless operations apply only to
    seller applications"). **Still unverified**: that a full Private/Public registration *would* grant it —
    that is now the open assumption, and a much narrower one than "unknown external blocker".
    Corollary worth recording: the epic's **inbound transport cannot be validated in the sandbox under any app
    tier**. `createDestination` is refused (permission), and `sendTestNotification` has no sandbox block
    (model-level absence) — so no notification can be *registered* a destination for, and none can be made to
    *arrive*. Validating ADR-049-shaped durable ingress for Amazon is therefore **live-account work with a real
    SQS queue**, not sandbox work. C13 moves from "blocked, unknown" to "subscription contract verified,
    transport unverifiable in sandbox by construction".

33. **🔍 F5 was checked against only ONE of TWO label-purchasing APIs — and the second one is fully
    exercisable, end to end.** Evidence #11 read the **Merchant Fulfillment** availability table; an
    enumeration of all 53 SP-API model directories shows a second, independent API — **Amazon Shipping v2**
    (`shipping-api-model/shippingV2.json`) — carrying `getRates`, `purchaseShipment`,
    `directPurchaseShipment`, `oneClickShipment`, `getTracking`, `getShipmentDocuments`, `cancelShipment`,
    `getAccessPoints` (relevant to F7/O14 pickup points), `linkCarrierAccount`, `submitNdrFeedback`,
    `createClaim`. **11 of its 12 sandbox blocks are `dynamic`**, not static — which is why it can answer
    country-specific questions that a canned static payload never could.
    **Verified live, end to end (GB domestic):** `getRates` → 200 with two rates (`Amazon Shipping One Day`
    4.01 GBP, `Two Day` 3 GBP) and `rateId`s; then `purchaseShipment` on that `{requestToken, rateId}` → 200
    with `shipmentId amzn1.sid.97458981074956.100` and `packageDocuments[].contents` carrying **real base64
    PNG label bytes** (PNG magic verified). So "can OL buy a shipping label through Amazon's API" is answered
    **yes, mechanically** — the constraint is purely geographic.

34. **🎯 F5 for POLAND — now refused by a POSITIVE service-side answer, with a working control.**
    `getRates` per country: **GB ✅**, **FR ✅**, while **PL** answers `400 "There is no marketplaceId
    configured to AmazonShippingIdentifier = AmazonShipping_PL for the AmazonShipping"` (DE and US answer the
    same shape). **The GB/FR control is what makes this evidence rather than a shrug** — it proves the app is
    authorized for Shipping v2 and the dynamic sandbox is reachable, so the PL refusal is country-scoped and
    not an artefact of a sandbox-tier app. Amazon *names* the missing configuration, which is a positive
    assertion of absence, materially stronger than Evidence #11's "Poland is absent from a docs table".
    **Do not generalise one shipping API's country list to the other**: Merchant Fulfillment's own table lists
    DE and US, and Amazon Shipping v2 refuses both — the two programmes have different coverage, so F5 must be
    stated per API. Net: PL is unavailable in **both**, by two independent routes of evidence.
    OL consequence (direction unchanged, basis firmer): a Polish Amazon seller cannot buy shipping through
    Amazon at all, so labels come from OL's existing carrier adapters (InPost/DPD) and Amazon receives only
    `confirmShipment` + tracking (F2, ✅ verified live). No Amazon Buy-Shipping path is needed for FR/DE/PL.

36. **🔧 CORRECTION to #33/#34 — `channelDetails.channelType` is a load-bearing axis, and the `AMAZON` channel
    is STUBBED in the sandbox, so F5 is MORE open than #34 claimed, not less.** #33/#34 tested only
    `channelType: EXTERNAL`. Re-tested across both channels, both directions and four currencies:

    **`EXTERNAL` — the sandbox performs a real, country-specific lookup.** Three properties establish that it
    is genuine rather than canned: rates differ per country *and* per currency (GB 4.01/3.00 GBP vs FR 7.23
    EUR), unsupported seller countries are refused by name, and cross-border raises a distinct compliance
    error (`D-720`, GB→DE) rather than a generic failure. **The refused identifier derives from `shipFrom`,
    not `shipTo`** — `PL→GB` is refused with `AmazonShipping_PL` while **`GB→PL` and `FR→PL` are accepted**
    (200, zero eligible rates). So a *Polish seller* is cut off; **shipping TO Poland from a supported seller
    country is not**, which #34 never tested and would have got wrong. Currency is irrelevant (PLN/EUR/USD/GBP
    all yield the identical refusal).

    **`AMAZON` (with `amazonOrderDetails.orderId`) — cannot be evaluated in the sandbox at all.** It answers
    200 with three GBP rates for PL, DE, US, GB, **for `JP`, and for the non-existent country code `XX`**;
    rates are invariant across 0.5/1/5/20 kg; and `purchaseShipment` **succeeds for `XX`**, returning a label
    byte-identically sized (168 008 B) to the PL one. Buying a label for a country that does not exist proves
    the path performs no marketplace-config lookup and no validation, so it is a stub and says **nothing**
    about PL in production — neither positive nor negative.

    **Why this matters more than it looks:** the `AMAZON` channel is precisely the case OL would use (buying a
    label for an actual Amazon order); `EXTERNAL` is for off-Amazon orders. So the question the epic cares
    about is **unresolved and requires a live account**, while the well-evidenced PL refusal covers the channel
    OL needs least. #34's "PL is unavailable in both APIs" therefore holds only for `EXTERNAL` plus Merchant
    Fulfillment's docs table; it must not be quoted as covering Amazon-order label purchase.
    The OL consequence is unchanged in *direction* (plan for InPost/DPD labels + `confirmShipment`), but the
    basis is now weaker than #34 implied and should not be treated as settled.

37. **Two adjacent answers recorded so they are not re-derived.** (a) **MCF `createFulfillmentOrder` has no
    sandbox block** — `fulfillmentOutbound_2020-07-01.json` carries 14 sandbox blocks but not that one, so
    ordering MCF fulfilment is not exercisable in the static sandbox: the same class of model-level absence as
    `sendTestNotification` (Evidence #32). (b) **There is no buyer-side purchasing API in SP-API at all** —
    across all 53 model directories no operation places an order *as a buyer*; SP-API is seller-side by
    construction, and Amazon Business procurement is a separate product, out of scope for #2881.

## API surface summary

| Group | Story | Status | Evidence |
|---|---|---|---|
| C | C4 (connection test probe) | ✅ verified live | #1 |
| C | C13 (Notifications, SQS/EventBridge) | ⚠️ subscription contract ✅ verified live; destinations 403 / transport unverifiable in sandbox | #9, **#31, #32** |
| T | T7 (catalogue product card) | ✅ confirmed unsupported in static sandbox | #8 |
| O | O1/O2 (order feed, v0) | ✅ verified live | #2 |
| O | O8/O10 (line resolve, tax rate) | ✅ resolved — no rate, ever | #3, #4 |
| O | searchOrders v2026-01-01 | 🔴 sandbox pattern not reproducible | #6 |
| S | S6 (write success ≠ live listing) | ✅ verified live, richer than expected | #7 |
| D | D3 (facilitator VAT signal) | ⚠️ partially answered (v0 IossNumber found) | #3 |
| — | region validation behaviour | ⚠️ new, undocumented inconsistency | #5 |
| T | T1 (browse category tree) | ✅ confirmed absent, primary source, all versions | #10 |
| F | F5 (Buy Shipping / Poland) | ✅ confirmed absent, independent source | #11 |
| F | F5 (Amazon Shipping v2 — 2nd purchasing API) | ✅ rate→purchase→label verified live (GB, `EXTERNAL`) | #33 |
| F | F5 (PL, `EXTERNAL` channel) | ✅ PL *seller* refused by name; **shipping TO PL accepted** | #34, #36 |
| F | F5 (PL, `AMAZON` channel — the OL-relevant one) | 🔴 **unresolved — sandbox path is a stub** | #36 |
| — | `channelType` as an axis; `shipFrom` drives eligibility | 🎯 resolved, corrects #34 | #36 |
| F | MCF `createFulfillmentOrder` | 🔴 no sandbox block — not exercisable | #37 |
| — | buyer-side purchasing | ✅ confirmed absent from all 53 APIs | #37 |
| — | Reports API `getReports` | ✅ verified live | #13 |
| T | T7 (catalogue product card, search variant) | ✅ verified live, richer than expected | #14 |
| T | T5 (conditional required attrs) | ⚠️ still blocked — sandbox only returns a schema link, not the schema | #15 |
| P | P2 (GTIN exemption field name) | ⚠️ real field name found, differs from issue's citation — needs confirmation | #15 |

| P | P1/P4 (Feeds async flow) | ✅ verified live, end to end | #18 |
| S | S5 (patchListingsItem) | ✅ verified live | #16/#17 |
| F | F2 (confirmShipment) | ✅ verified live | #17 |
| R | R1 (Reports mechanism) | ✅ verified live, end to end (general mechanism) | #19 |
| T | T7 (single-ASIN catalogue read) | ✅ CORRECTED — is supported, not unsupported | #20 |
| S | S10 (enumerate → reconcile) | ✅ verified live | #22 |
| — | Regulated Order Verification | 🆕 new capability class, not in original issue | #21 |

| O | O5 (masked email) | ✅ confidence upgraded (official model samples) | #23 |
| O/D | O7/D3 (buyer tax id / facilitator VAT) | ✅ resolved — one shared field family | #24 |
| P | P9 (tax rate at publish) | ⚠️ reframed — may be a facilitator-tax model, not a gap | #25 |
| X | X2 (rate-limit observability) | ✅ confirmed absent, structurally worse than eBay | #26 |
| S | S8 (pause/deactivate) | ✅ confirmed — quantity-0 only, no real withdraw | #27 |
| D | D8 / R4–R7 (refund/return writes) | ✅ confirmed NOT SUPPORTED, three independent checks | #28 |
| P/D | P9/D3 (facilitator tax model) | 🎯 confirmed with a named schema field, was hypothesis | #29 |
| D | D5 (shipping tax split) | 🎯 resolved — Amazon does this natively | #30 |

| C | C13 (Notifications subscriptions) | ✅ verified live — subscribe/read/enumerate all 200 | #31 |
| C | C13 (Notifications destinations + delivery) | 🔴 403 + no `sendTestNotification` sandbox — needs live account | #31, #32 |
| — | grantless grant availability | 🎯 resolved — refused app-wide, a registration-TIER limit | #32 |

Everything else in the original issue's story checklist (T6/T8, P3/P6/P8/P10–P13, S1/S2/S4/S6/S9/S11/S13,
F1/F4/F7, D1/D2/D6/D9, R2/R3/R8–R10, X3–X7) remains at its **original desk-research status** (⚠️/?/🔴 as the
issue left it) — not re-verified in this session. F3 (order status writeback) is effectively answered by
Evidence #17/#28's operation enumeration: only shipment-specific and verification-specific narrow writes
exist, no generic order-status writeback operation.

## Open risks — flagged, not guessed

- **v2026-01-01 sandbox coverage (Evidence #6) is the single highest-priority open risk.** If it genuinely
  isn't wired up yet, AC2 cannot be satisfied for the mandated API version via sandbox alone, and the spike's
  timeline assumption ("sandbox first, live account later") may need to invert for Orders specifically.
- **~~C13 blocked on an unresolved `invalid_scope` (Evidence #9)~~ — SUPERSEDED by Evidence #31/#32.** The
  `invalid_scope` is now explained (the `client_credentials` grant is refused for this app *tier*, not for a
  scope or a role), and the subscription half is verified live. What remains open is narrower but structural:
  **the inbound transport cannot be exercised in the static sandbox at all** — not under a better app tier
  either, because `sendTestNotification` has no sandbox block. So the epic's #1 cost driver stays unscoped by
  *evidence*, but the reason has changed from "unknown external blocker" to "requires a live account + a real
  SQS queue". Plan the estimate accordingly rather than waiting on a sandbox answer that cannot come.
- **AC7 (public vs private app) is not resolved by this session.** Confirmed from `application-authorization-limits`
  docs: Private apps are capped at **10 self-authorizations, no OAuth**; Public (unlisted) gets up to 25 OAuth +
  10 self-auth; Public (Appstore-listed) is unlimited. Given OpenLinker's multi-operator model, Private is very
  likely a non-starter for production — but the annual pentest / Appstore obligation cost for Public is still
  unverified from primary sources (only present in the original issue's desk text).
- **Static sandbox does not vary marketplace data by host region for at least `marketplaceParticipations`**
  (Evidence #1) — a naive multi-marketplace sandbox test suite could pass while proving nothing about FR/DE/PL
  specifically. Any future automated test harness for this connection must account for this.
- Region-validation inconsistency (Evidence #5) is undocumented in the official docs read so far — worth an
  explicit callout so a future adapter implementer doesn't assume it's uniform.

38. **🔧 CORRECTION to Evidence #6 — `searchOrders` is broken, not the whole v2026-01-01 API.**
    `getOrder` (single, by known `orderId`) was never tested in isolation. Tested now against all three
    documented static test cases (BR/PRIME, TR-with-`TAX`, US in-store-pickup) with exact model parameters —
    **all three answer 200**, while `searchOrders` still fails all 4 encoding variants tried in Evidence #6.
    Evidence #6's risk framing ("v2026-01-01 sandbox may not be wired up") must be read as scoped to the
    enumeration operation only. **This live-confirms the buyer tax registration is real, not just a schema
    claim**: `GET /orders/2026-01-01/orders/028-1234567-8901234?includedData=BUYER,RECIPIENT,PROCEEDS,` \
    `FULFILLMENT,TAX` → `tax.taxRegistrations[0] = {entityType: "BUYER", taxRegistrationType: "BUSINESS",` \
    `taxRegistrationNumber: "TR1234567890", legalName: "Test company name"}`. v0's `getOrderBuyerInfo` carries
    only `BuyerEmail`/`BuyerName` — no tax id field exists there at all (live-confirmed on both hosts). So the
    ADR-041 flagship Poland `buyerHasTaxId` rule (#2599) has a data source **only** on v2026-01-01, and that
    version's `getOrder` — unlike `searchOrders` — is sandbox-testable today.

39. **🎯 Invoicing has THREE separate, opposite-direction paths, none previously in this document.**
    (a) `invoices-api-model` (2024-06-19, requires VCS): `createGovernmentInvoice` is a **request that Amazon
    issue the document**, not an upload — body is `{invoiceType, marketplaceId, shipmentId, transactionType}`
    with no content field. Live-verified: `POST .../governmentInvoiceRequests` → `204`; `GET` status →
    `{status:"SUCCESS", invoiceExternalDocumentId:"3523..."}`. **Every static-sandbox test case uses
    `marketplaceId=A2Q3Y263D00KWC` (Brazil) exclusively** — a live probe with a PL/DE/FR marketplaceId falls
    through to `"Missing required parameter: 'marketplaceId'"` even when the parameter is present, so the
    static sandbox neither confirms nor denies PL/DE/FR coverage for this path; that requires a live account.
    (b) `UPLOAD_VAT_INVOICE` (Feeds, for sellers not enrolled in VCS) — OL uploads its own document.
    Live-probed: `createFeed` with `feedType: "UPLOAD_VAT_INVOICE"` → `400 "Could not match input arguments"`,
    against a control (`feedType: "POST_PRODUCT_DATA"` on the identical body) → `202`. `feedType` is an
    unconstrained string in the model (no enum) and this value appears nowhere in the models repository, so the
    static sandbox has no fixture for it — **undecidable here**, not confirmed absent. Per Amazon's own docs
    (not tested), a mismatch between the uploaded `TotalAmount` and Amazon's own total for the shipment causes
    rejection — the same class of risk ADR-026 already records for FA(3) rounding drift.
    (c) `externalFulfillment` `generateInvoice`/`retrieveInvoice` — a third, independent path scoped to the
    External Fulfillment program (see Evidence #41 for that program's scope caveat). Live-verified:
    `POST .../shipments/{id}/invoice` → `200`, `document: {format: "PDF", content: <base64>}`.
    **These are alternatives, not layers** — which one applies depends on the connection's VCS enrollment and
    program membership, and #2158's `SelfRoutingDocumentKind` (declared, no implementer) is the natural home
    for path (a): a destination that fiscalizes itself and needs no separate OL-issued document.

40. **✅ Returns ARE readable in the static sandbox — via `externalFulfillment`, not the marketplace returns
    endpoint this document previously assumed didn't exist.** `GET /externalFulfillment/2024-09-11/returns` +
    `/returns/{id}` live-verified (`rmaId=rmaIdOneShipmentOneItemOneQty200` → `200`, full `returnReason`,
    `status`, `numberOfUnits`, bidirectional tracking). This is the shape `ReturnSourceReader` (#2329) expects
    (`listReturnFeed` + `getReturn`), and it carries `lastUpdatedDateTime` + a `lastUpdatedAfter` filter — a
    freshness signal Allegro's return feed lacks entirely (#2330 needed two ingestion passes for exactly that
    reason). **Scope caveat, not yet resolved**: sample data carries `channelName: "FBA"` and
    `marketplaceName: "AMAZON_US"`/`"AMAZON_IN"` — whether an ordinary FR/DE/PL 3P seller has access to this
    program at all is unverified. The sandbox also usefully exposes deterministic error-injection ids
    (`rmaIdTest403/409/429/500/503`, live-verified to return those codes save for `503` which answered `500`) —
    the only place in the whole sandbox surface that lets `RetryClassifierPort` deferral logic (#2613) be
    exercised against 429/503 on purpose. Refund/write-side operations (D8/R4-R7) remain confirmed NOT
    SUPPORTED — unchanged from Evidence #28, consistent with ADR-056 (A6 never leaves OL).

41. **✅ S1/S4 (quantity + price write) verified live; S11 (auto-match) verified for SKU, undecidable for
    EAN/GTIN/UPC.** `PATCH /listings/2021-08-01/items/{sellerId}/{sku}` with `op:"merge"` on
    `fulfillment_availability` (quantity) and on `purchasable_offer` (`our_price[].schedule[].value_with_tax`)
    both answer `200 ACCEPTED`. Auto-match via `GET /listings/2021-08-01/items/{sellerId}?identifiersType=SKU&`
    `identifiers=...` → `200`, full summaries/offers/fulfillmentAvailability. `identifiersType` is documented
    with 9 enum members (`ASIN`, `EAN`, `FNSKU`, `GTIN`, `ISBN`, `JAN`, `MINSAN`, `SKU`, `UPC`) but the static
    sandbox has a fixture **only for `SKU`** — `identifiersType=EAN` with a syntactically valid EAN answers
    `400 "Could not match input arguments"`. Same class as Evidence #39's `UPLOAD_VAT_INVOICE`: the parameter
    value exists in the contract, sandbox coverage does not confirm or deny it works.

42. **✅ R3 — return terminal-status vocabulary, from the model (`Return.status` enum).** 15 values:
    `CREATED`, `CARRIER_NOTIFIED_TO_PICK_UP_FROM_CUSTOMER`, `CARRIER_OUT_FOR_PICK_UP_FROM_CUSTOMER`,
    `CUSTOMER_CANCELLED_PICK_UP`, `CUSTOMER_RESCHEDULED_PICK_UP`, `PICKED_FROM_CUSTOMER`, `IN_TRANSIT`,
    `OUT_FOR_DELIVERY`, `DELIVERED`, `REPLANNED`, `CUSTOMER_DROPPED_OFF`, `PARTIALLY_PROCESSED`, `PROCESSED`,
    `REJECTED`, `CANCELLED`. Two of these (`CREATED`, `CARRIER_NOTIFIED_TO_PICK_UP_FROM_CUSTOMER`) were already
    live-confirmed as real sandbox responses in Evidence #40. `terminalRawStatuses` for a future
    `ReturnSourceReader` implementation (#2329/#2330's amended hint) is best read as `PROCESSED` / `REJECTED` /
    `CANCELLED` — the other 12 describe an in-flight pickup/transit lifecycle, not a closed one. Not
    live-verified value-by-value; the enum itself is the model's own declaration.

43. **✅ T6, F1, D2 formalized — each already answered by evidence recorded elsewhere in this document, restated
    here because the issue's checklist names them as separate stories.**
    **T6** (parameter restrictions, `checkParameterRestrictions`) — answered by Evidence's `VALIDATION_PREVIEW`
    finding (§ P section / Listings): a live `INVALID` response carries `code`, `message`, `severity`,
    `attributeNames`, `categories`, `enforcements` — JSON-Schema-shaped and machine-validatable, richer than
    Allegro's category-parameter restrictions.
    **F1** (read fulfillment status) — answered by the `getOrder` v2026-01-01 payload itself (Evidence #38):
    `fulfillment.fulfillmentStatus` (`UNSHIPPED` / `SHIPPED` observed live across the BR and TR samples) —
    there is no separate fulfillment-status operation; it rides on the order read.
    **D2** (buyer data sufficient to invoice) — answered, and version-dependent exactly like O7 (Evidence #38):
    v0's `getOrderBuyerInfo` supplies only `BuyerEmail`/`BuyerName` (confirmed live, Session 3) — insufficient
    for a business invoice; v2026-01-01's `tax.taxRegistrations[entityType=BUYER]` supplies
    `taxRegistrationNumber`, `legalName`, and a full `taxRegistrationAddress` (confirmed live, Session 4) — a
    complete address a document could be issued against, but *only present when the source order actually
    carries a business tax registration* (the TR sample's `buyerInvoicePreference: "BUSINESS"`); a consumer
    plain order supplies neither, so D2's answer for a private buyer remains "insufficient" on both versions.

44. **✅ S2/S9 confirmed live — batch quantity write and stock-restore-after-cancellation are the SAME
    mechanisms already proven, not new operations.** S2: `POST /feeds/2021-06-30/feeds` with
    `feedType: "POST_PRODUCT_DATA"` → `202 {"feedId":"3485934"}` — identical to the P1/P4 mechanism, just with
    multiple SKUs in the uploaded document. S9: `PATCH .../fulfillment_availability` with a restored quantity
    value → `200 ACCEPTED` — the identical call as S1's quantity write. There is no separate "restore" endpoint
    because there is no separate "reduce" endpoint either; both are the same idempotent absolute-quantity PATCH.

45. **🔴 T5/P6/P8/P10 share ONE root cause, confirmed by attempting to resolve the schema link.**
    `GET /definitions/2020-09-01/productTypes/LUGGAGE?marketplaceIds=ATVPDKIKX0DER` → `200` with
    `schema: {link: {resource: "https://schema-url", verb: "GET"}}` — live-fetching that URL gives `HTTP:000`
    (no DNS resolution at all; it is a fixture placeholder, not a real host). **The static sandbox never
    delivers an actual JSON Schema document for any product type** — Evidence #15 recorded this for T5
    (conditional required attributes) alone; it equally forecloses **P6** (description format — the allowed-tag
    grammar lives inside the schema), **P8** (multi-variant grouping via `parentageLevel` — the variation-theme
    definition is schema-embedded), and **P10** (GPSR/EU compliance fields — these are schema properties too).
    All four questions need the *content* of a product-type schema, and the sandbox structurally cannot supply
    it. Resolving any of them requires a live account against the real
    `https://sellingpartnerapi-eu.amazon.com` host.

46. **🔴 P11/F4 confirmed structurally undecidable — same class as P7/P13 (Evidence #40's genuinely-out-of-reach
    list), now demonstrated rather than inferred.** **P11** (duplicate-listing guard): two `PUT` calls against
    the identical SKU with *different* `item_name` values both returned the **byte-identical** canned response
    (`{"sku":"GM-ZDPI-9B4E","status":"ACCEPTED",...}`) — proof the static sandbox pattern-matches the request
    shape and ignores content, so it cannot answer "does a second create upsert, reject, or duplicate."
    **F4** (late-waybill relay: does re-submitting `shipmentConfirmation` under the same `packageReferenceId`
    edit rather than duplicate, per the issue's own citation): the exact model fixture
    (`orderId=902-1106328-1059050`, `packageReferenceId="1"`, `trackingNumber="112345678"`) answers `204`; the
    **identical call with only `trackingNumber` changed** to a different value answers `400 "Could not match
    input arguments"` — the sandbox has no fixture for "the same reference, a new tracking number", so it
    cannot confirm or refute Amazon's own documented edit-not-duplicate behavior. Both questions need a
    write-then-observe-effect loop; the static sandbox has no state between calls to observe.

47. **✅ T8/D9/O4/O16 answered as consequences already implied by evidence elsewhere in this document — no new
    sandbox call adds information.**
    **T8** (taxonomy identity string, `'amazon:<marketplaceId>'` per ADR-037): moot given Evidence #10 (T1 — no
    browsable category tree exists at all) — `DestinationCategory` has nothing to project onto for Amazon
    regardless of what identity string is chosen, so the string's format is a non-decision until a tree source
    exists.
    **D9** (FX stamping, ADR-040): every order sample observed live this session carries a real
    `currencyCode` (`BRL`, `TRY`, `USD` — Evidence #38/#4) — ADR-040's stamp needs exactly the order's own
    currency + a placement timestamp, both of which are present on every tested order shape.
    **O4** (SQS must be primary ingress, not a latency optimisation): directly follows from C13 (Evidence
    #31/#32) — there is no webhook alternative, and the delivery half of Notifications is unverifiable in
    sandbox regardless, so the architectural conclusion doesn't change with more testing.
    **O16** (rate-limit ceiling forbids polling-first design): the cited numbers (`0.0167 req/s` v0,
    `0.0056 req/s` v2026) are **stated in Amazon's own documentation**, not discoverable via a sandbox call —
    the sandbox's own throttle (5 req/s, burst 15, Evidence #26) is a *different, unrelated* number and testing
    against it would answer nothing about the real production ceiling.

    **Genuinely still untouched after this pass: F7 (source options discovery) — no evidence either way,
    simply not attempted.**

48. **✅ F7 — no discovery operation exists, because there is nothing to discover: Amazon's option vocabulary
    is closed enums baked into the schema, not a queryable list.** Enumerated all 9 operations across Orders v0
    — none corresponds to `listOrderStatuses`/`listDeliveryMethods`/`listPaymentMethods` the way Allegro or
    PrestaShop expose one. The values a `SourceOptionsReader` would otherwise fetch are instead **fixed enum
    definitions inside the OpenAPI model itself**: `ShipmentStatus: ["ReadyForPickup", "PickedUp",
    "RefusedPickup"]`, `VerificationStatus: ["Pending", "Approved", "Rejected", "Expired", "Cancelled"]`. This
    is not a sandbox limitation — no live account would surface a discovery endpoint either, because none
    exists on this platform. The correct implementation is to copy these enums directly from the model into
    OL's status mapper, the same way a closed vocabulary is handled anywhere else in the tree; there is no
    "confirm this at runtime" step to design for.

## Recommendation

Continue the spike rather than close it. Concretely, in priority order:
1. ~~Escalate the C13 grantless-token blocker to a human channel~~ — **no longer the first move** (Evidence
   #32 explains it as a registration-tier limit). Instead: register a **full Private app** (the tier with a
   roles surface, distinct from the current `Sandbox`-status app), then re-test the two 403 operations and the
   grantless grant. Only if grantless is *still* refused on a Private app does this become a support-channel
   question. Note the sandbox can never answer the delivery half regardless — that needs a live account plus a
   real SQS queue, so schedule it as such rather than as sandbox work.
2. Confirm or refute Evidence #6 (v2026-01-01 sandbox) the same way — if genuinely unsupported, decide whether
   to build against v0 first with a documented migration plan, given v0's 2027-03-27 sunset.
3. Resolve AC7 before any further registration steps, now informed by the concrete authorization-limit numbers
   above.
4. Work through the remaining story groups (T, P, F, D, R, X) that were not touched this session — none of
   them have live evidence yet.

No adopt/don't-adopt verdict is final. This document should be revised as further live evidence lands, per the
issue's own instruction ("Found something wrong? Edit this issue so the next reader inherits the correction" —
same discipline applies here).
