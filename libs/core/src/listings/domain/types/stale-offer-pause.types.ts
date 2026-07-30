/**
 * Stale Offer Pause Types
 *
 * Marketplace-neutral result shape for the stale-variant offer-pause
 * orchestration (#1689) — closes the fail-open marketplace side of a
 * master-side deletion by zeroing every live offer mapped to a variant
 * that `product_variants.isStale`. Two entry points share this shape: the
 * event-driven trigger (`pauseOffersForVariants`) and the hourly reconcile
 * sweep (`sweepConnection`), which exists because the deletion event is
 * published at-most-once and can be lost.
 *
 * @module libs/core/src/listings/domain/types
 */

export interface StaleOfferPauseResult {
  /** Variants considered (re-read for current staleness). */
  variantsConsidered: number;
  /** Of those, how many were confirmed still stale at the moment of pausing. */
  variantsStillStale: number;
  /** Quantity-0 update jobs successfully enqueued. */
  offersPaused: number;
  /** Mappings that failed to enqueue (logged, not thrown — isolated per mapping). */
  offersSkipped: number;
}
