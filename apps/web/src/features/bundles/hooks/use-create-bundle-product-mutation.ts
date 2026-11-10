/**
 * Create the product a new bundle is sold as, at a product master (#3935).
 * The new product reaches OpenLinker through the master sync inside the call,
 * so the products reads are stale afterwards.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ApiError } from '../../../shared/api/api-error';
import type { CreateBundleProductInput, CreatedBundleProduct } from '../api/bundles.types';

export function useCreateBundleProductMutation(): UseMutationResult<
  CreatedBundleProduct,
  ApiError,
  CreateBundleProductInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<CreatedBundleProduct, ApiError, CreateBundleProductInput>({
    mutationFn: (input) => apiClient.bundles.createProduct(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
