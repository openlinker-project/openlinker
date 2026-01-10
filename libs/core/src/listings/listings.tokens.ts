/**
 * Dependency Injection Tokens
 *
 * Symbol tokens for dependency injection in the listings module.
 * These tokens are used to inject interfaces (which can't be used as values)
 * into services and other providers.
 *
 * @module libs/core/src/listings
 */

// Token for dependency injection (interfaces can't be used as values)
export const OFFER_MAPPING_REPOSITORY_TOKEN = Symbol('OfferMappingRepositoryPort');
export const OFFER_MAPPING_SERVICE_TOKEN = Symbol('IOfferMappingService');



