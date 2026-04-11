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
  ProductPagination,
  PaginatedProducts,
  Product,
} from './products.types';

export interface ProductsApi {
  list: (filters?: ProductFilters, pagination?: ProductPagination) => Promise<PaginatedProducts>;
  getById: (id: string) => Promise<Product>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters?: ProductFilters, pagination?: ProductPagination): string {
  const params = new URLSearchParams();
  if (filters?.search) params.set('search', filters.search);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createProductsApi(request: ApiRequest): ProductsApi {
  return {
    list(filters, pagination): Promise<PaginatedProducts> {
      return request<PaginatedProducts>(`/products${buildQuery(filters, pagination)}`);
    },
    getById(id): Promise<Product> {
      return request<Product>(`/products/${id}`);
    },
  };
}
