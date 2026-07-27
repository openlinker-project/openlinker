/**
 * use-shop-attribute-terms-query (#1835)
 *
 * Lazily loads the predefined terms of one global attribute, for the second step
 * of the structured attribute picker (choose an attribute, then pick its terms).
 * Backed by the shop `ShopAttributeReader` capability; only fetches once an
 * attribute is selected.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { ShopAttributeTerm } from '../api/listings.types';

export const SHOP_ATTRIBUTE_TERMS_STALE_TIME_MS = 60 * 60 * 1000;

export function useShopAttributeTermsQuery(
  connectionId: string,
  attributeId: string | null,
  enabled = true,
): UseQueryResult<ShopAttributeTerm[]> {
  const apiClient = useApiClient();

  return useQuery<ShopAttributeTerm[]>({
    queryKey: listingsQueryKeys.shopAttributeTerms(connectionId, attributeId ?? ''),
    queryFn: () => apiClient.listings.listShopAttributeTerms(connectionId, attributeId as string),
    enabled: enabled && Boolean(connectionId) && Boolean(attributeId),
    staleTime: SHOP_ATTRIBUTE_TERMS_STALE_TIME_MS,
  });
}
