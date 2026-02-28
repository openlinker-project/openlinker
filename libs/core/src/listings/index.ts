/**
 * Listings Module Exports
 *
 * @module libs/core/src/listings
 */

export { ListingsModule } from './listings.module';
export {
  OFFER_LINKING_SERVICE_TOKEN,
  OFFER_MAPPING_SYNC_SERVICE_TOKEN,
} from './listings.tokens';
export { OfferLinkingService } from './application/services/offer-linking.service';
export { OfferMappingSyncService } from './application/services/offer-mapping-sync.service';
export type {
  IOfferMappingSyncService,
  OfferMappingSyncOptions,
  OfferMappingSyncResult,
} from './application/services/offer-mapping-sync.service.interface';
