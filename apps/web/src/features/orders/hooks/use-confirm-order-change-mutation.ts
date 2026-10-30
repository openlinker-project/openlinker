/**
 * Confirm Order Change Mutation Hook (#3541)
 *
 * Confirms the credit proposal a cancelled, invoiced order left behind (#3540).
 * Confirming issues the correcting invoice, an act that cannot be withdrawn once
 * a tax authority has it, so there is no optimistic update and no automatic
 * retry. A provider failure leaves the proposal open on the server, which is why
 * the dialog keeps its button after an error.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { ConfirmOrderChangeResult } from '../api/order-cancel.types';

export interface ConfirmOrderChangeInput {
  internalOrderId: string;
  changeId: string;
}

export function useConfirmOrderChangeMutation(): UseMutationResult<
  ConfirmOrderChangeResult,
  Error,
  ConfirmOrderChangeInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ internalOrderId, changeId }) =>
      apiClient.orders.confirmOrderChange(internalOrderId, changeId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
    },
  });
}
