/**
 * Redis Pickup-Point Search-Cache Adapter
 *
 * Redis-backed `PickupPointSearchCachePort` (#849) over the shared `CachePort`
 * (values JSON-serialized at that boundary). Caches whole `query → PickupPoint[]`
 * result lists keyed by connection + the limit-inclusive
 * `pickupPointSearchCacheKey`, with a TTL shorter than the 24h per-point entry
 * (#766) because lists go stale faster than a single locker's metadata.
 *
 * @module libs/core/src/shipping/infrastructure/adapters
 * @see {@link PickupPointSearchCachePort} for the port contract
 */
import { Inject, Injectable } from '@nestjs/common';
import { CACHE_PORT_TOKEN, type CachePort } from '@openlinker/shared/cache';

import type { PickupPointSearchCachePort } from '../../domain/ports/pickup-point-search-cache.port';
import type { FindPickupPointsQuery, PickupPoint } from '../../domain/types/pickup-point.types';
import { pickupPointSearchCacheKey } from '../../domain/pickup-point-query';

/** Default search-list TTL (1h). Shorter than the 24h per-point entry — lists go stale faster. */
const DEFAULT_SEARCH_CACHE_TTL_SECONDS = 3_600;
const MIN_SEARCH_CACHE_TTL_SECONDS = 60;
const MAX_SEARCH_CACHE_TTL_SECONDS = 86_400;

const KEY_PREFIX = 'paczkomat:search:';

function resolveTtlSeconds(): number {
  const raw = process.env.OL_PICKUP_POINT_SEARCH_CACHE_TTL_SECONDS;
  const parsed = raw !== undefined && raw !== '' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SEARCH_CACHE_TTL_SECONDS;
  }
  return Math.min(MAX_SEARCH_CACHE_TTL_SECONDS, Math.max(MIN_SEARCH_CACHE_TTL_SECONDS, parsed));
}

@Injectable()
export class RedisPickupPointSearchCacheAdapter implements PickupPointSearchCachePort {
  private readonly ttlSeconds = resolveTtlSeconds();

  constructor(
    @Inject(CACHE_PORT_TOKEN)
    private readonly cache: CachePort,
  ) {}

  get(connectionId: string, query: FindPickupPointsQuery): Promise<PickupPoint[] | null> {
    return this.cache.get<PickupPoint[]>(keyFor(connectionId, query));
  }

  async put(
    connectionId: string,
    query: FindPickupPointsQuery,
    points: readonly PickupPoint[],
  ): Promise<void> {
    await this.cache.set(keyFor(connectionId, query), [...points], this.ttlSeconds);
  }
}

function keyFor(connectionId: string, query: FindPickupPointsQuery): string {
  return `${KEY_PREFIX}${connectionId}:${pickupPointSearchCacheKey(query)}`;
}
