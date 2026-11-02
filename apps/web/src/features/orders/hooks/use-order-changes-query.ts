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
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderChangeView } from '../api/order-cancel.types';

/** How often an open cancel request is re-read. */
export const ORDER_CHANGES_POLL_MS = 15_000;

export function useOrderChangesQuery(internalOrderId: string): UseQueryResult<OrderChangeView[]> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ordersQueryKeys.changes(internalOrderId),
    queryFn: () => apiClient.orders.listOrderChanges(internalOrderId),
    enabled: Boolean(internalOrderId),
    // A cancel waiting for the channel is answered by a webhook or the reconcile
    // pass, neither of which pushes to this page; poll only while one is open.
    refetchInterval: (query) => {
      const open = query.state.data?.some(
        (change) => change.kind === 'order.cancel_request' && change.open,
      );
      return open && !document.hidden ? ORDER_CHANGES_POLL_MS : false;
    },
  });

  // The poll sees the cancel confirm by itself, but the order record (header
  // badge, lifecycle phase) is a different read and would stay on "amending"
  // until a reload (C-49).
  const hadOpenCancel = useRef(false);
  const hasOpenCancel =
    query.data?.some((change) => change.kind === 'order.cancel_request' && change.open) ?? false;
  useEffect(() => {
    if (hadOpenCancel.current && !hasOpenCancel) {
      void queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
    }
    hadOpenCancel.current = hasOpenCancel;
  }, [hasOpenCancel, queryClient]);

  return query;
}
