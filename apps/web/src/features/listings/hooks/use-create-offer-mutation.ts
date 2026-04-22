/**
 * use-create-offer-mutation
 *
 * Dispatches the async `marketplace.offer.create` job that publishes an
 * OpenLinker variant as a new offer on a marketplace connection. Returns
 * the enqueued `jobId` and the pre-created `offerCreationRecordId` so
 * callers can poll the status endpoint immediately.
 *
 * The `idempotencyKey` is required on the mutation input — callers must
 * generate a stable key per wizard session (`crypto.randomUUID()` on
 * drawer open) and reuse it across retries so duplicate records are
 * never created.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { CreateOfferRequest, CreateOfferResponse } from '../api/listings.types';

export interface CreateOfferMutationInput {
  connectionId: string;
  idempotencyKey: string;
  request: CreateOfferRequest;
}

export function useCreateOfferMutation() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<CreateOfferResponse, Error, CreateOfferMutationInput>({
    mutationFn: ({ connectionId, idempotencyKey, request }) =>
      apiClient.listings.createOffer(connectionId, request, { idempotencyKey }),
    onSuccess: () => {
      // Invalidate only the listings list so a newly-active offer appears
      // on the list page. Scoped to `lists()` instead of `all` so the
      // in-flight `offerCreationStatus` polling query and the cached
      // seller-policies query are left alone.
      void queryClient.invalidateQueries({ queryKey: listingsQueryKeys.lists() });
    },
  });
}
