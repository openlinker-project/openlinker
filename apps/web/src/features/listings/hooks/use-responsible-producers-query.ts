/**
 * use-responsible-producers-query (#1531)
 *
 * Fetches the EU GPSR responsible producers ("producent") configured on a
 * marketplace connection, fetched live from the marketplace. Backs the producer
 * picker in the offer-creation wizard (single + bulk). Server caches per
 * connection for ~10 minutes; a 5-minute client-side staleTime keeps repeated
 * wizard opens within a session from re-fetching.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { ResponsibleProducersResponse } from '../api/listings.types';

export const RESPONSIBLE_PRODUCERS_STALE_TIME_MS = 5 * 60 * 1000;

export function useResponsibleProducersQuery(
  connectionId: string,
): UseQueryResult<ResponsibleProducersResponse> {
  const apiClient = useApiClient();

  return useQuery<ResponsibleProducersResponse>({
    queryKey: listingsQueryKeys.responsibleProducers(connectionId),
    queryFn: () => apiClient.listings.getResponsibleProducers(connectionId),
    enabled: Boolean(connectionId),
    staleTime: RESPONSIBLE_PRODUCERS_STALE_TIME_MS,
  });
}
