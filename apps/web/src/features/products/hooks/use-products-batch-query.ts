/**
 * use-products-batch-query
 *
 * Parallel hydration of N product details by ID. Used by the bulk-listing
 * wizard (#740) to load every selected product (and its variants) in one
 * shot at page mount. Returns N `UseQueryResult<Product>` entries — caller
 * pivots over `isLoading` / `error` / `data` per index.
 *
 * Each query reuses TanStack's existing cache, so products already viewed
 * via `useProductQuery` are served instantly.
 *
 * @module apps/web/src/features/products/hooks
 */
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { productsQueryKeys } from '../api/products.query-keys';
import type { Product } from '../api/products.types';

export function useProductsBatchQuery(
  ids: readonly string[],
  options?: { enabled?: boolean },
): UseQueryResult<Product>[] {
  const apiClient = useApiClient();
  const enabled = options?.enabled ?? true;

  return useQueries({
    queries: ids.map((id) => ({
      queryKey: productsQueryKeys.detail(id),
      queryFn: () => apiClient.products.getById(id),
      enabled,
    })),
  });
}
