/**
 * Analytics Coverage API client
 *
 * Thin request module for `GET /analytics/coverage` (#2466) and
 * `GET /analytics/coverage/by-connection` (#2713) — the latter is the
 * server-side `GROUP BY sourceConnectionId` counterpart the former's
 * per-category drill-downs used to derive client-side.
 *
 * @module features/analytics/api
 */
import type {
  AnalyticsCoverage,
  AnalyticsCoverageByConnection,
  AnalyticsCoverageFilters,
} from './analytics-coverage.types';

export interface AnalyticsCoverageApi {
  getCoverage: (filters: AnalyticsCoverageFilters) => Promise<AnalyticsCoverage>;
  getCoverageByConnection: (filters: AnalyticsCoverageFilters) => Promise<AnalyticsCoverageByConnection>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters: AnalyticsCoverageFilters): string {
  const params = new URLSearchParams();
  params.set('from', filters.from);
  params.set('to', filters.to);
  if (filters.sourceConnectionId) {
    params.set('sourceConnectionId', filters.sourceConnectionId);
  }
  return params.toString();
}

export function createAnalyticsCoverageApi(request: ApiRequest): AnalyticsCoverageApi {
  return {
    getCoverage: (filters) => request(`/analytics/coverage?${buildQuery(filters)}`),
    getCoverageByConnection: (filters) =>
      request(`/analytics/coverage/by-connection?${buildQuery(filters)}`),
  };
}
