/**
 * useProductCountProbes (#4027)
 *
 * The products cockpit shows a count beside many filter sets at once: the
 * stock tabs, the "Needs a look" groups, one per source connection and one
 * per marketplace. Each count goes through `GET /products/count` under
 * `productsQueryKeys.count(filters)` - the same path and key `useProductsTotal`
 * uses (#2947) - and never through a `limit: 1` list read, because the count
 * under the name / SKU `ILIKE` cannot stop early and a list read would fetch
 * rows nobody renders on top of it. Sharing the count key also means the
 * "All products" tab and the unfiltered results count are one request, not
 * two, and a list invalidation (which targets the `list` / `rows` keys) does
 * not refire every probe.
 *
 * There is no batched count endpoint, so the cost is still one request per
 * filter set. What keeps it bounded is the shared cache plus a `staleTime`:
 * these are glance numbers, so coming back to the page within the window
 * re-uses them instead of re-running every aggregate.
 *
 * A count is `undefined` while its probe loads, while it is disabled, or after
 * it fails; callers render that as unknown, never as 0.
 *
 * @module apps/web/src/features/products/hooks
 */
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { productsQueryKeys } from '../api/products.query-keys';
import type { ProductFilters } from '../api/products.types';
import type { PaginatedTotal } from '../../../shared/api/paginated-total.types';

/**
 * How long a probe count is reused before a remount refetches it. Long enough
 * that tab-hopping back to the products page does not re-run every count, short
 * enough that a stock sync shows up on the next visit.
 */
export const PRODUCT_COUNT_PROBE_STALE_TIME_MS = 60_000;

export interface ProductCountProbe {
  /** `undefined` counts the whole catalogue. */
  filters: ProductFilters | undefined;
  /**
   * Gate for a probe whose filter would be meaningless (e.g. listing gaps with
   * no marketplace connection) - a disabled probe is never requested.
   */
  enabled?: boolean;
}

// Module-level so TanStack can keep the combined array referentially stable
// between renders; an inline combine would hand callers a new array each time
// and churn every memo keyed on it.
function combineCounts(results: UseQueryResult<PaginatedTotal>[]): (number | undefined)[] {
  return results.map((r) => r.data?.total);
}

export function useProductCountProbes(
  probes: readonly ProductCountProbe[],
): (number | undefined)[] {
  const apiClient = useApiClient();
  return useQueries({
    queries: probes.map(({ filters, enabled }) => ({
      queryKey: productsQueryKeys.count(filters),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiClient.products.count(filters, { signal }),
      enabled: enabled ?? true,
      staleTime: PRODUCT_COUNT_PROBE_STALE_TIME_MS,
    })),
    combine: combineCounts,
  });
}
