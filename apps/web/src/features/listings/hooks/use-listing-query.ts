import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { OfferMapping } from '../api/listings.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useListingQuery(id: string): UseQueryResult<OfferMapping> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: listingsQueryKeys.detail(id),
    queryFn: () => apiClient.listings.getById(id),
    enabled: id.length > 0,
    retry: false,
  });
}
