import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { connectionPricingSyncQueryKey } from './use-connection-pricing-sync-query';
import type { ConnectionPricingSyncView } from '../api/pricing-sync.types';

/**
 * Batches `GET .../pricing-sync` across every candidate destination for the
 * "Pricing rules" picker (#3150) — each row needs its own default rule +
 * override count, and there is no list-shaped endpoint for it. Index-aligned
 * with the input `connectionIds`, the `useProductsBatchQuery` shape —
 * `enabled` follows the same pattern, gated on the picker dialog actually
 * being open (#3167 review, finding 3): the dialog is mounted unconditionally
 * by the queue table (only its Radix content is conditional on `open`), so
 * without this every render of the Price changes tab fired one request per
 * destination connection nobody asked for yet.
 */
/** One minute — long enough to cover a picker re-open, short enough that
 * an edit made in another tab is not stale for long. */
const SUMMARY_STALE_MS = 60_000;

export function useDestinationPricingSyncSummaries(
  connectionIds: readonly string[],
  options?: { enabled?: boolean },
): UseQueryResult<ConnectionPricingSyncView>[] {
  const apiClient = useApiClient();
  const enabled = options?.enabled ?? true;

  return useQueries({
    queries: connectionIds.map((connectionId) => ({
      queryKey: connectionPricingSyncQueryKey(connectionId),
      queryFn: () => apiClient.pricingSync.get(connectionId),
      enabled,
      // A destination's default rule changes when an operator edits it, not
      // on its own, and this picker is opened repeatedly in one sitting
      // (#3167 round-3 review). The `useUpdateConnectionPricingSyncMutation`
      // and `useSetSourceSyncModeMutation` both invalidate this exact key, so
      // an edit still lands immediately — this only stops a re-open refetching
      // N connections that nothing has touched.
      staleTime: SUMMARY_STALE_MS,
    })),
  });
}
