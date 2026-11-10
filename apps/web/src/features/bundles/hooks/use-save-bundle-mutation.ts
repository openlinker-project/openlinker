/**
 * Create or update a bundle definition (#3624). A create can also release the
 * orders that were waiting for a multipack bundle, so it invalidates the orders
 * and products reads; an update changes availability and history.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { bundlesQueryKeys } from '../api/bundles.query-keys';
import type { BundleComponentInput, BundleCreated } from '../api/bundles.types';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ApiError } from '../../../shared/api/api-error';

export interface SaveBundleVariables {
  variantId: string;
  components: BundleComponentInput[];
  /** `true` writes the next version of an existing bundle. */
  existing: boolean;
}

export function useSaveBundleMutation(): UseMutationResult<
  BundleCreated,
  ApiError,
  SaveBundleVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<BundleCreated, ApiError, SaveBundleVariables>({
    mutationFn: async ({ variantId, components, existing }) =>
      existing
        ? { ...(await apiClient.bundles.update(variantId, components)), releasedOrders: 0 }
        : apiClient.bundles.create(variantId, components),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: bundlesQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: bundlesQueryKeys.detail(variables.variantId) });
    },
  });
}
