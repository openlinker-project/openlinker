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

  async acquire(mcpTokenId: string): Promise<McpRateLimitLease> {
    const callId = randomUUID();
    const nowMs = Date.now();
    const rateKey = `${RATE_KEY_PREFIX}${mcpTokenId}`;
    const inflightKey = `${INFLIGHT_KEY_PREFIX}${mcpTokenId}`;

    try {
      // --- Rate window ---------------------------------------------------
      await this.redisClient.zRemRangeByScore(rateKey, 0, nowMs - this.rateWindowSeconds * 1_000);
      const recentCount = await this.redisClient.zCard(rateKey);
      if (recentCount >= this.rateLimit) {
        return {
          allowed: false,
          reason: `Rate limit exceeded: at most ${this.rateLimit} tool calls per ${this.rateWindowSeconds}s for this token. Retry shortly.`,
          release: () => Promise.resolve(),
        };
      }

      // --- Concurrency ---------------------------------------------------
      await this.redisClient.zRemRangeByScore(
        inflightKey,
        0,
        nowMs - MAX_CALL_LIFETIME_SECONDS * 1_000
      );
      const inflightCount = await this.redisClient.zCard(inflightKey);
      if (inflightCount >= this.concurrencyLimit) {
        return {
          allowed: false,
          reason: `Too many concurrent tool calls: at most ${this.concurrencyLimit} may be in flight for this token. Wait for an in-flight call to finish.`,
          release: () => Promise.resolve(),
        };
      }

      // Admitted — record in both sets. The rate entry is never removed on
      // release (the window is time-based, not occupancy-based); only the
      // in-flight entry is.
      await this.redisClient.zAdd(rateKey, { score: nowMs, value: callId });
      await this.redisClient.expire(rateKey, this.rateWindowSeconds);
      await this.redisClient.zAdd(inflightKey, { score: nowMs, value: callId });
      await this.redisClient.expire(inflightKey, MAX_CALL_LIFETIME_SECONDS);

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
