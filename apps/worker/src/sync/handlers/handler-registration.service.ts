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
import { AllegroOrdersPollHandler } from './allegro-orders-poll.handler';
import { AllegroOrderSyncHandler } from './allegro-order-sync.handler';
import { AllegroOfferQuantityUpdateHandler } from './allegro-offer-quantity-update.handler';
import { InventoryPropagateToMarketplacesHandler } from './inventory-propagate-to-marketplaces.handler';

@Injectable()
export class HandlerRegistrationService implements OnModuleInit {
  constructor(
    private readonly handlerRegistry: SyncJobHandlerRegistry,
    private readonly productSyncHandler: PrestashopProductSyncHandler,
    private readonly inventorySyncHandler: PrestashopInventorySyncHandler,
    private readonly allegroOrdersPollHandler: AllegroOrdersPollHandler,
    private readonly allegroOrderSyncHandler: AllegroOrderSyncHandler,
    private readonly allegroOfferQuantityUpdateHandler: AllegroOfferQuantityUpdateHandler,
    private readonly inventoryPropagateHandler: InventoryPropagateToMarketplacesHandler,
  ) {}

  onModuleInit(): void {
    // Register PrestaShop product sync handler
    this.handlerRegistry.register('prestashop.product.syncByExternalId', this.productSyncHandler);

    // Register PrestaShop inventory sync handler
    this.handlerRegistry.register('prestashop.inventory.syncByExternalId', this.inventorySyncHandler);

    // Register Allegro orders poll handler
    this.handlerRegistry.register('allegro.orders.poll', this.allegroOrdersPollHandler);

    // Register Allegro order sync handler
    this.handlerRegistry.register('allegro.order.syncByCheckoutFormId', this.allegroOrderSyncHandler);

    // Register Allegro offer quantity update handler
    this.handlerRegistry.register('allegro.offerQuantity.update', this.allegroOfferQuantityUpdateHandler);

    // Register inventory propagate to marketplaces handler
    this.handlerRegistry.register('inventory.propagateToMarketplaces', this.inventoryPropagateHandler);
  }
}

