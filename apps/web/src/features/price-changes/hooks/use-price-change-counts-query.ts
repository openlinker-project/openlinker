import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { priceChangesQueryKeys } from '../api/price-changes.query-keys';
import type { PriceChangeCountsResponse } from '../api/price-changes.types';

/**
 * The review queue's connection filter-bar chip counts (#3325) — exact,
 * server-side `GROUP BY` counts rather than the bounded client-side
 * bucketing of a limited `usePriceChangesQuery` page it replaces.
 *
 * No standing poll of its own, matching the read it replaces (#3164
 * re-review, SUGGESTION): a chip count is a slowly-changing sidebar number
 * rather than the working set, and it still refreshes on the ordinary
 * invalidation every accept/ignore/edit/bulk-accept mutation fires
 * (`priceChangesQueryKeys.all`, whose `['price-changes']` prefix also
 * matches this query's key), so a count cannot go stale behind an action
 * taken here.
 */
export function usePriceChangeCountsQuery(): UseQueryResult<PriceChangeCountsResponse> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: priceChangesQueryKeys.counts(),
    queryFn: () => apiClient.priceChanges.counts(),
  });
}
