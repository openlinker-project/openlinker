/**
 * Analytics Trust API Client
 *
 * Thin API module for the analytics data-trust read. A single GET the
 * /analytics page calls before rendering any figure, to disclose the
 * limits of the data it reports over (#1982).
 *
 * @module apps/web/src/features/analytics/api
 */
import type { AnalyticsTrustSnapshot } from './analytics-trust.types';

export interface AnalyticsTrustApi {
  getTrust: () => Promise<AnalyticsTrustSnapshot>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createAnalyticsTrustApi(request: ApiRequest): AnalyticsTrustApi {
  return {
    getTrust(): Promise<AnalyticsTrustSnapshot> {
      return request<AnalyticsTrustSnapshot>('/analytics/trust');
    },
  };
}
