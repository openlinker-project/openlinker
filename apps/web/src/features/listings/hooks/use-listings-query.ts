import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type {
  ListingsFilters,
  ListingsPagination,
  OfferMapping,
  PaginatedOfferMappings,
} from '../api/listings.types';
import type { RowsPage } from '../../../shared/api/paginated-total.types';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * The page WITHOUT its total or its lifecycle buckets (#2947). Pair with
 * `useListingsTotal`.
 *
 * `useListingsQuery` below still fetches everything in one call and is kept
 * for the callers that want it that way - the product drawer, the variant
 * stock table and the nav-count probe.
 */
export function useListingRowsQuery(
  filters?: ListingsFilters,
  pagination?: ListingsPagination,
): UseQueryResult<RowsPage<OfferMapping>> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: listingsQueryKeys.rows(filters, pagination),
    queryFn: () => apiClient.listings.listRows(filters, pagination),
    // A tab/search/page change is a distinct query key, so without this the
    // table blanks to a skeleton on every one of them (#2032 review thread
    // 12.5). Correct for ROWS; the total and the buckets deliberately do NOT
    // keep previous data - see `use-listings-total.ts`.
    placeholderData: keepPreviousData,
  });
}

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
