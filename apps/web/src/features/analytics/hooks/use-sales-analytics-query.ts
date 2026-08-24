/**
 * Sales analytics query hook
 *
 * @module features/analytics/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesAnalyticsQueryKeys } from '../api/sales-analytics.query-keys';
import type { SalesAndChannelAnalytics, SalesAnalyticsFilters } from '../api/sales-analytics.types';

export function useSalesAnalyticsQuery(
  filters: SalesAnalyticsFilters,
  options?: { enabled?: boolean }
): UseQueryResult<SalesAndChannelAnalytics> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: salesAnalyticsQueryKeys.sales(filters),
    queryFn: () => apiClient.analytics.getSales(filters),
    enabled: options?.enabled,
  });
}
