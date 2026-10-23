/**
 * Fulfilment-work assignment mutation (#3340, ADR-074; `expectedVersion`
 * #3340 second follow-up)
 *
 * Posts a supervisor's staffing decision. Mirrors the action mutation's
 * invalidation shape (`fulfillmentQueryKeys.all`) for the same reason: one
 * task is rendered by more than one cached query — the standalone worklist
 * (#2410) keys its rows by filters, this board fetches the same read model
 * unfiltered, and an assignment made from either surface must refresh both.
 *
 * ## `expectedVersion` is an optional lost-update guard, sent by every caller here
 *
 * ADR-074 places WHO-may-assign outside the legality matrix `applyAction`
 * enforces, so this endpoint is not gated by `supportedActions` the way an
 * action is. That says nothing about a stale-write guard, an orthogonal
 * concern: has a PEER written since this caller read the row. The board
 * always supplies it — see `UpdateFulfillmentWorkAssignmentRequest`'s own
 * docblock for why the value must be the one RENDERED, never re-read.
 *
 * ## A `version_conflict` 409 invalidates too, or "the board has been
 * refreshed" is a lie
 *
 * The row's own copy (`ASSIGN_PACKING_WORK_COPY.row.moveConflict`) tells the
 * operator the board was refreshed on a conflict. Before this guard existed
 * there was no conflict to refresh FROM — the endpoint could not 409 on a
 * stale token — so `onSuccess`-only invalidation was complete. Now that a
 * peer's write can leave this caller holding a stale `version`, the failure
 * path has to invalidate too, exactly as the sibling action mutation already
 * does for its own two coded 409s.
 *
 * @module apps/web/src/features/fulfillment/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { fulfillmentQueryKeys } from '../api/fulfillment.query-keys';
import type {
  FulfillmentTask,
  UpdateFulfillmentWorkAssignmentRequest,
} from '../api/fulfillment.types';
import { ApiError } from '../../../shared/api/api-error';

export interface UpdateFulfillmentAssignmentInput extends UpdateFulfillmentWorkAssignmentRequest {
  workId: string;
}

export function useUpdateFulfillmentAssignmentMutation(): UseMutationResult<
  FulfillmentTask,
  Error,
  UpdateFulfillmentAssignmentInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workId, ...body }) => apiClient.fulfillment.updateAssignment(workId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: fulfillmentQueryKeys.all });
    },
    onError: async (error: Error) => {
      // A 409 here means the row this caller acted on is stale — the same
      // truth-the-server-holds-that-we-don't reasoning the action mutation
      // applies to its own conflicts. Any other failure says nothing about
      // staleness and leaves the cache alone.
      if (error instanceof ApiError && error.isConflict()) {
        await queryClient.invalidateQueries({ queryKey: fulfillmentQueryKeys.all });
      }
    },
  });
}
