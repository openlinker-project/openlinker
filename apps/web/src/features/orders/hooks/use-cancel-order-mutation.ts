/**
 * Cancel Order Mutation Hook (#3541)
 *
 * Cancels an order at the operator's request (#3540). The result is either
 * `cancelled` (HTTP 200) or `pending` (HTTP 202, the channel has not answered
 * and the order now reads `amending`); both change what the whole orders domain
 * shows, so success invalidates it. No optimistic update: the cancel instant,
 * the participants' outcomes and the correction proposal are all server facts.
 *
 * A refusal that proves the page is stale (already cancelled, already shipped,
 * a cancel already in flight) refetches the orders domain itself rather than
 * asking the operator to reload, the `use-place-order-hold-mutation` shape.
 * Invoice, shipment and fulfilment-task queries live outside this feature, so
 * the page that mounts the action invalidates those from its own callback.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { CancelOrderRequest, CancelOrderResult } from '../api/order-cancel.types';
import { orderCancelErrorNeedsRefresh } from '../lib/order-cancel';

export interface CancelOrderInput extends CancelOrderRequest {
  internalOrderId: string;
}

export function useCancelOrderMutation(): UseMutationResult<
  CancelOrderResult,
  Error,
  CancelOrderInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ internalOrderId, ...body }) => apiClient.orders.cancelOrder(internalOrderId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
    },
    onError: async (error: Error) => {
      if (orderCancelErrorNeedsRefresh(error)) {
        await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
      }
    },
  });
}
