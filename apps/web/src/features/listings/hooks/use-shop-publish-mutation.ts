/**
 * use-shop-publish-mutation
 *
 * Dispatches the async shop-publish job that publishes an OpenLinker variant
 * as a product on a `ProductPublisher`-capable shop connection (#1044).
 * Returns the enqueued `jobId` and the pre-created `listingCreationRecordId`
 * so callers can poll the status endpoint immediately.
 *
 * The `idempotencyKey` is required on the mutation input — callers must
 * generate a stable key per wizard session (`crypto.randomUUID()` on mount)
 * and reuse it across retries so duplicate records are never created.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { ShopPublishRequest, ShopPublishResponse } from '../api/listings.types';

export interface ShopPublishMutationInput {
  connectionId: string;
  idempotencyKey: string;
  request: ShopPublishRequest;
}

export function useShopPublishMutation() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<ShopPublishResponse, Error, ShopPublishMutationInput>({
    mutationFn: ({ connectionId, idempotencyKey, request }) =>
      apiClient.listings.shopPublish(connectionId, request, { idempotencyKey }),
    onSuccess: () => {
      // Invalidate only the listings list so a newly-published product
      // appears on the list page. Scoped to `lists()` instead of `all` so
      // the in-flight `shopPublishStatus` polling query is left alone.
      void queryClient.invalidateQueries({ queryKey: listingsQueryKeys.lists() });
    },
  });
}
