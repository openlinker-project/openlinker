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
import { MarketplaceOfferFieldUpdateHandler } from './marketplace-offer-field-update.handler';
import { MarketplaceOfferCreateHandler } from './marketplace-offer-create.handler';
import { MarketplaceOffersSyncHandler } from './marketplace-offers-sync.handler';
import { MasterProductSyncHandler } from './master-product-sync.handler';
import { MasterInventorySyncHandler } from './master-inventory-sync.handler';
import { AutoMatchVariantsHandler } from './auto-match-variants.handler';
import { MasterInventorySyncAllHandler } from './master-inventory-sync-all.handler';
import { MasterProductSyncAllHandler } from './master-product-sync-all.handler';

@Injectable()
export class HandlerRegistrationService implements OnModuleInit {
  constructor(
    private readonly handlerRegistry: SyncJobHandlerRegistry,
    private readonly inventoryPropagateHandler: InventoryPropagateToMarketplacesHandler,
    private readonly marketplaceOrdersPollHandler: MarketplaceOrdersPollHandler,
    private readonly marketplaceOrderSyncHandler: MarketplaceOrderSyncHandler,
    private readonly marketplaceOfferQuantityUpdateHandler: MarketplaceOfferQuantityUpdateHandler,
    private readonly marketplaceOfferFieldUpdateHandler: MarketplaceOfferFieldUpdateHandler,
    private readonly marketplaceOfferCreateHandler: MarketplaceOfferCreateHandler,
    private readonly marketplaceOffersSyncHandler: MarketplaceOffersSyncHandler,
    private readonly masterProductSyncHandler: MasterProductSyncHandler,
    private readonly masterInventorySyncHandler: MasterInventorySyncHandler,
    private readonly autoMatchVariantsHandler: AutoMatchVariantsHandler,
    private readonly masterInventorySyncAllHandler: MasterInventorySyncAllHandler,
    private readonly masterProductSyncAllHandler: MasterProductSyncAllHandler,
  ) {}

  onModuleInit(): void {
    // Register generic marketplace handlers (Option B)
    this.handlerRegistry.register('marketplace.orders.poll', this.marketplaceOrdersPollHandler);
    this.handlerRegistry.register('marketplace.order.sync', this.marketplaceOrderSyncHandler);
    this.handlerRegistry.register('marketplace.offers.sync', this.marketplaceOffersSyncHandler);
    this.handlerRegistry.register('marketplace.offerQuantity.update', this.marketplaceOfferQuantityUpdateHandler);
    this.handlerRegistry.register('marketplace.offer.updateFields', this.marketplaceOfferFieldUpdateHandler);
    this.handlerRegistry.register('marketplace.offer.create', this.marketplaceOfferCreateHandler);

    // Register generic master handlers (Option B)
    this.handlerRegistry.register('master.product.syncByExternalId', this.masterProductSyncHandler);
    this.handlerRegistry.register('master.inventory.syncByExternalId', this.masterInventorySyncHandler);

    // Register auto-match variants handler
    this.handlerRegistry.register('master.variants.autoMatch', this.autoMatchVariantsHandler);

    // Register master inventory sync all handler (periodic full sync)
    this.handlerRegistry.register('master.inventory.syncAll', this.masterInventorySyncAllHandler);

    // Register master product sync all handler (catalog discovery / periodic full sync)
    this.handlerRegistry.register('master.product.syncAll', this.masterProductSyncAllHandler);

    // Register inventory propagate to marketplaces handler
    this.handlerRegistry.register('inventory.propagateToMarketplaces', this.inventoryPropagateHandler);
  }
}

