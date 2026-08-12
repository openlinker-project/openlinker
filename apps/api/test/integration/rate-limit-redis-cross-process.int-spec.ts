/**
 * Redis-Backed Rate Limiter — Cross-Process Sharing (#2015)
 *
 * Proves the property unit tests (mocked Redis) cannot: two independent
 * `RedisRateLimiterAdapter` instances — standing in for `apps/api` and
 * `apps/worker` — throttle the same `connectionId` against ONE shared
 * bucket in a real Redis (Testcontainers), for both the concurrency cap
 * and the pacing interval. Against two independent in-memory `RateLimiter`
 * instances this would double-admit; against the Redis-backed adapter it
 * must not.
 *
 * @module apps/api/test/integration
 */
import type { RedisClientType } from 'redis';
import { RedisRateLimiterAdapter } from '@openlinker/shared/rate-limit';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';

describe('Redis rate limiter cross-process sharing', () => {
  let harness: IntegrationTestHarness;
  let redisClient: RedisClientType;

  beforeAll(async () => {
    harness = await getTestHarness();
    redisClient = harness.getApp().get<RedisClientType>('REDIS_CLIENT');
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('shares one maxConcurrent cap across two adapter instances', async () => {
    // Regression (CI run 31472849426): the original version of this test
    // awaited all four acquire() calls via a single Promise.all with no
    // release in between. With maxConcurrent: 2, the 3rd/4th call can only
    // ever admit either via a genuine release or via the inflight ZSET's
    // MAX_CALL_LIFETIME_MS (120s) orphan self-heal — and since nothing was
    // released before the await, it depended entirely on that self-heal,
    // which sits at exactly Jest's default 120000ms test timeout. The test
    // therefore raced its own timeout and reliably failed CI. Rewritten to
    // prove the shared cap the same way the next test does — via an actual
    // release — while still covering BOTH instances holding a slot AND
    // BOTH instances having a caller admitted only after release.
    const connectionId = `conn-cross-${Date.now()}`;
    const apiInstance = new RedisRateLimiterAdapter(connectionId, redisClient);
    const workerInstance = new RedisRateLimiterAdapter(connectionId, redisClient, {
      concurrencyPollIntervalMs: 20,
    });
    const policy = { maxConcurrent: 2 };

    // Both slots claimed by DIFFERENT instances — already proves the two
    // instances observe one shared two-slot cap, not two independent ones
    // (which would let a third/fourth call admit immediately too).
    const releaseA = await apiInstance.acquire(policy);
    const releaseB = await workerInstance.acquire(policy);

    let thirdAdmitted = false;
    let fourthAdmitted = false;
    const thirdPromise = apiInstance.acquire(policy).then((release) => {
      thirdAdmitted = true;
      return release;
    });
    const fourthPromise = workerInstance.acquire(policy).then((release) => {
      fourthAdmitted = true;
      return release;
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(thirdAdmitted).toBe(false);
    expect(fourthAdmitted).toBe(false);

    releaseA();
    releaseB();

    const [releaseC, releaseD] = await Promise.all([thirdPromise, fourthPromise]);
    expect(thirdAdmitted).toBe(true);
    expect(fourthAdmitted).toBe(true);
    releaseC();
    releaseD();
  });

  it('rejects the 3rd concurrent caller while 2 slots are held, admits after a release', async () => {
    const connectionId = `conn-cross-hold-${Date.now()}`;
    const apiInstance = new RedisRateLimiterAdapter(connectionId, redisClient);
    const workerInstance = new RedisRateLimiterAdapter(connectionId, redisClient, {
      concurrencyPollIntervalMs: 20,
    });
    const policy = { maxConcurrent: 2 };

    const releaseA = await apiInstance.acquire(policy);
    const releaseB = await workerInstance.acquire(policy);

    let thirdAdmitted = false;
    const thirdPromise = workerInstance.acquire(policy).then((release) => {
      thirdAdmitted = true;
      release();
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(thirdAdmitted).toBe(false);

    releaseA();
    await thirdPromise;
    expect(thirdAdmitted).toBe(true);

    releaseB();
  });

  it('shares one pacing interval across two adapter instances', async () => {
    const connectionId = `conn-cross-pace-${Date.now()}`;
    const apiInstance = new RedisRateLimiterAdapter(connectionId, redisClient);
    const workerInstance = new RedisRateLimiterAdapter(connectionId, redisClient);
    const policy = { requestsPerMinute: 60 }; // 1000ms minimum interval

    const startedAt = Date.now();
    (await apiInstance.acquire(policy))();
    (await workerInstance.acquire(policy))();

    // The second call landed on a DIFFERENT adapter instance (simulating a
    // different process) yet still had to wait out the shared interval —
    // proving the pacing key, not just the concurrency ZSET, is shared.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(950);
  }, 15_000);

  it('propagates noteRetryAfter from one instance into the other instances next acquire() — even with only maxConcurrent configured', async () => {
    const connectionId = `conn-cross-retry-${Date.now()}`;
    const apiInstance = new RedisRateLimiterAdapter(connectionId, redisClient);
    const workerInstance = new RedisRateLimiterAdapter(connectionId, redisClient);

    // Captured BEFORE the write and the settle-wait below, so the measured
    // wait covers the full 1500ms rather than `1500 - settleMs` — a prior
    // version captured this after the settle and could measure under 1400ms
    // on a loaded CI box where the 50ms settle itself overran.
    const startedAt = Date.now();
    apiInstance.noteRetryAfter(1_500);
    // Let the fire-and-forget Redis write settle.
    await new Promise((resolve) => setTimeout(resolve, 50));

    (await workerInstance.acquire({ maxConcurrent: 5 }))();
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_450);
  }, 15_000);
});
