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
import { OrderFxStampService } from './application/services/order-fx-stamp.service';
import { OrderFxReadService } from './application/services/order-fx-read.service';
import { OrderDestinationRetryService } from './application/services/order-destination-retry.service';
import { OrderLifecycleRelayService } from './application/services/order-lifecycle-relay.service';
import { OrderRecordRepository } from './infrastructure/persistence/repositories/order-record.repository';
import { OrderLineItemRepository } from './infrastructure/persistence/repositories/order-line-item.repository';
import { OrderRecordOrmEntity } from './infrastructure/persistence/entities/order-record.orm-entity';
import { OrderRefundService } from './application/services/order-refund.service';
import { RefundRecordRepository } from './infrastructure/persistence/repositories/refund-record.repository';
import { RefundRecordOrmEntity } from './infrastructure/persistence/entities/refund-record.orm-entity';
import { OrderLineItemOrmEntity } from './infrastructure/persistence/entities/order-line-item.orm-entity';
import {
  ORDER_SYNC_SERVICE_TOKEN,
  ORDER_INGESTION_SERVICE_TOKEN,
  ORDER_RECORD_REPOSITORY_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  ORDER_FX_STAMP_SERVICE_TOKEN,
  ORDER_DESTINATION_RETRY_SERVICE_TOKEN,
  ORDER_ITEM_REF_RESOLVER_SERVICE_TOKEN,
  ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN,
  ORDER_REFUND_RECORD_REPOSITORY_TOKEN,
  ORDER_REFUND_SERVICE_TOKEN,
  ORDER_FX_READ_SERVICE_TOKEN,
  ORDER_LINE_ITEM_REPOSITORY_TOKEN,
} from './orders.tokens';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { SyncModule } from '@openlinker/core/sync';
import { ProductsModule } from '@openlinker/core/products';
import { MappingsModule } from '@openlinker/core/mappings';
import { CustomersModule } from '@openlinker/core/customers';
import { InvoicingModule } from '@openlinker/core/invoicing';
import { CurrencyModule } from '@openlinker/core/currency';

// Re-export tokens for convenience
export { ORDER_SYNC_SERVICE_TOKEN } from './orders.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderRecordOrmEntity, RefundRecordOrmEntity, OrderLineItemOrmEntity]),
    IntegrationsModule, // Required for INTEGRATIONS_SERVICE_TOKEN and ADAPTER_FACTORY_RESOLVER_TOKEN
    IdentifierMappingModule, // Required for IDENTIFIER_MAPPING_SERVICE_TOKEN
    SyncModule, // Required for cursor repository, job queue, and locks
    ProductsModule, // Required for PRODUCT_VARIANT_REPOSITORY_TOKEN
    MappingsModule, // Required for MAPPING_CONFIG_SERVICE_TOKEN
    CustomersModule, // Required for CUSTOMER_IDENTITY_RESOLVER_SERVICE_TOKEN
    // One-way edge (F3): OrderIngestionService injects AUTO_ISSUE_TRIGGER_SERVICE_TOKEN.
    // InvoicingModule does NOT import OrdersModule — its trigger service consumes
    // an orders runtime value (PAYMENT_STATUS) via a dependency-free leaf import,
    // never the orders barrel — so no module-graph cycle.
    InvoicingModule,
    // One-way edge to a LEAF context (#2125): OrderFxStampService injects
    // CURRENCY_RATE_SERVICE_TOKEN + REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN.
    // `currency` imports no sibling core context, so no cycle is possible.
    // The module is deliberately static (never `forRoot`) so the provider
    // registry `@openlinker/integrations-fx` writes into is the one read here.
    CurrencyModule,
  ],
  providers: [
    // Provide classes directly first
    OrderSyncService,
    OrderIngestionService,
    OrderItemRefResolverService,
    OrderRecordService,
    OrderFxStampService,
    OrderDestinationRetryService,
    OrderLifecycleRelayService,
    OrderRecordRepository,
    OrderFxReadService,
    OrderRefundService,
    RefundRecordRepository,
    OrderLineItemRepository,
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
      provide: ORDER_DESTINATION_RETRY_SERVICE_TOKEN,
      useExisting: OrderDestinationRetryService,
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
    ORDER_DESTINATION_RETRY_SERVICE_TOKEN,
    ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN,
    ORDER_REFUND_SERVICE_TOKEN,
    ORDER_FX_READ_SERVICE_TOKEN,
  ],
})
export class OrdersModule {}

