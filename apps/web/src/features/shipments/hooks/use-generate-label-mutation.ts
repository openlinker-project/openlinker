/**
 * useGenerateLabelMutation
 *
 * Mutation hook for `POST /shipments/generate-label` (the #835 dispatch seam).
 * On success, invalidates the entire `shipments` domain so the order's panel
 * + the `/shipments` page both refetch.
 *
 * @module apps/web/src/features/shipments/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { shipmentsQueryKeys } from '../api/shipments.query-keys';
import type { DispatchResult, GenerateLabelInput } from '../api/shipments.types';

export function useGenerateLabelMutation(): UseMutationResult<
  DispatchResult,
  Error,
  GenerateLabelInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) => apiClient.shipments.generateLabel(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: shipmentsQueryKeys.all });
    },
  });
}
