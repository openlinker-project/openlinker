/**
 * Buyer Data Age Histogram (#4289)
 *
 * Orders of the scope bucketed by whole months of age and by what the
 * retention job already did to them. The strip draws it; it never decides
 * anything, so a failure only hides the strip.
 *
 * @module apps/web/src/features/buyer-data/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { buyerDataQueryKeys } from '../api/buyer-data.query-keys';
import type { BuyerDataAgeHistogram } from '../api/buyer-data.types';

export function useBuyerDataAgeHistogram(
  connectionId: string | undefined,
  options: { enabled?: boolean } = {}
): UseQueryResult<BuyerDataAgeHistogram, Error> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: buyerDataQueryKeys.histogram(connectionId),
    queryFn: ({ signal }) => apiClient.buyerData.ageHistogram(connectionId, signal),
    enabled: options.enabled ?? true,
    staleTime: 60_000,
  });
}
