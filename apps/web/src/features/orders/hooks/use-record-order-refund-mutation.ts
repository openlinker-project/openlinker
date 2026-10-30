/**
 * Record Order Refund Mutation Hook (#3541)
 *
 * Records that the operator refunded the buyer. OpenLinker moves no money, so
 * this is a record of an act that already happened elsewhere. Invalidates the
 * whole orders domain (the refunds list and changes live under it) so the
 * notice, the timeline and the refund list cannot disagree.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderRefundRecord, RecordOrderRefundRequest } from '../api/order-refund.types';

export interface RecordOrderRefundInput extends RecordOrderRefundRequest {
  internalOrderId: string;
}

export function useRecordOrderRefundMutation(): UseMutationResult<
  OrderRefundRecord,
  Error,
  RecordOrderRefundInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ internalOrderId, ...body }) => apiClient.orders.recordRefund(internalOrderId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
    },
  });
}
