/**
 * Sync a bundle's composition from its product master (#3932). The result is a
 * NEW version, so the same reads a save invalidates are invalidated here; it
 * never runs unless the operator clicks.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { bundlesQueryKeys } from '../api/bundles.query-keys';
import type { BundleDefinition } from '../api/bundles.types';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ApiError } from '../../../shared/api/api-error';

export function useSyncBundleFromMasterMutation(): UseMutationResult<
  BundleDefinition,
  ApiError,
  string
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<BundleDefinition, ApiError, string>({
    mutationFn: (variantId) => apiClient.bundles.syncFromMaster(variantId),
    onSuccess: (_result, variantId) => {
      void queryClient.invalidateQueries({ queryKey: bundlesQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: bundlesQueryKeys.detail(variantId) });
    },
  });
}
