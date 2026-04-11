/**
 * use-update-offer-fields
 *
 * Mutation hook for dispatching an async offer field update job.
 * Returns 202 Accepted with a job ID — does not optimistically update listing data.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useMutation } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { UpdateOfferFieldsPayload, UpdateOfferFieldsResult } from '../api/listings.types';

interface UpdateOfferFieldsInput {
  connectionId: string;
  offerId: string;
  fields: UpdateOfferFieldsPayload;
}

export function useUpdateOfferFields() {
  const apiClient = useApiClient();

  return useMutation<UpdateOfferFieldsResult, Error, UpdateOfferFieldsInput>({
    mutationFn: ({ connectionId, offerId, fields }) =>
      apiClient.listings.updateOfferFields(connectionId, offerId, fields),
  });
}
