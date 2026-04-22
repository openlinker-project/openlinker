import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { listingsQueryKeys } from '../api/listings.query-keys';
import { TERMINAL_OFFER_CREATION_STATUSES, type OfferMapping } from '../api/listings.types';
import { useApiClient } from '../../../app/api/api-client-provider';

const OFFER_CREATION_POLL_MS = 5000;

export function useListingQuery(id: string): UseQueryResult<OfferMapping> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: listingsQueryKeys.detail(id),
    queryFn: () => apiClient.listings.getById(id),
    enabled: id.length > 0,
    // Poll the detail while a non-terminal offer-creation is attached.
    // Stops automatically once `status` reaches `active` or `failed`, or
    // when the record is absent (non-Offer entity / synced-in offer).
    refetchInterval: (query) => {
      const status = query.state.data?.offerCreation?.status;
      if (!status) return false;
      return TERMINAL_OFFER_CREATION_STATUSES.includes(status) ? false : OFFER_CREATION_POLL_MS;
    },
  });
}
