/**
 * Margin analytics query hooks (#3588)
 *
 * @module features/analytics/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { marginAnalyticsQueryKeys } from '../api/margin-analytics.query-keys';
import type {
  MarginAnalytics,
  MarginBucket,
  MarginFilters,
  MarginProductsFilters,
  MarginProductsResult,
} from '../api/margin-analytics.types';

export function useMarginAnalyticsQuery(
  filters: MarginFilters,
  bucket: MarginBucket = 'week'
): UseQueryResult<MarginAnalytics> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: marginAnalyticsQueryKeys.margin(filters, bucket),
    queryFn: () => apiClient.analytics.getMargin(filters, bucket),
  });
}

export function useMarginProductsQuery(
  filters: MarginProductsFilters,
  options?: { enabled?: boolean }
): UseQueryResult<MarginProductsResult> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: marginAnalyticsQueryKeys.products(filters),
    queryFn: () => apiClient.analytics.getMarginProducts(filters),
    enabled: options?.enabled,
  });
}
