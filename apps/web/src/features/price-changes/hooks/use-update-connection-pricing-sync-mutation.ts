import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { connectionPricingSyncQueryKey } from './use-connection-pricing-sync-query';
import { priceChangesQueryKeys } from '../api/price-changes.query-keys';
import type { ConnectionPricingSyncView, UpdatePricingSyncInput } from '../api/pricing-sync.types';

export function useUpdateConnectionPricingSyncMutation(
  connectionId: string,
): UseMutationResult<ConnectionPricingSyncView, Error, UpdatePricingSyncInput> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) => apiClient.pricingSync.update(connectionId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: connectionPricingSyncQueryKey(connectionId) });
      // The default/per-source rule change affects future detection, and may
      // change what the review queue reports as "using the default rule".
      await queryClient.invalidateQueries({ queryKey: priceChangesQueryKeys.all });
    },
  });
}
