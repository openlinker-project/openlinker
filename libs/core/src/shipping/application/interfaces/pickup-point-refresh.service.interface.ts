/**
 * Pickup-Point Refresh Service Interface
 *
 * Background re-warm of the most-frequently-queried pickup-point searches for
 * a connection (#849). Driven per-connection by the `shipping.pickupPoint.refreshFrequent`
 * worker handler (fanned out daily by the core scheduler). Reads the top-N
 * queries from `PickupPointQueryStatsPort` and re-runs each via
 * `IPickupPointLookupService.refreshSearch`, re-warming both the per-point and
 * result caches.
 *
 * @module libs/core/src/shipping/application/interfaces
 */
import type { PickupPointRefreshResult } from '../types/pickup-point-refresh.types';

export interface IPickupPointRefreshService {
  /**
   * Re-warm the top-N most-frequent searches for `connectionId`. No-ops
   * (returns zero counts) when the connection's adapter isn't a
   * `PickupPointFinder`. Per-query failures are isolated — one dead query does
   * not abort the batch.
   */
  refreshFrequentForConnection(connectionId: string): Promise<PickupPointRefreshResult>;
}
