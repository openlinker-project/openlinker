/**
 * Analytics Remediation API client
 *
 * Thin request module for the currency-remediation surface (#2468, extended
 * #2474 Phase 7): `POST .../recalculate` opens a run, `GET .../status/:runId`
 * polls its lifecycle (drives the `detail-currency` row's in-progress /
 * fixed / failed sub-states — never a client-only timer), and
 * `GET .../orders` pages the affected-order list behind the `detail-currency`
 * modal.
 *
 * @module features/analytics/api
 */
import type {
  AnalyticsRemediationRun,
  CurrencyMismatchOrdersPage,
  GetCurrencyMismatchOrdersInput,
  RecalculateCurrencyInput,
} from './analytics-remediation.types';

export interface AnalyticsRemediationApi {
  recalculateCurrency: (input: RecalculateCurrencyInput) => Promise<AnalyticsRemediationRun>;
  getCurrencyRemediationStatus: (runId: string) => Promise<AnalyticsRemediationRun>;
  getCurrencyMismatchOrders: (input: GetCurrencyMismatchOrdersInput) => Promise<CurrencyMismatchOrdersPage>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildOrdersQuery(input: GetCurrencyMismatchOrdersInput): string {
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

export function createAnalyticsRemediationApi(request: ApiRequest): AnalyticsRemediationApi {
  return {
    recalculateCurrency: (input) =>
      request('/analytics/coverage/currency/recalculate', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    getCurrencyRemediationStatus: (runId) =>
      request(`/analytics/coverage/currency/status/${encodeURIComponent(runId)}`),
    getCurrencyMismatchOrders: (input) =>
      request(`/analytics/coverage/currency/orders?${buildOrdersQuery(input)}`),
  };
}
