/**
 * Rate Limiter Registry
 *
 * Synchronous `Map`-backed lookup-then-create, race-safe on the single-
 * threaded event loop (mirrors the shipped `PrestashopRateLimiterRegistry`
 * shape from #1815). One limiter instance per connection; `get()` always
 * pushes the live policy into the existing instance rather than replacing
 * it, so in-flight/queued state survives a policy change.
 *
 * Two factories share the same `RateLimiterRegistry` shape:
 * `createRateLimiterRegistry` (in-memory, single-process — `RateLimiter`)
 * and `createRedisRateLimiterRegistry` (Redis-backed, shared across
 * processes — `RedisRateLimiterAdapter`, #2015). Callers depend only on
 * the interface; DI wiring (`libs/plugin-sdk/src/rate-limit.module.ts`)
 * decides which factory backs it.
 *
 * `createRateLimiterRegistry` itself has no production DI wiring today —
 * `RateLimitModule` resolves only the Redis-backed factory below. It is
 * NOT dead code: `RateLimiter` (the class, not this factory) is composed
 * directly inside `RedisRateLimiterAdapter` as its private per-instance
 * "insurance limiter" — the fail-DEGRADED fallback used whenever Redis is
 * unreachable or a call times out (see that adapter's class doc). This
 * factory function stays as the deliberate single-process alternative for
 * a future `OL_RATE_LIMIT_BACKEND=memory|redis` switch, should an operator
 * ever need one during a Redis incident; it is not presented as an equal
 * peer to the Redis factory in current production wiring.
 *
 * @module libs/shared/src/rate-limit
 */
import type { RedisClientType } from 'redis';
import { RateLimiter } from './rate-limiter';
import type { RateLimiterDeps } from './rate-limiter';
import { RedisRateLimiterAdapter } from './redis-rate-limiter.adapter';
import type { RedisRateLimiterDeps } from './redis-rate-limiter.adapter';
import type { RateLimiterPort } from './rate-limiter.port';
import type { ConnectionRateLimit, RateLimitStatus } from './rate-limiter.types';

export interface RateLimiterRegistry {
  /** Get (or lazily create) the limiter for a connection, with the live policy applied. */
  get(connectionId: string, policy: ConnectionRateLimit): RateLimiterPort;
  /** Pure, in-memory status read — never creates a limiter, never consumes a slot. */
  getStatus(connectionId: string): RateLimitStatus | null;
  /**
   * Drop a connection's limiter so it stops holding memory once the
   * connection is disabled/deleted. Safe to call on an in-flight limiter —
   * any queued/in-flight callers still hold their own reference and resolve
   * normally; only the registry's own entry is removed, so a later `get()`
   * for the same id lazily builds a fresh limiter (idle state, no carried
   * queue).
   */
  evict(connectionId: string): void;
  /** Test-isolation helper. */
  clear(): void;
}

export function createRateLimiterRegistry(deps: RateLimiterDeps = {}): RateLimiterRegistry {
  const limiters = new Map<string, RateLimiter>();

  return {
    get(connectionId: string, policy: ConnectionRateLimit): RateLimiterPort {
      const existing = limiters.get(connectionId);
      if (existing) {
        existing.updatePolicy(policy);
        return existing;
      }
      const limiter = new RateLimiter(policy, deps);
      limiters.set(connectionId, limiter);
      return limiter;
    },
    getStatus(connectionId: string): RateLimitStatus | null {
      return limiters.get(connectionId)?.getStatus() ?? null;
    },
    evict(connectionId: string): void {
      limiters.delete(connectionId);
    },
    clear(): void {
      limiters.clear();
    },
  };
}

/**
 * Redis-backed registry (#2015) — same lazy-create-and-cache shape as
 * `createRateLimiterRegistry`, backed by `RedisRateLimiterAdapter` instead
 * of the in-memory `RateLimiter`. `evict()`/`clear()` only drop the local
 * object reference; no explicit Redis key cleanup is needed because both
 * the pace key and the inflight ZSET carry their own TTLs (see
 * `redis-rate-limiter.adapter.ts`).
 */
export function createRedisRateLimiterRegistry(
  redisClient: RedisClientType,
  deps: RedisRateLimiterDeps = {}
): RateLimiterRegistry {
  const limiters = new Map<string, RedisRateLimiterAdapter>();

  return {
    get(connectionId: string, policy: ConnectionRateLimit): RateLimiterPort {
      const existing = limiters.get(connectionId);
      if (existing) {
        existing.updatePolicy(policy);
        return existing;
      }
      const limiter = new RedisRateLimiterAdapter(connectionId, redisClient, deps);
      limiter.updatePolicy(policy);
      limiters.set(connectionId, limiter);
      return limiter;
    },
    getStatus(connectionId: string): RateLimitStatus | null {
      return limiters.get(connectionId)?.getStatus() ?? null;
    },
    evict(connectionId: string): void {
      limiters.delete(connectionId);
    },
    clear(): void {
      limiters.clear();
    },
  };
}
