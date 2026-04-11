import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { productsQueryKeys } from '../api/products.query-keys';
import type { Product } from '../api/products.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useProductQuery(id: string): UseQueryResult<Product> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: productsQueryKeys.detail(id),
    queryFn: () => apiClient.products.getById(id),
    enabled: Boolean(id),
    retry: false,
  });
}
