/**
 * use-bulk-shop-publish-retry-failed-mutation
 *
 * POST /listings/bulk-shop-publish/:batchId/retry-failed - re-enqueues every
 * failed child of a shop-publish batch. On success the batch query is
 * invalidated so polling resumes at once: the backend flips the batch back to
 * `running` and the tracker has to see that transition.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { BulkListingRetryResponse } from '../api/bulk-listings.types';

export function useBulkShopPublishRetryFailedMutation(): UseMutationResult<
  BulkListingRetryResponse,
  Error,
  string
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<BulkListingRetryResponse, Error, string>({
    mutationFn: (batchId: string) => apiClient.listings.retryBulkShopPublishFailed(batchId),
    onSuccess: (_data, batchId) => {
      void queryClient.invalidateQueries({
        queryKey: listingsQueryKeys.bulkShopPublishBatch(batchId),
      });
    },
  });
}
