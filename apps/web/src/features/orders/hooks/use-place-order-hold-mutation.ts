/**
 * Place Order Hold Mutation Hook (#2342)
 *
 * Stops OpenLinker sending one order on to its destination and dispatching it,
 * until the hold is released (#2339/#2341).
 *
 * Invalidates the whole orders domain on success — like the retry-destination
 * and mark-packed hooks — so the row badge, the detail panel and the timeline
 * can never disagree about whether the order is held. No optimistic update:
 * the instant and the acting user are stamped server-side, so an optimistic
 * row would have to invent both.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { PlaceOrderHoldRequest, PlaceOrderHoldResult } from '../api/orders.types';

export interface PlaceOrderHoldInput extends PlaceOrderHoldRequest {
  internalOrderId: string;
}

export function usePlaceOrderHoldMutation(): UseMutationResult<
  PlaceOrderHoldResult,
  Error,
  PlaceOrderHoldInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ internalOrderId, ...body }) => apiClient.orders.placeHold(internalOrderId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
    },
  });
}
