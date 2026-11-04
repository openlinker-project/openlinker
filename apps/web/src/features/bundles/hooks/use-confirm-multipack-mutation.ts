/**
 * Confirm a held multipack (#3624): "one sale of this offer = N x product".
 * Held orders continue, so the order reads are invalidated.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { MultipackConfirmed } from '../api/bundles.types';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ApiError } from '../../../shared/api/api-error';

export interface ConfirmMultipackVariables {
  variantId: string;
  packQuantity: number;
}

export function useConfirmMultipackMutation(): UseMutationResult<
  MultipackConfirmed,
  ApiError,
  ConfirmMultipackVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<MultipackConfirmed, ApiError, ConfirmMultipackVariables>({
    mutationFn: ({ variantId, packQuantity }) =>
      apiClient.bundles.confirmMultipack(variantId, packQuantity),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}
