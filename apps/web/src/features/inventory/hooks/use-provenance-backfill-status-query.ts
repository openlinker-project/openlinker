/**
 * useProvenanceBackfillStatusQuery
 *
 * Live status of the #2317 provenance backfill (#3240) — the second,
 * independent readiness condition for the #2325 stricter uniqueness index,
 * alongside `useDuplicatePositionsQuery`'s `groupCount`. The server always
 * resolves it with a fresh `COUNT(*)` over `inventory_items` — nothing is
 * cached server-side. This hook does NOT poll (no `refetchInterval`), and
 * that is deliberate rather than incidental: `staleTime` +
 * `refetchOnWindowFocus: false` keep a tab switch or remount from re-running
 * that uncapped count. Do not add polling here without re-weighing the cost.
 *
 * @module apps/web/src/features/inventory/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import type { ProvenanceBackfillStatus } from '../api/inventory.types';

export function useProvenanceBackfillStatusQuery(): UseQueryResult<ProvenanceBackfillStatus> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: inventoryQueryKeys.provenanceBackfillStatus(),
    queryFn: () => apiClient.inventory.getProvenanceBackfillStatus(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
