/**
 * useUpdateInventoryLocationMutation (#2316 / #3065)
 *
 * Same `locationsAll()` invalidation reasoning as the create mutation — a
 * patch can move `status` (so `activeLocations` may change) and any filtered
 * list can gain or lose the row, so a narrower invalidation targeting only
 * `locationDetail(id)` would leave stale list entries behind.
 *
 * @module apps/web/src/features/inventory/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import type { InventoryLocation, UpdateInventoryLocationInput } from '../api/inventory-locations.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export interface UpdateInventoryLocationMutationInput {
  id: string;
  patch: UpdateInventoryLocationInput;
}

export function useUpdateInventoryLocationMutation(): UseMutationResult<
  InventoryLocation,
  Error,
  UpdateInventoryLocationMutationInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }) => apiClient.inventory.updateLocation(id, patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.locationsAll() });
    },
  });
}
