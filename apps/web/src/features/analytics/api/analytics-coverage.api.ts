/**
 * Analytics Coverage API client
 *
 * Thin request module for `GET /analytics/coverage` (#2466).
 *
 * @module features/analytics/api
 */
import type { AnalyticsCoverage, AnalyticsCoverageFilters } from './analytics-coverage.types';

export interface AnalyticsCoverageApi {
  getCoverage: (filters: AnalyticsCoverageFilters) => Promise<AnalyticsCoverage>;
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
  };
}
