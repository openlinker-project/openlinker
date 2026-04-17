import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import type { PaginatedInventory, InventoryFilters, InventoryPagination } from '../api/inventory.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useInventoryQuery(
  filters?: InventoryFilters,
  pagination?: InventoryPagination,
): UseQueryResult<PaginatedInventory> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: inventoryQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.inventory.list(filters, pagination),
  });
}
