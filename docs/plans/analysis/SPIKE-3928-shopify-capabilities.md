# Spike #3928 - Shopify: verdict for every OpenLinker port

> **Work in progress.** Every row below starts as a hypothesis. A row is only a finding once its
> Evidence column says `Live` (verified in this spike) or `Re-confirmed` (a SPIKE-2879 finding
> re-run here). `Inherited` means SPIKE-2879 verified it on API `2026-07` and this spike has not
> re-run it yet; `Desk` means nobody has verified it.

Builds on #2879 / [`SPIKE-2879-shopify-admin-api.md`](./SPIKE-2879-shopify-admin-api.md) (74 of 88
API stories verified live). That spike answered *what the Admin API can do*. This one answers *which
OpenLinker port each of those abilities lands on, and whether it survives the trip through
OpenLinker end to end*. Evidence ids `E-*` below refer to SPIKE-2879; ids `L-*` are this spike's.

## Status

| Part | State |
|---|---|
| Dev-store tooling (`docker/shopify/`) | written, first live run pending |
| Live probes (`L-*`) | not started - waiting for the dev store |
| Prototype adapter (`local/shopify-prototype`, never merged) | not started |
| S1-S4 scenarios | not started |
| S5 (Subiekt GT machine) | deferred until S1-S4 pass |

## Environment

To be filled on the first live run: store domain (redacted), plan, API version (`2026-10`), app
distribution, how the token was obtained, granted scopes (read back from
`currentAppInstallation.accessScopes`, E-C9), throttle budget.

## How to read the matrix

**Verdict**

| Verdict | Meaning |
|---|---|
| **Native** | The Shopify Admin API does it on the port named in the row. |
| **Native, other port** | Shopify does it, but it belongs on a different OpenLinker port than the row's (e.g. a marketplace-shaped capability that a shop expresses through `ProductPublisher`). |
| **Via OL connector** | Shopify cannot; an existing OpenLinker connection covers it (inFakt, KSeF, Subiekt, eparagony, InPost, DPD). |
| **N/A** | The concept does not exist on a shop platform, so there is nothing to implement. |
| **Not possible** | The concept applies but Shopify gives no way to do it. Always cites the evidence. |
| **Open** | Decided by a probe that has not run yet. |

**Roles** (from #3928): **A** master (catalogue + stock), **B** order destination, **C** order
source + returns, **D** publish target, **E** OpenLinker as warehouse/3PL for Shopify.

## Inventory of what is rated

Taken from the code, not from `docs/capabilities.md`, which is out of date: the doc lists 53
sub-capabilities, `libs/core/src/**/domain/ports/capabilities/*.capability.ts` holds **73**. The 20
missing from the doc include `ProductTaxRateReader`, `BulkProductReader`, `BulkInventoryReader`,
`OrderFulfillmentReadback`, `OrderBillingDocumentUploader`/`Linker`, `RefundExecutor`,
`ReturnDecliner`, `ReturnSourceReader`, `ShopProductPriceUpdater`, `CategoryPathReader`,
`TaxonomyIdentityProvider`, `ParcelRequirementsReader`, `ShipmentReferenceReconciler`,
`FulfillmentStatusSource` and `SelfRoutingDocumentKind`. Fixing the doc is a separate change.

Rated below: 12 registry capabilities (`CoreCapabilityValues`) + their base ports, 73
sub-capabilities, and the plugin-level registrations every adapter package makes (connection test,
webhooks, retry and auth classification).

## 1. Base ports (registry capabilities)

| Capability / port | Role | Verdict | Shopify surface | Evidence |
|---|---|---|---|---|
| `ProductMaster` / `ProductMasterPort` | A | Native | `products`, `product(id)` (null = deleted), `productSet` (PATCH semantics), `productDelete` | Inherited E-M1, E-M2, E-P5 |
| `InventoryMaster` / `InventoryMasterPort` | A | Native | `inventoryLevels`, `inventoryAdjustQuantities` (mandatory `@idempotent` + `changeFromQuantity` CAS), `inventorySetQuantities` | Inherited E-M3..E-M6, E-M11 |
| ... deprecated `reserveInventory`/`releaseInventory` | A | Open | Shopify has a `reserved` quantity state and `inventoryMoveQuantities` between states; could express a hold. ADR-061 deprecates the method, so this only matters for a future `MasterReservationWriter` | Desk |
| `OrderSource` / `OrderSourcePort` | C | Native | `orders(query: "updated_at:>…", sortKey: UPDATED_AT)` + opaque cursor; `ORDERS_*` webhooks as trigger | Inherited E-O10, E-C7 |
| `OrderProcessorManager` / `OrderProcessorManagerPort` | B | Native | `orderCreate` with per-line `priceSet` (real marketplace price) and `taxLines`; dev store capped at ~5/min (E-X2). Native dedup key unknown - probe `sourceIdentifier` / `@idempotent` on `orderCreate` | Inherited E-O1, E-O2; dedup Open |
| `OfferManager` / `OfferManagerPort` | D | Native, other port | Shopify is a shop, not a marketplace. The base method (`updateOfferQuantity`) is the WooCommerce precedent: base-port-only stock write-back to published products, reached through `ShopProduct` mappings | Desk |
| `ProductPublisher` / `ShopProductManagerPort` | D | Native | `productSet` with options/variants/media; `getDescriptionFormat` must be OL-declared because Shopify sanitizes nothing (E-P2) | Inherited E-P2, E-P5, E-P6 |
| `CategoryProvisioner` | D | Open | Shopify's Standard Product Taxonomy is read-only (E-T3). A shop "category" an operator recognises is a **collection** (`collectionCreate`) or `productType`. Decide which concept OL maps to | Inherited E-T3, E-T5 |
| `Invoicing` / `InvoicingPort` | B, C | Via OL connector | No VAT invoice issuance in the Admin API (`draftOrderInvoiceSend` is a payment request, not a fiscal document). Polish invoices come from inFakt / KSeF / Subiekt / eparagony; Shopify only receives a link (see `OrderBillingDocumentLinker`) | Desk - L-probe: schema scan for invoice/document mutations |
| `Fiscalization` / `FiscalizationPort` | C | Via OL connector | No fiscal registration API for Poland. eparagony covers it | Desk - same schema scan |
| `ShippingProviderManager` / `ShippingProviderManagerPort` | B, C, E | Via OL connector | Shopify Shipping labels are bought in the admin, not through the public API. Labels come from InPost / DPD | Desk - L-probe: schema scan for label/shipping-label mutations |
| `FulfillmentExecutor` / `FulfillmentExecutorPort` | E | Open | Two readings. (1) OpenLinker as Shopify's fulfillment service: Shopify sends fulfillment requests to an OL-owned fulfillment-service location, OL accepts and fulfils - Shopify is then an order source and OL-OMS is the executor. (2) A Shopify merchant location as an executor for orders from other channels. (1) is what role E means | Inherited E-F1, E-F5, E-F10 |
| `ReturnsAuthority` (no port) | C | Open | `returnApproveRequest` / `returnDeclineRequest` / `returnProcess` with dispositions exist; whether OL or Shopify decides disposition is a config choice (ADR-052 A5) | Inherited E-R1..E-R11 |

## 2. Products and inventory sub-capabilities

| Sub-capability | Role | Verdict | Shopify surface | Evidence |
|---|---|---|---|---|
| `ModifiedProductLister` | A | Open | `products(query: "updated_at:>…")` works (E-M10). Must check whether a **variant** edit and a **stock** change bump the product's `updatedAt` - WooCommerce's does not (WC #19562), PrestaShop's does not either | Inherited E-M10; variant/stock bump Open |
| `BulkProductReader` | A | Native | `nodes(ids: [...])` batch read, or `bulkOperationRunQuery` (JSONL, ~3s for 43 objects) | Inherited E-M12 |
| `ProductTaxRateReader` | A | Open | No per-variant rate exists (`taxable` boolean only, E-M8). Shopify computes tax from region settings + overrides. Probe whether the effective PL rate per product is readable at all (tax overrides on collections, `shop.taxesIncluded`) | Inherited E-M8 |
| `BulkInventoryReader` | A | Native | `inventoryItems` / `inventoryLevels` with location filter, or a bulk operation | Desk |

## 3. Listings sub-capabilities

Shopify is a shop, so most marketplace-shaped `OfferManagerPort` sub-capabilities are N/A or move
to `ProductPublisher`.

| Sub-capability | Role | Verdict | Shopify surface | Evidence |
|---|---|---|---|---|
| `OfferLister` | D | Native, other port | `products` list; on a shop it is the published-product list | Desk |
| `OfferReader` | D | Native, other port | `product(id)` | Inherited E-M1 |
| `OfferEventReader` | D | N/A | No marketplace offer-event journal; product webhooks are the shop equivalent | Desk |
| `OfferCreator` | D | Native, other port | `productSet` through `ProductPublisher` | Inherited E-P6 |
| `OfferFieldUpdater` | D | Native, other port | `productUpdate` (description, SEO) | Inherited E-S5 |
| `OfferStatusReader` | D | Native, other port | `ProductStatus` `ACTIVE/ARCHIVED/DRAFT/UNLISTED` + `publishedAt` per publication | Inherited E-S3, E-S9 |
| `OfferStockRestorer` | D | N/A | OpenLinker writes absolute quantities; Shopify restocks a cancelled order itself (`orderCancel(restock: true)`) | Desk |
| `OfferQuantityBatchUpdater` | D | Native | `inventorySetQuantities` takes many items in one call | Desk |
| `PendingQuantityAckReconciler` | D | N/A | Quantity writes are acknowledged synchronously | Desk |
| `OfferSmartClassificationReader` | D | N/A | Allegro-only concept | Desk |
| `CategoryBrowser` | D | Native | `taxonomy.categories` (`childrenOf` / `descendantsOf` flattens the whole subtree, E-T9) + `search` | Inherited E-T1, E-T6, E-T9 |
| `CategoryBarcodeMatcher` | D | Not possible | No global product catalogue keyed by EAN | Desk |
| `CategoryParametersReader` | D | Native | `TaxonomyCategory.attributes` with paginated values | Inherited E-T2, E-T7 |
| `CategoryPathReader` | D | Native | `TaxonomyCategory.fullName` + `ancestorIds` | Inherited E-T1b |
| `EanCategoryMatcher` | D | Not possible | As `CategoryBarcodeMatcher` | Desk |
| `EanCategoryMatcherStreaming` | D | Not possible | As `CategoryBarcodeMatcher` | Desk |
| `CatalogProductReader` | D | Not possible | No shared catalogue | Desk |
| `SellerPoliciesReader` | D | Open | `shop.shopPolicies` returns refund/shipping/privacy policy **texts**; not the same thing as Allegro's policy ids | Desk |
| `ResponsibleProducerReader` | D | Not possible | No GPSR entity; only free-form metafields | Desk |
| `SafetyAttachmentUploader` | D | Not possible | As above; files can be uploaded but nothing models them as GPSR attachments | Desk |
| `TaxonomyBorrower` | D | N/A | Shopify owns its taxonomy | Desk |
| `TaxonomyIdentityProvider` | D | Native | One global Shopify taxonomy, versioned; declares `'shopify'` | Desk |
| `OfferCurrencyDeclarer` | D | Native, other port | `shop.currencyCode` - belongs on `ShopCurrencyDeclarer` | Desk |
| `AdapterSuppliedParametersReader` | D | Open | Depends on whether `category` attributes are filled by the adapter (Shopify "category metafields") | Desk |
| `DeliveryPriceListReader` | D | Open | `deliveryProfiles` describe shipping rates; check whether it fits the shape this capability expects | Desk |
| `ShopCategoryBrowser` | D | Native | Taxonomy categories or collections, depending on the `CategoryProvisioner` decision | Inherited E-T5 |
| `ShopAttributeReader` | D | Native | Taxonomy attributes + metafield definitions | Inherited E-T2 |
| `ShopProductStatusReader` | D | Native | `product.status` + per-variant | Inherited E-S3 |
| `ShopCurrencyDeclarer` | D | Native | `shop.currencyCode`. Would be the first shop adapter to implement it | Desk |
| `ShopProductPriceUpdater` | D | Native | `productVariantsBulkUpdate` (no `@idempotent` needed) | Inherited E-S2 |

## 4. Orders and returns sub-capabilities

| Sub-capability | Role | Verdict | Shopify surface | Evidence |
|---|---|---|---|---|
| `OrderFulfillmentUpdater` | B | Native | `fulfillmentCreate` with `trackingInfo` (needs `write_merchant_managed_fulfillment_orders`) | Inherited E-F4, E-F6 |
| `OrderStatusWriteback` | C | Native | `fulfillmentCreate` (dispatched), `orderCancel` (async job, E-O3), `orderClose`; `delivered` via fulfillment events (`fulfillmentEventCreate`) - probe | Inherited E-O3; delivered Open |
| `FulfillmentStatusReader` | B | Native | `order.displayFulfillmentStatus` (10 values) + `fulfillmentOrders` | Inherited E-O9 |
| `DestinationOptionsReader` | B | Open | Order statuses are closed enums (not shop-defined); carriers are free text with a documented known-company list; payment methods are gateway names. Partial at best | Inherited E-O5, E-O9 |
| `SourceOptionsReader` | C | Open | Delivery methods: shipping-line titles/codes + `deliveryProfiles`; payment: `paymentGatewayNames` | Inherited E-O6 |
| `OrderCreateStockEffect` | B | Native | The caller chooses: `orderCreate(options: {inventoryBehaviour: BYPASS / DECREMENT_IGNORING_POLICY / DECREMENT_OBEYING_POLICY})`. The adapter can answer truthfully from what it sent | Desk - verify with the seed |
| `OrderContactRefresher` | B | Native | `orderUpdate` (email, phone, shipping address) | Desk |
| `OrderFulfillmentReadback` | B, C | Native | `order.fulfillments { trackingInfo }` | Inherited E-F6 |
| `OrderBillingDocumentUploader` | C | Open | No order-attachment API. Candidates: Files API (`stagedUploadsCreate` + `fileCreate`) + an order metafield of type `file_reference`; shown to the buyer only through a customer-account extension | Desk |
| `OrderBillingDocumentLinker` | C | Open | Order metafield (URL type) or order note; buyer visibility as above | Inherited E-S7 (metafields work) |
| `RefundExecutor` | C | Native | `returnProcess` for return-driven refunds, `refundCreate` (`@idempotent`) otherwise; A6 refund authority stays OpenLinker's (ADR-056) | Inherited E-D1, E-R8, E-R9 |
| `ReturnDecliner` | C | Native | `returnDeclineRequest` | Desk |
| `ReturnSourceReader` | C | Open | Returns hang off orders (`order.returns`); no top-level return feed - probe whether `orders(updated_at)` moves when a return changes | Inherited E-R1, E-R5 |

## 5. Shipping sub-capabilities

All shipping work is done by the carrier connectors OpenLinker already has. Shopify's part is
receiving the tracking number (`OrderFulfillmentUpdater`) and the pickup point the buyer chose
(`DeliveryMethodType.PICKUP_POINT`, E-O6).

| Sub-capability | Role | Verdict | Evidence |
|---|---|---|---|
| `LabelDocumentReader` | B, C | Via OL connector (InPost, DPD) | Desk |
| `DispatchProtocolReader` | B, C | Via OL connector | Desk |
| `PickupPointFinder` | B, C | Via OL connector; Shopify only stores the chosen point - probe what an order carries for `PICKUP_POINT` (point id or just an address) | Inherited E-O6 |
| `ShipmentCanceller` | B, C | Via OL connector | Desk |
| `ParcelRequirementsReader` | B, C | Via OL connector | Desk |
| `ShipmentReferenceReconciler` | B, C | Via OL connector | Desk |

## 6. Fulfillment sub-capabilities

| Sub-capability | Role | Verdict | Shopify surface | Evidence |
|---|---|---|---|---|
| `FulfillmentStatusSource` | E | Open | If Shopify is the executor: `fulfillmentOrder.status` + `requestStatus` (two axes, near-verbatim ADR-054 vocabulary) | Inherited E-F1, E-F5 |
| `FulfillmentRouter` (port) | E | Open | Shopify's own order routing assigns fulfillment orders to locations; whether its rules are readable or writable through the API is unknown | Desk |

## 7. Invoicing sub-capabilities

Shopify issues no fiscal documents, so every invoicing sub-capability is a property of the
invoicing connection paired with a Shopify order source, not of Shopify. Rows kept so the matrix
is complete.

| Sub-capability | Verdict |
|---|---|
| `RegulatoryStatusReader`, `RegulatoryTransmitter`, `RegulatoryResubmitter`, `RegulatoryDocumentReader`, `RegulatoryVerificationLinkReader`, `RegulatoryRecordLocator`, `OfflineResubmitter` | Via OL connector (KSeF, inFakt, eparagony) |
| `CorrectionIssuer`, `BuyerIdentityCorrector`, `DocumentNumberConsumer` | Via OL connector |
| `BankAccountsReader`, `BankAccountDefaultSetter`, `PaymentStatusReader`, `PaymentMarker`, `InvoiceEmailSender` | Via OL connector |
| `SelfRoutingDocumentKind` (sales-documents) | N/A - Shopify does not fiscalize at the point of sale for PL |

What Shopify **does** have to supply for a correct document, to verify live:

- the buyer tax id: **no native field** (E-O8). Candidates: B2B company location tax settings, order
  metafield, checkout note attribute. Decides whether `buyerTaxId` can ever be asserted for a
  Shopify order;
- per-line tax rate on the order: native (`LineItem.taxLines`, E-O1, E-D4);
- shipping tax separately (E-D2);
- payment method: gateway names, no closed vocabulary - map to `PaymentMethod` (#3294) only where
  the gateway is identifiable (`Cash on Delivery (COD)`, `manual`, bank transfer).

## 8. Fiscalization sub-capabilities

| Sub-capability | Verdict |
|---|---|
| `FiscalRegistrationLocator`, `ReceiptLineNameBudget` | Via OL connector (eparagony) |

## 9. Plugin-level registrations

| Registration | Verdict | Shopify surface | Evidence |
|---|---|---|---|
| `ConnectionTester` | Native | `shop { name currencyCode }` + `currentAppInstallation.accessScopes` (reports missing scopes) | Inherited E-C9 |
| Connection config / credentials shape validators | Native | Store domain, API version, token or client id/secret | Desk |
| `OAuthCompletion` | Open | Needed only if the connection is installed through OAuth rather than client credentials | Inherited E-C3 |
| `ConnectionCredentialsRewriter` | Open | Client-credentials tokens expire after about 24 h (shopify.dev, client credentials); the adapter re-mints from the stored id/secret, so nothing is rewritten. Needed only for the authorization-code path (non-expiring offline token) | Desk (doc) |
| `WebhookProvisioning` | Native | `webhookSubscriptionCreate` | Inherited E-C7 |
| `InboundWebhookDecoder` | Open | `X-Shopify-Hmac-Sha256` = base64 HMAC-SHA256 of the raw body with the app secret; verify live | Desk |
| `WebhookEventTranslator` | Native | Topic header `X-Shopify-Topic` -> domain | Desk |
| `RetryClassifier` | Native | Cost throttle (`THROTTLED`) + the dev-store `"Too many attempts"` userError, which is neither a 429 nor visible in `throttleStatus` | Inherited E-C4, E-X2 |
| `AuthFailureClassifier` | Native | 401 / `Invalid API key or access token` | Desk |
| `CustomerIdentityResolver` input | Native | `order.customer` (needs `read_customers`), `order.email` | Inherited E-O7 |
| `EmailNormalizer` | N/A | Shopify does not mask buyer email | Desk |
| `OrderLabelVoider` | N/A | No labels | Desk |

## Scenarios

| # | Configuration | Roles | Status | Run log |
|---|---|---|---|---|
| S1 | Shopify as master: catalogue + stock -> Allegro sandbox offers -> Allegro order into Shopify at the marketplace price -> invoice (inFakt / KSeF) or receipt (eparagony) -> InPost label -> tracking + status to Allegro -> stock sync | A, B | not started | - |
| S2 | PrestaShop or WooCommerce master -> publish to Shopify -> Shopify order into the master -> return | C, D | not started | - |
| S3 | Shopify order -> OL-OMS routing + pack bench -> OL label -> fulfillment + tracking to Shopify | E | not started | - |
| S4 | Shopify as master and order source -> document -> label -> tracking back; own-shop routing guard (#3487) | A, C | not started | - |
| S5 | Subiekt GT master, Shopify as channel (GT bridge machine) | C | deferred | - |

## Live transcripts

None yet.

## Open risks

Carried from SPIKE-2879 (not re-verified yet): mandatory `@idempotent` is not a replay cache
(E-M6); dev-store `orderCreate` cap reports as a userError (E-X2); `descriptionHtml` is not
sanitized (E-P2); return reasons are an open catalogue (E-R4); `RESTOCKED` disposition does not move
stock (E-R10); `read_all_orders` needs manual review (E-C6).

New, to resolve here:

1. **Order dedup on `orderCreate`.** Without a native idempotency key a retried create makes a second
   order (the Shoper finding). Probe `@idempotent` on `orderCreate` and lookup by `sourceIdentifier`.
2. **Buyer tax id has no home** (E-O8). Decides B2B invoicing for Shopify-sourced orders.
3. **Product `updatedAt` vs variant and stock edits.** Decides whether `ModifiedProductLister` can be
   declared at all.
4. **Category concept.** Taxonomy (read-only, global) vs collections (shop-owned) vs `productType`
   (free text) - decides `CategoryProvisioner` and the mapping UI.
5. **Effective tax rate per product.** Decides whether a Shopify master can satisfy ADR-063 (the
   rate is an input, never computed) or every Shopify-master document holds.
