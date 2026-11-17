/**
 * use-product-sale-status-query
 *
 * Where a product is on sale, per channel, after it was deleted at the
 * source (#3962). Read from what OpenLinker already holds - no channel call.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { ProductSaleStatusResponse } from '../api/listings.types';

const SALE_STATUS_STALE_MS = 30_000;

export function useProductSaleStatusQuery(
  productId: string,
  options?: { enabled?: boolean },
): UseQueryResult<ProductSaleStatusResponse> {
  const apiClient = useApiClient();
  return useQuery<ProductSaleStatusResponse>({
    queryKey: listingsQueryKeys.productSaleStatus(productId),
    queryFn: () => apiClient.listings.getProductSaleStatus(productId),
    enabled: (options?.enabled ?? true) && Boolean(productId),
    staleTime: SALE_STATUS_STALE_MS,
  });
}
