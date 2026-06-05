/**
 * Pickup-Point Query-Stats Port
 *
 * Tracks how often each pickup-point search query is run per connection and
 * returns the most-frequent queries (#849). Feeds the daily background re-warm
 * (`PickupPointRefreshService`), which re-runs the top-N searches to refresh
 * their cached points + result lists.
 *
 * `record` is limit-agnostic (popularity is about the locality, not page
 * size); `topQueries` returns reconstructed `FindPickupPointsQuery` objects,
 * most-frequent first. Top-N ranking is intrinsically a sorted-set operation,
 * which the KV `CachePort` can't express — hence a dedicated port (the Redis
 * adapter uses ZSET ops on the raw client).
 *
 * Domain-only — zero framework imports.
 *
 * @module libs/core/src/shipping/domain/ports
 */
import type { FindPickupPointsQuery } from '../types/pickup-point.types';

export interface PickupPointQueryStatsPort {
  /** Increment the frequency count for `query` on `connectionId`. Best-effort. */
  record(connectionId: string, query: FindPickupPointsQuery): Promise<void>;

  /** The `limit` most-frequently-recorded queries for `connectionId`, most-frequent first. */
  topQueries(connectionId: string, limit: number): Promise<FindPickupPointsQuery[]>;
}
