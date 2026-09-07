# Spike — eBay Sell APIs (GB/DE/FR/PL): capabilities, flows, verdict

**Status:** live-probed against the eBay sandbox with a sandbox keyset, a sandbox test seller and
separate sandbox test buyer accounts. Zero production calls.
Corrects and extends the day-0 desk research recorded in issue #2880 — every "Confirmed" /
"Corrected" / "New finding" line below reflects a real HTTP request/response captured during this
session, not a re-read of eBay's documentation.

Refs #2880, part of epic #2878.

## Verdict

**Publish is production-ready-shaped; order ingestion is NOT verifiable in this sandbox.**

The publish half of the eBay Sell APIs (`inventory_item` → `offer` → `publish`, multi-variant
grouping, `withdrawOffer`, bulk price/quantity updates) works exactly as documented, end to end,
including two of #2880's own open questions being resolved by direct observation (S2, S8). Webhook
provisioning also works end to end once two prerequisites are met (Evidence 22).

The order/fulfilment/returns/money half (`O`, `F`, `R`, `D` groups) could **not** be exercised:
two independent sandbox purchase attempts, from two different buyer test accounts, both registered
as a sale at the offer level (`soldQuantity` incrementing) but neither ever appeared through
`GET /sell/fulfillment/v1/order`, because both ended in `Payment failed`.

**The cause of that is now most likely the test account, not eBay.** `GET
/sell/account/v1/privilege` reports **`sellerRegistrationCompleted: false`** (Evidence 27). An
earlier revision of this document attributed the checkout failure to eBay on the strength of
`getPaymentsProgramOnboarding` → `ONBOARDED`; that check covers managed-payments onboarding only,
which is a different gate from seller registration, and the latter was never checked. An
incompletely-registered seller failing to take a card payment is an ordinary outcome.

**Recommendation:** proceed with the publish-side adapter work now. Before drawing any conclusion
about order ingestion, **complete the sandbox seller's registration and re-run one purchase** —
that is a cheap test which plausibly unblocks the whole O/F/R/D half. Only if it still fails
should the fallback options (production keyset + a real low-value purchase, or the legacy Trading
API's `GetOrders`) be considered.

## Evidence

| # | Story | #2880 said | Live result | Verdict |
|---|---|---|---|---|
| 1 | X1 (sandbox + EBAY_PL) | KB 95 (2022) implies PL unsupported in sandbox | `get_default_category_tree_id?marketplace_id=EBAY_PL` → `200 {"categoryTreeId":"212"}`, distinct from GB's `3` | **Corrected** — Taxonomy API works fine for PL in sandbox |
| 2 | T5 (aspectUsage trap) | `aspectUsage` lies about `aspectRequired` | Sampled 19 leaf categories from tree 212; 4 had `aspectRequired=true`, all 4 showed `aspectUsage=RECOMMENDED`, never `REQUIRED` | **Confirmed** 4/4 |
| 3 | T7 (`includeCatalogProductDetails` default) | Defaults to `true`, silently | Read back a live offer never touching that field → `"includeCatalogProductDetails":true` | **Confirmed** |
| 4 | C8 (rate limit observability) | Per-resource, incl. legacy Trading | `GET /developer/analytics/v1_beta/rate_limit/` → `200`, but several resources return literal placeholder strings (`"apiContext":"api context test"`) | **Partially corrected** — sandbox returns stub data for at least some resources; real structure needs production |
| 5 | P5 (policy prerequisite gate) | Policies + location required before publish | `getFulfillmentPolicies` → `400 "User is not eligible for Business Policy"` until opted in | **Confirmed**, + 2 new gotchas (below) |
| 6 | P1 (create-listing happy path) | 3-step flow | Full `inventory_item` → `offer` → `publish` succeeded → live `listingId` | **Confirmed E2E** |
| 7 | S8 (`withdrawOffer` relist behaviour) | Open question: does relisting reset listing age/watchers? | `withdraw` → offer survives (`status: UNPUBLISHED`) → `publish` again → **new** `listingId` | **Answered**: relisting mints a new listing; offer data (SKU, policies, category) is preserved, listing identity is not |
| 8 | S2 (`bulkUpdatePriceQuantity` 1 vs 25) | eBay's own docs contradict themselves | 2 different SKUs in one `requests[]` array → both `statusCode: 200` | **Resolved** in favour of "up to 25"; the "only one SKU" wording in eBay's method intro is wrong/misleading |
| 9 | T8 (shared category tree ids across markets) | "Some EU sites share a tree id" | GB=3, DE=77, FR=71, PL=212 — all four distinct | **Corrected for this specific set** — none of the 4 target markets share a tree |
| 10 | P10 (GPSR regulatory policies) | Conditionally required EU/NI, discoverable per category | `get_regulatory_policies` (GB tree, all 14209 categories) → 50 categories carry `MANUFACTURER_CONTACT: REQUIRED` | **Confirmed**, and — unlike T5 — this endpoint's `usage` value is trustworthy |
| 11 | P9 (tax rate write, ADR-063) | `tax.vatPercentage` is a `number`, cannot express `zw`/`np`/`oo` | `20.5` accepted and round-trips exactly; `"zw"` → `400 Could not serialize field [tax.vatPercentage]` | **Confirmed** |
| 12 | P8 (multi-variant grouping) | Siblings must share category/policies/location/marketplace | Full `inventory_item_group` → per-SKU offers → `publish_by_inventory_item_group` succeeded once a variation-enabled aspect (`Motyw`) was used | **Confirmed E2E**, + T6's `aspectEnabledForVariations` field confirmed as the authoritative "what may vary" signal |
| 13 | O1-O16, F1-F7 (minus F5), R1-R10, D1-D9 | Assumed testable via poll/hydrate once an order exists | Two independent sandbox purchases both registered as a sale at the offer level, **neither ever appeared via `GET /sell/fulfillment/v1/order`** | **New, critical**: order flow not verifiable in this sandbox — see Open Risks |
| 14 | S10 (enumerate offers → reconcile mappings) | Marked ✅, implicitly a single bulk read | `GET /offer` **requires** a `sku` param — no endpoint lists every offer on the account | **Correction**: it is a TWO-STEP sweep (page `inventory_item` for SKUs, then per-SKU `GET /offer?sku=`), not a single bulk read |
| 15 | S11 (auto-match by SKU/EAN via Catalog API) | Marked ✅ | `GET /commerce/catalog/v1_beta/product_summary/search?gtin=…` → `403` with both a user token and a fresh application token | **New finding**: Catalog API access appears separately gated from the base sandbox keyset; not reachable in this session with any token tried |
| 16 | C6 (auth failure error shape) | Marked ✅ | A malformed bearer token → `401 {"errorId":1001,"domain":"OAuth","message":"Invalid access token"}` | **Partially confirmed** — the generic invalid-token shape only; actual expiry/revocation → `needs_reauth` transition not exercised in this session |
| 17 | T3 (leaf-only listing) | ✅, "same as Allegro" | `get_item_aspects_for_category` on a non-leaf category → `400 {"errorId":62009,"message":"...must be a leaf category"}` | **Confirmed** — clean, unambiguous enforcement |
| 18 | T2 (category path) | ✅ | `get_category_suggestions` returns a full `categoryTreeNodeAncestors[]` chain per hit | **Confirmed** — no extra per-level call needed |
| 19 | P6 (description format grammar, ADR-046) | Marked `?` | `listingDescription` containing `<script>alert(1)</script>` written and read back byte-for-byte, unsanitised; no discovery endpoint found | **Answered**: eBay is a "declares nothing" destination under ADR-046 — OL's own conservative sanitisation is the only defence |
| 20 | P7 (image upload, Media API) | Flagged ⚠️ (Trading API decommissioning) | `POST /commerce/media/v1_beta/image/create_image_from_url` → `201`, but body carries `"expirationDate"` ~30 days out | **Confirmed working, + new finding**: an uploaded-but-unpublished image expires after ~30 days (classic EPS "hosted picture" behaviour) |
| 21 | C11 (Notification API topic list) | Names specific topics: auth revocation, order confirmation, PLA budget, seller service metric/standards, 3× feedback | `GET /commerce/notification/v1/topic` → 15 live topics, **none of the above present** | **Corrected**: replace the topic list with the live one (includes `LISTING`, `ORDER_CANCELLATION_ACTIVITY`, `ITEM_MARKED_SHIPPED`, `MARKETPLACE_ACCOUNT_DELETION`, etc.) |
| 22 | C10 (webhook provisioning: config → destination → subscription) | Marked ⚠️, no verdict | Full chain reached `HTTP 201` twice; eBay delivered three genuine 64-hex challenge codes to our endpoint and both objects read back `ENABLED` | **Confirmed WORKING end to end**, after two blockers: a malformed request payload (ours) and a missing app-level notification config (the account's) — see New findings 8/9 |
| 23 | C11/C12 (decode + verify + translate) | Marked ⚠️ / no verdict | `POST /subscription/{id}/test` → `HTTP 500 errorId 2003 "Internal error"` on a live `ENABLED` subscription; no event fires on demand | **Untested** — provisioning works, but no real payload could be obtained to decode |
| 24 | P11 (duplicate offer guard) | 🔴 flagged | `POST /offer` with an already-used sku+marketplaceId+format → `400`, names the existing offer id | **Confirmed** — clean, actionable refusal |
| 25 | P3 (idempotency on create) | ⚠️ noted "SKU is the key" | `PUT /inventory_item/{sku}` called twice, byte-identical body → `204` both times, no duplicate | **Confirmed** — genuinely idempotent |
| 26 | P4 (async create → status poll) | Marked `?` | Every create/update call in this session returned synchronously, no task reference | **Answered**: not applicable — eBay's Inventory API is fully synchronous |
| 27 | F7 (source/destination options) | Marked ✅ | 3 endpoint-name guesses for shipping carriers/services all `404` | **Inconclusive** — could not confirm the correct endpoint without official docs access (403-blocked); left open |
| 28 | P13 (replace, not patch) | 🔴 flagged as a lost-update hazard | Partial `PUT /inventory_item` → `204`, and `description`/`ean`/`imageUrls` all silently wiped; live listing stayed `ACTIVE` | **Confirmed, worse than stated**: it destroys `ean`, which publish requires, and the damage is latent (surfaces at the next publish, not at the write) |
| 29 | AC4 (one account → 4 markets; `1 SKU → N offers`) | Assumed SKU/inventory item is *shared* | Same token created an `EBAY_DE` offer beside the live GB one (2 offers, 1 SKU) — but a DE write moved the item's `locale` `en_GB` → `de_DE`, **overwriting** the English content | **Half-confirmed, half-corrected**: the N-offers model holds; the inventory item is single-locale and destructively market-scoped, so per-market copy cannot live on it |
| 30 | P5 (policies per marketplace) | "12 policies for four markets" | GB policy ids were **accepted** on a DE offer at `createOffer`; `publishOffer` then failed `404 25713 "This Offer is not available"` (twice; GB control published fine) | **Refined**: no per-marketplace policy check at create; and that 404 is a misleading error for a marketplace-eligibility problem — it must not be read as "offer missing" |
| 31 | C9 (which marketplaces does this credential cover) | Marked **?**, "decides AC4" | `GET /sell/account/v1/privilege` → **`{"sellerRegistrationCompleted": false}`**; `get_opted_in_programs` → only `SELLING_POLICY_MANAGEMENT`; no DE policies exist | **Answered**: `/privilege` is the endpoint — and it reports this account as incompletely registered, which is the likely cause of both the DE publish 404 and the checkout payment failure |
| 32 | (new) publish idempotency while published | not in #2880 | Re-publishing an already-published offer → `HTTP 200`, **same** `listingId`, warning `25402` | **New finding**: publish is idempotent while published, unlike withdraw→publish which mints a new `listingId` — relevant to retry safety |
| 33 | Prerequisite 3 (seller account verified, DSA) | Stated as a **hard precondition** for all four markets | `GET /commerce/identity/v1/user/` → `{"accountType":"INDIVIDUAL","registrationMarketplaceId":"EBAY_DE"}`, with `sellerRegistrationCompleted: false`, while everything was published to `EBAY_GB` | **ROOT CAUSE of the checkout failure** — the prerequisite was never satisfied; the whole session was accidentally cross-border. Remedy: a sandbox seller whose "Registration site" matches the marketplace under test |
| 34 | (new) Account API silently strips a write | not in #2880 | `PUT payment_policy` with `CREDIT_CARD` + `brands` → accepted, then reads back `paymentMethods: []` | **New finding**: correct behaviour for a managed-payments seller (eBay processes cards itself), but the write is acknowledged and discarded — same shape as the locale no-op in Evidence 29 |

### New findings not present in #2880 at all

1. **Product-identifier (EAN) enforcement is invisible in the Taxonomy API.** `publishOffer`
   failed with `"The EAN field is missing"` on a category whose `getItemAspectsForCategory`
   response showed zero `aspectRequired: true` fields. This is a separate enforcement mechanism
   from category aspects and is not discoverable ahead of publish time through T5's endpoint.
   **Defensive default:** send `product.ean: ["Does not apply"]` when no real identifier exists.
2. **`publishOffer` / `withdrawOffer` require an explicit `{}` request body.** Calling either with
   no body at all returns `HTTP 411 Length Required` from the sandbox's edge (Akamai) layer before
   the request even reaches eBay's application code. Any HTTP client implementation must always
   send `Content-Type: application/json` + a literal `{}` body on these two calls.
3. **The policy opt-in enum value is `SELLING_POLICY_MANAGEMENT`, not `BUSINESS_POLICY_MANAGEMENT`.**
   `POST /sell/account/v1/program/opt_in` with the latter returns `Could not serialize field
   [programType]`.
4. **Legacy `paymentMethods` (e.g. `PERSONAL_CHECK`) are rejected under Managed Payments.**
   `createPaymentPolicy` with an explicit `paymentMethods` array returns
   `PAYMENT_METHOD_NOT_ALLOWED`. Omit the field entirely; `immediatePay: false` alone is sufficient.
5. **Creating a `fulfillment_policy` with an `INTERNATIONAL` shipping option triggers a sandbox-side
   `HTTP 500`**, regardless of payload shape (`"Cannot invoke ... because \"doi\" is null"` — reads
   as a genuine sandbox-side NullPointerException, not a validation error). Domestic-only policies
   work; international shipping policy configuration could not be verified in this sandbox.
6. **A SKU already published as a standalone offer cannot join a variant group.** Attempting
   `PUT inventory_item_group` with a SKU that already has a live standalone offer returns
   `"The following SKU is already listed as a single SKU listing"`. The standalone offer must be
   withdrawn first.
7a. **`GET /sell/inventory/v1/offer` requires a `sku` query parameter — there is no endpoint
    that enumerates every offer on the account in one call.** A reconciliation sweep must be
    two steps: page through `GET /sell/inventory/v1/inventory_item` (no `sku` required,
    `limit`/`offset` paged) to discover every SKU, then resolve each SKU's offer(s) via
    `GET /offer?sku={sku}`. Designing S10 as a single bulk read would be wrong.
7b. **Catalog API (`commerce/catalog/v1_beta`) returned `403 Access denied` in this session**,
    both with a user token and a freshly-minted application token requesting the base
    `api_scope`. This blocks live verification of GTIN-based catalogue matching (S11, and by
    extension T7's catalogue-linking story) — flag as an open access/entitlement question
    before relying on this API in the adapter design.
7c. **`listingDescription` accepts and stores raw, unsanitised HTML including `<script>`
    tags, byte-for-byte, on write/read round trip.** eBay declares no description-format
    grammar via any discovery endpoint. Confirms this destination is a "declares nothing"
    case under ADR-046 — OL's own outbound sanitisation is the only defence, never assume
    the destination will strip anything.
7d. **An uploaded Media API image expires ~30 days after upload if unattached to a
    published listing** (`expirationDate` in the `createImageFromUrl` response). Not
    mentioned in #2880 at all — relevant to any retry/draft workflow that might upload
    images well ahead of the final publish call.
7e. **`createDestination`'s request field is `deliveryConfig.endpoint`, and a wrong shape is
    indistinguishable from a bad URL.** The API answers `195017 "Invalid or missing end point"`
    identically for a valid HTTPS URL, an `http://` URL, `localhost`, and a request carrying
    **no endpoint field at all** — so the error cannot be used to diagnose the URL, and a
    malformed payload reads exactly like a rejected host. Any adapter work here should pin the
    field shape with a live-call test rather than trusting a hand-written body.
7f. **App-level notification config is an undocumented precondition for webhook provisioning.**
    Until `PUT /commerce/notification/v1/config` has stored an `alertEmail`,
    `createDestination` fails with `195003 "Please provide configurations required for
    notifications"` — a message that names no field. `GET /config` returning
    `404 "Configuration not found."` is the cheap, unambiguous probe for it, and belongs in the
    adapter's connection-test and in any operator setup guide. Note also that topic scope
    dictates token kind: an `APPLICATION`-scope topic (e.g. `MARKETPLACE_ACCOUNT_DELETION`)
    rejects a user token with `195011 "Not authorized for this topic"` and needs a
    client-credentials token, so the `scope` field on each topic must be read rather than
    assumed.
7. **Not every category aspect may be used as a variation axis.** `publishOfferByInventoryItemGroup`
   with `variesBy` set to `Brand` failed with `"Brand is not allowed as a variation specific"`.
   `aspectConstraint.aspectEnabledForVariations` (already surfaced by T6's endpoint) is the
   authoritative signal for which aspects are legal variation axes — this should be read
   alongside `aspectRequired` (T5) whenever building a variant-grouping or listing wizard.

## API surface exercised (live, sandbox)

- `POST /identity/v1/oauth2/token` (client_credentials + authorization_code grants)
- `GET /commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=…` (all 4 markets)
- `GET /commerce/taxonomy/v1/category_tree/{id}` (full tree walk, PL)
- `GET /commerce/taxonomy/v1/category_tree/{id}/get_item_aspects_for_category?category_id=…`
- `GET /developer/analytics/v1_beta/rate_limit/`
- `POST /sell/account/v1/program/opt_in`
- `GET/POST /sell/account/v1/fulfillment_policy[/{id}]`
- `POST /sell/account/v1/payment_policy`
- `POST /sell/account/v1/return_policy`
- `GET /sell/account/v1/payments_program/{marketplaceId}/EBAY_PAYMENTS/onboarding`
- `POST /sell/inventory/v1/location/{merchantLocationKey}`
- `PUT /sell/inventory/v1/inventory_item/{sku}`
- `PUT /sell/inventory/v1/inventory_item_group/{key}`
- `POST /sell/inventory/v1/offer`
- `PUT /sell/inventory/v1/offer/{offerId}`
- `POST /sell/inventory/v1/offer/{offerId}/publish`
- `POST /sell/inventory/v1/offer/{offerId}/withdraw`
- `POST /sell/inventory/v1/offer/publish_by_inventory_item_group`
- `POST /sell/inventory/v1/bulk_update_price_quantity`
- `GET /sell/metadata/v1/marketplace/{marketplaceId}/get_regulatory_policies`
- `GET /sell/fulfillment/v1/order[?filter=…]`, `GET /sell/fulfillment/v1/order/{orderId}` (both empty/failing — see Open Risks)
- `GET /sell/inventory/v1/inventory_item[?limit=&offset=]` (bulk SKU enumeration)
- `GET /sell/inventory/v1/offer?sku=…` (per-SKU offer resolution; no bulk form exists)
- `GET /commerce/catalog/v1_beta/product_summary/search?gtin=…` (403 in this session — see Open Risks)
- `GET /commerce/taxonomy/v1/category_tree/{id}/get_category_suggestions?q=…`
- `POST /commerce/media/v1_beta/image/create_image_from_url`
- `GET /commerce/notification/v1/topic` (15 live topics)
- `GET`/`PUT /commerce/notification/v1/config` (app-level alert email — the hidden precondition)
- `GET`/`POST /commerce/notification/v1/destination[/{id}]` (challenge-response verified live)
- `GET`/`POST /commerce/notification/v1/subscription[/{id}]`, `POST …/{id}/test` (the last one 500s)

Not exercised live in this session (no credential/blocker): everything requiring the production
keyset (C15, X1's fee/label claims, real rate limits), RFC 9421 signing (C14 — needs a confirmed
EU/GB domicile test buyer), Post-Order/returns (R1-R10 — no successful order to attach a return to),
Logistics API (F5 — confirmed by #2880 as limited-release, not attempted), legacy Trading API.

## Open risks

1. **🔴 Order ingestion is unverified — but the next step is cheap and local, not a production
   keyset.** Two independent purchase attempts across two buyer accounts both ended in `Payment
   failed` and never surfaced via `GET /sell/fulfillment/v1/order`. The account was checked for
   managed-payments onboarding (`ONBOARDED`) but **not** for seller registration, which reads
   **`sellerRegistrationCompleted: false`** (Evidence 31). **Complete the sandbox seller's
   registration and retry one purchase before treating this as an eBay limitation.** Only if it
   still fails do the fallbacks apply (production keyset + a real low-value purchase, or the
   legacy Trading API's `GetOrders`/Auth'n'Auth flow). Note that `developer.ebay.com`'s own KB
   pages return `HTTP 403` to every automated fetch, so the documentation that would settle this
   was unreadable from here throughout.
2. **Catalog API access could not be confirmed at all in this session** — `403 Access
   denied` with both a user token and a fresh application token requesting the base
   `api_scope`. Blocks live verification of GTIN-based catalogue matching (S11/T7) until
   the correct scope or entitlement is identified.
3. **International shipping policy configuration returns a sandbox-side 500.** Untested whether
   this is sandbox-only or a real platform bug; blocks verifying cross-border shipping cost
   configuration for the DE/FR/PL markets in sandbox.
4. **Webhook payload decode/verify (C11/C12) is untested, and that is the only webhook gap.**
   Provisioning itself is confirmed working (Evidence 22), but `POST
   /commerce/notification/v1/subscription/{id}/test` — the documented way to trigger a test
   delivery — answers `HTTP 500 errorId 2003 "Internal error … Contact eBay developer support"`
   for a well-formed request against a live `ENABLED` subscription, and
   `MARKETPLACE_ACCOUNT_DELETION` does not fire spontaneously. So no real payload could be
   captured, leaving the signature-verification and `CanonicalInboundEvent` translation halves
   unexercised. Subscribing to a *user*-scope topic that can be triggered by an ordinary
   operator action (e.g. `LISTING`, which fires on a price/quantity change) is the obvious next
   probe; it needs the `sell.listing.read` scope, which was not in this session's token.
5. **The production-keyset account-deletion endpoint activation is blocked via the UI panel, but
   a likely API route around it is now known.** Registering the endpoint through
   developer.ebay.com → "Alerts & Notifications" → Save reported *"Delivery settings
   successfully saved"* while never sending a challenge to the endpoint (verified via both the
   endpoint's access log and an independent request inspector). **The most probable cause is now
   identified rather than mysterious**: the app-level notification configuration did not exist
   (`GET /commerce/notification/v1/config` → `404 "Configuration not found."`), and once it was
   created with `PUT /config`, the equivalent API-driven provisioning worked first try. The
   recommended path is therefore: set `/config`, then provision the account-deletion endpoint via
   `createDestination` + a `MARKETPLACE_ACCOUNT_DELETION` subscription (both confirmed working in
   sandbox with an APPLICATION token), rather than relying on the panel. **Not yet verified on
   production** — stated as a lead, not a fact — but it downgrades this from "requires eBay
   support intervention" to "probably self-service via the API".
6. Everything already flagged 🔴 in #2880 and not reduced by this session: C14 (RFC 9421 signing —
   needs an EU/GB-domicile test buyer, not yet confirmed obtainable via the sandbox test-account
   form), C15/AC2 (production keyset — blocked on standing up the account-deletion endpoint, not
   attempted in this session), F5 (Logistics API — limited-release, out of scope), X1 (every KB 684
   sandbox limitation not superseded above still stands, since none of shipping labels, ePID
   catalogue matching, VAT-exempt registration, or fees were exercised).

## Recommendation

- **Adopt for publish.** The `inventory_item` → `offer` → `publish` flow, `withdrawOffer` as a
  pause/deactivation primitive, bulk price/quantity updates, and multi-variant grouping are all
  confirmed working exactly as #2880 hypothesized (with 2 open questions now resolved: S2 in favour
  of "up to 25", S8 confirmed as "new listing, same offer data"). This is a green light for the
  publish-side adapter (`OfferManagerPort`, `CategoryBrowser`, `EanCategoryMatcher`-equivalent,
  `OfferCreator`).
- **Do not adopt the order-ingestion path on sandbox evidence alone.** Before committing to
  `OrderSourcePort`/`OrderProcessorManagerPort` implementation timelines, either (a) obtain a
  production keyset and complete one real, low-value purchase to confirm `GET
  /sell/fulfillment/v1/order` actually surfaces a paid order, or (b) evaluate whether the legacy
  Trading API's `GetOrders` is a viable fallback for sandbox-only integration testing going
  forward. Recorded as AC2's answer for the O/F/R/D groups: **CONCEDED in sandbox, unresolved**.
- **S8 recommendation for #2880's own open question:** `withdrawOffer` should be treated as a
  genuine `OfferDeactivator` (promoted per #1689), not merely an eBay special case beside
  quantity-0 — it actually ends the listing (buyer-facing `ACTIVE` → `ENDED`) rather than leaving a
  zero-stock listing visible, which is a real improvement over the quantity-0 primitive. The
  caveat that "resuming" mints a new `listingId` (fresh listing age/search standing) should be
  surfaced to the operator, not silently treated as a true pause/resume.
- **Webhook provisioning is viable and should be budgeted for.** The `config` → `destination`
  → `subscription` chain works in sandbox, challenge-response verification included, so the
  adapter can implement `WebhookProvisioningPort` for real rather than treating eBay as
  poll-only-by-necessity. Two caveats: order ingestion still has to be a poll regardless
  (there is genuinely no new-order topic — O4 confirmed against the live topic list), and the
  decode/verify half is unproven, so the first implementation slice should include one live
  `LISTING`-topic delivery as its acceptance evidence.
- **Methodological note, recorded because it changed a verdict.** An earlier revision of this
  document asserted that eBay's sandbox webhook infrastructure was broadly broken, on the
  strength of four consecutive failures that looked alike. Three of them shared one cause —
  the caller — and the fourth was a genuine but ordinary account-config gap. The failures were
  only distinguishable once the probes were made **differentiating** (a deliberately invalid
  URL, then a request with no endpoint at all) instead of repeated variations on the same
  request. Repeated identical failures are evidence about the caller until a probe exists that
  would have behaved differently.
- **Two authoring rules for any future category/variant-mapping UI, stated as a pair:**
  read `aspectConstraint.aspectRequired` to decide what MUST be filled in (never `aspectUsage`,
  per T5); read `aspectConstraint.aspectEnabledForVariations` to decide what MAY be a variation
  axis (confirmed by direct 400 rejection of a disallowed axis in P8).
