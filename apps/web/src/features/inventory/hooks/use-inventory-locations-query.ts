/**
 * useInventoryLocationsQuery
 *
 * Full, filtered, paginated read of `inventory_locations` (#2316 / #3065) —
 * the list page's own query, distinct from `useActiveLocationCountQuery`'s
 * install-wide `active`-only `total` probe.
 *
 * @module apps/web/src/features/inventory/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import type {
  InventoryLocationFilters,
  InventoryLocationListPagination,
  PaginatedInventoryLocations,
} from '../api/inventory-locations.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useInventoryLocationsQuery(
  filters?: InventoryLocationFilters,
  pagination?: InventoryLocationListPagination,
): UseQueryResult<PaginatedInventoryLocations> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: inventoryQueryKeys.locations(filters, pagination),
    queryFn: () => apiClient.inventory.listLocations(filters, pagination),
  });
}
