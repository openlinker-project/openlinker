/**
 * use-bulk-shop-publish-mutation
 *
 * Submits a bulk shop-publish batch — one product per selected variant on a
 * `ProductPublisher`-capable shop connection (#1044). Returns the persisted
 * `batchId` and per-variant job + record ids so callers can poll the batch
 * status endpoint immediately.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { BulkShopPublishRequest, BulkShopPublishResponse } from '../api/listings.types';

export interface BulkShopPublishMutationInput {
  request: BulkShopPublishRequest;
}

export function useBulkShopPublishMutation() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<BulkShopPublishResponse, Error, BulkShopPublishMutationInput>({
    mutationFn: ({ request }) => apiClient.listings.shopPublishBulk(request),
    onSuccess: () => {
      // Invalidate only the listings list so newly-published products appear
      // on the list page. Scoped to `lists()` so the in-flight
      // `bulkShopPublishBatch` polling query is left alone.
      void queryClient.invalidateQueries({ queryKey: listingsQueryKeys.lists() });
    },
  });
}
