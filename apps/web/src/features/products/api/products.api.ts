/**
 * Products API Client
 *
 * Thin API module for the products feature. Provides typed methods for
 * listing products, fetching product details, and listing variants.
 *
 * @module apps/web/src/features/products/api
 */
import type { PaginatedTotal, RowsPage } from '../../../shared/api/paginated-total.types';
import type {
  ProductFilters,
  ProductListSort,
  ProductPagination,
  PaginatedProducts,
  Product,
  ProductVariantSummary,
  VariantCost,
  VariantCostInput,
  CostCoverage,
  CostSummary,
  CostWorklistFilters,
  CostWorklistPage,
  CostWorklistPagination,
  BulkFillVariantCostInput,
  BulkFillVariantCostResult,
} from './products.types';

export interface ProductsApi {
  list: (
    filters?: ProductFilters,
    pagination?: ProductPagination,
    sort?: ProductListSort,
  ) => Promise<PaginatedProducts>;
  /**
   * The page WITHOUT its total (#2947). Pair with {@link ProductsApi.count} -
   * the name / SKU `ILIKE` search means the count cannot stop early, so the
   * rows must not wait for it.
   */
  listRows: (
    filters?: ProductFilters,
    pagination?: ProductPagination,
    sort?: ProductListSort,
  ) => Promise<RowsPage<Product>>;
  /** The total WITHOUT its page (#2947). Takes the filters alone - no sort. */
  count: (filters?: ProductFilters, init?: RequestInit) => Promise<PaginatedTotal>;
  getById: (id: string) => Promise<Product>;
  /**
   * Lightweight projection of a single variant — id, parent product id, SKU,
   * EAN, optional human-readable name. Used by the listing-detail page (#464)
   * to enrich the Internal ID row with the variant's identifiers inline.
   */
  getVariant: (variantId: string) => Promise<ProductVariantSummary>;
  /** Net unit costs of a product's variants (#3588). Admin/operator/viewer. */
  getVariantCosts: (productId: string) => Promise<VariantCost[]>;
  /** Record (both fields set) or clear (both null) a variant's cost. Admin only. */
  setVariantCost: (variantId: string, input: VariantCostInput) => Promise<VariantCost>;
  /** Cost coverage of the last N days of sales (#3588). */
  getCostCoverage: (days?: number) => Promise<CostCoverage>;
  getCostSummary: () => Promise<CostSummary>;
  /** One work-list page WITHOUT its total. Pair with {@link ProductsApi.countCostWorklist}. */
  getCostWorklist: (
    filters: CostWorklistFilters,
    pagination: CostWorklistPagination,
  ) => Promise<CostWorklistPage>;
  countCostWorklist: (filters: CostWorklistFilters, init?: RequestInit) => Promise<PaginatedTotal>;
  /** Fill one cost across variants, only where none is set. Admin only. */
  bulkFillVariantCost: (input: BulkFillVariantCostInput) => Promise<BulkFillVariantCostResult>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(
  filters?: ProductFilters,
  pagination?: ProductPagination,
  sort?: ProductListSort,
  options?: { withTotal?: false },
): string {
  const params = new URLSearchParams();
  if (filters?.search) params.set('search', filters.search);
  if (filters?.stock) params.set('stock', filters.stock);
  if (filters?.taxRateState) params.set('taxRateState', filters.taxRateState);
  if (filters?.unlistedOn && filters.unlistedOn.length > 0) {
    params.set('unlistedOn', filters.unlistedOn.join(','));
  }
  if (filters?.connectionId) params.set('connectionId', filters.connectionId);
  if (filters?.hideFullyStale) params.set('hideFullyStale', 'true');
  if (sort) {
    params.set('sort', sort.field);
    params.set('dir', sort.dir);
  }
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  if (options?.withTotal === false) params.set('withTotal', 'false');
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createProductsApi(request: ApiRequest): ProductsApi {
  return {
    list(filters, pagination, sort): Promise<PaginatedProducts> {
      return request<PaginatedProducts>(`/products${buildQuery(filters, pagination, sort)}`);
    },
    listRows(filters, pagination, sort): Promise<RowsPage<Product>> {
      return request<RowsPage<Product>>(
        `/products${buildQuery(filters, pagination, sort, { withTotal: false })}`,
      );
    },
    count(filters, init): Promise<PaginatedTotal> {
      // No pagination and no sort: neither can change a count, and the answer
      // depending on the filters alone is what makes it cacheable per filter.
      return request<PaginatedTotal>(`/products/count${buildQuery(filters)}`, init);
    },
    getById(id): Promise<Product> {
      return request<Product>(`/products/${id}`);
    },
    getVariant(variantId): Promise<ProductVariantSummary> {
      return request<ProductVariantSummary>(`/products/variants/${variantId}`);
    },
    getVariantCosts(productId): Promise<VariantCost[]> {
      return request<VariantCost[]>(`/products/${productId}/variant-costs`);
    },
    setVariantCost(variantId, input): Promise<VariantCost> {
      return request<VariantCost>(`/products/variants/${variantId}/cost`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
    },
    getCostCoverage(days = 30): Promise<CostCoverage> {
      return request<CostCoverage>(`/products/cost-coverage?days=${String(days)}`);
    },
    getCostSummary(): Promise<CostSummary> {
      return request<CostSummary>('/products/cost-coverage/summary');
    },
    async getCostWorklist(filters, pagination): Promise<CostWorklistPage> {
      const params = costWorklistParams(filters);
      params.set('limit', String(pagination.limit));
      params.set('offset', String(pagination.offset));
      params.set('withTotal', 'false');
      const body = await request<{ currency: string; items: CostWorklistPage['items'] }>(
        `/products/variants/cost-worklist?${params.toString()}`,
      );
      return {
        currency: body.currency,
        items: body.items,
        limit: pagination.limit,
        offset: pagination.offset,
      };
    },
    countCostWorklist(filters, init): Promise<PaginatedTotal> {
      return request<PaginatedTotal>(
        `/products/variants/cost-worklist/count?${costWorklistParams(filters).toString()}`,
        init,
      );
    },
    bulkFillVariantCost(input): Promise<BulkFillVariantCostResult> {
      return request<BulkFillVariantCostResult>('/products/variants/cost', {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
    },
  };
}

function costWorklistParams(filters: CostWorklistFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set('tab', filters.tab);
  if (filters.q) params.set('q', filters.q);
  if (filters.channel) params.set('channel', filters.channel);
  return params;
}
