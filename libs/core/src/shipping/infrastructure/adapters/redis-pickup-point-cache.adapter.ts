/**
 * Redis Pickup-Point Cache Adapter
 *
 * Redis-backed implementation of `PickupPointCachePort` (#766). Stores each
 * paczkomat-style pickup point keyed by its globally-unique provider id with a
 * 24h TTL, on top of the shared `CachePort` (values JSON-serialized at that
 * boundary). The full `PickupPoint` round-trips — including
 * `status: 'temporarily-unavailable'` and the structured opening-hours grid —
 * so staleness/availability surfaces in the picker (#769) with no extra work.
 *
 * By design this is a pure cache: `get` never refetches (read-through
 * orchestration lives in `PickupPointLookupService`), and there is no
 * invalidation/refresh method — freshness is TTL-driven per #727.1.
 *
 * @module libs/core/src/shipping/infrastructure/adapters
 * @see {@link PickupPointCachePort} for the port contract
 */
import { Inject, Injectable } from '@nestjs/common';
import { CACHE_PORT_TOKEN, type CachePort } from '@openlinker/shared/cache';

import type { PickupPointCachePort } from '../../domain/ports/pickup-point-cache.port';
import type { PickupPoint } from '../../domain/types/pickup-point.types';

/**
 * 24h, per #766 SC-2. Fixed (not env-tunable) — the acceptance criterion pins
 * the cache lifetime at 24h; widen to a config knob only if a real operability
 * need surfaces.
 */
export const PICKUP_POINT_CACHE_TTL_SECONDS = 86_400;

/** Connection-agnostic: paczkomat ids are a single national namespace. */
const KEY_PREFIX = 'paczkomat:point:';

@Injectable()
export class RedisPickupPointCacheAdapter implements PickupPointCachePort {
  constructor(
    @Inject(CACHE_PORT_TOKEN)
    private readonly cache: CachePort,
  ) {}

  get(providerId: string): Promise<PickupPoint | null> {
    return this.cache.get<PickupPoint>(keyFor(providerId));
  }

  async put(point: PickupPoint): Promise<void> {
    await this.cache.set(keyFor(point.providerId), point, PICKUP_POINT_CACHE_TTL_SECONDS);
  }
}

function keyFor(providerId: string): string {
  return `${KEY_PREFIX}${providerId}`;
}
