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
  BatchCategoryResolveItem,
  BatchCategoryResolveInput,
} from './application/types/category-resolution.types';
export {
  CategoryResolutionMethodValues,
  CategoryProvenanceValues,
} from './application/types/category-resolution.types';
export type { TaxonomyOwner } from './domain/types/taxonomy-owner.types';
export { TaxonomyOwnerValues } from './domain/types/taxonomy-owner.types';

// Destination taxonomy read model (#1979, ADR-037). Contracts only — the
// service CLASS stays on the `/services` sub-barrel (#337/#359).
export { DestinationCategory } from './domain/entities/destination-category.entity';
export type { DestinationCategoryRepositoryPort } from './domain/ports/destination-category-repository.port';
export type {
  DestinationCategoryLike,
  DestinationCategorySearchHit,
  DestinationCategoryUpsert,
  TaxonomyScope,
  TaxonomySyncInput,
  TaxonomySyncResult,
} from './domain/types/destination-category.types';
export type { IDestinationTaxonomyService } from './application/interfaces/destination-taxonomy.service.interface';
export { TaxonomySourceUnavailableException } from './domain/exceptions/taxonomy-source-unavailable.exception';
export { normalizeCategorySearchText } from './domain/destination-category-search';
export { resolveTaxonomyOwner } from './domain/resolve-taxonomy-owner';
export type { IAttributeProjectionService } from './application/interfaces/attribute-projection.service.interface';
export type {
  AttributeProjectionInput,
  AttributeProjectionResult,
  AttributeProjectionMetadata,
  ResolvedParameter,
} from './application/types/attribute-projection.types';
export { buildProjectionMetadata } from './application/services/build-projection-metadata';
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
export type { ShopProductMappingRepositoryPort } from './domain/ports/shop-product-mapping-repository.port';
export type { IPublishedVariantsService } from './application/services/published-variants.service.interface';
export type { IShopProductMappingsService } from './application/services/shop-product-mappings.service.interface';
export type {
  OfferMappingFilters,
  OfferMappingCountFilters,
  OfferMappingPagination,
  OfferMappingIdentity,
  OfferMappingChannelStatus,
  OfferMappingCommercial,
  OfferMappingListItem,
  PaginatedOfferMappings,
  ProductListingsCoverage,
  StaleMappedVariant,
} from './domain/types/offer-mapping.types';
export { deriveVariantLabel } from './domain/types/offer-mapping.types';

// Offer lifecycle (#2025) — the five disjoint buckets the redesigned listings
// page partitions on, plus the pure derivation off a status snapshot.
// `sumOfferLifecycleCounts` is now published: `listings.controller.ts` derives
// `total` from it whenever `includeLifecycleCounts` is set, instead of running
// a second, provably-redundant `getCount()` (#2032 review thread 3) — its
// first production caller. `OfferSnapshotFacts` stays unpublished: it has no
// consumer outside its defining module.
export {
  OfferLifecycleValues,
  deriveOfferLifecycle,
  resolveOfferLifecycle,
  listSnapshotFactsForLifecycle,
  emptyOfferLifecycleCounts,
  sumOfferLifecycleCounts,
} from './domain/types/offer-lifecycle.types';
export type { OfferLifecycle, OfferLifecycleCounts } from './domain/types/offer-lifecycle.types';
export { UnfilterableOfferLifecycleException } from './domain/exceptions/unfilterable-offer-lifecycle.exception';

export type { ICoverageGapReadService } from './application/services/coverage-gap-read.service.interface';
export type { CoverageGapItem, CoverageGapsResult } from './domain/types/coverage-gap.types';
export type { IStockAtRiskReadService } from './application/services/stock-at-risk-read.service.interface';
export type { StockAtRiskItem, StockAtRiskResult } from './domain/types/stock-at-risk.types';
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
export { AllVariantsAlreadyListedException } from './domain/exceptions/all-variants-already-listed.exception';
export { InvalidEanException } from './domain/exceptions/invalid-ean.exception';
export { DuplicateBatchEanException } from './domain/exceptions/duplicate-batch-ean.exception';
export { CurrencyMismatchException } from './domain/exceptions/currency-mismatch.exception';
export { InvalidOverrideKeyException } from './domain/exceptions/invalid-override-key.exception';
export { ExpandedOfferCeilingExceededException } from './domain/exceptions/expanded-offer-ceiling-exceeded.exception';
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
export { OfferStatusSnapshotUpsertFailedError } from './domain/exceptions/offer-status-snapshot-upsert-failed.exception';
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
export type { IResponsibleProducerService } from './application/interfaces/responsible-producer.service.interface';
export type { IDeliveryPriceListService } from './application/interfaces/delivery-price-list.service.interface';
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
export type { OfferCategory, CategoryPathSegment } from './domain/types/category.types';
export { CreateOfferResultStatusValues, OfferConditionValues } from './domain/types/offer-create.types';
export type {
  CreateOfferCommand,
  CreateOfferOverrides,
  CreateOfferResult,
  CreateOfferResultStatus,
  CreateOfferValidationError,
  OfferCondition,
  OfferVariantGroup,
  OfferVariantAttribute,
  SourceCategoryRef,
  SourceAttribute,
} from './domain/types/offer-create.types';
export type { OfferParameter } from './domain/types/offer-parameter.types';
export type { SellerPolicy, SellerPolicies } from './domain/types/seller-policies.types';
export type { DeliveryPriceList } from './domain/types/delivery-price-list.types';
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
export type { OfferStockRestorer } from './domain/ports/capabilities/offer-stock-restorer.capability';
export { isOfferStockRestorer } from './domain/ports/capabilities/offer-stock-restorer.capability';
export type { OfferStockRestoreTarget } from './domain/types/offer-stock-restore.types';
export type { CategoryBrowser } from './domain/ports/capabilities/category-browser.capability';
export { isCategoryBrowser } from './domain/ports/capabilities/category-browser.capability';
export type { CategoryPathReader } from './domain/ports/capabilities/category-path-reader.capability';
export { isCategoryPathReader } from './domain/ports/capabilities/category-path-reader.capability';
export type { CategoryBarcodeMatcher } from './domain/ports/capabilities/category-barcode-matcher.capability';
export { isCategoryBarcodeMatcher } from './domain/ports/capabilities/category-barcode-matcher.capability';
export type { EanCategoryMatcher } from './domain/ports/capabilities/ean-category-matcher.capability';
export {
  EAN_CATEGORY_MATCHER_CAPABILITY,
  isEanCategoryMatcher,
} from './domain/ports/capabilities/ean-category-matcher.capability';
export type { EanCategoryMatcherStreaming } from './domain/ports/capabilities/ean-category-matcher-streaming.capability';
export {
  EAN_CATEGORY_MATCHER_STREAMING_CAPABILITY,
  isEanCategoryMatcherStreaming,
} from './domain/ports/capabilities/ean-category-matcher-streaming.capability';
export type { OfferSmartClassificationReader } from './domain/ports/capabilities/offer-smart-classification-reader.capability';
export { isOfferSmartClassificationReader } from './domain/ports/capabilities/offer-smart-classification-reader.capability';
export type {
  SmartClassificationReport,
  SmartClassificationCondition,
} from './domain/types/smart-classification.types';
export { EanMatchResultKindValues, EanMatchMethodValues } from './domain/types/ean-category-match.types';
export type {
  EanMatchResultKind,
  EanMatchMethod,
  EanMatchResult,
  EanMatchCandidate,
  BatchCategoryByEanInput,
} from './domain/types/ean-category-match.types';
export {
  EanCategoryMatchStreamEventKindValues,
  EanCategoryMatchStreamCompletionValues,
} from './domain/types/ean-category-match-stream.types';
export type {
  EanCategoryMatchStreamEventKind,
  EanCategoryMatchStreamCompletion,
  EanCategoryMatchStreamItem,
  EanCategoryMatchStreamResultEvent,
  EanCategoryMatchStreamDoneEvent,
  EanCategoryMatchStreamEvent,
  EanCategoryMatchStreamOptions,
} from './domain/types/ean-category-match-stream.types';
export { ResolveConcurrencySourceValues } from './domain/types/resolve-concurrency.types';
export type {
  ResolveConcurrencySource,
  ResolveConcurrencyCeiling,
} from './domain/types/resolve-concurrency.types';
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
export type { AdapterSuppliedParametersReader } from './domain/ports/capabilities/adapter-supplied-parameters-reader.capability';
export { isAdapterSuppliedParametersReader } from './domain/ports/capabilities/adapter-supplied-parameters-reader.capability';
export type { OfferStatusReader } from './domain/ports/capabilities/offer-status-reader.capability';
export { isOfferStatusReader } from './domain/ports/capabilities/offer-status-reader.capability';
export type {
  OfferPublicationStatus,
  OfferPublicationStatusView,
  OfferStatusReadResult,
  OfferCommercialObservation,
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
export { OfferCommercialSnapshot } from './domain/entities/offer-commercial-snapshot.entity';
export type {
  OfferCommercialSnapshotProps,
  UpsertOfferCommercialSnapshotCommand,
} from './domain/types/offer-commercial-snapshot.types';
export type { OfferCommercialSnapshotRepositoryPort } from './domain/ports/offer-commercial-snapshot-repository.port';
export type {
  IOfferStatusSyncService,
  OfferStatusObservation,
  OfferStatusRefreshTarget,
  OfferStatusSyncOptions,
} from './application/services/offer-status-sync.service.interface';
export type { IOfferStatusReadService } from './application/services/offer-status-read.service.interface';
export type { IOfferStockRestoreService } from './application/interfaces/offer-stock-restore.service.interface';
export type { IStaleOfferPauseService } from './application/interfaces/stale-offer-pause.service.interface';
export type { StaleOfferPauseResult } from './domain/types/stale-offer-pause.types';
export { OfferPollNotSupportedException } from './domain/exceptions/offer-poll-not-supported.exception';
export { OfferNotFoundOnMarketplaceException } from './domain/exceptions/offer-not-found-on-marketplace.exception';
export type { OfferReader } from './domain/ports/capabilities/offer-reader.capability';
export { isOfferReader } from './domain/ports/capabilities/offer-reader.capability';
export type {
  MarketplaceOffer,
  MarketplaceOfferPrice,
  MarketplaceOfferCategory,
  MarketplaceOfferParameter,
  MarketplaceOfferProductSetItem,
} from './domain/types/marketplace-offer.types';
export type { SellerPoliciesReader } from './domain/ports/capabilities/seller-policies-reader.capability';
export { isSellerPoliciesReader } from './domain/ports/capabilities/seller-policies-reader.capability';
export type { DeliveryPriceListReader } from './domain/ports/capabilities/delivery-price-list-reader.capability';
export { isDeliveryPriceListReader } from './domain/ports/capabilities/delivery-price-list-reader.capability';
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
// Shop-side category browse (#1834): read the destination's existing category
// tree so an operator can pick a placement. Advertised-without-dispatch;
// narrowed from the `ProductPublisher` adapter via `isShopCategoryBrowser`.
export type { ShopCategory } from './domain/types/shop-category.types';
export type { ShopCategoryBrowser } from './domain/ports/capabilities/shop-category-browser.capability';
export { isShopCategoryBrowser } from './domain/ports/capabilities/shop-category-browser.capability';
export type { IShopCategoryBrowseService } from './application/interfaces/shop-category-browse.service.interface';
export type {
  IDescriptionFormatReadService,
  DescriptionFormatView,
} from './application/services/description-format-read.service.interface';
// Shop-side global attribute read (#1835): read the destination's store-wide
// global attributes + terms so an operator can pick a structured attribute
// (linked on publish), with free-text custom attributes as the fallback.
// Advertised-without-dispatch; narrowed from the `ProductPublisher` adapter via
// `isShopAttributeReader`.
export type { ShopAttribute, ShopAttributeTerm } from './domain/types/shop-attribute.types';
export type { ShopAttributeReader } from './domain/ports/capabilities/shop-attribute-reader.capability';
export { isShopAttributeReader } from './domain/ports/capabilities/shop-attribute-reader.capability';
export type { IShopAttributeReadService } from './application/interfaces/shop-attribute-read.service.interface';
// Taxonomy-borrowing sub-capability (#1045): a `borrows` destination (ERLI)
// names the owner taxonomy whose category/parameter ids it reuses verbatim.
export type { TaxonomyBorrower } from './domain/ports/capabilities/taxonomy-borrower.capability';
export { isTaxonomyBorrower } from './domain/ports/capabilities/taxonomy-borrower.capability';

// Taxonomy-identity sub-capability (#2063): an OWNING marketplace declares which
// distinct tree it reads/writes, because `platformType` cannot express an axis
// the platform splits its tree along (Allegro sandbox vs production).
export type { TaxonomyIdentityProvider } from './domain/ports/capabilities/taxonomy-identity-provider.capability';
export { isTaxonomyIdentityProvider } from './domain/ports/capabilities/taxonomy-identity-provider.capability';
export { PublishProductStatusValues, PublishTaxStatusValues } from './domain/types/product-publish.types';
export type {
  PublishProductStatus,
  PublishTaxStatus,
  PublishProductContent,
  PublishProductCommerce,
  PublishProductCommand,
  PublishProductResult,
  PublishProductVariantGroup,
} from './domain/types/product-publish.types';
export type {
  ProvisionCategoryPathNode,
  ProvisionCategoryCommand,
  ProvisionCategoryResult,
} from './domain/types/category-provision.types';
export { ProductPublishRejectedException } from './domain/exceptions/product-publish-rejected.exception';
export { ProductPublishTargetNotFoundException } from './domain/exceptions/product-publish-target-not-found.exception';

// Required-to-sell preflight (#1842) — pure, side-effect-free "would publish
// but not be sellable" checker + shared shape (cross-cutting seam for a
// future marketplace-side check).
export { checkRequiredToSell } from './application/services/check-required-to-sell';
export { applyDescriptionFormat } from './application/services/apply-description-format';
export {
  resolveOfferDescriptionFormat,
  resolveShopDescriptionFormat,
  formatDescriptionForDestination,
  formatOfferFieldsForDestination,
} from './application/services/description-format-resolution';
export type {
  DescriptionFormat,
  DescriptionShape,
  DescriptionRewrite,
  DescriptionRewriteAction,
  DescriptionContentModel,
  DescriptionFormatSource,
} from './domain/types/description-format.types';
export {
  CONSERVATIVE_DESCRIPTION_FORMAT,
  DESCRIPTION_BLOCK_TAGS,
  DescriptionShapeValues,
  DescriptionRewriteActionValues,
  DescriptionFormatSourceValues,
} from './domain/types/description-format.types';
export {
  RequiredToSellSeverityValues,
  RequiredToSellIssueCodeValues,
} from './domain/types/required-to-sell.types';
export type {
  RequiredToSellSeverity,
  RequiredToSellIssueCode,
  RequiredToSellIssue,
  RequiredToSellCheckInput,
} from './domain/types/required-to-sell.types';

// Category-parameter restrictions (#2243) — pure checker over the bounds a
// destination already declared on `CategoryParameter.restrictions`, so a value
// that cannot publish is reported by field name instead of by the marketplace's
// own rejection. Mirrored client-side; the mirror is guarded by
// `scripts/check-parameter-restriction-mirror.mjs`.
export { checkParameterRestrictions } from './application/services/check-parameter-restrictions';
export {
  ParameterRestrictionSeverityValues,
  ParameterRestrictionIssueCodeValues,
} from './domain/types/parameter-restriction.types';
export type {
  ParameterRestrictionSeverity,
  ParameterRestrictionIssueCode,
  ParameterRestrictionIssue,
  ParameterValueInput,
} from './domain/types/parameter-restriction.types';

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
  ShopPublishRequestSnapshot,
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
  BulkShopPublishSubmitItemInput,
  BulkShopPublishSubmitResult,
  BulkShopPublishItem,
  BulkShopPublishBatchSummary,
} from './application/types/bulk-shop-publish-submit.types';
// Shop publish retry (#1845)
export type { IBulkShopPublishRetryService } from './application/interfaces/bulk-shop-publish-retry.service.interface';
export type { BulkShopPublishRetryResult } from './application/types/bulk-shop-publish-retry.types';
export { ShopProductMappingConflictException } from './domain/exceptions/shop-product-mapping-conflict.exception';
// Shop product status reconcile (#1845)
export {
  ShopPublicationStatusValues,
  SHOP_PUBLICATION_STATUS,
} from './domain/types/shop-product-status.types';
export type {
  ShopPublicationStatus,
  ShopProductStatusReadResult,
  ShopProductStatusSnapshotProps,
  ShopProductStatusSnapshotDetails,
  UpsertShopProductStatusSnapshotCommand,
  ShopStatusSyncResult,
} from './domain/types/shop-product-status.types';
export { ShopProductStatusSnapshot } from './domain/entities/shop-product-status-snapshot.entity';
export type {
  ShopProductStatusSnapshotRepositoryPort,
  ShopProductStatusUpsertResult,
} from './domain/ports/shop-product-status-snapshot-repository.port';
export {
  isShopProductStatusReader,
} from './domain/ports/capabilities/shop-product-status-reader.capability';
export type { ShopProductStatusReader } from './domain/ports/capabilities/shop-product-status-reader.capability';
export type {
  IShopStatusSyncService,
  ShopStatusSyncOptions,
} from './application/services/shop-status-sync.service.interface';

// Tokens
export * from './listings.tokens';
