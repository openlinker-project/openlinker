/**
 * useMovementPushesQuery (#4063)
 *
 * What OpenLinker sent each channel for one stock movement, read when the
 * movement's detail panel opens. Disabled for an empty id, so a closed panel
 * sends nothing.
 *
 * @module apps/web/src/features/inventory/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import type { ChannelQuantityPushes } from '../api/inventory-movements.types';

export function useMovementPushesQuery(movementId: string | null): UseQueryResult<ChannelQuantityPushes> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: inventoryQueryKeys.movementPushes(movementId ?? ''),
    queryFn: () => apiClient.inventory.listMovementPushes(movementId ?? ''),
    enabled: Boolean(movementId),
  });
}
