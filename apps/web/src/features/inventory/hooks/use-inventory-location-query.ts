/**
 * useInventoryLocationQuery
 *
 * Single-location read by id (#2316 / #3065), for the edit dialog (#3067).
 *
 * `enabled` follows the `useConnectionQuery` shape: an empty id never fires
 * (an unmounted-but-still-hooked edit dialog with no target selected), and a
 * caller may additionally suppress the fetch — e.g. while a page-level list
 * read already resolved the row and there is nothing left to ask for.
 *
 * @module apps/web/src/features/inventory/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import type { InventoryLocation } from '../api/inventory-locations.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useInventoryLocationQuery(
  id: string,
  options?: { enabled?: boolean },
): UseQueryResult<InventoryLocation> {
  const apiClient = useApiClient();

  return useQuery({
    enabled: id.length > 0 && (options?.enabled ?? true),
    queryKey: inventoryQueryKeys.locationDetail(id),
    queryFn: () => apiClient.inventory.getLocation(id),
  });
}
