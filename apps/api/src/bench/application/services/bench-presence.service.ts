/**
 * Bench Presence Service (#3406; widened to a named roster by #3415,
 * mockup-parity epic #3401)
 *
 * A lightweight, ephemeral collision signal — "someone else already has this
 * parcel open" — backed by one Redis TTL key per work id, never a database
 * table. Presence is advisory: it warns a packer, it gates nothing, and
 * losing it on a Redis restart costs nothing more than a banner that does
 * not show up until the next ping.
 *
 * ## One key holding a ROSTER, not one slot holding the last pinger
 *
 * #3406 stored a single claim and could therefore only ever name ONE other
 * packer, rotating between them as each pinged. The mockup's banner names
 * who is in the box, and three packers in one box is a real warehouse state,
 * so the key holds every current viewer keyed by user id.
 *
 * Each `ping` reads the roster, drops the caller's own previous entry and
 * every entry whose own recorded instant has lapsed, re-adds the caller with
 * a fresh instant, and writes the whole roster back under a fresh key TTL.
 * The caller is then answered with everyone who survived that prune.
 *
 * **Pruning by each entry's OWN instant is load-bearing, not belt-and-braces.**
 * The key's TTL is refreshed by *any* pinger, so while one packer keeps the
 * parcel open the key never expires — and a colleague who walked away would
 * stay in it forever if Redis expiry were the only mechanism. Redis does not
 * expose a per-field TTL on a JSON value, so the instant is carried per
 * entry and compared here.
 *
 * ## The name is masked before it is stored
 *
 * The roster holds `maskName(username)`, never the raw username. Masking on
 * the way IN rather than on the way out means no later reader — a future
 * field, a debug dump, a Redis inspection — can recover the unmasked name,
 * because it was never written. The user id IS stored, and is never
 * returned: it exists only so the caller can be excluded from their own
 * answer.
 *
 * `CACHE_PORT_TOKEN` is `@Global()` (`CacheModule`), so this needs no module
 * import beyond the injection itself.
 *
 * @module apps/api/src/bench/application/services
 * @implements {IBenchPresenceService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { CACHE_PORT_TOKEN, type CachePort } from '@openlinker/shared/cache';

import { maskName } from '../../../common/format/mask-name';
import type { IBenchPresenceService } from '../interfaces/bench-presence.service.interface';
import type { BenchPresenceView, BenchPresenceViewer } from '../types/bench-presence.types';

/**
 * How long a ping's claim stays fresh, in seconds.
 *
 * Three times the parcel surface's own 10 s refetch cadence
 * (`BENCH_PARCEL_REFETCH_INTERVAL_MS`), which is the interval presence rides
 * on. That ratio is the whole justification: the window must survive two
 * dropped requests — a warehouse Wi-Fi blip, a tab the browser throttled —
 * or the banner flickers off and on between two packers who are both still
 * standing there, and a banner that flickers is one a packer learns to
 * ignore. It must also be short enough that a packer who walked away stops
 * being advertised promptly; 30 s is the longest a colleague can be named
 * after leaving, which for an advisory "don't both hunt the same unit"
 * warning is comfortably inside the time it takes to act on it.
 */
const PRESENCE_TTL_SEC = 30;

/**
 * A defensive ceiling on roster size. Pruning by freshness already bounds it
 * to "distinct packers who pinged this one parcel in the last 30 s", which
 * cannot realistically be large — this only stops a pathological client from
 * growing one Redis value without limit. The freshest entries win, because
 * the stale ones are the ones about to be pruned anyway.
 */
const MAX_TRACKED_VIEWERS = 16;

interface PresenceEntry {
  /** Stored to exclude the caller from their own answer. Never returned. */
  readonly userId: string;
  /** Already masked — see the module docblock. */
  readonly displayName: string;
  /** ISO-8601. This entry's own freshness, independent of the key's TTL. */
  readonly at: string;
}

interface PresenceRoster {
  readonly viewers: readonly PresenceEntry[];
}

@Injectable()
export class BenchPresenceService implements IBenchPresenceService {
  constructor(
    @Inject(CACHE_PORT_TOKEN)
    private readonly cache: CachePort
  ) {}

  async ping(workId: string, userId: string, displayName: string): Promise<BenchPresenceView> {
    const key = this.keyFor(workId);
    const now = Date.now();

    const others = this.readOthers(await this.cache.get<unknown>(key), userId, now);

    const roster: PresenceRoster = {
      viewers: [
        { userId, displayName: maskName(displayName), at: new Date(now).toISOString() },
        ...others,
      ].slice(0, MAX_TRACKED_VIEWERS),
    };
    await this.cache.set<PresenceRoster>(key, roster, PRESENCE_TTL_SEC);

    return {
      collision: others.length > 0,
      // Only the masked name crosses this boundary — the stored user id and
      // the entry's instant stay inside the service.
      others: others.map((entry): BenchPresenceViewer => ({ displayName: entry.displayName })),
    };
  }

  /**
   * Everyone but the caller who is still fresh, most recently seen first.
   *
   * Reads the cached value as `unknown` and coerces, rather than trusting
   * `get<PresenceRoster>`: a cache is a shared store this process does not
   * own the history of, and on the deploy that introduces this shape it
   * legitimately holds #3406's `{ userId, at }` single-claim value. Coercing
   * turns that into an empty roster — one banner-free ping, then correct —
   * where a cast would have thrown `TypeError` on the parcel surface's own
   * poll.
   */
  private readOthers(raw: unknown, callerUserId: string, now: number): readonly PresenceEntry[] {
    if (typeof raw !== 'object' || raw === null) return [];
    const viewers = (raw as { viewers?: unknown }).viewers;
    if (!Array.isArray(viewers)) return [];

    return viewers
      .filter((entry): entry is PresenceEntry => this.isFreshEntry(entry, callerUserId, now))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, MAX_TRACKED_VIEWERS);
  }

  private isFreshEntry(entry: unknown, callerUserId: string, now: number): boolean {
    if (typeof entry !== 'object' || entry === null) return false;
    const { userId, displayName, at } = entry as Record<string, unknown>;
    if (typeof userId !== 'string' || typeof displayName !== 'string' || typeof at !== 'string') {
      return false;
    }
    // The caller is never in their own answer, and their previous entry is
    // replaced rather than kept — one entry per packer.
    if (userId === callerUserId) return false;

    const seenAt = Date.parse(at);
    // An unparseable instant is dropped, not kept: a corrupt entry that
    // cannot be aged out would name a colleague who left for as long as
    // anyone keeps the parcel open.
    if (Number.isNaN(seenAt)) return false;
    return now - seenAt < PRESENCE_TTL_SEC * 1000;
  }

  private keyFor(workId: string): string {
    return `bench:viewing:${workId}`;
  }
}
