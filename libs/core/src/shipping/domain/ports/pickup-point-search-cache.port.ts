/**
 * Pickup-Point Search-Cache Port
 *
 * Caches whole `query → PickupPoint[]` search results (#849), distinct from
 * the by-id `PickupPointCachePort` (#766) which caches individual points.
 * Sibling port rather than a widening of the by-id port: the two have
 * different keyspaces, TTLs, and freshness semantics (lists go stale faster
 * than a single locker's metadata, so the implementation uses a shorter TTL).
 *
 * A cache hit lets `PickupPointLookupService.search` skip the live provider
 * call within the (short) TTL — the latency / rate-limit win this port exists
 * for. The key is limit-inclusive (see `pickupPointSearchCacheKey`).
 *
 * Domain-only — zero framework imports.
 *
 * @module libs/core/src/shipping/domain/ports
 */
import type { FindPickupPointsQuery, PickupPoint } from '../types/pickup-point.types';

export interface PickupPointSearchCachePort {
  /** Cached result list for `(connectionId, query)`, or `null` on miss/expiry. */
  get(connectionId: string, query: FindPickupPointsQuery): Promise<PickupPoint[] | null>;

  /** Cache the result list for `(connectionId, query)`. TTL handled by the implementation. */
  put(
    connectionId: string,
    query: FindPickupPointsQuery,
    points: readonly PickupPoint[],
  ): Promise<void>;
}
