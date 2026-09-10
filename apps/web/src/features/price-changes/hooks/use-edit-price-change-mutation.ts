import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { priceChangesQueryKeys } from '../api/price-changes.query-keys';
import type { EditPriceChangeInput } from '../api/price-changes.types';

export function useEditPriceChangeMutation(): UseMutationResult<
  void,
  Error,
  { id: string; input: EditPriceChangeInput }
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }) => apiClient.priceChanges.edit(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: priceChangesQueryKeys.all });
    },
  });
}
