/**
 * useInventoryLocationsQuery
 *
 * Full, filtered, paginated read of `inventory_locations` (#2316 / #3065) —
 * the list page's own query, distinct from `useActiveLocationCountQuery`'s
 * install-wide `active`-only `total` probe.
 *
 * `options.enabled` (default `true`) lets a caller that always calls this
 * hook (React's rules-of-hooks) skip the actual fetch — e.g.
 * `StockAndPricingSection` (#3207 review), which is mounted for every
 * connection but should only spend this request on one whose enabled
 * capabilities can actually use the answer.
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

export interface UseInventoryLocationsQueryOptions {
  enabled?: boolean;
}

export function useInventoryLocationsQuery(
  filters?: InventoryLocationFilters,
  pagination?: InventoryLocationListPagination,
  options?: UseInventoryLocationsQueryOptions,
): UseQueryResult<PaginatedInventoryLocations> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: inventoryQueryKeys.locations(filters, pagination),
    queryFn: () => apiClient.inventory.listLocations(filters, pagination),
    enabled: options?.enabled ?? true,
  });
}
