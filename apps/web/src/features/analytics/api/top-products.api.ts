/**
 * Top products API client
 *
 * Thin request module for `GET /analytics/top-products` (#1988). Reuses
 * `toExclusiveEndInstant` from `sales-analytics.api.ts` for the same
 * inclusive-day-to-exclusive-instant conversion the toolbar's `to` value
 * needs — see that module's header for why the conversion lives in one
 * place.
 *
 * @module features/analytics/api
 */
import { toExclusiveEndInstant } from './sales-analytics.api';
import type { SalesAnalyticsFilters } from './sales-analytics.types';
import type {
  TopProductsFilters,
  TopProductsResult,
  TopProductVariantsResult,
} from './top-products.types';

export interface TopProductsApi {
  getTopProducts: (filters: TopProductsFilters) => Promise<TopProductsResult>;
  /**
   * One product's sales split by variant, per channel (#2765) — call only
   * when a row is actually expanded, never eagerly for every row on the
   * page (see `use-top-product-variant-sales-query.ts`).
   */
  getTopProductVariantSales: (
    productId: string,
    filters: SalesAnalyticsFilters
  ) => Promise<TopProductVariantsResult>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters: TopProductsFilters): string {
  const params = new URLSearchParams();
  params.set('from', filters.from);
  params.set('to', toExclusiveEndInstant(filters.to));
  if (filters.sourceConnectionId) {
    params.set('sourceConnectionId', filters.sourceConnectionId);
  }
  params.set('sortBy', filters.sortBy);
  params.set('limit', String(filters.limit));
  params.set('offset', String(filters.offset));
  return params.toString();
}

function buildSalesFiltersQuery(filters: SalesAnalyticsFilters): string {
  const params = new URLSearchParams();
  params.set('from', filters.from);
  params.set('to', toExclusiveEndInstant(filters.to));
  if (filters.sourceConnectionId) {
    params.set('sourceConnectionId', filters.sourceConnectionId);
  }
  return params.toString();
}

export function createTopProductsApi(request: ApiRequest): TopProductsApi {
  return {
    getTopProducts: (filters) => request(`/analytics/top-products?${buildQuery(filters)}`),
    getTopProductVariantSales: (productId, filters) =>
      request(
        `/analytics/top-products/${encodeURIComponent(productId)}/variants?${buildSalesFiltersQuery(filters)}`
      ),
  };
}
