# Capability & Sub-capability Reference

The canonical, code-synced inventory of every capability port, its base
contract, and its composable sub-capabilities. This is the developer-facing
counterpart to the integration showcase in the [README](../README.md); for the
*why* of the capability-ports + sub-capabilities design see
[ADR-002](./architecture/adrs/002-capability-ports-with-sub-capabilities.md)
and the [Architecture Overview](./architecture-overview.md).

**How to read this:** core depends on **capability ports** (business roles).
The base port carries only the method *every* adapter of that role must
implement; optional behaviour is split into **sub-capabilities** — independent
interfaces in `domain/ports/capabilities/`, each with a co-located
`is{Capability}(adapter)` type-guard. Call sites narrow with the guard before
invoking, and degrade gracefully when an adapter doesn't implement it.

> **Source of truth.** Every name below is generated from
> `libs/core/src/**/domain/ports/**`. When you add a port or sub-capability,
> update this file in the same PR. If a table here disagrees with the code, the
> code wins — fix the doc.

---

## Capability ports

| Port | Context | Registry capability | What it does | Base method(s) |
|---|---|---|---|---|
| `ProductMasterPort` | products | `ProductMaster` | Source of truth for the product catalog — read/write products, variants, and categories. | `getProduct` · `getProducts` · `createProduct` · `updateProduct` · `deleteProduct` · `getProductVariants` · `upsertProductVariant` · `getProductCategories` · `assignCategories` · `searchProducts` · `listExternalIds` |
| `InventoryMasterPort` | inventory | `InventoryMaster` | Source of truth for stock levels; carries a **deprecated** reservation surface (`reserveInventory` / `releaseInventory` — ADR-061, deprecated in place, removal deferred to a contract-major cycle). | `getInventory` · `listInventory` · `adjustInventory` · `reserveInventory` · `releaseInventory` · `getAvailableQuantity` |
| `OrderSourcePort` | orders | `OrderSource` | Cursor-based, read-only ingestion of orders from any source (marketplace journal or shop watermark). | `listOrderFeed` · `getOrder` |
| `OrderProcessorManagerPort` | orders | `OrderProcessorManager` | Create orders on a destination shop. | `createOrder` |
| `OfferManagerPort` | listings | `OfferManager` | Manage marketplace offers/listings; base contract is the inventory-driven quantity update. | `updateOfferQuantity` |
| `ShopProductManagerPort` | listings | `ProductPublisher` | Publish a product as a native listing on a shop (the shop-publish flow), and declare the description grammar the shop accepts ([ADR-046](./architecture/adrs/046-adapter-declared-description-format.md)). | `publishProduct` · `getDescriptionFormat` |
| `ShippingProviderManagerPort` | shipping | `ShippingProviderManager` *(open-world — see note)* | Generate shipping labels, read tracking, and list supported shipping methods. | `generateLabel` · `getTracking` · `getSupportedMethods` |
| `InvoicingPort` | invoicing | `Invoicing` | Issue fiscal documents, fetch them, upsert a customer, and report supported document types. | `issueInvoice` · `getInvoice` · `upsertCustomer` · `getSupportedDocumentTypes` |
| `FiscalizationPort` | fiscalization | `Fiscalization` | Hand a completed sale to a provider that performs or brokers its fiscal registration (never OL itself). | `registerTransaction` |
| `FulfillmentExecutorPort` | fulfillment | `FulfillmentExecutor` | Hold a piece of routed fulfilment work: accept or reject it, and accept or refuse a cancellation ([ADR-054](./architecture/adrs/054-fulfillment-work-unit-of-assignment.md)). Implemented by the OpenLinker OMS (`libs/oms`). | `requestFulfillment` · `requestCancellation` |
| *(no port yet — Wave 3a)* | fulfillment-authority | `ReturnsAuthority` | Decide the disposition of returned goods — A5 of the [ADR-052](./architecture/adrs/052-independently-assignable-fulfillment-authorities.md) authority matrix. Resolved from a connection's capability declarations plus its `Connection.config` claim, not by narrowing a dispatched adapter, so it carries no `*Port` yet. | — |
| `ContentPublisherPort` | content | *(internal — not registry-resolved)* | Publish a content field (e.g. a product description) to a channel or the master. | `publish` |

**Open-world capability vocabulary (#576).** The closed, well-known set is
`CoreCapabilityValues`, reproduced in full in the fenced table below — one list,
not a second restatement that can drift from it. `Fiscalization` (#1908) and
`ReturnsAuthority` (#2351) join the closed set rather than the open-world escape
because the connection DTOs validate `enabledCapabilities` against it with a
strict `@IsIn`, so a name kept out of the array is a name an operator cannot
write. Adapters
may register **additional**
capability strings at runtime without a core change — `ShippingProviderManager`
is the live example (declared in the InPost / DPD / Allegro manifests, resolved
through the registry, but intentionally *not* a member of the closed set). The
runtime gate validates a connection's request against the adapter's
`supportedCapabilities`, not against the closed union.

<!-- core-capabilities:start -->

<!-- Mirrored by scripts/check-core-capability-mirror.mjs against
     libs/core/src/integrations/domain/types/adapter.types.ts and the two
     frontend mirrors. Edit the core array first; this table follows it. -->

| Capability | What it does |
|---|---|
| `ProductMaster` | Source of truth for the product catalog. |
| `InventoryMaster` | Source of truth for stock levels. |
| `OrderProcessorManager` | Create orders on a destination shop. |
| `OrderSource` | Cursor-based, read-only ingestion of orders. |
| `OfferManager` | Manage marketplace offers and listings. |
| `ProductPublisher` | Publish a product as a native shop listing. |
| `CategoryProvisioner` | Mirror or create a destination category tree. |
| `Invoicing` | Issue fiscal documents through a provider. |
| `Fiscalization` | Hand a completed sale to a provider that registers it fiscally. |
| `ReturnsAuthority` | Decide the disposition of goods a customer sends back (A5, ADR-052). |
| `AvailabilityAuthority` | Decide how much of each product is sellable (A1, ADR-052). |
| `FulfillmentExecutor` | Hold a piece of fulfilment work and act on it (A3, ADR-052). |

<!-- core-capabilities:end -->

> **Which integration implements what** is each adapter's own declaration: its
> `supportedCapabilities` manifest (`libs/integrations/<p>/src/<p>-plugin.ts`) is
> the source of truth, and the capability-level showcase across all integrations
> lives in the [root README](../README.md#capabilities). This file stays the
> platform-neutral *vocabulary* — the ports and sub-capabilities themselves.

---

## Sub-capabilities

Each is an independent interface + co-located `is{Capability}` guard. Adapters
declare what they support via `implements <BasePort>, <SubCapability>, …`.

### `OfferManagerPort` (listings) - 25

| Sub-capability | What it does | Method(s) | Guard |
|---|---|---|---|
| `OfferLister` | Page through the seller's existing offers. | `listOffers` | `isOfferLister` |
| `OfferReader` | Fetch a single offer by external id. | `getOffer` | `isOfferReader` |
| `OfferEventReader` | Read the marketplace's incremental offer-event journal. | `listOfferEvents` | `isOfferEventReader` |
| `OfferCreator` | Create a new offer / listing. | `createOffer` | `isOfferCreator` |
| `OfferFieldUpdater` | Partially update offer fields (e.g. description text). Optionally declares the description grammar the marketplace accepts ([ADR-046](./architecture/adrs/046-adapter-declared-description-format.md)) - optional because a marketplace adapter may ship no field-update capability at all, so a destination that declares nothing resolves to a conservative shared subset. | `updateOfferFields`, `getDescriptionFormat?` | `isOfferFieldUpdater` |
| `OfferStatusReader` | Read an offer's live publication status. | `getOfferStatus` | `isOfferStatusReader` |
| `OfferStockRestorer` | Restore offer stock after a cancellation. | `restoreStockOnCancellation` | `isOfferStockRestorer` |
| `OfferQuantityBatchUpdater` | Bulk-update quantities for many offers in one call. | `updateOfferQuantitiesBatch` | `isOfferQuantityBatchUpdater` |
| `PendingQuantityAckReconciler` | Reconcile outstanding asynchronously-acknowledged quantity writes against a destination's authoritative status (#2621) - a destination that acknowledges a quantity write synchronously simply doesn't implement this. | `reconcilePendingQuantityAcks` | `isPendingQuantityAckReconciler` |
| `OfferSmartClassificationReader` | Fetch the marketplace's smart/auto classification for an offer. | `getOfferSmartClassification` | `isOfferSmartClassificationReader` |
| `CategoryBrowser` | Browse the marketplace category tree. | `fetchCategories` | `isCategoryBrowser` |
| `CategoryBarcodeMatcher` | Auto-detect a category from a product barcode. | `matchCategoryByBarcode` | `isCategoryBarcodeMatcher` |
| `CategoryParametersReader` | Read the parameter schema a category requires. | `fetchCategoryParameters` | `isCategoryParametersReader` |
| `EanCategoryMatcher` | Resolve categories for a batch of products by EAN. | `resolveCategoriesForBatchByEan` | `isEanCategoryMatcher` |
| `EanCategoryMatcherStreaming` | Resolve categories for a batch of products by EAN, yielding each variant's outcome as it lands instead of one map at the end. Incremental sibling of `EanCategoryMatcher`; an adapter that ships only the batch method keeps working. | `streamCategoriesForBatchByEan` | `isEanCategoryMatcherStreaming` |
| `CatalogProductReader` | Look up marketplace catalog products by barcode / id. | `findProductsByBarcode` · `getProduct` | `isCatalogProductReader` |
| `SellerPoliciesReader` | Surface the seller's saved return / shipping / warranty policies. | `fetchSellerPolicies` | `isSellerPoliciesReader` |
| `ResponsibleProducerReader` | List GPSR responsible-producer entries. | `fetchResponsibleProducers` | `isResponsibleProducerReader` |
| `SafetyAttachmentUploader` | Upload a GPSR safety attachment (manual, label, …). | `uploadSafetyAttachment` | `isSafetyAttachmentUploader` |
| `TaxonomyBorrower` | Reuse another platform's resolved taxonomy for a destination. | `getBorrowedTaxonomy`, `allowsBorrowedCatalogueLookup` (optional) | `isTaxonomyBorrower` |
| `CategoryPathReader` | Resolve one category id to its full ancestor breadcrumb ("Root > ... > Leaf") for an offer whose payload carries only a category id. | `fetchCategoryPath` | `isCategoryPathReader` |
| `AdapterSuppliedParametersReader` | Declare the required category parameters the adapter derives itself from neutral `CreateOfferCommand` fields (e.g. Allegro's "Stan" from `condition`), so the required-parameter gate does not block on a value the pipeline always produces. | `getAdapterSuppliedParameterIds` | `isAdapterSuppliedParametersReader` |
| `DeliveryPriceListReader` | List the seller-configured delivery price lists an offer needs attached to be buyable. | `listDeliveryPriceLists` | `isDeliveryPriceListReader` |
| `TaxonomyIdentityProvider` | Declare which taxonomy tree the connection reads and writes (ADR-037), instead of core inferring it from `platformType`. Distinct from `TaxonomyBorrower`. | `getTaxonomyIdentity` | `isTaxonomyIdentityProvider` |
| `OfferCurrencyDeclarer` | Declare the connection's real settlement currency, a pure/synchronous adapter-declared value (#3203, mirroring `getDescriptionFormat`) consumed by `DestinationCurrencyResolutionService` to answer the price-change currency-mismatch guard. The declared value is a FALLBACK — the operator-set `Connection.config.currency` key wins when set (#3159 review, BLOCKING), so a wrong fixed assumption (e.g. a non-PL Allegro storefront) always has a remedy. | `getDestinationCurrency` | `isOfferCurrencyDeclarer` |

**Adapter coverage:** Allegro implements every sub-capability except
`TaxonomyBorrower` (it owns its taxonomy) and `DeliveryPriceListReader`, including
`OfferQuantityBatchUpdater` and `EanCategoryMatcherStreaming` (#2208, epic
#2205); an adapter that ships only `EanCategoryMatcher` keeps working, because
`CategoryResolutionService` falls back to the batch method
(see the [README Implementations](../README.md#implementations)
section); Erli implements a reconciliation-first subset
([ADR-025](./architecture/adrs/025-erli-marketplace-adapter.md)), plus
`DeliveryPriceListReader` and `OfferCurrencyDeclarer` (both Allegro and Erli declare `'PLN'`, matching the
PL-first / PLN-only assumptions already baked into each adapter).

### `ShopProductManagerPort` (listings) - 6

| Sub-capability | What it does | Method(s) | Guard |
|---|---|---|---|
| `CategoryProvisioner` | Create / ensure a category exists on the destination shop before publishing. Also a registry-level capability (`CategoryProvisioner` ∈ `CoreCapabilityValues`). | `provisionCategory` | `isCategoryProvisioner` |
| `ShopCategoryBrowser` | Browse the shop's existing category tree (drill-down by parent) so an operator can pick a placement — the shop-side sibling of the marketplace `CategoryBrowser`. Every node is selectable (no leaf gate). Advertised-without-dispatch (not in `CoreCapabilityValues`): declared in the manifest for discovery, resolved by narrowing the `ProductPublisher` adapter. | `browseCategories` | `isShopCategoryBrowser` |
| `ShopAttributeReader` | Read the shop's store-wide global product attributes + their predefined terms so an operator can pick a structured attribute (linked on publish as `pa_*` + term ids), with free-text custom attributes as the fallback. Advertised-without-dispatch (not in `CoreCapabilityValues`): declared in the manifest for discovery, resolved by narrowing the `ProductPublisher` adapter. | `listAttributes`, `listAttributeTerms` | `isShopAttributeReader` |
| `ShopProductStatusReader` | Read a previously-published product's live shop-side publication status for the steady-state `ShopStatusSyncService` reconcile (#1845) — the shop-side sibling of `OfferStatusReader`. Optional `getShopVariationStatus` reads a grouped/multi-variant publish's CHILD variation status scoped under its parent (a variation lives at a different shop-native resource than a standalone simple product). Advertised-without-dispatch (not in `CoreCapabilityValues`): declared in the manifest for discovery, resolved by narrowing the `ProductPublisher` adapter. | `getShopProductStatus`, `getShopVariationStatus?` | `isShopProductStatusReader` |
| `ShopProductPriceUpdater` | Change the price of an already-published product without re-sending the rest of it (`publishProduct` is a full upsert that would overwrite stock and title). The price-change apply path prefers it and falls back to a guarded publish. | `updateShopProductPrice` | `isShopProductPriceUpdater` |
| `ShopCurrencyDeclarer` | Declare the shop's configured currency, the shop-side sibling of `OfferCurrencyDeclarer` (#3203). Kept optional rather than folded onto the base port, and ASYNC (`Promise<string \| null>`) unlike its marketplace sibling — a shop's real currency typically needs a live read (e.g. a store-settings call), so no in-tree shop adapter implements it yet. | `getDestinationCurrency` | `isShopCurrencyDeclarer` |

**Adapter coverage:** WooCommerce implements `CategoryProvisioner` (write),
`ShopCategoryBrowser` (read, #1834), `ShopAttributeReader` (read, #1835), and
`ShopProductStatusReader` (read, #1845, including the grouped-variation-aware
read) and `ShopProductPriceUpdater` on its `ProductPublisher` adapter. Shoper implements `CategoryProvisioner`
(write, #3713), `ShopCategoryBrowser`, `ShopAttributeReader` and
`ShopProductStatusReader` (read, #3806) on its `ProductPublisher` adapter. No shop adapter implements
`ShopCurrencyDeclarer` yet — a WooCommerce destination still falls back to
`Connection.config.currency` (or an operator-set value) for the price-change
currency-mismatch guard.

### `OrderProcessorManagerPort` / `OrderSourcePort` (orders) - 11

| Sub-capability | What it does | Method(s) | Guard |
|---|---|---|---|
| `OrderFulfillmentUpdater` | Push a post-create status + tracking update to a destination order. | `updateFulfillment` | `isOrderFulfillmentUpdater` |
| `OrderStatusWriteback` | Relay an order-status change back to the originating marketplace (event-as-data). | `write` | `isOrderStatusWriteback` |
| `FulfillmentStatusReader` | Read a destination order's current fulfillment status. | `getFulfillmentStatus` | `isFulfillmentStatusReader` |
| `DestinationOptionsReader` | List a destination's carriers / order-statuses / payment-methods for mapping. | `listCarriers` · `listOrderStatuses` · `listPaymentMethods` | `isDestinationOptionsReader` |
| `SourceOptionsReader` | List a source's order-statuses / delivery-methods / payment-methods for mapping. | `listOrderStatuses` · `listDeliveryMethods` · `listPaymentMethods` | `isSourceOptionsReader` |
| `OrderCreateStockEffect` | Declare that creating an order on this destination lowered the shop's own stock, so core may consume the order's holds on positions that destination masters. Probed after the create; anything but a declared `true` keeps the holds until dispatch. Shoper answers from its `shopping_update_stock_on_buy` setting; PrestaShop from the state `validateOrder` created the order in (not `PS_STOCK_MANAGEMENT`, which does not gate the decrement), refusing packs and legacy `depends_on_stock` rows; WooCommerce from the `_reduced_stock` item meta on the created order's lines (stock drops only for a paid-like status on a stock-managed product). PrestaShop and WooCommerce answer for the order the same adapter instance just created, so a skipped create answers `false`. | `lowersStockOnOrderCreate` | `isOrderCreateStockEffect` |
| `ReturnSourceReader` | Read-only, cursor-capable ingestion of customer returns from an order source (feed plus per-return hydrate). Advertised-without-dispatch. | `listReturnFeed` · `getReturn` | `isReturnSourceReader` |
| `ReturnDecliner` | Ask the source to decline a customer return's refund. The one return write, kept separate so `ReturnSourceReader` stays read-only. | `declineReturn` | `isReturnDecliner` |
| `RefundExecutor` | Ask the source to actually move the buyer's money ([ADR-056](./architecture/adrs/056-refund-and-fiscal-authority-never-leave-ol.md)). The seam ships ahead of any implementer. | `executeRefund` | `isRefundExecutor` |
| `OrderFulfillmentReadback` | Read the source's own view of an order's fulfilment, so "the marketplace was told" can be checked against the marketplace (complements the fire-and-forget `OrderStatusWriteback`). | `readFulfillment` | `isOrderFulfillmentReadback` |
| `OrderContactRefresher` | Reconcile an order the destination already holds with contact details the source revealed only later. Called best-effort on the create-skip path (the order is already mapped), never after a fresh create; a throw is warn-logged and does not change the sync result. Shoper replaces the placeholder phone it had to create the order with, but only while the shop order still carries it. | `refreshOrderContact` | `isOrderContactRefresher` |

**Adapter coverage:** Allegro implements `ReturnSourceReader` and
`ReturnDecliner`; Allegro and Shoper implement `OrderFulfillmentReadback`. No
adapter implements `RefundExecutor`: OpenLinker records refunds, it does not
execute them.

There is no OL-owned order-status state machine on these ports. The order
lifecycle phase is derived from facts
([ADR-059](./architecture/adrs/059-order-lifecycle-derived-phase.md)), and an
operator cancel or edit is a core service rather than an adapter method. See
[#1032](https://github.com/openlinker-project/openlinker/issues/1032) for the
original scope.

### `ShippingProviderManagerPort` (shipping) - 6

| Sub-capability | What it does | Method(s) | Guard |
|---|---|---|---|
| `LabelDocumentReader` | Fetch the label document for an already-registered shipment. | `fetchLabel` | `isLabelDocumentReader` |
| `DispatchProtocolReader` | Generate a handover / dispatch protocol for a batch of shipments. | `generateProtocol` | `isDispatchProtocolReader` |
| `PickupPointFinder` | Search the carrier's pickup points / lockers (e.g. Paczkomat). | `findPickupPoints` | `isPickupPointFinder` |
| `ShipmentCanceller` | Cancel / void a registered shipment. | `cancelShipment` | `isShipmentCanceller` |
| `ParcelRequirementsReader` | Declare what parcel data the carrier requires (explicit dimensions, a size template, or weight only), so core needs no carrier names. Synchronous. | `getParcelRequirements` | `isParcelRequirementsReader` |
| `ShipmentReferenceReconciler` | Look a shipment up at the carrier by the reference OpenLinker stamped at creation, to recover a label whose `generateLabel` response was lost instead of buying a second one. | `findShipmentByReference` | `isShipmentReferenceReconciler` |

**Adapter coverage (these two):** Allegro implements `ParcelRequirementsReader`;
InPost implements `ShipmentReferenceReconciler`.

### `InvoicingPort` (invoicing) - 15

| Sub-capability | What it does | Method(s) | Guard |
|---|---|---|---|
| `RegulatoryStatusReader` | Read the clearance status of a previously-submitted document. | `getClearanceStatus` | `isRegulatoryStatusReader` |
| `RegulatoryTransmitter` *(extends `RegulatoryStatusReader`)* | Submit a document to the tax authority for clearance (+ read its status). | `submitForClearance` | `isRegulatoryTransmitter` |
| `RegulatoryResubmitter` | Re-trigger transmission of an ALREADY-ISSUED document (e.g. the operator "resend to KSeF" action on a rejected document) — flat, not `extends RegulatoryStatusReader`. | `resubmitForClearance` | `isRegulatoryResubmitter` |
| `RegulatoryDocumentReader` | Retrieve the authority's confirmation document (e.g. the PL UPO) or a rendered view for a cleared document. | `getRegulatoryDocument` | `isRegulatoryDocumentReader` |
| `CorrectionIssuer` | Issue a correcting document (e.g. KSeF `KOR`) against an original. | `issueCorrection` | `isCorrectionIssuer` |
| `OfflineResubmitter` | Retransmit a document issued with legal effect during a clearance-authority outage (degraded-mode `pending-submission`) once the authority recovers. | `resubmit` | `isOfflineResubmitter` |
| `RegulatoryRecordLocator` | Last-resort crash-recovery lookup: query the authority by business coordinates (seller id, document number, issue-date window) to learn whether an interrupted submit actually landed. | `locateByQuery` | `isRegulatoryRecordLocator` |
| `BankAccountsReader` | List the seller's payable bank accounts known to the provider (live picker for Transfer invoices). | `listBankAccounts` | `isBankAccountsReader` |
| `BankAccountDefaultSetter` *(extends `BankAccountsReader`)* | Mark an account as the provider's own default, keeping it in sync with the account OL stamps on Transfer invoices. | `setDefaultBankAccount` | `isBankAccountDefaultSetter` |
| `PaymentStatusReader` | Authoritative re-read of a document's payment state (a provider payment webhook is only a trigger, never trusted as the system of record). | `getPaymentStatus` | `isPaymentStatusReader` |
| `PaymentMarker` | Push an authoritative "paid" state to the provider for an order settled elsewhere (e.g. a marketplace order the seller's bank statement can't auto-match). | `markPaid` | `isPaymentMarker` |
| `InvoiceEmailSender` | Trigger the provider to render and email the already-issued invoice to the buyer. | `sendByEmail` | `isInvoiceEmailSender` |
| `BuyerIdentityCorrector` | Marker: the `CorrectionIssuer` really puts `IssueCorrectionCommand.buyerOverride` on the correcting document. `InvoiceService` refuses an override for an adapter that does not declare it. | `honoursBuyerOverride` (always `true`) | `isBuyerIdentityCorrector` |
| `RegulatoryVerificationLinkReader` | Return the authority's public link that opens a cleared document in its own portal (e.g. the PL KSeF "KOD I"). A URL, not bytes. | `getVerificationLink` | `isRegulatoryVerificationLinkReader` |
| `DocumentNumberConsumer` | Marker: the adapter relies on OpenLinker to allocate the legal, sequential document number from the connection's numbering series (OL-numbered provider, e.g. KSeF FA(3) `P_2`). Providers that number documents themselves (inFakt/Subiekt) do NOT implement it. | `consumesDocumentNumber` (marker) · `numberingTimeZone` · `maxDocumentNumberLength?` | `isDocumentNumberConsumer` |

**Adapter coverage:** KSeF implements `RegulatoryTransmitter`,
`CorrectionIssuer`, `BuyerIdentityCorrector` and
`RegulatoryVerificationLinkReader`; Infakt implements `RegulatoryStatusReader` (it relays to
KSeF rather than transmitting directly), `CorrectionIssuer`,
`RegulatoryDocumentReader`, and `BankAccountsReader` / `BankAccountDefaultSetter`;
Subiekt GT and Subiekt nexo each implement `RegulatoryStatusReader`,
`CorrectionIssuer`, and `BankAccountsReader` / `BankAccountDefaultSetter` —
two separate InsERT products on two separate bridges, never one adapter; eparagony.pl implements
`RegulatoryStatusReader` and `CorrectionIssuer` (#3193), on the same relay
split as Infakt for the base document — it hands the document to the national
e-invoicing hub on the seller's behalf and reads back the clearance, never
holding the authority session itself — while `CorrectionIssuer.issueCorrection`
composes the vendor's sibling `eCorrectiveInvoice` document kind directly. (See
the [README Integrations](../README.md#integrations) section.)

See [ADR-026](./architecture/adrs/026-country-agnostic-invoicing-domain.md) for
the country-agnostic invoicing design.

### `FiscalizationPort` (fiscalization) - 1

| Sub-capability | What it does | Method(s) | Guard |
|---|---|---|---|
| `FiscalRegistrationLocator` | Resolve an `in-doubt` outcome by querying the provider for a registration already made under this `(connectionId, idempotencyKey)` pair — never a resubmit. | `locateByQuery` | `isFiscalRegistrationLocator` |

**Adapter coverage:** eparagony.pl implements `FiscalRegistrationLocator`. No
device/peripheral sub-capability exists: `print`/`fiscalize` are booleans inside
the vendor's document payload, not separate operations, and no known adapter
exposes fiscal-printer control as a distinct call — see
[ADR-042 § Decision 5](./architecture/adrs/042-fiscalization-capability.md) for
why one was designed and then not built. A periodic journal/audit export
(`FiscalJournalExporter`) is the *named first extension point* for a future
adapter, not yet implemented by any shipped one.

See [ADR-042](./architecture/adrs/042-fiscalization-capability.md) for the
fiscalization capability design.

### `ProductMasterPort` (products) - 3

| Sub-capability | What it does | Method(s) | Guard |
|---|---|---|---|
| `BulkProductReader` | The bulk-read rung ([ADR-048](./architecture/adrs/048-incremental-catalog-replication.md)): prefetch many products in a few requests. A void warm-up, not a second sync path. Guard-only. | `prefetchProducts` | `isBulkProductReader` |
| `ProductTaxRateReader` | The master states the tax rate a product carries ([ADR-063](./architecture/adrs/063-per-line-tax-rate-resolution-and-provenance.md)); absence keeps the catalogue row "never checked" rather than "no rate". Guard-only. | `readProductTaxRate` · `readsTaxRatePerVariant?` | `isProductTaxRateReader` |
| `ModifiedProductLister` | The **modified-since rung** of the master capability ladder — enumerate only the external ids whose product record changed after a caller-supplied watermark, instead of the whole catalog. | `listExternalIdsModifiedSince` | `isModifiedProductLister` |

**Adapter coverage:** `ModifiedProductLister` - WooCommerce (`modified_after` +
`dates_are_gmt=true`, WC ≥ 5.8) and Shoper. `BulkProductReader` - PrestaShop and
Shoper. `ProductTaxRateReader` - PrestaShop, Shoper, Subiekt GT and WooCommerce. PrestaShop deliberately does **not** declare it: a combination write
does not bump the parent product's `date_upd`, and neither `ps_product_attribute`
nor `ps_stock_available` carries a mutation timestamp to union against, so a delta
path would look healthy while silently skipping every variant-level change
(measured in #2221 — see the ADR-048 amendment). A master declaring nothing stays
on the base port's enumerate-only behaviour, which is correct rather than degraded.

**Guard-only**, unlike the advertised-without-dispatch sub-capabilities above: this
name is absent from every adapter manifest and from `CoreCapabilityValues`, and is
resolved solely by narrowing a dispatched `ProductMaster` adapter. A connection's
`enabledCapabilities` is stamped at create and never retro-filled, so *gating* on a
newly advertised name would drain nothing for every connection that already exists;
not advertising it removes the temptation to gate on it. Consumers of the guard:
the worker's `master.product.syncDelta` handler and the catalog-trust read
(`CatalogTrustService`, #2258), which reports the declared rung to the operator.

Read caveat: the freshness reported is **product-level only**. A WooCommerce
variation edit does not bump the parent's `date_modified`
([WC #19562](https://github.com/woocommerce/woocommerce/issues/19562)), and stock
is not on this rung at all. See
[ADR-048](./architecture/adrs/048-incremental-catalog-replication.md).

### `InventoryMasterPort` (inventory) - 1

| Sub-capability | What it does | Method(s) | Guard |
|---|---|---|---|
| `BulkInventoryReader` | The bulk-read rung for stock (#2648): prefetch stock for many products in a few requests. A void warm-up; the per-product sync body still runs. Guard-only. | `prefetchInventory` | `isBulkInventoryReader` |

**Adapter coverage:** PrestaShop and Shoper.

### `FulfillmentExecutorPort` (fulfillment) - 1

| Sub-capability | What it does | Method(s) | Guard |
|---|---|---|---|
| `FulfillmentStatusSource` | The pull-shaped progress read for a fulfilment holder that is polled rather than pushing. Advertised-without-dispatch; the guard probes the method at runtime. Named `getWorkFulfillmentStatus` so the orders `FulfillmentStatusReader` probe cannot match it. | `getWorkFulfillmentStatus` | `isFulfillmentStatusSource` |

**Adapter coverage:** none. The OpenLinker OMS executor deliberately does not
implement it, because it would read its own counters back as observed progress.
The OMS package also carries one router-side sub-capability outside `libs/core`:
`DraftRuleEvaluator` (`libs/oms/src/routing/draft-rule-evaluator.capability.ts`,
#2954), which dry-runs an order through an unsaved routing ruleset.

### Sales documents (no base port) - 1

| Sub-capability | What it does | Method(s) | Guard |
|---|---|---|---|
| `SelfRoutingDocumentKind` | A document-issuing destination that decides its own originating-document kind at issuance, bypassing `resolveSalesDocumentRouting` ([ADR-041](./architecture/adrs/041-sales-document-routing-policy.md) decision 9). Not bound to one base port: it applies to `InvoicingPort` or `FiscalizationPort`. | `selfRoutesDocumentKind` (returns `true`) | `isSelfRoutingDocumentKind` |

**Adapter coverage:** none yet.

---

## Fulfillment authorities

Not a ports table. The six rows below are the **independently assignable
fulfillment authorities** of [ADR-052](./architecture/adrs/052-independently-assignable-fulfillment-authorities.md)
— "OMS" is not one thing a connection either holds or does not, it is authority
assigned per *what a party physically controls*. They appear here because this
is the developer-facing vocabulary reference, and because three of the six are
gated by a real adapter capability while three are named by configuration alone
(`config-only`) — a distinction a reader looking up a capability name needs.

`owningContext` names where resolution and enforcement live
([ADR-053](./architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md));
the vocabulary leaf itself imports nothing from those contexts. `fulfillment`
and `returns` now exist as core contexts (`libs/core/src/fulfillment`,
`libs/core/src/returns`).

> **Pinned.** This table is a mirror of `AuthorityKindValues` and
> `AUTHORITY_KIND_DESCRIPTORS` in
> `libs/core/src/fulfillment-authority/domain/types/authority-kind.types.ts`,
> enforced by `scripts/check-authority-kind-mirror.mjs` under
> `pnpm check:invariants`. The fenced comments below are the parser's boundary —
> do not remove them. If the table disagrees with the code, the code wins.

<!-- authority-kinds:start -->

| # | Kind | Capability | Config key | Owning context |
|---|---|---|---|---|
| A1 | `availability` | `AvailabilityAuthority` | `availabilityAuthority` | `inventory` |
| A2 | `sourcing` | `config-only` | `sourcingAuthority` | `fulfillment` |
| A3 | `fulfillment-execution` | `FulfillmentExecutor` | `fulfillmentExecutor` | `fulfillment` |
| A4 | `order-lifecycle` | `config-only` | `orderLifecycleAuthority` | `orders` |
| A5 | `returns-disposition` | `ReturnsAuthority` | `returnsAuthority` | `returns` |
| A6 | `refund-trigger` | `config-only` | `refundTrigger` | `orders` |

<!-- authority-kinds:end -->

**Seven questions, six kinds.** `AuthorityKindValues` above enumerates what can
be *assigned*; the operator-facing surface asks one more question — "who issues
invoices and receipts?" — whose answer is owned by the `sales-documents` context
(ADR-041) and is therefore reached by a link, never mirrored here. The question
space is its own vocabulary, `AuthorityQuestionValues` (#2351), and a spec pins
its six non-null kinds to this table's six, in order.

**A6 is never assignable away from OL** ([ADR-056](./architecture/adrs/056-refund-and-fiscal-authority-never-leave-ol.md)).
Its config key is read so an operator's claim is *observable*, never so it can be
honoured: an OMS requests a refund and OL executes or refuses with a persisted
reason.

**There is no A7 row.** ADR-052 enumerates six authorities with
invoicing/fiscalization "already resolved by ADR-041", whose router is shipped
code. A7 has an owning context already — `sales-documents` — so it carries no
`AuthorityKind` member. Do not "fix" the count to seven.

---

## Adding a capability or sub-capability

1. **Port** → `libs/core/src/<ctx>/domain/ports/<name>.port.ts`; export from the context barrel. If it should be registry-resolvable, decide whether it joins the closed `CoreCapabilityValues` set or stays an open-world string (#576).
2. **Sub-capability** → `libs/core/src/<ctx>/domain/ports/capabilities/<name>.capability.ts`: the interface **plus** the co-located `is{Capability}` guard. Export both from the context barrel.
3. **Update this file** in the same PR — add the row(s) above. The counts in each section heading are part of the contract; bump them.
