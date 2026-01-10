/**
 * Listings Module Exports
 *
 * Public API for the listings module. Exports marketplace integration ports and
 * related types for use by adapters and application services.
 *
 * @module libs/core/src/listings
 */

// Ports
export { MarketplaceIntegrationPort } from './domain/ports/marketplace-integration.port';
export { OfferMappingRepositoryPort } from './domain/ports/offer-mapping-repository.port';

// Types
export {
  MarketplaceOrderFeedItem,
  MarketplaceOrderFeedResponse,
  OfferQuantityUpdateStatusValues,
  OfferQuantityUpdateStatus,
  UpdateOfferQuantityRequest,
  UpdateOfferQuantityResult,
} from './domain/types/marketplace-integration.types';

// Entities
export { OfferMapping } from './domain/entities/offer-mapping.entity';

// Exceptions
export { DuplicateOfferMappingError } from './domain/exceptions/duplicate-offer-mapping.error';

// Services
export { IOfferMappingService } from './application/interfaces/offer-mapping.service.interface';
export { OFFER_MAPPING_SERVICE_TOKEN, OFFER_MAPPING_REPOSITORY_TOKEN } from './listings.tokens';

// Module
export { ListingsModule } from './listings.module';


