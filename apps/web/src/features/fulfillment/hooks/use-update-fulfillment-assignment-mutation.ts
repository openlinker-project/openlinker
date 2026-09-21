/**
 * Fulfilment-work assignment mutation (#3340, ADR-074)
 *
 * Posts a supervisor's staffing decision. Mirrors the action mutation's
 * invalidation shape (`fulfillmentQueryKeys.all`) for the same reason: one
 * task is rendered by more than one cached query — the standalone worklist
 * (#2410) keys its rows by filters, this board fetches the same read model
 * unfiltered, and an assignment made from either surface must refresh both.
 *
 * NOT gated by `expectedVersion` — see `UpdateFulfillmentWorkAssignmentRequest`'s
 * own docblock; there is no optimistic token to carry.
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
  });
}
