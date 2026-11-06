/**
 * useProductCountProbes (#4027)
 *
 * A count for each of a variable number of filter sets (one per source
 * connection, one per marketplace), each a `limit: 1` list probe - the same
 * request and cache key `useProductsQuery(filters, { limit: 1 })` makes, so a
 * probe the page also runs on its own is not fetched twice.
 *
 * A count is `undefined` while its probe loads or after it fails; callers
 * render that as unknown, never as 0.
 *
 * @module apps/web/src/features/products/hooks
 */
import { useQueries } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { productsQueryKeys } from '../api/products.query-keys';
import type { ProductFilters } from '../api/products.types';

const PROBE = { limit: 1 } as const;

export function useProductCountProbes(
  filterSets: readonly ProductFilters[],
  options?: { enabled?: boolean },
): (number | undefined)[] {
  const apiClient = useApiClient();
  return useQueries({
    queries: filterSets.map((filters) => ({
      queryKey: productsQueryKeys.list(filters, PROBE),
      queryFn: () => apiClient.products.list(filters, PROBE),
      enabled: options?.enabled ?? true,
    })),
    combine: (results) => results.map((r) => r.data?.total),
  });
}
