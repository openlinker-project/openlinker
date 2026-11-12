import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ShopifyLocation } from '../api/shopify.api';
import { shopifyQueryKeys } from '../api/shopify.query-keys';

/**
 * The store's active locations, read live from Shopify (#3982). No retry: a
 * store that cannot be reached falls back to typing the id, not to a loop.
 */
export function useShopifyLocationsQuery(
  connectionId: string,
  options?: { enabled?: boolean },
): UseQueryResult<ShopifyLocation[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: shopifyQueryKeys.locations(connectionId),
    queryFn: () => apiClient.shopify.listLocations(connectionId),
    enabled: (options?.enabled ?? true) && connectionId.length > 0,
    retry: false,
  });
}
