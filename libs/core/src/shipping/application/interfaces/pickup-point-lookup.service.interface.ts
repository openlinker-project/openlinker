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
   * Operator-facing search. Records query frequency (#849), then serves from
   * the result cache when warm (skipping the provider call); on a miss runs a
   * live provider search and write-throughs the result list + each point.
   * Throws `PickupPointFinderNotSupportedException` when the connection's
   * adapter has no pickup-point network (e.g. a courier-only carrier).
   */
  search(connectionId: string, query: FindPickupPointsQuery): Promise<PickupPoint[]>;

  /**
   * Background re-warm path (#849): always runs a live provider search and
   * write-throughs both caches, **bypassing** the result-cache read and
   * **without** recording frequency (so the daily re-warm doesn't reinforce
   * its own counts). Used by `IPickupPointRefreshService`.
   */
  refreshSearch(connectionId: string, query: FindPickupPointsQuery): Promise<void>;

  /**
   * Fast by-id read from cache. `null` on miss — there is no live by-id
   * fall-through because the finder capability is search-only.
   */
  getCachedPoint(providerId: string): Promise<PickupPoint | null>;
}
