import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { ListingsFilters, ListingsPagination, PaginatedOfferMappings } from '../api/listings.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useListingsQuery(
  filters?: ListingsFilters,
  pagination?: ListingsPagination,
): UseQueryResult<PaginatedOfferMappings> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: listingsQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.listings.list(filters, pagination),
    retry: false,
  });
}
