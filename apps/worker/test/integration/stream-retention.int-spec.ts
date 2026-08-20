/**
 * Stream Retention Integration Test
 *
 * Asserts that Redis actually bounds a stream, not merely that a `TRIM` option
 * object was constructed (#2163). Every unit-level assertion about the options
 * shape can pass while trimming does nothing — a wrong strategy name, a wrong
 * modifier, node-redis option drift, a zero threshold — so the property that
 * matters has to be observed against a real server.
 *
 * @module apps/worker/test/integration
 */
import { randomUUID } from 'crypto';

import {
  REDIS_STREAM_NAMES,
  streamTrimOptions,
  STREAM_NODE_MAX_ENTRIES,
  type StreamTrimOptions,
} from '@openlinker/shared/redis';

import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { WorkerIntegrationTestHarness } from './setup';

describe('Stream retention (#2163)', () => {
  let harness: WorkerIntegrationTestHarness;
  let redis: {
    xAdd: (
      key: string,
      id: string,
      fields: Record<string, string>,
      options?: StreamTrimOptions
    ) => Promise<string | null>;
    xLen: (key: string) => Promise<number>;
    xRange: (key: string, start: string, end: string) => Promise<unknown>;
  };

  beforeAll(async () => {
    harness = await getTestHarness();
    redis = harness.getRedisClient() as unknown as typeof redis;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should bound a count-limited stream well below the number of entries written', async () => {
    const stream = `test.retention.${randomUUID()}`;
    const cap = 200;
    const written = 3_000;
    const options: StreamTrimOptions = {
      TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: cap },
    };

    // Issued in concurrent batches: 3k sequential round-trips take minutes, and
    // what is under test is Redis's trimming, not this loop's pacing.
    for (let batch = 0; batch < written; batch += 250) {
      await Promise.all(
        Array.from({ length: 250 }, (_unused, i) =>
          redis.xAdd(stream, '*', { i: String(batch + i) }, options)
        )
      );
    }

    const length = await redis.xLen(stream);

    // `~` stops at a macro-node boundary rather than trimming exactly, so the
    // assertion is a band: comfortably bounded, never the full write count.
    expect(length).toBeGreaterThanOrEqual(cap);
    expect(length).toBeLessThan(cap + 10 * STREAM_NODE_MAX_ENTRIES);
    expect(length).toBeLessThan(written);
  });

  it('should bound a stream that carries no explicit registry entry', async () => {
    // The #2163 inversion, observed at the Redis level rather than in an
    // options object: an unregistered stream is bounded by the default.
    const stream = `test.unregistered.${randomUUID()}`;
    const options = streamTrimOptions(stream);
    const written = 200;

    for (let i = 0; i < written; i += 1) {
      await redis.xAdd(stream, '*', { i: String(i) }, options);
    }

    expect(options.TRIM.strategy).toBe('MAXLEN');
    expect(await redis.xLen(stream)).toBeGreaterThan(0);
  });

  it('should drop an entry older than a MINID horizon while keeping a fresh one', async () => {
    const stream = `test.minid.${randomUUID()}`;
    const now = Date.now();

    // Explicit ids so age is controlled rather than raced. jobs.sync and the
    // master-deletion DLQ are bounded this way precisely so that what gets
    // trimmed is decided by age, not by how many entries arrived after it.
    const oldId = `${now - 60 * 24 * 60 * 60 * 1000}-0`;
    const freshId = `${now}-0`;

    await redis.xAdd(stream, oldId, { age: 'old' });
    await redis.xAdd(stream, freshId, { age: 'fresh' });
    expect(await redis.xLen(stream)).toBe(2);

    // A write is what applies retention — trimming is lazy, never a background task.
    //
    // EXACT (`=`) here, deliberately. Approximate trimming works on whole macro
    // nodes for MINID exactly as it does for MAXLEN, so with three entries in a
    // single node `~` trims nothing at all and the age semantics under test
    // would be invisible. Production uses `~` because its streams are orders of
    // magnitude past one node, where the distinction costs nothing.
    await redis.xAdd(
      stream,
      `${now + 1}-0`,
      { age: 'trigger' },
      {
        TRIM: {
          strategy: 'MINID',
          strategyModifier: '=',
          threshold: now - 30 * 24 * 60 * 60 * 1000,
        },
      }
    );

    const remaining = (await redis.xRange(stream, '-', '+')) as Array<{
      message: Record<string, string>;
    }>;
    const ages = remaining.map((entry) => entry.message.age);

    expect(ages).not.toContain('old');
    expect(ages).toContain('fresh');
  });

  it('should keep the jobs.sync horizon far enough back that a recent job survives', async () => {
    // The property B1 rests on: an entry the consumer has not reached yet must
    // not be trimmed out from under it. Only entries older than the dedup TTL
    // — and therefore re-enqueueable — are eligible.
    const stream = `test.jobssync.${randomUUID()}`;
    const now = Date.now();
    const options = streamTrimOptions(REDIS_STREAM_NAMES.jobsSync, now);

    const recentId = `${now - 60 * 60 * 1000}-0`;
    await redis.xAdd(stream, recentId, { jobType: 'recent' });
    await redis.xAdd(stream, `${now}-0`, { jobType: 'trigger' }, options);

    expect(await redis.xLen(stream)).toBe(2);
  });
});
