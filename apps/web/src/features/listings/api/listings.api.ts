/**
 * Listings API Client
 *
 * Thin API module for the listings (offer mapping) feature. Provides typed
 * methods for listing offer mappings and fetching individual mapping details.
 *
 * @module apps/web/src/features/listings/api
 */
import type {
  CatalogProduct,
  CatalogProductMatchResult,
  CategoryParametersListResponse,
  CreateOfferRequest,
  CreateOfferResponse,
  FindProductsByBarcodeRequest,
  ListingsFilters,
  ListingsPagination,
  MarketplaceOfferResponse,
  OfferCreationStatusResponse,
  OfferMapping,
  PaginatedOfferMappings,
  ResolveCategoriesBatchRequest,
  ResolveCategoriesBatchResponse,
  ResolveCategoryRequest,
  ResolveCategoryResponse,
  SellerPoliciesResponse,
  ShopPublishRequest,
  ShopPublishResponse,
  ShopPublishStatusResponse,
  BulkShopPublishRequest,
  BulkShopPublishResponse,
  BulkShopPublishBatchResponse,
  UpdateOfferFieldsPayload,
  UpdateOfferFieldsResult,
} from './listings.types';
import type {
  BulkBatchSummary,
  BulkOfferCreateRequest,
  BulkOfferCreateResponse,
  BulkListingRetryResponse,
} from './bulk-listings.types';

export interface CreateOfferOptions {
  /**
   * Forwarded as `x-idempotency-key`. Reuse the same key across retries
   * within one wizard session so duplicate records are never created.
   */
  idempotencyKey?: string;
}

export interface ListingsApi {
  list: (
    filters?: ListingsFilters,
    pagination?: ListingsPagination,
  ) => Promise<PaginatedOfferMappings>;
  getById: (id: string) => Promise<OfferMapping>;
  /**
   * Fetches the live marketplace-side offer (#464). Returns 404 if the
   * mapping doesn't exist or isn't `entityType=Offer`; 422 if the connection's
   * adapter does not implement `OfferReader`. Callers handle both as a soft
   * "live data unavailable" fallback.
   */
  getMarketplaceOffer: (mappingId: string) => Promise<MarketplaceOfferResponse>;
  updateOfferFields: (
    connectionId: string,
    offerId: string,
    fields: UpdateOfferFieldsPayload,
  ) => Promise<UpdateOfferFieldsResult>;
  createOffer: (
    connectionId: string,
    request: CreateOfferRequest,
    options?: CreateOfferOptions,
  ) => Promise<CreateOfferResponse>;
  getOfferCreationStatus: (
    connectionId: string,
    offerCreationRecordId: string,
  ) => Promise<OfferCreationStatusResponse>;
  /**
   * Publish a single OL variant onto a `ProductPublisher` shop connection
   * (#1044). Returns the enqueued `jobId` and pre-created
   * `listingCreationRecordId` for immediate status polling. Forwards
   * `x-idempotency-key` like `createOffer`.
   */
  shopPublish: (
    connectionId: string,
    body: ShopPublishRequest,
    options?: CreateOfferOptions,
  ) => Promise<ShopPublishResponse>;
  getShopPublishStatus: (
    connectionId: string,
    recordId: string,
  ) => Promise<ShopPublishStatusResponse>;
  /** Submit a bulk shop-publish batch (#1044). Returns the persisted
   *  `batchId` and per-variant job + record ids. */
  shopPublishBulk: (body: BulkShopPublishRequest) => Promise<BulkShopPublishResponse>;
  /** Read a bulk shop-publish batch + its per-record summary. Used for polling. */
  getBulkShopPublishBatch: (batchId: string) => Promise<BulkShopPublishBatchResponse>;
  getSellerPolicies: (connectionId: string) => Promise<SellerPoliciesResponse>;
  getCategoryParameters: (
    connectionId: string,
    categoryId: string,
  ) => Promise<CategoryParametersListResponse>;
  findProductsByBarcode: (
    connectionId: string,
    request: FindProductsByBarcodeRequest,
  ) => Promise<CatalogProductMatchResult>;
  getCatalogProduct: (connectionId: string, productId: string) => Promise<CatalogProduct>;
  /**
   * Resolves an Allegro category from an EAN / source-category-id chain (#631).
   * Runs the BE's 3-step fallback (auto-detect by barcode → configured
   * mapping → manual) and returns the first hit. `method=manual` with
   * `allegroCategoryId=null` is a normal outcome, not an error.
   */
  resolveCategory: (
    connectionId: string,
    body: ResolveCategoryRequest,
  ) => Promise<ResolveCategoryResponse>;
  /**
   * Batch-resolve N variant EANs to marketplace categories in one call (#795).
   * Wraps the adapter's `EanCategoryMatcher` sub-capability; drives the bulk
   * wizard's Resolve step, replacing the per-row `resolveCategory` loop. Max
   * 200 items per request; results keyed by `variantId`.
   */
  resolveCategoriesBatch: (
    connectionId: string,
    body: ResolveCategoriesBatchRequest,
  ) => Promise<ResolveCategoriesBatchResponse>;
  /**
   * Submit a bulk offer-creation batch (#736). Returns the persisted
   * `batchId` and per-job message IDs. 1..100 variants per batch.
   */
  bulkCreate: (
    request: BulkOfferCreateRequest,
    options?: CreateOfferOptions,
  ) => Promise<BulkOfferCreateResponse>;
  /** Read a bulk batch + its per-record summary. Used for polling on #741. */
  getBulkBatch: (batchId: string) => Promise<BulkBatchSummary>;
  /** Re-enqueue failed children of a batch (#742). Batch-level retry only. */
  retryBulkFailed: (batchId: string) => Promise<BulkListingRetryResponse>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters?: ListingsFilters, pagination?: ListingsPagination): string {
  const params = new URLSearchParams();
  if (filters?.connectionId) params.set('connectionId', filters.connectionId);
  if (filters?.platformType) params.set('platformType', filters.platformType);
  if (filters?.internalId) params.set('internalId', filters.internalId);
  if (filters?.search) params.set('search', filters.search);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createListingsApi(request: ApiRequest): ListingsApi {
  return {
    list(filters, pagination): Promise<PaginatedOfferMappings> {
      return request<PaginatedOfferMappings>(`/listings${buildQuery(filters, pagination)}`);
    },
    getById(id): Promise<OfferMapping> {
      return request<OfferMapping>(`/listings/${id}`);
    },
    getMarketplaceOffer(mappingId): Promise<MarketplaceOfferResponse> {
      return request<MarketplaceOfferResponse>(`/listings/${mappingId}/offer`);
    },
    updateOfferFields(connectionId, offerId, fields): Promise<UpdateOfferFieldsResult> {
      return request<UpdateOfferFieldsResult>(
        `/listings/connections/${connectionId}/offers/${offerId}/fields`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields),
        },
      );
    },
    createOffer(connectionId, body, options): Promise<CreateOfferResponse> {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (options?.idempotencyKey) {
        headers['x-idempotency-key'] = options.idempotencyKey;
      }
      return request<CreateOfferResponse>(`/listings/connections/${connectionId}/offers`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    },
    getOfferCreationStatus(
      connectionId,
      offerCreationRecordId,
    ): Promise<OfferCreationStatusResponse> {
      return request<OfferCreationStatusResponse>(
        `/listings/connections/${connectionId}/offers/creation/${offerCreationRecordId}`,
      );
    },
    shopPublish(connectionId, body, options): Promise<ShopPublishResponse> {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (options?.idempotencyKey) {
        headers['x-idempotency-key'] = options.idempotencyKey;
      }
      return request<ShopPublishResponse>(`/listings/connections/${connectionId}/shop-publish`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    },
    getShopPublishStatus(connectionId, recordId): Promise<ShopPublishStatusResponse> {
      return request<ShopPublishStatusResponse>(
        `/listings/connections/${connectionId}/shop-publish/${encodeURIComponent(recordId)}`,
      );
    },
    shopPublishBulk(body): Promise<BulkShopPublishResponse> {
      return request<BulkShopPublishResponse>('/listings/bulk-shop-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    getBulkShopPublishBatch(batchId): Promise<BulkShopPublishBatchResponse> {
      return request<BulkShopPublishBatchResponse>(
        `/listings/bulk-shop-publish/${encodeURIComponent(batchId)}`,
      );
    },
    getSellerPolicies(connectionId): Promise<SellerPoliciesResponse> {
      return request<SellerPoliciesResponse>(
        `/listings/connections/${connectionId}/seller-policies`,
      );
    },
    getCategoryParameters(connectionId, categoryId): Promise<CategoryParametersListResponse> {
      return request<CategoryParametersListResponse>(
        `/listings/connections/${connectionId}/categories/${categoryId}/parameters`,
      );
    },
    findProductsByBarcode(connectionId, body): Promise<CatalogProductMatchResult> {
      return request<CatalogProductMatchResult>(
        `/listings/connections/${connectionId}/products/find-by-barcode`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
    },
    getCatalogProduct(connectionId, productId): Promise<CatalogProduct> {
      return request<CatalogProduct>(
        `/listings/connections/${connectionId}/products/${encodeURIComponent(productId)}`,
      );
    },
    resolveCategory(connectionId, body): Promise<ResolveCategoryResponse> {
      return request<ResolveCategoryResponse>(
        `/listings/connections/${connectionId}/categories/resolve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
    },
    resolveCategoriesBatch(connectionId, body): Promise<ResolveCategoriesBatchResponse> {
      return request<ResolveCategoriesBatchResponse>(
        `/listings/connections/${connectionId}/categories/resolve-batch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
    },
    bulkCreate(body, options): Promise<BulkOfferCreateResponse> {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (options?.idempotencyKey) {
        headers['x-idempotency-key'] = options.idempotencyKey;
      }
      return request<BulkOfferCreateResponse>('/listings/bulk-create', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    },
    getBulkBatch(batchId): Promise<BulkBatchSummary> {
      return request<BulkBatchSummary>(`/listings/bulk-create/${encodeURIComponent(batchId)}`);
    },
    retryBulkFailed(batchId): Promise<BulkListingRetryResponse> {
      return request<BulkListingRetryResponse>(
        `/listings/bulk-create/${encodeURIComponent(batchId)}/retry-failed`,
        { method: 'POST' },
      );
    },
  };
}
