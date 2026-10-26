/**
 * Order changes query (#3541)
 *
 * The order's cancel requests and the credit proposals they leave, from the
 * server. The cancel notice, the "Review correction" action and the timeline
 * render FROM this read, so they survive a reload and are visible to a second
 * admin; the cancel and confirm mutations only invalidate it.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderChangeView } from '../api/order-cancel.types';

export function useOrderChangesQuery(internalOrderId: string): UseQueryResult<OrderChangeView[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: ordersQueryKeys.changes(internalOrderId),
    queryFn: () => apiClient.orders.listOrderChanges(internalOrderId),
    enabled: Boolean(internalOrderId),
  });
}
