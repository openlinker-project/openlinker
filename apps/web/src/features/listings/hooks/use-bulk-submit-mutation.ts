/**
 * use-bulk-submit-mutation
 *
 * POST /listings/bulk-create — submits a bulk batch (1..100 variants).
 * Caller mints an idempotency key once per wizard mount and reuses it
 * across retries; the same key forwarded on retry returns the same
 * batch instead of creating a duplicate.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type {
  BulkOfferCreateRequest,
  BulkOfferCreateResponse,
} from '../api/bulk-listings.types';

export interface BulkSubmitMutationInput {
  idempotencyKey: string;
  request: BulkOfferCreateRequest;
}

export function useBulkSubmitMutation() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<BulkOfferCreateResponse, Error, BulkSubmitMutationInput>({
    mutationFn: ({ idempotencyKey, request }) =>
      apiClient.listings.bulkCreate(request, { idempotencyKey }),
    onSuccess: () => {
      // New offers will eventually appear on the listings list once the
      // worker finishes per-variant creation. Scoped to `lists()` so
      // active polling queries (bulkBatch, offerCreationStatus) are not
      // disturbed.
      void queryClient.invalidateQueries({ queryKey: listingsQueryKeys.lists() });
    },
  });
}
