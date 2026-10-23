import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { priceChangesQueryKeys } from '../api/price-changes.query-keys';
import type { PriceChangeItem } from '../api/price-changes.types';

/**
 * Acknowledge a row's re-detection (`needsRefresh`) — the review queue's
 * per-row "Refresh" affordance (#3162's `POST /:id/refresh`). Clears the
 * marker server-side so the row's next read reports `needsRefresh: false`;
 * this is the row's only remedy, since `needsRefresh` is otherwise sticky
 * forever once set (#3164 review).
 */
export function useRefreshPriceChangeMutation(): UseMutationResult<PriceChangeItem, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.priceChanges.refresh(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: priceChangesQueryKeys.all });
    },
  });
}
