/**
 * Master Product Reconcile Handler Tests (#2222)
 *
 * The invariants here are mostly NEGATIVE, and deliberately so: this handler is the
 * deletion authority's trigger, and the ways it could go wrong are all ways it could
 * stale something that is alive.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MasterProductReconcileHandler } from '../master-product-reconcile.handler';
import type { JobEnqueuePort, ISyncCursorsService, SyncLockPort } from '@openlinker/core/sync';
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import type { ConfigService } from '@nestjs/config';

describe('MasterProductReconcileHandler', () => {
  let handler: MasterProductReconcileHandler;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let cursors: jest.Mocked<ISyncCursorsService>;
  let syncLock: jest.Mocked<SyncLockPort>;

  const CURSOR_KEY = 'master.product-reconcile.sweep:connection:conn-1';
  const COMPLETED_AT_KEY = 'master.product-reconcile.completedAt:connection:conn-1';
  const LOCK_KEY = 'master:product-reconcile:sweep:conn-1';

  beforeEach(() => {
    identifierMapping = {
      listExternalIdsByConnection: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    jobEnqueue = {
      enqueueJob: jest.fn().mockResolvedValue({ id: 'child' }),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    cursors = {
      getCursor: jest.fn().mockResolvedValue(null),
      advanceCursor: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ISyncCursorsService>;

    syncLock = {
      acquire: jest.fn().mockResolvedValue('lock-token'),
      release: jest.fn().mockResolvedValue(true),
      extend: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<SyncLockPort>;

    const configService = {
      get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
    } as unknown as jest.Mocked<ConfigService>;

    handler = new MasterProductReconcileHandler(
      identifierMapping,
      jobEnqueue,
      cursors,
      syncLock,
      configService
    );
  });

  const createJob = (payload: Record<string, unknown> = {}): SyncJob =>
    ({
      id: 'outer-job-1',
      jobType: 'master.product.reconcile',
      connectionId: 'conn-1',
      payload: { schemaVersion: 1, ...payload },
      idempotencyKey: 'key',
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      nextRunAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as unknown as SyncJob;

  const mappings = (total: number): void => {
    identifierMapping.listExternalIdsByConnection.mockImplementation(
      (_type: unknown, _conn: unknown, page?: { limit: number; offset?: number }) => {
        const limit = page?.limit ?? 100;
        const offset = page?.offset ?? 0;
        if (offset >= total) {
          return Promise.resolve([]);
        }
        const count = Math.min(limit, total - offset);
        return Promise.resolve(Array.from({ length: count }, (_, i) => `e${String(offset + i)}`));
      }
    );
  };

  describe('the enumeration source', () => {
    it("should read OL's OWN mappings, never the master's catalog", async () => {
      // The inversion this handler exists for. Reading the master would ask
      // "what exists?", which cannot reveal a deletion.
      mappings(3);

      await handler.execute(createJob());

      expect(identifierMapping.listExternalIdsByConnection).toHaveBeenCalledWith(
        'Product',
        'conn-1',
        expect.objectContaining({ limit: expect.any(Number), offset: 0 })
      );
    });

    it('should skip synthetic variant ids, which resolve to a variant not a product', async () => {
      identifierMapping.listExternalIdsByConnection
        .mockResolvedValueOnce(['12', 'product:13', '14'])
        .mockResolvedValue([]);

      await handler.execute(createJob());

      const enqueued = (jobEnqueue.enqueueJob.mock.calls as unknown[][]).map(
        (call) => (call[0] as { payload: { externalId: string } }).payload.externalId
      );
      expect(enqueued).toEqual(['12', '14']);
    });

    it('should advance the cursor by rows READ, not by rows that survived the filter', async () => {
      // Advancing by the survivors would re-read the filtered rows every tick.
      identifierMapping.listExternalIdsByConnection.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => `product:${String(i)}`)
      );

      await handler.execute(createJob({ pageLimit: 10 }));

      const cursorWrite = cursors.advanceCursor.mock.calls.find((call) => call[1] === CURSOR_KEY);
      expect(cursorWrite?.[2]).toEqual(expect.stringContaining(':10'));
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });
  });

  describe('what it is allowed to do', () => {
    it('should enqueue ONLY the per-product re-check — it never writes staleness itself', async () => {
      mappings(3);

      await handler.execute(createJob());

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(3);
      const jobTypes = new Set(
        (jobEnqueue.enqueueJob.mock.calls as unknown[][]).map(
          (call) => (call[0] as { jobType: string }).jobType
        )
      );
      expect(jobTypes).toEqual(new Set(['master.product.syncByExternalId']));
    });

    it('should stale nothing when the connection has no mappings', async () => {
      // An empty enumeration is not "everything was deleted" — it enqueues
      // nothing, so there is no zero-observation hazard to guard against.
      mappings(0);

      const result = await handler.execute(createJob());

      expect(result).toEqual({ outcome: 'ok' });
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should key children in its own namespace so a re-check never dedups against a sweep child', async () => {
      mappings(1);

      await handler.execute(createJob());

      const key = (jobEnqueue.enqueueJob.mock.calls[0]?.[0] as { idempotencyKey: string })
        .idempotencyKey;
      expect(key).toContain('product:reconcile:e0:');
      expect(key).not.toContain('product:sync:');
      expect(key).not.toContain('product:syncDelta:');
      expect(key).not.toContain('outer-job-1');
    });
  });

  describe('lock and cursor', () => {
    it('should take a lock distinct from both product sweeps', async () => {
      mappings(1);

      await handler.execute(createJob());

      expect(syncLock.acquire).toHaveBeenCalledWith(LOCK_KEY, expect.any(Number));
      expect(syncLock.acquire).not.toHaveBeenCalledWith(
        'master:product:sweep:conn-1',
        expect.any(Number)
      );
      expect(syncLock.release).toHaveBeenCalledWith(LOCK_KEY, 'lock-token');
    });

    it('should skip without enqueueing when the lock is held', async () => {
      syncLock.acquire.mockResolvedValue(null);

      const result = await handler.execute(createJob());

      expect(result).toEqual({ outcome: 'ok' });
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
      expect(cursors.advanceCursor).not.toHaveBeenCalled();
    });

    it('should hold the cursor when an enqueue fails, so the page retries', async () => {
      mappings(3);
      jobEnqueue.enqueueJob.mockRejectedValueOnce(new Error('stream down'));

      await handler.execute(createJob());

      const cursorWrite = cursors.advanceCursor.mock.calls.find((call) => call[1] === CURSOR_KEY);
      expect(cursorWrite?.[2]).toEqual(expect.stringContaining(':0'));
    });

    it('should resume from a stored cursor', async () => {
      mappings(500);
      cursors.getCursor.mockResolvedValue('cycle-abc:100');

      await handler.execute(createJob({ pageLimit: 10 }));

      expect(identifierMapping.listExternalIdsByConnection).toHaveBeenCalledWith(
        'Product',
        'conn-1',
        expect.objectContaining({ offset: 100 })
      );
    });

    it('should stamp the completion timestamp when the cycle completes (#2258)', async () => {
      mappings(3);

      await handler.execute(createJob());

      const stamp = cursors.advanceCursor.mock.calls.find((call) => call[1] === COMPLETED_AT_KEY);
      expect(stamp).toBeDefined();
      expect(new Date(stamp?.[2] as string).toISOString()).toBe(stamp?.[2]);
      // Ordering: the sweep-cursor clear comes first — a crash between the two
      // must leave a completed-but-unstamped cycle, never a stamped-but-open one.
      const keys = cursors.advanceCursor.mock.calls.map((call) => call[1]);
      expect(keys.indexOf(CURSOR_KEY)).toBeLessThan(keys.indexOf(COMPLETED_AT_KEY));
    });

    it('should NOT fail the job when the completion stamp itself fails (best-effort)', async () => {
      // The sweep cursor is already cleared at this point — throwing would
      // retry into a fresh cycle and re-enqueue a page of children for a
      // cycle that already completed. The stamp self-heals next cycle.
      mappings(3);
      cursors.advanceCursor.mockImplementation((_conn, key) =>
        key === COMPLETED_AT_KEY ? Promise.reject(new Error('db down')) : Promise.resolve()
      );

      const result = await handler.execute(createJob());

      expect(result).toEqual({ outcome: 'ok' });
      expect(syncLock.release).toHaveBeenCalledWith(LOCK_KEY, 'lock-token');
    });

    it('should NOT stamp completion when the cycle merely resumes', async () => {
      mappings(500);

      await handler.execute(createJob({ pageLimit: 10 }));

      expect(
        cursors.advanceCursor.mock.calls.find((call) => call[1] === COMPLETED_AT_KEY)
      ).toBeUndefined();
    });

    it('should NOT stamp completion when an enqueue failed and the page will retry', async () => {
      mappings(3);
      jobEnqueue.enqueueJob.mockRejectedValueOnce(new Error('stream down'));

      await handler.execute(createJob());

      expect(
        cursors.advanceCursor.mock.calls.find((call) => call[1] === COMPLETED_AT_KEY)
      ).toBeUndefined();
    });

    it('should release the lock when enumeration throws', async () => {
      identifierMapping.listExternalIdsByConnection.mockRejectedValue(new Error('db down'));

      await expect(handler.execute(createJob())).rejects.toThrow();

      expect(syncLock.release).toHaveBeenCalledWith(LOCK_KEY, 'lock-token');
    });
  });
});
