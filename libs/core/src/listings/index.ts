/**
 * Listings Module Exports
 *
 * @module libs/core/src/listings
 */

export { ListingsModule } from './listings.module';
export {
  OFFER_LINKING_SERVICE_TOKEN,
  OFFER_MAPPING_SYNC_SERVICE_TOKEN,
  OFFER_MAPPING_REPOSITORY_TOKEN,
  OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
  CATEGORY_RESOLUTION_SERVICE_TOKEN,
  OFFER_BUILDER_SERVICE_TOKEN,
  OFFER_CREATION_EXECUTION_SERVICE_TOKEN,
  OFFER_CREATION_ENQUEUE_SERVICE_TOKEN,
  SELLER_POLICIES_SERVICE_TOKEN,
  SELLER_POLICIES_CACHE_TOKEN,
} from './listings.tokens';
export { OfferLinkingService } from './application/services/offer-linking.service';
export { OfferMappingSyncService } from './application/services/offer-mapping-sync.service';
export { CategoryResolutionService } from './application/services/category-resolution.service';
export type { ICategoryResolutionService } from './application/interfaces/category-resolution.service.interface';
export type {
  CategoryResolutionInput,
  CategoryResolutionResult,
  CategoryResolutionMethod,
} from './application/types/category-resolution.types';
export { CategoryResolutionMethodValues } from './application/types/category-resolution.types';
export type {
  IOfferMappingSyncService,
  OfferMappingSyncOptions,
  OfferMappingSyncResult,
} from './application/services/offer-mapping-sync.service.interface';
export type { OfferMappingRepositoryPort } from './domain/ports/offer-mapping-repository.port';
export type {
  OfferMappingFilters,
  OfferMappingPagination,
  PaginatedOfferMappings,
} from './domain/types/offer-mapping.types';
export type {
  OfferDescriptionSectionItem,
  OfferDescriptionSection,
  OfferPriceUpdate,
  OfferDescriptionUpdate,
  OfferFieldUpdate,
} from './domain/types/offer-update.types';
export { OfferCreationRecord } from './domain/entities/offer-creation-record.entity';
export { OfferCreationStatusValues } from './domain/types/offer-creation-record.types';
export type {
  OfferCreationStatus,
  OfferCreationError,
  CreateOfferCreationRecordInput,
} from './domain/types/offer-creation-record.types';
export { OFFER_CREATION_REQUEST_SNAPSHOT_SCHEMA_VERSION } from './domain/types/offer-creation-request-snapshot.types';
export type {
  OfferCreationRequestSnapshot,
  OfferCreationRequestPriceSnapshot,
} from './domain/types/offer-creation-request-snapshot.types';
export type { OfferCreationRecordRepositoryPort } from './domain/ports/offer-creation-record-repository.port';
export { OfferCreationRecordNotFoundException } from './domain/exceptions/offer-creation-record-not-found.exception';
export { OfferBuilderService } from './application/services/offer-builder.service';
export type { IOfferBuilderService } from './application/interfaces/offer-builder.service.interface';
export type { BuildCreateOfferCommandInput } from './application/types/offer-builder.types';
export { OfferCreationExecutionService } from './application/services/offer-creation-execution.service';
export type { IOfferCreationExecutionService } from './application/interfaces/offer-creation-execution.service.interface';
export type {
  ExecuteOfferCreationInput,
  ExecuteOfferCreationResult,
} from './application/types/offer-creation-execution.types';
export {
  OfferBuilderValidationException,
} from './domain/exceptions/offer-builder-validation.exception';
export type {
  OfferBuilderValidationIssue,
} from './domain/exceptions/offer-builder-validation.exception';
export { MasterCatalogConnectionNotConfiguredException } from './domain/exceptions/master-catalog-connection-not-configured.exception';
export { SellerPoliciesService } from './application/services/seller-policies.service';
export type { ISellerPoliciesService } from './application/interfaces/seller-policies.service.interface';
export type {
  SellerPoliciesCacheRepositoryPort,
  CachedSellerPolicies,
} from './domain/ports/seller-policies-cache-repository.port';
export { OfferCreationEnqueueService } from './application/services/offer-creation-enqueue.service';
export type { IOfferCreationEnqueueService } from './application/interfaces/offer-creation-enqueue.service.interface';
export type {
  EnqueueOfferCreationInput,
  EnqueueOfferCreationResult,
} from './application/types/offer-creation-enqueue.types';

// OfferManagerPort + its contract types (moved here as part of #328 split)
export { OfferManagerPort } from './domain/ports/offer-manager.port';
export type {
  OfferFeedInput,
  OfferFeedItem,
  OfferFeedOutput,
} from './domain/types/offer-feed.types';
export type {
  UpdateOfferQuantityCommand,
  UpdateOfferQuantitiesBatchCommand,
  UpdateOfferQuantitiesBatchResult,
  UpdateOfferQuantitiesBatchFailure,
} from './domain/types/offer-quantity-update.types';
export type { UpdateOfferFieldsCommand } from './domain/types/offer-fields-update.types';
export type { OfferCategory } from './domain/types/category.types';
export { CreateOfferResultStatusValues } from './domain/types/offer-create.types';
export type {
  CreateOfferCommand,
  CreateOfferOverrides,
  CreateOfferResult,
  CreateOfferResultStatus,
  CreateOfferValidationError,
} from './domain/types/offer-create.types';
export type { SellerPolicy, SellerPolicies } from './domain/types/seller-policies.types';
export { OfferCreateRejectedException } from './domain/exceptions/offer-create-rejected.exception';

// OfferManagerPort sub-capabilities (#337): optional capabilities extracted into
// distinct interfaces + co-located type guards. Call sites narrow support via
// `is{Capability}(adapter)`; see capabilities/offer-lister.capability.ts for the
// shared naming convention.
export type { OfferLister } from './domain/ports/capabilities/offer-lister.capability';
export { isOfferLister } from './domain/ports/capabilities/offer-lister.capability';
export type { OfferEventReader } from './domain/ports/capabilities/offer-event-reader.capability';
export { isOfferEventReader } from './domain/ports/capabilities/offer-event-reader.capability';
export type { OfferQuantityBatchUpdater } from './domain/ports/capabilities/offer-quantity-batch-updater.capability';
export { isOfferQuantityBatchUpdater } from './domain/ports/capabilities/offer-quantity-batch-updater.capability';
export type { OfferFieldUpdater } from './domain/ports/capabilities/offer-field-updater.capability';
export { isOfferFieldUpdater } from './domain/ports/capabilities/offer-field-updater.capability';
export type { CategoryBrowser } from './domain/ports/capabilities/category-browser.capability';
export { isCategoryBrowser } from './domain/ports/capabilities/category-browser.capability';
export type { CategoryBarcodeMatcher } from './domain/ports/capabilities/category-barcode-matcher.capability';
export { isCategoryBarcodeMatcher } from './domain/ports/capabilities/category-barcode-matcher.capability';
export type { OfferCreator } from './domain/ports/capabilities/offer-creator.capability';
export { isOfferCreator } from './domain/ports/capabilities/offer-creator.capability';
export type { SellerPoliciesReader } from './domain/ports/capabilities/seller-policies-reader.capability';
export { isSellerPoliciesReader } from './domain/ports/capabilities/seller-policies-reader.capability';
