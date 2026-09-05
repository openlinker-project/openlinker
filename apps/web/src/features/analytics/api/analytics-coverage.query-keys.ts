import type { AnalyticsCoverageFilters } from './analytics-coverage.types';

export const analyticsCoverageQueryKeys = {
  all: ['analytics', 'coverage'] as const,
  coverage: (filters: AnalyticsCoverageFilters) => ['analytics', 'coverage', filters] as const,
  byConnection: (filters: AnalyticsCoverageFilters) =>
    ['analytics', 'coverage', 'by-connection', filters] as const,
};
