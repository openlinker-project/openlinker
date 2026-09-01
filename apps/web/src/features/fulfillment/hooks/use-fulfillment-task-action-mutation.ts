/**
 * Fulfilment-task action mutation (#2411)
 *
 * Posts one token-guarded action.
 *
 * ## `expectedVersion` is supplied by the CALLER, from what it rendered
 *
 * The hook never reads a version out of the cache. The token's whole purpose is
 * to say "I acted on the task as I was shown it"; substituting a fresher value
 * at send time would silently make `version_conflict` unreachable and hand the
 * last writer the win — exactly the two-operators-ship-it-twice failure the
 * token exists to prevent.
 *
 * ## Invalidate; never patch the cache from a 409 body
 *
 * Both coded 409s carry a refreshed `supportedActions`, but NOT a whole task —
 * `FulfillmentWorkConflictResponseDto` has no `lines`, no `activeHolds`, no
 * `orderId`. Writing that into the cache would produce an object the boundary
 * schema rejects. So every settled outcome that tells us the server holds a
 * truth this client does not — success, and either 409 — invalidates and lets
 * the refetch be the re-render. Any other failure says nothing about staleness
 * and leaves the cache alone (the `usePlaceOrderHoldMutation` precedent).
 *
 * @module apps/web/src/features/fulfillment/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { fulfillmentQueryKeys } from '../api/fulfillment.query-keys';
import type { ApplyFulfillmentTaskActionRequest, FulfillmentTask } from '../api/fulfillment.types';
import { readFulfillmentConflict } from '../lib/fulfillment-conflict';

export interface ApplyFulfillmentTaskActionInput extends ApplyFulfillmentTaskActionRequest {
  workId: string;
  action: string;
  /** The order whose panel is showing this task — the invalidation target. */
  orderId: string;
}

export function useFulfillmentTaskActionMutation(): UseMutationResult<
  FulfillmentTask,
  Error,
  ApplyFulfillmentTaskActionInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workId, action, orderId: _orderId, ...body }) =>
      apiClient.fulfillment.applyAction(workId, action, body),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({
        queryKey: fulfillmentQueryKeys.worksByOrder(variables.orderId),
      });
    },
    onError: async (error: Error, variables) => {
      // Either coded 409 — and any other 409 the server raises about this
      // task's own state — means the server holds a truth this client does
      // not, so the surface refreshes ITSELF rather than asking the operator
      // to reload. A non-conflict failure is left alone.
      if (readFulfillmentConflict(error)) {
        await queryClient.invalidateQueries({
          queryKey: fulfillmentQueryKeys.worksByOrder(variables.orderId),
        });
      }
    },
  });
}
