/**
 * Source Change Mutation Hook (#3961)
 *
 * "Check again" and "Keep as is" for an order the shop changed after packing
 * started. ONE hook with the action as input, like `useMarkPackedMutation`:
 * both actions invalidate the same queries, and two hooks would be the same
 * invalidation waiting to drift apart.
 *
 * Invalidates the orders domain AND the fulfilment tasks, because either action
 * can narrow the packing work or release its hold.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { SourceChangeResult } from '../api/orders.types';

export interface SourceChangeMutationInput {
  internalOrderId: string;
  action: 'recheck' | 'accept';
}

export function useSourceChangeMutation(): UseMutationResult<
  SourceChangeResult,
  Error,
  SourceChangeMutationInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ internalOrderId, action }) =>
      action === 'recheck'
        ? apiClient.orders.recheckSourceChange(internalOrderId)
        : apiClient.orders.acceptSourceChange(internalOrderId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all }),
        // The fulfilment task panel reads its own key; a narrowed line or a
        // released hold must show there too.
        queryClient.invalidateQueries({ queryKey: ['fulfillment'] }),
      ]);
    },
  });
}
