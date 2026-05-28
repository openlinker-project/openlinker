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
import { OrdersModule } from '@openlinker/core/orders';
import { ListingsModule } from '@openlinker/core/listings/services';
import { ShippingModule } from '@openlinker/core/shipping';
import { WorkerContentModule } from '../content/worker-content.module';
import { JobIntakeConsumer } from './job-intake.consumer';
import { SyncJobRunner } from './sync-job.runner';
import { SyncJobHandlerRegistry } from './handlers/sync-job-handler.registry';
import { InventoryPropagateToMarketplacesHandler } from './handlers/inventory-propagate-to-marketplaces.handler';
import { OrdersPollHandler } from './handlers/orders-poll.handler';
import { MarketplaceOrderSyncHandler } from './handlers/marketplace-order-sync.handler';
import { MarketplaceOfferQuantityUpdateHandler } from './handlers/marketplace-offer-quantity-update.handler';
import { MarketplaceOfferFieldUpdateHandler } from './handlers/marketplace-offer-field-update.handler';
import { MarketplaceOfferCreateHandler } from './handlers/marketplace-offer-create.handler';
import { MarketplaceOfferPollCreationStatusHandler } from './handlers/marketplace-offer-poll-creation-status.handler';
import { MarketplaceOffersSyncHandler } from './handlers/marketplace-offers-sync.handler';
import { MarketplaceOfferStatusSyncHandler } from './handlers/marketplace-offer-status-sync.handler';
import { MarketplaceShipmentStatusSyncHandler } from './handlers/marketplace-shipment-status-sync.handler';
import { MasterProductSyncHandler } from './handlers/master-product-sync.handler';
import { MasterInventorySyncHandler } from './handlers/master-inventory-sync.handler';
import { AutoMatchVariantsHandler } from './handlers/auto-match-variants.handler';
import { MasterInventorySyncAllHandler } from './handlers/master-inventory-sync-all.handler';
import { MasterProductSyncAllHandler } from './handlers/master-product-sync-all.handler';
import { HandlerRegistrationService } from './handlers/handler-registration.service';

@Module({
  imports: [
    SyncModule, // Import SyncModule to access SYNC_JOB_REPOSITORY_TOKEN
    IntegrationsModule, // Import IntegrationsModule to access INTEGRATIONS_SERVICE_TOKEN
    IdentifierMappingModule, // Import IdentifierMappingModule to access IDENTIFIER_MAPPING_SERVICE_TOKEN
    ProductsModule, // Import ProductsModule to access PRODUCTS_SERVICE_TOKEN
    InventoryModule, // Import InventoryModule to access INVENTORY_SERVICE_TOKEN
    OrdersModule, // Import OrdersModule to access ORDER_SYNC_SERVICE_TOKEN
    ListingsModule, // Import ListingsModule to access OFFER_MAPPING_SYNC_SERVICE_TOKEN
    ShippingModule, // Import ShippingModule to access SHIPMENT_STATUS_SYNC_SERVICE_TOKEN (#838)
    WorkerContentModule, // Worker-side ContentModule for #737 — exposes CONTENT_SUGGESTION_SERVICE_TOKEN
  ],
  providers: [
    JobIntakeConsumer,
    SyncJobRunner,
    SyncJobHandlerRegistry,
    InventoryPropagateToMarketplacesHandler,
    OrdersPollHandler,
    MarketplaceOrderSyncHandler,
    MarketplaceOfferQuantityUpdateHandler,
    MarketplaceOfferFieldUpdateHandler,
    MarketplaceOfferCreateHandler,
    MarketplaceOfferPollCreationStatusHandler,
    MarketplaceOffersSyncHandler,
    MarketplaceOfferStatusSyncHandler,
    MarketplaceShipmentStatusSyncHandler,
    MasterProductSyncHandler,
    MasterInventorySyncHandler,
    AutoMatchVariantsHandler,
    MasterInventorySyncAllHandler,
    MasterProductSyncAllHandler,
    HandlerRegistrationService,
  ],
})
export class SyncWorkerModule {}

