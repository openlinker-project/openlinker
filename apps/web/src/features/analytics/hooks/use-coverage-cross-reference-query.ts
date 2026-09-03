/**
 * Coverage Cross-Reference Query Hook
 *
 * Pages through one Data Coverage category's *complete* affected-order
 * list (never the `GET /analytics/coverage` aggregate's 10-id sample). One
 * `useQuery` per category — call it once per member of
 * `CROSS_REFERENCEABLE_CATEGORIES` (a fixed set), never a variable count
 * derived from which categories happen to be open, so the number of hook
 * calls never changes across renders.
 *
 * Each call drains its own pages inside one `queryFn` rather than issuing a
 * separate `useQuery` per page — a per-page-load, non-hot-path read (see
 * `docs/plans/implementation-plan-analytics-exclusion-annotations.md`'s own
 * risk note on this bound).
 *
 * **`ChannelSalesTable` no longer uses this hook (#2714)** — its per-row
 * `.excl-note` cross-reference (#2481, epic #2452 Phase 8) now consumes
 * `GET /analytics/coverage/by-connection` (#2713) via
 * `useCoverageByConnectionQuery`, which returns every category's
 * `sourceConnectionId`-grouped counts in ONE request instead of draining
 * four full order lists. `ProductSalesTable` still calls this hook: its
 * per-product cross-reference (`buildProductExclusionMap`) needs each
 * order's `productId`/`lineRates`, which the connection-level aggregate
 * doesn't carry — there is no equivalent aggregate to swap it to.
 *
 * Only `data` is returned, deliberately — no `isLoading`/`isError`. A failed
 * or still-loading category silently contributes no rows to
 * `buildProductExclusionMap`, which just means that category's
 * `AnalyticsExclusionNote`s are momentarily/permanently absent from the
 * table. This is a supplementary annotation on top of already-successful
 * sales figures, not a screen of its own — so it degrades silently by
 * design rather than surfacing a table-wide error state for one row's worth
 * of missing badges.
 *
 * @module apps/web/src/features/analytics/hooks
 */
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { AnalyticsCoverageFilters } from '../api/analytics-coverage.types';
import type { CoverageOrderLite, CrossReferenceableCategory } from '../lib/channel-exclusion-map.lib';

const CROSS_REF_PAGE_LIMIT = 100;

export function useCoverageCrossReferenceQuery(
  category: CrossReferenceableCategory,
  coverageFilters: AnalyticsCoverageFilters,
  enabled: boolean
): { data: CoverageOrderLite[] | undefined } {
  const apiClient = useApiClient();

  const { data } = useQuery({
    queryKey: ['analytics', 'coverage-cross-reference', category, coverageFilters],
    queryFn: async (): Promise<CoverageOrderLite[]> => {
      const all: CoverageOrderLite[] = [];
      let offset = 0;
      for (;;) {
        const page =
          category === 'currency'
            ? await apiClient.analytics.getCurrencyMismatchOrders({ ...coverageFilters, limit: CROSS_REF_PAGE_LIMIT, offset })
            : await apiClient.analytics.getTaxCoverageOrders({
                category,
                ...coverageFilters,
                limit: CROSS_REF_PAGE_LIMIT,
                offset,
              });
        all.push(...page.items);
        offset += page.items.length;
        if (page.items.length < CROSS_REF_PAGE_LIMIT || offset >= page.total) break;
      }
      return all;
    },
    enabled,
  });

  return { data };
}
