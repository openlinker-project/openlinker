/**
 * useBootstrapLocationsMutation
 *
 * Mints the first-run inventory location an operator was offered (#2407).
 *
 * Invalidates the active-location count on success, so the readiness surface
 * re-reads the fact rather than assuming the write moved it — the route is
 * idempotent and a re-run legitimately creates nothing.
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
      await queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.activeLocations() });
    },
  });
}
