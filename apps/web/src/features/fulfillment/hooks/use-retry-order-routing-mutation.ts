/**
 * Retry order routing mutation (#3558, used by #3557)
 *
 * Enqueues a fresh routing attempt for a held order. The job only starts here;
 * the outcome lands on the order, so both the orders and the fulfilment domains
 * are invalidated (the held badge and the decision both change).
 *
 * @module apps/web/src/features/fulfillment/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys, type RetryOrderRoutingResult } from '../../orders';
import { fulfillmentQueryKeys } from '../api/fulfillment.query-keys';

export function useRetryOrderRoutingMutation(): UseMutationResult<
  RetryOrderRoutingResult,
  Error,
  string
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (internalOrderId: string) => apiClient.orders.retryRouting(internalOrderId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: fulfillmentQueryKeys.all }),
      ]);
    },
  });
}
