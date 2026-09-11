import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { connectionPricingSyncQueryKey } from './use-connection-pricing-sync-query';
import type { ConnectionPricingSyncView } from '../api/pricing-sync.types';

/**
 * Batches `GET .../pricing-sync` across every candidate destination for the
 * "Pricing rules" picker (#3150) — each row needs its own default rule +
 * override count, and there is no list-shaped endpoint for it. Index-aligned
 * with the input `connectionIds`, the `useProductsBatchQuery` shape.
 */
export function useDestinationPricingSyncSummaries(
  connectionIds: readonly string[],
): UseQueryResult<ConnectionPricingSyncView>[] {
  const apiClient = useApiClient();

  return useQueries({
    queries: connectionIds.map((connectionId) => ({
      queryKey: connectionPricingSyncQueryKey(connectionId),
      queryFn: () => apiClient.pricingSync.get(connectionId),
    })),
  });
}
