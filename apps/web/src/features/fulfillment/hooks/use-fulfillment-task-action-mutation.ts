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
 * ## Invalidate the WHOLE feature, not the order that issued the action
 *
 * The key is `fulfillmentQueryKeys.all`, deliberately, even though this hook's
 * only caller today is the order-detail panel and `worksByOrder(orderId)` would
 * cover its rows exactly. One task is rendered by more than one cached query —
 * #2410's worklist keys its rows by FILTERS, not by order — and an action taken
 * from the worklist under the narrow key would refresh the order panel and
 * leave the worklist's own row holding a stale `version`. The operator's next
 * click on that row is then a 409 the UI manufactured for itself out of its own
 * cache, on the exact optimistic-token path this feature exists to handle
 * gracefully. `all` is a prefix of every fulfilment key, so it is strictly
 * wider than the panel needs and never narrower than a consumer needs.
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
  /**
   * The order the caller acted from. Context only — it is stripped from the
   * request body and is deliberately NOT the invalidation key (see the module
   * docblock): invalidating by order would miss a sibling query that renders
   * the same task under a different key.
   */
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: fulfillmentQueryKeys.all });
    },
    onError: async (error: Error) => {
      // Either coded 409 — and any other 409 the server raises about this
      // task's own state — means the server holds a truth this client does
      // not, so the surface refreshes ITSELF rather than asking the operator
      // to reload. A non-conflict failure is left alone.
      if (readFulfillmentConflict(error)) {
        await queryClient.invalidateQueries({ queryKey: fulfillmentQueryKeys.all });
      }
    },
  });
}
