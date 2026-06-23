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
import { OrderDestinationRetryService } from './application/services/order-destination-retry.service';
import { OrderLifecycleRelayService } from './application/services/order-lifecycle-relay.service';
import { OrderRecordRepository } from './infrastructure/persistence/repositories/order-record.repository';
import { OrderRecordOrmEntity } from './infrastructure/persistence/entities/order-record.orm-entity';
import {
  ORDER_SYNC_SERVICE_TOKEN,
  ORDER_INGESTION_SERVICE_TOKEN,
  ORDER_RECORD_REPOSITORY_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  ORDER_DESTINATION_RETRY_SERVICE_TOKEN,
  ORDER_ITEM_REF_RESOLVER_SERVICE_TOKEN,
  ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN,
} from './orders.tokens';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { SyncModule } from '@openlinker/core/sync';
import { ProductsModule } from '@openlinker/core/products';
import { MappingsModule } from '@openlinker/core/mappings';
import { CustomersModule } from '@openlinker/core/customers';
import { InvoicingModule } from '@openlinker/core/invoicing';

// Re-export tokens for convenience
export { ORDER_SYNC_SERVICE_TOKEN } from './orders.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderRecordOrmEntity]),
    IntegrationsModule, // Required for INTEGRATIONS_SERVICE_TOKEN and ADAPTER_FACTORY_RESOLVER_TOKEN
    IdentifierMappingModule, // Required for IDENTIFIER_MAPPING_SERVICE_TOKEN
    SyncModule, // Required for cursor repository, job queue, and locks
    ProductsModule, // Required for PRODUCT_VARIANT_REPOSITORY_TOKEN
    MappingsModule, // Required for MAPPING_CONFIG_SERVICE_TOKEN
    CustomersModule, // Required for CUSTOMER_IDENTITY_RESOLVER_SERVICE_TOKEN
    // One-way edge (F3): OrderIngestionService injects AUTO_ISSUE_TRIGGER_SERVICE_TOKEN.
    // InvoicingModule's mapper imports orders TYPES only (compile-time) → no DI cycle.
    InvoicingModule,
  ],
  providers: [
    // Provide classes directly first
    OrderSyncService,
    OrderIngestionService,
    OrderItemRefResolverService,
    OrderRecordService,
    OrderDestinationRetryService,
    OrderLifecycleRelayService,
    OrderRecordRepository,
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
  ],
  exports: [
    OrderRecordService, // Export service class for direct injection
    ORDER_SYNC_SERVICE_TOKEN,
    ORDER_INGESTION_SERVICE_TOKEN,
    ORDER_RECORD_REPOSITORY_TOKEN,
    ORDER_RECORD_SERVICE_TOKEN,
    ORDER_DESTINATION_RETRY_SERVICE_TOKEN,
    ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN,
  ],
})
export class OrdersModule {}

