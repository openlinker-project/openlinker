import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { productsQueryKeys } from '../api/products.query-keys';
import type { PaginatedProducts, ProductFilters, ProductPagination } from '../api/products.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useProductsQuery(
  filters?: ProductFilters,
  pagination?: ProductPagination,
): UseQueryResult<PaginatedProducts> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: productsQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.products.list(filters, pagination),
    retry: false,
  });
}
