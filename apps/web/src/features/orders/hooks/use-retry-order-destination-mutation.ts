/**
 * Retry Order Destination Mutation Hook
 *
 * Provides a mutation for retrying a failed destination sync. Invalidates the
 * whole orders domain on success so both the detail view and the list (row
 * badge + status-summary counts) reflect the new `pending` status without a
 * manual refresh — the list page added an inline per-row Retry in #929.
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
    },
  });
}
