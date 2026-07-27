/**
 * use-shop-categories-query (#1834)
 *
 * Lazily loads a shop destination's category tree, one parent level at a time,
 * for the publish edit flow's category picker. Backed by the shop
 * `ShopCategoryBrowser` capability (WooCommerce today). The shop-side analogue
 * of `useAllegroCategoriesQuery` — but every node is a valid placement target
 * (no leaf gate), so the picker allows Select on any node.
 *
 * Categories change infrequently; a 1-hour staleTime keeps drill-downs within a
 * session from re-fetching.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { ShopCategory } from '../api/listings.types';

export const SHOP_CATEGORIES_STALE_TIME_MS = 60 * 60 * 1000;

export function useShopCategoriesQuery(
  connectionId: string,
  parentId?: string,
  enabled = true,
): UseQueryResult<ShopCategory[]> {
  const apiClient = useApiClient();

  return useQuery<ShopCategory[]>({
    queryKey: listingsQueryKeys.shopCategories(connectionId, parentId),
    queryFn: () => apiClient.listings.browseShopCategories(connectionId, parentId),
    enabled: enabled && Boolean(connectionId),
    staleTime: SHOP_CATEGORIES_STALE_TIME_MS,
  });
}
