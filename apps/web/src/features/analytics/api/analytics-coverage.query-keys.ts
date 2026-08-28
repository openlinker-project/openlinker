import type { AnalyticsCoverageFilters } from './analytics-coverage.types';

export const analyticsCoverageQueryKeys = {
  coverage: (filters: AnalyticsCoverageFilters) => ['analytics', 'coverage', filters] as const,
};
