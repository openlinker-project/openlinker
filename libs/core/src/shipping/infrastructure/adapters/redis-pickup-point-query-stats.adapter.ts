/**
 * Redis Pickup-Point Query-Stats Adapter
 *
 * Redis-ZSET-backed `PickupPointQueryStatsPort` (#849). Per-connection sorted
 * set scored by query frequency: `ZINCRBY` on record, `ZRANGE … REV` for the
 * top-N re-warm read, `EXPIRE` for a rolling window, `ZREMRANGEBYRANK` to cap
 * cardinality.
 *
 * Why the raw `'REDIS_CLIENT'` (not the shared `CachePort`): top-N ranking is
 * intrinsically a sorted-set operation, which the KV `CachePort`
 * (`get`/`set`/`delete`) cannot express. Reaching for the raw client here
 * follows the established `libs/core` precedent (`RedisSyncLockService`, the
 * Redis-Streams enqueue + event-publisher adapters) — `'REDIS_CLIENT'` is a
 * `@Global` export of `RedisConfigModule`. If a second ranking consumer ever
 * appears, the right move is to promote a `CounterCachePort` into
 * `@openlinker/shared/cache` — do NOT "fix" this back to `CachePort`.
 *
 * @module libs/core/src/shipping/infrastructure/adapters
 * @see {@link PickupPointQueryStatsPort} for the port contract
 */
import { Inject, Injectable } from '@nestjs/common';
import { RedisClientType } from 'redis';

import type { PickupPointQueryStatsPort } from '../../domain/ports/pickup-point-query-stats.port';
import type { FindPickupPointsQuery } from '../../domain/types/pickup-point.types';
import {
  pickupPointFrequencyMember,
  parsePickupPointFrequencyMember,
} from '../../domain/pickup-point-query';

const KEY_PREFIX = 'paczkomat:freq:';
/** `pickupPointFrequencyMember` for a query with no identity fields. */
const EMPTY_QUERY_MEMBER = '{}';
/** Rolling window: a query unqueried for 7 days ages out of the ranking. */
const WINDOW_SECONDS = 7 * 86_400;
/** Cap distinct tracked queries per connection so the ZSET can't grow unbounded. */
const MAX_TRACKED_QUERIES = 500;

@Injectable()
export class RedisPickupPointQueryStatsAdapter implements PickupPointQueryStatsPort {
  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: RedisClientType,
  ) {}

  async record(connectionId: string, query: FindPickupPointsQuery): Promise<void> {
    const member = pickupPointFrequencyMember(query);
    // Don't track the empty/unfiltered query: re-warming `findPickupPoints({})`
    // is the heaviest possible provider call and not a meaningful locality
    // search. The member is `{}` only when every identity field is empty.
    if (member === EMPTY_QUERY_MEMBER) {
      return;
    }
    const key = keyFor(connectionId);
    // Issued together so node-redis pipelines them into a single round-trip.
    // `expire` refreshes the rolling window; `zRemRangeByRank` drops everything
    // below the top MAX_TRACKED_QUERIES (rank 0 = lowest score). Order between
    // them is irrelevant — neither depends on the increment's result.
    await Promise.all([
      this.redisClient.zIncrBy(key, 1, member),
      this.redisClient.expire(key, WINDOW_SECONDS),
      this.redisClient.zRemRangeByRank(key, 0, -(MAX_TRACKED_QUERIES + 1)),
    ]);
  }

  async topQueries(connectionId: string, limit: number): Promise<FindPickupPointsQuery[]> {
    if (!Number.isFinite(limit) || limit <= 0) {
      return [];
    }
    const members = await this.redisClient.zRange(keyFor(connectionId), 0, limit - 1, {
      REV: true,
    });
    return members.map((member) => parsePickupPointFrequencyMember(member));
  }
}

function keyFor(connectionId: string): string {
  return `${KEY_PREFIX}${connectionId}`;
}
