/**
 * useActiveLocationCountQuery
 *
 * How many inventory locations are active right now (#2407).
 *
 * Install-wide, so the key carries no connection axis: locations are a property
 * of the deployment, and two connection pages asking the question share one
 * cache entry rather than issuing two reads of the same fact.
 *
 * `total`, never `items.length` — the request asks for a single row, so a page
 * length would report 1 for a hundred locations and 1 for one.
 *
 * @module apps/web/src/features/inventory/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useActiveLocationCountQuery(): UseQueryResult<number> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: inventoryQueryKeys.activeLocations(),
    queryFn: async () => (await apiClient.inventory.listActiveLocations()).total,
  });
}
