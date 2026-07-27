/**
 * use-delivery-price-lists-query (#1530)
 *
 * Fetches the delivery price lists ("cennik dostawy") configured on a
 * marketplace connection, fetched live from the marketplace. Backs the
 * delivery-price-list picker in the offer-creation wizard (single + bulk).
 * Server caches per connection for ~10 minutes; a 5-minute client-side
 * staleTime keeps repeated wizard opens within a session from re-fetching.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { DeliveryPriceListsResponse } from '../api/listings.types';

export const DELIVERY_PRICE_LISTS_STALE_TIME_MS = 5 * 60 * 1000;

export function useDeliveryPriceListsQuery(
  connectionId: string,
): UseQueryResult<DeliveryPriceListsResponse> {
  const apiClient = useApiClient();

  return useQuery<DeliveryPriceListsResponse>({
    queryKey: listingsQueryKeys.deliveryPriceLists(connectionId),
    queryFn: () => apiClient.listings.getDeliveryPriceLists(connectionId),
    enabled: Boolean(connectionId),
    staleTime: DELIVERY_PRICE_LISTS_STALE_TIME_MS,
  });
}
