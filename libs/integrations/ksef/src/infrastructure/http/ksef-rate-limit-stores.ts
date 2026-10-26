/**
 * KSeF Rate-Limit Stores (DEF-05 / DEF-06)
 *
 * Two implementations of {@link KsefRateLimitStore}, one rule: a request is
 * admitted only while fewer than `perHour` were admitted in the last rolling
 * hour. That is an exact sliding-window log, so there is no burst allowance on
 * top of the ceiling - the token bucket this replaces started full AND kept
 * refilling, which admitted about twice the ceiling in its first hour.
 *
 * - {@link InMemoryKsefRateLimitStore}: per process, used in specs and as the
 *   fallback when Redis cannot answer.
 * - {@link RedisKsefRateLimitStore}: one ZSET per `(bucket, category)`, checked
 *   and written by ONE Lua script on Redis's own clock, so the api and every
 *   worker replica draw from the same budget KSeF counts against.
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */
import { randomUUID } from 'node:crypto';
import type {
  KsefRateLimitDemand,
  KsefRateLimitReservation,
  KsefRateLimitStore,
} from './ksef-rate-limiter.types';

/** Exact rolling-window log held in this process. */
export class InMemoryKsefRateLimitStore implements KsefRateLimitStore {
  private readonly logs = new Map<string, number[]>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  tryReserve(
    bucketKey: string,
    demands: readonly KsefRateLimitDemand[],
    windowMs: number,
  ): Promise<KsefRateLimitReservation> {
    const now = this.now();
    let wait = 0;
    for (const demand of demands) {
      const log = this.trimmed(`${bucketKey}:${demand.category}`, now, windowMs);
      if (log.length >= demand.perHour) {
        const freedAt = log[log.length - demand.perHour] + windowMs;
        wait = Math.max(wait, freedAt - now);
      }
    }
    if (wait > 0) {
      return Promise.resolve({ admitted: false, retryAfterMs: Math.ceil(wait) });
    }
    for (const demand of demands) {
      this.trimmed(`${bucketKey}:${demand.category}`, now, windowMs).push(now);
    }
    return Promise.resolve({ admitted: true });
  }

  private trimmed(key: string, now: number, windowMs: number): number[] {
    const log = this.logs.get(key) ?? [];
    let start = 0;
    while (start < log.length && log[start] <= now - windowMs) {
      start++;
    }
    const kept = start === 0 ? log : log.slice(start);
    this.logs.set(key, kept);
    return kept;
  }
}

/**
 * The subset of the node-redis client the Redis store needs, declared
 * structurally so this package takes no dependency on `redis` itself.
 */
export interface KsefRateLimitRedisClient {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

/**
 * KEYS: one sorted set per demanded category. ARGV[1] window ms, ARGV[2] a
 * unique member, ARGV[3..] each key's ceiling. Returns {1, 0} when every key
 * had room (and records the request in all of them) or {0, waitMs} when the
 * slowest key frees a slot in `waitMs`.
 */
const RESERVE_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[1])
local member = ARGV[2]
local wait = 0
for i, key in ipairs(KEYS) do
  local limit = tonumber(ARGV[i + 2])
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
  local count = redis.call('ZCARD', key)
  if count >= limit then
    local edge = redis.call('ZRANGE', key, count - limit, count - limit, 'WITHSCORES')
    local w = tonumber(edge[2]) + window - now
    if w > wait then wait = w end
  end
end
if wait > 0 then
  return {0, wait}
end
for i, key in ipairs(KEYS) do
  redis.call('ZADD', key, now, member .. ':' .. i)
  redis.call('PEXPIRE', key, window)
end
return {1, 0}
`;

export class RedisKsefRateLimitStore implements KsefRateLimitStore {
  constructor(private readonly client: KsefRateLimitRedisClient) {}

  async tryReserve(
    bucketKey: string,
    demands: readonly KsefRateLimitDemand[],
    windowMs: number,
  ): Promise<KsefRateLimitReservation> {
    // The hash tag keeps every category of one bucket in one cluster slot, which
    // a multi-key script requires.
    const keys = demands.map((d) => `ksef:rl:{${bucketKey}}:${d.category}`);
    const result = (await this.client.eval(RESERVE_SCRIPT, {
      keys,
      arguments: [String(windowMs), randomUUID(), ...demands.map((d) => String(d.perHour))],
    })) as [number, number];
    const [admitted, waitMs] = result;
    return admitted === 1 ? { admitted: true } : { admitted: false, retryAfterMs: Math.max(1, Number(waitMs)) };
  }
}
