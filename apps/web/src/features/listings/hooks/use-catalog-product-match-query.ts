/**
 * use-catalog-product-match-query
 *
 * Looks up marketplace catalog products by barcode (#633/#635). Runs in the
 * CreateOfferWizard after a variant + category are picked, to silently
 * prefill product-section parameters from the Allegro catalog match.
 *
 * Failures are silent — `retry: false`, and the consumer renders nothing on
 * error so the form stays submittable manually.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { CatalogProductMatchResult } from '../api/listings.types';

/** 5 minutes — catalog data is slow-moving and the BE caches upstream for 24h. */
export const CATALOG_PRODUCT_MATCH_STALE_TIME_MS = 5 * 60 * 1000;

export function useCatalogProductMatchQuery(
  connectionId: string | undefined,
  barcode: string | undefined,
  categoryId: string | undefined,
): UseQueryResult<CatalogProductMatchResult> {
  const apiClient = useApiClient();

  return useQuery<CatalogProductMatchResult>({
    queryKey: listingsQueryKeys.catalogProductMatch(
      connectionId ?? '',
      barcode ?? '',
      categoryId ?? '',
    ),
    queryFn: () =>
      apiClient.listings.findProductsByBarcode(connectionId as string, {
        barcode: barcode as string,
        categoryId: categoryId as string,
      }),
    enabled: Boolean(connectionId && barcode && categoryId),
    staleTime: CATALOG_PRODUCT_MATCH_STALE_TIME_MS,
    retry: false,
  });
}
