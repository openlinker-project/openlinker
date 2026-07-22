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
| `InventoryMasterPort` | inventory | `InventoryMaster` | Source of truth for stock levels; carries the (largely dormant) reservation surface. | `getInventory` · `listInventory` · `adjustInventory` · `reserveInventory` · `releaseInventory` · `getAvailableQuantity` |
| `OrderSourcePort` | orders | `OrderSource` | Cursor-based, read-only ingestion of orders from any source (marketplace journal or shop watermark). | `listOrderFeed` · `getOrder` |
| `OrderProcessorManagerPort` | orders | `OrderProcessorManager` | Create orders on a destination shop. | `createOrder` |
| `OfferManagerPort` | listings | `OfferManager` | Manage marketplace offers/listings; base contract is the inventory-driven quantity update. | `updateOfferQuantity` |
| `ShopProductManagerPort` | listings | `ProductPublisher` | Publish a product as a native listing on a shop (the shop-publish flow). | `publishProduct` |
| `ShippingProviderManagerPort` | shipping | `ShippingProviderManager` *(open-world — see note)* | Generate shipping labels, read tracking, and list supported shipping methods. | `generateLabel` · `getTracking` · `getSupportedMethods` |
| `InvoicingPort` | invoicing | `Invoicing` | Issue fiscal documents, fetch them, upsert a customer, and report supported document types. | `issueInvoice` · `getInvoice` · `upsertCustomer` · `getSupportedDocumentTypes` |
| `ContentPublisherPort` | content | *(internal — not registry-resolved)* | Publish a content field (e.g. a product description) to a channel or the master. | `publish` |

**Open-world capability vocabulary (#576).** The closed, well-known set is
`CoreCapabilityValues` = `ProductMaster`, `InventoryMaster`, `OrderSource`,
`OrderProcessorManager`, `OfferManager`, `ProductPublisher`,
`CategoryProvisioner`, `Invoicing`. Adapters may register **additional**
capability strings at runtime without a core change — `ShippingProviderManager`
is the live example (declared in the InPost / DPD / Allegro manifests, resolved
through the registry, but intentionally *not* a member of the closed set). The
runtime gate validates a connection's request against the adapter's
`supportedCapabilities`, not against the closed union.

> **Which integration implements what** is each adapter's own declaration: its
> `supportedCapabilities` manifest (`libs/integrations/<p>/src/<p>-plugin.ts`) is
> the source of truth, and the capability-level showcase across all integrations
> lives in the [root README](../README.md#capabilities). This file stays the
> platform-neutral *vocabulary* — the ports and sub-capabilities themselves.

---

## Sub-capabilities

Each is an independent interface + co-located `is{Capability}` guard. Adapters
declare what they support via `implements <BasePort>, <SubCapability>, …`.

### `OfferManagerPort` (listings) — 18

| Sub-capability | What it does | Method(s) | Guard |
|---|---|---|---|
| `OfferLister` | Page through the seller's existing offers. | `listOffers` | `isOfferLister` |
| `OfferReader` | Fetch a single offer by external id. | `getOffer` | `isOfferReader` |
| `OfferEventReader` | Read the marketplace's incremental offer-event journal. | `listOfferEvents` | `isOfferEventReader` |
| `OfferCreator` | Create a new offer / listing. | `createOffer` | `isOfferCreator` |
| `OfferFieldUpdater` | Partially update offer fields (e.g. description text). | `updateOfferFields` | `isOfferFieldUpdater` |
| `OfferStatusReader` | Read an offer's live publication status. | `getOfferStatus` | `isOfferStatusReader` |
| `OfferStockRestorer` | Restore offer stock after a cancellation. | `restoreStockOnCancellation` | `isOfferStockRestorer` |
| `OfferQuantityBatchUpdater` | Bulk-update quantities for many offers in one call. | `updateOfferQuantitiesBatch` | `isOfferQuantityBatchUpdater` |
| `OfferSmartClassificationReader` | Fetch the marketplace's smart/auto classification for an offer. | `getOfferSmartClassification` | `isOfferSmartClassificationReader` |
| `CategoryBrowser` | Browse the marketplace category tree. | `fetchCategories` | `isCategoryBrowser` |
| `CategoryBarcodeMatcher` | Auto-detect a category from a product barcode. | `matchCategoryByBarcode` | `isCategoryBarcodeMatcher` |
| `CategoryParametersReader` | Read the parameter schema a category requires. | `fetchCategoryParameters` | `isCategoryParametersReader` |
| `EanCategoryMatcher` | Resolve categories for a batch of products by EAN. | `resolveCategoriesForBatchByEan` | `isEanCategoryMatcher` |
| `CatalogProductReader` | Look up marketplace catalog products by barcode / id. | `findProductsByBarcode` · `getProduct` | `isCatalogProductReader` |
| `SellerPoliciesReader` | Surface the seller's saved return / shipping / warranty policies. | `fetchSellerPolicies` | `isSellerPoliciesReader` |
| `ResponsibleProducerReader` | List GPSR responsible-producer entries. | `fetchResponsibleProducers` | `isResponsibleProducerReader` |
| `SafetyAttachmentUploader` | Upload a GPSR safety attachment (manual, label, …). | `uploadSafetyAttachment` | `isSafetyAttachmentUploader` |
| `TaxonomyBorrower` | Reuse another platform's resolved taxonomy for a destination. | `getBorrowedTaxonomy` | `isTaxonomyBorrower` |

**Adapter coverage:** Allegro implements every sub-capability except
`OfferQuantityBatchUpdater` (see the [README Implementations](../README.md#implementations)
section); Erli implements a reconciliation-first subset
([ADR-025](./architecture/adrs/025-erli-marketplace-adapter.md)).

### `ShopProductManagerPort` (listings) — 1

| Sub-capability | What it does | Method(s) | Guard |
|---|---|---|---|
| `CategoryProvisioner` | Create / ensure a category exists on the destination shop before publishing. Also a registry-level capability (`CategoryProvisioner` ∈ `CoreCapabilityValues`). | `provisionCategory` | `isCategoryProvisioner` |

### `OrderProcessorManagerPort` / `OrderSourcePort` (orders) — 5

| Sub-capability | What it does | Method(s) | Guard |
|---|---|---|---|
| `OrderFulfillmentUpdater` | Push a post-create status + tracking update to a destination order. | `updateFulfillment` | `isOrderFulfillmentUpdater` |
| `OrderStatusWriteback` | Relay an order-status change back to the originating marketplace (event-as-data). | `write` | `isOrderStatusWriteback` |
| `FulfillmentStatusReader` | Read a destination order's current fulfillment status. | `getFulfillmentStatus` | `isFulfillmentStatusReader` |
| `DestinationOptionsReader` | List a destination's carriers / order-statuses / payment-methods for mapping. | `listCarriers` · `listOrderStatuses` · `listPaymentMethods` | `isDestinationOptionsReader` |
| `SourceOptionsReader` | List a source's order-statuses / delivery-methods / payment-methods for mapping. | `listOrderStatuses` · `listDeliveryMethods` · `listPaymentMethods` | `isSourceOptionsReader` |

The canonical OL-owned order-lifecycle state machine (authoritative
`updateOrderStatus` / `cancelOrder` / `processReturn` / `getOrders`) is
**deferred** — see [#1032](https://github.com/openlinker-project/openlinker/issues/1032).

### `ShippingProviderManagerPort` (shipping) — 4

| Sub-capability | What it does | Method(s) | Guard |
|---|---|---|---|
| `LabelDocumentReader` | Fetch the label document for an already-registered shipment. | `fetchLabel` | `isLabelDocumentReader` |
| `DispatchProtocolReader` | Generate a handover / dispatch protocol for a batch of shipments. | `generateProtocol` | `isDispatchProtocolReader` |
| `PickupPointFinder` | Search the carrier's pickup points / lockers (e.g. Paczkomat). | `findPickupPoints` | `isPickupPointFinder` |
| `ShipmentCanceller` | Cancel / void a registered shipment. | `cancelShipment` | `isShipmentCanceller` |

### `InvoicingPort` (invoicing) — 13

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
| `DocumentNumberConsumer` | Marker: the adapter relies on OpenLinker to allocate the legal, sequential document number from the connection's numbering series (OL-numbered provider, e.g. KSeF FA(3) `P_2`). Providers that number documents themselves (inFakt/Subiekt) do NOT implement it. | `consumesDocumentNumber` (marker) · `numberingTimeZone` · `maxDocumentNumberLength?` | `isDocumentNumberConsumer` |

See [ADR-026](./architecture/adrs/026-country-agnostic-invoicing-domain.md) for
the country-agnostic invoicing design.

---

## Adding a capability or sub-capability

1. **Port** → `libs/core/src/<ctx>/domain/ports/<name>.port.ts`; export from the context barrel. If it should be registry-resolvable, decide whether it joins the closed `CoreCapabilityValues` set or stays an open-world string (#576).
2. **Sub-capability** → `libs/core/src/<ctx>/domain/ports/capabilities/<name>.capability.ts`: the interface **plus** the co-located `is{Capability}` guard. Export both from the context barrel.
3. **Update this file** in the same PR — add the row(s) above. The counts in each section heading are part of the contract; bump them.
