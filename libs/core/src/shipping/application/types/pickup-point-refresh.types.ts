/**
 * Pickup-Point Refresh Types
 *
 * Result shape for the background re-warm (#849).
 *
 * @module libs/core/src/shipping/application/types
 */

export interface PickupPointRefreshResult {
  /** Number of top-N queries successfully re-searched + re-cached. */
  refreshed: number;
  /** Number of top-N queries whose re-search failed (isolated; batch continues). */
  failed: number;
}
