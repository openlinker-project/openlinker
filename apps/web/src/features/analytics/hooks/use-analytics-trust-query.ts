/**
 * Analytics Trust Query Hook
 *
 * @module apps/web/src/features/analytics/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { analyticsTrustQueryKeys } from '../api/analytics-trust.query-keys';
import type { AnalyticsTrustSnapshot } from '../api/analytics-trust.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useAnalyticsTrustQuery(): UseQueryResult<AnalyticsTrustSnapshot> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: analyticsTrustQueryKeys.snapshot(),
    queryFn: () => apiClient.analyticsTrust.getTrust(),
  });
}
