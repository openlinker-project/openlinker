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
import { OrderRecordRepository } from './infrastructure/persistence/repositories/order-record.repository';
import { OrderRecordOrmEntity } from './infrastructure/persistence/entities/order-record.orm-entity';
import {
  ORDER_SYNC_SERVICE_TOKEN,
  ORDER_INGESTION_SERVICE_TOKEN,
  ORDER_RECORD_REPOSITORY_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
} from './orders.tokens';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { ListingsModule } from '@openlinker/core/listings';
import { SyncModule } from '@openlinker/core/sync';

// Re-export tokens for convenience
export { ORDER_SYNC_SERVICE_TOKEN } from './orders.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderRecordOrmEntity]),
    IntegrationsModule, // Required for INTEGRATIONS_SERVICE_TOKEN and ADAPTER_FACTORY_RESOLVER_TOKEN
    IdentifierMappingModule, // Required for IDENTIFIER_MAPPING_SERVICE_TOKEN
    ListingsModule, // Required for OFFER_MAPPING_SERVICE_TOKEN (offer -> internal product mapping)
    SyncModule, // Required for cursor repository, job queue, and locks
  ],
  providers: [
    // Provide classes directly first
    OrderSyncService,
    OrderIngestionService,
    OrderItemRefResolverService,
    OrderRecordService,
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
    // Also provide as string tokens for convenience
    {
      provide: 'IOrderSyncService',
      useExisting: ORDER_SYNC_SERVICE_TOKEN,
    },
    {
      provide: 'IOrderIngestionService',
      useExisting: ORDER_INGESTION_SERVICE_TOKEN,
    },
    {
      provide: 'OrderRecordRepositoryPort',
      useExisting: ORDER_RECORD_REPOSITORY_TOKEN,
    },
    {
      provide: 'IOrderRecordService',
      useExisting: ORDER_RECORD_SERVICE_TOKEN,
    },
  ],
  exports: [
    OrderRecordService, // Export service class for direct injection
    ORDER_SYNC_SERVICE_TOKEN,
    ORDER_INGESTION_SERVICE_TOKEN,
    ORDER_RECORD_REPOSITORY_TOKEN,
    ORDER_RECORD_SERVICE_TOKEN,
    'IOrderSyncService',
    'IOrderIngestionService',
    'OrderRecordRepositoryPort',
    'IOrderRecordService',
  ],
})
export class OrdersModule {}

