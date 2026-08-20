/**
 * Stream Consumer Recovery Integration Test
 *
 * Proves the #2164 defect fixed against a real Redis: before this change every
 * consumer read with `id: '>'` (never-delivered entries only) and nothing in the
 * repository ever called `XPENDING` / `XAUTOCLAIM`, so a process killed between
 * read and ACK lost its in-flight message permanently.
 *
 * These assertions depend on real Pending-Entries-List semantics, which a mocked
 * client cannot express — the whole defect was a wrong belief about what Redis
 * does on its own ("message will be re-delivered after timeout"; it is not).
 *
 * @module apps/worker/test/integration
 */
import { randomUUID } from 'crypto';

import {
  ackTrimmed,
  nextPendingCursor,
  readOwnPending,
  reclaimOrphans,
  resolveConsumerName,
  type StreamConsumerClient,
} from '@openlinker/shared/redis';

import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { WorkerIntegrationTestHarness } from './setup';

describe('Stream consumer recovery (#2164)', () => {
  let harness: WorkerIntegrationTestHarness;
  let redis: StreamConsumerClient & {
    xReadGroup: (
      group: string,
      consumer: string,
      streams: Array<{ key: string; id: string }>,
      options?: { COUNT?: number }
    ) => Promise<unknown>;
    xAdd: (key: string, id: string, fields: Record<string, string>) => Promise<string>;
    xGroupCreate: (
      key: string,
      group: string,
      id: string,
      options?: { MKSTREAM?: boolean }
    ) => Promise<unknown>;
    xLen: (key: string) => Promise<number>;
    xTrim: (key: string, strategy: string, threshold: number) => Promise<number>;
    del: (key: string) => Promise<number>;
  };

  const GROUP = 'recovery-test-group';

  /** A fresh stream per test keeps PEL state from leaking across cases. */
  const freshStream = async (): Promise<string> => {
    const stream = `test.recovery.${randomUUID()}`;
    await redis.xGroupCreate(stream, GROUP, '$', { MKSTREAM: true });
    return stream;
  };

  /** Deliver an entry to `consumer` and deliberately do not ACK it. */
  const deliverWithoutAck = async (stream: string, consumer: string): Promise<void> => {
    await redis.xReadGroup(GROUP, consumer, [{ key: stream, id: '>' }], { COUNT: 10 });
  };

  beforeAll(async () => {
    harness = await getTestHarness();
    redis = harness.getRedisClient() as typeof redis;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('crash-then-restart', () => {
    it('should process an unacked entry after restart rather than stranding it', async () => {
      const stream = await freshStream();
      // Same logical worker across the simulated crash — this is exactly what
      // `resolveConsumerName` guarantees and `${prefix}-${process.pid}` did not.
      const consumer = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-a' });

      await redis.xAdd(stream, '*', { jobType: 'master.product.syncByExternalId' });
      await deliverWithoutAck(stream, consumer);

      // --- the process dies here; a new instance starts with the same identity ---

      const recovered = await readOwnPending(redis, stream, GROUP, consumer, 10);

      expect(recovered).toHaveLength(1);
      expect(recovered[0]).toMatchObject({
        kind: 'entry',
        fields: { jobType: 'master.product.syncByExternalId' },
      });
    });

    it('should return nothing from the steady-state read, proving the drain is what recovers it', async () => {
      const stream = await freshStream();
      const consumer = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-a' });

      await redis.xAdd(stream, '*', { jobType: 'master.product.syncByExternalId' });
      await deliverWithoutAck(stream, consumer);

      // `'>'` returns only never-delivered entries. This is the pre-#2164 read,
      // and it is why the message was lost: nothing redelivers a PEL entry.
      const steadyState = await redis.xReadGroup(GROUP, consumer, [{ key: stream, id: '>' }], {
        COUNT: 10,
      });

      expect(steadyState ?? []).toEqual([]);
    });

    it('should not reach the pending history of a differently-named consumer', async () => {
      const stream = await freshStream();
      const dead = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-a' });
      const other = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-b' });

      await redis.xAdd(stream, '*', { jobType: 'master.product.syncByExternalId' });
      await deliverWithoutAck(stream, dead);

      // Why identity had to be fixed first: a restarted process whose name
      // changed cannot drain its own history. Reclaim is the only route back.
      const recovered = await readOwnPending(redis, stream, GROUP, other, 10);

      expect(recovered).toEqual([]);
    });

    it('should clear the entry from the PEL once acked so a later drain is empty', async () => {
      const stream = await freshStream();
      const consumer = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-a' });

      await redis.xAdd(stream, '*', { jobType: 'master.product.syncByExternalId' });
      await deliverWithoutAck(stream, consumer);

      const recovered = await readOwnPending(redis, stream, GROUP, consumer, 10);
      await redis.xAck(stream, GROUP, recovered[0].id);

      expect(await readOwnPending(redis, stream, GROUP, consumer, 10)).toEqual([]);
    });
  });

  describe('poison entries', () => {
    it('should reach later entries even when an earlier one is never acked', async () => {
      // The head-of-line case. A handler that throws leaves its entry pending,
      // so a drain that re-read from the oldest id would return the same page
      // forever and never reach the siblings behind it.
      const stream = await freshStream();
      const consumer = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-a' });

      await redis.xAdd(stream, '*', { n: 'poison' });
      await redis.xAdd(stream, '*', { n: 'second' });
      await redis.xAdd(stream, '*', { n: 'third' });
      await deliverWithoutAck(stream, consumer);

      const seen: string[] = [];
      let cursor: string | undefined;

      // Drain with a handler that always throws on the first entry, exactly as
      // `recoverEntrySafely` isolates it: log and carry on to the next entry.
      for (let page = 0; page < 5; page += 1) {
        const entries = await readOwnPending(redis, stream, GROUP, consumer, 1, cursor);
        if (entries.length === 0) {
          break;
        }
        for (const entry of entries) {
          if (entry.kind === 'entry') {
            seen.push(entry.fields.n);
            // 'poison' is deliberately never acked.
            if (entry.fields.n !== 'poison') {
              await redis.xAck(stream, GROUP, entry.id);
            }
          }
        }
        cursor = nextPendingCursor(entries) ?? cursor;
      }

      expect(seen).toEqual(['poison', 'second', 'third']);
    });

    it('should terminate the scan rather than re-reading the unacked entry forever', async () => {
      const stream = await freshStream();
      const consumer = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-a' });

      await redis.xAdd(stream, '*', { n: 'poison' });
      await deliverWithoutAck(stream, consumer);

      // First page returns it; advancing past it yields an empty page, which is
      // what lets the drain loop exit instead of stalling boot to the page cap.
      const first = await readOwnPending(redis, stream, GROUP, consumer, 10);
      expect(first).toHaveLength(1);

      const second = await readOwnPending(
        redis,
        stream,
        GROUP,
        consumer,
        10,
        nextPendingCursor(first) ?? '-'
      );

      expect(second).toEqual([]);
    });

    it("should leave Redis' own delivery counter frozen across drain re-reads", async () => {
      // Why the poison alarm counts locally instead. Redis increments
      // `deliveriesCounter` on XREADGROUP/XCLAIM only; the drain path is
      // XPENDING + XRANGE, both pure reads. Keying the alarm on this value would
      // make it unreachable on exactly the path where poison accumulates.
      const stream = await freshStream();
      const consumer = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-a' });

      await redis.xAdd(stream, '*', { n: 'poison' });
      await deliverWithoutAck(stream, consumer);

      const first = await readOwnPending(redis, stream, GROUP, consumer, 10);
      const second = await readOwnPending(redis, stream, GROUP, consumer, 10);
      const third = await readOwnPending(redis, stream, GROUP, consumer, 10);

      const counts = [first, second, third].map((page) =>
        page[0].kind === 'entry' ? page[0].deliveryCount : -1
      );

      expect(counts).toEqual([counts[0], counts[0], counts[0]]);
    });
  });

  describe('orphan reclaim', () => {
    it('should claim an entry stranded by a consumer that never came back', async () => {
      const stream = await freshStream();
      const dead = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-gone' });
      const live = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-live' });

      await redis.xAdd(stream, '*', { jobType: 'master.product.syncByExternalId' });
      await deliverWithoutAck(stream, dead);

      // floorMs 0 is the documented test-only seam; production callers never
      // pass it, so the 5-minute safety floor still applies in the app.
      const entries = await reclaimOrphans(redis, stream, GROUP, live, 0, 10, 0);

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        kind: 'entry',
        fields: { jobType: 'master.product.syncByExternalId' },
      });
    });

    it('should move the entry into the reclaiming consumer so it can then drain it', async () => {
      const stream = await freshStream();
      const dead = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-gone' });
      const live = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-live' });

      await redis.xAdd(stream, '*', { jobType: 'master.product.syncByExternalId' });
      await deliverWithoutAck(stream, dead);
      await reclaimOrphans(redis, stream, GROUP, live, 0, 10, 0);

      expect(await readOwnPending(redis, stream, GROUP, live, 10)).toHaveLength(1);
    });

    it('should not process an entry the original owner acked before the claim landed', async () => {
      const stream = await freshStream();
      const owner = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-owner' });
      const live = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-live' });

      const id = await redis.xAdd(stream, '*', { jobType: 'master.product.syncByExternalId' });
      await deliverWithoutAck(stream, owner);

      // The owner finishes and ACKs — the entry leaves the PEL but stays in the
      // stream, so an XRANGE would still return its body. Only the claim reply
      // can tell us it is no longer ours to run.
      await redis.xAck(stream, GROUP, id);

      expect(await reclaimOrphans(redis, stream, GROUP, live, 0, 10, 0)).toEqual([]);
    });

    it('should not claim an entry younger than the idle threshold', async () => {
      const stream = await freshStream();
      const dead = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-gone' });
      const live = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-live' });

      await redis.xAdd(stream, '*', { jobType: 'master.product.syncByExternalId' });
      await deliverWithoutAck(stream, dead);

      // The property that stops a reclaim stealing live work mid-handler.
      const entries = await reclaimOrphans(redis, stream, GROUP, live, 60_000, 10, 0);

      expect(entries).toEqual([]);
    });
  });

  describe('trimmed entries', () => {
    it('should classify a pending entry as trimmed once retention removes its data', async () => {
      const stream = await freshStream();
      const consumer = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-a' });

      await redis.xAdd(stream, '*', { jobType: 'master.product.syncByExternalId' });
      await deliverWithoutAck(stream, consumer);

      // What retention (#2163) will do to an entry still sitting in the PEL.
      await redis.xTrim(stream, 'MAXLEN', 0);
      expect(await redis.xLen(stream)).toBe(0);

      const recovered = await readOwnPending(redis, stream, GROUP, consumer, 10);

      // The id survives in the PEL with no body. Routing this into the handler
      // would persist a bogus dead sync_jobs row describing a job that never was.
      expect(recovered).toHaveLength(1);
      expect(recovered[0].kind).toBe('trimmed');
    });

    it('should clear the dangling id from the PEL when the trimmed entry is acked', async () => {
      const stream = await freshStream();
      const consumer = resolveConsumerName('job-intake', { OL_WORKER_ID: 'worker-a' });

      await redis.xAdd(stream, '*', { jobType: 'master.product.syncByExternalId' });
      await deliverWithoutAck(stream, consumer);
      await redis.xTrim(stream, 'MAXLEN', 0);

      const recovered = await readOwnPending(redis, stream, GROUP, consumer, 10);
      await ackTrimmed(redis, stream, GROUP, recovered[0].id);

      expect(await readOwnPending(redis, stream, GROUP, consumer, 10)).toEqual([]);
    });
  });
});
