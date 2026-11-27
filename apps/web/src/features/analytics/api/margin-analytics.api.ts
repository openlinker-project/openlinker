/**
 * Margin analytics API client
 *
 * Thin request module for `GET /analytics/margin` and
 * `GET /analytics/margin/products` (#3588). Margin has no display-currency
 * option (the backend refuses the parameter), so none is sent.
 *
 * @module features/analytics/api
 */
import { toExclusiveEndInstant } from './sales-analytics.api';
import type {
  MarginAnalytics,
  MarginBucket,
  MarginFilters,
  MarginProductsFilters,
  MarginProductsResult,
} from './margin-analytics.types';

export interface MarginAnalyticsApi {
  getMargin: (filters: MarginFilters, bucket: MarginBucket) => Promise<MarginAnalytics>;
  getMarginProducts: (filters: MarginProductsFilters) => Promise<MarginProductsResult>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function buildMarginRangeParams(filters: MarginFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set('from', filters.from);
  params.set('to', toExclusiveEndInstant(filters.to));
  if (filters.sourceConnectionId) {
    params.set('sourceConnectionId', filters.sourceConnectionId);
  }
  return params;
}

export function createMarginAnalyticsApi(request: ApiRequest): MarginAnalyticsApi {
  return {
    getMargin: (filters, bucket) => {
      const params = buildMarginRangeParams(filters);
      params.set('bucket', bucket);
      return request(`/analytics/margin?${params.toString()}`);
    },
    getMarginProducts: (filters) => {
      const params = buildMarginRangeParams(filters);
      params.set('sortBy', filters.sortBy);
      params.set('limit', String(filters.limit));
      params.set('offset', String(filters.offset));
      return request(`/analytics/margin/products?${params.toString()}`);
    },
  };
}
