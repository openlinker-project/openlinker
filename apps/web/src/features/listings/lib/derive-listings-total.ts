/**
 * The selected tab's row count, from the tab-bar buckets (#2947)
 *
 * The lifecycle buckets PARTITION the filtered set - that is the documented
 * property `GET /listings/count` relies on when it derives `total` from them
 * server-side. So the size of one tab is that bucket, and the size of no tab
 * is their sum.
 *
 * It is derived here, and not read from the response's own `total`, for one
 * reason: the counts query is deliberately keyed WITHOUT `lifecycle`, so that
 * switching tabs reuses the cached buckets instead of blanking the tab bar
 * (#2029). A request that carries no `lifecycle` gets back the un-narrowed
 * sum, which is the wrong number for a selected tab.
 *
 * @module features/listings/lib
 */
import { OFFER_LIFECYCLE_VALUES } from '../api/listings.types';
import type { OfferLifecycle, OfferLifecycleCounts } from '../api/listings.types';

export function deriveListingsTotal(
  counts: OfferLifecycleCounts,
  lifecycle: OfferLifecycle | undefined
): number {
  if (lifecycle) return counts[lifecycle] ?? 0;
  // `Object.values` over a `Record<K, number>` widens to `unknown[]` under the
  // project's strict lint rules, so the buckets are read through the union's
  // own key list rather than cast.
  return OFFER_LIFECYCLE_VALUES.reduce((sum, bucket) => sum + (counts[bucket] ?? 0), 0);
}
