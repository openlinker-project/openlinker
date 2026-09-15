/**
 * useDuplicatePositionsQuery
 *
 * Read-only duplicate-position readiness diagnostic (#2319, ADR-058 step
 * (iii)). `maxGroups` bounds the returned group DETAIL only — `groupCount` /
 * `rowCount` / `excessRowCount` always cover the whole table, so a caller
 * reading only the KPI strip does not need to page.
 *
 * @module apps/web/src/features/inventory/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import type { DuplicatePositionsReport } from '../api/inventory.types';

export function useDuplicatePositionsQuery(
  maxGroups?: number
): UseQueryResult<DuplicatePositionsReport> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: inventoryQueryKeys.duplicatePositions(maxGroups),
    queryFn: () => apiClient.inventory.getDuplicatePositions(maxGroups),
  });
}
