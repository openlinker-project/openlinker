/**
 * useInventoryAvailabilityBatchQuery
 *
 * Batch lookup of per-variant inventory availability via
 * `GET /inventory/availability` (#792 PR 2). Dedupes input IDs at the
 * hook boundary so callers can pass the raw row list. Disabled
 * automatically when the deduped list is empty so an empty wizard step
 * does not fire a wasted request.
 *
 * Consumed by #792 PR 3 (bulk-wizard master-pull resolver) — exported
 * from the inventory feature's public barrel for cross-feature use.
 *
 * @module apps/web/src/features/inventory/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import type { InventoryAvailabilityResponse } from '../api/inventory.types';

export function useInventoryAvailabilityBatchQuery(
  productVariantIds: readonly string[],
  options?: { enabled?: boolean }
): UseQueryResult<InventoryAvailabilityResponse> {
  const apiClient = useApiClient();
  const deduped = [...new Set(productVariantIds)];
  const enabled = (options?.enabled ?? true) && deduped.length > 0;

  return useQuery({
    queryKey: inventoryQueryKeys.availability(deduped),
    queryFn: () => apiClient.inventory.availability(deduped),
    enabled,
  });
}
