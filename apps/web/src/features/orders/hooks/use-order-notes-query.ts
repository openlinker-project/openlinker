/**
 * Order Notes Query Hook (#3531)
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderNote } from '../api/orders.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useOrderNotesQuery(internalOrderId: string): UseQueryResult<OrderNote[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: ordersQueryKeys.notes(internalOrderId),
    queryFn: () => apiClient.orders.listNotes(internalOrderId),
    enabled: Boolean(internalOrderId),
  });
}
