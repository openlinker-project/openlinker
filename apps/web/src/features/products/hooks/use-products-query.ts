import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { productsQueryKeys } from '../api/products.query-keys';
import type {
  PaginatedProducts,
  Product,
  ProductFilters,
  ProductListSort,
  ProductPagination,
} from '../api/products.types';
import type { RowsPage } from '../../../shared/api/paginated-total.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export interface UseProductsQueryOptions {
  /**
   * Gate for probe-style callers (#1720): the cockpit's "Listing gaps" KPI
   * probe is meaningless with zero OfferCreator connections, so it disables
   * itself instead of firing an empty-filter query.
   */
  enabled?: boolean;
}

/**
 * The page WITHOUT its total (#2947). Pair with `useProductsTotal`.
 *
 * `useProductsQuery` below still fetches both in one call and is kept for the
 * KPI probes, the offer-creation wizards' product search and every other
 * caller that genuinely wants them together.
 */
export function useProductRowsQuery(
  filters?: ProductFilters,
  pagination?: ProductPagination,
  sort?: ProductListSort,
  options?: UseProductsQueryOptions,
): UseQueryResult<RowsPage<Product>> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: productsQueryKeys.rows(filters, pagination, sort),
    queryFn: () =>
      sort
        ? apiClient.products.listRows(filters, pagination, sort)
        : apiClient.products.listRows(filters, pagination),
    enabled: options?.enabled ?? true,
  });
}

export function useProductsQuery(
  filters?: ProductFilters,
  pagination?: ProductPagination,
  sort?: ProductListSort,
  options?: UseProductsQueryOptions,
): UseQueryResult<PaginatedProducts> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: productsQueryKeys.list(filters, pagination, sort),
    // Only pass `sort` through when the caller actually provided one — keeps
    // the call shape unchanged (2 args) for existing consumers that don't
    // sort, e.g. the Allegro/WooCommerce offer-creation wizards' product
    // search (#1720).
    queryFn: () => (sort ? apiClient.products.list(filters, pagination, sort) : apiClient.products.list(filters, pagination)),
    enabled: options?.enabled ?? true,
  });
}
