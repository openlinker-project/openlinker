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
import { InventoryPropagateToMarketplacesHandler } from './inventory-propagate-to-marketplaces.handler';
import { MarketplaceOrdersPollHandler } from './marketplace-orders-poll.handler';
import { MarketplaceOrderSyncHandler } from './marketplace-order-sync.handler';
import { MarketplaceOfferQuantityUpdateHandler } from './marketplace-offer-quantity-update.handler';
import { MasterProductSyncHandler } from './master-product-sync.handler';
import { MasterInventorySyncHandler } from './master-inventory-sync.handler';

@Injectable()
export class HandlerRegistrationService implements OnModuleInit {
  constructor(
    private readonly handlerRegistry: SyncJobHandlerRegistry,
    private readonly inventoryPropagateHandler: InventoryPropagateToMarketplacesHandler,
    private readonly marketplaceOrdersPollHandler: MarketplaceOrdersPollHandler,
    private readonly marketplaceOrderSyncHandler: MarketplaceOrderSyncHandler,
    private readonly marketplaceOfferQuantityUpdateHandler: MarketplaceOfferQuantityUpdateHandler,
    private readonly masterProductSyncHandler: MasterProductSyncHandler,
    private readonly masterInventorySyncHandler: MasterInventorySyncHandler,
  ) {}

  onModuleInit(): void {
    // Register generic marketplace handlers (Option B)
    this.handlerRegistry.register('marketplace.orders.poll', this.marketplaceOrdersPollHandler);
    this.handlerRegistry.register('marketplace.order.sync', this.marketplaceOrderSyncHandler);
    this.handlerRegistry.register('marketplace.offerQuantity.update', this.marketplaceOfferQuantityUpdateHandler);

    // Register generic master handlers (Option B)
    this.handlerRegistry.register('master.product.syncByExternalId', this.masterProductSyncHandler);
    this.handlerRegistry.register('master.inventory.syncByExternalId', this.masterInventorySyncHandler);

    // Register inventory propagate to marketplaces handler
    this.handlerRegistry.register('inventory.propagateToMarketplaces', this.inventoryPropagateHandler);
  }
}

