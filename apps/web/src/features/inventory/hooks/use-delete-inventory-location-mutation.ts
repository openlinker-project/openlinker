/**
 * useDeleteInventoryLocationMutation (#2316 / #3065)
 *
 * The backend refuses with a 409 (`ApiError.isConflict()`) while any
 * `inventory_items` row still references the location — that check and the
 * "retire instead" recovery flow belong to the delete-confirm dialog (#3068),
 * this hook only issues the request and reports the mutation's own error.
 *
 * @module apps/web/src/features/inventory/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useDeleteInventoryLocationMutation(): UseMutationResult<void, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.inventory.deleteLocation(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.locationsAll() });
    },
  });
}
