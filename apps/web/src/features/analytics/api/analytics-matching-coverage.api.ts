/**
 * Analytics Matching Coverage API client
 *
 * Thin request module for `GET /analytics/coverage/matching/orders` (#2474
 * Phase 7) — the `'product-matching'` category's paginated drill-down
 * behind the `detail-mapping` modal.
 *
 * @module features/analytics/api
 */
import type { GetProductMatchingOrdersInput, ProductMatchingOrdersPage } from './analytics-matching-coverage.types';

export interface AnalyticsMatchingCoverageApi {
  getProductMatchingOrders: (input: GetProductMatchingOrdersInput) => Promise<ProductMatchingOrdersPage>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(input: GetProductMatchingOrdersInput): string {
  const params = new URLSearchParams();
  params.set('from', input.from);
  params.set('to', input.to);
  if (input.sourceConnectionId) {
    params.set('sourceConnectionId', input.sourceConnectionId);
  }
  if (typeof input.limit === 'number') {
    params.set('limit', String(input.limit));
  }
  if (typeof input.offset === 'number') {
    params.set('offset', String(input.offset));
  }
  return params.toString();
}

export function createAnalyticsMatchingCoverageApi(request: ApiRequest): AnalyticsMatchingCoverageApi {
  return {
    getProductMatchingOrders: (input) =>
      request(`/analytics/coverage/matching/orders?${buildQuery(input)}`),
  };
}
