/**
 * Listings Module
 *
 * NestJS module for marketplace offer linking and mapping sync.
 *
 * @module libs/core/src/listings
 */
import { Module } from '@nestjs/common';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { ProductsModule } from '@openlinker/core/products';
import { OfferLinkingService } from './application/services/offer-linking.service';
import { OfferMappingSyncService } from './application/services/offer-mapping-sync.service';
import {
  OFFER_LINKING_SERVICE_TOKEN,
  OFFER_MAPPING_SYNC_SERVICE_TOKEN,
} from './listings.tokens';

// Re-export tokens for convenience
export {
  OFFER_LINKING_SERVICE_TOKEN,
  OFFER_MAPPING_SYNC_SERVICE_TOKEN,
} from './listings.tokens';

@Module({
  imports: [IntegrationsModule, IdentifierMappingModule, ProductsModule],
  providers: [
    OfferLinkingService,
    OfferMappingSyncService,
    {
      provide: OFFER_LINKING_SERVICE_TOKEN,
      useExisting: OfferLinkingService,
    },
    {
      provide: OFFER_MAPPING_SYNC_SERVICE_TOKEN,
      useExisting: OfferMappingSyncService,
    },
    {
      provide: 'OfferLinkingService',
      useExisting: OFFER_LINKING_SERVICE_TOKEN,
    },
    {
      provide: 'IOfferMappingSyncService',
      useExisting: OFFER_MAPPING_SYNC_SERVICE_TOKEN,
    },
  ],
  exports: [
    OFFER_LINKING_SERVICE_TOKEN,
    OFFER_MAPPING_SYNC_SERVICE_TOKEN,
    'OfferLinkingService',
    'IOfferMappingSyncService',
  ],
})
export class ListingsModule {}
