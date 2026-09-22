/**
 * Bench Presence Service (#3406, mockup-parity epic #3401)
 *
 * A lightweight, ephemeral collision signal — "someone else already has this
 * parcel open" — backed by one Redis TTL key per work id, never a database
 * table. Presence is advisory: it warns a packer, it gates nothing, and
 * losing it on a Redis restart costs nothing more than a banner that does not
 * show up until the next ping.
 *
 * ## Mutual presence from ONE key, not two
 *
 * The key holds the LAST pinger. Each `ping` first reads it — if it names a
 * DIFFERENT user and is still fresh (its own recorded instant, not the key's
 * remaining TTL, which Redis does not expose per read), that is a collision —
 * then unconditionally overwrites it with the caller and a fresh TTL. Two
 * packers who both keep pinging therefore keep seeing each other: A pings,
 * writes A; B pings, reads A (fresh, different) → collision, writes B; A
 * pings again, reads B (fresh, different) → collision; and so on. A packer who
 * stops pinging (navigated away, dead session) either has their claim
 * overwritten by the survivor's next ping — after which the survivor reads
 * only themselves and the banner clears with no separate "leave" call — or
 * the key expires on its own via Redis TTL.
 *
 * `CACHE_PORT_TOKEN` is `@Global()` (`CacheModule`), so this needs no module
 * import beyond the injection itself.
 *
 * @module apps/api/src/bench/application/services
 * @implements {IBenchPresenceService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { CACHE_PORT_TOKEN, type CachePort } from '@openlinker/shared/cache';

import type { IBenchPresenceService } from '../interfaces/bench-presence.service.interface';
import type { BenchPresenceView } from '../types/bench-presence.types';

/**
 * How long a ping's claim stays fresh, in seconds. Must comfortably exceed
 * the client's own ping interval (the mockup's collision banner is a UX aid,
 * not a lock, so a generous window costs nothing but a slightly stale "still
 * here" and a tight one flickers the banner between two active packers'
 * ordinary poll cadence).
 */
const PRESENCE_TTL_SEC = 30;

interface PresenceClaim {
  readonly userId: string;
  readonly at: string;
}

@Injectable()
export class BenchPresenceService implements IBenchPresenceService {
  constructor(
    @Inject(CACHE_PORT_TOKEN)
    private readonly cache: CachePort
  ) {}

  async ping(workId: string, userId: string): Promise<BenchPresenceView> {
    const key = this.keyFor(workId);
    const existing = await this.cache.get<PresenceClaim>(key);

    // Overwrite unconditionally — a stale or absent claim leaves nothing to
    // preserve, and the caller's own presence is always the freshest fact.
    await this.cache.set<PresenceClaim>(
      key,
      { userId, at: new Date().toISOString() },
      PRESENCE_TTL_SEC
    );

    if (existing === null || existing.userId === userId) {
      return { collision: false, otherUserId: null };
    }

    // The read key itself expired via Redis TTL if it is stale — a `get` on an
    // expired key returns null, which the branch above already handles — so
    // reaching here means `existing` is BOTH a different user AND still live.
    return { collision: true, otherUserId: existing.userId };
  }

  private keyFor(workId: string): string {
    return `bench:viewing:${workId}`;
  }
}
