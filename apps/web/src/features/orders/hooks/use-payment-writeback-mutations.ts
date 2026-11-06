/**
 * Payment writeback mutations (#3963)
 *
 * Retry (queue the shop writes again) and Mark as handled (the operator fixed
 * the payment in the shop). Both invalidate the whole orders domain, so the
 * detail panel, the list marker and the filter count move together.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { PaymentWritebackHandledResult, PaymentWritebackRetryResult } from '../api/orders.types';

export function useRetryPaymentWritebackMutation(): UseMutationResult<
  PaymentWritebackRetryResult,
  Error,
  string[]
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (internalOrderIds) => apiClient.orders.retryPaymentWriteback(internalOrderIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
    },
  });
}

export function useMarkPaymentWritebackHandledMutation(): UseMutationResult<
  PaymentWritebackHandledResult,
  Error,
  string[]
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (internalOrderIds) => apiClient.orders.markPaymentWritebackHandled(internalOrderIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
    },
  });
}
