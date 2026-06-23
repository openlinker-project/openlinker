/**
 * Handler Registration Service
 *
 * Registers all sync job handlers with the handler registry on module initialization.
 * This service ensures handlers are registered before the job runner starts processing.
 *
 * @module apps/worker/src/sync/handlers
 */
import type { OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { SyncJobHandlerRegistry } from './sync-job-handler.registry';
import { InventoryPropagateToMarketplacesHandler } from './inventory-propagate-to-marketplaces.handler';
import { OrdersPollHandler } from './orders-poll.handler';
import { MarketplaceOrderSyncHandler } from './marketplace-order-sync.handler';
import { MarketplaceOfferQuantityUpdateHandler } from './marketplace-offer-quantity-update.handler';
import { MarketplaceOfferFieldUpdateHandler } from './marketplace-offer-field-update.handler';
import { MarketplaceOfferCreateHandler } from './marketplace-offer-create.handler';
import { MarketplaceOfferPollCreationStatusHandler } from './marketplace-offer-poll-creation-status.handler';
import { MarketplaceOffersSyncHandler } from './marketplace-offers-sync.handler';
import { MarketplaceOfferStatusSyncHandler } from './marketplace-offer-status-sync.handler';
import { MarketplaceOfferStockRestoreHandler } from './marketplace-offer-stock-restore.handler';
import { MarketplaceShipmentStatusSyncHandler } from './marketplace-shipment-status-sync.handler';
import { MarketplaceShipmentSyncByExternalIdHandler } from './marketplace-shipment-sync-by-external-id.handler';
import { MarketplaceFulfillmentStatusSyncHandler } from './marketplace-fulfillment-status-sync.handler';
import { MasterProductSyncHandler } from './master-product-sync.handler';
import { MasterInventorySyncHandler } from './master-inventory-sync.handler';
import { AutoMatchVariantsHandler } from './auto-match-variants.handler';
import { MasterInventorySyncAllHandler } from './master-inventory-sync-all.handler';
import { MasterProductSyncAllHandler } from './master-product-sync-all.handler';
import { PickupPointRefreshHandler } from './pickup-point-refresh.handler';
import { ShopProductPublishHandler } from './shop-product-publish.handler';
import { InvoicingIssueHandler } from './invoicing-issue.handler';

@Injectable()
export class HandlerRegistrationService implements OnModuleInit {
  constructor(
    private readonly handlerRegistry: SyncJobHandlerRegistry,
    private readonly inventoryPropagateHandler: InventoryPropagateToMarketplacesHandler,
    private readonly marketplaceOrdersPollHandler: OrdersPollHandler,
    private readonly marketplaceOrderSyncHandler: MarketplaceOrderSyncHandler,
    private readonly marketplaceOfferQuantityUpdateHandler: MarketplaceOfferQuantityUpdateHandler,
    private readonly marketplaceOfferFieldUpdateHandler: MarketplaceOfferFieldUpdateHandler,
    private readonly marketplaceOfferCreateHandler: MarketplaceOfferCreateHandler,
    private readonly marketplaceOfferPollCreationStatusHandler: MarketplaceOfferPollCreationStatusHandler,
    private readonly marketplaceOffersSyncHandler: MarketplaceOffersSyncHandler,
    private readonly marketplaceOfferStatusSyncHandler: MarketplaceOfferStatusSyncHandler,
    private readonly marketplaceOfferStockRestoreHandler: MarketplaceOfferStockRestoreHandler,
    private readonly marketplaceShipmentStatusSyncHandler: MarketplaceShipmentStatusSyncHandler,
    private readonly marketplaceShipmentSyncByExternalIdHandler: MarketplaceShipmentSyncByExternalIdHandler,
    private readonly marketplaceFulfillmentStatusSyncHandler: MarketplaceFulfillmentStatusSyncHandler,
    private readonly masterProductSyncHandler: MasterProductSyncHandler,
    private readonly masterInventorySyncHandler: MasterInventorySyncHandler,
    private readonly autoMatchVariantsHandler: AutoMatchVariantsHandler,
    private readonly masterInventorySyncAllHandler: MasterInventorySyncAllHandler,
    private readonly masterProductSyncAllHandler: MasterProductSyncAllHandler,
    private readonly pickupPointRefreshHandler: PickupPointRefreshHandler,
    private readonly shopProductPublishHandler: ShopProductPublishHandler,
    private readonly invoicingIssueHandler: InvoicingIssueHandler
  ) {}

  onModuleInit(): void {
    // Register generic marketplace handlers (Option B)
    this.handlerRegistry.register('marketplace.orders.poll', this.marketplaceOrdersPollHandler);
    this.handlerRegistry.register('marketplace.order.sync', this.marketplaceOrderSyncHandler);
    this.handlerRegistry.register('marketplace.offers.sync', this.marketplaceOffersSyncHandler);
    this.handlerRegistry.register(
      'marketplace.offerQuantity.update',
      this.marketplaceOfferQuantityUpdateHandler
    );
    this.handlerRegistry.register(
      'marketplace.offer.updateFields',
      this.marketplaceOfferFieldUpdateHandler
    );
    this.handlerRegistry.register('marketplace.offer.create', this.marketplaceOfferCreateHandler);
    this.handlerRegistry.register(
      'marketplace.offer.pollCreationStatus',
      this.marketplaceOfferPollCreationStatusHandler
    );
    this.handlerRegistry.register(
      'marketplace.offer.statusSync',
      this.marketplaceOfferStatusSyncHandler
    );
    this.handlerRegistry.register(
      'marketplace.offer.stockRestore',
      this.marketplaceOfferStockRestoreHandler
    );
    this.handlerRegistry.register(
      'marketplace.shipment.statusSync',
      this.marketplaceShipmentStatusSyncHandler
    );
    this.handlerRegistry.register(
      'marketplace.shipment.syncByExternalId',
      this.marketplaceShipmentSyncByExternalIdHandler
    );
    this.handlerRegistry.register(
      'marketplace.fulfillment.statusSync',
      this.marketplaceFulfillmentStatusSyncHandler
    );

    // Register generic master handlers (Option B)
    this.handlerRegistry.register('master.product.syncByExternalId', this.masterProductSyncHandler);
    this.handlerRegistry.register(
      'master.inventory.syncByExternalId',
      this.masterInventorySyncHandler
    );

    // Register auto-match variants handler
    this.handlerRegistry.register('master.variants.autoMatch', this.autoMatchVariantsHandler);

    // Register master inventory sync all handler (periodic full sync)
    this.handlerRegistry.register('master.inventory.syncAll', this.masterInventorySyncAllHandler);

    // Register master product sync all handler (catalog discovery / periodic full sync)
    this.handlerRegistry.register('master.product.syncAll', this.masterProductSyncAllHandler);

    // Register pickup-point background-refresh handler (#849, daily re-warm)
    this.handlerRegistry.register(
      'shipping.pickupPoint.refreshFrequent',
      this.pickupPointRefreshHandler
    );

    // Register inventory propagate to marketplaces handler
    this.handlerRegistry.register(
      'inventory.propagateToMarketplaces',
      this.inventoryPropagateHandler
    );

    // Register shop product publish handler (#1042, ADR-024)
    this.handlerRegistry.register('shop.product.publish', this.shopProductPublishHandler);

    // Register invoicing issue handler (OL #1120 — auto-issue trigger)
    this.handlerRegistry.register('invoicing.issue', this.invoicingIssueHandler);
  }
}
