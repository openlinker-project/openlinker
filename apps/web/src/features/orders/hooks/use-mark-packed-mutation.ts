/**
 * Mark Packed Mutation Hook
 *
 * Sets or clears the operator "packed" fact on one order (#2288, over #2287's
 * POST/DELETE pair). ONE hook takes the desired state rather than two hooks per
 * verb: both directions invalidate exactly the same thing, and a second hook
 * would be an identical invalidation waiting to drift out of step with this one.
 *
 * Invalidates the whole orders domain on success — like the retry-destination
 * hook — so the detail control, the row tick and the timeline entry can never
 * disagree about whether the order is packed. No optimistic update: the packed
 * instant is stamped server-side, so an optimistic row would have to invent a
 * timestamp it does not know.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderRecord } from '../api/orders.types';

export interface MarkPackedInput {
  internalOrderId: string;
  /** `true` marks packed, `false` clears the mark. */
  packed: boolean;
}

export function useMarkPackedMutation(): UseMutationResult<OrderRecord, Error, MarkPackedInput> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ internalOrderId, packed }) =>
      packed
        ? apiClient.orders.markPacked(internalOrderId)
        : apiClient.orders.unmarkPacked(internalOrderId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
    },
  });
}
