/**
 * Retry Order Destination Mutation Hook
 *
 * Provides a mutation for retrying a failed destination sync from the order
 * detail page. Invalidates the order detail query on success so the row
 * reflects its new `pending` status without a manual refresh.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { RetryOrderDestinationResult } from '../api/orders.types';

export interface RetryOrderDestinationInput {
  internalOrderId: string;
  destinationConnectionId: string;
}

export function useRetryOrderDestinationMutation(): UseMutationResult<
  RetryOrderDestinationResult,
  Error,
  RetryOrderDestinationInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ internalOrderId, destinationConnectionId }) =>
      apiClient.orders.retryDestination(internalOrderId, destinationConnectionId),
    onSuccess: async (_, { internalOrderId }) => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.detail(internalOrderId) });
    },
  });
}
