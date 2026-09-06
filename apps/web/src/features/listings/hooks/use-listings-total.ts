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
}

export function useListingsTotal(
  filters: ListingsFilters,
  page: RowsPage<OfferMapping> | undefined
): ListingsTotalResult {
  const apiClient = useApiClient();
  const inferred = inferTotalFromLoadedPage(page);
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
    selectTotal: (data) =>
      data.lifecycleCounts ? deriveListingsTotal(data.lifecycleCounts, lifecycle) : data.total,
    knownTotal: null,
    enabled: page !== undefined,
  });

  return {
    ...stage,
    total: inferred ?? stage.total,
    state: inferred !== null ? 'known' : stage.state,
    lifecycleCounts: stage.data?.lifecycleCounts ?? null,
  };
}
