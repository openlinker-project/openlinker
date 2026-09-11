import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { priceChangesQueryKeys } from '../api/price-changes.query-keys';
import type { ListPriceChangesFilters, PriceChangeListResponse } from '../api/price-changes.types';

export interface UsePriceChangesQueryOptions {
  /** Defaults to `true`. */
  enabled?: boolean;
  /**
   * Defaults to 30s. Pass `false` to fetch once (respecting the ordinary
   * cache/staleTime lifecycle, window-focus refetch, etc.) without a
   * standing background poll (#3164 review — this was the only
   * unconditional numeric `refetchInterval` in `apps/web`; the Listings
   * page's tab badge reads this query on EVERY visit to `/listings`,
   * including the default "all listings" tab, so passing `30_000`
   * unconditionally there started a 30s poll of an unbounded, opt-in,
   * default-off feature's endpoint regardless of which tab was on
   * screen).
   */
  refetchIntervalMs?: number | false;
}

export function usePriceChangesQuery(
  filters?: ListPriceChangesFilters,
  options?: UsePriceChangesQueryOptions,
): UseQueryResult<PriceChangeListResponse> {
  const apiClient = useApiClient();
  const enabled = options?.enabled ?? true;
  const refetchInterval = options?.refetchIntervalMs ?? 30_000;

  return useQuery({
    queryKey: priceChangesQueryKeys.list(filters),
    queryFn: () => apiClient.priceChanges.list(filters),
    placeholderData: keepPreviousData,
    enabled,
    // The review queue is a small, actively-decided working set - keep it
    // fresh rather than trusting a longer default staleTime, since a
    // teammate accepting/ignoring a row elsewhere should be reflected soon.
    refetchInterval,
  });
}
