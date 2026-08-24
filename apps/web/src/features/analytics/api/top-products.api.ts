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
import type { TopProductsFilters, TopProductsResult } from './top-products.types';

export interface TopProductsApi {
  getTopProducts: (filters: TopProductsFilters) => Promise<TopProductsResult>;
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

export function createTopProductsApi(request: ApiRequest): TopProductsApi {
  return {
    getTopProducts: (filters) => request(`/analytics/top-products?${buildQuery(filters)}`),
  };
}
