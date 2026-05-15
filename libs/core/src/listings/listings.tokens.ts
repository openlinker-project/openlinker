/**
 * Dependency Injection Tokens (Listings)
 *
 * @module libs/core/src/listings
 */

export const OFFER_LINKING_SERVICE_TOKEN = Symbol('OfferLinkingService');
export const OFFER_MAPPING_SYNC_SERVICE_TOKEN = Symbol('OfferMappingSyncService');
export const OFFER_MAPPINGS_SERVICE_TOKEN = Symbol('IOfferMappingsService');
export const OFFER_MAPPING_REPOSITORY_TOKEN = Symbol('OfferMappingRepositoryPort');
export const OFFER_CREATION_RECORD_REPOSITORY_TOKEN = Symbol('OfferCreationRecordRepositoryPort');
export const CATEGORY_RESOLUTION_SERVICE_TOKEN = Symbol('ICategoryResolutionService');
export const OFFER_BUILDER_SERVICE_TOKEN = Symbol('IOfferBuilderService');
export const OFFER_CREATION_EXECUTION_SERVICE_TOKEN = Symbol('IOfferCreationExecutionService');
export const OFFER_CREATION_ENQUEUE_SERVICE_TOKEN = Symbol('IOfferCreationEnqueueService');
export const OFFER_STATUS_POLL_SERVICE_TOKEN = Symbol('IOfferStatusPollService');
export const SELLER_POLICIES_SERVICE_TOKEN = Symbol('ISellerPoliciesService');
export const SELLER_POLICIES_CACHE_TOKEN = Symbol('SellerPoliciesCacheRepositoryPort');
