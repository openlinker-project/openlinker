/**
 * Orders Module
 *
 * NestJS module for orders functionality. Configures services and exports
 * the order sync service for use in other modules.
 *
 * @module libs/core/src/orders
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderSyncService } from './application/services/order-sync.service';
import { OrderIngestionService } from './application/services/order-ingestion.service';
import { OrderItemRefResolverService } from './application/services/order-item-ref-resolver.service';
import { OrderRecordService } from './application/services/order-record.service';
import { SalesDocumentViewService } from './application/services/sales-document-view.service';
import { OrderFxStampService } from './application/services/order-fx-stamp.service';
import { OrderFxRestatementService } from './application/services/order-fx-restatement.service';
import { OrderFxReadService } from './application/services/order-fx-read.service';
import { OrderDestinationRetryService } from './application/services/order-destination-retry.service';
import { OrderProvisioningResumeService } from './application/services/order-provisioning-resume.service';
import { FulfillmentDispatchRelayService } from './application/services/fulfillment-dispatch-relay.service';
import { OrderLifecycleRelayService } from './application/services/order-lifecycle-relay.service';
import { OrderRecordRepository } from './infrastructure/persistence/repositories/order-record.repository';
import { OrderLineItemRepository } from './infrastructure/persistence/repositories/order-line-item.repository';
import { OrderRecordOrmEntity } from './infrastructure/persistence/entities/order-record.orm-entity';
import { OrderRefundService } from './application/services/order-refund.service';
import { RefundRecordRepository } from './infrastructure/persistence/repositories/refund-record.repository';
import { RefundRecordOrmEntity } from './infrastructure/persistence/entities/refund-record.orm-entity';
import { OrderLineItemOrmEntity } from './infrastructure/persistence/entities/order-line-item.orm-entity';
import { TaxRateBackfillService } from './application/services/tax-rate-backfill.service';
import { TaxCoverageDetectionService } from './application/services/tax-coverage-detection.service';
import { DisplayCurrencyConversionService } from './application/services/display-currency-conversion.service';
import {
  ORDER_SYNC_SERVICE_TOKEN,
  ORDER_INGESTION_SERVICE_TOKEN,
  ORDER_RECORD_REPOSITORY_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  ORDER_FX_RESTATEMENT_SERVICE_TOKEN,
  ORDER_FX_STAMP_SERVICE_TOKEN,
  ORDER_DESTINATION_RETRY_SERVICE_TOKEN,
  ORDER_PROVISIONING_RESUME_SERVICE_TOKEN,
  ORDER_ITEM_REF_RESOLVER_SERVICE_TOKEN,
  ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN,
  ORDER_REFUND_RECORD_REPOSITORY_TOKEN,
  ORDER_REFUND_SERVICE_TOKEN,
  ORDER_FX_READ_SERVICE_TOKEN,
  ORDER_LINE_ITEM_REPOSITORY_TOKEN,
  TAX_RATE_BACKFILL_SERVICE_TOKEN,
  FULFILLMENT_DISPATCH_RELAY_SERVICE_TOKEN,
  SALES_DOCUMENT_VIEW_SERVICE_TOKEN,
  TAX_COVERAGE_DETECTION_SERVICE_TOKEN,
  DISPLAY_CURRENCY_CONVERSION_SERVICE_TOKEN,
} from './orders.tokens';
import { OrderHoldsModule } from './order-holds.module';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { SyncModule } from '@openlinker/core/sync';
import { ProductsModule } from '@openlinker/core/products';
import { MappingsModule } from '@openlinker/core/mappings';
// #2344: OL's own advisory reservation ledger, recorded at ingestion.
// One-way edge — `InventoryModule` imports none of `orders`.
import { InventoryModule } from '@openlinker/core/inventory';
import { CustomersModule } from '@openlinker/core/customers';
import { AutomationModule } from '@openlinker/core/automation';
import { InvoicingModule } from '@openlinker/core/invoicing';
import { CurrencyModule } from '@openlinker/core/currency';
import { FulfillmentModule } from '@openlinker/core/fulfillment';
// #2516: the per-order sales-document projection reads the fiscal-registration
// records through `IFiscalRegistrationService`. FiscalizationModule imports
// InvoicingModule (never the reverse) and imports no orders module, so this
// edge adds no DI cycle - the same direction OrdersModule already takes into
// InvoicingModule above.
import { FiscalizationModule } from '@openlinker/core/fiscalization';
// #2516: the projection resolves the prospective document kind through
// `ISalesDocumentRulesService`. `sales-documents` is a sink with zero outbound
// edges to sibling core contexts, so importing it cannot close a cycle.
import { SalesDocumentsModule } from '@openlinker/core/sales-documents';

// Re-export tokens for convenience
export { ORDER_SYNC_SERVICE_TOKEN } from './orders.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderRecordOrmEntity, RefundRecordOrmEntity, OrderLineItemOrmEntity]),
    IntegrationsModule, // Required for INTEGRATIONS_SERVICE_TOKEN and ADAPTER_FACTORY_RESOLVER_TOKEN
    IdentifierMappingModule, // Required for IDENTIFIER_MAPPING_SERVICE_TOKEN
    SyncModule, // Required for cursor repository, job queue, and locks
    ProductsModule, // Required for PRODUCT_VARIANT_REPOSITORY_TOKEN
    MappingsModule, // Required for MAPPING_CONFIG_SERVICE_TOKEN and FULFILLMENT_ROUTING_SERVICE_TOKEN
    InventoryModule, // Required for RESERVATION_SERVICE_TOKEN (#2344)
    CustomersModule, // Required for CUSTOMER_IDENTITY_RESOLVER_SERVICE_TOKEN
    // One-way edge (F3): OrderIngestionService injects AUTO_ISSUE_TRIGGER_SERVICE_TOKEN.
    // InvoicingModule does NOT import OrdersModule — its trigger service consumes
    // an orders runtime value (PAYMENT_STATUS) via a dependency-free leaf import,
    // never the orders barrel — so no module-graph cycle.
    InvoicingModule,
    // One-way edge (#2360): OrderRecordService injects
    // AUTOMATION_TRIGGER_EMISSION_SERVICE_TOKEN to fire T5 `order.packed`.
    // AutomationModule does NOT import OrdersModule back — the T4 sweep composes
    // its own order read at the worker handler instead, so `automation` imports no
    // sibling context and there is no module cycle to survive (#2100's direction).
    AutomationModule,
    // One-way edge to a LEAF context (#2125): OrderFxStampService injects
    // CURRENCY_RATE_SERVICE_TOKEN + REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN.
    // `currency` imports no sibling core context, so no cycle is possible.
    // The module is deliberately static (never `forRoot`) so the provider
    // registry `@openlinker/integrations-fx` writes into is the one read here.
    CurrencyModule,
    // Order holds (#2338). A LEAF module in this same context, imported rather
    // than inlined so #2339's `OrderHoldService` — and anything else needing
    // only the hold seam — can take it WITHOUT the eight-context graph above.
    // The edge is directional: importing the leaf here does not give the leaf
    // any of these dependencies.
    OrderHoldsModule,
    // One-way edge to a ZERO-SIBLING-EDGE LEAF (#2401): FulfillmentDispatchRelayService
    // injects FULFILLMENT_RELAY_GATE_SERVICE_TOKEN to take the work's at-most-once
    // dispatch-relay claim. `fulfillment` imports NO sibling core context at all
    // (barrel-purity.spec.ts pins it per leaf), so no cycle is possible — and the
    // direction is forced: firing the relay from `fulfillment` would mean importing
    // `@openlinker/core/orders` there, which two guards independently forbid.
    FulfillmentModule,
    FiscalizationModule,
    SalesDocumentsModule,
  ],
  providers: [
    // Provide classes directly first
    OrderSyncService,
    OrderIngestionService,
    OrderItemRefResolverService,
    OrderRecordService,
    SalesDocumentViewService,
    OrderFxStampService,
    OrderFxRestatementService,
    OrderDestinationRetryService,
    OrderProvisioningResumeService,
    OrderLifecycleRelayService,
    FulfillmentDispatchRelayService,
    OrderRecordRepository,
    OrderFxReadService,
    OrderRefundService,
    RefundRecordRepository,
    OrderLineItemRepository,
    TaxRateBackfillService,
    TaxCoverageDetectionService,
    DisplayCurrencyConversionService,
    // Then provide token bindings using useExisting
    {
      provide: ORDER_SYNC_SERVICE_TOKEN,
      useExisting: OrderSyncService,
    },
    {
      provide: ORDER_INGESTION_SERVICE_TOKEN,
      useExisting: OrderIngestionService,
    },
    {
      provide: ORDER_RECORD_REPOSITORY_TOKEN,
      useExisting: OrderRecordRepository,
    },
    {
      provide: ORDER_RECORD_SERVICE_TOKEN,
      useExisting: OrderRecordService,
    },
    {
      provide: ORDER_FX_STAMP_SERVICE_TOKEN,
      useExisting: OrderFxStampService,
    },
    {
      provide: ORDER_FX_RESTATEMENT_SERVICE_TOKEN,
      useExisting: OrderFxRestatementService,
    },
    {
      provide: ORDER_DESTINATION_RETRY_SERVICE_TOKEN,
      useExisting: OrderDestinationRetryService,
    },
    {
      // #2341 — beside the retry service because it takes the same seams
      // (record repository, identifier mapping, job enqueue), plus the record
      // SERVICE since #2588 review I-2, which needs the clock-stamping
      // `updateSyncStatus` to strand-mark withheld destinations.
      provide: ORDER_PROVISIONING_RESUME_SERVICE_TOKEN,
      useExisting: OrderProvisioningResumeService,
    },
    {
      provide: ORDER_ITEM_REF_RESOLVER_SERVICE_TOKEN,
      useExisting: OrderItemRefResolverService,
    },
    {
      provide: ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN,
      useExisting: OrderLifecycleRelayService,
    },
    {
      provide: FULFILLMENT_DISPATCH_RELAY_SERVICE_TOKEN,
      useExisting: FulfillmentDispatchRelayService,
    },
    {
      provide: ORDER_REFUND_RECORD_REPOSITORY_TOKEN,
      useExisting: RefundRecordRepository,
    },
    {
      provide: ORDER_REFUND_SERVICE_TOKEN,
      useExisting: OrderRefundService,
    },
    {
      provide: ORDER_FX_READ_SERVICE_TOKEN,
      useExisting: OrderFxReadService,
    },
    {
      provide: ORDER_LINE_ITEM_REPOSITORY_TOKEN,
      useExisting: OrderLineItemRepository,
    },
    {
      provide: TAX_RATE_BACKFILL_SERVICE_TOKEN,
      useExisting: TaxRateBackfillService,
    },
    {
      provide: SALES_DOCUMENT_VIEW_SERVICE_TOKEN,
      useExisting: SalesDocumentViewService,
    },
    {
      provide: TAX_COVERAGE_DETECTION_SERVICE_TOKEN,
      useExisting: TaxCoverageDetectionService,
    },
    {
      provide: DISPLAY_CURRENCY_CONVERSION_SERVICE_TOKEN,
      useExisting: DisplayCurrencyConversionService,
    },
  ],
  exports: [
    OrderRecordService, // Export service class for direct injection
    OrderRefundService, // Export service class for direct injection
    ORDER_SYNC_SERVICE_TOKEN,
    ORDER_INGESTION_SERVICE_TOKEN,
    ORDER_RECORD_REPOSITORY_TOKEN,
    ORDER_RECORD_SERVICE_TOKEN,
    // Exported so the worker's `marketplace.order.fxStamp` + `.fxStampSweep`
    // handlers can inject the stamp seam (#2125).
    ORDER_FX_STAMP_SERVICE_TOKEN,
    ORDER_FX_RESTATEMENT_SERVICE_TOKEN,
    ORDER_DESTINATION_RETRY_SERVICE_TOKEN,
    ORDER_PROVISIONING_RESUME_SERVICE_TOKEN,
    ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN,
    FULFILLMENT_DISPATCH_RELAY_SERVICE_TOKEN,
    ORDER_REFUND_SERVICE_TOKEN,
    ORDER_FX_READ_SERVICE_TOKEN,
    // Exported so the worker's `orders.taxRate.backfill` handler can inject
    // the backfill seam (#2440).
    TAX_RATE_BACKFILL_SERVICE_TOKEN,
    // Re-exported so a consumer of `OrdersModule` reaches the hold repository
    // without also importing `OrderHoldsModule` (#2338). It is the MODULE that
    // is re-exported, not the token: Nest refuses to export a provider it does
    // not own, and re-exporting an imported module is the supported way to pass
    // its exports through.
    OrderHoldsModule,
    // Exported so the API's orders controller can compose the per-order
    // sales-document projection for the list and the detail panel (#2516).
    SALES_DOCUMENT_VIEW_SERVICE_TOKEN,
    // Exported so the `/analytics/coverage` endpoint (#2466) can inject the
    // tax A/B/C detector seam (#2465).
    TAX_COVERAGE_DETECTION_SERVICE_TOKEN,
    // Exported so the `/analytics` display-currency read surface (a later
    // phase of #2452) can inject this seam (#2458, ADR-064).
    DISPLAY_CURRENCY_CONVERSION_SERVICE_TOKEN,
  ],
})
export class OrdersModule {}
