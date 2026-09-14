/**
 * useCreateInventoryLocationMutation (#2316 / #3065)
 *
 * Invalidates `locationsAll()` rather than a single list key: the write can
 * change what any filtered/paginated list returns and also the install-wide
 * `activeLocations` count (a fresh location defaults to `active`), so every
 * cache entry under the `['inventory', 'locations']` prefix has to move.
 *
 * @module apps/web/src/features/inventory/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import type { CreateInventoryLocationInput, InventoryLocation } from '../api/inventory-locations.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useCreateInventoryLocationMutation(): UseMutationResult<
  InventoryLocation,
  Error,
  CreateInventoryLocationInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) => apiClient.inventory.createLocation(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.locationsAll() });
    },
  });
}
