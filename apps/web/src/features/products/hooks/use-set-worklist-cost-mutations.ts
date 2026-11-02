/**
 * Cost writes from the work list (#3588, M30)
 *
 * Both refresh the coverage numbers and the product page's cost column, and
 * neither refetches the work-list ROWS: the saved row stays on screen as
 * "saved, counts from the next order" until the operator moves on.
 *
 * @module features/products/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { productsQueryKeys } from '../api/products.query-keys';
import type {
  BulkFillVariantCostInput,
  BulkFillVariantCostResult,
  VariantCost,
  VariantCostInput,
} from '../api/products.types';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ApiError } from '../../../shared/api/api-error';

function useRefreshCostReads(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: productsQueryKeys.costSummary });
    void queryClient.invalidateQueries({ queryKey: ['products', 'cost', 'coverage'] });
    void queryClient.invalidateQueries({ queryKey: ['products', 'cost', 'worklist-count'] });
    void queryClient.invalidateQueries({ queryKey: ['products', 'variant-costs'] });
  };
}

export interface SetWorklistCostVariables {
  variantId: string;
  input: VariantCostInput;
}

export function useSetWorklistCostMutation(): UseMutationResult<
  VariantCost,
  ApiError,
  SetWorklistCostVariables
> {
  const apiClient = useApiClient();
  const refresh = useRefreshCostReads();
  return useMutation<VariantCost, ApiError, SetWorklistCostVariables>({
    mutationFn: ({ variantId, input }) => apiClient.products.setVariantCost(variantId, input),
    onSuccess: refresh,
  });
}

export function useBulkFillCostMutation(): UseMutationResult<
  BulkFillVariantCostResult,
  ApiError,
  BulkFillVariantCostInput
> {
  const apiClient = useApiClient();
  const refresh = useRefreshCostReads();
  return useMutation<BulkFillVariantCostResult, ApiError, BulkFillVariantCostInput>({
    mutationFn: (input) => apiClient.products.bulkFillVariantCost(input),
    onSuccess: refresh,
  });
}
