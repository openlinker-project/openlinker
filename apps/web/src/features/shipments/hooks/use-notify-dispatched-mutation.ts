/**
 * useNotifyDispatchedMutation
 *
 * Mutation hook for `POST /shipments/:id/notify-dispatched` (#769) — the
 * operator's manual entry point to #837's source + destination projection.
 *
 * Invalidates both the shipments domain (the row's status flips to
 * `dispatched`) and the orders domain (the destination Sync Status panel
 * picks up the projection result). Mirrors the wider invalidation surface
 * the existing `useRetryOrderDestinationMutation` uses.
 *
 * @module apps/web/src/features/shipments/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../../orders';
import { shipmentsQueryKeys } from '../api/shipments.query-keys';
import type { NotifyDispatchedResult } from '../api/shipments.types';

export function useNotifyDispatchedMutation(): UseMutationResult<
  NotifyDispatchedResult,
  Error,
  string
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shipmentId) => apiClient.shipments.notifyDispatched(shipmentId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: shipmentsQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all }),
      ]);
    },
  });
}
