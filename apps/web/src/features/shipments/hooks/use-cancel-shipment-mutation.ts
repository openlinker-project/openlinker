/**
 * useCancelShipmentMutation
 *
 * Mutation hook for `POST /shipments/:id/cancel`. Destructive — call sites
 * gate it behind `<ConfirmDialog tone="danger">`. Invalidates the shipments
 * domain on success AND on failure: a 409 means the row on screen is stale,
 * and a timeout may have cancelled the shipment after all, so the panel must
 * re-read it either way.
 *
 * @module apps/web/src/features/shipments/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { shipmentsQueryKeys } from '../api/shipments.query-keys';
import type { CancelShipmentResult } from '../api/shipments.types';

export function useCancelShipmentMutation(): UseMutationResult<
  CancelShipmentResult,
  Error,
  string
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shipmentId) => apiClient.shipments.cancel(shipmentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: shipmentsQueryKeys.all });
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey: shipmentsQueryKeys.all });
    },
  });
}
