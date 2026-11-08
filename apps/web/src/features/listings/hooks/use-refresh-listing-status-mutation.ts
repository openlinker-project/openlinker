/**
 * useRefreshListingStatusMutation (#4046)
 *
 * "Check status" from the listings peek: re-reads one offer's live status on
 * its channel (`POST .../refresh-status`, #1760) and refreshes the listings
 * reads, so the row, the tabs and the peek show the new reading.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { OfferMapping, RefreshOfferPublicationStatusResponse } from '../api/listings.types';

export function useRefreshListingStatusMutation(): UseMutationResult<
  RefreshOfferPublicationStatusResponse,
  Error,
  OfferMapping
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (row: OfferMapping) =>
      apiClient.listings.refreshOfferPublicationStatus(row.connectionId, row.externalId, row.internalId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: listingsQueryKeys.all });
    },
  });
}
