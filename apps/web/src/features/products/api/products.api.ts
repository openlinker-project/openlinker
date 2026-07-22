/**
 * Products API Client
 *
 * Thin API module for the products feature. Provides typed methods for
 * listing products, fetching product details, and listing variants.
 *
 * @module apps/web/src/features/products/api
 */
import type {
  ProductFilters,
  ProductListSort,
  ProductPagination,
  PaginatedProducts,
  Product,
  ProductVariantSummary,
} from './products.types';

export interface ProductsApi {
  list: (
    filters?: ProductFilters,
    pagination?: ProductPagination,
    sort?: ProductListSort,
  ) => Promise<PaginatedProducts>;
  getById: (id: string) => Promise<Product>;
  /**
   * Lightweight projection of a single variant — id, parent product id, SKU,
   * EAN, optional human-readable name. Used by the listing-detail page (#464)
   * to enrich the Internal ID row with the variant's identifiers inline.
   */
  getVariant: (variantId: string) => Promise<ProductVariantSummary>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(
  filters?: ProductFilters,
  pagination?: ProductPagination,
  sort?: ProductListSort,
): string {
  const params = new URLSearchParams();
  if (filters?.search) params.set('search', filters.search);
  if (filters?.stock) params.set('stock', filters.stock);
  if (filters?.unlistedOn && filters.unlistedOn.length > 0) {
    params.set('unlistedOn', filters.unlistedOn.join(','));
  }
  if (filters?.connectionId) params.set('connectionId', filters.connectionId);
  if (sort) {
    params.set('sort', sort.field);
    params.set('dir', sort.dir);
  }
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createProductsApi(request: ApiRequest): ProductsApi {
  return {
    list(filters, pagination, sort): Promise<PaginatedProducts> {
      return request<PaginatedProducts>(`/products${buildQuery(filters, pagination, sort)}`);
    },
    getById(id): Promise<Product> {
      return request<Product>(`/products/${id}`);
    },
    getVariant(variantId): Promise<ProductVariantSummary> {
      return request<ProductVariantSummary>(`/products/variants/${variantId}`);
    },
  };
}
