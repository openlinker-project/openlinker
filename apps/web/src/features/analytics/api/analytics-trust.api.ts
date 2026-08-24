/**
 * Analytics Trust API Client
 *
 * Thin API module for the `/analytics` page's data-trust read (#1982) and
 * needs-attention read (#1983/#1989) — both under the `/analytics` resource
 * family, kept in one namespace to avoid growing `CoreApiClient` for a
 * single extra method.
 *
 * @module apps/web/src/features/analytics/api
 */
import type { AnalyticsTrustSnapshot } from './analytics-trust.types';
import type { NeedsAttentionSummary } from './needs-attention.types';

export interface AnalyticsTrustApi {
  getTrust: () => Promise<AnalyticsTrustSnapshot>;
  getNeedsAttention: () => Promise<NeedsAttentionSummary>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createAnalyticsTrustApi(request: ApiRequest): AnalyticsTrustApi {
  return {
    getTrust(): Promise<AnalyticsTrustSnapshot> {
      return request<AnalyticsTrustSnapshot>('/analytics/trust');
    },
    getNeedsAttention(): Promise<NeedsAttentionSummary> {
      return request<NeedsAttentionSummary>('/analytics/needs-attention');
    },
  };
}
