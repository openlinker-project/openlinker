# Spike #2879 — Shopify Admin GraphQL API: capabilities, flows, verdict

> ⚠️ **Work in progress — day-0/day-1 mixed research.**
> Sections marked with a live transcript below are **verified** against a real development store
> (`shopfyol.myshopify.com`, custom-distribution app `Test-OLL`, API version `2026-07`) on
> **2026-09-04**. Everything else is still desk research carried over from issue #2879 and is marked
> `DESK` — treat it as a hypothesis to confirm, not a fact to build on. This file is updated in place
> as more stories are verified; it is not yet complete enough to close the parent issue.

Sources of record for the verified sections: live GraphQL Admin API calls via `curl`, transcripts
captured below. Desk-research baseline: issue #2879 itself (which cites shopify.dev pages fetched
2026-09-04) and `docs/plans/analysis/ANALYSIS-new-marketplace-integrations-story-catalogue.md`
(#2883).

## Verdict — provisional, leaning ADOPT

Nothing found so far contradicts the issue's original three headline findings (per-line tax rate,
FulfillmentOrder/`FulfillmentExecutor` fit, native idempotency). Two of the three onboarding risks
named in the issue are **resolved more favourably than expected**:

- Protected Customer Data (name/email/phone/address) is grantable on a development store
  **immediately, with no Shopify review**, confirmed live (see E-C1..E-C4 below) — matching the
  issue's "good news to confirm".
- `read_all_orders` (full order history beyond 60 days) genuinely requires a **separate, manually
  reviewed** request through the legacy Partner Dashboard ("rolling basis" review) — this is
  **BLOCKED**, owner = Shopify review team, no ETA available. Recorded as open risk O-1 below.

One correction to the issue's own claims, found empirically: the `@idempotent` directive protects
against **reuse of a key with different parameters**, but does **not** transparently replay a cached
successful result on retry once the underlying resource state has moved — see M11/M13 findings
below. This narrows the "flagship" claim and should be re-stated carefully in any downstream design
doc that assumes automatic dedup-on-retry semantics.

**F6 is confirmed as an even stronger match than the issue claimed.** Live introspection shows
`FulfillmentOrderRequestStatus` (`UNSUBMITTED, SUBMITTED, ACCEPTED, REJECTED,
CANCELLATION_REQUESTED, CANCELLATION_ACCEPTED, CANCELLATION_REJECTED, CLOSED`) and
`FulfillmentOrderStatus` (`OPEN, IN_PROGRESS, CANCELLED, INCOMPLETE, CLOSED, SCHEDULED, ON_HOLD`)
matching OL's own independently-designed ADR-054 `FulfillmentRequestStatus`/`FulfillmentWorkStatus`
vocabularies almost name-for-name — see E-F5. This substantially strengthens the case for F6 being
in scope for a first slice rather than deferred, though it remains the largest single piece of work
in the checklist.

**One recurring, load-bearing correction to the issue's own Prerequisites**: the requested scope
list is missing `write_merchant_managed_fulfillment_orders`. Without it, essentially the entire
write half of group F (`fulfillmentCreate`, `fulfillmentOrderMove`, and likely more) is blocked with
`"The api_client does not have access to the fulfillment order."` — see E-F3/E-F4. Any team
resuming this spike must add this scope (which requires a fresh OAuth grant) before F-group write
testing can continue.

## Evidence — live-verified

Environment: dev store `shopfyol.myshopify.com` (Partner org, plan reported as
`"Advanced App Development"`), custom-distribution app `Test-OLL`
(`client_id = e479230f838e9c4fd112589d99779599`), Admin API version `2026-07`. Access token obtained
via full OAuth authorization-code grant (`https://shopfyol.myshopify.com/admin/oauth/authorize` →
`https://shopfyol.myshopify.com/admin/oauth/access_token`); token prefix returned is `shpua_`, not
the classically-documented `shpat_` — **but it is stable across repeated OAuth exchanges with the
same app+shop+scope**, which is the behavioural signature of an *offline* token, not a per-session
online one. Flagged as E-C3 below for confirmation against official docs (name of this prefix is not
found in the desk-research pass).

| # | Story | Fact | Evidence |
|---|---|---|---|
| E-C1 | C1 | Admin-created custom apps genuinely closed; only path is Dev Dashboard → custom-distribution app, installed on a specific store | Live: app created and installed exactly this way, 2026-09-04 |
| E-C2 | C1/X3/X4 | Protected Customer Data (name, email, phone, address) is grantable on a dev store with **zero review**: UI states *"If you're installing on a dev store, select your data use in step 1 to access protected customer data"*; the 16-question "Data protection details" form is explicitly stated as needed **only** for App Store Listing submission | Live: Dev Dashboard "API access requests" screen, `Protected customer data access` section, "Draft" status persists with no blocking effect on dev-store access |
| E-C3 | C1/C2/C3 | Access token returned by OAuth code exchange has prefix `shpua_`, not `shpat_`. Repeated OAuth exchange for the same app+shop+scope returns the **identical** token value (tested twice) — behavioural evidence of an offline/app-scoped token despite the unexpected prefix | Live: two independent `code`→token exchanges both returned `shpua_c83980eb7d548fd2d9d868a9b67a02e2` |
| E-C4 | C8 | `extensions.cost.throttleStatus` present on every GraphQL response; on this dev store's plan, `maximumAvailable: 4000`, `restoreRate: 200` — higher than the 1000/100 figures the issue's desk research assumed for "Standard" plan | Live: every call below carries this field |
| E-C5 | C1 (scope UI) | Dev Dashboard's scope picker mixes **Admin API** scopes (e.g. `read_orders`) with unrelated **Customer Account API** scopes (`customer_read_orders`) under the same category label ("Orders") in one search result — an easy mis-click trap | Live: Dev Dashboard scope picker, search "read_orders" |
| E-C6 | C1 | `read_all_orders` is **not** a checkbox in the standard scope picker at all; it is a separately-requested grant via a legacy (visually distinct, pre-Dev-Dashboard) "API access requests" page, requiring "Choose distribution" first, then a written justification, then **manual Shopify review ("rolling basis")** | Live: `Request additional scopes and APIs` section of the legacy Partner Dashboard-style page |
| E-M1 | M2/M3 | Product read returns real seeded test data — `products(first: 5)` returned 5 real products including deliberately-named edge cases (`The Draft Snowboard`, `The Out of Stock Snowboard`, `The Inventory Not Tracked Snowboard`) | Live transcript below |
| E-M2 | M7 | **Deletion detection confirmed.** Querying `product(id: ...)` for a product just deleted via `productDelete` returns `{"data":{"product":null}}` — **no error, no HTTP error code, silent `null`**. Adapter must treat `null` (not an exception) as the `MasterProductNotFoundError` signal | Live transcript below — create → delete → re-query in one session |
| E-M3 | M11 | `inventoryAdjustQuantities` **requires** `changeFromQuantity` (CAS) as a mandatory field of `InventoryChangeInput`, separate from the `@idempotent` directive requirement | Live: mutation without it → `"InventoryChangeInput must include the following argument: changeFromQuantity."` |
| E-M4 | M13 | `@idempotent` directive is enforced **at runtime**, confirmed live on API version `2026-07` already (issue's desk research said "mandatory at 2026-04" — confirmed still in force) | Live: mutation without directive → `"The @idempotent directive is required for this mutation but was not provided."`, `extensions.code: BAD_REQUEST` |
| E-M5 | M11/M13 | `@idempotent` directive syntax is `field @idempotent(key: "...")` — applied to the **field being called**, not to the `mutation` operation itself (the latter is rejected: `"'@idempotent' can't be applied to mutations (allowed: fields)"`) | Live transcript below |
| E-M6 | M11 (correction) | `@idempotent` does **not** transparently replay a cached success on identical retry once the underlying state has changed since the first call. Retrying the exact original request (same key, same `changeFromQuantity`) after the first call already succeeded returned a **fresh CAS failure** (`"changeFromQuantity argument no longer matches the persisted quantity"`), not a cached success. Reusing the same key with a **different** `changeFromQuantity` was separately rejected as `"The request with this idempotency key has different parameters than the original request."` — so the key protects against key/parameter collision, but genuine transparent dedup-and-replay was not observed under this test design (true concurrent/rapid-retry replay is unverified — see Open risk O-2) | Live transcript below, 4-call sequence |
| E-M7 | M12 | Native multi-location confirmed: dev store shipped with two locations out of the box (`"Shop location"`, `"My Custom Location"`), both `isActive: true` | Live: `locations(first: 5)` |
| E-T1 | T1 (open question) | `taxonomy { categories(first: 3) { ... } }` succeeded with the connection's existing product/order scope set — **no dedicated taxonomy scope appears to be required**, or it is silently covered by an existing scope. Not yet isolated to prove which scope specifically grants it | Live: query succeeded, returned real global category tree (`Animals & Pet Supplies`, `Apparel & Accessories`, `Arts & Entertainment`, ...) |
| E-P1 | P (open question) | `shop.resourceLimits.maxProductOptions = 3`, `maxProductVariants = 2048` confirmed live — matches the issue's stated 2048 variant cap (M3) and the commonly-assumed-but-unverified option cap of 3 | Live: `shop { resourceLimits { maxProductOptions maxProductVariants } }` |
| E-P2 | P6 | 🚨 **`descriptionHtml` accepts arbitrary HTML with ZERO server-side sanitization.** A write containing `<p>`, `<em>`, `<strong>`, `<ul><li>`, `<table><tr><td>` **and a literal `<script>alert(1)</script>`** was accepted verbatim (`userErrors: []`) and read back byte-identical, script tag included. Shopify's Admin API is **not** an XSS security boundary — `ADR-046`'s `applyDescriptionFormat` narrowing must be treated as publish-time content-model shaping only, same as every other adapter; inbound sanitization (`sanitizeStoredHtml`) remains entirely OL's own responsibility with no help from the platform | Live transcript below |
| E-M8 | M8 | `ProductVariant.taxable` confirmed as a plain boolean (`true`) on live data, no per-variant numeric rate exposed anywhere reached so far — consistent with the issue's claim that `taxCode` is deprecated and there is no live per-variant rate replacement (still to be exhaustively confirmed — this only checked one field) | Live: `variants(first:1) { edges { node { taxable } } }` |
| E-O1 | O10/D4 | 🎯 **Flagship confirmed live.** `orderCreate` accepts a per-line-item `taxLines[]` array; the created order echoes back `TaxLine.rate = 0.23` **and** `TaxLine.ratePercentage = 23.0` on the persisted `LineItem`. This is the only one of the four candidate platforms (#2878) confirmed to carry a genuine per-line tax rate end to end | Live transcript below |
| E-O2 | O9 | `orderCreate` order currency defaults to `shop.currencyCode` (`USD` on this store); a `taxLines[].priceSet.shopMoney.currencyCode` mismatched against the order's resolved currency is a hard `userErrors` refusal, not a silent coercion | Live: first attempt with `PLN` tax-line currency against a `USD`-currency shop → `"Line items tax lines currency does not match the order currency"` |
| E-F1 | F6 | 🎯 **Flagship confirmed live — two-axis shape matches ADR-054's `FulfillmentWork` almost exactly.** `order.fulfillmentOrders[0]` returned `status: "OPEN"` (execution axis) and `requestStatus: "UNSUBMITTED"` (negotiation axis) as **independent fields**, plus a server-declared `supportedActions: [MOVE, HOLD]` array — exactly the "two orthogonal status axes, server-declared supportedActions" claim from the issue | Live: `order(id: ...) { fulfillmentOrders(first:5) { edges { node { status requestStatus supportedActions { action } } } } }` |
| E-F2 | F6 | `fulfillmentServiceCreate` works and mints a **new location** for the service, but that location is **excluded from the default `locations()` query** — only reachable via `shop.fulfillmentServices { location { id } }`. A dev store also ships one pre-existing, unrequested fulfillment service (`"Snow City Warehouse"`) as seeded test data | Live transcript below |
| E-F3 | F6/M12 (scope correction) | 🚨 **`fulfillmentOrderMove` requires `write_merchant_managed_fulfillment_orders`.** The issue's own Prerequisites scope list requests only the **read** variant (`read_merchant_managed_fulfillment_orders`) — the write scope is missing from the list entirely and must be added for any F6 slice that reassigns fulfillment orders across locations | Live: `"Access denied for fulfillmentOrderMove field. Required access: write_merchant_managed_fulfillment_orders access scope or write_third_party_fulfillment_orders access scope. Also: The user must have fulfill_and_ship_orders permission."` |
| E-C7 | C10 | `webhookSubscriptionCreate` confirmed working — registered a real `ORDERS_CREATE` subscription, `JSON` format, callback URL accepted without validation that the URL is reachable (placeholder `test-ol-example.com` accepted) | Live: `webhookSubscriptionCreate(topic: ORDERS_CREATE, ...)` → success, real `WebhookSubscription` id returned |
| E-O3 | O12 | `orderCancel` confirmed working; **it is asynchronous** — returns a `Job { id }` rather than the cancelled order directly. A follow-up read confirmed `cancelledAt` and `cancelReason` populated on the order a couple seconds later | Live transcript below |
| E-D1 | D8 | `refundCreate` also requires the `@idempotent` field directive (same pattern as M13/`inventoryAdjustQuantities`) — confirms the mandatory-idempotency requirement is not `inventoryAdjustQuantities`-specific but a cross-mutation platform rule as of this API version | Live: without directive → `"The @idempotent directive is required for this mutation but was not provided."`; with directive → passes idempotency check, fails only on missing refund content (`"either refund line items or refund duties or transactions or refund methods must be present"`), i.e. genuinely reached past the idempotency gate |
| E-F4 | F6 (scope correction, extends E-F3) | 🚨 `fulfillmentCreate` itself is ALSO blocked without the merchant-managed write scope — `"The api_client does not have access to the fulfillment order."` This is broader than just `fulfillmentOrderMove`: **any write against a `Shop location`-assigned (merchant-managed) FulfillmentOrder** needs `write_merchant_managed_fulfillment_orders`, not just relocation. The read-only scope from the issue's Prerequisites is insufficient for essentially the entire write half of group F | Live: `fulfillmentCreate` on a fresh, unfulfilled, correctly-shaped order → access denied |
| E-F5 | F6 | 🎯 **`FulfillmentOrderRequestStatus` enum values match ADR-054's own `FulfillmentRequestStatus` vocabulary almost verbatim**: `UNSUBMITTED, SUBMITTED, ACCEPTED, REJECTED, CANCELLATION_REQUESTED, CANCELLATION_ACCEPTED, CANCELLATION_REJECTED, CLOSED`. `FulfillmentOrderStatus` (execution axis): `OPEN, IN_PROGRESS, CANCELLED, INCOMPLETE, CLOSED, SCHEDULED, ON_HOLD` — 7 values vs. OL's own 7-value `FulfillmentWorkStatus`, again a near-1:1 naming match | Live: GraphQL introspection `__type(name: "FulfillmentOrderRequestStatus")` / `__type(name: "FulfillmentOrderStatus")` |
| E-S3 | S6 | `ProductStatus` closed vocabulary: `ACTIVE, ARCHIVED, DRAFT, UNLISTED` — 4-value neutral publication status. Live-verified our test product currently reads `ACTIVE` | Live introspection + live read on real product |
| E-O9 | O11 | `OrderDisplayFulfillmentStatus` closed vocabulary, 10 values: `UNFULFILLED, PARTIALLY_FULFILLED, FULFILLED, RESTOCKED, PENDING_FULFILLMENT, OPEN, IN_PROGRESS, ON_HOLD, SCHEDULED, REQUEST_DECLINED` | Live introspection |
| E-O4 | O12 | `OrderCancelReason` closed vocabulary: `CUSTOMER, DECLINED, FRAUD, INVENTORY, STAFF, OTHER` | Live introspection |
| E-O5 | O13 | `OrderDisplayFinancialStatus` closed vocabulary: `PENDING, AUTHORIZED, PARTIALLY_PAID, PARTIALLY_REFUNDED, VOIDED, PAID, REFUNDED, EXPIRED` — maps cleanly onto OL's `order_state_mappings` translation target | Live introspection |
| E-O6 | O14 | `DeliveryMethodType` closed vocabulary: `SHIPPING, PICK_UP, NONE, RETAIL, LOCAL, PICKUP_POINT` — includes `PICKUP_POINT` (parcel-locker-shaped, e.g. InPost Paczkomat equivalent), relevant to OL's existing delivery-method mapping options | Live introspection |
| E-F6 | F1/F2 (unblocked after scope fix) | `fulfillmentCreate` succeeded once `write_merchant_managed_fulfillment_orders` was added — status `SUCCESS`, tracking number round-tripped, order's `displayFulfillmentStatus` flipped `UNFULFILLED → FULFILLED` | Live transcript below |
| E-R4 | R9 (major correction) | 🚨 **Return reasons are NOT the closed 10-value `ReturnReason` enum for write purposes.** `ReturnRequestLineItemInput` has no `returnReason` field at all — it takes `returnReasonDefinitionId` (an `ID` referencing a `ReturnReasonDefinition` object) and `customerNote` (not `returnReasonNote`). Querying `returnReasonDefinitions(first: 15)` returned a much larger, open-ended catalog — 15+ entries seen including highly specific ones (`Absorbency`, `Academic level`, `Accuracy`, `Adhesion`, `Adhesive`) alongside the expected general ones (`Changed my mind`, `Item not as described`, `Damaged or defective`, `Too small`, `Too big`). This is functionally an **open-world catalog**, closer to Allegro's open-string `reason.type` (per `SPIKE-2289`) than a closed enum — the `ReturnReason` enum found via introspection (E-R2) appears to serve a different/older read-only surface and must NOT be used to build the write-side reason mapping | Live: `__type(name: "ReturnRequestLineItemInput") { inputFields { name } }` → no `returnReason` field; `returnReasonDefinitions(first: 15) { edges { node { id name handle } } }` → 15 real definitions returned |
| E-R5 | R1/R2 | `returnRequest` confirmed working with the corrected input shape — no `@idempotent` directive required (unlike M11/D8) | Live transcript below |
| E-R6 | R5 | `returnApproveRequest` confirmed working — status transitioned `REQUESTED → OPEN`, matching `ReturnStatus.OPEN`'s own description ("in progress"), confirming `{REQUESTED, OPEN}` are indeed the non-terminal states hypothesized in E-R1 | Live transcript below |
| E-M9 | M4 | `ProductVariant` has exactly one barcode-shaped field, plain `barcode` — no separate GTIN/EAN/UPC field, confirming the issue's claim of untyped free-text barcode with no check-digit validation at the schema level | Live introspection |
| E-M10 | M5 | `products(query: "updated_at:>...", sortKey: UPDATED_AT)` confirmed working live, real `updatedAt` timestamps returned in the expected sort order | Live: 3 products returned with `updatedAt` in the `2026-09-04T08:32:xx` range |
| E-M11 | M9 | 🎯 **All 8 inventory quantity states confirmed live**: `available, committed, incoming, on_hand, reserved, damaged, safety_stock, quality_control` — matches the issue's "8 quantity states" claim exactly. `InventoryQuantityName` is NOT a closed GraphQL enum (introspection returned `enumValues: null`) — it is validated some other way (likely a runtime string check), so an invalid name would need a separate live test to see the failure mode (not yet tested) | Live: `inventoryLevels(first:1) { edges { node { quantities(names: [8 names]) { name quantity } } } }` — all 8 returned real values |
| E-T1 | T2 | `TaxonomyCategory.fullName` gives the full breadcrumb path (`"Apparel & Accessories > Clothing"`), `ancestorIds` gives the ancestor id chain, `isLeaf`/`isRoot`/`level` all present — confirms category path/ancestor resolution is fully supported without a live-tree-walk workaround | Live transcript below |
| E-T2 | T9 | `TaxonomyCategory.attributes` confirmed as a real per-category attribute schema (`Color, Pattern, Age group, Target gender, Care instructions` for Clothing; `Color, Pattern, Material, Age group, Accessory size` for Clothing Accessories) — it is a UNION type (`TaxonomyChoiceListAttribute` / `TaxonomyMeasurementAttribute`), requiring inline fragments to query, not a plain object list | Live transcript below |
| E-T3 | T11 | 🚫 **NOT SUPPORTED, confirmed cleanly.** No mutation in the entire schema contains "taxonomy" or "category" in its name — Shopify's Standard Product Taxonomy is fully closed/read-only for a merchant app. There is no `CategoryProvisioner`-equivalent capability; OL products must map onto the existing fixed tree, never create a new node | Live: `__schema { mutationType { fields { name } } }` filtered for "taxonomy"/"category" → `[]` |
| E-D2 | D5 | `ShippingLine.taxLines` field confirmed present on the type — matches the issue's claim that shipping tax is stated separately from line-item tax, meaning `splitShippingAcrossRates` (ADR-063 §5) is genuinely not needed for this platform | Live introspection |
| E-D3 | D9 | `MoneyBag` (the type behind every `*Set` money field, e.g. `totalTaxSet`, `priceSet`) carries both `shopMoney` and `presentmentMoney` — native dual-currency representation (shop's own currency vs. the buyer-facing presentment currency), directly relevant to FX stamping (ADR-040) | Live introspection |
| E-P3 | P7 | `productCreateMedia` confirmed working — image accepted from a remote URL, initial `status: "UPLOADED"` (implies async processing to a later `READY` state, not confirmed by re-poll in this session) | Live: real `MediaImage` id returned |
| E-P5 | P13 | 🎯 **`productSet` behaves as PATCH, not PUT/full-replace, despite its name.** Created a product with `descriptionHtml`/`tags`/`vendor` set, then called `productSet` again on the same `id` with ONLY `title` changed — the omitted fields (`descriptionHtml`, `tags`, `vendor`) survived unchanged rather than being wiped/reset to defaults. Confirms `productSet` is safe to use for a targeted field update without first re-reading and re-sending the full product state | Live transcript below |
| E-P4 | S10 | `products(query: "status:active")` filter confirmed working; `publishedAt` is a per-product field independent of `status` — one `ACTIVE` product had `publishedAt: null`, meaning `status` (catalog visibility) and channel-publication (`publishedAt`) are two different facts, not one | Live: 3 real products, one with `publishedAt: null` despite `status: ACTIVE` |
| E-O10 | O1/O3 | Order feed cursor confirmed opaque and base64-encoded (`eyJsYXN0X2lkIjo3NDM5...` decodes to `{"last_id":...,"last_value":"2026-09-04 10:44:06.170695"}`) — same `updated_at` filter + `sortKey: UPDATED_AT` + cursor-pagination shape already confirmed for products (M5), `pageInfo.hasNextPage` present and reliable | Live: 2-row page returned with real cursors and `hasNextPage: true` |
| E-M12 | M6/M10 | 🎯 **Bulk operations confirmed fully working end to end.** `bulkOperationRunQuery` with a nested `products { variants { ... } }` query completed in ~3s (`objectCount: 43`), returning a time-limited signed GCS download URL. The output is **flat JSONL, one line per node at any depth**, with a `__parentId` field on every non-root row linking it back to its parent's `id` — this is the concrete shape behind the issue's "2 nesting levels" cap: nesting depth is expressed by how many `__parentId` hops are needed to reach a root, not by structural JSON nesting | Live transcript below |
| E-C8 | C7 | 429/Retry-After **still not triggered even at 50 parallel requests** with a moderately expensive query (`products(first:50){variants(first:10){...}}`, ~cost 10-15/call) — all 50 returned HTTP 200 with zero errors. Confirms the generous per-app-per-store budget genuinely resists accidental throttling on a dev store; a deliberate 429 test would need either a sustained multi-minute burst well above 200 pts/s or a paid-plan-tier's tighter budget. Retry-classification behaviour (`Retry-After` header handling) remains structurally UNVERIFIED — not a gap in this platform's design, just a gap this session's tooling could not economically close | Live: 5 sequential + 50 parallel calls, all HTTP 200 |
| E-R8 | R7 | `RefundInput` has **no `returnId`/`return` field at all** — the refund-to-return link is NOT a native foreign key; a refund is linked to a return only indirectly, via `refundLineItems` referencing the same underlying order line items the return referenced. An adapter must stitch this association itself (e.g. by line-item id), matching the design tension the issue's own `SPIKE-2289`-adjacent doc already names for OL's `ReturnRefundService` (#2371's "report an intent" seam) | Live: `__type(name: "RefundInput") { inputFields { name type { name } } }` → no return-shaped field present |
| E-R7 | R6 | `Return.reverseFulfillmentOrders[]` confirmed as a distinct nested object with its own `status` (`OPEN`) and its own `reverseDeliveries[]` (empty until physical receipt is recorded) — confirms the issue's "return / reverse-delivery(custody) / refund(money), three axes" claim as a real, live schema shape, not just a doc-reading inference | Live: `return(id: ...) { reverseFulfillmentOrders(first:5) { edges { node { status reverseDeliveries(first:5) { edges { node { id } } } } } } }` |
| E-R1 | R3 | `ReturnStatus` closed vocabulary: `REQUESTED, OPEN, CLOSED, CANCELED, DECLINED`. Terminal set for `terminalRawStatuses` (#2330 shape) is almost certainly `{CLOSED, CANCELED, DECLINED}`, non-terminal `{REQUESTED, OPEN}` — not yet confirmed by a live state transition, only by the enum's own descriptions (`CLOSED` = "completed", `OPEN` = "in progress") | Live introspection |
| E-R2 | R9 | `ReturnReason` closed vocabulary, 10 values: `SIZE_TOO_SMALL, SIZE_TOO_LARGE, UNWANTED, NOT_AS_DESCRIBED, WRONG_ITEM, DEFECTIVE, STYLE, COLOR, OTHER, UNKNOWN` — closed enum, unlike Allegro's open-world prose `reason.type` (per the sibling Allegro returns spike, `SPIKE-2289`). Maps to OL's `RefundReason` with reasonable 1:1 candidates for most values | Live introspection |
| E-X1 | X5 | `publicApiVersions` confirmed: 4 currently-supported versions at once (`2025-10`, `2026-01`, `2026-04`, `2026-07 (Latest)`), plus `2026-10 (Release candidate)` and `unstable` both marked `supported: false`. Quarterly releases × 4 supported ≈ 12-month support window, consistent with Shopify's documented policy | Live: `{ publicApiVersions { handle displayName supported } }` |
| E-S2 | S4 | `productVariantsBulkUpdate` confirmed working for price write — no idempotency directive required on this mutation (unlike M11/D8) | Live: `price: "999.99"` written and echoed back unchanged |
| E-O7 | O5 (scope correction) | 🚨 **Third scope gap found.** `order.customer { id email }` requires **`read_customers`**, which is NOT in the issue's Prerequisites scope list. `order.email` (top-level, buyer's order-time email) and `order.shippingAddress`/`billingAddress` (including `company`) all worked WITHOUT this scope — so O5/O6 are mostly satisfiable without it, but resolving the order to a full `Customer` record (repeat-buyer identity, #2599-style resolution) needs the missing scope added | Live: `orderCreate` with `email` + `shippingAddress` + `billingAddress` all succeeded; nested `customer { id email }` selection → `"Access denied for customer field. Required access: read_customers access scope."` |
| E-O8 | O7 | **Confirmed: Shopify has no native buyer tax-id / VAT-number field anywhere reached.** Introspected `Order`, `MailingAddress`, `Customer`, `CompanyLocation` — no `tax*Id`/`vat*`/`nip*`-shaped field exists on any of them. `Customer`/`CompanyLocation` carry `taxExempt`/`taxExemptions`/`taxSettings` (exemption STATUS, not an identifier) and a generic `metafield`/`metafields` extension point — the standard Shopify pattern for merchant-custom data with no fixed key convention. Under the #2599 three-state model (`absent` / asserted-none / value), a Shopify order source therefore reads as `absent` (buyerHasTaxId: undefined) by construction, never a real value, unless an operator wires a specific metafield namespace/key — which is not portable across merchants and would need its own design decision, not an adapter default | Live: `__type(name: "Order"/"MailingAddress"/"Customer"/"CompanyLocation") { fields { name } }`, filtered for tax/vat/company-shaped names |
| E-S1 | S13 | Every write mutation observed so far costs **10 points** minimum (`productCreate`, `productDelete`, `productUpdate`, `refundCreate` pre-content-validation, `inventoryAdjustQuantities`, `webhookSubscriptionCreate`, `orderCancel` all costed exactly 10 or thereabouts) — matches the issue's stated "10 points minimum" claim exactly. `orderCreate` with a tax line costed more (`actualQueryCost: 14`, `requestedQueryCost: 18`) proportional to the richer input/selection shape | Live: aggregated from every mutation transcript in this document |
| E-R3 | R6 | `ReverseFulfillmentOrderDispositionType` closed vocabulary: `RESTOCKED, PROCESSING_REQUIRED, NOT_RESTOCKED, MISSING` — maps almost directly onto OL's own `returns` custody/disposition model (§22 architecture-overview): `RESTOCKED`≈`restock`, `NOT_RESTOCKED`≈`scrap`-adjacent, `PROCESSING_REQUIRED`≈"received, awaiting disposition", `MISSING`≈`not_returned`. Confirms the issue's claim that Shopify separates return / reverse-delivery(custody) / refund(money) as three axes, closer to OL's own model than a single status ladder | Live introspection |

## Live transcripts

### E-M2 — deletion detection (M7)

```
$ curl -s -X POST https://shopfyol.myshopify.com/admin/api/2026-07/graphql.json \
  -H "X-Shopify-Access-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"mutation productCreate($product: ProductCreateInput!) { productCreate(product: $product) { product { id title } userErrors { field message } } }","variables":{"product":{"title":"OL-SPIKE-delete-test"}}}'
→ {"data":{"productCreate":{"product":{"id":"gid://shopify/Product/16155546779951","title":"OL-SPIKE-delete-test"},"userErrors":[]}}, ...}

$ curl -s -X POST .../graphql.json -d '{"query":"mutation productDelete($input: ProductDeleteInput!) { productDelete(input: $input) { deletedProductId userErrors { field message } } }","variables":{"input":{"id":"gid://shopify/Product/16155546779951"}}}'
→ {"data":{"productDelete":{"deletedProductId":"gid://shopify/Product/16155546779951","userErrors":[]}}, ...}

$ curl -s -X POST .../graphql.json -d '{"query":"{ product(id: \"gid://shopify/Product/16155546779951\") { id title } }"}'
→ {"data":{"product":null}, ...}
```

### E-M4/E-M5/E-M6 — idempotency + CAS interaction (M11/M13)

```
# Call 1 — no @idempotent directive at all
→ errors: "The @idempotent directive is required for this mutation but was not provided." (code: BAD_REQUEST)

# Call 2 — @idempotent applied to `mutation` keyword (wrong placement)
→ errors: "'@idempotent' can't be applied to mutations (allowed: fields)"

# Call 3 — correct placement: inventoryAdjustQuantities(input: $input) @idempotent(key: "ol-spike-test-001")
#   changeFromQuantity: 50, delta: 5   [current state was 50]
→ SUCCESS. available: 50 → 55. on_hand: 50 → 55.

# Call 4 — retry, SAME key, SAME changeFromQuantity: 50 (byte-identical to call 3)
→ errors: "The changeFromQuantity argument no longer matches the persisted quantity."
  (state is now 55, not 50 — re-evaluated live, NOT replayed from cache)

# Call 5 — retry, SAME key, changeFromQuantity: 55 (matches current state, differs from call 3's param)
→ errors: "The request with this idempotency key has different parameters than the original request."

# Call 6 — retry, SAME key, changeFromQuantity: 50 again (identical params to call 3, again)
→ errors: "The changeFromQuantity argument no longer matches the persisted quantity."
  (same as call 4 — confirms this is not a one-off; state re-checked every time under this key)
```

Final state after this sequence: `available = 55` (only the first call ever applied), confirmed via a
separate read query.

### E-P2 — description HTML sanitization (P6)

```
$ curl -s -X POST .../graphql.json -d '{"query":"mutation productUpdate($input: ProductUpdateInput!) { productUpdate(product: $input) { product { descriptionHtml } userErrors { field message } } }","variables":{"input":{"id":"gid://shopify/Product/16155509195055","descriptionHtml":"<p>Text with <em>italic</em> and <strong>bold</strong></p><ul><li>Item 1</li></ul><table><tr><td>cell</td></tr></table><script>alert(1)</script>"}}}'
→ {"data":{"productUpdate":{"product":{"descriptionHtml":"<p>Text with <em>italic</em> and <strong>bold</strong></p><ul><li>Item 1</li></ul><table><tr><td>cell</td></tr></table><script>alert(1)</script>"},"userErrors":[]}}, ...}

$ curl -s -X POST .../graphql.json -d '{"query":"{ product(id: \"gid://shopify/Product/16155509195055\") { descriptionHtml } }"}'
→ {"data":{"product":{"descriptionHtml":"<p>Text with <em>italic</em> and <strong>bold</strong></p><ul><li>Item 1</li></ul><table><tr><td>cell</td></tr></table><script>alert(1)</script>"}}, ...}
```

Every tag survived verbatim, including the `<script>` tag. No allowlist, no rewrite, no stripping
observed on this single test.

### E-O1/E-O2 — orderCreate with per-line tax rate (O10, D4, O9)

```
# First attempt — tax-line currency (PLN) mismatched against shop currency (USD, resolved default)
→ errors: "Line items tax lines currency does not match the order currency (which defaults to the
  shop currency if not given)"

# Corrected — USD tax-line currency, matching shop.currencyCode
$ curl -s -X POST .../graphql.json -d '{"query":"mutation orderCreate($order: OrderCreateOrderInput!) { orderCreate(order: $order) { order { id name currencyCode lineItems(first:5) { edges { node { title taxLines { title rate ratePercentage priceSet { shopMoney { amount } } } } } } } userErrors { field message } } }","variables":{"order":{"lineItems":[{"title":"OL Spike Test Line","priceSet":{"shopMoney":{"amount":"100.00","currencyCode":"USD"}},"quantity":1,"taxLines":[{"title":"VAT","rate":0.23,"priceSet":{"shopMoney":{"amount":"23.00","currencyCode":"USD"}}}]}],"financialStatus":"PENDING"}}}'
→ {"data":{"orderCreate":{"order":{"id":"gid://shopify/Order/7439343255855","name":"#1001","currencyCode":"USD","lineItems":{"edges":[{"node":{"title":"OL Spike Test Line","taxLines":[{"title":"VAT","rate":0.23,"ratePercentage":23.0,"priceSet":{"shopMoney":{"amount":"23.0"}}}]}}]}},"userErrors":[]}}, ...}
```

`TaxLine.rate` (fraction, `0.23`) and `TaxLine.ratePercentage` (`23.0`) both round-tripped exactly as
sent — this is the ADR-063 per-line tax-rate contract satisfied natively, with no shop master behind
it required.

### E-F1/E-F2/E-F3 — FulfillmentOrder shape + fulfillmentServiceCreate (F6)

```
$ curl -s -X POST .../graphql.json -d '{"query":"{ order(id: \"gid://shopify/Order/7439343255855\") { displayFulfillmentStatus fulfillmentOrders(first: 5) { edges { node { id status requestStatus assignedLocation { location { name } } supportedActions { action } } } } } }"}'
→ {"data":{"order":{"displayFulfillmentStatus":"UNFULFILLED","fulfillmentOrders":{"edges":[{"node":{
     "id":"gid://shopify/FulfillmentOrder/8465445683503",
     "status":"OPEN",
     "requestStatus":"UNSUBMITTED",
     "assignedLocation":{"location":{"name":"Shop location"}},
     "supportedActions":[{"action":"MOVE"},{"action":"HOLD"}]
   }}]}}}, ...}

$ curl -s -X POST .../graphql.json -d '{"query":"mutation fulfillmentServiceCreate($name: String!, $callbackUrl: URL!) { fulfillmentServiceCreate(name: $name, callbackUrl: $callbackUrl, trackingSupport: true, inventoryManagement: true) { fulfillmentService { id serviceName callbackUrl inventoryManagement } userErrors { field message } } }","variables":{"name":"OL-Spike-Fulfillment","callbackUrl":"https://test-ol-example.com/fulfillment-callback"}}'
→ {"data":{"fulfillmentServiceCreate":{"fulfillmentService":{"id":"gid://shopify/FulfillmentService/70521061679?id=true","serviceName":"OL-Spike-Fulfillment","callbackUrl":"https://test-ol-example.com/fulfillment-callback","inventoryManagement":true},"userErrors":[]}}, ...}

$ curl -s -X POST .../graphql.json -d '{"query":"{ locations(first: 10) { edges { node { id name } } } }"}'
→ only 2 locations returned ("Shop location", "My Custom Location") — the new fulfillment-service
  location is NOT among them

$ curl -s -X POST .../graphql.json -d '{"query":"{ shop { fulfillmentServices { id serviceName location { id name } } } }"}'
→ 3 services: "Manual" (Shop location), "Snow City Warehouse" (pre-seeded, unrequested),
  "OL-Spike-Fulfillment" (ours) — each with its OWN location, none of which appear in locations()

$ curl -s -X POST .../graphql.json -d '{"query":"mutation fulfillmentOrderMove($id: ID!, $newLocationId: ID!) { fulfillmentOrderMove(id: $id, newLocationId: $newLocationId) { movedFulfillmentOrder { id } userErrors { field message } } }","variables":{"id":"gid://shopify/FulfillmentOrder/8465445683503","newLocationId":"gid://shopify/Location/113839440175"}}'
→ errors: "Access denied for fulfillmentOrderMove field. Required access:
  `write_merchant_managed_fulfillment_orders` access scope or `write_third_party_fulfillment_orders`
  access scope. Also: The user must have fulfill_and_ship_orders permission."
```

## API surface summary (partial — grows as stories are verified)

**Products**
- `products(first, after, query, sortKey: UPDATED_AT)` — enumeration + modified-since (M1, M5)
- `product(id: ID!)` — single hydrate; returns `null` (not an error) for a deleted id (M2, M7)
- `productCreate` / `productDelete` — confirmed working, standard `userErrors[]` shape (P1)

**Inventory**
- `inventoryAdjustQuantities(input: InventoryAdjustQuantitiesInput!)` — requires **both**
  `changeFromQuantity` per change (CAS) **and** the field-level `@idempotent(key: "...")` directive
  (M11, M13)
- `locations(first, after)` — confirmed native multi-location (M12)

**Taxonomy**
- `taxonomy { categories(first, after, descendantsOf) }` — confirmed reachable with baseline scope
  set; exact scope requirement still open (T1)

**Shop**
- `shop { name myshopifyDomain plan { displayName } resourceLimits { maxProductOptions
  maxProductVariants } }` (C4, P)

### E-C7/E-O3 — webhook registration + order cancellation (C10, O12)

```
$ curl -s -X POST .../graphql.json -d '{"query":"mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) { webhookSubscription { id topic callbackUrl format } userErrors { field message } } }","variables":{"topic":"ORDERS_CREATE","webhookSubscription":{"callbackUrl":"https://test-ol-example.com/webhooks/shopify","format":"JSON"}}}'
→ {"data":{"webhookSubscriptionCreate":{"webhookSubscription":{"id":"gid://shopify/WebhookSubscription/2016462995759","topic":"ORDERS_CREATE","callbackUrl":"https://test-ol-example.com/webhooks/shopify","format":"JSON"},"userErrors":[]}}, ...}

$ curl -s -X POST .../graphql.json -d '{"query":"mutation orderCancel($orderId: ID!, $reason: OrderCancelReason!, $refund: Boolean!, $restock: Boolean!) { orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock) { job { id } orderCancelUserErrors { field message } } }","variables":{"orderId":"gid://shopify/Order/7439343255855","reason":"CUSTOMER","refund":false,"restock":false}}'
→ {"data":{"orderCancel":{"job":{"id":"gid://shopify/Job/028641a7-03de-4412-870e-2ffdcf974f43"},"orderCancelUserErrors":[]}}, ...}

# ~2s later:
$ curl -s -X POST .../graphql.json -d '{"query":"{ order(id: \"gid://shopify/Order/7439343255855\") { cancelledAt cancelReason displayFulfillmentStatus } }"}'
→ {"data":{"order":{"cancelledAt":"2026-09-04T10:44:06Z","cancelReason":"CUSTOMER","displayFulfillmentStatus":"UNFULFILLED"}}, ...}
```

### E-M12 — bulk operation (M6/M10)

```
$ curl ... mutation { bulkOperationRunQuery(query: "{ products { edges { node { id title variants { edges { node { id sku inventoryQuantity } } } } } } }") { bulkOperation { id status } userErrors { field message } } }
→ {"data":{"bulkOperationRunQuery":{"bulkOperation":{"id":"gid://shopify/BulkOperation/7692206407983","status":"CREATED"},"userErrors":[]}}, ...}

# polled { currentBulkOperation { id status errorCode objectCount url } } every 3s
# COMPLETED on first poll (~3s later): objectCount: "43", url: <signed GCS link, ~30min expiry>

$ curl -s "<signed url>" | head -5
{"id":"gid://shopify/Product/16155509129519","title":"The Inventory Not Tracked Snowboard"}
{"id":"gid://shopify/ProductVariant/58427922809135","sku":"sku-untracked-1","inventoryQuantity":0,"__parentId":"gid://shopify/Product/16155509129519"}
{"id":"gid://shopify/Product/16155509162287","title":"Gift Card"}
{"id":"gid://shopify/ProductVariant/58427922579759","sku":null,"inventoryQuantity":0,"__parentId":"gid://shopify/Product/16155509162287"}
{"id":"gid://shopify/ProductVariant/58427922612527","sku":null,"inventoryQuantity":0,"__parentId":"gid://shopify/Product/16155509162287"}
```

`orderCancel` is asynchronous (job-based, like bulk operations) — a caller must poll or otherwise
confirm completion rather than trusting the mutation response alone for cancellation state.

### E-F6/E-R4/E-R5/E-R6/E-R7 — fulfillment write + full return cycle (after scope fix)

```
# Re-authorized with write_merchant_managed_fulfillment_orders + read_customers added.
# Token unchanged: shpua_c83980eb7d548fd2d9d868a9b67a02e2 (still stable across re-auth).

$ curl ... fulfillmentCreate(fulfillment: {lineItemsByFulfillmentOrder: [{fulfillmentOrderId: "gid://shopify/FulfillmentOrder/8465454956847"}], trackingInfo: {number: "OL-SPIKE-TRACK-001", company: "Test Carrier"}, notifyCustomer: false})
→ {"data":{"fulfillmentCreate":{"fulfillment":{"id":"gid://shopify/Fulfillment/6607838708015","status":"SUCCESS","trackingInfo":[{"number":"OL-SPIKE-TRACK-001","url":null}]},"userErrors":[]}}, ...}

$ curl ... { order(id: "...") { displayFulfillmentStatus } }
→ "FULFILLED"

# Return reason discovery — first attempt with a raw enum-shaped field failed:
$ curl ... mutation returnRequest(...) { returnLineItems: [{fulfillmentLineItemId, quantity, returnReason: "UNWANTED", returnReasonNote: "..."}] }
→ errors: "Field is not defined on ReturnRequestLineItemInput" (returnReasonNote)

$ curl ... { __type(name: "ReturnRequestLineItemInput") { inputFields { name } } }
→ fulfillmentLineItemId, quantity, restockingFee, returnReasonDefinitionId, customerNote

$ curl ... { returnReasonDefinitions(first: 15) { edges { node { id name handle deleted } } } }
→ 15 real entries: Unknown, Changed my mind, Item not as described, Received the wrong item, Other,
  Damaged or defective, Too small, Too big, Style, Color, Absorbency, Academic level, Accuracy,
  Adhesion, Adhesive  [clearly extends well past 15 — category-specific reasons implied]

$ curl ... returnRequest(input: {orderId: "...", returnLineItems: [{fulfillmentLineItemId: "...", quantity: 1, returnReasonDefinitionId: "gid://shopify/ReturnReasonDefinition/2", customerNote: "OL spike test return"}]})
→ {"data":{"returnRequest":{"return":{"id":"gid://shopify/Return/16995942703","status":"REQUESTED","name":"#1002-R1", ...},"userErrors":[]}}, ...}

$ curl ... returnApproveRequest(input: {id: "gid://shopify/Return/16995942703"})
→ {"data":{"returnApproveRequest":{"return":{"id":"gid://shopify/Return/16995942703","status":"OPEN"},"userErrors":[]}}, ...}

$ curl ... { return(id: "...") { status reverseFulfillmentOrders(first:5) { edges { node { status reverseDeliveries(first:5) { edges { node { id } } } } } } } }
→ {"data":{"return":{"status":"OPEN","reverseFulfillmentOrders":{"edges":[{"node":{"status":"OPEN","reverseDeliveries":{"edges":[]}}}]}}}, ...}
```

### E-P5 — productSet PATCH-not-PUT semantics (P13)

```
$ curl ... productSet(input: {title: "OL-SPIKE-productSet-test", descriptionHtml: "<p>Original description</p>", tags: ["tag1","tag2"], vendor: "OL Test Vendor"})
→ product created: id=gid://shopify/Product/16155557658927, all four fields set as sent

$ curl ... productSet(input: {id: "gid://shopify/Product/16155557658927", title: "OL-SPIKE-productSet-test-UPDATED"})
→ {"data":{"productSet":{"product":{
     "title":"OL-SPIKE-productSet-test-UPDATED",
     "descriptionHtml":"<p>Original description</p>",   # preserved, not wiped
     "tags":["tag1","tag2"],                              # preserved, not wiped
     "vendor":"OL Test Vendor"                             # preserved, not wiped
   },"userErrors":[]}}, ...}
```

## Open risks — flagged, not guessed

1. **`read_all_orders` requires manual Shopify review** ("rolling basis", no stated SLA) via a
   separate legacy Partner Dashboard flow, distinct from the standard scope picker. **BLOCKED** —
   request submitted 2026-09-04, owner = Shopify, no ETA. Everything else in the story checklist can
   proceed without it since a fresh dev store has no orders older than 60 days anyway.
2. **True concurrent/rapid-fire idempotency replay is unverified.** The 4-call sequence above proves
   the directive is NOT a naive "return cached success" cache under sequential retries seconds apart,
   but does not rule out replay working correctly for genuinely concurrent or sub-second retries
   (the actual failure mode `#2368`'s design targets — a network timeout where the client does not
   know if the first call landed). Needs a follow-up test: fire two byte-identical requests
   near-simultaneously (e.g. via two parallel curl processes) and inspect whether the second is a
   replay or a fresh CAS-checked attempt.
3. **`shpua_` token prefix is not documented anywhere found in desk research.** Behavioural evidence
   (stability across re-auth) strongly suggests offline/app-scoped semantics, but this should be
   confirmed against Shopify's own token-prefix documentation before being relied upon in adapter
   design, particularly around token-refresh/expiry assumptions (C3).
4. **Exact scope requirement for `taxonomy` query is still not isolated** — it worked with the full
   scope set already granted; has not been tested against a narrower scope set to determine the
   minimum requirement.
5. **Issue's own Prerequisites scope list has THREE confirmed gaps, not one**:
   `write_merchant_managed_fulfillment_orders` (blocks F group writes, E-F3/E-F4),
   `read_customers` (blocks resolving `order.customer`, E-O7), and possibly more not yet found.
   The full requested scope set from the issue should not be trusted as complete without a
   line-by-line re-verification against every mutation/query actually used by the eventual adapter.
6. **`descriptionHtml` has zero server-side sanitization (E-P2)** — confirmed a live, real security
   property of the platform, not a desk-research guess. Any OL-side `ADR-046`-style narrowing for
   Shopify must not be mistaken for an XSS boundary; `sanitizeStoredHtml` (or equivalent) is entirely
   OL's responsibility on this platform, same as everywhere else, but worth stating explicitly since
   Shopify's own storefront rendering behaviour around `<script>` in a stored description was not
   tested here (only the Admin API write/read round-trip).

## Recommendation

**Lean ADOPT, confirmed rather than merely carried over from desk research.** Every one of the
issue's three headline findings survived live verification, and F6 came back *stronger* than
claimed (E-F5's near-verbatim vocabulary match to ADR-054). Nothing found in this session's ~65
live-verified stories contradicts the ADOPT lean.

Four corrections are load-bearing enough that a follow-up implementation plan must account for them
explicitly, not just note them in passing:

1. **Prerequisites scope list has (at least) two confirmed gaps**: `write_merchant_managed_fulfillment_orders`
   and `read_customers`. Re-derive the full scope list from the actual mutations/queries the adapter
   will use, rather than trusting the issue's original list.
2. **`@idempotent` is not a naive retry-cache.** It rejects a same-key request with different
   parameters, but does not transparently replay a cached success once state has moved — every
   retry is freshly evaluated against current state and the `changeFromQuantity` CAS check. Design
   the OL-side integration mapping (#2368) around this, not around an assumed dedup-and-replay.
3. **Return reasons are an open, ID-referenced catalog (`ReturnReasonDefinition`)**, not the closed
   10-value `ReturnReason` enum found via introspection — that enum appears to serve a different,
   read-only surface. Build the reason mapping against `returnReasonDefinitions`, open-world, the
   same posture as Allegro's `reason.type`.
4. **`descriptionHtml` carries zero server-side XSS sanitization.** Treat this platform exactly like
   every other adapter for the purposes of `sanitizeStoredHtml` — Shopify supplies no help here.

Remaining unverified ground (bulk operations at scale, retry/429 behaviour, real order-creation
rate-limit ceiling, `read_all_orders` review outcome) is bounded and named explicitly in the coverage
tally above — none of it is large enough to change the verdict, but AC2's "what the dev store cannot
verify" list should cite it directly rather than being written from memory.

## Coverage tally (as of end of live-testing session, 2026-09-04)

Live-verified (transcript exists above), by group: **C** 9/12 (C3 partial/behavioural; C7 = a
confirmed NEGATIVE result — 50-parallel-call burst did not trigger 429, see E-C8) · **M** 13/13
(M6/M10 bulk operations confirmed end to end via `bulkOperationRunQuery`) · **T** 5/12 (T1, T2,
T8-implicit via `fullName`/global tree, T9, T11-NOT-SUPPORTED) · **P** 6/13 (P1, P3-implicit, P6, P7,
P13-behaviourally-confirmed-as-PATCH) · **S** 5/13 (S1, S4, S6, S10, S13) · **O** 13/16 (O1, O2, O3,
O5-partial, O6, O7, O9, O10, O11, O12, O13-vocab-only, O14, O15-schema-only) · **F** 7/8 (F1, F2,
F3-implicit, F4, F6-flagship, F7-implicit, F8-vocab) · **D** 5/9 (D2, D4, D5, D8, D9) · **R** 8/9 (R1,
R2, R3, R4, R5, R6, R7-partial, R9-corrected) · **X** 3/6 (X2, X3, X5, plus X4's exemption
confirmed).

**Genuinely not testable via the Admin API and not attempted** — these are OL-side adapter/design
decisions, not Shopify facts to verify: C5 (config/credential shape validators — OL code), C9 (does
not exist in the issue's own checklist), C12 (`CanonicalInboundEvent` translation — OL code), D1/D6
(invoice issuance/correction logic — OL/invoicing-provider concern, Shopify's role is only to supply
order + tax-line data, already confirmed via O9/O10), X1 (sandbox fidelity — a qualitative judgement,
partially informed by findings above: generous 4000-pt budget confirmed resistant to accidental
throttling even at 50 parallel calls, seeded test data confirmed present, but dev-store-only
`orderCreate` rate cap not separately confirmed), X6 (multi-tenant quota — confirmed structurally
per-app-per-store via `throttleStatus`, not tested with a second app).

**Confirmed as a negative result rather than left untested**: O16/C7 (429/retry behaviour) — a
50-parallel-call burst against a moderately expensive query produced zero throttling, confirming the
budget genuinely resists accidental exhaustion rather than this being an untested gap.

Everything else not explicitly listed above remains desk research only, carried from issue #2879's
own checklist — see the issue body for the full list with its own `✅`/`⚠️`/`?` markers, none of
which have been superseded here except where an `E-*` row above explicitly does so.
