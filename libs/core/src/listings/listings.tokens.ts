/**
 * Dependency Injection Tokens (Listings)
 *
 * @module libs/core/src/listings
 */

export const ATTRIBUTE_PROJECTION_SERVICE_TOKEN = Symbol('IAttributeProjectionService');
export const OFFER_LINKING_SERVICE_TOKEN = Symbol('OfferLinkingService');
export const OFFER_MAPPING_SYNC_SERVICE_TOKEN = Symbol('OfferMappingSyncService');
export const OFFER_MAPPINGS_SERVICE_TOKEN = Symbol('IOfferMappingsService');
export const OFFER_MAPPING_REPOSITORY_TOKEN = Symbol('OfferMappingRepositoryPort');
export const OFFER_CREATION_RECORD_REPOSITORY_TOKEN = Symbol('OfferCreationRecordRepositoryPort');
export const BULK_LISTING_BATCH_REPOSITORY_TOKEN = Symbol('BulkListingBatchRepositoryPort');
export const BULK_BATCH_ADVANCEMENT_REPOSITORY_TOKEN = Symbol('BulkBatchAdvancementRepositoryPort');
export const BULK_LISTING_PROGRESS_SERVICE_TOKEN = Symbol('IBulkListingProgressService');
export const CATEGORY_RESOLUTION_SERVICE_TOKEN = Symbol('ICategoryResolutionService');
export const OFFER_BUILDER_SERVICE_TOKEN = Symbol('IOfferBuilderService');
export const OFFER_CREATION_EXECUTION_SERVICE_TOKEN = Symbol('IOfferCreationExecutionService');
export const OFFER_CREATION_ENQUEUE_SERVICE_TOKEN = Symbol('IOfferCreationEnqueueService');
export const BULK_LISTING_SUBMIT_SERVICE_TOKEN = Symbol('IBulkListingSubmitService');
export const BULK_LISTING_RETRY_SERVICE_TOKEN = Symbol('IBulkListingRetryService');
export const OFFER_STATUS_POLL_SERVICE_TOKEN = Symbol('IOfferStatusPollService');
export const OFFER_STATUS_SYNC_SERVICE_TOKEN = Symbol('IOfferStatusSyncService');
// Async quantity-ack reconciliation (#2621)
export const OFFER_QUANTITY_ACK_RECONCILE_SERVICE_TOKEN = Symbol(
  'IOfferQuantityAckReconcileService'
);
export const OFFER_STATUS_READ_SERVICE_TOKEN = Symbol('IOfferStatusReadService');
export const OFFER_STATUS_SNAPSHOT_REPOSITORY_TOKEN = Symbol('OfferStatusSnapshotRepositoryPort');
// Channel-side price/quantity snapshot (#2024)
export const OFFER_COMMERCIAL_SNAPSHOT_REPOSITORY_TOKEN = Symbol(
  'OfferCommercialSnapshotRepositoryPort'
);
export const SELLER_POLICIES_SERVICE_TOKEN = Symbol('ISellerPoliciesService');
export const SELLER_POLICIES_CACHE_TOKEN = Symbol('SellerPoliciesCacheRepositoryPort');
// Responsible-producer read (#1531)
export const RESPONSIBLE_PRODUCER_SERVICE_TOKEN = Symbol('IResponsibleProducerService');
// Delivery price list read (#1530)
export const DELIVERY_PRICE_LIST_SERVICE_TOKEN = Symbol('IDeliveryPriceListService');
// Order-cancellation stock-restore (#1146)
export const OFFER_STOCK_RESTORE_SERVICE_TOKEN = Symbol('IOfferStockRestoreService');
// Shop publish (#1042, ADR-024)
export const LISTING_CREATION_RECORD_REPOSITORY_TOKEN = Symbol(
  'ListingCreationRecordRepositoryPort',
);
export const PRODUCT_PUBLISH_BUILDER_SERVICE_TOKEN = Symbol('IProductPublishBuilderService');
export const PRODUCT_PUBLISH_EXECUTION_SERVICE_TOKEN = Symbol('IProductPublishExecutionService');
// Shop publish API + bulk surfaces (#1044)
export const PRODUCT_PUBLISH_ENQUEUE_SERVICE_TOKEN = Symbol('IProductPublishEnqueueService');
export const LISTING_CREATION_QUERY_SERVICE_TOKEN = Symbol('IListingCreationQueryService');
export const BULK_SHOP_PUBLISH_SUBMIT_SERVICE_TOKEN = Symbol('IBulkShopPublishSubmitService');

// Shop-side category browse (#1834)
export const SHOP_CATEGORY_BROWSE_SERVICE_TOKEN = Symbol('IShopCategoryBrowseService');
// Shop publish retry (#1845)
export const BULK_SHOP_PUBLISH_RETRY_SERVICE_TOKEN = Symbol('IBulkShopPublishRetryService');
// Shop product status reconcile (#1845)
export const SHOP_STATUS_SYNC_SERVICE_TOKEN = Symbol('IShopStatusSyncService');
export const SHOP_PRODUCT_STATUS_SNAPSHOT_REPOSITORY_TOKEN = Symbol(
  'ShopProductStatusSnapshotRepositoryPort',
);

// Shop-side global attribute read (#1835)
export const SHOP_ATTRIBUTE_READ_SERVICE_TOKEN = Symbol('IShopAttributeReadService');

export const DESCRIPTION_FORMAT_READ_SERVICE_TOKEN = Symbol('IDescriptionFormatReadService');

// Destination-aware duplicate guard (#1837)
export const SHOP_PRODUCT_MAPPING_REPOSITORY_TOKEN = Symbol('ShopProductMappingRepositoryPort');
export const PUBLISHED_VARIANTS_SERVICE_TOKEN = Symbol('IPublishedVariantsService');

// Shop-side products cockpit coverage pills (#1838 follow-up fix)
export const SHOP_PRODUCT_MAPPINGS_SERVICE_TOKEN = Symbol('IShopProductMappingsService');

// Destination taxonomy read model (#1979, ADR-037)
export const DESTINATION_TAXONOMY_SERVICE_TOKEN = Symbol('IDestinationTaxonomyService');
export const DESTINATION_CATEGORY_REPOSITORY_TOKEN = Symbol('DestinationCategoryRepositoryPort');

// Stale-variant offer pause (#1689)
export const STALE_OFFER_PAUSE_SERVICE_TOKEN = Symbol('IStaleOfferPauseService');

// Needs-attention aggregates — coverage gaps (#1983)
export const COVERAGE_GAP_READ_SERVICE_TOKEN = Symbol('ICoverageGapReadService');
// Needs-attention aggregates — stock at risk (#1983)
export const STOCK_AT_RISK_READ_SERVICE_TOKEN = Symbol('IStockAtRiskReadService');
