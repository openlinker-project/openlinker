/**
 * Mark Buyer Note Read Mutation Hook (#3539)
 *
 * Records that an operator read the order's buyer note. Invalidates the whole
 * orders domain like the packed and hold hooks, so the detail block, the
 * Activity timeline and any list row cannot disagree about it. No optimistic
 * update: the instant and the acting user are stamped server-side.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderRecord } from '../api/orders.types';

export function useMarkBuyerNoteReadMutation(): UseMutationResult<OrderRecord, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (internalOrderId: string) => apiClient.orders.markBuyerNoteRead(internalOrderId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
    },
  });
}
