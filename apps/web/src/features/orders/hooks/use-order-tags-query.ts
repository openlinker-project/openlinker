/**
 * Order Tag Vocabulary Query Hook (#3532, D34)
 *
 * The workspace-wide tag vocabulary, each with its live order count. Shared
 * by the tag picker, the Settings tag manager and the orders-list filter —
 * one cached read, since the workspace holds at most 50 tags (D34).
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderTag } from '../api/orders.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useOrderTagsQuery(): UseQueryResult<OrderTag[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: ordersQueryKeys.tags(),
    queryFn: () => apiClient.orders.listTags(),
  });
}
