/**
 * MCP Rate Limiter
 *
 * Redis-backed per-token rate + concurrency cap for MCP tool calls (#1487).
 *
 * Why the raw `'REDIS_CLIENT'` (not the shared `CachePort`): both limits are
 * intrinsically sorted-set operations (score-ordered eviction + cardinality
 * count), which the KV `CachePort` (`get`/`set`/`delete`) cannot express.
 * This follows the established precedent of `RedisPickupPointQueryStatsAdapter`
 * — `'REDIS_CLIENT'` is a `@Global` export of `RedisConfigModule`. If a second
 * rate-limiting consumer appears, promote a `RateLimiterPort` into
 * `@openlinker/shared/cache`; do NOT "fix" this back to `CachePort`.
 *
 * BOTH limits use the SAME ZSET primitive, deliberately:
 *
 *   - rate:     members are call ids scored by start time; count = ZCARD after
 *               evicting everything older than the window.
 *   - in-flight: members are call ids scored by start time; count = ZCARD after
 *               evicting everything older than MAX_CALL_LIFETIME (a crashed
 *               request ages out); release = ZREM.
 *
 * Both are enforced by CLAIM-THEN-RANK (add self, read own ZRANK, remove self
 * if the rank is outside budget) rather than check-then-act, so the bound holds
 * under a concurrent burst. The advertised limits are real ceilings, not
 * approximations — see `claimRank` for why rank, and `buildMember` for why the
 * member encodes arrival order.
 *
 * An earlier draft used INCR/DECR with a TTL for concurrency. That leaks: a TTL
 * expires the SHARED counter (dropping live requests' slots), and a DECR
 * arriving after expiry drives the key negative, silently raising the effective
 * cap. ZREM is also idempotent, so a double release is harmless.
 *
 * @module apps/api/src/mcp/tools/ratelimit
 * @implements {IMcpRateLimiter}
 */
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisClientType } from 'redis';
import { Logger } from '@openlinker/shared/logging';

import type { IMcpRateLimiter, McpRateLimitLease } from './mcp-rate-limiter.interface';

const RATE_KEY_PREFIX = 'mcp:ratelimit:';
const INFLIGHT_KEY_PREFIX = 'mcp:inflight:';

const DEFAULT_RATE_LIMIT = 120;
const DEFAULT_RATE_WINDOW_SECONDS = 60;
const DEFAULT_CONCURRENCY_LIMIT = 8;

/**
 * How long an in-flight entry may live before it is presumed orphaned by a
 * crashed request. Generous relative to any realistic OL-store read — the
 * cost of evicting too early is over-admission, not a stuck slot.
 */
const MAX_CALL_LIFETIME_SECONDS = 120;

const NOOP_LEASE: McpRateLimitLease = {
  allowed: true,
  release: () => Promise.resolve(),
};

/**
 * Per-process arrival counter, used only to order calls that land in the SAME
 * millisecond. See `buildMember`.
 */
let arrivalSequence = 0;

/**
 * Build the ZSET member for one call.
 *
 * The member is `{ms}-{seq}-{uuid}`, zero-padded so that LEXICOGRAPHIC order
 * equals ARRIVAL order. This matters because the limiter admits by ZRANK, and
 * Redis breaks equal scores lexicographically by member: `Date.now()` has
 * millisecond resolution, so several calls routinely share a score, and ranking
 * them by a raw UUID would let a later arrival take a lower rank than one
 * already admitted — over-admitting past the cap. Encoding arrival order into
 * the member makes the tie-break meaningful instead of arbitrary.
 *
 * `ms` is padded to 13 digits (stable until the year 2286) and `seq` to 6, so
 * neither field's width can shift and break the lexicographic ordering.
 */
function buildMember(nowMs: number): string {
  arrivalSequence = (arrivalSequence + 1) % 1_000_000;
  const ms = String(nowMs).padStart(13, '0');
  const seq = String(arrivalSequence).padStart(6, '0');
  return `${ms}-${seq}-${randomUUID()}`;
}

/** Read a positive-integer env var, clamped; falls back on anything invalid. */
function readPositiveInt(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
}

@Injectable()
export class McpRateLimiter implements IMcpRateLimiter {
  private readonly logger = new Logger(McpRateLimiter.name);

  private readonly rateLimit = readPositiveInt('OL_MCP_RATE_LIMIT', DEFAULT_RATE_LIMIT, 10_000);
  private readonly rateWindowSeconds = readPositiveInt(
    'OL_MCP_RATE_WINDOW_SECONDS',
    DEFAULT_RATE_WINDOW_SECONDS,
    3_600
  );
  private readonly concurrencyLimit = readPositiveInt(
    'OL_MCP_CONCURRENCY_LIMIT',
    DEFAULT_CONCURRENCY_LIMIT,
    1_000
  );

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: RedisClientType
  ) {}

  /**
   * Evict expired members, claim a slot for `callId`, and return this caller's
   * RANK within the set (0-based, ordered by score = arrival time).
   *
   * Rank, not count, is what makes the bound correct under a burst. Two wrong
   * approaches were tried first:
   *
   *  - **check-then-act** (ZCARD → compare → ZADD): nothing is held between
   *    the read and the write, so N racing callers all see `count < limit` and
   *    all admit. Over-admits without bound — which defeats the entire purpose
   *    of a concurrency cap.
   *  - **claim-then-count** (ZADD → ZCARD → compare): under *perfect*
   *    simultaneity every caller observes the full set including all its
   *    rivals, so all of them exceed the limit and ALL reject. A burst of 20
   *    against a limit of 3 admits zero — a livelock, strictly worse than
   *    over-admitting.
   *
   * Rank is stable no matter how many others join concurrently: it is fixed by
   * score ordering, so the `limit` earliest callers get ranks 0..limit-1 and
   * are admitted while the rest see rank >= limit and roll themselves back.
   * Exactly `limit` win under any interleaving, with no Lua and no lock.
   * Equal-millisecond ties break lexicographically on the member, which
   * `buildMember` constructs to encode arrival order — see its doc.
   *
   * Returns `null` if the member vanished between add and rank (shouldn't
   * happen; treated as a rejection by the caller, which fails safe).
   */
  private async claimRank(
    key: string,
    callId: string,
    nowMs: number,
    evictBefore: number,
    ttlSeconds: number
  ): Promise<number | null> {
    await this.redisClient.zRemRangeByScore(key, 0, evictBefore);
    await this.redisClient.zAdd(key, { score: nowMs, value: callId });
    await this.redisClient.expire(key, ttlSeconds);
    return this.redisClient.zRank(key, callId);
  }

  async acquire(mcpTokenId: string): Promise<McpRateLimitLease> {
    const nowMs = Date.now();
    const callId = buildMember(nowMs);
    const rateKey = `${RATE_KEY_PREFIX}${mcpTokenId}`;
    const inflightKey = `${INFLIGHT_KEY_PREFIX}${mcpTokenId}`;

    try {
      // --- Rate window ---------------------------------------------------
      const rateRank = await this.claimRank(
        rateKey,
        callId,
        nowMs,
        nowMs - this.rateWindowSeconds * 1_000,
        this.rateWindowSeconds
      );
      if (rateRank === null || rateRank >= this.rateLimit) {
        // Give the budget back — a rejected call must not hold a slot in the
        // window, or a token over its limit would stay locked out longer than
        // the window itself.
        await this.redisClient.zRem(rateKey, callId);
        return {
          allowed: false,
          reason: `Rate limit exceeded: at most ${this.rateLimit} tool calls per ${this.rateWindowSeconds}s for this token. Retry shortly.`,
          release: () => Promise.resolve(),
        };
      }

      // --- Concurrency ---------------------------------------------------
      const inflightRank = await this.claimRank(
        inflightKey,
        callId,
        nowMs,
        nowMs - MAX_CALL_LIFETIME_SECONDS * 1_000,
        MAX_CALL_LIFETIME_SECONDS
      );
      if (inflightRank === null || inflightRank >= this.concurrencyLimit) {
        // Roll back BOTH claims: this call never runs, so it owes neither an
        // in-flight slot nor a rate-window entry.
        await this.redisClient.zRem(inflightKey, callId);
        await this.redisClient.zRem(rateKey, callId);
        return {
          allowed: false,
          reason: `Too many concurrent tool calls: at most ${this.concurrencyLimit} may be in flight for this token. Wait for an in-flight call to finish.`,
          release: () => Promise.resolve(),
        };
      }

      // Admitted. The rate entry is never removed on release (the window is
      // time-based, not occupancy-based); only the in-flight entry is.
      return {
        allowed: true,
        release: async (): Promise<void> => {
          try {
            await this.redisClient.zRem(inflightKey, callId);
          } catch (error) {
            // A failed release is self-healing: the entry ages out via
            // MAX_CALL_LIFETIME_SECONDS. Warn, never throw — the tool call
            // itself already succeeded and must not be failed by cleanup.
            this.logger.warn(
              `Failed to release MCP in-flight slot; it will age out. ${(error as Error).message}`
            );
          }
        },
      };
    } catch (error) {
      // FAIL OPEN. See the interface doc: the limiter is abuse mitigation,
      // not an authorization control.
      this.logger.warn(
        `MCP rate limiter unavailable — failing open for this call. ${(error as Error).message}`
      );
      return NOOP_LEASE;
    }
  }
}
