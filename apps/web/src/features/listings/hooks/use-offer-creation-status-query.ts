/**
 * use-offer-creation-status-query
 *
 * Polls the OfferCreationRecord status endpoint on a 5-second interval
 * until the record reaches a terminal status (`active` or `failed`).
 * On terminal status the interval is set to `false` and TanStack Query
 * stops polling.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import {
  TERMINAL_OFFER_CREATION_STATUSES,
  type OfferCreationStatusResponse,
} from '../api/listings.types';

export const OFFER_CREATION_POLL_INTERVAL_MS = 5_000;

export function useOfferCreationStatusQuery(
  connectionId: string,
  offerCreationRecordId: string,
): UseQueryResult<OfferCreationStatusResponse> {
  const apiClient = useApiClient();

  return useQuery<OfferCreationStatusResponse>({
    queryKey: listingsQueryKeys.offerCreationStatus(connectionId, offerCreationRecordId),
    queryFn: () => apiClient.listings.getOfferCreationStatus(connectionId, offerCreationRecordId),
    enabled: Boolean(connectionId && offerCreationRecordId),
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && TERMINAL_OFFER_CREATION_STATUSES.includes(status)) {
        return false;
      }
      return OFFER_CREATION_POLL_INTERVAL_MS;
    },
  });
}
