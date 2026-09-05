/**
 * Coverage By-Connection Query Hook
 *
 * Fetches `GET /analytics/coverage/by-connection` (#2713) — currency + tax
 * A/B/C affected-order counts already `GROUP BY sourceConnectionId`d
 * server-side — in ONE request, for `ChannelSalesTable`'s `.excl-note`
 * cross-reference (#2714). Replaces `useCoverageCrossReferenceQuery`'s four
 * page-draining calls (one per `CROSS_REFERENCEABLE_CATEGORIES` member) for
 * that one consumer; `ProductSalesTable` still needs the full per-order
 * `productId`/`lineRates` shape (no product-level aggregate exists), so it
 * keeps using the old hook — see that hook's own doc comment.
 *
 * Same silent-degradation contract as its predecessor: only `data` is
 * returned, no `isLoading`/`isError` — a still-loading or failed read simply
 * contributes no exclusion notes for this render rather than surfacing a
 * table-wide error state for a supplementary annotation.
 *
 * @module apps/web/src/features/analytics/hooks
 */
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { analyticsCoverageQueryKeys } from '../api/analytics-coverage.query-keys';
import type { AnalyticsCoverageByConnection, AnalyticsCoverageFilters } from '../api/analytics-coverage.types';

export function useCoverageByConnectionQuery(
  filters: AnalyticsCoverageFilters,
  enabled: boolean
): { data: AnalyticsCoverageByConnection | undefined } {
  const apiClient = useApiClient();

  const { data } = useQuery({
    queryKey: analyticsCoverageQueryKeys.byConnection(filters),
    queryFn: () => apiClient.analytics.getCoverageByConnection(filters),
    enabled,
  });

  return { data };
}
