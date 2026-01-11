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
import { ListingsModule } from '@openlinker/core/listings';
import { CustomersModule } from '@openlinker/core/customers';
import { AllegroIntegrationModule } from '@openlinker/integrations-allegro';
import { JobIntakeConsumer } from './job-intake.consumer';
import { SyncJobRunner } from './sync-job.runner';
import { SyncJobHandlerRegistry } from './handlers/sync-job-handler.registry';
import { PrestashopProductSyncHandler } from './handlers/prestashop-product-sync.handler';
import { PrestashopInventorySyncHandler } from './handlers/prestashop-inventory-sync.handler';
import { AllegroOrdersPollHandler } from './handlers/allegro-orders-poll.handler';
import { AllegroOrderSyncHandler } from './handlers/allegro-order-sync.handler';
import { AllegroOfferQuantityUpdateHandler } from './handlers/allegro-offer-quantity-update.handler';
import { InventoryPropagateToMarketplacesHandler } from './handlers/inventory-propagate-to-marketplaces.handler';
import { HandlerRegistrationService } from './handlers/handler-registration.service';

@Module({
  imports: [
    SyncModule, // Import SyncModule to access SYNC_JOB_REPOSITORY_TOKEN
    IntegrationsModule, // Import IntegrationsModule to access INTEGRATIONS_SERVICE_TOKEN
    IdentifierMappingModule, // Import IdentifierMappingModule to access IDENTIFIER_MAPPING_SERVICE_TOKEN
    ProductsModule, // Import ProductsModule to access PRODUCTS_SERVICE_TOKEN
    InventoryModule, // Import InventoryModule to access INVENTORY_SERVICE_TOKEN
    OrdersModule, // Import OrdersModule to access ORDER_SYNC_SERVICE_TOKEN
    ListingsModule, // Import ListingsModule to access OFFER_MAPPING_SERVICE_TOKEN
    CustomersModule, // Import CustomersModule to access OrderCustomerProjectionUpdaterService
    AllegroIntegrationModule, // Import AllegroIntegrationModule to access ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN
  ],
  providers: [
    JobIntakeConsumer,
    SyncJobRunner,
    SyncJobHandlerRegistry,
    PrestashopProductSyncHandler,
    PrestashopInventorySyncHandler,
    AllegroOrdersPollHandler,
    AllegroOrderSyncHandler,
    AllegroOfferQuantityUpdateHandler,
    InventoryPropagateToMarketplacesHandler,
    HandlerRegistrationService,
  ],
})
export class SyncWorkerModule {}

