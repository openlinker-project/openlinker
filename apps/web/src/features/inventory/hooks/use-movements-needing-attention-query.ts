/**
 * useMovementsNeedingAttentionQuery (#4061)
 *
 * How many stock changes in the current scope were refused or never
 * confirmed - the number behind the history page's problem line. A count
 * only: no rows are fetched, so the line costs one request and never
 * borrows a number from the page on screen. A failed or pending count reads
 * as `undefined`, which the page renders as nothing rather than as zero.
 *
 * @module apps/web/src/features/inventory/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import type { InventoryMovementFilters } from '../api/inventory-movements.types';
import type { PaginatedTotal } from '../../../shared/api/paginated-total.types';

export function useMovementsNeedingAttentionQuery(
  filters: InventoryMovementFilters,
  options?: { enabled?: boolean },
): UseQueryResult<PaginatedTotal> {
  const apiClient = useApiClient();
  const attention: InventoryMovementFilters = { ...filters, needsAttention: true };

  return useQuery({
    queryKey: inventoryQueryKeys.movementsCount(attention),
    queryFn: ({ signal }) => apiClient.inventory.countMovements(attention, { signal }),
    enabled: options?.enabled ?? true,
  });
}
