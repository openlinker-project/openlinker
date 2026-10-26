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
import type { ConfirmOrderChangeRequest } from '../api/order-edit.types';

export interface ConfirmOrderChangeInput {
  internalOrderId: string;
  changeId: string;
  /** A discount's refund intent only: record it although it passes the refund ceiling. */
  body?: ConfirmOrderChangeRequest;
}

export function useConfirmOrderChangeMutation(): UseMutationResult<
  ConfirmOrderChangeResult,
  Error,
  ConfirmOrderChangeInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ internalOrderId, changeId, body }) =>
      body
        ? apiClient.orders.confirmOrderChange(internalOrderId, changeId, body)
        : apiClient.orders.confirmOrderChange(internalOrderId, changeId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
    },
  });
}
