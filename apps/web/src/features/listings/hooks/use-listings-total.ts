/**
 * Listings list - the two-stage total and the tab-bar buckets (#2947)
 *
 * `offer_mappings` is searched with an `ILIKE` spanning product name, product
 * and variant SKU, barcodes, attribute values and the external offer id, over
 * a four-way join - so neither the total nor the lifecycle buckets can stop
 * early. The rows come from `useListingRowsQuery`; both aggregates come from
 * here, in ONE request.
 *
 * Two things are specific to this list and neither is incidental.
 *
 * **The count query is keyed WITHOUT `lifecycle`.** The buckets describe every
 * tab regardless of which one is selected, so keying on the tab would refetch
 * them on every tab switch and blank the tab bar - the behaviour #2029
 * explicitly required not happen, and which the page used to protect with a
 * hand-rolled ref and fingerprint. Not keying on it means switching tabs reuses
 * the cached buckets, and the fingerprint machinery goes away.
 *
 * **A SHORT page does not short-circuit the request.** The other three lists
 * skip the count entirely when the rows already imply an exact total; here the
 * tab bar needs its buckets whatever the page size. The inferred total is still
 * USED, so the pager shows the real number the moment the rows land while the
 * buckets are still counting.
 *
 * **But only from a page that is not a PLACEHOLDER.** This list's rows query
 * sets `placeholderData: keepPreviousData` - correct for the table, which
 * should not blank on a tab switch - so during any transition `query.data` is
 * still the PREVIOUS tab's page. Inferring from it would state that page's size
 * as the new tab's: click from a 3-row Active tab to a 900-row Draft one and
 * the pager would read "Showing 1-3 of 3" beside a tab badge reading 900, with
 * Next disabled so the operator could not page out of it. Worse, the correct
 * answer is already in hand - the count key omits `lifecycle`, so `stage.total`
 * re-derives 900 from the cached buckets immediately - and the inference would
 * override it. `isPlaceholderPage` is what keeps that unrepresentable, and it
 * is required rather than optional so a caller cannot forget to answer.
 *
 * @module features/listings/hooks
 */
import { useMemo } from 'react';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type {
  ListingsFilters,
  OfferLifecycleCounts,
  OfferMapping,
  OfferMappingCount,
} from '../api/listings.types';
import type { RowsPage } from '../../../shared/api/paginated-total.types';
import { deriveListingsTotal } from '../lib/derive-listings-total';
import {
  inferTotalFromLoadedPage,
  usePaginatedTotal,
  type PaginatedTotalResult,
  type PaginatedTotalState,
} from '../../../shared/hooks/use-paginated-total';
import { useApiClient } from '../../../app/api/api-client-provider';

export interface ListingsTotalResult extends PaginatedTotalResult<OfferMappingCount> {
  /**
   * The tab-bar buckets, or `null` when they are not known yet.
   *
   * `null` is never rendered as zeroes: an all-zero tab bar states that every
   * bucket is empty, which is a positive claim from an absent value - the same
   * rule that keeps a missing total from rendering as `0`.
   */
  lifecycleCounts: OfferLifecycleCounts | null;

  /**
   * The stage of the BUCKETS specifically, which is not always the stage of
   * `total` (#2957 review, I2).
   *
   * `state` above is overridden to `'known'` whenever a short page implies the
   * pager total exactly, and a short page implies nothing at all about the
   * other tabs' sizes. So with a short page AND a failed count, `state` is
   * `'known'` while `lifecycleCounts` is `null` - and a tab bar branching on
   * `state` would render loading skeletons for the life of the page, which
   * positively asserts that content is arriving when nothing is coming.
   *
   * One `state` cannot answer two questions. This one answers "do I know the
   * buckets", and a caller rendering the tab bar must read it rather than
   * `state`.
   */
  lifecycleCountsState: PaginatedTotalState;
}

export function useListingsTotal(
  filters: ListingsFilters,
  page: RowsPage<OfferMapping> | undefined,
  /** `query.isPlaceholderData` from the rows query. See the header. */
  isPlaceholderPage: boolean
): ListingsTotalResult {
  const apiClient = useApiClient();
  const inferred = isPlaceholderPage ? null : inferTotalFromLoadedPage(page);
  const { lifecycle } = filters;

  // Everything the buckets depend on, and nothing else. `includeLifecycleCounts`
  // is forced on: this hook's whole job is to answer both aggregates at once.
  const countFilters: ListingsFilters = useMemo(
    () => ({
      connectionId: filters.connectionId,
      internalId: filters.internalId,
      search: filters.search,
      includeLifecycleCounts: true,
    }),
    [filters.connectionId, filters.internalId, filters.search]
  );

  const stage = usePaginatedTotal<OfferMappingCount>({
    queryKey: listingsQueryKeys.count(countFilters),
    queryFn: ({ signal }) => apiClient.listings.count(countFilters, { signal }),
    // The response's own `total` is the un-narrowed sum, because the request
    // carries no `lifecycle`. The selected tab's size is its bucket.
    //
    // With the buckets absent - a rollout skew, a dropped query param, a
    // backend regression - a SELECTED tab has no honest number available, so
    // this reports unknown rather than falling back to `data.total`. That
    // fallback would print the whole catalogue's size as the tab's, presented
    // as `known`, which is precisely the number `deriveListingsTotal`'s own
    // docblock names as wrong. With no tab selected the sum IS the answer.
    selectTotal: (data) => {
      if (data.lifecycleCounts) return deriveListingsTotal(data.lifecycleCounts, lifecycle);
      return lifecycle ? null : data.total;
    },
    knownTotal: null,
    enabled: page !== undefined,
  });

  return {
    ...stage,
    total: inferred ?? stage.total,
    state: inferred !== null ? 'known' : stage.state,
    lifecycleCounts: stage.data?.lifecycleCounts ?? null,
    // Deliberately NOT the overridden `state` above - see the field's docblock.
    lifecycleCountsState: stage.state,
  };
}
