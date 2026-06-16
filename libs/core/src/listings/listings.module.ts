/**
 * Listings Module
 *
 * NestJS module for marketplace offer linking and mapping sync.
 *
 * @module libs/core/src/listings
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { ProductsModule } from '@openlinker/core/products';
import { InventoryModule } from '@openlinker/core/inventory';
import { MappingsModule } from '@openlinker/core/mappings';
import { SyncModule } from '@openlinker/core/sync';
import { OfferLinkingService } from './application/services/offer-linking.service';
import { OfferMappingSyncService } from './application/services/offer-mapping-sync.service';
import { OfferMappingsService } from './application/services/offer-mappings.service';
import { CategoryResolutionService } from './application/services/category-resolution.service';
import { AttributeProjectionService } from './application/services/attribute-projection.service';
import { OfferMappingRepository } from './infrastructure/persistence/repositories/offer-mapping.repository';
import { OfferCreationRecordOrmEntity } from './infrastructure/persistence/entities/offer-creation-record.orm-entity';
import { OfferCreationRecordRepository } from './infrastructure/persistence/repositories/offer-creation-record.repository';
import { BulkListingBatchOrmEntity } from './infrastructure/persistence/entities/bulk-listing-batch.orm-entity';
import { BulkListingBatchRepository } from './infrastructure/persistence/repositories/bulk-listing-batch.repository';
import { BulkBatchAdvancementOrmEntity } from './infrastructure/persistence/entities/bulk-batch-advancement.orm-entity';
import { BulkBatchAdvancementRepository } from './infrastructure/persistence/repositories/bulk-batch-advancement.repository';
import { BulkListingProgressService } from './application/services/bulk-listing-progress.service';
import { OfferBuilderService } from './application/services/offer-builder.service';
import { OfferCreationExecutionService } from './application/services/offer-creation-execution.service';
import { ListingCreationRecordOrmEntity } from './infrastructure/persistence/entities/listing-creation-record.orm-entity';
import { ListingCreationRecordRepository } from './infrastructure/persistence/repositories/listing-creation-record.repository';
import { ProductPublishBuilderService } from './application/services/product-publish-builder.service';
import { ProductPublishExecutionService } from './application/services/product-publish-execution.service';
import { ProductPublishEnqueueService } from './application/services/product-publish-enqueue.service';
import { ListingCreationQueryService } from './application/services/listing-creation-query.service';
import { BulkShopPublishSubmitService } from './application/services/bulk-shop-publish-submit.service';
import { SellerPoliciesCacheOrmEntity } from './infrastructure/persistence/entities/seller-policies-cache.orm-entity';
import { SellerPoliciesCacheRepository } from './infrastructure/persistence/repositories/seller-policies-cache.repository';
import { SellerPoliciesService } from './application/services/seller-policies.service';
import { OfferCreationEnqueueService } from './application/services/offer-creation-enqueue.service';
import { BulkListingSubmitService } from './application/services/bulk-listing-submit.service';
import { BulkListingRetryService } from './application/services/bulk-listing-retry.service';
import { OfferStatusPollService } from './application/services/offer-status-poll.service';
import { OfferStatusSyncService } from './application/services/offer-status-sync.service';
import { OfferStatusSnapshotOrmEntity } from './infrastructure/persistence/entities/offer-status-snapshot.orm-entity';
import { OfferStatusSnapshotRepository } from './infrastructure/persistence/repositories/offer-status-snapshot.repository';
import {
  OFFER_LINKING_SERVICE_TOKEN,
  OFFER_MAPPING_SYNC_SERVICE_TOKEN,
  OFFER_MAPPINGS_SERVICE_TOKEN,
  OFFER_MAPPING_REPOSITORY_TOKEN,
  OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
  BULK_LISTING_BATCH_REPOSITORY_TOKEN,
  BULK_BATCH_ADVANCEMENT_REPOSITORY_TOKEN,
  BULK_LISTING_PROGRESS_SERVICE_TOKEN,
  CATEGORY_RESOLUTION_SERVICE_TOKEN,
  ATTRIBUTE_PROJECTION_SERVICE_TOKEN,
  OFFER_BUILDER_SERVICE_TOKEN,
  OFFER_CREATION_EXECUTION_SERVICE_TOKEN,
  OFFER_CREATION_ENQUEUE_SERVICE_TOKEN,
  BULK_LISTING_SUBMIT_SERVICE_TOKEN,
  BULK_LISTING_RETRY_SERVICE_TOKEN,
  OFFER_STATUS_POLL_SERVICE_TOKEN,
  OFFER_STATUS_SYNC_SERVICE_TOKEN,
  OFFER_STATUS_SNAPSHOT_REPOSITORY_TOKEN,
  SELLER_POLICIES_SERVICE_TOKEN,
  SELLER_POLICIES_CACHE_TOKEN,
  LISTING_CREATION_RECORD_REPOSITORY_TOKEN,
  PRODUCT_PUBLISH_BUILDER_SERVICE_TOKEN,
  PRODUCT_PUBLISH_EXECUTION_SERVICE_TOKEN,
  PRODUCT_PUBLISH_ENQUEUE_SERVICE_TOKEN,
  LISTING_CREATION_QUERY_SERVICE_TOKEN,
  BULK_SHOP_PUBLISH_SUBMIT_SERVICE_TOKEN,
} from './listings.tokens';

// Re-export tokens for convenience
export {
  OFFER_LINKING_SERVICE_TOKEN,
  OFFER_MAPPING_SYNC_SERVICE_TOKEN,
  OFFER_MAPPINGS_SERVICE_TOKEN,
  OFFER_MAPPING_REPOSITORY_TOKEN,
  OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
  BULK_LISTING_BATCH_REPOSITORY_TOKEN,
  BULK_BATCH_ADVANCEMENT_REPOSITORY_TOKEN,
  BULK_LISTING_PROGRESS_SERVICE_TOKEN,
  CATEGORY_RESOLUTION_SERVICE_TOKEN,
  ATTRIBUTE_PROJECTION_SERVICE_TOKEN,
  OFFER_BUILDER_SERVICE_TOKEN,
  OFFER_CREATION_EXECUTION_SERVICE_TOKEN,
  OFFER_CREATION_ENQUEUE_SERVICE_TOKEN,
  BULK_LISTING_SUBMIT_SERVICE_TOKEN,
  BULK_LISTING_RETRY_SERVICE_TOKEN,
  OFFER_STATUS_POLL_SERVICE_TOKEN,
  OFFER_STATUS_SYNC_SERVICE_TOKEN,
  OFFER_STATUS_SNAPSHOT_REPOSITORY_TOKEN,
  SELLER_POLICIES_SERVICE_TOKEN,
  SELLER_POLICIES_CACHE_TOKEN,
  LISTING_CREATION_RECORD_REPOSITORY_TOKEN,
  PRODUCT_PUBLISH_BUILDER_SERVICE_TOKEN,
  PRODUCT_PUBLISH_EXECUTION_SERVICE_TOKEN,
  PRODUCT_PUBLISH_ENQUEUE_SERVICE_TOKEN,
  LISTING_CREATION_QUERY_SERVICE_TOKEN,
  BULK_SHOP_PUBLISH_SUBMIT_SERVICE_TOKEN,
} from './listings.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      IdentifierMappingOrmEntity,
      OfferCreationRecordOrmEntity,
      ListingCreationRecordOrmEntity,
      BulkListingBatchOrmEntity,
      BulkBatchAdvancementOrmEntity,
      SellerPoliciesCacheOrmEntity,
      OfferStatusSnapshotOrmEntity,
    ]),
    IntegrationsModule,
    IdentifierMappingModule,
    ProductsModule,
    // Per-variant master stock for multi-variant bulk-offer expansion (#824).
    // No DI cycle: at the NestJS module layer InventoryModule does not import
    // ListingsModule, and the documented `inventory → listings` edge is a
    // type/token-only import. App-boot integration tests verify the resolved graph.
    InventoryModule,
    MappingsModule,
    SyncModule,
  ],
  providers: [
    OfferLinkingService,
    OfferMappingSyncService,
    OfferMappingsService,
    CategoryResolutionService,
    AttributeProjectionService,
    OfferMappingRepository,
    OfferCreationRecordRepository,
    BulkListingBatchRepository,
    BulkBatchAdvancementRepository,
    BulkListingProgressService,
    OfferBuilderService,
    OfferCreationExecutionService,
    ListingCreationRecordRepository,
    ProductPublishBuilderService,
    ProductPublishExecutionService,
    ProductPublishEnqueueService,
    ListingCreationQueryService,
    BulkShopPublishSubmitService,
    OfferCreationEnqueueService,
    BulkListingSubmitService,
    BulkListingRetryService,
    OfferStatusPollService,
    OfferStatusSyncService,
    OfferStatusSnapshotRepository,
    SellerPoliciesCacheRepository,
    SellerPoliciesService,
    {
      provide: OFFER_LINKING_SERVICE_TOKEN,
      useExisting: OfferLinkingService,
    },
    {
      provide: OFFER_MAPPING_SYNC_SERVICE_TOKEN,
      useExisting: OfferMappingSyncService,
    },
    {
      provide: OFFER_MAPPINGS_SERVICE_TOKEN,
      useExisting: OfferMappingsService,
    },
    {
      provide: OFFER_MAPPING_REPOSITORY_TOKEN,
      useExisting: OfferMappingRepository,
    },
    {
      provide: OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
      useExisting: OfferCreationRecordRepository,
    },
    {
      provide: BULK_LISTING_BATCH_REPOSITORY_TOKEN,
      useExisting: BulkListingBatchRepository,
    },
    {
      provide: BULK_BATCH_ADVANCEMENT_REPOSITORY_TOKEN,
      useExisting: BulkBatchAdvancementRepository,
    },
    {
      provide: BULK_LISTING_PROGRESS_SERVICE_TOKEN,
      useExisting: BulkListingProgressService,
    },
    {
      provide: CATEGORY_RESOLUTION_SERVICE_TOKEN,
      useExisting: CategoryResolutionService,
    },
    {
      provide: ATTRIBUTE_PROJECTION_SERVICE_TOKEN,
      useExisting: AttributeProjectionService,
    },
    {
      provide: OFFER_BUILDER_SERVICE_TOKEN,
      useExisting: OfferBuilderService,
    },
    {
      provide: OFFER_CREATION_EXECUTION_SERVICE_TOKEN,
      useExisting: OfferCreationExecutionService,
    },
    {
      provide: LISTING_CREATION_RECORD_REPOSITORY_TOKEN,
      useExisting: ListingCreationRecordRepository,
    },
    {
      provide: PRODUCT_PUBLISH_BUILDER_SERVICE_TOKEN,
      useExisting: ProductPublishBuilderService,
    },
    {
      provide: PRODUCT_PUBLISH_EXECUTION_SERVICE_TOKEN,
      useExisting: ProductPublishExecutionService,
    },
    {
      provide: PRODUCT_PUBLISH_ENQUEUE_SERVICE_TOKEN,
      useExisting: ProductPublishEnqueueService,
    },
    {
      provide: LISTING_CREATION_QUERY_SERVICE_TOKEN,
      useExisting: ListingCreationQueryService,
    },
    {
      provide: BULK_SHOP_PUBLISH_SUBMIT_SERVICE_TOKEN,
      useExisting: BulkShopPublishSubmitService,
    },
    {
      provide: OFFER_CREATION_ENQUEUE_SERVICE_TOKEN,
      useExisting: OfferCreationEnqueueService,
    },
    {
      provide: BULK_LISTING_SUBMIT_SERVICE_TOKEN,
      useExisting: BulkListingSubmitService,
    },
    {
      provide: BULK_LISTING_RETRY_SERVICE_TOKEN,
      useExisting: BulkListingRetryService,
    },
    {
      provide: OFFER_STATUS_POLL_SERVICE_TOKEN,
      useExisting: OfferStatusPollService,
    },
    {
      provide: OFFER_STATUS_SYNC_SERVICE_TOKEN,
      useExisting: OfferStatusSyncService,
    },
    {
      provide: OFFER_STATUS_SNAPSHOT_REPOSITORY_TOKEN,
      useExisting: OfferStatusSnapshotRepository,
    },
    {
      provide: SELLER_POLICIES_CACHE_TOKEN,
      useExisting: SellerPoliciesCacheRepository,
    },
    {
      provide: SELLER_POLICIES_SERVICE_TOKEN,
      useExisting: SellerPoliciesService,
    },
  ],
  exports: [
    OFFER_LINKING_SERVICE_TOKEN,
    OFFER_MAPPING_SYNC_SERVICE_TOKEN,
    OFFER_MAPPINGS_SERVICE_TOKEN,
    OFFER_MAPPING_REPOSITORY_TOKEN,
    OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
    BULK_LISTING_BATCH_REPOSITORY_TOKEN,
    BULK_BATCH_ADVANCEMENT_REPOSITORY_TOKEN,
    BULK_LISTING_PROGRESS_SERVICE_TOKEN,
    CATEGORY_RESOLUTION_SERVICE_TOKEN,
    OFFER_BUILDER_SERVICE_TOKEN,
    OFFER_CREATION_EXECUTION_SERVICE_TOKEN,
    OFFER_CREATION_ENQUEUE_SERVICE_TOKEN,
    BULK_LISTING_SUBMIT_SERVICE_TOKEN,
    BULK_LISTING_RETRY_SERVICE_TOKEN,
    OFFER_STATUS_POLL_SERVICE_TOKEN,
    OFFER_STATUS_SYNC_SERVICE_TOKEN,
    SELLER_POLICIES_SERVICE_TOKEN,
    SELLER_POLICIES_CACHE_TOKEN,
    LISTING_CREATION_RECORD_REPOSITORY_TOKEN,
    PRODUCT_PUBLISH_BUILDER_SERVICE_TOKEN,
    PRODUCT_PUBLISH_EXECUTION_SERVICE_TOKEN,
    PRODUCT_PUBLISH_ENQUEUE_SERVICE_TOKEN,
    LISTING_CREATION_QUERY_SERVICE_TOKEN,
    BULK_SHOP_PUBLISH_SUBMIT_SERVICE_TOKEN,
  ],
})
export class ListingsModule {}
