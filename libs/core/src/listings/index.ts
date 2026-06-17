/**
 * Listings — Pure Public Barrel
 *
 * Pure contracts only: ports, types, capability interfaces + guards, domain
 * entities, exceptions, enumeration consts, Symbol tokens, service interfaces,
 * and execution input/output types. Nothing exported from this file
 * transitively reaches back into sibling packages at runtime — it is safe to
 * value-import from any `@openlinker/core/*` module.
 *
 * Runtime wiring lives on the companion subpath `@openlinker/core/listings/services`
 * (`ListingsModule` + the 8 `@Injectable` service classes). Keeping them split
 * prevents the runtime circular require that #337 exposed and #359 fixed:
 * `products → listings → services → products` would resolve one side of the
 * cycle to a partial module and surface as `Symbol(?)` DI failures in Nest.
 *
 * Regression guard: `libs/core/src/listings/__tests__/barrel-purity.spec.ts`
 * asserts none of the 7 service classes or `ListingsModule` are re-exported here.
 *
 * @module libs/core/src/listings
 */

export type { IOfferStatusPollService } from './application/interfaces/offer-status-poll.service.interface';
export type {
  ScheduleFirstPollInput,
  PollOnceInput,
  PollOnceResult,
  OfferPollCadenceConfig,
} from './application/types/offer-status-poll.types';
export type { ICategoryResolutionService } from './application/interfaces/category-resolution.service.interface';
export type {
  CategoryResolutionInput,
  CategoryResolutionResult,
  CategoryResolutionMethod,
  CategoryProvenance,
} from './application/types/category-resolution.types';
export {
  CategoryResolutionMethodValues,
  CategoryProvenanceValues,
} from './application/types/category-resolution.types';
export type { IAttributeProjectionService } from './application/interfaces/attribute-projection.service.interface';
export type {
  AttributeProjectionInput,
  AttributeProjectionResult,
  ResolvedParameter,
} from './application/types/attribute-projection.types';
export type { IOfferLinkingService } from './application/interfaces/offer-linking.service.interface';
export type {
  OfferLinkMethod,
  OfferLinkingLookups,
  OfferLinkingResult,
} from './application/types/offer-linking.types';
export { OfferLinkMethodValues } from './application/types/offer-linking.types';
export type {
  IOfferMappingSyncService,
  OfferMappingSyncOptions,
  OfferMappingSyncResult,
} from './application/services/offer-mapping-sync.service.interface';
export type { IOfferMappingsService } from './application/services/offer-mappings.service.interface';
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
export {
  OfferCreationStatusValues,
  OFFER_CREATION_STATUS,
} from './domain/types/offer-creation-record.types';
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
export { BulkListingBatch } from './domain/entities/bulk-listing-batch.entity';
export { BulkBatchStatusValues, BULK_BATCH_STATUS } from './domain/types/bulk-listing-batch.types';
export type {
  BulkBatchStatus,
  CreateBulkListingBatchInput,
} from './domain/types/bulk-listing-batch.types';
export type { BulkListingBatchRepositoryPort } from './domain/ports/bulk-listing-batch-repository.port';
export { BulkListingBatchNotFoundException } from './domain/exceptions/bulk-listing-batch-not-found.exception';
export { EmptyBulkSubmissionException } from './domain/exceptions/empty-bulk-submission.exception';
export { BulkBatchAdvancement } from './domain/entities/bulk-batch-advancement.entity';
export type { BulkBatchAdvancementRepositoryPort } from './domain/ports/bulk-batch-advancement-repository.port';
export { BulkChildOutcomeValues } from './domain/types/bulk-child-outcome.types';
export type { BulkChildOutcome } from './domain/types/bulk-child-outcome.types';
export type { IBulkListingProgressService } from './application/services/bulk-listing-progress.service.interface';
export type { IBulkListingSubmitService } from './application/interfaces/bulk-listing-submit.service.interface';
export type {
  BulkSharedConfig,
  PerProductOverride,
  BulkListingSubmitInput,
  BulkListingSubmitResult,
  BulkBatchSummary,
} from './application/types/bulk-listing-submit.types';
export type { IBulkListingRetryService } from './application/interfaces/bulk-listing-retry.service.interface';
export type {
  BulkListingRetryAiFlags,
  BulkListingRetryResult,
} from './application/types/bulk-listing-retry.types';
export { AdapterCapabilityNotSupportedException } from './domain/exceptions/adapter-capability-not-supported.exception';
export { BulkRetryMissingSnapshotException } from './domain/exceptions/bulk-retry-missing-snapshot.exception';
export { NoFailedChildrenToRetryException } from './domain/exceptions/no-failed-children-to-retry.exception';
export { OfferCreationInvariantException } from './domain/exceptions/offer-creation-invariant.exception';
export type { IOfferBuilderService } from './application/interfaces/offer-builder.service.interface';
export type { BuildCreateOfferCommandInput } from './application/types/offer-builder.types';
export type { IOfferCreationExecutionService } from './application/interfaces/offer-creation-execution.service.interface';
export type {
  ExecuteOfferCreationInput,
  ExecuteOfferCreationResult,
} from './application/types/offer-creation-execution.types';
export { OfferBuilderValidationException } from './domain/exceptions/offer-builder-validation.exception';
export type { OfferBuilderValidationIssue } from './domain/exceptions/offer-builder-validation.exception';
export { MasterCatalogConnectionNotConfiguredException } from './domain/exceptions/master-catalog-connection-not-configured.exception';
export type { ISellerPoliciesService } from './application/interfaces/seller-policies.service.interface';
export type {
  SellerPoliciesCacheRepositoryPort,
  CachedSellerPolicies,
} from './domain/ports/seller-policies-cache-repository.port';
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
  OfferVariantGroup,
  OfferVariantAttribute,
  SourceCategoryRef,
} from './domain/types/offer-create.types';
export type { OfferParameter } from './domain/types/offer-parameter.types';
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
export type { EanCategoryMatcher } from './domain/ports/capabilities/ean-category-matcher.capability';
export { isEanCategoryMatcher } from './domain/ports/capabilities/ean-category-matcher.capability';
export type { OfferSmartClassificationReader } from './domain/ports/capabilities/offer-smart-classification-reader.capability';
export { isOfferSmartClassificationReader } from './domain/ports/capabilities/offer-smart-classification-reader.capability';
export type {
  SmartClassificationReport,
  SmartClassificationCondition,
} from './domain/types/smart-classification.types';
export { EanMatchResultKindValues } from './domain/types/ean-category-match.types';
export type {
  EanMatchResultKind,
  EanMatchResult,
  EanMatchCandidate,
  BatchCategoryByEanInput,
} from './domain/types/ean-category-match.types';
export type { CategoryParametersReader } from './domain/ports/capabilities/category-parameters-reader.capability';
export { isCategoryParametersReader } from './domain/ports/capabilities/category-parameters-reader.capability';
export type { CatalogProductReader } from './domain/ports/capabilities/catalog-product-reader.capability';
export { isCatalogProductReader } from './domain/ports/capabilities/catalog-product-reader.capability';
export type {
  CatalogProduct,
  CatalogProductSummary,
  CatalogProductParameter,
  CatalogProductMatchResult,
  CatalogProductMatchKind,
  FindProductsByBarcodeInput,
} from './domain/types/catalog-product.types';
export { CatalogProductMatchKindValues } from './domain/types/catalog-product.types';
export { CatalogProductNotFoundException } from './domain/exceptions/catalog-product-not-found.exception';
export type {
  CategoryParameter,
  CategoryParameterDictionaryEntry,
  CategoryParameterRestrictions,
  CategoryParameterDependsOn,
  CategoryParameterType,
  CategoryParameterSection,
} from './domain/types/category-parameter.types';
export {
  CategoryParameterTypeValues,
  CategoryParameterSectionValues,
} from './domain/types/category-parameter.types';
export { CategoryNotFoundException } from './domain/exceptions/category-not-found.exception';
export type { OfferCreator } from './domain/ports/capabilities/offer-creator.capability';
export { isOfferCreator } from './domain/ports/capabilities/offer-creator.capability';
export type { OfferStatusReader } from './domain/ports/capabilities/offer-status-reader.capability';
export { isOfferStatusReader } from './domain/ports/capabilities/offer-status-reader.capability';
export type {
  OfferPublicationStatus,
  OfferStatusReadResult,
} from './domain/types/offer-status-read.types';
export { OfferPublicationStatusValues } from './domain/types/offer-status-read.types';
export { OfferStatusSnapshot } from './domain/entities/offer-status-snapshot.entity';
export type {
  OfferStatusSnapshotProps,
  OfferStatusSnapshotDetails,
  UpsertOfferStatusSnapshotCommand,
  OfferStatusSyncResult,
} from './domain/types/offer-status-snapshot.types';
export type {
  OfferStatusSnapshotRepositoryPort,
  OfferStatusUpsertResult,
} from './domain/ports/offer-status-snapshot-repository.port';
export type {
  IOfferStatusSyncService,
  OfferStatusSyncOptions,
} from './application/services/offer-status-sync.service.interface';
export { OfferPollNotSupportedException } from './domain/exceptions/offer-poll-not-supported.exception';
export { OfferNotFoundOnMarketplaceException } from './domain/exceptions/offer-not-found-on-marketplace.exception';
export type { OfferReader } from './domain/ports/capabilities/offer-reader.capability';
export { isOfferReader } from './domain/ports/capabilities/offer-reader.capability';
export type {
  MarketplaceOffer,
  MarketplaceOfferPrice,
  MarketplaceOfferCategory,
} from './domain/types/marketplace-offer.types';
export type { SellerPoliciesReader } from './domain/ports/capabilities/seller-policies-reader.capability';
export { isSellerPoliciesReader } from './domain/ports/capabilities/seller-policies-reader.capability';
export type {
  SafetyAttachmentUploader,
  SafetyAttachmentUploadInput,
  SafetyAttachmentUploadResult,
} from './domain/ports/capabilities/safety-attachment-uploader.capability';
export { isSafetyAttachmentUploader } from './domain/ports/capabilities/safety-attachment-uploader.capability';
export type { ResponsibleProducerReader } from './domain/ports/capabilities/responsible-producer-reader.capability';
export { isResponsibleProducerReader } from './domain/ports/capabilities/responsible-producer-reader.capability';
export type {
  ResponsibleProducerEntry,
  ResponsibleProducerKind,
} from './domain/types/responsible-producer.types';
export { ResponsibleProducerKindValues } from './domain/types/responsible-producer.types';

// Shop-listing capabilities (#1041, ADR-024): the shop sibling of OfferManager.
// `ShopProductManagerPort` is the base port (mandatory `publishProduct`, registry
// name 'ProductPublisher'); `CategoryProvisioner` is its provision sub-capability.
export type { ShopProductManagerPort } from './domain/ports/shop-product-manager.port';
export type { CategoryProvisioner } from './domain/ports/capabilities/category-provisioner.capability';
export { isCategoryProvisioner } from './domain/ports/capabilities/category-provisioner.capability';
export { PublishProductStatusValues } from './domain/types/product-publish.types';
export type {
  PublishProductStatus,
  PublishProductContent,
  PublishProductCommand,
  PublishProductResult,
} from './domain/types/product-publish.types';
export type {
  ProvisionCategoryPathNode,
  ProvisionCategoryCommand,
  ProvisionCategoryResult,
} from './domain/types/category-provision.types';
export { ProductPublishRejectedException } from './domain/exceptions/product-publish-rejected.exception';

// Shop publish execution (#1042, #1072) — pure contracts only (the two service
// classes live on `@openlinker/core/listings/services`, never here).
export { ListingCreationRecord } from './domain/entities/listing-creation-record.entity';
export {
  ListingCreationStatusValues,
  LISTING_CREATION_STATUS,
} from './domain/types/listing-creation-record.types';
export type {
  ListingCreationStatus,
  ListingCreationError,
  CreateListingCreationRecordInput,
} from './domain/types/listing-creation-record.types';
export type { ListingCreationRecordRepositoryPort } from './domain/ports/listing-creation-record-repository.port';
export { ListingCreationInvariantException } from './domain/exceptions/listing-creation-invariant.exception';
export { ListingCreationRecordNotFoundException } from './domain/exceptions/listing-creation-record-not-found.exception';
export { ProductPublishBuilderValidationException } from './domain/exceptions/product-publish-builder-validation.exception';
export type { ProductPublishBuilderValidationIssue } from './domain/exceptions/product-publish-builder-validation.exception';
export type { IProductPublishBuilderService } from './application/interfaces/product-publish-builder.service.interface';
export type { BuildPublishProductCommandInput } from './application/types/product-publish-builder.types';
export type { IProductPublishExecutionService } from './application/interfaces/product-publish-execution.service.interface';
export type {
  ExecutePublishProductInput,
  ExecutePublishProductResult,
} from './application/types/product-publish-execution.types';
// Shop publish API + bulk surfaces (#1044)
export type { IProductPublishEnqueueService } from './application/interfaces/product-publish-enqueue.service.interface';
export type {
  EnqueueProductPublishInput,
  EnqueueProductPublishResult,
} from './application/types/product-publish-enqueue.types';
export type { IListingCreationQueryService } from './application/interfaces/listing-creation-query.service.interface';
export type { IBulkShopPublishSubmitService } from './application/interfaces/bulk-shop-publish-submit.service.interface';
export type {
  BulkShopPublishSubmitInput,
  BulkShopPublishSubmitResult,
  BulkShopPublishItem,
  BulkShopPublishBatchSummary,
} from './application/types/bulk-shop-publish-submit.types';

// Tokens
export * from './listings.tokens';
