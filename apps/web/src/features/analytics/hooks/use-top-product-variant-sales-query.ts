/**
 * Top product variant sales query hook (#2765)
 *
 * Lazy by construction — `enabled` must be passed explicitly, mirroring the
 * products cockpit's own `ProductRowDetail` precedent (`useProductQuery`/
 * `useInventoryQuery`, "mounted only when a row is expanded... so its
 * queries fire lazily"). Never fetched for a collapsed row.
 *
 * @module features/analytics/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { topProductsQueryKeys } from '../api/top-products.query-keys';
import type { SalesAnalyticsFilters } from '../api/sales-analytics.types';
import type { TopProductVariantsResult } from '../api/top-products.types';

export function useTopProductVariantSalesQuery(
  productId: string,
  filters: SalesAnalyticsFilters,
  options: { enabled: boolean }
): UseQueryResult<TopProductVariantsResult> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: topProductsQueryKeys.variantSales(productId, filters),
    queryFn: () => apiClient.analytics.getTopProductVariantSales(productId, filters),
    enabled: options.enabled,
  });
}
