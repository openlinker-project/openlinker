/**
 * useBootstrapLocationsMutation
 *
 * Mints the first-run inventory location an operator was offered (#2407).
 *
 * Invalidates `locationsAll()` on success — the same prefix the #3065 CRUD
 * mutations use — rather than only `activeLocations()`. Narrower
 * invalidation was correct while the only consumer was the connection-detail
 * readiness panel (which reads only the active count), but the #3066
 * locations list page reads `locations()` under the same prefix, and a
 * bootstrap that invalidated just `activeLocations()` left that list stale
 * until a full page reload — the click looked like it did nothing. The
 * route is idempotent either way, so re-reading after a re-run that created
 * nothing is still the correct, cheap thing to do.
 *
 * @module apps/web/src/features/inventory/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import type { LocationBootstrapResult } from '../api/inventory-locations.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useBootstrapLocationsMutation(): UseMutationResult<
  LocationBootstrapResult,
  Error,
  void
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.inventory.bootstrapLocations(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.locationsAll() });
    },
  });
}
