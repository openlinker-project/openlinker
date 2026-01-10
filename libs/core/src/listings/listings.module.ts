/**
 * Listings Module
 *
 * NestJS module for listings functionality. Configures TypeORM entities,
 * repositories, and services. Exports the offer mapping service and ports
 * for use in other modules.
 *
 * @module libs/core/src/listings
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OfferMappingOrmEntity } from './infrastructure/persistence/entities/offer-mapping.orm-entity';
import { OfferMappingRepository } from './infrastructure/persistence/repositories/offer-mapping.repository';
import { OfferMappingService } from './application/services/offer-mapping.service';
import {
  OFFER_MAPPING_REPOSITORY_TOKEN,
  OFFER_MAPPING_SERVICE_TOKEN,
} from './listings.tokens';

// Re-export tokens for convenience
export {
  OFFER_MAPPING_REPOSITORY_TOKEN,
  OFFER_MAPPING_SERVICE_TOKEN,
} from './listings.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([OfferMappingOrmEntity]),
  ],
  providers: [
    // Provide classes directly first
    OfferMappingRepository,
    OfferMappingService,
    // Then provide token bindings using useExisting
    {
      provide: OFFER_MAPPING_REPOSITORY_TOKEN,
      useExisting: OfferMappingRepository,
    },
    {
      provide: OFFER_MAPPING_SERVICE_TOKEN,
      useExisting: OfferMappingService,
    },
    // Also provide as string tokens for convenience
    {
      provide: 'OfferMappingRepositoryPort',
      useExisting: OFFER_MAPPING_REPOSITORY_TOKEN,
    },
    {
      provide: 'IOfferMappingService',
      useExisting: OFFER_MAPPING_SERVICE_TOKEN,
    },
  ],
  exports: [
    OFFER_MAPPING_REPOSITORY_TOKEN,
    OFFER_MAPPING_SERVICE_TOKEN,
    'OfferMappingRepositoryPort',
    'IOfferMappingService',
  ],
})
export class ListingsModule {}


