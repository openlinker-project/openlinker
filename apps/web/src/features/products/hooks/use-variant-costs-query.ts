/**
 * useVariantCostsQuery - net unit costs of a product's variants (#3588).
 *
 * Cost is not on the regular variant read (that route is open to every role),
 * so the product page asks for it separately. Rows, table cards and the
 * single-variant panel all call this with the same product id and share one
 * cached request.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { productsQueryKeys } from '../api/products.query-keys';
import type { VariantCost } from '../api/products.types';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ApiError } from '../../../shared/api/api-error';

export function useVariantCostsQuery(
  productId: string | undefined
): UseQueryResult<VariantCost[], ApiError> {
  const apiClient = useApiClient();

  return useQuery<VariantCost[], ApiError>({
    queryKey: productsQueryKeys.variantCosts(productId ?? ''),
    queryFn: () => apiClient.products.getVariantCosts(productId ?? ''),
    enabled: Boolean(productId),
    retry: false,
    staleTime: 30_000,
  });
}
