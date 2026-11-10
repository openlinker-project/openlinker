/**
 * useListingChannelCounts (#4046)
 *
 * The listings Channel dropdown's option counts: one `GET /listings/count` per
 * marketplace connection under the page's own filters with the channel
 * swapped, so an option's number is what selecting it would list (the tab
 * included - `count` honours `lifecycle`, unlike the buckets). An unknown or
 * failed count is `undefined`, never 0.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQueries } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { ListingsFilters } from '../api/listings.types';

export function useListingChannelCounts(
  filters: ListingsFilters,
  connectionIds: readonly string[],
): ReadonlyMap<string, number | undefined> {
  const apiClient = useApiClient();
  return useQueries({
    queries: connectionIds.map((connectionId) => {
      const probe: ListingsFilters = { ...filters, connectionId, includeLifecycleCounts: undefined };
      return {
        queryKey: listingsQueryKeys.count(probe),
        queryFn: ({ signal }: { signal: AbortSignal }) => apiClient.listings.count(probe, { signal }),
      };
    }),
    combine: (results) =>
      new Map(connectionIds.map((connectionId, index) => [connectionId, results[index]?.data?.total])),
  });
}
