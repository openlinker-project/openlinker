/**
 * Analytics Remediation API client
 *
 * Thin request module for `POST /analytics/coverage/currency/recalculate`
 * (#2468) — the one genuinely-async Data Coverage remediation. Polling the
 * run's lifecycle (`GET .../status/:runId`) is a follow-up; this task only
 * needs to open the run and let the operator know it started.
 *
 * @module features/analytics/api
 */
import type { AnalyticsRemediationRun, RecalculateCurrencyInput } from './analytics-remediation.types';

export interface AnalyticsRemediationApi {
  recalculateCurrency: (input: RecalculateCurrencyInput) => Promise<AnalyticsRemediationRun>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createAnalyticsRemediationApi(request: ApiRequest): AnalyticsRemediationApi {
  return {
    recalculateCurrency: (input) =>
      request('/analytics/coverage/currency/recalculate', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  };
}
