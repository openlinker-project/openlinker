/**
 * Sync Worker Module
 *
 * NestJS module for worker-specific sync functionality. Registers job intake
 * consumer, job runner, handler registry, job handlers, and handler registration service.
 *
 * @module apps/worker/src/sync
 */
import { Module } from '@nestjs/common';
import { SyncModule } from '@openlinker/core/sync';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { ProductsModule } from '@openlinker/core/products';
import { InventoryModule } from '@openlinker/core/inventory';
import { OperationalSettingsModule } from '@openlinker/core/operational-settings';
import { OrdersModule } from '@openlinker/core/orders';
import { ListingsModule } from '@openlinker/core/listings/services';
import { ShippingModule } from '@openlinker/core/shipping';
import { InvoicingModule } from '@openlinker/core/invoicing';
import { FiscalizationModule } from '@openlinker/core/fiscalization';
import { WorkerContentModule } from '../content/worker-content.module';
import { JobIntakeConsumer } from './job-intake.consumer';
import { SyncJobRunner } from './sync-job.runner';
import { SyncJobHandlerRegistry } from './handlers/sync-job-handler.registry';
import { InventoryPropagateToMarketplacesHandler } from './handlers/inventory-propagate-to-marketplaces.handler';
import { OrdersPollHandler } from './handlers/orders-poll.handler';
import { MarketplaceOrderSyncHandler } from './handlers/marketplace-order-sync.handler';
import { MarketplaceOrderFxStampHandler } from './handlers/marketplace-order-fx-stamp.handler';
import { MarketplaceOrderFxStampSweepHandler } from './handlers/marketplace-order-fx-stamp-sweep.handler';
import { OrdersTaxRateBackfillHandler } from './handlers/orders-tax-rate-backfill.handler';
import { MarketplaceOfferQuantityUpdateHandler } from './handlers/marketplace-offer-quantity-update.handler';
import { MarketplaceOfferFieldUpdateHandler } from './handlers/marketplace-offer-field-update.handler';
import { MarketplaceOfferCreateHandler } from './handlers/marketplace-offer-create.handler';
import { MarketplaceOfferPollCreationStatusHandler } from './handlers/marketplace-offer-poll-creation-status.handler';
import { MarketplaceOffersSyncHandler } from './handlers/marketplace-offers-sync.handler';
import { MarketplaceOfferStatusSyncHandler } from './handlers/marketplace-offer-status-sync.handler';
import { MarketplaceOfferRefreshSnapshotHandler } from './handlers/marketplace-offer-refresh-snapshot.handler';
import { MarketplaceOfferStockRestoreHandler } from './handlers/marketplace-offer-stock-restore.handler';
import { MarketplaceOfferPauseStaleHandler } from './handlers/marketplace-offer-pause-stale.handler';
import { MarketplaceOfferPauseStaleSweepHandler } from './handlers/marketplace-offer-pause-stale-sweep.handler';
import { MarketplaceShipmentStatusSyncHandler } from './handlers/marketplace-shipment-status-sync.handler';
import { MarketplaceShipmentSyncByExternalIdHandler } from './handlers/marketplace-shipment-sync-by-external-id.handler';
import { MarketplaceFulfillmentStatusSyncHandler } from './handlers/marketplace-fulfillment-status-sync.handler';
import { MasterProductSyncHandler } from './handlers/master-product-sync.handler';
import { MasterProductSyncBatchHandler } from './handlers/master-product-sync-batch.handler';
import { MasterInventorySyncHandler } from './handlers/master-inventory-sync.handler';
import { MasterInventorySyncBatchHandler } from './handlers/master-inventory-sync-batch.handler';
import { AutoMatchVariantsHandler } from './handlers/auto-match-variants.handler';
import { MasterInventorySyncAllHandler } from './handlers/master-inventory-sync-all.handler';
import { MasterProductSyncAllHandler } from './handlers/master-product-sync-all.handler';
import { MasterProductSyncDeltaHandler } from './handlers/master-product-sync-delta.handler';
import { MasterProductReconcileHandler } from './handlers/master-product-reconcile.handler';
import { PickupPointRefreshHandler } from './handlers/pickup-point-refresh.handler';
import { ShopProductPublishHandler } from './handlers/shop-product-publish.handler';
import { ShopProductStatusSyncHandler } from './handlers/shop-product-status-sync.handler';
import { DestinationTaxonomySyncHandler } from './handlers/destination-taxonomy-sync.handler';
import { InvoicingIssueHandler } from './handlers/invoicing-issue.handler';
import { FiscalizationRegisterHandler } from './handlers/fiscalization-register.handler';
import { RegulatoryStatusReconcileHandler } from './handlers/regulatory-status-reconcile.handler';
import { OfflineResubmitHandler } from './handlers/offline-resubmit.handler';
import { PendingRecoveryHandler } from './handlers/pending-recovery.handler';
import { PaymentStatusRefreshHandler } from './handlers/payment-status-refresh.handler';
import { HandlerRegistrationService } from './handlers/handler-registration.service';

@Module({
  imports: [
    SyncModule, // Import SyncModule to access SYNC_JOB_REPOSITORY_TOKEN
    IntegrationsModule, // Import IntegrationsModule to access INTEGRATIONS_SERVICE_TOKEN
    IdentifierMappingModule, // Import IdentifierMappingModule to access IDENTIFIER_MAPPING_SERVICE_TOKEN
    ProductsModule, // Import ProductsModule to access PRODUCTS_SERVICE_TOKEN
    InventoryModule, // Import InventoryModule to access INVENTORY_SERVICE_TOKEN
    OperationalSettingsModule, // #2651 — operator-settable sweep budgets, read per tick by the sweep handlers
    OrdersModule, // Import OrdersModule to access ORDER_SYNC_SERVICE_TOKEN
    ListingsModule, // Import ListingsModule to access OFFER_MAPPING_SYNC_SERVICE_TOKEN
    ShippingModule, // Import ShippingModule to access SHIPMENT_STATUS_SYNC_SERVICE_TOKEN (#838)
    InvoicingModule, // OL #1120/#1121 — exposes INVOICE_SERVICE_TOKEN + AUTO_ISSUE_TRIGGER_SERVICE_TOKEN (OrderIngestionService) + REGULATORY_STATUS_RECONCILIATION_SERVICE_TOKEN
    FiscalizationModule, // #2156 — exposes FISCAL_REGISTRATION_SERVICE_TOKEN for the fiscalization.register handler
    WorkerContentModule, // Worker-side ContentModule for #737 — exposes CONTENT_SUGGESTION_SERVICE_TOKEN
  ],
  providers: [
    JobIntakeConsumer,
    SyncJobRunner,
    SyncJobHandlerRegistry,
    InventoryPropagateToMarketplacesHandler,
    OrdersPollHandler,
    MarketplaceOrderSyncHandler,
    MarketplaceOrderFxStampHandler,
    MarketplaceOrderFxStampSweepHandler,
    OrdersTaxRateBackfillHandler,
    MarketplaceOfferQuantityUpdateHandler,
    MarketplaceOfferFieldUpdateHandler,
    MarketplaceOfferCreateHandler,
    MarketplaceOfferPollCreationStatusHandler,
    MarketplaceOffersSyncHandler,
    MarketplaceOfferStatusSyncHandler,
    MarketplaceOfferRefreshSnapshotHandler,
    MarketplaceOfferStockRestoreHandler,
    MarketplaceOfferPauseStaleHandler,
    MarketplaceOfferPauseStaleSweepHandler,
    MarketplaceShipmentStatusSyncHandler,
    MarketplaceShipmentSyncByExternalIdHandler,
    MarketplaceFulfillmentStatusSyncHandler,
    MasterProductSyncHandler,
    MasterProductSyncBatchHandler,
    MasterInventorySyncHandler,
    MasterInventorySyncBatchHandler,
    AutoMatchVariantsHandler,
    MasterInventorySyncAllHandler,
    MasterProductSyncAllHandler,
    MasterProductSyncDeltaHandler,
    MasterProductReconcileHandler,
    PickupPointRefreshHandler,
    ShopProductPublishHandler,
    ShopProductStatusSyncHandler,
    DestinationTaxonomySyncHandler,
    InvoicingIssueHandler,
    FiscalizationRegisterHandler,
    RegulatoryStatusReconcileHandler,
    OfflineResubmitHandler,
    PendingRecoveryHandler,
    PaymentStatusRefreshHandler,
    HandlerRegistrationService,
  ],
})
export class SyncWorkerModule {}

