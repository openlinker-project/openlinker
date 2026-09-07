/**
 * Sync Worker Module
 *
 * NestJS module for worker-specific sync functionality. Registers job intake
 * consumer, job runner, handler registry, job handlers, and handler registration service.
 *
 * @module apps/worker/src/sync
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RedisClientType } from 'redis';
import { createClient } from 'redis';
import { Logger } from '@openlinker/shared/logging';
import { SyncModule } from '@openlinker/core/sync';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { ProductsModule } from '@openlinker/core/products';
import { InventoryModule } from '@openlinker/core/inventory';
import { AutomationModule } from '@openlinker/core/automation';
import { OperationalSettingsModule } from '@openlinker/core/operational-settings';
import { OrdersModule } from '@openlinker/core/orders';
import { ReturnsModule } from '@openlinker/core/returns';
import { ListingsModule } from '@openlinker/core/listings/services';
import { ShippingModule } from '@openlinker/core/shipping';
import { FulfillmentModule } from '@openlinker/core/fulfillment';
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
import { MarketplaceOfferQuantityReconcileHandler } from './handlers/marketplace-offer-quantity-reconcile.handler';
import { MarketplaceOfferFieldUpdateHandler } from './handlers/marketplace-offer-field-update.handler';
import { MarketplaceOfferCreateHandler } from './handlers/marketplace-offer-create.handler';
import { MarketplaceOfferPollCreationStatusHandler } from './handlers/marketplace-offer-poll-creation-status.handler';
import { MarketplaceOffersSyncHandler } from './handlers/marketplace-offers-sync.handler';
import { MarketplaceOfferStatusSyncHandler } from './handlers/marketplace-offer-status-sync.handler';
import { MarketplaceReturnsPollHandler } from './handlers/marketplace-returns-poll.handler';
import { MarketplaceReturnSyncHandler } from './handlers/marketplace-return-sync.handler';
import { MarketplaceReturnsStatusSyncHandler } from './handlers/marketplace-returns-status-sync.handler';
import { ReturnsOrphanReconcileHandler } from './handlers/returns-orphan-reconcile.handler';
import { MarketplaceOfferRefreshSnapshotHandler } from './handlers/marketplace-offer-refresh-snapshot.handler';
import { MarketplaceOfferStockRestoreHandler } from './handlers/marketplace-offer-stock-restore.handler';
import { MarketplaceOfferPauseStaleHandler } from './handlers/marketplace-offer-pause-stale.handler';
import { MarketplaceOfferPauseStaleSweepHandler } from './handlers/marketplace-offer-pause-stale-sweep.handler';
import { MarketplaceShipmentStatusSyncHandler } from './handlers/marketplace-shipment-status-sync.handler';
import { MarketplaceShipmentSyncByExternalIdHandler } from './handlers/marketplace-shipment-sync-by-external-id.handler';
import { MarketplaceFulfillmentStatusSyncHandler } from './handlers/marketplace-fulfillment-status-sync.handler';
import { FulfillmentWorkStatusSyncHandler } from './handlers/fulfillment-work-status-sync.handler';
import { MasterProductSyncHandler } from './handlers/master-product-sync.handler';
import { MasterProductSyncBatchHandler } from './handlers/master-product-sync-batch.handler';
import { MasterInventorySyncHandler } from './handlers/master-inventory-sync.handler';
import { MasterInventorySyncBatchHandler } from './handlers/master-inventory-sync-batch.handler';
import { AutoMatchVariantsHandler } from './handlers/auto-match-variants.handler';
import { MasterInventorySyncAllHandler } from './handlers/master-inventory-sync-all.handler';
import { MasterProductSyncAllHandler } from './handlers/master-product-sync-all.handler';
import { MasterProductSyncDeltaHandler } from './handlers/master-product-sync-delta.handler';
import { MasterProductReconcileHandler } from './handlers/master-product-reconcile.handler';
import { InventoryProvenanceBackfillHandler } from './handlers/inventory-provenance-backfill.handler';
import { ReservationExpiryHandler } from './handlers/reservation-expiry.handler';
import { ReservationShortfallHandler } from './handlers/reservation-shortfall.handler';
import { ReservationConsumeHandler } from './handlers/reservation-consume.handler';
import { OrdersHoldsReconcileHandler } from './handlers/orders-holds-reconcile.handler';
import { PickupPointRefreshHandler } from './handlers/pickup-point-refresh.handler';
import { ShopProductPublishHandler } from './handlers/shop-product-publish.handler';
import { AutomationTriggerDeadlineSweepHandler } from './handlers/automation-trigger-deadline-sweep.handler';
import { ShopProductStatusSyncHandler } from './handlers/shop-product-status-sync.handler';
import { DestinationTaxonomySyncHandler } from './handlers/destination-taxonomy-sync.handler';
import { InvoicingIssueHandler } from './handlers/invoicing-issue.handler';
import { FiscalizationRegisterHandler } from './handlers/fiscalization-register.handler';
import { RegulatoryStatusReconcileHandler } from './handlers/regulatory-status-reconcile.handler';
import { OfflineResubmitHandler } from './handlers/offline-resubmit.handler';
import { PendingRecoveryHandler } from './handlers/pending-recovery.handler';
import { FulfillmentWorkDispatchHandler } from './handlers/fulfillment-work-dispatch.handler';
import { FulfillmentWorkRouteHandler } from './handlers/fulfillment-work-route.handler';
import { PaymentStatusRefreshHandler } from './handlers/payment-status-refresh.handler';
import { HandlerRegistrationService } from './handlers/handler-registration.service';
import { JOB_INTAKE_REDIS_CLIENT_TOKEN } from './sync-worker.tokens';

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
    ReturnsModule, // #2330 — exposes RETURN_INGESTION_SERVICE_TOKEN + RETURN_STATUS_SYNC_SERVICE_TOKEN
    ShippingModule, // Import ShippingModule to access SHIPMENT_STATUS_SYNC_SERVICE_TOKEN (#838)
    // #2399 — exposes FULFILLMENT_HANDSHAKE_SERVICE_TOKEN. A leaf module: it
    // imports no sibling context, so this edge adds no cycle risk.
    FulfillmentModule,
    InvoicingModule, // OL #1120/#1121 — exposes INVOICE_SERVICE_TOKEN + AUTO_ISSUE_TRIGGER_SERVICE_TOKEN (OrderIngestionService) + REGULATORY_STATUS_RECONCILIATION_SERVICE_TOKEN
    FiscalizationModule, // #2156 — exposes FISCAL_REGISTRATION_SERVICE_TOKEN for the fiscalization.register handler
    WorkerContentModule, // Worker-side ContentModule for #737 — exposes CONTENT_SUGGESTION_SERVICE_TOKEN
    // #2360 — exposes AUTOMATION_RULES_SERVICE_TOKEN + AUTOMATION_TRIGGER_EMISSION_SERVICE_TOKEN
    // for `automation.trigger.deadlineSweep`. OrdersModule imports AutomationModule too (for T5's
    // write-site emission) but does not re-export it, and Nest imports are not transitive.
    AutomationModule,
  ],
  providers: [
    {
      // The client `JobIntakeConsumer` blocks on, and the ONE reason it is a
      // provider rather than a plain `@Inject('REDIS_CLIENT')`.
      //
      // `JobIntakeConsumer` runs `xReadGroup` with `BLOCK: 5000` in a loop
      // (`job-intake.consumer.ts`), and Redis serves no further commands from
      // a client that is parked in a blocking read. The worker's shared
      // `'REDIS_CLIENT'` is also what `RateLimitModule` builds the outbound
      // rate limiter's registry on (`libs/plugin-sdk/src/rate-limit.module.ts`
      // — `inject: ['REDIS_CLIENT']`), so a pace `EVAL` issued while an intake
      // block is in flight waits out the block's residual: up to 5 s, against
      // the limiter's own 1000 ms timeout. Past that the limiter logs
      // "falling back to per-process in-memory limiting" and stops being the
      // thing it was configured to be.
      //
      // `EventsConsumerModule` already gives its own stream consumer a
      // dedicated client for exactly this reason, and says so in its comment;
      // the limiter never got the same treatment. This provider is what makes
      // that hypothesis MEASURABLE rather than argued: the flag defaults to
      // the shipped behaviour, so an unset stand is byte-identical to its
      // pre-change self, and one env var switches the single variable under
      // test without a second image.
      //
      // The flag is a measurement seam, not the intended end state. If a
      // dedicated client is shown to remove the degradation, the follow-up is
      // to make it unconditional and delete the flag — evidence first, in that
      // order.
      //
      // No shutdown quit, matching the `EventsConsumerModule` precedent: a
      // plain object provider carries no lifecycle hook, and the cost is one
      // Redis connection per worker process, released when the process exits.
      provide: JOB_INTAKE_REDIS_CLIENT_TOKEN,
      useFactory: async (
        configService: ConfigService,
        sharedClient: RedisClientType
      ): Promise<RedisClientType> => {
        const logger = new Logger('JobIntakeRedisClient');
        const dedicated =
          configService.get<string>('OL_JOB_INTAKE_DEDICATED_REDIS', 'false') === 'true';
        if (!dedicated) {
          // Logged on BOTH branches, and asserted on by the harness. A
          // configuration that silently did not apply is the worst failure a
          // measurement can have (#2229's reported-versus-enforced rule), and
          // an env var read from outside the container is a request, not a
          // reading.
          logger.log('Job intake Redis client: SHARED (OL_JOB_INTAKE_DEDICATED_REDIS is not true)');
          return sharedClient;
        }
        const client = createClient({
          socket: {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
          },
          password: configService.get<string>('REDIS_PASSWORD'),
          database: configService.get<number>('REDIS_DB', 0),
        });
        try {
          await client.connect();
        } catch (error) {
          throw new Error(
            `SyncWorkerModule: Failed to connect JOB_INTAKE_REDIS_CLIENT: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        logger.log(
          'Job intake Redis client: DEDICATED (OL_JOB_INTAKE_DEDICATED_REDIS=true) - the shared client is left free for the outbound rate limiter'
        );
        return client as RedisClientType;
      },
      inject: [ConfigService, 'REDIS_CLIENT'],
    },
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
    MarketplaceOfferQuantityReconcileHandler,
    MarketplaceOfferFieldUpdateHandler,
    MarketplaceOfferCreateHandler,
    MarketplaceOfferPollCreationStatusHandler,
    MarketplaceOffersSyncHandler,
    MarketplaceOfferStatusSyncHandler,
    MarketplaceReturnsPollHandler,
    MarketplaceReturnSyncHandler,
    MarketplaceReturnsStatusSyncHandler,
    ReturnsOrphanReconcileHandler,
    MarketplaceOfferRefreshSnapshotHandler,
    MarketplaceOfferStockRestoreHandler,
    MarketplaceOfferPauseStaleHandler,
    MarketplaceOfferPauseStaleSweepHandler,
    MarketplaceShipmentStatusSyncHandler,
    MarketplaceShipmentSyncByExternalIdHandler,
    MarketplaceFulfillmentStatusSyncHandler,
    FulfillmentWorkStatusSyncHandler,
    MasterProductSyncHandler,
    MasterProductSyncBatchHandler,
    MasterInventorySyncHandler,
    MasterInventorySyncBatchHandler,
    AutoMatchVariantsHandler,
    MasterInventorySyncAllHandler,
    MasterProductSyncAllHandler,
    MasterProductSyncDeltaHandler,
    MasterProductReconcileHandler,
    InventoryProvenanceBackfillHandler,
    ReservationExpiryHandler,
    ReservationShortfallHandler,
    ReservationConsumeHandler,
    OrdersHoldsReconcileHandler,
    PickupPointRefreshHandler,
    ShopProductPublishHandler,
    AutomationTriggerDeadlineSweepHandler,
    ShopProductStatusSyncHandler,
    DestinationTaxonomySyncHandler,
    InvoicingIssueHandler,
    FiscalizationRegisterHandler,
    RegulatoryStatusReconcileHandler,
    OfflineResubmitHandler,
    PendingRecoveryHandler,
    PaymentStatusRefreshHandler,
    FulfillmentWorkDispatchHandler,
    FulfillmentWorkRouteHandler,
    HandlerRegistrationService,
  ],
})
export class SyncWorkerModule {}

