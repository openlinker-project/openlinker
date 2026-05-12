/**
 * use-catalog-product-query
 *
 * Fetches a single marketplace catalog product by id (#633/#635). Triggered
 * by the CreateOfferWizard after the operator picks one of an ambiguous
 * match — the picker only has summaries, so this fills in parameters/images.
 *
 * `retry: false` — failures are silent; the panel collapses to a `Skip`
 * affordance and the form behaves as `no_match`.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { CatalogProduct } from '../api/listings.types';

/** 5 minutes — same cadence as the match query; BE caches 24h. */
export const CATALOG_PRODUCT_STALE_TIME_MS = 5 * 60 * 1000;

export function useCatalogProductQuery(
  connectionId: string | undefined,
  productId: string | undefined,
): UseQueryResult<CatalogProduct> {
  const apiClient = useApiClient();

  return useQuery<CatalogProduct>({
    queryKey: listingsQueryKeys.catalogProduct(connectionId ?? '', productId ?? ''),
    queryFn: () =>
      apiClient.listings.getCatalogProduct(connectionId as string, productId as string),
    enabled: Boolean(connectionId && productId),
    staleTime: CATALOG_PRODUCT_STALE_TIME_MS,
    retry: false,
  });
}
