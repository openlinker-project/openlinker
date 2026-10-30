/**
 * useInventoryMovementsQuery / useInventoryMovementsCountQuery (#3568)
 *
 * The stock movement history rows, and its total as a second stage
 * (docs/frontend-architecture.md § Paginated Totals As A Second Stage). The
 * count is deliberately a separate hook: a missing total must never be rendered
 * as `0`.
 *
 * @module apps/web/src/features/inventory/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import type {
  InventoryMovementFilters,
  InventoryMovementPagination,
  InventoryMovementsPage,
} from '../api/inventory-movements.types';
import type { PaginatedTotal } from '../../../shared/api/paginated-total.types';
import {
  inferTotalFromLoadedPage,
  usePaginatedTotal,
  type PaginatedTotalResult,
} from '../../../shared/hooks/use-paginated-total';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useInventoryMovementsQuery(
  filters?: InventoryMovementFilters,
  pagination?: InventoryMovementPagination,
  options?: { enabled?: boolean },
): UseQueryResult<InventoryMovementsPage> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: inventoryQueryKeys.movements(filters, pagination),
    queryFn: () => apiClient.inventory.listMovements(filters, pagination),
    enabled: options?.enabled ?? true,
  });
}

/**
 * @param page the rows already rendered; a SHORT page carries its own exact
 *   total, so the count is then never requested.
 */
export function useInventoryMovementsCountQuery(
  filters: InventoryMovementFilters,
  page: InventoryMovementsPage | undefined,
): PaginatedTotalResult<PaginatedTotal> {
  const apiClient = useApiClient();

  return usePaginatedTotal<PaginatedTotal>({
    queryKey: inventoryQueryKeys.movementsCount(filters),
    queryFn: ({ signal }) => apiClient.inventory.countMovements(filters, { signal }),
    selectTotal: (data) => data.total,
    knownTotal: inferTotalFromLoadedPage(page),
    enabled: page !== undefined,
  });
}
