import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { priceChangesQueryKeys } from '../api/price-changes.query-keys';
import type { AcceptPriceChangeInput, PriceChangeResolutionResult } from '../api/price-changes.types';

export function useAcceptPriceChangeMutation(): UseMutationResult<
  PriceChangeResolutionResult,
  Error,
  { id: string; input: AcceptPriceChangeInput }
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }) => apiClient.priceChanges.accept(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: priceChangesQueryKeys.all });
    },
  });
}
