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
import { MarketplaceOrderFxStampHandler } from './marketplace-order-fx-stamp.handler';
import { MarketplaceOrderFxStampSweepHandler } from './marketplace-order-fx-stamp-sweep.handler';
import { MarketplaceReturnsPollHandler } from './marketplace-returns-poll.handler';
import { MarketplaceReturnSyncHandler } from './marketplace-return-sync.handler';
import { MarketplaceReturnsStatusSyncHandler } from './marketplace-returns-status-sync.handler';
import { ReturnsOrphanReconcileHandler } from './returns-orphan-reconcile.handler';
import { OrdersTaxRateBackfillHandler } from './orders-tax-rate-backfill.handler';
import { MarketplaceOfferQuantityUpdateHandler } from './marketplace-offer-quantity-update.handler';
import { MarketplaceOfferFieldUpdateHandler } from './marketplace-offer-field-update.handler';
import { MarketplaceOfferCreateHandler } from './marketplace-offer-create.handler';
import { MarketplaceOfferPollCreationStatusHandler } from './marketplace-offer-poll-creation-status.handler';
import { MarketplaceOffersSyncHandler } from './marketplace-offers-sync.handler';
import { MarketplaceOfferStatusSyncHandler } from './marketplace-offer-status-sync.handler';
import { MarketplaceOfferRefreshSnapshotHandler } from './marketplace-offer-refresh-snapshot.handler';
import { MarketplaceOfferStockRestoreHandler } from './marketplace-offer-stock-restore.handler';
import { MarketplaceOfferPauseStaleHandler } from './marketplace-offer-pause-stale.handler';
import { MarketplaceOfferPauseStaleSweepHandler } from './marketplace-offer-pause-stale-sweep.handler';
import { MarketplaceShipmentStatusSyncHandler } from './marketplace-shipment-status-sync.handler';
import { MarketplaceShipmentSyncByExternalIdHandler } from './marketplace-shipment-sync-by-external-id.handler';
import { MarketplaceFulfillmentStatusSyncHandler } from './marketplace-fulfillment-status-sync.handler';
import { MasterProductSyncHandler } from './master-product-sync.handler';
import { MasterInventorySyncHandler } from './master-inventory-sync.handler';
import { AutoMatchVariantsHandler } from './auto-match-variants.handler';
import { MasterInventorySyncAllHandler } from './master-inventory-sync-all.handler';
import { MasterProductSyncAllHandler } from './master-product-sync-all.handler';
import { MasterProductSyncDeltaHandler } from './master-product-sync-delta.handler';
import { MasterProductReconcileHandler } from './master-product-reconcile.handler';
import { InventoryProvenanceBackfillHandler } from './inventory-provenance-backfill.handler';
import { OrdersHoldsReconcileHandler } from './orders-holds-reconcile.handler';
import { PickupPointRefreshHandler } from './pickup-point-refresh.handler';
import { ShopProductPublishHandler } from './shop-product-publish.handler';
import { ShopProductStatusSyncHandler } from './shop-product-status-sync.handler';
import { DestinationTaxonomySyncHandler } from './destination-taxonomy-sync.handler';
import { InvoicingIssueHandler } from './invoicing-issue.handler';
import { FiscalizationRegisterHandler } from './fiscalization-register.handler';
import { RegulatoryStatusReconcileHandler } from './regulatory-status-reconcile.handler';
import { OfflineResubmitHandler } from './offline-resubmit.handler';
import { PendingRecoveryHandler } from './pending-recovery.handler';
import { PaymentStatusRefreshHandler } from './payment-status-refresh.handler';

@Injectable()
export class HandlerRegistrationService implements OnModuleInit {
  constructor(
    private readonly handlerRegistry: SyncJobHandlerRegistry,
    private readonly inventoryPropagateHandler: InventoryPropagateToMarketplacesHandler,
    private readonly inventoryProvenanceBackfillHandler: InventoryProvenanceBackfillHandler,
    private readonly ordersHoldsReconcileHandler: OrdersHoldsReconcileHandler,
    private readonly marketplaceOrdersPollHandler: OrdersPollHandler,
    private readonly marketplaceOrderSyncHandler: MarketplaceOrderSyncHandler,
    private readonly marketplaceOrderFxStampHandler: MarketplaceOrderFxStampHandler,
    private readonly marketplaceOrderFxStampSweepHandler: MarketplaceOrderFxStampSweepHandler,
    private readonly marketplaceReturnsPollHandler: MarketplaceReturnsPollHandler,
    private readonly marketplaceReturnSyncHandler: MarketplaceReturnSyncHandler,
    private readonly marketplaceReturnsStatusSyncHandler: MarketplaceReturnsStatusSyncHandler,
    private readonly returnsOrphanReconcileHandler: ReturnsOrphanReconcileHandler,
    private readonly ordersTaxRateBackfillHandler: OrdersTaxRateBackfillHandler,
    private readonly marketplaceOfferQuantityUpdateHandler: MarketplaceOfferQuantityUpdateHandler,
    private readonly marketplaceOfferFieldUpdateHandler: MarketplaceOfferFieldUpdateHandler,
    private readonly marketplaceOfferCreateHandler: MarketplaceOfferCreateHandler,
    private readonly marketplaceOfferPollCreationStatusHandler: MarketplaceOfferPollCreationStatusHandler,
    private readonly marketplaceOffersSyncHandler: MarketplaceOffersSyncHandler,
    private readonly marketplaceOfferStatusSyncHandler: MarketplaceOfferStatusSyncHandler,
    private readonly marketplaceOfferRefreshSnapshotHandler: MarketplaceOfferRefreshSnapshotHandler,
    private readonly marketplaceOfferStockRestoreHandler: MarketplaceOfferStockRestoreHandler,
    private readonly marketplaceOfferPauseStaleHandler: MarketplaceOfferPauseStaleHandler,
    private readonly marketplaceOfferPauseStaleSweepHandler: MarketplaceOfferPauseStaleSweepHandler,
    private readonly marketplaceShipmentStatusSyncHandler: MarketplaceShipmentStatusSyncHandler,
    private readonly marketplaceShipmentSyncByExternalIdHandler: MarketplaceShipmentSyncByExternalIdHandler,
    private readonly marketplaceFulfillmentStatusSyncHandler: MarketplaceFulfillmentStatusSyncHandler,
    private readonly masterProductSyncHandler: MasterProductSyncHandler,
    private readonly masterInventorySyncHandler: MasterInventorySyncHandler,
    private readonly autoMatchVariantsHandler: AutoMatchVariantsHandler,
    private readonly masterInventorySyncAllHandler: MasterInventorySyncAllHandler,
    private readonly masterProductSyncAllHandler: MasterProductSyncAllHandler,
    private readonly masterProductSyncDeltaHandler: MasterProductSyncDeltaHandler,
    private readonly masterProductReconcileHandler: MasterProductReconcileHandler,
    private readonly pickupPointRefreshHandler: PickupPointRefreshHandler,
    private readonly shopProductPublishHandler: ShopProductPublishHandler,
    private readonly shopProductStatusSyncHandler: ShopProductStatusSyncHandler,
    private readonly destinationTaxonomySyncHandler: DestinationTaxonomySyncHandler,
    private readonly invoicingIssueHandler: InvoicingIssueHandler,
    private readonly fiscalizationRegisterHandler: FiscalizationRegisterHandler,
    private readonly regulatoryStatusReconcileHandler: RegulatoryStatusReconcileHandler,
    private readonly offlineResubmitHandler: OfflineResubmitHandler,
    private readonly pendingRecoveryHandler: PendingRecoveryHandler,
    private readonly paymentStatusRefreshHandler: PaymentStatusRefreshHandler
  ) {}

  onModuleInit(): void {
    // Every registration declares its ADR-050 concurrency lane (#2278). The
    // lane is chosen by cost-of-starvation, never by I/O shape or bounded
    // context — the authoritative table is ADR-050 decision 1, now 13 realtime /
    // 16 bulk / 5 fiscal / 7 fan-out: `fiscalization.register` joined `fiscal`
    // post-ADR (#2156), `inventory.provenance.backfill` joined `bulk` (#2317),
    // the three returns types joined realtime/bulk/fan-out (#2330),
    // `returns.orphan.reconcile` joined `bulk` (#2332), and
    // `orders.taxRate.backfill` joined `bulk` (#2440), and
    // `orders.holds.reconcile` joined `bulk` (#2340). The
    // tripwire in `handler-registration.service.spec.ts` is the authority on
    // these counts — this comment had drifted from it before #2330.

    // Register generic marketplace handlers (Option B)
    this.handlerRegistry.register(
      'marketplace.orders.poll',
      this.marketplaceOrdersPollHandler,
      'fan-out'
    );
    this.handlerRegistry.register(
      'marketplace.order.sync',
      this.marketplaceOrderSyncHandler,
      'realtime'
    );
    // Per-order reporting-currency stamp: bounded retry + hourly reconcile (#2125).
    this.handlerRegistry.register(
      'marketplace.order.fxStamp',
      this.marketplaceOrderFxStampHandler,
      'realtime'
    );
    this.handlerRegistry.register(
      'marketplace.order.fxStampSweep',
      this.marketplaceOrderFxStampSweepHandler,
      'bulk'
    );
    // Returns ingestion (#2330). The lanes mirror the order path they were
    // modelled on, and for the same cost-of-starvation reason: discovery fans
    // out (`fan-out`), the per-return child is the unit a buyer is waiting on
    // (`realtime`), and the lifecycle re-read is a paced background sweep whose
    // lateness costs nobody a request (`bulk`).
    this.handlerRegistry.register(
      'marketplace.returns.poll',
      this.marketplaceReturnsPollHandler,
      'fan-out'
    );
    this.handlerRegistry.register(
      'marketplace.return.sync',
      this.marketplaceReturnSyncHandler,
      'realtime'
    );
    this.handlerRegistry.register(
      'marketplace.returns.statusSync',
      this.marketplaceReturnsStatusSyncHandler,
      'bulk'
    );
    // Orphan re-attribution (#2332). `bulk`, and the cost-of-starvation reasoning is
    // sharper here than for its siblings: this pass is catch-up work whose lateness costs
    // nobody a request, and the pass that RESOLVES its orphans is `realtime` order
    // ingestion — so it must never contend with the very work that gives it something to
    // do.
    this.handlerRegistry.register(
      'returns.orphan.reconcile',
      this.returnsOrphanReconcileHandler,
      'bulk'
    );
    this.handlerRegistry.register(
      'marketplace.offers.sync',
      this.marketplaceOffersSyncHandler,
      'bulk'
    );
    this.handlerRegistry.register(
      'marketplace.offerQuantity.update',
      this.marketplaceOfferQuantityUpdateHandler,
      'realtime'
    );
    this.handlerRegistry.register(
      'marketplace.offer.updateFields',
      this.marketplaceOfferFieldUpdateHandler,
      'realtime'
    );
    // Operator-wave child: single-unit work, but arrives up to 1000 wide —
    // `bulk` is ADR-050 decision 1's most consequential assignment.
    this.handlerRegistry.register(
      'marketplace.offer.create',
      this.marketplaceOfferCreateHandler,
      'bulk'
    );
    this.handlerRegistry.register(
      'marketplace.offer.pollCreationStatus',
      this.marketplaceOfferPollCreationStatusHandler,
      'realtime'
    );
    this.handlerRegistry.register(
      'marketplace.offer.statusSync',
      this.marketplaceOfferStatusSyncHandler,
      'bulk'
    );
    this.handlerRegistry.register(
      'marketplace.offer.refreshSnapshot',
      this.marketplaceOfferRefreshSnapshotHandler,
      'realtime'
    );
    this.handlerRegistry.register(
      'marketplace.offer.stockRestore',
      this.marketplaceOfferStockRestoreHandler,
      'realtime'
    );
    this.handlerRegistry.register(
      'marketplace.offer.pauseStale',
      this.marketplaceOfferPauseStaleHandler,
      'realtime'
    );
    this.handlerRegistry.register(
      'marketplace.offer.pauseStaleSweep',
      this.marketplaceOfferPauseStaleSweepHandler,
      'bulk'
    );
    this.handlerRegistry.register(
      'marketplace.shipment.statusSync',
      this.marketplaceShipmentStatusSyncHandler,
      'bulk'
    );
    this.handlerRegistry.register(
      'marketplace.shipment.syncByExternalId',
      this.marketplaceShipmentSyncByExternalIdHandler,
      'realtime'
    );
    this.handlerRegistry.register(
      'marketplace.fulfillment.statusSync',
      this.marketplaceFulfillmentStatusSyncHandler,
      'bulk'
    );

    // Register generic master handlers (Option B)
    this.handlerRegistry.register(
      'master.product.syncByExternalId',
      this.masterProductSyncHandler,
      'realtime'
    );
    this.handlerRegistry.register(
      'master.inventory.syncByExternalId',
      this.masterInventorySyncHandler,
      'realtime'
    );

    // Register auto-match variants handler
    this.handlerRegistry.register(
      'master.variants.autoMatch',
      this.autoMatchVariantsHandler,
      'bulk'
    );

    // Register master inventory sync all handler (periodic full sync)
    this.handlerRegistry.register(
      'master.inventory.syncAll',
      this.masterInventorySyncAllHandler,
      'fan-out'
    );

    // Register master product sync all handler (catalog discovery / periodic full sync)
    this.handlerRegistry.register(
      'master.product.syncAll',
      this.masterProductSyncAllHandler,
      'fan-out'
    );
    this.handlerRegistry.register(
      'master.product.syncDelta',
      this.masterProductSyncDeltaHandler,
      'fan-out'
    );
    this.handlerRegistry.register(
      'master.product.reconcile',
      this.masterProductReconcileHandler,
      'fan-out'
    );

    // Register pickup-point background-refresh handler (#849, daily re-warm)
    this.handlerRegistry.register(
      'shipping.pickupPoint.refreshFrequent',
      this.pickupPointRefreshHandler,
      'bulk'
    );

    // Register inventory propagate to marketplaces handler
    this.handlerRegistry.register(
      'inventory.propagateToMarketplaces',
      this.inventoryPropagateHandler,
      'fan-out'
    );

    // Register the connection-provenance backfill (#2317, ADR-058 step (ii)).
    //
    // `bulk`, not `fan-out`: it enqueues no children at all — it does the work
    // itself in one bounded local UPDATE — and `fan-out`'s whole subject is a
    // job whose cost is the wave it emits. It is also nothing a buyer waits on,
    // so it must never share `realtime`'s slots.
    this.handlerRegistry.register(
      'inventory.provenance.backfill',
      this.inventoryProvenanceBackfillHandler,
      'bulk'
    );
    // `bulk` (#2340): a periodic local-only repair of a DISPLAY cache. Nothing
    // a buyer waits on, and the gates it does NOT feed read `order_holds`
    // directly — so starving it costs a stale badge, never a wrong decision.
    this.handlerRegistry.register(
      'orders.holds.reconcile',
      this.ordersHoldsReconcileHandler,
      'bulk'
    );

    // Register shop product publish handler (#1042, ADR-024) — operator-wave
    // child, same `bulk` reasoning as marketplace.offer.create.
    this.handlerRegistry.register('shop.product.publish', this.shopProductPublishHandler, 'bulk');
    // Register shop product status-sync handler (#1845)
    this.handlerRegistry.register(
      'shop.product.statusSync',
      this.shopProductStatusSyncHandler,
      'bulk',
    );
    // Register destination-taxonomy projection refresh (#1979, ADR-037)
    this.handlerRegistry.register(
      'destination.taxonomy.sync',
      this.destinationTaxonomySyncHandler,
      'bulk',
    );

    // Register invoicing issue handler (OL #1120 — auto-issue trigger)
    this.handlerRegistry.register('invoicing.issue', this.invoicingIssueHandler, 'fiscal');
    // Register fiscalization register handler (#2156 — auto-issue cross-capability
    // gate). Post-ADR-050 registration; `fiscal` by the cost-of-starvation rule
    // (deadline-bearing, at-most-once) — the ADR's lane table is amended in #2278.
    this.handlerRegistry.register(
      'fiscalization.register',
      this.fiscalizationRegisterHandler,
      'fiscal'
    );
    // Register KSeF regulatory-status reconciliation handler (#1121)
    this.handlerRegistry.register(
      'invoicing.regulatoryStatus.reconcile',
      this.regulatoryStatusReconcileHandler,
      'fiscal'
    );
    // Register offline-submission resubmission sweep handler (#1702)
    this.handlerRegistry.register(
      'invoicing.offlineSubmission.resubmit',
      this.offlineResubmitHandler,
      'fiscal'
    );
    // Register crash-recovery sweep handler (#1703)
    this.handlerRegistry.register(
      'invoicing.pendingRecovery.sweep',
      this.pendingRecoveryHandler,
      'fiscal'
    );
    // Register by-id payment-status refresh handler (#1354)
    this.handlerRegistry.register(
      'invoicing.paymentStatus.refreshByExternalId',
      this.paymentStatusRefreshHandler,
      'realtime'
    );

    // Tax-rate backfill sweep for pre-#2245 order_line_items rows (#2440).
    // 'bulk' lane: large-batch, resumable, non-realtime — the same class of
    // work the master product/inventory syncAll sweeps occupy.
    this.handlerRegistry.register(
      'orders.taxRate.backfill',
      this.ordersTaxRateBackfillHandler,
      'bulk'
    );

    // Boot gate (ADR-050 D1 / ADR-051 D6): every JobTypeValues member must be
    // in the lane partition, or lane-aware claiming would strand its queued
    // rows silently. Throws (failing worker boot) naming the uncovered types.
    this.handlerRegistry.assertFullLaneCoverage();
  }
}
