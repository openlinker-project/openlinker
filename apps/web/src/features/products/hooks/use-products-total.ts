/**
 * Products list - the two-stage total (#2947)
 *
 * `products` is searched with an `ILIKE` over name and SKU, so its `COUNT`
 * cannot stop early however small the page is. The rows come from
 * `useProductRowsQuery`; this fetches the number beside them.
 *
 * @module features/products/hooks
 */
import { productsQueryKeys } from '../api/products.query-keys';
import type { Product, ProductFilters } from '../api/products.types';
import type { RowsPage } from '../../../shared/api/paginated-total.types';
import {
  inferTotalFromLoadedPage,
  usePaginatedTotal,
  type PaginatedTotalResult,
} from '../../../shared/hooks/use-paginated-total';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * @param page the rows the list has already rendered. A SHORT page carries its
 *   own exact total, so the count is then never requested at all.
 *
 * Note the total is keyed on the filters ALONE - re-sorting the list reuses
 * the same count, because ordering cannot change how many rows match.
 */
export function useProductsTotal(
  filters: ProductFilters,
  page: RowsPage<Product> | undefined
): PaginatedTotalResult {
  const apiClient = useApiClient();

  return usePaginatedTotal({
    queryKey: productsQueryKeys.count(filters),
    queryFn: ({ signal }) => apiClient.products.count(filters, { signal }),
    selectTotal: (data) => data.total,
    knownTotal: inferTotalFromLoadedPage(page),
    enabled: page !== undefined,
  });
}
