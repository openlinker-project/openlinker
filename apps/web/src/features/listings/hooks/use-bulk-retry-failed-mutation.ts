/**
 * use-bulk-retry-failed-mutation
 *
 * POST /listings/bulk-create/:batchId/retry-failed — re-enqueues every
 * failed child of a batch (#742). On success, invalidates the bulk-batch
 * query so polling resumes immediately (the BE flips status back to
 * `running` and we need to see the transition).
 *
 * Per-record retry (issue #741 AC-4) is intentionally NOT shipped here —
 * the BE endpoint doesn't exist yet. Tracked as a follow-up.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { BulkListingRetryResponse } from '../api/bulk-listings.types';

export function useBulkRetryFailedMutation() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<BulkListingRetryResponse, Error, string>({
    mutationFn: (batchId: string) => apiClient.listings.retryBulkFailed(batchId),
    onSuccess: (_data, batchId) => {
      void queryClient.invalidateQueries({
        queryKey: listingsQueryKeys.bulkBatch(batchId),
      });
    },
  });
}
