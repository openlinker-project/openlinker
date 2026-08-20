/**
 * Listings API Client
 *
 * Thin API module for the listings (offer mapping) feature. Provides typed
 * methods for listing offer mappings and fetching individual mapping details.
 *
 * @module apps/web/src/features/listings/api
 */
import type { DescriptionFormat } from '../../../shared/ui/rich-text.types';
import type {
  CatalogProduct,
  CatalogProductMatchResult,
  CategoryParametersListResponse,
  CategoryPathResponse,
  CreateOfferRequest,
  CreateOfferResponse,
  FindProductsByBarcodeRequest,
  ListingsFilters,
  ListingsPagination,
  MarketplaceOfferResponse,
  OfferCreationStatusResponse,
  OfferPublicationStatusResponse,
  RefreshOfferPublicationStatusResponse,
  OfferMapping,
  PaginatedOfferMappings,
  EanCategoryMatchStreamEvent,
  ResolveCategoriesBatchRequest,
  ResolveCategoriesBatchResponse,
  ResolveCategoryRequest,
  ResolveCategoryResponse,
  SellerPoliciesResponse,
  ResponsibleProducersResponse,
  DeliveryPriceListsResponse,
  ShopCategory,
  ShopAttribute,
  ShopAttributeTerm,
  ShopPublishRequest,
  ShopPublishResponse,
  ShopPublishStatusResponse,
  BulkShopPublishRequest,
  BulkShopPublishResponse,
  BulkShopPublishBatchResponse,
  PublishedVariantsRequest,
  PublishedVariantsResponse,
  UpdateOfferFieldsPayload,
  UpdateOfferFieldsResult,
} from './listings.types';
import type {
  BulkBatchSummary,
  BulkOfferCreateRequest,
  BulkOfferCreateResponse,
  BulkListingRetryResponse,
} from './bulk-listings.types';
import { ApiError } from '../../../shared/api/api-error';

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
   * Live marketplace publication status of a product's offers (#1760), read
   * from persisted snapshots. Optionally scoped to a single connection.
   */
  getProductOfferStatus: (
    productId: string,
    connectionId?: string,
  ) => Promise<OfferPublicationStatusResponse[]>;
  /**
   * Force-refresh one offer's live publication status now (#1760); upserts the
   * snapshot and returns the observed status.
   */
  refreshOfferPublicationStatus: (
    connectionId: string,
    externalOfferId: string,
    internalVariantId: string,
  ) => Promise<RefreshOfferPublicationStatusResponse>;
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
  /**
   * Browse a shop connection's existing category tree (#1834), one parent level
   * at a time (omit `parentId` for root). Backed by the shop `ShopCategoryBrowser`
   * capability; 422 if the connection's adapter does not implement it.
   */
  browseShopCategories: (
    connectionId: string,
    parentId?: string,
  ) => Promise<ShopCategory[]>;
  /**
   * List a shop connection's store-wide global product attributes (#1835).
   * Backed by the shop `ShopAttributeReader` capability; 422 if the connection's
   * adapter does not implement it.
   */
  /**
   * Read what this destination accepts in a product description (ADR-046).
   * Always resolves - a connection that declares nothing (or one whose adapter
   * cannot be resolved at all) returns the conservative fallback with
   * `declared: false`, which the editor surfaces rather than treating as
   * authoritative.
   */
  getDescriptionFormat: (connectionId: string) => Promise<DescriptionFormat>;
  listShopAttributes: (connectionId: string) => Promise<ShopAttribute[]>;
  /** List the predefined terms of one global attribute (#1835). */
  listShopAttributeTerms: (
    connectionId: string,
    attributeId: string,
  ) => Promise<ShopAttributeTerm[]>;
  /** Submit a bulk shop-publish batch (#1044). Returns the persisted
   *  `batchId` and per-variant job + record ids. */
  shopPublishBulk: (body: BulkShopPublishRequest) => Promise<BulkShopPublishResponse>;
  /** Read a bulk shop-publish batch + its per-record summary. Used for polling. */
  getBulkShopPublishBatch: (batchId: string) => Promise<BulkShopPublishBatchResponse>;
  /** Destination-aware duplicate guard (#1837) - which variants already have a
   *  listing (offer or shop-product) on the connection. */
  checkPublishedVariants: (
    body: PublishedVariantsRequest,
  ) => Promise<PublishedVariantsResponse>;
  getSellerPolicies: (connectionId: string) => Promise<SellerPoliciesResponse>;
  getResponsibleProducers: (connectionId: string) => Promise<ResponsibleProducersResponse>;
  getDeliveryPriceLists: (connectionId: string) => Promise<DeliveryPriceListsResponse>;
  getCategoryParameters: (
    connectionId: string,
    categoryId: string,
  ) => Promise<CategoryParametersListResponse>;
  /**
   * Resolves a marketplace category id to its breadcrumb path (#1752), root ->
   * leaf. Returns 404 if the category is unknown; 422 if the connection's
   * adapter does not implement `CategoryPathReader`. Callers fall back to the
   * raw id on either.
   */
  getCategoryPath: (
    connectionId: string,
    categoryId: string,
  ) => Promise<CategoryPathResponse>;
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
   * Wraps the adapter's `EanCategoryMatcher` sub-capability. Max
   * `RESOLVE_CATEGORY_STREAM_CHUNK_SIZE` items per request; results keyed by
   * `variantId`.
   *
   * No screen calls this since #2211 - the Resolve step moved to
   * {@link ListingsApi.resolveCategoriesStream}. It is kept rather than deleted
   * because the route is not deprecated (it is still the all-at-once answer, and
   * the one a caller that cannot read a stream needs), and because a client
   * method is the cheapest place to keep that parity honest. Delete it together
   * with the route, not before.
   */
  resolveCategoriesBatch: (
    connectionId: string,
    body: ResolveCategoriesBatchRequest,
  ) => Promise<ResolveCategoriesBatchResponse>;
  /**
   * Streaming sibling of {@link ListingsApi.resolveCategoriesBatch} (#2211).
   * Same request body and same resolution, delivered one variant at a time so
   * the bulk wizard's Resolve step can show real progress instead of waiting on
   * one all-or-nothing answer.
   *
   * Yields only outcome-bearing lines: `result` per variant, then exactly one
   * terminal `done`. Keep-alive filler is dropped by the decoder. Reaching the
   * end of the iterable WITHOUT a `done` event means the stream was truncated -
   * the consumer must treat that as a failure, never as a clean finish.
   *
   * The connection gate runs before the first byte, so an unknown / disabled /
   * non-marketplace connection still rejects with a real `ApiError`
   * (404 / 409 / 422) rather than an empty stream.
   */
  resolveCategoriesStream: (
    connectionId: string,
    body: ResolveCategoriesBatchRequest,
    options?: { signal?: AbortSignal },
  ) => AsyncIterable<EanCategoryMatchStreamEvent>;
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
  if (filters?.internalId) params.set('internalId', filters.internalId);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.lifecycle) params.set('lifecycle', filters.lifecycle);
  if (filters?.includeLifecycleCounts) params.set('includeLifecycleCounts', 'true');
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

/**
 * Streaming transport handed in by `createApiClient`. Declared locally for the
 * same reason `ApiRequest` above is: the API module states the shape it needs
 * rather than importing the host's `app/api` type.
 */
interface ApiStreamRequest {
  (path: string, init?: RequestInit): Promise<ReadableStream<Uint8Array>>;
}

/** NDJSON media type of the resolve-stream route. */
const RESOLVE_CATEGORY_STREAM_ACCEPT = 'application/x-ndjson';

/**
 * Items per resolve request. Mirrors `RESOLVE_CATEGORY_ITEMS_MAX` in
 * `apps/api/src/listings/http/dto/resolve-category-batch.dto.ts` - the route's
 * own `@ArrayMaxSize` - so a caller with more variants than this splits them
 * across sequential streams instead of being rejected by the validation pipe.
 *
 * The wizard caps a batch at 100 PRODUCTS and a product expands to every
 * sibling variant (#824), so a batch above the cap is reachable in ordinary
 * use. `scripts/check-resolve-stream-mirror.mjs` fails the build if the two
 * numbers drift.
 */
export const RESOLVE_CATEGORY_STREAM_CHUNK_SIZE = 200;

/**
 * Quiet period after which the route emits a keep-alive line. Mirrors
 * `RESOLVE_CATEGORY_STREAM_KEEP_ALIVE_INTERVAL_MS` in
 * `apps/api/src/listings/http/dto/resolve-category-stream.dto.ts` (the FE cannot
 * import it - the line is deliberately API-app-local, not core - so the mirror
 * is stated here and the ceiling below is derived from it, never typed twice).
 */
export const RESOLVE_CATEGORY_STREAM_KEEP_ALIVE_INTERVAL_MS = 10_000;

/**
 * Idle ceiling: how long the reader tolerates a body that delivers nothing at
 * all - not a result, not a terminal line, not even keep-alive filler.
 *
 * This is deliberately NOT a wall-clock budget. A legitimate 500-variant run
 * takes minutes and is exactly why the streamed transport opted out of the
 * SPA's 30 s timeout; what it must never do is hang forever behind a socket
 * that opened and then went silent (stalled upstream, dead worker), which
 * leaves the operator on a shimmer panel with no error and no retry. Because
 * the route proves itself alive every keep-alive interval, silence is
 * diagnosable, and six consecutive missed keep-alives is generous enough that
 * no healthy run can trip it.
 */
export const RESOLVE_CATEGORY_STREAM_IDLE_TIMEOUT_MS =
  RESOLVE_CATEGORY_STREAM_KEEP_ALIVE_INTERVAL_MS * 6;

/**
 * Decode one NDJSON line into an outcome-bearing event, or `null` for anything
 * the consumer must ignore: a blank line, the transport's `keep-alive` filler,
 * a line kind added by a later API version, or a partial line left over when
 * the body ended mid-write. Dropping a partial tail is safe precisely because
 * the terminal `done` line is what proves completeness - a truncated stream
 * still surfaces as truncated.
 *
 * The narrowing checks the fields each kind is READ BY, not only `kind`, so the
 * cast at the end is one the line has actually earned. A `result` missing its
 * `variantId` would otherwise reach the reducer and key an outcome under
 * `"undefined"` - a row that never clears, on data the consumer cannot see is
 * wrong. `completion` is deliberately NOT checked against the known values: a
 * value added by a later API version must surface through the consumer's
 * existing "not `complete`" arm, which reports an incomplete run, rather than
 * being dropped here and reported as a truncated body.
 */
export function parseResolveCategoryStreamLine(line: string): EanCategoryMatchStreamEvent | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (candidate.kind === 'result') {
    if (typeof candidate.variantId !== 'string' || candidate.variantId === '') return null;
    // The component switches on `result.kind`, so a result without one is a
    // crash rather than a rendered row.
    const result = candidate.result;
    if (typeof result !== 'object' || result === null) return null;
    if (typeof (result as Record<string, unknown>).kind !== 'string') return null;
    return parsed as EanCategoryMatchStreamEvent;
  }
  if (candidate.kind === 'done') {
    // Both counts feed the operator's "resolved / unresolved" reading, so a
    // terminal that cannot state them is not a terminal worth trusting -
    // dropping it surfaces the run as truncated, which is the honest reading.
    if (!Number.isFinite(candidate.resolvedCount)) return null;
    if (!Number.isFinite(candidate.unresolvedCount)) return null;
    return parsed as EanCategoryMatchStreamEvent;
  }
  return null;
}

/**
 * One `reader.read()`, bounded by the idle ceiling. Every read that resolves
 * rearms the window, so any traffic at all - including a keep-alive line the
 * decoder then drops - counts as liveness.
 *
 * The rejection is an `ApiError` with 408 rather than a 5xx or a network error
 * on purpose: `shouldRetryTransient` would treat those as worth re-running, and
 * re-running a silent stream just burns another idle window before the operator
 * is told anything. 408 surfaces the ordinary error state with its retry action
 * immediately, and the operator decides.
 */
async function readWithIdleCeiling(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const idle = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new ApiError(
          `No response from the category lookup for ${Math.round(idleTimeoutMs / 1000)}s.`,
          408,
          { idleTimeoutMs },
        ),
      );
    }, idleTimeoutMs);
  });
  try {
    return await Promise.race([reader.read(), idle]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function* readResolveCategoryStream(
  stream: ReadableStream<Uint8Array>,
  idleTimeoutMs: number = RESOLVE_CATEGORY_STREAM_IDLE_TIMEOUT_MS,
): AsyncGenerator<EanCategoryMatchStreamEvent, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  // Lines are not aligned to chunk boundaries, so a chunk can end mid-object.
  // The buffer carries the remainder into the next read.
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await readWithIdleCeiling(reader, idleTimeoutMs);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const event = parseResolveCategoryStreamLine(line);
        if (event !== null) yield event;
        newline = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    const tail = parseResolveCategoryStreamLine(buffer);
    if (tail !== null) yield tail;
  } finally {
    // A consumer that stops early (unmount, terminal reached, idle ceiling)
    // cancels the body, which is how the server learns the reader left and
    // stops spending the operator's marketplace quota on results nobody will
    // read. Cancelling through the reader also releases the lock, and unlike a
    // bare `releaseLock()` it is safe while a read is still pending - which is
    // exactly the state the idle ceiling leaves behind.
    void reader.cancel().catch(() => undefined);
  }
}

export function createListingsApi(
  request: ApiRequest,
  requestStream: ApiStreamRequest,
): ListingsApi {
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
    getProductOfferStatus(
      productId,
      connectionId,
    ): Promise<OfferPublicationStatusResponse[]> {
      const query = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : '';
      return request<OfferPublicationStatusResponse[]>(
        `/listings/products/${encodeURIComponent(productId)}/offer-status${query}`,
      );
    },
    refreshOfferPublicationStatus(
      connectionId,
      externalOfferId,
      internalVariantId,
    ): Promise<RefreshOfferPublicationStatusResponse> {
      return request<RefreshOfferPublicationStatusResponse>(
        `/listings/connections/${connectionId}/offers/${encodeURIComponent(externalOfferId)}/refresh-status`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ internalVariantId }),
        },
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
    browseShopCategories(connectionId, parentId): Promise<ShopCategory[]> {
      const qs = parentId ? `?parentId=${encodeURIComponent(parentId)}` : '';
      return request<ShopCategory[]>(
        `/listings/connections/${connectionId}/shop-publish/categories${qs}`,
      );
    },
    getDescriptionFormat(connectionId): Promise<DescriptionFormat> {
      return request<DescriptionFormat>(
        `/listings/connections/${connectionId}/description-format`,
      );
    },
    listShopAttributes(connectionId): Promise<ShopAttribute[]> {
      return request<ShopAttribute[]>(
        `/listings/connections/${connectionId}/shop-publish/attributes`,
      );
    },
    listShopAttributeTerms(connectionId, attributeId): Promise<ShopAttributeTerm[]> {
      return request<ShopAttributeTerm[]>(
        `/listings/connections/${connectionId}/shop-publish/attributes/${encodeURIComponent(
          attributeId,
        )}/terms`,
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
    checkPublishedVariants(body): Promise<PublishedVariantsResponse> {
      return request<PublishedVariantsResponse>('/listings/published-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    getSellerPolicies(connectionId): Promise<SellerPoliciesResponse> {
      return request<SellerPoliciesResponse>(
        `/listings/connections/${connectionId}/seller-policies`,
      );
    },
    getResponsibleProducers(connectionId): Promise<ResponsibleProducersResponse> {
      return request<ResponsibleProducersResponse>(
        `/listings/connections/${connectionId}/responsible-producers`,
      );
    },
    getDeliveryPriceLists(connectionId): Promise<DeliveryPriceListsResponse> {
      return request<DeliveryPriceListsResponse>(
        `/listings/connections/${connectionId}/delivery-price-lists`,
      );
    },
    getCategoryParameters(connectionId, categoryId): Promise<CategoryParametersListResponse> {
      return request<CategoryParametersListResponse>(
        `/listings/connections/${connectionId}/categories/${categoryId}/parameters`,
      );
    },
    getCategoryPath(connectionId, categoryId): Promise<CategoryPathResponse> {
      return request<CategoryPathResponse>(
        `/listings/connections/${connectionId}/categories/${categoryId}/path`,
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
    resolveCategoriesStream(
      connectionId,
      body,
      options,
    ): AsyncIterable<EanCategoryMatchStreamEvent> {
      async function* iterate(): AsyncGenerator<EanCategoryMatchStreamEvent, void, undefined> {
        const stream = await requestStream(
          `/listings/connections/${connectionId}/categories/resolve-stream`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: RESOLVE_CATEGORY_STREAM_ACCEPT,
            },
            body: JSON.stringify(body),
            ...(options?.signal ? { signal: options.signal } : {}),
          },
        );
        yield* readResolveCategoryStream(stream);
      }
      return iterate();
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
