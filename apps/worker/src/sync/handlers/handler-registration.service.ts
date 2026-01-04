/**
 * Handler Registration Service
 *
 * Registers all sync job handlers with the handler registry on module initialization.
 * This service ensures handlers are registered before the job runner starts processing.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { SyncJobHandlerRegistry } from './sync-job-handler.registry';
import { PrestashopProductSyncHandler } from './prestashop-product-sync.handler';
import { PrestashopInventorySyncHandler } from './prestashop-inventory-sync.handler';

@Injectable()
export class HandlerRegistrationService implements OnModuleInit {
  constructor(
    private readonly handlerRegistry: SyncJobHandlerRegistry,
    private readonly productSyncHandler: PrestashopProductSyncHandler,
    private readonly inventorySyncHandler: PrestashopInventorySyncHandler,
  ) {}

  onModuleInit(): void {
    // Register PrestaShop product sync handler
    this.handlerRegistry.register('prestashop.product.syncByExternalId', this.productSyncHandler);

    // Register PrestaShop inventory sync handler
    this.handlerRegistry.register('prestashop.inventory.syncByExternalId', this.inventorySyncHandler);
  }
}

