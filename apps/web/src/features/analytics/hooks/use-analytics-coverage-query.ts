/**
 * Analytics Coverage Query Hook
 *
 * @module apps/web/src/features/analytics/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { analyticsCoverageQueryKeys } from '../api/analytics-coverage.query-keys';
import type { AnalyticsCoverage, AnalyticsCoverageFilters } from '../api/analytics-coverage.types';

export function useAnalyticsCoverageQuery(
  filters: AnalyticsCoverageFilters,
  options?: { enabled?: boolean }
): UseQueryResult<AnalyticsCoverage> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: analyticsCoverageQueryKeys.coverage(filters),
    queryFn: () => apiClient.analytics.getCoverage(filters),
    enabled: options?.enabled,
  });
}
