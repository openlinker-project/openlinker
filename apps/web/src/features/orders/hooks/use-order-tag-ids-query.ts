/**
 * Order Tag Assignment Query Hook (#3532)
 *
 * Tag ids assigned to ONE order — backs the order-header chips and the tag
 * picker's checked state.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ordersQueryKeys } from '../api/orders.query-keys';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useOrderTagIdsQuery(internalOrderId: string): UseQueryResult<string[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: ordersQueryKeys.orderTags(internalOrderId),
    queryFn: () => apiClient.orders.listOrderTags(internalOrderId),
    enabled: Boolean(internalOrderId),
  });
}
