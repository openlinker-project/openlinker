/**
 * Pickup-Point Lookup Service Interface
 *
 * Read-through orchestration over `PickupPointCachePort` + a connection's
 * `PickupPointFinder` capability (#766). `search` runs a live provider lookup
 * (lists must be fresh) and write-throughs each result to the cache;
 * `getCachedPoint` is the fast by-id read used to re-render a previously chosen
 * locker. Consumed by the manual paczkomat picker (#769).
 *
 * @module libs/core/src/shipping/application/interfaces
 */
import type { FindPickupPointsQuery, PickupPoint } from '../../domain/types/pickup-point.types';

export interface IPickupPointLookupService {
  /**
   * Live provider search; write-throughs each returned point to the cache.
   * Throws `PickupPointFinderNotSupportedException` when the connection's
   * adapter has no pickup-point network (e.g. a courier-only carrier).
   */
  search(connectionId: string, query: FindPickupPointsQuery): Promise<PickupPoint[]>;

  /**
   * Fast by-id read from cache. `null` on miss — there is no live by-id
   * fall-through because the finder capability is search-only.
   */
  getCachedPoint(providerId: string): Promise<PickupPoint | null>;
}
