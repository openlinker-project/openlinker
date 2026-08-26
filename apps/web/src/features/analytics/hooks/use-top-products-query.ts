/**
 * Top products query hook
 *
 * @module features/analytics/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { topProductsQueryKeys } from '../api/top-products.query-keys';
import type { TopProductsFilters, TopProductsResult } from '../api/top-products.types';

export function useTopProductsQuery(filters: TopProductsFilters): UseQueryResult<TopProductsResult> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: topProductsQueryKeys.topProducts(filters),
    queryFn: () => apiClient.analytics.getTopProducts(filters),
  });
}
