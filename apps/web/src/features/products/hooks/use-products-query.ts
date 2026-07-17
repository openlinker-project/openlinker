import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { productsQueryKeys } from '../api/products.query-keys';
import type {
  PaginatedProducts,
  ProductFilters,
  ProductListSort,
  ProductPagination,
} from '../api/products.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export interface UseProductsQueryOptions {
  /**
   * Gate for probe-style callers (#1720): the cockpit's "Listing gaps" KPI
   * probe is meaningless with zero OfferCreator connections, so it disables
   * itself instead of firing an empty-filter query.
   */
  enabled?: boolean;
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
