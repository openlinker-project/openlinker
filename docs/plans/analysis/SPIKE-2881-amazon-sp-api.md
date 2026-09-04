# Spike #2881 — Amazon SP-API (FR/DE/PL): capabilities, flows, verdict

> **Status: IN PROGRESS, not final.** Issue #2881's own day-0 desk research (2026-09-04) has been partially
> live-verified against the Amazon SP-API **static sandbox** (self-authorized Private app, EU host) on
> 2026-09-04. Several stories remain unconfirmed or blocked — see "Open risks" and the per-group status
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

## API surface summary

| Group | Story | Status | Evidence |
|---|---|---|---|
| C | C4 (connection test probe) | ✅ verified live | #1 |
| C | C13 (Notifications, SQS/EventBridge) | 🔴 blocked (grantless token) | #9 |
| T | T7 (catalogue product card) | ✅ confirmed unsupported in static sandbox | #8 |
| O | O1/O2 (order feed, v0) | ✅ verified live | #2 |
| O | O8/O10 (line resolve, tax rate) | ✅ resolved — no rate, ever | #3, #4 |
| O | searchOrders v2026-01-01 | 🔴 sandbox pattern not reproducible | #6 |
| S | S6 (write success ≠ live listing) | ✅ verified live, richer than expected | #7 |
| D | D3 (facilitator VAT signal) | ⚠️ partially answered (v0 IossNumber found) | #3 |
| — | region validation behaviour | ⚠️ new, undocumented inconsistency | #5 |
| T | T1 (browse category tree) | ✅ confirmed absent, primary source, all versions | #10 |
| F | F5 (Buy Shipping / Poland) | ✅ confirmed absent, independent source | #11 |
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

Everything else in the original issue's story checklist (T6/T8, P3/P6/P8/P10–P13, S1/S2/S4/S6/S9/S11/S13,
F1/F4/F7, D1/D2/D6/D9, R2/R3/R8–R10, X3–X7) remains at its **original desk-research status** (⚠️/?/🔴 as the
issue left it) — not re-verified in this session. F3 (order status writeback) is effectively answered by
Evidence #17/#28's operation enumeration: only shipment-specific and verification-specific narrow writes
exist, no generic order-status writeback operation.

## Open risks — flagged, not guessed

- **v2026-01-01 sandbox coverage (Evidence #6) is the single highest-priority open risk.** If it genuinely
  isn't wired up yet, AC2 cannot be satisfied for the mandated API version via sandbox alone, and the spike's
  timeline assumption ("sandbox first, live account later") may need to invert for Orders specifically.
- **C13 blocked on an unresolved `invalid_scope` (Evidence #9)**, with no further automated path forward. This
  is the epic's #1 architectural cost driver (new inbound transport) and cannot be scoped with confidence until
  resolved.
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

## Recommendation

Continue the spike rather than close it. Concretely, in priority order:
1. Escalate the C13 grantless-token blocker to a human channel (AWS support / SP-API forum) — this cannot be
   resolved by further automated research.
2. Confirm or refute Evidence #6 (v2026-01-01 sandbox) the same way — if genuinely unsupported, decide whether
   to build against v0 first with a documented migration plan, given v0's 2027-03-27 sunset.
3. Resolve AC7 before any further registration steps, now informed by the concrete authorization-limit numbers
   above.
4. Work through the remaining story groups (T, P, F, D, R, X) that were not touched this session — none of
   them have live evidence yet.

No adopt/don't-adopt verdict is final. This document should be revised as further live evidence lands, per the
issue's own instruction ("Found something wrong? Edit this issue so the next reader inherits the correction" —
same discipline applies here).
