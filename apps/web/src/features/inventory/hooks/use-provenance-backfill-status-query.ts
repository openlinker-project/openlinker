/**
 * useProvenanceBackfillStatusQuery
 *
 * Live status of the #2317 provenance backfill (#3240) — the second,
 * independent readiness condition for the #2325 stricter uniqueness index,
 * alongside `useDuplicatePositionsQuery`'s `groupCount`. Always resolved
 * live server-side — never cached — so this hook does not poll.
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
  });
}
