import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { priceChangesQueryKeys } from '../api/price-changes.query-keys';
import type { BulkAcceptPriceChangeItem, BulkAcceptPriceChangesResponse } from '../api/price-changes.types';

export function useBulkAcceptPriceChangesMutation(): UseMutationResult<
  BulkAcceptPriceChangesResponse,
  Error,
  BulkAcceptPriceChangeItem[]
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (items) => apiClient.priceChanges.bulkAccept(items),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: priceChangesQueryKeys.all });
    },
  });
}
