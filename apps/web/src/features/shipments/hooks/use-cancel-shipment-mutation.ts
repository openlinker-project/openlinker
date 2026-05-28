/**
 * useCancelShipmentMutation
 *
 * Mutation hook for `POST /shipments/:id/cancel`. Destructive — call sites
 * gate it behind `<ConfirmDialog tone="danger">`. Invalidates the shipments
 * domain on success.
 *
 * @module apps/web/src/features/shipments/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { shipmentsQueryKeys } from '../api/shipments.query-keys';
import type { Shipment } from '../api/shipments.types';

export function useCancelShipmentMutation(): UseMutationResult<Shipment, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shipmentId) => apiClient.shipments.cancel(shipmentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: shipmentsQueryKeys.all });
    },
  });
}
