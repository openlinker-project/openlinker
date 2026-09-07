/**
 * Product Matching Coverage Orders Query Hook
 *
 * Backs the `detail-mapping` modal's real pagination (#2474 Phase 7) —
 * `GET /analytics/coverage/matching/orders`.
 *
 * @module apps/web/src/features/analytics/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { analyticsMatchingCoverageQueryKeys } from '../api/analytics-matching-coverage.query-keys';
import type {
  GetProductMatchingOrdersInput,
  ProductMatchingOrdersPage,
} from '../api/analytics-matching-coverage.types';

export function useMatchingCoverageOrdersQuery(
  input: GetProductMatchingOrdersInput,
  options?: { enabled?: boolean }
): UseQueryResult<ProductMatchingOrdersPage> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: analyticsMatchingCoverageQueryKeys.orders(input),
    queryFn: () => apiClient.analytics.getProductMatchingOrders(input),
    enabled: options?.enabled,
  });
}
