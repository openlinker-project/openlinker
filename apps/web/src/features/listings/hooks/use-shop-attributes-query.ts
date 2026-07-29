/**
 * use-shop-attributes-query (#1835)
 *
 * Loads a shop destination's store-wide global product attributes for the
 * publish edit flow's structured attribute picker. Backed by the shop
 * `ShopAttributeReader` capability (WooCommerce today).
 *
 * Global attributes change infrequently; a 1-hour staleTime keeps the picker
 * from re-fetching within a session.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { ShopAttribute } from '../api/listings.types';

export const SHOP_ATTRIBUTES_STALE_TIME_MS = 60 * 60 * 1000;

export function useShopAttributesQuery(
  connectionId: string,
  enabled = true,
): UseQueryResult<ShopAttribute[]> {
  const apiClient = useApiClient();

  return useQuery<ShopAttribute[]>({
    queryKey: listingsQueryKeys.shopAttributes(connectionId),
    queryFn: () => apiClient.listings.listShopAttributes(connectionId),
    enabled: enabled && Boolean(connectionId),
    staleTime: SHOP_ATTRIBUTES_STALE_TIME_MS,
  });
}
