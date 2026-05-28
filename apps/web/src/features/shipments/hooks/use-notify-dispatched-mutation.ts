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
import { shipmentsQueryKeys } from '../api/shipments.query-keys';
import type { NotifyDispatchedResult } from '../api/shipments.types';

// Bare prefix to avoid a cross-feature `orders` import (the orders feature
// has no public barrel yet, and deep-importing its query-keys file would
// require adding the slug to `.eslintrc.js`'s `no-restricted-imports` deny
// pattern). Invalidating by the bare `['orders']` prefix matches every key
// the orders feature emits (its factory uses the same prefix). When the
// orders barrel lands, this becomes `ordersQueryKeys.all`.
const ORDERS_QUERY_KEY_PREFIX = ['orders'] as const;

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
        queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY_PREFIX }),
      ]);
    },
  });
}
