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
import { MappingsModule } from '@openlinker/core/mappings';
import { SyncModule } from '@openlinker/core/sync';
import { OfferLinkingService } from './application/services/offer-linking.service';
import { OfferMappingSyncService } from './application/services/offer-mapping-sync.service';
import { OfferMappingsService } from './application/services/offer-mappings.service';
import { CategoryResolutionService } from './application/services/category-resolution.service';
import { OfferMappingRepository } from './infrastructure/persistence/repositories/offer-mapping.repository';
import { OfferCreationRecordOrmEntity } from './infrastructure/persistence/entities/offer-creation-record.orm-entity';
import { OfferCreationRecordRepository } from './infrastructure/persistence/repositories/offer-creation-record.repository';
import { OfferBuilderService } from './application/services/offer-builder.service';
import { OfferCreationExecutionService } from './application/services/offer-creation-execution.service';
import { SellerPoliciesCacheOrmEntity } from './infrastructure/persistence/entities/seller-policies-cache.orm-entity';
import { SellerPoliciesCacheRepository } from './infrastructure/persistence/repositories/seller-policies-cache.repository';
import { SellerPoliciesService } from './application/services/seller-policies.service';
import { OfferCreationEnqueueService } from './application/services/offer-creation-enqueue.service';
import { OfferStatusPollService } from './application/services/offer-status-poll.service';
import {
  OFFER_LINKING_SERVICE_TOKEN,
  OFFER_MAPPING_SYNC_SERVICE_TOKEN,
  OFFER_MAPPINGS_SERVICE_TOKEN,
  OFFER_MAPPING_REPOSITORY_TOKEN,
  OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
  CATEGORY_RESOLUTION_SERVICE_TOKEN,
  OFFER_BUILDER_SERVICE_TOKEN,
  OFFER_CREATION_EXECUTION_SERVICE_TOKEN,
  OFFER_CREATION_ENQUEUE_SERVICE_TOKEN,
  OFFER_STATUS_POLL_SERVICE_TOKEN,
  SELLER_POLICIES_SERVICE_TOKEN,
  SELLER_POLICIES_CACHE_TOKEN,
} from './listings.tokens';

// Re-export tokens for convenience
export {
  OFFER_LINKING_SERVICE_TOKEN,
  OFFER_MAPPING_SYNC_SERVICE_TOKEN,
  OFFER_MAPPINGS_SERVICE_TOKEN,
  OFFER_MAPPING_REPOSITORY_TOKEN,
  OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
  CATEGORY_RESOLUTION_SERVICE_TOKEN,
  OFFER_BUILDER_SERVICE_TOKEN,
  OFFER_CREATION_EXECUTION_SERVICE_TOKEN,
  OFFER_CREATION_ENQUEUE_SERVICE_TOKEN,
  OFFER_STATUS_POLL_SERVICE_TOKEN,
  SELLER_POLICIES_SERVICE_TOKEN,
  SELLER_POLICIES_CACHE_TOKEN,
} from './listings.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      IdentifierMappingOrmEntity,
      OfferCreationRecordOrmEntity,
      SellerPoliciesCacheOrmEntity,
    ]),
    IntegrationsModule,
    IdentifierMappingModule,
    ProductsModule,
    MappingsModule,
    SyncModule,
  ],
  providers: [
    OfferLinkingService,
    OfferMappingSyncService,
    OfferMappingsService,
    CategoryResolutionService,
    OfferMappingRepository,
    OfferCreationRecordRepository,
    OfferBuilderService,
    OfferCreationExecutionService,
    OfferCreationEnqueueService,
    OfferStatusPollService,
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
      provide: CATEGORY_RESOLUTION_SERVICE_TOKEN,
      useExisting: CategoryResolutionService,
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
      provide: OFFER_CREATION_ENQUEUE_SERVICE_TOKEN,
      useExisting: OfferCreationEnqueueService,
    },
    {
      provide: OFFER_STATUS_POLL_SERVICE_TOKEN,
      useExisting: OfferStatusPollService,
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
    CATEGORY_RESOLUTION_SERVICE_TOKEN,
    OFFER_BUILDER_SERVICE_TOKEN,
    OFFER_CREATION_EXECUTION_SERVICE_TOKEN,
    OFFER_CREATION_ENQUEUE_SERVICE_TOKEN,
    OFFER_STATUS_POLL_SERVICE_TOKEN,
    SELLER_POLICIES_SERVICE_TOKEN,
    SELLER_POLICIES_CACHE_TOKEN,
  ],
})
export class ListingsModule {}
