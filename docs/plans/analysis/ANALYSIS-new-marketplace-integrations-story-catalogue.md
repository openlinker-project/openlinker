# Analysis — New integrations story catalogue: Amazon, Shopify, eBay, TikTok Shop

**Status:** desk research complete, zero live probes. Every verdict below is *documentation*, not observation.
**Purpose:** the backlog spine for four integration epics. Each story is one thing an assigned developer must
prove with a live call **before** writing adapter code, and the "why this endpoint" answer is what survives
into the spec doc.

**Target markets**

| Platform | Markets | Kind |
|---|---|---|
| Amazon | FR, DE, PL | Marketplace only |
| eBay | GB, DE, FR, PL | Marketplace only |
| Shopify | per-store | **Shop — master *and* destination** |
| TikTok Shop | PL, FR, DE (+ GB) | Marketplace only |

**Sources of record** (fetched 2026-09-04)

- Amazon: `developer-docs.amazon.com/sp-api/*` — Orders v2026-01-01, Listings Items v2021-08-01,
  Product Type Definitions v2020-09-01, Catalog Items v2022-04-01, Feeds v2021-06-30, Notifications v1,
  Merchant Fulfillment, Reports, usage plans, security & compliance overview.
- Shopify: `shopify.dev/docs/api/admin-graphql/*` (version 2026-07), access scopes, inventory quantity states,
  fulfillment service apps, returns apps, protected customer data, rate limits, bulk operations.
- eBay: `developer.ebay.com/api-docs/*` — Inventory, Fulfillment, Account, Taxonomy, Catalog, Notification,
  Post-Order v2, Logistics, call limits, digital signatures, deprecation status, KB 95 / KB 684.
  **`developer.ebay.com` returns HTTP 403 to all automated fetches** — read via `web.archive.org` snapshots
  (Mar–Jun 2026) plus live `ebay.pl` seller pages. Any OL link-checking tooling will fail against that host.
- TikTok Shop: `partner.tiktokshop.com/docv2/*` is **login-gated and JS-rendered** — a raw fetch returns a
  1.2 MB shell with no content. Primary evidence is TikTok Newsroom + the `EcomPHP/tiktokshop-php` SDK source
  (which *is* the wire format) + CData's generated field reference. Treat doc-page citations as second-hand.

**OL side of record:** `libs/core/src/sync/domain/types/sync-job.types.ts` (55 job types),
`apps/worker/src/sync/handlers/handler-registration.service.ts` (lanes),
`apps/worker/src/scheduler/scheduler.service.ts` + `libs/integrations/*/src/infrastructure/scheduler/*` (34 tasks),
`libs/core/src/sync/application/services/inbound-routing-policy.service.ts` (8 inbound domains),
`libs/plugin-sdk/src/{adapter-plugin,host-services}.ts` (15 registration seams), `docs/capabilities.md`.

---

## 1. Platform verdicts

| | Amazon | Shopify | eBay | TikTok Shop |
|---|---|---|---|---|
| Proposed `platformType` | `amazon` | `shopify` | `ebay` | `tiktokshop` |
| Proposed `adapterKey` | `amazon.spapi.v1` | `shopify.admin.v1` | `ebay.sell.v1` | `tiktokshop.openapi.v1` |
| Closest shipped analogue | Allegro | WooCommerce | Allegro | Erli |
| Auth | LWA OAuth (SigV4 removed Oct 2023) | OAuth auth-code, custom distribution | OAuth auth-code, 2 h / 18 mo | OAuth, `x-tts-access-token` header |
| Transport | REST JSON | **GraphQL only** for new apps | REST JSON (+ legacy SOAP) | REST JSON + HMAC signature |
| Order push | **SQS / EventBridge only** | HTTP webhooks | **none in REST** | HTTP webhooks |
| Sandbox | static canned, Orders/Listings not dynamic | dev store, 5 orders/min | no `EBAY_PL`, no labels, no ePID | UK + Indonesia only, or none |

**Two naming traps to write into the epic text:**

1. **TikTok Shop ≠ TikTok Catalog.** TikTok Shop is a marketplace (`open-api.tiktokglobalshop.com`, Partner
   Center). "TikTok Shopping" / Catalog Ads is an *advertising* product feed (`business-api.tiktok.com`),
   checkout on the merchant's own site, **no orders to ingest**. Different credentials, host and object graph.
   Only the former is in scope.
2. **`EBAY_GB`, not `EBAY_UK`.** The wrong value is a silent `62003` from Taxonomy.

---

## 2. The connection-grain decision — decide this first, everything follows

| | Credential scope | Per-marketplace things | Natural grain |
|---|---|---|---|
| Amazon | **1** refresh token, 1 EU endpoint, all 3 markets | price, listing content, product-type schema | ? |
| eBay | **1** token, all 4 markets | offers, **12 business policies**, 4 category trees, 4 currencies, `Content-Language` | ? |
| TikTok | 1 authorization → **N shops, each with own `shop_cipher` + `region`** | everything | **1 shop = 1 connection** |
| Shopify | 1 store | — | **1 store = 1 connection** |

TikTok and Shopify answer themselves. Amazon and eBay both have **one credential set and N marketplaces**,
while OL puts `credentialsRef` on the `Connection`.

Arguments for **N connections** (one per marketplace):
- `stockSafetyBuffer` and `pricingRule` are per-connection and genuinely differ per market.
- eBay business policies are per-marketplace and mandatory before publish.
- `DestinationCategory` is keyed `taxonomyOwner | connectionId`, and `TaxonomyIdentityProvider.getTaxonomyIdentity()`
  returns **one** value — a single connection cannot declare three trees.
- ADR-037 already ruled that Amazon and eBay must onboard as `'amazon:<marketplaceId>'` / `'ebay:EBAY_GB'`,
  never bare, precisely because the tree differs per marketplace.

Argument for **1 connection**: one OAuth token, one refresh lifecycle, one re-auth event.

Existing precedent for splitting: Erli already ships `ConnectionCredentialsRewriterPort` to share Allegro
credentials across connections.

**Recommendation to test, not to assume:** N connections per marketplace, sharing one credential row via a
rewriter. Amazon complicates it — it has *no* category tree at all, so the `TaxonomyIdentityProvider` argument
does not bite there and the product-type schema is fetched per `marketplaceIds` at call time.

---

## 3. Story catalogue

Legend: ✅ supported · ⚠️ degraded/qualified · ❌ not possible · 🔒 gated on vendor approval · **?** unproven, needs the probe

Every non-❌ cell is a story the assigned developer owes a curl transcript for.

### Group C — Connect

| # | Story | AMZ | SHOP | EBAY | TTS | Notes |
|---|---|---|---|---|---|---|
| C1 | Register a developer app and obtain credentials | 🔒 | ⚠️ | 🔒 | 🔒 | AMZ: developer profile + security questionnaire, 5-day response SLA. EBAY: keyset disabled until account-deletion endpoint is live. SHOP: admin-created custom apps **closed to new apps** — Dev Dashboard + custom distribution only |
| C2 | OAuth authorize URL + code exchange (`OAuthCompletionPort`) | ✅ | ✅ | ✅ | ✅ | All four need this seam. Only Allegro has it today |
| C3 | Token refresh, and behaviour at expiry | ✅ 1 h access | ✅ offline token | ⚠️ 2 h / 18 mo, **revocable without notice** | ⚠️ ~7 d / 365 d, **UNCONFIRMED** — read off the response | TTS also fires `UPCOMING_AUTHORIZATION_EXPIRATION` 30 d out |
| C4 | Connection test probe (`ConnectionTesterPort`) | ✅ `getMarketplaceParticipations` | ✅ `shop` query | ✅ `getDefaultCategoryTreeId` | ✅ `/authorization/202309/shops` | Pick the cheapest authenticated read |
| C5 | Config + credentials shape validators | ✅ | ✅ | ✅ | ✅ | Optional seams, but every shipped plugin has them |
| C6 | Auth failure → `needs_reauth` (`AuthFailureClassifierPort`) | ✅ | ✅ | ✅ + `authorization revocation` webhook | ✅ + `SELLER_DEAUTHORIZATION` webhook | eBay and TikTok both push a revocation event — better than Allegro |
| C7 | Retry classification + penalty-free deferral (`RetryClassifierPort`) | ✅ 429 | ✅ 429 + `Retry-After` | ✅ | ⚠️ **success is `code: 0` in the body, not HTTP status** | TTS: a naive `if (res.ok)` treats business failures as success |
| C8 | Per-connection rate limiter via `host.http` | ✅ | ✅ `extensions.cost.throttleStatus` on every reply | ✅ `getRateLimits` endpoint | ⚠️ dynamic quota, no query API | SHOP and EBAY both expose remaining budget — wire it to the health panel |
| C9 | Discover which marketplaces/shops this credential covers | ✅ `getMarketplaceParticipations` | n/a | **?** | ✅ shops[] with region + cipher | Decides the connection-grain question in §2 |
| C10 | Webhook provisioning (`WebhookProvisioningPort`) | ❌ no HTTP webhooks | ✅ | ⚠️ `createDestination` + `createSubscription`, **no order topic** | ✅ `PUT /event/202309/webhooks`, one URL per topic | |
| C11 | Webhook decode + signature verify (`InboundWebhookDecoderPort`) | ❌ | ✅ HMAC | ✅ | ⚠️ **different algorithm from request signing**, no replay protection | TTS: `HMAC_SHA256(app_secret, app_key + raw_body)` in `Authorization`, no `Bearer` |
| C12 | Translate to `CanonicalInboundEvent` (`WebhookEventTranslatorPort`) | ❌ | ✅ | ⚠️ | ✅ | |
| **C13** | **SQS consumer as a third inbound transport** | **🔴 required** | ❌ n/a | ❌ n/a | ❌ n/a | **Amazon-only, and it is new OL infrastructure.** See §4 |
| **C14** | **RFC 9421 digital request signing + key management** | ❌ n/a | ❌ n/a | **🔴 required** | ❌ n/a | **eBay-only, EU/UK sellers, gates refunds + returns.** See §4 |
| C15 | Marketplace account-deletion / GDPR callback endpoint | ❌ n/a | ❌ n/a | **🔴 required before first production call** | ❌ n/a | `GET ?challenge_code=` → `sha256(code + token + endpoint)`. BOM in a hand-built string fails it |

### Group M — Catalogue in (`ProductMaster` / `InventoryMaster`) — Shopify only

| # | Story | SHOP | Notes |
|---|---|---|---|
| M1 | Enumerate product external ids, paged (`listExternalIds`) | ✅ | Cursor pagination; **bulk operation** (JSONL) is the cheap path for a full catalogue |
| M2 | Hydrate one product (`getProduct`) | ✅ | |
| M3 | Read variants (`getProductVariants`) | ✅ | **2048** variants/product (the old 100 cap is gone) |
| M4 | Barcode / GTIN on the variant | ⚠️ | `ProductVariant.barcode` is **untyped free text** — no GTIN/EAN/UPC distinction, no check-digit validation. All GS1 semantics are OL's |
| M5 | Modified-since enumeration (`ModifiedProductLister`) | ✅ | `updated_at` filter **and** `UPDATED_AT` sort key on the same query. Best in tree — PrestaShop cannot do this |
| M6 | Bulk prefetch (`BulkProductReader`) | ✅ | `bulkOperationRunQuery`. Caps: 5 connections, **2 nesting levels**. Product → variants → inventoryLevels → location is already at the edge |
| M7 | Product deletion detection → `MasterProductNotFoundError` | **?** | Needs a probe: what does a query for a deleted product id return? |
| M8 | Per-variant tax rate (`ProductTaxRateReader`) | ⚠️ | `ProductVariant.taxable` is a boolean; **`taxCode` is deprecated**. No live per-variant rate. Weaker than PrestaShop |
| M9 | List inventory per variant (`listInventory`) | ✅ | `InventoryLevel.quantities(names:)`, 8 states. `committed` is Shopify's own reservation ledger, read-only |
| M10 | Bulk inventory prefetch (`BulkInventoryReader`) | ✅ | via bulk operation |
| M11 | `adjustInventory` + honour `idempotencyKey` (#2368) | ✅ **natively** | `inventoryAdjustQuantities` (delta) / `inventorySetQuantities` (absolute), both with `changeFromQuantity` **compare-and-swap** and mandatory `@idempotent`. Only platform in the tree that honours #2368 natively — Woo fakes it with a 7-day cache, PrestaShop refuses |
| M12 | Locations → `inventory_locations` (#2313) | ✅ | Native multi-location. Maps to ADR-058 decision 1 |
| M13 | Mandatory-idempotency version floor | 🔴 | `@idempotent` becomes **mandatory at API 2026-04**, enforced at *runtime not schema* — a codegen'd client compiles and fails in production. 17 mutations |

*Amazon, eBay and TikTok are all ❌ for this whole group.* Amazon owns the ASIN and other contributors can change
it; FBA stock is Amazon's, not the seller's. eBay's inventory item is a write-model keyed on the seller's own SKU.
TikTok has no catalogue-of-record concept.

### Group T — Taxonomy & attributes

| # | Story | AMZ | SHOP | EBAY | TTS | Notes |
|---|---|---|---|---|---|---|
| T1 | Browse category tree, paged + resumable (`CategoryBrowser`) | ❌ | ✅ | ✅ | ✅ | AMZ has **no browsable tree** — the unit is a *product type*, not a category |
| T2 | Category path / breadcrumb (`CategoryPathReader`) | ❌ | ✅ ancestors | ✅ | **?** | |
| T3 | Leaf-only listing constraint | n/a | n/a | ✅ `getItemAspectsForCategory` **errors on a non-leaf** | **?** | Same shape as Allegro |
| T4 | Required category parameters (`CategoryParametersReader`) | ⚠️ | ✅ | ⚠️ **trap** | ✅ + `categories/{id}/rules` | See T5 |
| T5 | Required-vs-recommended trap | 🔴 | — | 🔴 | **?** | **EBAY: read `aspectConstraint.aspectRequired`, NEVER `aspectUsage`** — a hard-required aspect returns `aspectUsage: RECOMMENDED` and blocks the listing anyway. **AMZ: Product Type Definitions are JSON Schema 2019-09 with *conditional* required attributes, which ADR-023 already records as not fitting OL's flat `CategoryParameter` model** |
| T6 | Parameter restrictions (min/max/dictionary) → `checkParameterRestrictions` | ✅ JSON Schema | n/a | ✅ `itemToAspectCardinality`, `NUMERIC_RANGE`, `aspectValues` | **?** | eBay also gives `expectedRequiredByDate` — an aspect *scheduled* to become required. No Allegro equivalent; genuine early-warning signal |
| T7 | Catalogue product card lookup (`CatalogProductReader`) | ✅ ASIN | n/a | ⚠️ ePID | ❌ | **EBAY: `includeCatalogProductDetails` defaults to `true`** — eBay will silently overwrite your title, description, specifics and images with catalogue data. Direct conflict with ADR-046. Set it `false` explicitly or make it an operator control |
| T8 | Taxonomy identity per marketplace (`TaxonomyIdentityProvider`) | ⚠️ n/a — no tree | ✅ global to Shopify, not per-store | ✅ `getDefaultCategoryTreeId(marketplace_id)` | **?** | eBay: some EU sites **share** a tree id — cache by returned tree id, not by marketplace |
| T9 | Shop attributes + terms (`ShopAttributeReader`) | n/a | ✅ | n/a | n/a | |
| T10 | Shop category browse (`ShopCategoryBrowser`) | n/a | ✅ `taxonomy` query, `descendants_of` pulls a subtree in one request | n/a | n/a | Cheaper than a one-level-at-a-time walk |
| T11 | Create a destination category (`CategoryProvisioner`) | n/a | **?** | n/a | n/a | |
| T12 | Taxonomy sync fits inside the daily quota | ✅ | ✅ | 🔴 | **?** | **EBAY Taxonomy = 5 000 calls/day PER APP, not per seller.** Four trees walked naively exhausts it in one run. On a multi-tenant deployment every merchant shares that quota. `DestinationCategory`'s paged resumable `expandedAt` frontier (#1979/#2061) is mandatory here, not optional |

### Group P — Publish out

| # | Story | AMZ | SHOP | EBAY | TTS | Notes |
|---|---|---|---|---|---|---|
| P1 | Create a listing / offer | ⚠️ | ✅ | ✅ | ✅ | EBAY: three steps — `createOrReplaceInventoryItem` → `createOffer` → `publishOffer`. Only `sku`/`marketplaceId`/`format` required at create; the rest at publish. Maps well onto `OfferCreationRecord`'s two-phase shape |
| P2 | Create a **new** catalogue entry vs offer against an existing one | 🔒 | n/a | ✅ | ✅ | **AMZ: a new ASIN needs a GTIN exemption — a manual, out-of-band, per-brand-per-category approval OL cannot automate.** Offer-against-existing-ASIN is the realistic default, mirroring Allegro's card-linked case |
| P3 | Idempotency on create | **?** | ✅ `@idempotent` | ⚠️ SKU is the key | **?** | EBAY: `createOrReplaceInventoryItem` is keyed on the seller's own SKU, so it is naturally idempotent — but see P11 |
| P4 | Async create → status poll | ✅ Feeds: poll `getFeed` | n/a | **?** | ✅ `audit_status` | AMZ and TTS both need the #447 poller shape |
| P5 | Connection-level precondition gate (`validateBatch`, #2240) | **?** | n/a | 🔴 **12 business policies** | **?** | **EBAY: payment + fulfillment + return policies are mandatory before publish, per marketplace, behind `optInToProgram`.** 3 × 4 markets. A missing policy fails every child of a bulk batch while the wizard reads all-green — exactly the #2240 failure shape. Also mandatory: an **inventory location** (`merchantLocationKey`) |
| P6 | Description format grammar (`getDescriptionFormat`, ADR-046) | **?** | **?** | **?** | **?** | Unresearched for all four. Each needs a real answer or the conservative subset |
| P7 | Image upload | **?** | ✅ | ⚠️ | ⚠️ | EBAY: Trading `UploadSiteHostedPictures` **decommissions 2026-09-30**; the Inventory flow guide still points at it, so that doc is stale — use the Media API. TTS: `POST images/upload` multipart with a `use_case` field, returns a URI (you cannot pass image URLs) |
| P8 | Multi-variant grouping (`variantGroup`, #1065) | **?** | ✅ | ✅ `createOrReplaceInventoryItemGroup` + `publishOfferByInventoryItemGroup` | ✅ `sales_attributes` | EBAY: sibling offers must share category, description, policies, location and marketplace — only SKU/qty/price may differ. `publishOfferByInventoryItemGroup` **silently omits** variants with missing data but **fails the whole call** on invalid data — always read the warnings array |
| P9 | Write the tax rate at publish (#2245 / ADR-063) | **?** | n/a | ⚠️ | ✅ enum | **EBAY: `tax.vatPercentage` is a `number`, scale 3 — it cannot express `zw` / `np` / `oo`.** An exemption-coded line must be **refused**, exactly like the Allegro numeric-`rates[]` case ADR-063 already handles. Requires a business seller with a VAT ID registered with eBay |
| P10 | GPSR / responsible producer / safety info | **?** | n/a | ✅ | ✅ | EBAY: `regulatory.{documents,manufacturer,productSafety,responsiblePersons}`, conditionally required EU/NI since 2024-12-13; discover per category via Metadata `getRegulatoryPolicies`. TTS: `product/{v}/compliance/{responsible_persons,manufacturers}` |
| P11 | Duplicate guard — already listed on this destination (#1837) | **?** | ✅ upsert | 🔴 | **?** | **EBAY: SKU is the account-wide inventory key.** Two OL connections pointing at one eBay account would silently overwrite each other. Only one offer may exist per `sku` + `marketplaceId` + `format` |
| P12 | Per-marketplace content and locale | ✅ | n/a | 🔴 | **?** | **EBAY: `Content-Language` is a REQUIRED header** on `createOffer` and `createOrReplaceInventoryItem` (`en-GB`, `de-DE`, `fr-FR`, `pl-PL`). eBay does **not** translate — a German offer needs German copy from OL |
| P13 | Replace-vs-patch semantics on update | 🔴 | ✅ | 🔴 | ⚠️ | **AMZ: `putListingsItem` drops attributes omitted from the payload.** **EBAY: `bulkCreateOrReplaceInventoryItem` is a complete replacement and eBay advises a `getInventoryItem` read before every write** — a read-modify-write on the hottest path, and a lost-update hazard. TTS has `partial_edit` |

### Group S — Keep in sync

| # | Story | AMZ | SHOP | EBAY | TTS | Notes |
|---|---|---|---|---|---|---|
| S1 | Write quantity to one offer | ✅ patch `fulfillment_availability` | ✅ | ⚠️ **two-level** | ✅ | **EBAY: quantity must be written at BOTH the inventory item and the offer.** Live listing shows `min(item.quantity, offer.availableQuantity)` — which is actually a clean fit for a per-connection `stockSafetyBuffer` (#1844) over a global master quantity |
| S2 | Batch quantity write (`OfferQuantityBatchUpdater`) | ✅ Feeds | ✅ | 🔴 **contradiction** | ✅ | **EBAY `bulkUpdatePriceQuantity`: the intro prose says "only one SKU per call"; the field docs and the guide say 25; the payload schema is an array of `{sku, offers[]}`.** 25× difference in request volume. **This is probe #1 for eBay** |
| S3 | Async quantity ack reconcile (`PendingQuantityAckReconciler`) | **?** | n/a | **?** | **?** | Allegro-shaped. Unknown for all four |
| S4 | Write price | ✅ patch `purchasable_offer` (`op: merge`) | ✅ | ✅ same call as S2 | ✅ dedicated endpoint | **AMZ: the Product Pricing API does NOT write prices** — it is `getCompetitiveSummary` / `getFeaturedOfferExpectedPrice`, a repricing *read*. Common misreading |
| S5 | Update offer fields (`OfferFieldUpdater`) | ✅ `patchListingsItem` | ✅ | ✅ `updateOffer` | ✅ `partial_edit` | |
| S6 | Read offer status (`OfferStatusReader`) | ✅ | ✅ | ✅ | ✅ | **AMZ: write ops report only pre-acceptance issues; `getListingsItem` reports post-processing issues.** A successful `putListingsItem` does not mean the listing is live — the ADR-009 disjoint-snapshot design applies directly |
| S7 | Read commercial snapshot — live price + qty on channel (#2024) | ✅ `includedData=offers` | ✅ | ✅ | ✅ | |
| S8 | Pause an offer | ⚠️ qty 0 | n/a | ✅ **real** | ✅ | **EBAY `withdrawOffer` ends the listing and keeps the offer for `publishOffer` to relist** — the first shipped destination with a genuine `OfferDeactivator`, the capability #1689 deferred. Trade-off: likely resets listing age/watchers and may re-incur an insertion fee, so quantity-0 stays the lower-impact pause. **Product decision, not a default** |
| S9 | Restore stock after cancellation (`OfferStockRestorer`) | **?** | n/a | **?** | **?** | |
| S10 | Enumerate the seller's offers → reconcile mappings | ✅ `searchListingsItems` | ✅ | ✅ | ✅ `products/search` | |
| S11 | Auto-match existing offers by SKU/EAN | ✅ | n/a | ✅ | **?** | |
| S12 | Shop product status read (`ShopProductStatusReader`) | n/a | ✅ | n/a | n/a | |
| S13 | Write-rate ceiling per listing | ✅ 5 req/s | ⚠️ 10 pts/mutation | 🔴 **250 revisions per listing per calendar day** | **?** | eBay's cap is per listing per day, not per app. A webhook-per-stock-change propagation design hits it |

### Group O — Orders in

| # | Story | AMZ | SHOP | EBAY | TTS | Notes |
|---|---|---|---|---|---|---|
| O1 | Order feed / cursor (`listOrderFeed`) | ⚠️ | ✅ | ⚠️ | ✅ | **TTS is the best of the four**: `update_time_ge` + `page_token` is a proper resumable watermark |
| O2 | Hydrate one order (`getOrder`) | ✅ | ✅ | ✅ | ✅ | **AMZ v2026 `includedData` removes the N+1** — one search hydrates buyer, recipient, tax, packages, fulfillment. **EBAY: `getOrders` returns `cancelRequests` ALWAYS EMPTY — use `getOrder`** |
| O3 | Cursor semantics + resumability | ⚠️ 24 h token | ✅ | 🔴 **offset** | ✅ | **EBAY has no cursor** — offset paging over a live `lastmodifieddate` set, which is exactly ADR-048 decision 3's step-over hazard. Overlap the watermark. Also: **if both `creationdate` and `lastmodifieddate` are sent, only `creationdate` is used** — a watermark poll that sends both never sees modifications. `limit > 200` **fails** rather than clamping |
| O4 | Push notification for a new order | ⚠️ SQS | ✅ | ❌ | ✅ | **EBAY: there is no REST notification topic for new orders.** Options are poll, or legacy SOAP Platform Notifications (and `ItemMarkedPaid` decommissions 2026-06-22). Poll-first is the defensible v1 |
| O5 | Buyer identity + email normalization (`EmailNormalizerPort`) | ⚠️ | ✅ | ✅ | ❌ | **AMZ: buyer email is an anonymized relay `xxxxx@marketplace.amazon.<tld>`, stable per buyer** — so it will never merge with the same human's PrestaShop order. Treat Amazon buyers as their own identity origin. GitHub issues report the field's availability changing without notice |
| O6 | Shipping / billing address | 🔒 | ✅ | ✅ | ❌ **masked** | **AMZ needs the restricted Direct-to-Consumer Shipping role.** **TTS masks recipient name and phone when the order ships on platform logistics — masking, not encryption, no decrypt call.** TikTok has been progressively tightening this |
| O7 | Buyer tax id (#2599) | **?** | **?** | **?** | **?** | Unresearched for all four. PrestaShop is currently the only source that supplies one |
| O8 | Resolve a line to a variant/offer (`IncomingOrderItemRef`) | ✅ ASIN/SKU | ✅ | ✅ `lineItemId` + SKU | ✅ sku_id | |
| O9 | Totals + currency | ✅ | ✅ | ⚠️ | ✅ | **EBAY: `lineItems.total` returns a DIFFERENT value depending on whether `fieldGroups=TAX_BREAKDOWN` is set.** Any revenue figure must pin it and record that it did — the silent-figure-movement class ADR-040 exists to prevent |
| O10 | Per-line tax **rate** (ADR-063) | ❌ amounts only | ✅ `TaxLine.rate` + `ratePercentage` | ❌ amounts only | ❌ order-level only | See §4. Three of four produce permanently rate-less lines |
| O11 | Order status vocabulary → `order_state_mappings` | ✅ | ✅ | ✅ | ✅ 9 values | |
| O12 | Observe a cancellation | ✅ `includedData=CANCELLATION` | ✅ | ⚠️ `getOrder` only | ✅ | |
| O13 | Payment status | ✅ | ✅ | ✅ | ✅ | |
| O14 | Delivery method / pickup point | **?** | ✅ | **?** | ✅ `delivery_preferences_drop_off_location` | |
| O15 | Create an order on the destination (`OrderProcessorManagerPort`) | ❌ | ✅ | ❌ | ❌ | **SHOP: `orderCreate` requires `write_orders` AND an offline token; capped at 5 orders/min on dev and trial stores** — every seeded fixture run hits it |
| O16 | Ingest within the rate limit | 🔴 | ✅ | ✅ 100k/day | ✅ | **AMZ `searchOrders` = 0.0056 req/s — one call per ~3 minutes.** See §4 |

### Group F — Fulfil

| # | Story | AMZ | SHOP | EBAY | TTS | Notes |
|---|---|---|---|---|---|---|
| F1 | Read fulfillment status back (`FulfillmentStatusReader`) | ✅ | ✅ | ✅ | ✅ | |
| F2 | Write tracking / confirm shipment (`OrderFulfillmentUpdater`) | ✅ | ✅ | ✅ | ✅ | **AMZ `confirmShipment` is on Orders **v0**, which sunsets 2027-03-27 — its v2026 equivalent is UNCONFIRMED.** Ship+ orders return 400. **EBAY `createShippingFulfillment` is one call per package and `shippedDate` DEFAULTS TO NOW if omitted** — supply the carrier's real instant, per OL's #2336/#2367 rule that a channel instant is the channel's |
| F3 | Order status writeback (`OrderStatusWriteback`) | **?** | ✅ | **?** | ✅ | |
| F4 | Late-waybill relay (#1947) | **?** | ✅ | ✅ | ✅ | |
| F5 | Buy a shipping label (`ShippingProviderManagerPort`) | 🔒 **PL not listed** | n/a | 🔒 Limited Release | ✅ + FBT | **AMZ Merchant Fulfillment needs the restricted D2C Shipping role, and the FBM Ship+ table does not mention Poland at all** (FR domestic "Q4 2026"). **EBAY Logistics API is "available only to select developers approved by business units"** and labels do not work in sandbox at all. For PL/DE the realistic path is OL's existing InPost/DPD adapters, relaying the waybill back via F2 |
| F6 | Act as a fulfillment executor (`FulfillmentExecutorPort`, ADR-054) | ❌ | ✅ **near-exact** | ❌ | ❌ | See §4 |
| F7 | Source options — statuses / delivery methods / payments | ✅ | ✅ | ✅ | ✅ | |
| F8 | Destination options — carriers / statuses / payments | n/a | ✅ | n/a | n/a | |

### Group D — Money & documents

| # | Story | AMZ | SHOP | EBAY | TTS | Notes |
|---|---|---|---|---|---|---|
| D1 | Issue an invoice for an order from this channel | ⚠️ | ✅ | ⚠️ | 🔴 | Gated by D2 and D4 |
| D2 | Is buyer data sufficient to invoice? | ⚠️ 🔒 | ✅ | ✅ | ❌ | **TTS: you cannot issue a KSeF invoice to a masked name and address.** For a Polish seller this is a hole in the main workflow, not an inconvenience. **AMZ needs the restricted role for the address, and the email is a relay** |
| D3 | Marketplace-facilitator VAT signalling | **?** | n/a | ✅ | ⚠️ | **EBAY exposes `ebayReference.{name,value}` — `IOSS` / `OSS` and eBay's own VAT identifier — on facilitated sales.** That belongs on an invoice and **nothing in OL's order contract models it today**. TTS: whether a machine-readable "TikTok is VAT-responsible" flag exists is UNCONFIRMED |
| D4 | Per-line tax rate for Net Sales (ADR-063) | ❌ | ✅ | ❌ | ❌ | See §4 |
| D5 | Shipping tax split (#2248/#2252) | **?** | ✅ shipping tax stated separately | ⚠️ shipping outside `lineItems.taxes` | **?** | Shopify is the only one where `splitShippingAcrossRates` is unnecessary |
| D6 | Invoice correction driven by a return (#2374) | **?** | ✅ | ⚠️ | **?** | eBay gated by C14 |
| D7 | Fiscal registration (`FiscalizationPort`) | n/a | n/a | n/a | n/a | Channel-independent — eparagony path is unaffected |
| D8 | Execute a refund (`RefundExecutor`, A6) | **?** | ✅ `refundCreate` (`@idempotent` mandatory 2026-04) | 🔴 needs C14 | ✅ | |
| D9 | FX stamping (ADR-040) | ✅ | ✅ | ⚠️ 4 currencies incl. PLN | ✅ | **EBAY: currency is the marketplace default — GBP/EUR/EUR/PLN. The PLN mapping is strongly indicated by the PLN fee schedule but UNCONFIRMED from developer docs** |

### Group R — Returns

| # | Story | AMZ | SHOP | EBAY | TTS | Notes |
|---|---|---|---|---|---|---|
| R1 | Return feed (`ReturnSourceReader.listReturnFeed`) | ⚠️ 🔒 | ✅ | ✅ `return/search` | ✅ `returns/search` | **AMZ is a flat-file/XML REPORT, 60-day window, no cursor, restricted role.** Implementable — the RMA id is the natural `externalReturnId` and `upsertFromSource` already dedupes — but batch-shaped, not a feed |
| R2 | Hydrate one return (`getReturn`) | ⚠️ | ✅ | ✅ | ✅ | |
| R3 | Terminal status vocabulary (`terminalRawStatuses`, #2330) | **?** | **?** | **?** | **?** | Needed by the status-sweep bound for all four |
| R4 | Decline a return (`ReturnDecliner`) | **?** | ✅ `returnDeclineRequest` | ✅ `decide` — **needs C14** | ✅ `returns/{id}/reject` | |
| R5 | Approve / authorize a return | **?** | ✅ `returnApproveRequest` | ✅ `decide` — **needs C14** | ✅ `returns/{id}/approve` | |
| R6 | Mark received (custody, #2367) | ❌ | ✅ reverse deliveries | ✅ `mark_as_received` | **?** | |
| R7 | Refund against a return | **?** | ✅ | ✅ `issue_refund` — **needs C14** | ✅ | |
| R8 | Orphan attribution (#2332) | ✅ RMA carries order | ✅ | ✅ | ✅ | |
| R9 | Return reason vocabulary → `RefundReason` | ✅ reason code | ✅ | 🔴 **changing** | ✅ | **EBAY has announced a new Right of Withdrawal (ROW) reason for EU returns** with an explicit "update your integration to handle unknown enum values safely" warning. OL's `readReturnReason` coercion posture is already right; confirm the value and date |
| R10 | Returns API roadmap risk | ⚠️ | ✅ | 🔴 | ✅ | **EBAY Post-Order v2 is being partially decommissioned through 2026 (Jan 20 / Feb 2 / Mar 2 / Mar 16 waves) with NO named successor**, while eBay simultaneously tells Return Management API users to migrate *to* Post-Order. Real roadmap risk. Post-Order is also **5 000 calls/day per resource** vs Fulfillment's 100 000 — the returns poller must be paced completely differently |

### Group X — Operate

| # | Story | AMZ | SHOP | EBAY | TTS | Notes |
|---|---|---|---|---|---|---|
| X1 | Can the integration be verified in a sandbox? | ⚠️ | ⚠️ | ⚠️ | ❌ | **AMZ:** static canned responses matched on exact parameters; only ~15 APIs are "dynamic" and Orders/Listings are not among them. **EBAY:** no `EBAY_PL`, no shipping labels, no ePID/GTIN matching, no VAT-exempt registration, no trust-and-safety checks (so a listing that publishes in sandbox may be blocked in production). **TTS:** Partner Center's FAQ says UK + Indonesia only; the community SDK says sandbox stopped working entirely at 202309. **All four will need a real production seller account to verify** — the same conclusion Erli (#992) and inFakt reached |
| X2 | Rate-limit observability for the health panel | ⚠️ header may be absent | ✅ every reply | ✅ `getRateLimits` | ❌ no quota API | **AMZ explicitly warns not to depend on `x-amzn-RateLimit-Limit` being present** — back-off must not be header-dependent |
| X3 | Compliance gate before the first production call | 🔒 DPP + security questionnaire | ✅ none for custom apps | 🔒 account-deletion endpoint | 🔒 app review | **SHOP is the only one with no gate**: custom-distribution apps get Protected Customer Data levels 1 and 2 with **no review** |
| X4 | PII retention obligation | 🔴 **30 days** | ⚠️ | **?** | **?** | See §4 |
| X5 | Deprecation clock already running | 🔴 Orders v0 → **2027-03-27** | 🔴 `@idempotent` → **2026-04** | 🔴 Post-Order waves 2026; `ItemMarkedPaid` **2026-06-22**; Trading image upload **2026-09-30** | ⚠️ per-endpoint versions drift independently | Build against the new version from day one in every case |
| X6 | Multi-tenant quota sharing | per (seller, app) | per (app, store) | 🔴 **per app, all tenants** | scales with shop count | **EBAY Taxonomy 5 000/day and Trading 5 000/day are shared across every merchant on one deployment.** Remedy is the Application Growth Check review |

---

## 4. The seven cross-cutting decisions

Each is upstream of implementation and none is an adapter detail.

**1. Connection grain for Amazon and eBay.** §2. Decide before anything else.

**2. Amazon needs a third inbound transport (C13).** `searchOrders` at 0.0056 req/s makes polling-first
impossible, and Amazon delivers only to **SQS or EventBridge — there are no HTTP webhooks**. This inverts
#904's "webhook = trigger, poll = reconciliation backstop": for Amazon the notification is primary and the poll
is a slow safety net. Shape-wise an SQS consumer resembles the existing `MasterDeletionToJobHandler` Redis
Streams loop, but it is new ingress infrastructure alongside `WebhookController` and cron-poll. Per-lane
concurrency tuning buys nothing — the ceiling is Amazon's bucket, not `OL_LANE_BULK_SCOPE_CAP`.

**3. eBay needs RFC 9421 request signing (C14).** Mandatory for **EU/UK-domiciled sellers** — all four target
markets — on `issueRefund`, `Process Return Request` and `Issue Return Refund`. Four headers per call
(`x-ebay-signature-key` JWE, `Content-Digest`, `Signature`, `Signature-Input`), keypairs via the Key Management
API, and **eBay does not store your private key**. Clock skew breaks it (error 215114). This is an HTTP-client-layer
capability with credential storage, it gates the entire returns and refunds story, and **sandbox only exercises it
if the sandbox user's domicile is set to an EU country or GB** — otherwise you ship an untested path.

**4. Three of four channels can never supply a per-line tax rate (O10/D4).** ADR-063 forbids inferring one from
`tax / net`. Shopify gives `TaxLine.rate`; Amazon, eBay and TikTok give amounts only — eBay even *accepts* a rate
at publish and never returns one. These are **permanently rate-less order lines**, which is a property of the
channel, not an OL gap. The rate must come from the shop side of the chain, which means **a marketplace-only
seller with no shop master has no rate source at all**. The tax-coverage detector (#2461/#2469) models "not yet
backfilled", not "this source will never have one" — that is a new category, and it decides whether these orders
can produce a compliant invoice or only a rate-less record.

**5. Amazon's DPP requires PII deleted within 30 days (X4).** Nothing in the tree expires PII —
`order_records.orderSnapshot` is jsonb that can hold an address and no sweep touches it. `OL_STORE_PII=false` is
a different mechanism. Plus monthly vulnerability scans and an **annual penetration test**, which raises a
governance question upstream of code: **for a self-hosted open-source platform, who is the "developer" being
audited?** Private app per operator distributes the burden; one public Appstore app puts it on the project.

**6. Shopify's FulfillmentOrder is a native match for ADR-054 (F6).** Two orthogonal status axes
(`status` × `requestStatus` with `ACCEPTED` / `CANCELLATION_REJECTED`), server-declared `supportedActions`,
work split per location, accept/reject callbacks, and a cancellation the holder may refuse. That is the shape
#2391–#2399 designed, and `DESIGN-oms-authority-model.md` already cites Shopify FulfillmentOrder as its
precedent. No other platform in the tree offers it. Whether that is a headline capability or an implementation
detail is a product call.

**7. eBay brings a real `OfferDeactivator` (S8).** `withdrawOffer` ends a listing and preserves the offer for
`publishOffer` to relist — the capability #1689 deferred because no shipped adapter had one. Promoting it from a
deferred follow-up to a real capability, versus keeping quantity-0 as the universal primitive with eBay as a
special case, is a decision the eBay epic forces.

---

## 5. Probe-first shortlist per platform

The calls to make before writing a line of adapter code. Everything else can follow the shipped Allegro/Woo patterns.

**Amazon**
1. Does `includedData=TAX` on Orders v2026-01-01 carry a **rate** or only amounts? (decides D4)
2. Does `confirmShipment` exist under v2026, or only v0? (F2, and v0 sunsets 2027-03-27)
3. Is Merchant Fulfillment / Buy Shipping available for a **PL** seller at all? (F5)
4. Is there any operation that walks a browse-node tree, or is product-type genuinely the only unit? (T1)
5. Confirm the SP-API developer-fee position — trade press reports it cancelled 2026-05-12 with private apps
   exempt throughout, but **this is not on the official changelog** and it has direct bearing on the
   public-vs-private app decision in §4.5.

**eBay**
1. `bulkUpdatePriceQuantity` — 1 SKU per call or 25? (S2; 25× request-volume difference)
2. Does the REST sandbox accept `marketplaceId: EBAY_PL`? KB 95 is Trading-era and 4 years old. If not,
   **Poland is production-only testing** — uncomfortable for a fiscal-adjacent integration.
3. Does `withdrawOffer` + `publishOffer` re-incur an insertion fee or reset listing age? (decides S8)
4. Stand up the account-deletion endpoint and get the keyset activated (C15) — this blocks *every other probe*.
5. Confirm EBAY_PL's currency is PLN from an actual `getOrders` response.

**Shopify**
1. What does a query for a **deleted** product id return, and can it drive `MasterProductNotFoundError`? (M7)
2. Confirm the admin-custom-app cutoff date — the change is confirmed by shopify.dev but the **1 Jan 2026 date
   rests on secondary sources**.
3. Read `Shop.resourceLimits.maxProductOptions` on a real store rather than assuming 3.
4. Confirm the scope required for the `taxonomy` query (not stated on its reference page).
5. Verify `@idempotent` runtime enforcement against a 2026-04+ version before building any inventory write.

**TikTok Shop**
1. **Is there any usable sandbox for an EU market?** Three sources disagree. Highest-value unknown — it changes
   the shape of the work and who has to be involved, not just the estimate.
2. **What exactly is masked on a PL/FR/DE order, and under which shipping mode?** The only masking changelog
   found is US-specific; GDPR makes EU rules plausibly stricter. Decides D2, and with it whether TikTok Shop
   fits a Polish seller's invoicing workflow at all.
3. Is there a machine-readable "TikTok is VAT-responsible" flag on the order? (D3)
4. Does any per-line tax rate exist that the reachable sources simply do not document? (O10)
5. Is FBT available in Poland? (F5)

---

## 6. Proposed epic shape

Four sibling epics under one programme, sequenced by cost-to-build and by what each unlocks:

| Order | Epic | Why here | Unlocks |
|---|---|---|---|
| 1 | **Shopify** | Richest fit, cleanest docs, no approval gate. The only one that *extends* OL rather than adding a channel | `ProductMaster` #2 in the tree; the first real `FulfillmentExecutor` (ADR-054 validation) |
| 2 | **eBay** | Well-documented, closest to Allegro's shape | `OfferDeactivator` (#1689's deferred capability); RFC 9421 signing seam |
| 3 | **Amazon** | Highest strategic value, highest cost | SQS ingress; PII retention sweep; both reusable |
| 4 | **TikTok Shop** | Cheapest surface, but blocked on two product questions (masked PII, no EU sandbox) | — |

Each epic carries: **one spike doc** (`docs/plans/analysis/SPIKE-<issue>-<platform>-<topic>.md`, following the
SPIKE-2289 structure — Verdict / numbered Evidence table / API surface / Open risks / Recommendation), **one
product spec** (`docs/specs/product-spec-<issue>-<platform>-integration.md`, following
`product-spec-978-erli-marketplace-integration.md` for a marketplace or
`product-spec-872-woocommerce-shop-integration.md` for a shop), and the story rows above as sub-issues.

`.github/ISSUE_TEMPLATE/new_integration.md` already has the right sections (Platform / adapter key
`<platform>.<transport>.v<n>` / vendor API docs / target-capabilities checklist / auth model).
`scripts/create-adapter.mjs --name <x>` scaffolds the package.

**Do not forget:** every new marketplace needs a line in
`apps/web/src/features/mappings/lib/supported-source-platforms.ts` (currently a hardcoded
`['allegro','erli']`) or its order-mapping tabs silently do not render. FE theme tokens
`--channel-amazon` and `--channel-shopify` already exist in `apps/web/src/shared/theme/tokens.ts`.
