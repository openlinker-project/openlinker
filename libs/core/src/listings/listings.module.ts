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
import { IdentifierMappingModule, IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping';
import { ProductsModule } from '@openlinker/core/products';
import { MappingsModule } from '@openlinker/core/mappings';
import { OfferLinkingService } from './application/services/offer-linking.service';
import { OfferMappingSyncService } from './application/services/offer-mapping-sync.service';
import { CategoryResolutionService } from './application/services/category-resolution.service';
import { OfferMappingRepository } from './infrastructure/persistence/repositories/offer-mapping.repository';
import { OfferCreationRecordOrmEntity } from './infrastructure/persistence/entities/offer-creation-record.orm-entity';
import { OfferCreationRecordRepository } from './infrastructure/persistence/repositories/offer-creation-record.repository';
import {
  OFFER_LINKING_SERVICE_TOKEN,
  OFFER_MAPPING_SYNC_SERVICE_TOKEN,
  OFFER_MAPPING_REPOSITORY_TOKEN,
  OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
  CATEGORY_RESOLUTION_SERVICE_TOKEN,
} from './listings.tokens';

// Re-export tokens for convenience
export {
  OFFER_LINKING_SERVICE_TOKEN,
  OFFER_MAPPING_SYNC_SERVICE_TOKEN,
  OFFER_MAPPING_REPOSITORY_TOKEN,
  OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
  CATEGORY_RESOLUTION_SERVICE_TOKEN,
} from './listings.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([IdentifierMappingOrmEntity, OfferCreationRecordOrmEntity]),
    IntegrationsModule,
    IdentifierMappingModule,
    ProductsModule,
    MappingsModule,
  ],
  providers: [
    OfferLinkingService,
    OfferMappingSyncService,
    CategoryResolutionService,
    OfferMappingRepository,
    OfferCreationRecordRepository,
    {
      provide: OFFER_LINKING_SERVICE_TOKEN,
      useExisting: OfferLinkingService,
    },
    {
      provide: OFFER_MAPPING_SYNC_SERVICE_TOKEN,
      useExisting: OfferMappingSyncService,
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
      provide: 'OfferLinkingService',
      useExisting: OFFER_LINKING_SERVICE_TOKEN,
    },
    {
      provide: 'IOfferMappingSyncService',
      useExisting: OFFER_MAPPING_SYNC_SERVICE_TOKEN,
    },
    {
      provide: CATEGORY_RESOLUTION_SERVICE_TOKEN,
      useExisting: CategoryResolutionService,
    },
    {
      provide: 'ICategoryResolutionService',
      useExisting: CATEGORY_RESOLUTION_SERVICE_TOKEN,
    },
    {
      provide: 'OfferMappingRepositoryPort',
      useExisting: OFFER_MAPPING_REPOSITORY_TOKEN,
    },
    {
      provide: 'OfferCreationRecordRepositoryPort',
      useExisting: OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
    },
  ],
  exports: [
    OFFER_LINKING_SERVICE_TOKEN,
    OFFER_MAPPING_SYNC_SERVICE_TOKEN,
    OFFER_MAPPING_REPOSITORY_TOKEN,
    OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
    CATEGORY_RESOLUTION_SERVICE_TOKEN,
    'ICategoryResolutionService',
    'OfferLinkingService',
    'IOfferMappingSyncService',
    'OfferMappingRepositoryPort',
    'OfferCreationRecordRepositoryPort',
  ],
})
export class ListingsModule {}
