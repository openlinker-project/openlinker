/**
 * Redis Rate Limiter Adapter Unit Tests
 *
 * A fake Redis client stands in for the string (pace) key and the atomic
 * concurrency-claim script — `eval` is pattern-matched against the three
 * known scripts (distinguished by a unique substring each) and interpreted
 * against an in-memory "server clock" the tests advance explicitly. The
 * injected `sleep` advances that same clock instead of using real timers, so
 * pacing/backoff tests run instantly.
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
  failNext: (times?: number) => void;
  /** Absolute ms-since-epoch (on the fake's own clock) the pace key expires at, or undefined if unset. */
  paceExpiryMs: (key: string) => number | undefined;
  /** Current members of an inflight ZSET, ordered by score — for assertions on the concurrency claim script. */
  inflightMembers: (key: string) => string[];
}

function createFakeRedis(startMs = 1_000_000): FakeRedis {
  const pace = new Map<string, number>();
  const paceExpiry = new Map<string, number>();
  const inflightSets = new Map<string, Map<string, number>>();
  const lastScores = new Map<string, number>();
  const state = { clockMs: startMs, failuresRemaining: 0 };
  const setFor = (key: string): Map<string, number> => {
    const existing = inflightSets.get(key);
    if (existing) return existing;
    const created = new Map<string, number>();
    inflightSets.set(key, created);
    return created;
  };
  const maybeFail = (): void => {
    if (state.failuresRemaining > 0) {
      state.failuresRemaining -= 1;
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

  /** Emulates `CONCURRENCY_CLAIM_SCRIPT` — see the adapter's doc comment for the algorithm this mirrors. */
  const evalConcurrencyClaim = (opts: { keys: string[]; arguments: string[] }): [number] => {
    const [inflightKey, lastScoreKey] = opts.keys;
    const maxLifetimeMs = Number(opts.arguments[0]);
    const maxConcurrent = Number(opts.arguments[1]);
    const member = opts.arguments[3];
    const now = state.clockMs;
    const set = setFor(inflightKey);

    for (const [existingMember, score] of set) {
      if (score <= now - maxLifetimeMs) set.delete(existingMember);
    }

    const last = lastScores.get(lastScoreKey);
    let score = now;
    if (last !== undefined && score <= last) {
      score = last + 0.001;
    }
    lastScores.set(lastScoreKey, score);
    set.set(member, score);

    const ordered = [...set.entries()].sort(([, a], [, b]) => a - b);
    const rank = ordered.findIndex(([candidate]) => candidate === member);
    if (rank === -1 || rank >= maxConcurrent) {
      set.delete(member);
      return [0];
    }
    return [1];
  };

  const client = {
    eval: (script: string, opts: { keys: string[]; arguments: string[] }) => {
      maybeFail();
      const now = state.clockMs;
      if (script.includes('local member = ARGV[4]')) {
        return Promise.resolve(evalConcurrencyClaim(opts));
      }
      const key = opts.keys[0];
      const floorSeconds = Number(opts.arguments[1]);
      if (script.includes('local interval = tonumber(ARGV[1])')) {
        // PACE_ADMIT_SCRIPT
        const intervalMs = Number(opts.arguments[0]);
        const current = pace.get(key);
        if (current === undefined || now >= current) {
          if (intervalMs === 0) {
            return Promise.resolve([1, 0]);
          }
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
    zRem: (key: string, member: string) => {
      maybeFail();
      const existed = setFor(key).delete(member);
      return Promise.resolve(existed ? 1 : 0);
    },
  } as unknown as RedisClientType;

  return {
    client,
    get clockMs(): number {
      return state.clockMs;
    },
    advanceClock: (ms: number) => {
      state.clockMs += ms;
    },
    failNext: (times = 1) => {
      state.failuresRemaining = times;
    },
    paceExpiryMs: (key: string) => paceExpiry.get(key),
    inflightMembers: (key: string) =>
      [...setFor(key).entries()].sort(([, a], [, b]) => a - b).map(([member]) => member),
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
    let pollCount = 0;
    const originalEval = (fake.client as unknown as { eval: typeof fake.client.eval }).eval;
    const evalSpy = jest
      .spyOn(fake.client as unknown as { eval: typeof fake.client.eval }, 'eval')
      .mockImplementation((...args: Parameters<typeof originalEval>) => {
        pollCount += 1;
        return originalEval(...args);
      });

    const secondPromise = adapter.acquire(policy).then((release) => {
      secondAdmitted = true;
      release();
    });

    // Deterministically wait for the second call's polling loop to make at
    // least one real attempt (a claim + rollback round trip), asserting on
    // the mechanism (a call actually happened and was rejected) rather than
    // on ambient microtask timing.
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (pollCount > 0) {
          resolve();
          return;
        }
        setImmediate(check);
      };
      check();
    });
    expect(secondAdmitted).toBe(false);
    expect(fake.inflightMembers('ratelimit:inflight:conn-2')).toHaveLength(1);

    releaseFirst();
    await secondPromise;
    expect(secondAdmitted).toBe(true);
    evalSpy.mockRestore();
  });

  it('never admits two claims past the cap even when they land in the same millisecond (regression: UUID-tie-break over-admission)', async () => {
    const fake = createFakeRedis();
    const adapterA = new RedisRateLimiterAdapter('conn-tie', fake.client, {
      now: () => fake.clockMs,
    });
    const adapterB = new RedisRateLimiterAdapter('conn-tie', fake.client, {
      now: () => fake.clockMs,
    });
    const claim = (
      adapter: RedisRateLimiterAdapter,
      maxConcurrent: number,
      callId: string
    ): Promise<{ admitted: boolean }> =>
      (
        adapter as unknown as {
          claimConcurrency: (n: number, callId: string) => Promise<{ admitted: boolean }>;
        }
      ).claimConcurrency(maxConcurrent, callId);

    // Both claims are made against the exact same fake clock millisecond,
    // with distinct callIds (the caller — `acquire` in production — always
    // generates a fresh one per attempt) — the scenario that broke a
    // raw-UUID-tie-break scheme (~50% of trials over-admitted in the
    // reproduction this test is written against).
    const results = await Promise.all([
      claim(adapterA, 1, 'call-a'),
      claim(adapterB, 1, 'call-b'),
    ]);

    const admittedCount = results.filter((r) => r.admitted).length;
    expect(admittedCount).toBe(1);
  });

  it('pollDelayFor stretches a background wait by BACKGROUND_YIELD_JITTER_MS while an interactive waiter is queued on the same instance', () => {
    // Direct unit test of the priority mechanism itself — asserting via two
    // competing real `acquire()` loops is a timing race (either an instant
    // fake-clock sleep free-spins past MAX_TOTAL_WAIT_MS with nothing to
    // bound it, or real timers make the two admission orderings
    // non-deterministic to choreograph in a unit test). `pollDelayFor` is
    // the entire mechanism ADR-038 calls "a local, per-process bias only" —
    // pin it here so it cannot silently rot into a no-op.
    const fake = createFakeRedis();
    const adapter = new RedisRateLimiterAdapter('conn-priority', fake.client, {
      concurrencyPollIntervalMs: 10,
    });
    const internal = adapter as unknown as {
      pollDelayFor: (priority: 'background' | 'interactive', paceWaitMs?: number) => number;
      localInteractiveWaiters: number;
    };

    expect(internal.pollDelayFor('background')).toBe(10);
    expect(internal.pollDelayFor('interactive')).toBe(10);

    internal.localInteractiveWaiters = 1;
    expect(internal.pollDelayFor('background')).toBe(60);
    // An interactive waiter never yields to itself — no jitter is added when
    // priority IS 'interactive', regardless of how many others are queued.
    expect(internal.pollDelayFor('interactive')).toBe(10);
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

  it('skips the Redis pacing round-trip on a fully unconfigured connection once the local grace window is warm', async () => {
    const fake = createFakeRedis();
    const evalSpy = jest.fn(fake.client.eval.bind(fake.client));
    const client = { ...fake.client, eval: evalSpy } as unknown as typeof fake.client;
    const adapter = new RedisRateLimiterAdapter('conn-10', client, {
      now: () => fake.clockMs,
      sleep: makeAdvancingSleep(fake),
    });

    (await adapter.acquire({}))();
    expect(evalSpy).toHaveBeenCalledTimes(1);

    // Well within the default 200ms grace window — the second acquire() must
    // not round-trip to Redis at all for the pacing gate.
    (await adapter.acquire({}))();
    expect(evalSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to Redis for the pacing gate once the local grace window expires', async () => {
    const fake = createFakeRedis();
    const evalSpy = jest.fn(fake.client.eval.bind(fake.client));
    const client = { ...fake.client, eval: evalSpy } as unknown as typeof fake.client;
    const adapter = new RedisRateLimiterAdapter('conn-11', client, {
      now: () => fake.clockMs,
      sleep: makeAdvancingSleep(fake),
      unconfiguredPaceGraceMs: 100,
    });

    (await adapter.acquire({}))();
    expect(evalSpy).toHaveBeenCalledTimes(1);

    fake.advanceClock(150);
    (await adapter.acquire({}))();
    expect(evalSpy).toHaveBeenCalledTimes(2);
  });

  it('noteRetryAfter invalidates the local grace window immediately, even mid-cache', async () => {
    const fake = createFakeRedis();
    const adapter = new RedisRateLimiterAdapter('conn-12', fake.client, {
      now: () => fake.clockMs,
      sleep: makeAdvancingSleep(fake),
    });

    (await adapter.acquire({}))();

    // Still well inside the default grace window, but a Retry-After push
    // for THIS instance must be honoured immediately, not delayed by it.
    adapter.noteRetryAfter(3_000);
    await Promise.resolve();
    await Promise.resolve();

    const before = fake.clockMs;
    (await adapter.acquire({}))();
    expect(fake.clockMs).toBeGreaterThanOrEqual(before + 3_000);
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

  it('falls back to per-process in-memory limiting (degraded, not unthrottled) when Redis is unavailable during acquire()', async () => {
    const fake = createFakeRedis();
    // Fail every Redis call so the adapter never recovers mid-test.
    fake.failNext(100);
    const adapter = new RedisRateLimiterAdapter('conn-4', fake.client, {
      now: () => fake.clockMs,
      sleep: makeAdvancingSleep(fake),
    });

    const release = await adapter.acquire({ maxConcurrent: 1 });
    expect(typeof release).toBe('function');

    // The insurance limiter must still enforce the cap locally — a second
    // concurrent acquire() on the SAME degraded instance must block, not
    // admit unconditionally the way a bare fail-open would.
    let secondAdmitted = false;
    const secondPromise = adapter.acquire({ maxConcurrent: 1 }).then((r) => {
      secondAdmitted = true;
      r();
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondAdmitted).toBe(false);

    release();
    await secondPromise;
    expect(secondAdmitted).toBe(true);
  });

  it('rolls back a concurrency claim by its pre-generated callId even when claimConcurrency itself rejects after the ZADD landed (phantom-slot regression)', async () => {
    // Simulates the scenario a raw `randomUUID()`-inside-`claimConcurrency`
    // design cannot recover from: the script's ZADD lands in Redis, but the
    // client never learns the outcome (a timeout, a dropped response) and
    // the wrapping promise rejects anyway. `acquire()` must still know the
    // member's id — generated by the CALLER before the eval — to roll it
    // back, or it leaks for the full MAX_CALL_LIFETIME_MS.
    let capturedCallId: string | undefined;
    const zRemCalls: string[] = [];
    const client = {
      eval: (script: string, opts: { arguments: string[] }) => {
        if (script.includes('local member = ARGV[4]')) {
          capturedCallId = opts.arguments[3];
          return Promise.reject(new Error('simulated timeout after ZADD landed'));
        }
        return Promise.resolve([1, 0]);
      },
      zRem: (_key: string, member: string) => {
        zRemCalls.push(member);
        return Promise.resolve(1);
      },
    } as unknown as RedisClientType;

    const adapter = new RedisRateLimiterAdapter('conn-leak', client, {
      now: () => Date.now(),
    });

    const release = await adapter.acquire({ maxConcurrent: 1 });
    release();

    expect(capturedCallId).toBeDefined();
    expect(zRemCalls).toEqual([capturedCallId]);
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
