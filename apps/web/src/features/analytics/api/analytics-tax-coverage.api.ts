/**
 * Analytics Tax Coverage API client
 *
 * Thin request module for `GET /analytics/coverage/tax/orders` and
 * `POST /analytics/coverage/tax/rerun-backfill` (#2469, extended #2474
 * Phase 7) — the tax A/B/C category's paginated drill-downs (`detail-tax` /
 * `detail-novat` / `detail-postrollout` modals) plus category C's "sync the
 * catalog now" action.
 *
 * @module features/analytics/api
 */
import type {
  GetTaxCoverageOrdersInput,
  RerunTaxBackfillInput,
  RerunTaxBackfillResult,
  TaxCoverageOrdersPage,
} from './analytics-tax-coverage.types';

export interface AnalyticsTaxCoverageApi {
  getTaxCoverageOrders: (input: GetTaxCoverageOrdersInput) => Promise<TaxCoverageOrdersPage>;
  rerunTaxBackfill: (input: RerunTaxBackfillInput) => Promise<RerunTaxBackfillResult>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(input: GetTaxCoverageOrdersInput): string {
  const params = new URLSearchParams();
  params.set('category', input.category);
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

export function createAnalyticsTaxCoverageApi(request: ApiRequest): AnalyticsTaxCoverageApi {
  return {
    getTaxCoverageOrders: (input) => request(`/analytics/coverage/tax/orders?${buildQuery(input)}`),
    rerunTaxBackfill: (input) =>
      request('/analytics/coverage/tax/rerun-backfill', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  };
}
