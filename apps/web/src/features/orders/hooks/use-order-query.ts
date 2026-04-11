import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderRecord } from '../api/orders.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useOrderQuery(internalOrderId: string): UseQueryResult<OrderRecord> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: ordersQueryKeys.detail(internalOrderId),
    queryFn: () => apiClient.orders.getById(internalOrderId),
    enabled: Boolean(internalOrderId),
    retry: false,
  });
}
