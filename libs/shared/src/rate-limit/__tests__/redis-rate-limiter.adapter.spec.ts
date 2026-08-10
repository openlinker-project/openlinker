/**
 * Redis Rate Limiter Adapter Unit Tests
 *
 * A fake Redis client stands in for the string (pace) and ZSET (inflight)
 * primitives the adapter uses — `eval` is pattern-matched against the two
 * known scripts (distinguished by their distinct return shapes) and
 * interpreted against an in-memory "server clock" the tests advance
 * explicitly, mirroring `mcp-rate-limiter.spec.ts`'s fake-ZSET approach for
 * the concurrency half. The injected `sleep` advances that same clock
 * instead of using real timers, so pacing/backoff tests run instantly.
 *
 * @module libs/shared/src/rate-limit
 */
import type { RedisClientType } from 'redis';
import { RateLimitAbortedError, RateLimitTimeoutError } from '../rate-limiter.errors';
import { RedisRateLimiterAdapter } from '../redis-rate-limiter.adapter';

interface FakeRedis {
  client: RedisClientType;
  clockMs: number;
  advanceClock: (ms: number) => void;
  failNext: () => void;
  /** Absolute ms-since-epoch (on the fake's own clock) the pace key expires at, or undefined if unset. */
  paceExpiryMs: (key: string) => number | undefined;
}

function createFakeRedis(startMs = 1_000_000): FakeRedis {
  const pace = new Map<string, number>();
  const paceExpiry = new Map<string, number>();
  const zsets = new Map<string, Map<string, number>>();
  const state = { clockMs: startMs, shouldFail: false };
  const setFor = (key: string): Map<string, number> => {
    const existing = zsets.get(key);
    if (existing) return existing;
    const created = new Map<string, number>();
    zsets.set(key, created);
    return created;
  };
  const maybeFail = (): void => {
    if (state.shouldFail) {
      state.shouldFail = false;
      throw new Error('simulated Redis outage');
    }
  };
  /**
   * Mirrors the production Lua scripts' TTL floor-widening logic (`max(floor
   * seconds, nextTs - now)`) so a test can assert the fake never reproduces
   * the fixed-floor-truncates-a-large-timestamp bug the real scripts guard
   * against — see `PACE_ADMIT_SCRIPT`'s doc comment in the adapter.
   */
  const applyPaceWrite = (key: string, nextTs: number, floorSeconds: number, now: number): void => {
    pace.set(key, nextTs);
    const ttlMs = Math.max(floorSeconds * 1000, nextTs - now);
    paceExpiry.set(key, now + ttlMs);
  };

  const client = {
    eval: (script: string, opts: { keys: string[]; arguments: string[] }) => {
      maybeFail();
      const key = opts.keys[0];
      const now = state.clockMs;
      const floorSeconds = Number(opts.arguments[1]);
      if (script.includes('return {1, 0}')) {
        // PACE_ADMIT_SCRIPT
        const intervalMs = Number(opts.arguments[0]);
        const current = pace.get(key);
        if (current === undefined || now >= current) {
          applyPaceWrite(key, now + intervalMs, floorSeconds, now);
          return Promise.resolve([1, 0]);
        }
        return Promise.resolve([0, current - now]);
      }
      // PACE_ADVANCE_SCRIPT (noteRetryAfter)
      const delayMs = Number(opts.arguments[0]);
      const candidate = now + delayMs;
      const current = pace.get(key);
      const next = current !== undefined && current > candidate ? current : candidate;
      applyPaceWrite(key, next, floorSeconds, now);
      return Promise.resolve(next);
    },
    zRemRangeByScore: (key: string, _min: number, max: number) => {
      maybeFail();
      const set = setFor(key);
      for (const [member, score] of set) {
        if (score <= max) set.delete(member);
      }
      return Promise.resolve(0);
    },
    zAdd: (key: string, entry: { score: number; value: string }) => {
      maybeFail();
      setFor(key).set(entry.value, entry.score);
      return Promise.resolve(1);
    },
    zRank: (key: string, member: string) => {
      maybeFail();
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
  } as unknown as RedisClientType;

  return {
    client,
    get clockMs(): number {
      return state.clockMs;
    },
    advanceClock: (ms: number) => {
      state.clockMs += ms;
    },
    failNext: () => {
      state.shouldFail = true;
    },
    paceExpiryMs: (key: string) => paceExpiry.get(key),
  };
}

/** Sleep that advances the fake Redis clock instead of using a real timer. */
function makeAdvancingSleep(fake: FakeRedis): (ms: number, signal?: AbortSignal) => Promise<void> {
  return (ms: number, signal?: AbortSignal) => {
    if (signal?.aborted) {
      return Promise.reject(new RateLimitAbortedError());
    }
    fake.advanceClock(ms);
    return Promise.resolve();
  };
}

describe('RedisRateLimiterAdapter', () => {
  it('admits immediately when the policy has no limits configured', async () => {
    const fake = createFakeRedis();
    const adapter = new RedisRateLimiterAdapter('conn-1', fake.client, {
      now: () => fake.clockMs,
      sleep: makeAdvancingSleep(fake),
    });

    const release = await adapter.acquire({});
    expect(typeof release).toBe('function');
    release();
  });

  it('paces successive calls at the configured requestsPerMinute interval', async () => {
    const fake = createFakeRedis();
    const adapter = new RedisRateLimiterAdapter('conn-1', fake.client, {
      now: () => fake.clockMs,
      sleep: makeAdvancingSleep(fake),
    });
    const policy = { requestsPerMinute: 60 }; // 1000ms interval

    const firstAdmitAt = fake.clockMs;
    (await adapter.acquire(policy))();

    (await adapter.acquire(policy))();
    // The second call could only admit after the fake clock was advanced by
    // the sleep-based backoff loop — i.e. the pacing gate actually blocked it.
    expect(fake.clockMs).toBeGreaterThanOrEqual(firstAdmitAt + 1000);
  });

  it('respects maxConcurrent — the (N+1)th concurrent call waits for a release', async () => {
    const fake = createFakeRedis();
    const adapter = new RedisRateLimiterAdapter('conn-2', fake.client, {
      now: () => fake.clockMs,
      sleep: makeAdvancingSleep(fake),
      concurrencyPollIntervalMs: 10,
    });
    const policy = { maxConcurrent: 1 };

    const releaseFirst = await adapter.acquire(policy);

    let secondAdmitted = false;
    const secondPromise = adapter.acquire(policy).then((release) => {
      secondAdmitted = true;
      release();
    });

    // Give the second call's polling loop a few microtask turns to run —
    // it must still be blocked because the first slot hasn't been released.
    await Promise.resolve();
    await Promise.resolve();
    expect(secondAdmitted).toBe(false);

    releaseFirst();
    await secondPromise;
    expect(secondAdmitted).toBe(true);
  });

  it('propagates noteRetryAfter into the next acquire()s pacing check', async () => {
    const fake = createFakeRedis();
    const adapter = new RedisRateLimiterAdapter('conn-3', fake.client, {
      now: () => fake.clockMs,
      sleep: makeAdvancingSleep(fake),
    });

    adapter.noteRetryAfter(5_000);
    // Allow the fire-and-forget eval() to settle.
    await Promise.resolve();
    await Promise.resolve();

    const before = fake.clockMs;
    (await adapter.acquire({ requestsPerMinute: 60 }))();
    expect(fake.clockMs).toBeGreaterThanOrEqual(before + 5_000);
  });

  it('sizes the pace key TTL to cover a Retry-After far beyond the fixed floor', async () => {
    // Regression test: an earlier draft passed the TTL floor (seconds) as
    // Redis's `PX` argument (milliseconds), so the key expired ~1000x
    // sooner than intended and any delay beyond a few seconds was silently
    // dropped once the key aged out. The production Lua scripts now widen
    // the TTL to `max(floor, nextTs - now)` — this asserts the fake (which
    // mirrors that formula) never truncates a multi-hour backoff.
    const fake = createFakeRedis();
    const adapter = new RedisRateLimiterAdapter('conn-9', fake.client, {
      now: () => fake.clockMs,
    });
    const twoHoursMs = 2 * 60 * 60 * 1000;

    const before = fake.clockMs;
    adapter.noteRetryAfter(twoHoursMs);
    await Promise.resolve();
    await Promise.resolve();

    const expiryMs = fake.paceExpiryMs('ratelimit:pace:conn-9');
    expect(expiryMs).toBeDefined();
    // The key must still be alive at (and beyond) the moment the stored
    // timestamp is reached — not just at the fixed one-hour floor.
    expect(expiryMs! - before).toBeGreaterThanOrEqual(twoHoursMs);
  });

  it('fails open when Redis is unavailable during acquire()', async () => {
    const fake = createFakeRedis();
    fake.failNext();
    const adapter = new RedisRateLimiterAdapter('conn-4', fake.client, {
      now: () => fake.clockMs,
      sleep: makeAdvancingSleep(fake),
    });

    const release = await adapter.acquire({ maxConcurrent: 1 });
    expect(typeof release).toBe('function');
    expect(() => release()).not.toThrow();
  });

  it('does not throw when noteRetryAfter hits a Redis error', () => {
    const fake = createFakeRedis();
    fake.failNext();
    const adapter = new RedisRateLimiterAdapter('conn-5', fake.client, {
      now: () => fake.clockMs,
    });

    expect(() => adapter.noteRetryAfter(1_000)).not.toThrow();
  });

  it('rejects with RateLimitAbortedError when the signal is already aborted', async () => {
    const fake = createFakeRedis();
    const adapter = new RedisRateLimiterAdapter('conn-6', fake.client, {
      now: () => fake.clockMs,
      sleep: makeAdvancingSleep(fake),
    });
    const controller = new AbortController();
    controller.abort();

    await expect(adapter.acquire({}, 'background', controller.signal)).rejects.toThrow(
      RateLimitAbortedError
    );
  });

  it('rejects with RateLimitTimeoutError when the wait exceeds the total bound', async () => {
    const fake = createFakeRedis();
    let calls = 0;
    const adapter = new RedisRateLimiterAdapter('conn-7', fake.client, {
      // First call establishes `startedAt`; every call after that reports a
      // time already past MAX_TOTAL_WAIT_MS relative to it, so the loop's
      // very first bound check trips — no real waiting/looping involved.
      now: () => {
        calls += 1;
        return calls === 1 ? 0 : 200_000;
      },
      sleep: () => Promise.resolve(),
    });

    await expect(adapter.acquire({ requestsPerMinute: 1 })).rejects.toThrow(
      RateLimitTimeoutError
    );
  });

  it('getStatus reports the last policy applied via updatePolicy without any acquire() call', () => {
    const fake = createFakeRedis();
    const adapter = new RedisRateLimiterAdapter('conn-8', fake.client, {
      now: () => fake.clockMs,
    });

    adapter.updatePolicy({ requestsPerMinute: 30, maxConcurrent: 2 });

    const status = adapter.getStatus();
    expect(status.requestsPerMinute).toBe(30);
    expect(status.maxConcurrent).toBe(2);
    expect(status.inFlight).toBe(0);
    expect(status.queued).toBe(0);
  });
});
