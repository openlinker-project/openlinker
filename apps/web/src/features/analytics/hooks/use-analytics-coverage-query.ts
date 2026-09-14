/**
 * Analytics Coverage Query Hook
 *
 * Polls `GET /analytics/coverage` (short, bounded `refetchInterval`) **only
 * while at least one category is `'in-progress'`** (#2475) — the coverage
 * list must reflect real async job state (#2468), including a run that's
 * already in-progress when the page loads (the operator navigated away and
 * back). `docs/frontend-architecture.md`'s "no retries/polling by default
 * unless a feature explicitly justifies it" rule is scoped narrowly here:
 * the moment every category reads `'open'`/`'resolved'`/`'failed'` again,
 * `refetchInterval` returns `false` and polling stops on its own.
 *
 * @module apps/web/src/features/analytics/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { analyticsCoverageQueryKeys } from '../api/analytics-coverage.query-keys';
import type { AnalyticsCoverage, AnalyticsCoverageFilters } from '../api/analytics-coverage.types';

const POLL_INTERVAL_MS = 4000;

export function useAnalyticsCoverageQuery(
  filters: AnalyticsCoverageFilters,
  options?: { enabled?: boolean }
): UseQueryResult<AnalyticsCoverage> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: analyticsCoverageQueryKeys.coverage(filters),
    queryFn: () => apiClient.analytics.getCoverage(filters),
    enabled: options?.enabled,
    refetchInterval: (query) => {
      const categories = query.state.data?.categories;
      const hasInProgress = categories?.some((row) => row.status === 'in-progress') ?? false;
      return hasInProgress ? POLL_INTERVAL_MS : false;
    },
  });
}
