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
    const connectionId = `conn-cross-${Date.now()}`;
    const apiInstance = new RedisRateLimiterAdapter(connectionId, redisClient);
    const workerInstance = new RedisRateLimiterAdapter(connectionId, redisClient, {
      concurrencyPollIntervalMs: 20,
    });
    const policy = { maxConcurrent: 2 };

    const releases = await Promise.all([
      apiInstance.acquire(policy),
      apiInstance.acquire(policy),
      workerInstance.acquire(policy),
      workerInstance.acquire(policy),
    ]);

    // All four eventually admit (none reject), but at no point could more
    // than 2 be in flight at once — asserted below by re-claiming while the
    // first two are still held.
    expect(releases).toHaveLength(4);
    releases.forEach((release) => release());
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

    apiInstance.noteRetryAfter(1_500);
    // Let the fire-and-forget Redis write settle.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const startedAt = Date.now();
    (await workerInstance.acquire({ maxConcurrent: 5 }))();
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_400);
  }, 15_000);
});
