/**
 * useBulkGenerateLabelsMutation
 *
 * Mutation hook for `POST /shipments/bulk/generate-labels` (#1109) — one source
 * connection per call. On success, invalidates the entire `shipments` domain so
 * the `/shipments` page refetches. The bulk-dispatch dialog calls `mutateAsync`
 * once per source group inside a `Promise.allSettled` fan-out and merges the
 * per-order results itself (orders queries are invalidated by the dialog, since
 * cross-feature query keys aren't reached into from here).
 *
 * @module apps/web/src/features/shipments/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { shipmentsQueryKeys } from '../api/shipments.query-keys';
import type { BulkDispatchResult, BulkGenerateLabelsInput } from '../api/shipments.types';

export function useBulkGenerateLabelsMutation(): UseMutationResult<
  BulkDispatchResult,
  Error,
  BulkGenerateLabelsInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) => apiClient.shipments.bulkGenerateLabels(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: shipmentsQueryKeys.all });
    },
  });
}
