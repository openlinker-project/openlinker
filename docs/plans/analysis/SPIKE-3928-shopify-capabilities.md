# Spike #3928 - Shopify: verdict for every OpenLinker port

> Evidence column: `Live` = verified in this spike (probe or the prototype adapter running inside
> OpenLinker), `Re-confirmed` = a SPIKE-2879 finding re-run here, `Inherited` = SPIKE-2879 verified
> it on API `2026-07` and this spike did not re-run it, `Desk` = nobody has verified it.

Builds on #2879 / [`SPIKE-2879-shopify-admin-api.md`](./SPIKE-2879-shopify-admin-api.md) (74 of 88
API stories verified live). That spike answered *what the Admin API can do*. This one answers *which
OpenLinker port each of those abilities lands on, and whether it survives the trip through
OpenLinker end to end*. Evidence ids `E-*` below refer to SPIKE-2879; ids `L-*` are this spike's.

## Summary

**Verdict: Shopify can be an OpenLinker integration in every role it was tested in.** A throwaway
adapter (`local/shopify-prototype`, never merged) ran inside a real OpenLinker stack against a live
dev store, an Allegro sandbox seller, InPost, inFakt and eparagony sandboxes, and a local PrestaShop.

| Role | What was proven end to end | Result |
|---|---|---|
| A master | catalogue, variants, EAN, gross prices and stock from Shopify into OL, stock out to Allegro | Works (S1) |
| B order destination | Allegro order created in Shopify at the marketplace price, stock committed, dispatch + InPost tracking written back | Works (S1) |
| C order source + returns | Shopify order into PrestaShop to the grosz, return ingested, received and restocked in the master | Works (S2) |
| D publish target | PrestaShop products published to Shopify (simple + variants), stock pushed back on every change | Works, with a parent race on concurrent sibling publishes (L-S2b) (S2) |
| E OpenLinker as warehouse | Shopify order routed to the OL pack bench, master stock lowered, fulfillment + InPost tracking back to Shopify | Works (S3) |
| Shopify alone | Shopify-own orders get no automatic documents | Blocked by core, not by Shopify (#3959) (S4) |

**Shopify cannot**, and OpenLinker covers it: invoices and receipts (inFakt, KSeF, eparagony), Polish
labels (InPost, DPD), a tax rate on products (orders do carry one, L-S4a), a locker id on orders
(L-O6).

**What the production adapter needs** (sized from the prototype):

1. Base ports: ProductMaster, InventoryMaster (one location, decision 2026-11-04), OrderSource,
   OrderProcessorManager, ProductPublisher + CategoryProvisioner (collections), OfferManager
   (stock write-back), each as built in the prototype.
2. Sub-capabilities that mattered live: `OrderStatusWriteback` on BOTH the source and the
   destination adapter (L-S3c), `OrderFulfillmentUpdater` with an explicit tracking URL (L-F3),
   `ReturnSourceReader` with the lap feed (L-S2m), `OrderCreateStockEffect`, and
   `SourceOptionsReader.listDeliveryMethods` so carrier routing rules can be set from the UI (L-S3d).
3. Order dedup on create is OpenLinker's job (`orderCreate` has no idempotency, L-O3/L-O4).
4. A per-group lock around "resolve or create the parent" for multi-variant publish (L-S2b).
5. Webhooks need a public URL; without one everything runs on polling with a 30 s settle window
   for the search index lag (L-M1, L-S2j).

**Issues filed from this spike**

| Issue | What |
|---|---|
| #3958 | OMS setup wizard should offer automatic label purchase (`autoDispatch`, #3340) |
| #3959 | A shop that is its own only destination never gets automatic sales documents (L-O7) |
| #3960 | A rejected fiscal receipt cannot be registered again (L-S1e) |

**Not done here:** S5 (Subiekt GT as master, needs the bridge machine), live check of the webhook
HMAC (needs a public URL), Shopify Payments / refunds through Shopify, courier labels (the InPost
sandbox org has no courier agreement, L-S3e).

## Status

| Part | State |
|---|---|
| Dev-store tooling (`docker/shopify/`) | live: seeded a fresh store end to end, second run idempotent (2026-11-04) |
| Live probes (`L-*`) | done for every open risk; findings below |
| Prototype adapter (`local/shopify-prototype`, never merged) | ProductMaster, InventoryMaster, OrderSource, OrderProcessorManager; running in stack `ol-shopify` |
| S1-S4 scenarios | S1, S2, S3 done; S4 blocked by core (L-O7). Run 2 of the open cases: [SPIKE-3928-run2-evidence.md](./SPIKE-3928-run2-evidence.md) |
| S5 (Subiekt GT machine) | deferred until S1-S4 pass |

## Environment

Dev store `{shop-domain}.myshopify.com`, country Poland, store currency **PLN**, prices include
tax (`shop.taxesIncluded: true`). Plan reported as `"Shopify Plus App Development"`
(`partnerDevelopment: true`). App created in the Dev Dashboard (2026-11-04), Admin API `2026-10`,
which is the newest stable version that day (`publicApiVersions`: `2026-01`..`2026-10`
supported, `2027-01` and `unstable` not). All 32 requested scopes granted, read back from
`currentAppInstallation.accessScopes`.

**Token: client-credentials grant, no OAuth.** `POST /admin/oauth/access_token` with
`grant_type=client_credentials` + client id/secret returns an Admin API token, because the app
and the dev store are in the same organization. Before the app was installed on the store the
same call answered HTTP 400 `Oauth error app_not_installed`. SPIKE-2879 used the authorization-code
flow instead (E-C3). The token is short-lived (about 24 h per shopify.dev), so the tooling mints
one per run.

Throttle budget: `maximumAvailable: 20000`, `restoreRate: 1000` - five times what SPIKE-2879's
dev store reported (E-C4: 4000 / 200). Budget follows the plan, so production figures must be
read from `throttleStatus`, never assumed.

## Decisions taken during the spike

| Date | Decision | Consequence |
|---|---|---|
| 2026-11-04 | **One warehouse.** OpenLinker runs as a single warehouse until a WMS integration exists; multi-location support comes with the WMS | The connection names ONE Shopify location (`locationId`, default the primary location). Stock is read and written at that location only, never summed across locations. Because Shopify's own order routing may assign a fulfillment order elsewhere (L-O1), an order OpenLinker creates is moved to that location after `orderCreate`. Multi-location verdicts below (E-M7, `fulfillmentOrderMove` between locations) stay documented as available, not used |

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
| `ProductMaster` / `ProductMasterPort` | A | Native | `products`, `product(id)` (null = deleted), `productSet` (PATCH semantics), `productDelete` | **Live** L-P1 (prototype, S1); Inherited E-M1, E-M2, E-P5 |
| `InventoryMaster` / `InventoryMasterPort` | A | Native | `inventoryLevels`, `inventoryAdjustQuantities` (mandatory `@idempotent` + `changeFromQuantity` CAS), `inventorySetQuantities`. Scoped to the ONE configured location (decision 2026-11-04) | **Live** L-I1, L-S1c (prototype, S1) |
| ... deprecated `reserveInventory`/`releaseInventory` | A | Open | Shopify has a `reserved` quantity state and `inventoryMoveQuantities` between states; could express a hold. ADR-061 deprecates the method, so this only matters for a future `MasterReservationWriter` | Desk |
| `OrderSource` / `OrderSourcePort` | C | Native | `orders(query: "updated_at:>…", sortKey: UPDATED_AT)` + opaque cursor; `ORDERS_*` webhooks as trigger | **Live** L-S2g, L-S2j, L-S3b (prototype, S2/S3) |
| `OrderProcessorManager` / `OrderProcessorManagerPort` | B | Native, **no native dedup** | `orderCreate` with per-line `priceSet` (real marketplace price) and `taxLines`; dev store capped at ~5/min. `@idempotent` is not supported on `orderCreate` and a repeated `sourceIdentifier` creates a second order; `source_identifier:` lookup works but only ~10 s after the write | **Live** L-S1a, L-S1h (prototype, S1); L-O3, L-O4 |
| `OfferManager` / `OfferManagerPort` | D | Native, other port | Shopify is a shop, not a marketplace. The base method (`updateOfferQuantity`) is the WooCommerce precedent: base-port-only stock write-back to published products, reached through `ShopProduct` mappings | **Live** L-S2l (prototype, S2) |
| `ProductPublisher` / `ShopProductManagerPort` | D | Native | `productSet` with options/variants/media; `getDescriptionFormat` must be OL-declared because Shopify sanitizes nothing (E-P2) | **Live** L-S2a, L-S2b, L-S2e (prototype, S2) |
| `CategoryProvisioner` | D | Native, via collections | The Standard Product Taxonomy stays read-only (E-T3), but `collectionCreate` + `collectionAddProductsV2` give a shop-owned grouping that is visible on the product at once (the add is an async job, membership already readable). Recommended mapping: OL category placement -> collections; `product.category` (taxonomy) is a separate, optional field for search/attributes | **Live** L-T3 |
| `Invoicing` / `InvoicingPort` | B, C | Via OL connector | Full schema scan (483 mutations): nothing issues a fiscal document. `orderInvoiceSend` / `draftOrderInvoiceSend` email a **payment request**, not a VAT invoice. Polish invoices come from inFakt / KSeF / Subiekt / eparagony; Shopify only receives a link (see `OrderBillingDocumentLinker`) | **Live** L-D1, L-S1h (inFakt invoice for a Shopify-master order) |
| `Fiscalization` / `FiscalizationPort` | C | Via OL connector | Schema scan: no `fiscal*` / `receipt*` mutation (only Shop Pay payment-request receipts). eparagony covers it | **Live** L-D1, L-S1f (eparagony receipts 16370, 16377) |
| `ShippingProviderManager` / `ShippingProviderManagerPort` | B, C, E | Via OL connector (for PL) | **Correction:** `shippingLabelPurchase` + `shippingLabel` exist (async, `PENDING_PURCHASE -> PURCHASED / PURCHASE_FAILED`), but only through Shopify Shipping, which needs its terms accepted in the admin and is offered for US, CA, AU, UK, FR, IT, ES fulfilment locations - not Poland. Labels for PL come from InPost / DPD | **Live** L-S1, L-S1g, L-S3f (InPost labels, tracking to Shopify) |
| `FulfillmentExecutor` / `FulfillmentExecutorPort` | E | Native, **no callback URL needed** | OpenLinker as Shopify's fulfillment service: register the service (no `callbackUrl`), move the fulfillment order to its location, poll `assignedFulfillmentOrders(assignmentStatus: FULFILLMENT_REQUESTED)`, then `fulfillmentOrderAcceptFulfillmentRequest` and `fulfillmentCreate`. `FULFILLMENT_ORDERS_FULFILLMENT_REQUEST_SUBMITTED` webhook is the push alternative. The two axes moved as ADR-054 expects (`OPEN/UNSUBMITTED -> SUBMITTED -> IN_PROGRESS/ACCEPTED -> FULFILLED`) | **Live** L-F2; Inherited E-F1, E-F5, E-F10 |
| `ReturnsAuthority` (no port) | C | Open | `returnApproveRequest` / `returnDeclineRequest` / `returnProcess` with dispositions exist; whether OL or Shopify decides disposition is a config choice (ADR-052 A5) | Inherited E-R1..E-R11 |

## 2. Products and inventory sub-capabilities

| Sub-capability | Role | Verdict | Shopify surface | Evidence |
|---|---|---|---|---|
| `ModifiedProductLister` | A | Native, **with a union** | A stock change bumps `product.updatedAt` (and variant + level); a **variant price edit bumps only `variant.updatedAt`**, not the product. So the rung is `products(updated_at)` UNION `productVariants(updated_at)`, with a lookback longer than the ~10 s `updatedAt` lag. Better than WooCommerce and PrestaShop, which cannot see variant edits at all | **Live** L-M2 |
| `BulkProductReader` | A | Native | `nodes(ids: [...])` batch read, or `bulkOperationRunQuery` (JSONL, ~3s for 43 objects) | Inherited E-M12 |
| `ProductTaxRateReader` | A | Not possible | No rate exists anywhere in the Admin API: variants carry only `taxable`, the shop only `taxesIncluded` / `taxShipping`, and no query lists tax rates. Shopify computes tax per region at checkout. A Shopify master therefore cannot state a catalogue rate (ADR-063); options are a per-connection default rate, a product metafield the merchant fills, or reading the rate back from order `taxLines` (role C only) | **Live** L-T2 (schema scan) |
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
| `OrderFulfillmentUpdater` | B | Native | `fulfillmentCreate` with `trackingInfo` (needs `write_merchant_managed_fulfillment_orders`) | **Live** L-S1g (prototype, S1) |
| `OrderStatusWriteback` | C | Native | `fulfillmentCreate` (dispatched), `orderCancel` (async job, E-O3), `orderClose`; `delivered` via fulfillment events (`fulfillmentEventCreate`) - probe | **Live** L-S1g (destination), L-S3c, L-S3f (source); delivered Open |
| `FulfillmentStatusReader` | B | Native | `order.displayFulfillmentStatus` (10 values) + `fulfillmentOrders` | Inherited E-O9 |
| `DestinationOptionsReader` | B | Open | Order statuses are closed enums (not shop-defined); carriers are free text with a documented known-company list; payment methods are gateway names. Partial at best | Inherited E-O5, E-O9 |
| `SourceOptionsReader` | C | Open | Delivery methods: shipping-line titles/codes + `deliveryProfiles`; payment: `paymentGatewayNames` | Inherited E-O6 |
| `OrderCreateStockEffect` | B | Native | The caller chooses: `orderCreate(options: {inventoryBehaviour: BYPASS / DECREMENT_IGNORING_POLICY / DECREMENT_OBEYING_POLICY})`. The adapter can answer truthfully from what it sent | **Live** L-O1, L-S1a |
| `OrderContactRefresher` | B | Native | `orderUpdate` (email, phone, shipping address) | Desk |
| `OrderFulfillmentReadback` | B, C | Native | `order.fulfillments { trackingInfo }` | Inherited E-F6 |
| `OrderBillingDocumentUploader` | C | Open | No order-attachment API. Candidates: Files API (`stagedUploadsCreate` + `fileCreate`) + an order metafield of type `file_reference`; shown to the buyer only through a customer-account extension | Desk |
| `OrderBillingDocumentLinker` | C | Open | Order metafield (URL type) or order note; buyer visibility as above | Inherited E-S7 (metafields work) |
| `RefundExecutor` | C | Native | `returnProcess` for return-driven refunds, `refundCreate` (`@idempotent`) otherwise; A6 refund authority stays OpenLinker's (ADR-056) | Inherited E-D1, E-R8, E-R9 |
| `ReturnDecliner` | C | Native | `returnDeclineRequest` | Desk |
| `ReturnSourceReader` | C | Native, with a different feed | A return does **not** bump `order.updatedAt` (L-R1) and there is no top-level returns query, so the order feed cannot discover returns. Discovery = `RETURNS_*` webhooks (request, approve, process, decline, close, cancel, reopen, update) as trigger + `orders(query: "return_status:in_progress")` as backstop; `getReturn` = `return(id)` | **Live** L-S2m, L-S2o (prototype, S2) |

## 5. Shipping sub-capabilities

All shipping work is done by the carrier connectors OpenLinker already has. Shopify's part is
receiving the tracking number (`OrderFulfillmentUpdater`) and the pickup point the buyer chose
(`DeliveryMethodType.PICKUP_POINT`, E-O6).

| Sub-capability | Role | Verdict | Evidence |
|---|---|---|---|
| `LabelDocumentReader` | B, C | Via OL connector (InPost, DPD) | Desk |
| `DispatchProtocolReader` | B, C | Via OL connector | Desk |
| `PickupPointFinder` | B, C | Via OL connector (InPost) | Shopify has no locker id anywhere: `DeliveryMethod` carries only `methodType` (`PICKUP_POINT`), `presentedName`, `serviceCode`, `instructions`, `phone`. A checkout pickup-point app writes the point's address as the shipping address; the locker code must be parsed from the shipping-line title/code or stored by OL as an order attribute/metafield | **Live** L-O6 (schema) |
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

- the buyer tax id: **only on B2B orders** (L-O5). A company location carries
  `taxSettings.taxRegistrationId`, and an order placed on that location exposes it as
  `order.purchasingEntity.location.taxSettings.taxRegistrationId`. B2B is a Shopify Plus feature,
  so on a standard plan the order has no tax-id home at all (E-O8) and the source must report
  "not asserted", never "asserted none". It is the location's **current** value, not one frozen
  on the order, so it must be frozen at ingestion (ADR-073 shape);
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
| `ConnectionTester` | Native | `shop { name currencyCode }` + `currentAppInstallation.accessScopes` (reports missing scopes) | **Live** L-P1 |
| Connection config / credentials shape validators | Native | Store domain, API version, token or client id/secret | **Live** (prototype connection created and patched) |
| `OAuthCompletion` | Open | Needed only if the connection is installed through OAuth rather than client credentials | Inherited E-C3 |
| `ConnectionCredentialsRewriter` | Open | Client-credentials tokens expire after about 24 h (shopify.dev, client credentials); the adapter re-mints from the stored id/secret, so nothing is rewritten. Needed only for the authorization-code path (non-expiring offline token) | Desk (doc) |
| `WebhookProvisioning` | Native | `webhookSubscriptionCreate` accepts any HTTPS URI with no domain check (unlike the fulfillment-service callback, L-F1), supports a search `filter` and `includeFields`, and also Pub/Sub / EventBridge URIs | **Live** L-C4; Inherited E-C7 |
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
| S1 | Shopify as master: catalogue + stock -> Allegro sandbox offers -> Allegro order into Shopify at the marketplace price -> invoice (inFakt / KSeF) or receipt (eparagony) -> InPost label -> tracking + status to Allegro -> stock sync | A, B | done (receipt for the Kubek line blocked by the sandbox printer, L-S1e) | L-S1a to L-S1h |
| S2 | PrestaShop or WooCommerce master -> publish to Shopify -> Shopify order into the master -> return | C, D | done (parent race L-S2b open) | L-S2a to L-S2o |
| S3 | Shopify order -> OL-OMS routing + pack bench -> OL label -> fulfillment + tracking to Shopify | E | done | L-S3a to L-S3f |
| S4 | Shopify as master and order source -> document -> label -> tracking back; own-shop routing guard (#3487) | A, C | blocked by core (L-O7 / L-S4b) | L-S4a to L-S4c |
| S5 | Subiekt GT master, Shopify as channel (GT bridge machine) | C | deferred | - |

## Live findings (this spike)

| Id | Finding | Consequence for the adapter |
|---|---|---|
| L-C1 | Client-credentials grant works for an app and dev store in the same organization; `app_not_installed` until the app is installed from the Dev Dashboard | A merchant-owned connection can be set up with just client id + secret; no redirect endpoint needed. A store in another org needs the authorization-code flow |
| L-C2 | Throttle budget on this plan is 20000 / 1000 per s, not 4000 / 200 | Read `throttleStatus`; never hard-code a budget |
| L-M1 | The `query:` search index (`products`, `productVariants`, `orders`) is **eventually consistent**: seconds after a write it returns a partial, shifting set (`sku:OL-SEED-*` returned 3 of 10, then a different 3) | Never resolve an id by search right after writing it. Use the id from the mutation response or `productByIdentifier` (direct read). Matters for identifier mapping and for dedup lookups |
| L-F1 | `fulfillmentServiceCreate.callbackUrl` is **optional** on `2026-10` (required on `2026-07`, E-F2); a URL outside the app's own URL domain is refused: `"Callback url is not allowed"` | Role E needs a public OpenLinker URL under the app's domain before Shopify can send fulfillment requests |
| L-O1 | `orderCreate(options: {inventoryBehaviour: DECREMENT_OBEYING_POLICY})` commits stock (`committed` +1) at a location chosen by **Shopify's routing**, not the caller | `OrderCreateStockEffect` can answer `true`; which location was hit must be read back, not assumed |
| L-O2 | `orderCreate` accepts a `PENDING` transaction on gateway `"Cash on Delivery (COD)"` (shows in `paymentGatewayNames`); `orderCancel(refund: false)` leaves `displayFinancialStatus: PAID` and fulfillment `FULFILLMENT_NOT_REQUIRED` | COD is representable on an imported order. A cancelled-but-paid order is a state the cancellation flow must expect |
| L-X1 | The ~5 `orderCreate` per minute cap applies on the "Plus App Development" plan too, reported as a `"Too many attempts"` userError (same as E-X2) | Retry classifier must treat that userError as deferrable |
| L-T1 | `taxonomy.categories(search: "T-shirts")` ranks "Baby & Children's T-Shirts" first | Keyword search is not a safe automatic category pick; the operator chooses |
| L-O3 | `orderCreate` is **not** among the 18 mutations that document `@idempotent` support (inventory*, `refundCreate`, location activation, mandate payment, ...) | Order dedup is OpenLinker's job: per-order lock + mapping write, as for Shoper |
| L-O4 | Two `orderCreate` calls with the same `sourceIdentifier` created two orders (#1007, #1008). `orders(query: "source_identifier:…")` returned `[]` at 0 s and both orders at 10 s. `sourceName` is set to the app id automatically | A crash between create and mapping write can be recovered by a `source_identifier` lookup, but only after the index catches up; an immediate lookup proves nothing |
| L-O5 | `companyCreate` with `companyLocation.taxRegistrationId: "PL5252556107"` + a `companyContact`, then `orderCreate(companyLocationId, customer.toAssociate)` -> `purchasingEntity: PurchasingCompany`, `location.taxSettings.taxRegistrationId: "PL5252556107"`. Without a customer the create is refused: `"no customer_id was provided"` | Buyer tax id exists for B2B (Plus) orders only; read from the purchasing entity and freeze it |
| L-M2 | With a 30 s settle: a stock change (`inventorySetQuantities`) bumped product, variant and level `updatedAt`; a variant price edit (`productVariantsBulkUpdate`) bumped **only** the variant. Read straight after a write, every `updatedAt` still shows the old value; it moves 5-10 s later | `ModifiedProductLister` = union of product and variant `updated_at` queries, lookback well over 10 s |
| L-S1 | `shippingLabelPurchase` on an open fulfillment order -> userError `TERMS_OF_SERVICE_NOT_ACCEPTED` ("Purchase a shipping label through the Shopify admin first"). Shopify Shipping is not offered for Polish fulfilment locations | Labels stay with InPost / DPD for PL. The API is real for the countries Shopify Shipping serves |
| L-D1 | Schema scan of all 483 mutations / 278 queries: no invoice, fiscal-document or receipt issuance. `orderInvoiceSend` / `draftOrderInvoiceSend` send a payment-request email. `taxSummaryCreate` and `taxAppConfigure` belong to the tax-calculation app surface, not to documents | Every invoicing and fiscalization sub-capability is "via OL connector" |
| L-C3 | `carrierServiceCreate` registers a **live-rates callback at checkout** | New option, not on any OL port yet: OpenLinker (InPost/DPD) could quote shipping at the Shopify checkout. Out of scope here, worth a follow-up issue |
| L-C4 | `webhookSubscriptionCreate(topic: ORDERS_UPDATED, uri: "https://example.com/...", filter: "tag:ol-probe")` accepted and deleted cleanly | A connection can provision its webhooks without the app URL matching OL's host; only the fulfillment-service callback is domain-bound |
| L-F2 | Role E end to end with no callback URL: `inventoryActivate` at the 3PL location, `orderCreate` (#1010), `fulfillmentOrderMove` to the 3PL location, `fulfillmentOrderSubmitFulfillmentRequest`, the FO appears in `assignedFulfillmentOrders(FULFILLMENT_REQUESTED)`, `AcceptFulfillmentRequest` (`IN_PROGRESS` / `ACCEPTED`), `fulfillmentCreate` -> order `FULFILLED` | OpenLinker can be a Shopify 3PL by polling; a public URL is only needed for push |
| L-F3 | `fulfillmentCreate` with `trackingInfo.company: "InPost"` and no `url` stored a **FedEx** tracking link (`fedex.com/fedextrack/?trknbr=...`): Shopify guesses the carrier URL from the number | Always send `trackingInfo.url` (and the company) explicitly; never let Shopify infer it |
| L-O6 | `DeliveryMethod` / `OrderCreateShippingLineInput` have no pickup-point id field | Locker codes travel in the shipping-line title/code or an OL-written metafield; InPost's `PickupPointFinder` stays OL's |
| L-R1 | `returnCreate` on #1005 (status `OPEN`): `order.updatedAt` unchanged after 20 s; `order.returnStatus` became `IN_PROGRESS` | The order feed is blind to returns |
| L-R2 | `orders(query: "return_status:in_progress")` finds the order (search index, so lagged); `return_status:open` / `return_requested` find nothing. Webhook topics `RETURNS_REQUEST/APPROVE/PROCESS/DECLINE/CLOSE/CANCEL/REOPEN/UPDATE` exist | Return feed = webhook trigger + `return_status` backstop sweep |
| L-T2 | Schema scan: no tax-rate field on product, variant, shop or any query; only `taxable`, `taxesIncluded`, `taxShipping` | ProductTaxRateReader not possible; see matrix row |
| L-T3 | `collectionCreate` + `collectionAddProductsV2` (async job, `done: false`) and the product immediately lists the collection; `product.category` and `productType` are independent of it | Collections are the provisionable "category" for D |
| L-P1 | Prototype in a real stack (`ol-shopify`, commit `191cc6d42` + fixes): connection test answers `OK - ol-dev-norbert (PLN, prices include tax)` in ~250 ms; the bootstrap catalogue sync brought 22 products with variants, EAN and gross prices (`T-shirt S 79.98`, `Sneakers 249.00`) in one `syncBatch` | ProductMaster works end to end through OL's own sweep; no Shopify-specific core change was needed |
| L-P2 | The image build failed with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` until the root `Dockerfile` copied `libs/integrations/shopify/package.json` (two stages) and its `dist` | Every new integration package needs three `Dockerfile` lines; nothing in `check:invariants` catches the omission |
| L-I1 | The first prototype refused untracked variants (Gift Wrap, Gift Card); the inventory sweep then dead-lettered one job per such product on every tick. Reporting them at an unmanaged cap (1000, WooCommerce `DEFAULT_UNMANAGED_STOCK_QUANTITY`) fixed it: Gift Wrap `1000`, no dead jobs | Follow the WooCommerce convention for `inventoryItem.tracked = false`, with a per-connection override |
| L-O7 | With Shopify as the only order source AND the only `OrderProcessorManager`, every Shopify order fails `No OrderProcessorManager destinations available` and climbs the retry ladder (source is excluded from its own fan-out) | Core behaviour for any shop that ingests its own orders with no other destination, not Shopify-specific (turning `OrderProcessorManager` off does not help: the fan-out is still empty). The order record is persisted first, so documents and labels can still work; the retry ladder is noise. Follow-up: a non-retrying "nothing to mirror" outcome |
| L-S1a | S1 live: Allegro sandbox order (Kubek, 24.90 + Paczkomat 10.95) reached Shopify as #1011: line `OL Seed Mug` at **24.90** (the marketplace price, Shopify list price 38.99), shipping line `Allegro Paczkomaty InPost` 10.95, total 35.85 PAID, `taxesIncluded`, `sourceIdentifier` = OL order id, tag `openlinker`, gateway `manual`. Shopify committed the unit at `OL Seed Warehouse` (available 9 -> 8, committed +1) | B role works through the prototype adapter; the fulfillment order happened to land on the configured location here, L-O1 still says it must be read back |
| L-S1b | The order line carried `taxRate: "23"` with `taxSource: "channel"`: the rate came from Allegro, not from Shopify (which has none, L-T2) | For marketplace orders into a Shopify master the channel rate is enough for documents; only Shopify-own orders lack a rate |
| L-S1c | Stock sync Shopify -> Allegro: `inventoryAdjustQuantities` +1 in Shopify, inventory sweep, `inventory.propagateToMarketplaces`, `PUT /sale/offer-quantity-change-commands` 201 | InventoryMaster to marketplace works with no Shopify webhook (sweep only; push needs a public URL) |
| L-S1d | The Allegro sandbox seller account refuses new offers (`OfferAccessDeniedException`, sales suspended); existing offers stay active and editable. Two were linked to Shopify variants by an `identifier_mappings` row (what auto-match writes); OpenLinker has no manual offer-link endpoint | Environment limit, not Shopify. Manual linking of an existing offer is a missing operator feature |
| L-S1e | eparagony receipt for #1011 rejected by the sandbox printer (code 83, device error 18, "schodek podatkowy"), a known sandbox printer state. `POST /fiscal-registrations` for the same order then returned the old `succeeded` job id and did nothing: a `rejected` registration cannot be retried from OpenLinker because the `fiscalization.register` job key is permanent | Core bug, not Shopify: a rejected receipt needs a fresh job key (generation) on manual retry |
| L-S1f | Linking two existing offers made the 4 older `awaiting_mapping` Allegro orders on them `ready`; they were then created in Shopify and sent to eparagony. One receipt registered (`16370`, T-shirt line), the Kubek ones hit the same printer error | eparagony works end to end for a Shopify-master order; mapping an offer late replays its backlog into the master, which an operator should be told about |
| L-S1g | InPost label from the order page needed a carrier mapping for the Allegro delivery method first (operator added it in the UI). InPost minted the number at once (`602222296611036022304742`); `notify-dispatched` relayed `dispatched` to Allegro (OrderSource) and to Shopify (OrderProcessorManager). Shopify #1011 became `FULFILLED`, one fulfillment `SUCCESS` with `company: InPost`, the number and an explicit `inpost.pl` tracking URL, fulfillment order `CLOSED`, `on_hand` -1 | Tracking back to both sides works; the prototype sends the URL explicitly, so L-F3 does not bite |
| L-S1h | Allegro order with an invoice request (company + NIP `8113439670`) -> Shopify #1016 (49.00 + 10.95 = 59.95) with the company name in `billingAddress.company` but `purchasingEntity: Customer` and no NIP; OpenLinker read the NIP from Allegro, the rule `buyerHasTaxId = true` routed it to inFakt, invoice `issued`, KSeF `submitted`; the Allegro PDF upload waits for clearance | Invoicing for Shopify-master orders runs entirely in OpenLinker; Shopify never needs the NIP. Writing it to Shopify would need a B2B company (Plus), not worth it |
| L-S4a | Shopify-own orders ingested with `taxRate: "23"` on every line that had a tax line: the prototype reads `lineItems.taxLines.ratePercentage` (and the shipping line's). Only orders created with no tax lines (probe orders #1007-#1010) carry none | L-T2 is about products only. An ORDER from Shopify states its rate, so documents for Shopify-own orders do not need a per-connection default when Shopify Tax computed the lines |
| L-S4b | None of the 9 Shopify-own orders got an invoice or receipt: `marketplace.order.sync` throws `No OrderProcessorManager destinations available` (L-O7) at `syncOrder` (order-ingestion.service.ts ~803), before `autoIssueTrigger.onOrderTransition` (~943) runs, then retries 10 times | **S4 is blocked by core**, not by Shopify: a shop that is its own only destination never gets automatic documents. Needs the L-O7 fix (empty fan-out = "nothing to mirror", continue to auto-issue) before Shopify-only installs work |
| L-S4c | B2B order #1009 (`PurchasingCompany`, `taxRegistrationId: PL5252556107`) had no addresses; the NIP was read but `IncomingOrder` carries it only on `billingAddress` / `shippingAddress`, so it was dropped | Core contract gap: an order without an address cannot state a buyer tax id. Rare for real Shopify B2B orders (they carry addresses) |
| L-S2a | Role D prototype (`ProductPublisher` + `CategoryProvisioner`, commit `c77931863` + `062de51ca`) published PrestaShop products through `POST /listings/bulk-shop-publish`: simple Mug -> one product at **60.27 gross** (PS net 49.00 x 1.23), stock 7 at the configured location, `ACTIVE` and on the Online Store; Soap (2 combinations) -> one product, option `Colour`, both variants with EAN | `productSet` for the first sibling and `productVariantsBulkCreate` for the rest work; a new value on an existing option is created by `productVariantsBulkCreate` itself |
| L-S2b | adidas Tee (3 sizes) became **two** Shopify products (L+S, and M): sibling jobs run concurrently in the `bulk` lane and two of them found no parent mapping at the same moment | The adapter (or core, for every shop publisher) needs a per-group lock around "resolve or create the parent"; WooCommerce has the same exposure |
| L-S2c | `Publication` has no `name` on 2026-10; the Online Store publication is recognisable only by `catalog.title` (`ChannelCatalog<id>forOnlineStore`). Reading `resourcePublicationOnCurrentPublication` needs `read_product_listings`; `publishedOnPublication(publicationId:)` does not | Match the publication by catalog title, or store its id in the connection config |
| L-S2d | Shopify needed `masterCatalogConnectionId` on its own connection before publishing (`MASTER_CATALOG_NOT_CONFIGURED`). The 5 PrestaShop combinations then failed `price.amount could not be resolved from input or master product` and passed with an explicit per-item price | The combination-price gap is in the PrestaShop master read or the publish builder, not Shopify; the per-item price override is the workaround |
| L-S2e | Images from the master at `http://localhost:38080/...` were not sent, each with a warning naming the host; per-variant images go to the product gallery with a warning | Shopify pulls images itself, so the master must be publicly reachable (or OL must upload the bytes via `stagedUploadsCreate`) |
| L-S2f | To act as a channel the Shopify connection had to drop `ProductMaster` / `InventoryMaster`: with both on, the master sweep would read the published products back as a second copy of the catalogue | One Shopify store is either the master or a publish target, never both; the connection form should say so |
| L-S2g | Shopify order #1018 (Mug 60.27 + Soap Rose 2 x 35.67 + courier 15.00, gross, 23% tax lines) -> OpenLinker -> PrestaShop order 6: **146.61** to the grosz, products 131.61, shipping 15.00, carrier `OpenLinker Dynamic`, PrestaShop stock -1 / -2. Payment shows `Check payment` until a payment mapping exists | Role C (Shopify as order source into a master) works through the prototype; amounts carry over exactly when the Shopify order is tax-inclusive |
| L-S2h | An `orderCreate` without `taxesIncluded: true` makes a **net, tax-free** order even on a tax-inclusive store (#1017: `taxesIncluded: false`, tax 0); PrestaShop then refused it ("shipping without tax and no tax-included shipping amount") | Correct refusal. Real checkout orders follow the store setting; only API-created orders (tests, apps) must set the flag and tax lines |
| L-S2i | Stock from the master does **not** reach published Shopify products: `inventory.propagateToMarketplaces` reported `0 offer + 0 shop-product` updates, so Shopify kept 5 while PrestaShop had 29 | Role D needs the `OfferManager` base port (`updateOfferQuantity` -> `inventorySetQuantities` at the configured location on the `ShopProduct` mapping), the WooCommerce #1498 pattern. Not in the prototype yet |
| L-S2j | The first poll 10 s after `orderCreate` did not see #1018/#1017 (search index lag, L-M1); the next poll did, and nothing was lost because the cursor uses `updated_at:>=` with an id tie-break. A manual `marketplace.orders.poll` with an empty payload writes its cursor under the core default key `allegro.orders.lastEventId` instead of `shopify.orders.cursor` | Poll cadence absorbs the lag. The default cursor key in `orders-poll.handler.ts` is an Allegro name for every platform: a trap for manual jobs (core) |
| L-S2k | PrestaShop reports no catalogue price for its combination products (`prestashop_gross_price_unavailable ... charges 0 for product 22 in PL`), which is why L-S2d needed explicit prices | Fresh-install PrestaShop data issue, not Shopify |
| L-S2l | Stock write-back prototype (`OfferManager.updateOfferQuantity`, commit `d1c9e5038`): with `OfferManager` on and `InventoryMaster` off on the Shopify connection, a PrestaShop stock change (29 -> 28) produced `1 shop-product quantity update`, and Shopify's Mug went `available 5 -> 28` via `inventorySetQuantities` (`changeFromQuantity` + `@idempotent`) at the configured location | L-S2i closed: the WooCommerce #1498 shape works for Shopify. The fan-out skips any connection with `InventoryMaster` on, so a publish target must have it off |
| L-S2m | Return feed prototype (`ReturnSourceReader`): `orders(sortKey: ID, query: "return_status:... AND id:>N")` in laps, one feed item per return, `node(id: Return)` re-read. Shopify return #1018-R1 (1 x Soap Rose, reason `changed-my-mind`) and the earlier probe return on #1005 were ingested, attributed to their OL orders, and each line resolved to variant AND order line (`resolvedOrderLineId`) | Role C returns work. On 2026-10 the reason is `returnReasonDefinition { handle name }` (`returnReason` is gone); core maps `changed-my-mind` to `other` |
| L-S2n | `POST /returns/:id/lines/:lineId/receive` then `dispose {restock}` -> line `disposed`, `quantityRestocked: 1`, PrestaShop Soap Rose `98 -> 99` | The whole S2 loop (publish, order into the master, return, restock in the master) runs through OpenLinker with Shopify as the channel |
| L-S2o | Return status changes do not move `order.updatedAt` (L-R1), so the feed walks every order with a return in laps; a return opened and closed between two laps on an order that falls back to `no_return` is never seen | Use the `RETURNS_*` webhooks as the primary trigger once a public URL exists; the lap sweep stays the backstop |
| L-S3a | S3 with PrestaShop as master and the OMS on (wizard `/settings/packing`: OMS connection with `sourcingAuthority` + `fulfillmentExecutor`, location MAIN, `stockLocationOverride` on PrestaShop). After the next stock sync every PrestaShop position was located at MAIN and the pooled rows went stale | The stock override (#3206) is what makes a Shopify channel order routable when the master cannot name a location |
| L-S3b | Shopify order #1019 (Mug + Soap Lavender, 110.94 gross) was ingested 30 s after creation (the prototype's settle window), routed to the OL executor (`FulfillmentWork` `open` / `accepted`), held from PrestaShop (no `syncStatus` row), and `inventory.saleDecrement` lowered PrestaShop stock (Mug 28 -> 27, Lavender 100 -> 99) | Shopify needs no special handling to be an OMS channel: it is an ordinary `OrderSource`, and the own-shop guard (#3487) lets it through because the Shopify connection is not a `ProductMaster` here |
| L-S3c | Closing the parcel on the pack bench relayed `dispatched` to Shopify as the SOURCE (`OrderSource` participant) after the prototype gained `OrderStatusWriteback` on its order-source adapter (commit `7eb9d6aad`, delegating to the destination writer). Shopify #1019 became `FULFILLED`, fulfillment order `CLOSED`, one fulfillment with **no tracking**: no shipment existed, so the work-grain relay carried none | The Shopify adapter must implement `OrderStatusWriteback` on the `OrderSource` adapter, not only on `OrderProcessorManager`. Tracking reaches Shopify only when a label exists before the parcel closes (shipment-grain relay) |
| L-S3d | The pack bench never buys a label (spec F3/D14: fetched upstream). Labels come from the order page, bulk generation, or `config.autoDispatch` on the OMS connection (#3340), which is off by default and has no UI; the setup wizard does not mention it. Filed as #3958. A Shopify delivery method also needs its own `ol_managed_carrier` routing rule (the prototype exposes no `SourceOptionsReader`, so it was added with `PUT /connections/:id/routing-rules`, `sourceDeliveryMethodId: "courier"`) | Order sources with no delivery-method list cannot be routed to a carrier from the UI; the Shopify adapter should implement `SourceOptionsReader.listDeliveryMethods` (shipping profile method names / codes) |
| L-S3e | Auto-dispatch bought nothing for #1021: InPost courier preflight needs a box (`preflight.missing-dimensions-or-weight`), then the sandbox org refused courier (`trucker_ID_is_not_set_for_organization`, InPost-side provisioning). The job retried 4 times before it was switched off. A Paczkomat label forced through `POST /shipments/generate-label` (`deliveryIntent: pickup_point`, `paczkomatId`) worked, linked to the work | Shopify orders carry no locker id (L-O6), so a Paczkomat order from Shopify needs the operator to pick the point or a checkout app that stores it |
| L-S3f | With the label bought before the parcel closed, closing it on the bench made Shopify #1021 `FULFILLED` with `company: InPost`, the number `602222296611036019971426` and the inpost.pl tracking URL | S3 end to end: Shopify order -> OMS routing -> pack bench -> OL label -> fulfillment and tracking back to Shopify |

## Live transcripts

None yet beyond the seed run (`pnpm dev:stack:seed-shopify` output and the read-backs above).

## Open risks

Carried from SPIKE-2879 (not re-verified yet): mandatory `@idempotent` is not a replay cache
(E-M6); dev-store `orderCreate` cap reports as a userError (E-X2); `descriptionHtml` is not
sanitized (E-P2); return reasons are an open catalogue (E-R4); `RESTOCKED` disposition does not move
stock (E-R10); `read_all_orders` needs manual review (E-C6).

New, to resolve here:

1. **Order dedup on `orderCreate`** - answered (L-O3, L-O4): no native dedup; OpenLinker's lock and
   mapping are the guarantee, `source_identifier` lookup is a delayed recovery aid only.
2. **Buyer tax id** - answered (L-O5): B2B / Plus orders only, via the purchasing entity.
3. **Product `updatedAt` vs variant and stock edits** - answered (L-M2): declarable as a union.
4. **Category concept** - answered (L-T3): collections for placement, taxonomy as an optional extra.
   Original question: taxonomy (read-only, global) vs collections (shop-owned) vs `productType`
   (free text) - decides `CategoryProvisioner` and the mapping UI.
5. **Effective tax rate per product** - answered negatively (L-T2): not readable; needs a
   per-connection default or a merchant metafield, a product decision for the implementation.
   Original question: Decides whether a Shopify master can satisfy ADR-063 (the
   rate is an input, never computed) or every Shopify-master document holds.
