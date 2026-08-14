import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type {
  ListingsFilters,
  ListingsPagination,
  PaginatedOfferMappings,
} from '../api/listings.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useListingsQuery(
  filters?: ListingsFilters,
  pagination?: ListingsPagination
): UseQueryResult<PaginatedOfferMappings> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: listingsQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.listings.list(filters, pagination),
    // A tab/search/page change is a distinct query key, so without this the
    // table blanks to a skeleton on every one of them (#2032 review thread
    // 12.5) - this is TanStack's own documented remedy for that exact
    // symptom, and it is what let `listings-list-page.tsx` drop its
    // hand-rolled ref+fingerprint keep-alive for `lifecycleCounts`: `data`
    // (and therefore `data.lifecycleCounts`) now stays the previous page's
    // value for free until the new one resolves.
    placeholderData: keepPreviousData,
  });
}
