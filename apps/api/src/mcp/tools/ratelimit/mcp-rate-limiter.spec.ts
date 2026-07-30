/**
 * McpRateLimiter Unit Tests
 *
 * The interesting cases are the failure modes: a crashed request must not
 * leak a concurrency slot, a Redis outage must not take down the MCP surface,
 * and release must be idempotent.
 */
import type { RedisClientType } from 'redis';

import { McpRateLimiter } from './mcp-rate-limiter';

/** Minimal in-memory stand-in for the ZSET commands the limiter uses. */
function fakeRedis(): RedisClientType & { sets: Map<string, Map<string, number>> } {
  const sets = new Map<string, Map<string, number>>();
  const setFor = (key: string): Map<string, number> => {
    const existing = sets.get(key);
    if (existing) return existing;
    const created = new Map<string, number>();
    sets.set(key, created);
    return created;
  };
  const client = {
    sets,
    zRemRangeByScore: (key: string, _min: number, max: number) => {
      const set = setFor(key);
      for (const [member, score] of set) {
        if (score <= max) set.delete(member);
      }
      return Promise.resolve(0);
    },
    zCard: (key: string) => Promise.resolve(setFor(key).size),
    zAdd: (key: string, entry: { score: number; value: string }) => {
      setFor(key).set(entry.value, entry.score);
      return Promise.resolve(1);
    },
    // Rank = position in (score, member) order — Redis breaks equal scores
    // lexicographically by member, which the limiter relies on for
    // deterministic tie-breaking between simultaneous callers.
    zRank: (key: string, member: string) => {
      const ordered = [...setFor(key).entries()].sort(
        ([memberA, scoreA], [memberB, scoreB]) =>
          scoreA - scoreB || memberA.localeCompare(memberB)
      );
      const index = ordered.findIndex(([candidate]) => candidate === member);
      return Promise.resolve(index === -1 ? null : index);
    },
    zRem: (key: string, member: string) => {
      setFor(key).delete(member);
      return Promise.resolve(1);
    },
    expire: () => Promise.resolve(true),
  };
  return client as unknown as RedisClientType & { sets: Map<string, Map<string, number>> };
}

describe('McpRateLimiter', () => {
  const OLD_ENV = process.env;

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('should admit a call under both limits', async () => {
    const limiter = new McpRateLimiter(fakeRedis());

    const lease = await limiter.acquire('tok-1');

    expect(lease.allowed).toBe(true);
  });

  it('should refuse once the concurrency cap is reached', async () => {
    process.env = { ...OLD_ENV, OL_MCP_CONCURRENCY_LIMIT: '2' };
    const limiter = new McpRateLimiter(fakeRedis());

    await limiter.acquire('tok-1');
    await limiter.acquire('tok-1');
    const third = await limiter.acquire('tok-1');

    expect(third.allowed).toBe(false);
    expect(third.reason).toContain('concurrent');
  });

  it('should free the slot on release so the next call is admitted', async () => {
    process.env = { ...OLD_ENV, OL_MCP_CONCURRENCY_LIMIT: '1' };
    const limiter = new McpRateLimiter(fakeRedis());

    const first = await limiter.acquire('tok-1');
    expect((await limiter.acquire('tok-1')).allowed).toBe(false);

    await first.release();

    expect((await limiter.acquire('tok-1')).allowed).toBe(true);
  });

  it('should tolerate a double release rather than corrupting the count', async () => {
    process.env = { ...OLD_ENV, OL_MCP_CONCURRENCY_LIMIT: '1' };
    const redis = fakeRedis();
    const limiter = new McpRateLimiter(redis);

    const lease = await limiter.acquire('tok-1');
    await lease.release();
    await lease.release();

    expect(redis.sets.get('mcp:inflight:tok-1')?.size ?? 0).toBe(0);
    expect((await limiter.acquire('tok-1')).allowed).toBe(true);
  });

  it('should age out a slot whose request crashed without releasing', async () => {
    process.env = { ...OLD_ENV, OL_MCP_CONCURRENCY_LIMIT: '1' };
    const redis = fakeRedis();
    const limiter = new McpRateLimiter(redis);

    await limiter.acquire('tok-1'); // never released — simulates a crash
    expect((await limiter.acquire('tok-1')).allowed).toBe(false);

    // Advance past MAX_CALL_LIFETIME_SECONDS (120s).
    const realNow = Date.now;
    Date.now = () => realNow() + 121_000;
    try {
      expect((await limiter.acquire('tok-1')).allowed).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it('should refuse once the rate window is exhausted', async () => {
    process.env = { ...OLD_ENV, OL_MCP_RATE_LIMIT: '2' };
    const limiter = new McpRateLimiter(fakeRedis());

    const first = await limiter.acquire('tok-1');
    await first.release();
    const second = await limiter.acquire('tok-1');
    await second.release();

    const third = await limiter.acquire('tok-1');

    // Releasing frees CONCURRENCY, not the time-based rate window.
    expect(third.allowed).toBe(false);
    expect(third.reason).toContain('Rate limit');
  });

  it('should meter each token independently', async () => {
    process.env = { ...OLD_ENV, OL_MCP_CONCURRENCY_LIMIT: '1' };
    const limiter = new McpRateLimiter(fakeRedis());

    await limiter.acquire('tok-1');

    expect((await limiter.acquire('tok-2')).allowed).toBe(true);
  });

  describe('under concurrency', () => {
    // These are the cases a sequential test cannot catch. The original
    // check-then-act implementation passed every sequential assertion above
    // while admitting far more than the cap under a simultaneous burst —
    // exactly the scenario a concurrency cap exists for.

    it('should admit no more than the concurrency limit when calls race', async () => {
      process.env = { ...OLD_ENV, OL_MCP_CONCURRENCY_LIMIT: '3' };
      const limiter = new McpRateLimiter(fakeRedis());

      const leases = await Promise.all(
        Array.from({ length: 20 }, () => limiter.acquire('tok-1'))
      );

      expect(leases.filter((lease) => lease.allowed)).toHaveLength(3);
    });

    it('should admit no more than the rate limit when calls race', async () => {
      process.env = { ...OLD_ENV, OL_MCP_RATE_LIMIT: '5', OL_MCP_CONCURRENCY_LIMIT: '100' };
      const limiter = new McpRateLimiter(fakeRedis());

      const leases = await Promise.all(
        Array.from({ length: 20 }, () => limiter.acquire('tok-1'))
      );

      expect(leases.filter((lease) => lease.allowed)).toHaveLength(5);
    });

    it('should not consume rate budget for a call rejected on concurrency', async () => {
      // A call rolled back on the concurrency check must return its rate-window
      // entry too, or a burst would lock the token out for a whole window
      // despite almost none of those calls having run.
      process.env = { ...OLD_ENV, OL_MCP_RATE_LIMIT: '10', OL_MCP_CONCURRENCY_LIMIT: '2' };
      const redis = fakeRedis();
      const limiter = new McpRateLimiter(redis);

      const leases = await Promise.all(
        Array.from({ length: 8 }, () => limiter.acquire('tok-1'))
      );
      expect(leases.filter((lease) => lease.allowed)).toHaveLength(2);

      // Only the 2 admitted calls should be holding rate-window entries.
      expect(redis.sets.get('mcp:ratelimit:tok-1')?.size ?? 0).toBe(2);
    });

    it('should free slots for a later wave once the first wave releases', async () => {
      process.env = { ...OLD_ENV, OL_MCP_CONCURRENCY_LIMIT: '3' };
      const limiter = new McpRateLimiter(fakeRedis());

      const first = await Promise.all(Array.from({ length: 3 }, () => limiter.acquire('tok-1')));
      await Promise.all(first.map((lease) => lease.release()));

      const second = await Promise.all(Array.from({ length: 3 }, () => limiter.acquire('tok-1')));

      expect(second.filter((lease) => lease.allowed)).toHaveLength(3);
    });
  });

  it('should fail OPEN when Redis is unavailable', async () => {
    const broken = {
      zRemRangeByScore: () => Promise.reject(new Error('ECONNREFUSED')),
    } as unknown as RedisClientType;
    const limiter = new McpRateLimiter(broken);

    const lease = await limiter.acquire('tok-1');

    // Abuse mitigation, not authorization — auth is enforced upstream, so an
    // outage must not take down the whole authenticated MCP surface.
    expect(lease.allowed).toBe(true);
    await expect(lease.release()).resolves.toBeUndefined();
  });

  it('should ignore an invalid env override rather than disabling the limit', async () => {
    process.env = { ...OLD_ENV, OL_MCP_CONCURRENCY_LIMIT: 'not-a-number' };
    const limiter = new McpRateLimiter(fakeRedis());

    // Falls back to the default (8), so a 9th concurrent call is refused.
    for (let i = 0; i < 8; i += 1) {
      await limiter.acquire('tok-1');
    }

    expect((await limiter.acquire('tok-1')).allowed).toBe(false);
  });
});
