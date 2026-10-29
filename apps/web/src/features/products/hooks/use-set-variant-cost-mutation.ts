/**
 * Record or clear one variant's net cost (#3588). Admin-only on the API.
 *
 * Invalidates the product's variant-costs read so every rendering of the cost
 * (column, card, drawer) updates from one refetch.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { productsQueryKeys } from '../api/products.query-keys';
import type { VariantCost, VariantCostInput } from '../api/products.types';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ApiError } from '../../../shared/api/api-error';

export interface SetVariantCostVariables {
  variantId: string;
  input: VariantCostInput;
}

export function useSetVariantCostMutation(
  productId: string
): UseMutationResult<VariantCost, ApiError, SetVariantCostVariables> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<VariantCost, ApiError, SetVariantCostVariables>({
    mutationFn: ({ variantId, input }) => apiClient.products.setVariantCost(variantId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productsQueryKeys.variantCosts(productId) });
    },
  });
}
