import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { priceChangesQueryKeys } from '../api/price-changes.query-keys';
import type { ListPriceChangesFilters, PriceChangeListResponse } from '../api/price-changes.types';

export function usePriceChangesQuery(
  filters?: ListPriceChangesFilters,
): UseQueryResult<PriceChangeListResponse> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: priceChangesQueryKeys.list(filters),
    queryFn: () => apiClient.priceChanges.list(filters),
    placeholderData: keepPreviousData,
    // The review queue is a small, actively-decided working set - keep it
    // fresh rather than trusting a longer default staleTime, since a
    // teammate accepting/ignoring a row elsewhere should be reflected soon.
    refetchInterval: 30_000,
  });
}
