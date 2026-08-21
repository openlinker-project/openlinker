/**
 * Master Product Sync Delta Handler Tests
 *
 * Unit tests for MasterProductSyncDeltaHandler (#2220, ADR-048 decisions 1/3).
 * Covers the guard-only rung narrowing, watermark discipline (capture-before-read,
 * lookback overlap, advance-only-on-completion), first-run stamping, budget and
 * cursor resume, lock contention, key separation from the full sweep, and the
 * invariant that the delta path enqueues nothing but per-product child jobs.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MasterProductSyncDeltaHandler } from '../master-product-sync-delta.handler';
import type { JobEnqueuePort, ISyncCursorsService, SyncLockPort } from '@openlinker/core/sync';
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { ProductMasterPort, ModifiedProductLister } from '@openlinker/core/products';
import type { ConfigService } from '@nestjs/config';

describe('MasterProductSyncDeltaHandler', () => {
  let handler: MasterProductSyncDeltaHandler;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let productMaster: jest.Mocked<ProductMasterPort & ModifiedProductLister>;
  let cursors: jest.Mocked<ISyncCursorsService>;
  let syncLock: jest.Mocked<SyncLockPort>;
  let configGet: jest.Mock;

  const WATERMARK_KEY = 'master.product-delta.watermark:connection:conn-1';
  const CURSOR_KEY = 'master.product-delta.sweep:connection:conn-1';
  const PENDING_KEY = 'master.product-delta.pending-watermark:connection:conn-1';
  const LOCK_KEY = 'master:product-delta:sweep:conn-1';
  const PREVIOUS_WATERMARK = '2026-08-20T10:00:00.000Z';

  /** Stored-cursor lookup keyed by cursor name, so the two keys can differ per test. */
  const stubCursors = (values: Record<string, string | null>): void => {
    cursors.getCursor.mockImplementation((_conn: string, key: string) =>
      Promise.resolve(values[key] ?? null)
    );
  };

  beforeEach(() => {
    productMaster = {
      listExternalIds: jest.fn(),
      listExternalIdsModifiedSince: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<ProductMasterPort & ModifiedProductLister>;

    integrationsService = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn().mockResolvedValue(productMaster),
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

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

    configGet = jest.fn((_key: string, defaultValue?: unknown) => defaultValue);
    const configService = { get: configGet } as unknown as jest.Mocked<ConfigService>;

    handler = new MasterProductSyncDeltaHandler(
      integrationsService,
      jobEnqueue,
      cursors,
      syncLock,
      configService
    );

    stubCursors({ [WATERMARK_KEY]: PREVIOUS_WATERMARK });
  });

  const createJob = (payload: Record<string, unknown> = {}): SyncJob =>
    ({
      id: 'outer-job-1',
      jobType: 'master.product.syncDelta',
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

  /** Distinct id per offset — a constant page would collapse under the dedupe. */
  const distinctPages = (pageSize: number, total: number): void => {
    productMaster.listExternalIdsModifiedSince.mockImplementation((input) => {
      const start = input.offset;
      if (start >= total) {
        return Promise.resolve([]);
      }
      const count = Math.min(pageSize, total - start);
      return Promise.resolve(Array.from({ length: count }, (_, i) => `p${String(start + i)}`));
    });
  };

  describe('capability narrowing', () => {
    it('should enqueue nothing and report ok when the master does not implement the rung', async () => {
      const bareMaster = { listExternalIds: jest.fn() } as unknown as ProductMasterPort;
      integrationsService.getCapabilityAdapter.mockResolvedValue(bareMaster);

      const result = await handler.execute(createJob());

      expect(result).toEqual({ outcome: 'ok' });
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
      // The watermark must not move for a master that enumerated nothing.
      expect(cursors.advanceCursor).not.toHaveBeenCalled();
    });

    it('should resolve the rung by narrowing ProductMaster, never via its own capability name', async () => {
      await handler.execute(createJob());

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledTimes(1);
      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        'conn-1',
        'ProductMaster'
      );
    });
  });

  describe('lock', () => {
    it('should skip without enqueueing when the lock is already held', async () => {
      syncLock.acquire.mockResolvedValue(null);

      const result = await handler.execute(createJob());

      expect(result).toEqual({ outcome: 'ok' });
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
      expect(cursors.advanceCursor).not.toHaveBeenCalled();
    });

    it('should take a lock distinct from the full sweep so the two passes cannot starve each other', async () => {
      await handler.execute(createJob());

      expect(syncLock.acquire).toHaveBeenCalledWith(LOCK_KEY, expect.any(Number));
      expect(syncLock.acquire).not.toHaveBeenCalledWith(
        'master:product:sweep:conn-1',
        expect.any(Number)
      );
      expect(syncLock.release).toHaveBeenCalledWith(LOCK_KEY, 'lock-token');
    });

    it('should release the lock even when enumeration throws', async () => {
      productMaster.listExternalIdsModifiedSince.mockRejectedValue(new Error('platform down'));

      await expect(handler.execute(createJob())).rejects.toThrow();

      expect(syncLock.release).toHaveBeenCalledWith(LOCK_KEY, 'lock-token');
    });
  });

  describe('watermark discipline', () => {
    it('should stamp and enumerate nothing on the first run, opening no cycle', async () => {
      stubCursors({});

      const result = await handler.execute(createJob());

      expect(result).toEqual({ outcome: 'ok' });
      expect(productMaster.listExternalIdsModifiedSince).not.toHaveBeenCalled();
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
      // Exactly one write: the watermark. No sweep cursor is opened.
      expect(cursors.advanceCursor).toHaveBeenCalledTimes(1);
      expect(cursors.advanceCursor).toHaveBeenCalledWith(
        'conn-1',
        WATERMARK_KEY,
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
      );
    });

    it('should subtract the lookback from the stored watermark rather than querying from it directly', async () => {
      await handler.execute(createJob({ lookbackSeconds: 600 }));

      const call = productMaster.listExternalIdsModifiedSince.mock.calls[0]?.[0];
      expect(call?.since.toISOString()).toBe('2026-08-20T09:50:00.000Z');
    });

    it('should default the lookback to 300s when none is supplied', async () => {
      await handler.execute(createJob());

      const call = productMaster.listExternalIdsModifiedSince.mock.calls[0]?.[0];
      expect(call?.since.toISOString()).toBe('2026-08-20T09:55:00.000Z');
    });

    it('should advance the watermark to a time captured BEFORE the read when the cycle completes', async () => {
      const before = Date.now();
      distinctPages(100, 3);

      await handler.execute(createJob());

      const watermarkWrite = cursors.advanceCursor.mock.calls.find(
        (call) => call[1] === WATERMARK_KEY
      );
      expect(watermarkWrite).toBeDefined();
      const stamped = new Date(String(watermarkWrite?.[2])).getTime();
      expect(stamped).toBeGreaterThanOrEqual(before);
      expect(stamped).toBeLessThanOrEqual(Date.now());
    });

    it('should HOLD the watermark when the run is budget-truncated', async () => {
      // 250 available, budget 100 -> the cycle cannot exhaust in one run.
      distinctPages(100, 250);

      await handler.execute(createJob({ pageLimit: 100 }));

      const watermarkWrite = cursors.advanceCursor.mock.calls.find(
        (call) => call[1] === WATERMARK_KEY
      );
      expect(watermarkWrite).toBeUndefined();
      // ...but the sweep cursor advances so the next tick resumes.
      const cursorWrite = cursors.advanceCursor.mock.calls.find((call) => call[1] === CURSOR_KEY);
      expect(cursorWrite?.[2]).toEqual(expect.stringContaining(':100'));
    });

    it('should HOLD the watermark when an enqueue fails', async () => {
      distinctPages(100, 3);
      jobEnqueue.enqueueJob.mockRejectedValueOnce(new Error('stream down'));

      await handler.execute(createJob());

      const watermarkWrite = cursors.advanceCursor.mock.calls.find(
        (call) => call[1] === WATERMARK_KEY
      );
      expect(watermarkWrite).toBeUndefined();
    });

    it('should recompute the SAME since from the unadvanced watermark on a resuming tick', async () => {
      // The invariant the whole design rests on: a resumed cycle must query the
      // same set, or rows shift underneath the offset cursor.
      distinctPages(100, 250);
      stubCursors({ [WATERMARK_KEY]: PREVIOUS_WATERMARK, [CURSOR_KEY]: 'cycle-abc:100' });

      await handler.execute(createJob({ pageLimit: 100 }));

      const call = productMaster.listExternalIdsModifiedSince.mock.calls[0]?.[0];
      expect(call?.since.toISOString()).toBe('2026-08-20T09:55:00.000Z');
      expect(call?.offset).toBe(100);
    });

    it('should advance the watermark on an EMPTY change set (the quiet steady state)', async () => {
      // The most-executed path in production, and the one a natural-looking
      // "no items -> return early" optimisation would break: skipping the cursor
      // writes would freeze the watermark forever while every job row read ok —
      // exactly the silent degradation this handler warns about.
      productMaster.listExternalIdsModifiedSince.mockResolvedValue([]);

      const result = await handler.execute(createJob());

      expect(result).toEqual({ outcome: 'ok' });
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
      const watermarkWrite = cursors.advanceCursor.mock.calls.find(
        (call) => call[1] === WATERMARK_KEY
      );
      expect(watermarkWrite).toBeDefined();
      expect(new Date(String(watermarkWrite?.[2])).getTime()).toBeGreaterThan(
        new Date(PREVIOUS_WATERMARK).getTime()
      );
    });

    it('should stamp the CYCLE start, not the completing tick, when a cycle resumes', async () => {
      // A multi-tick cycle queries one fixed `since`. Advancing to the completing
      // tick's clock would move the watermark past rows the cycle never had the
      // chance to observe — turning the ADR-048 #2220 row-skip window from "missed
      // for one cycle" into "missed permanently".
      const CYCLE_OPENED_AT = '2026-08-20T10:30:00.000Z';
      distinctPages(100, 3);
      stubCursors({
        [WATERMARK_KEY]: PREVIOUS_WATERMARK,
        [CURSOR_KEY]: 'cycle-abc:0',
        [PENDING_KEY]: CYCLE_OPENED_AT,
      });

      await handler.execute(createJob());

      const watermarkWrite = cursors.advanceCursor.mock.calls.find(
        (call) => call[1] === WATERMARK_KEY
      );
      expect(watermarkWrite?.[2]).toBe(CYCLE_OPENED_AT);
      // ...and the pending value is cleared once the cycle closes.
      const pendingWrites = cursors.advanceCursor.mock.calls.filter(
        (call) => call[1] === PENDING_KEY
      );
      expect(pendingWrites.at(-1)?.[2]).toBe('');
    });

    it('should open a cycle by recording its start instant when no cursor exists', async () => {
      distinctPages(100, 250);

      await handler.execute(createJob({ pageLimit: 100 }));

      const pendingWrite = cursors.advanceCursor.mock.calls.find(
        (call) => call[1] === PENDING_KEY
      );
      expect(pendingWrite?.[2]).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
      // The cycle is still open, so the watermark itself must not have moved.
      expect(
        cursors.advanceCursor.mock.calls.find((call) => call[1] === WATERMARK_KEY)
      ).toBeUndefined();
    });

    it('should IGNORE a stale pending value when no cycle is open, never jumping the watermark backwards', async () => {
      // The guard the whole design rests on. A pending value can outlive its cycle
      // (crash between the cursor clear and the pending clear, or an abandoned
      // cycle), and it is only meaningful while a cursor exists. Reading it here
      // would stamp a DEAD cycle's opening instant — the watermark would move
      // backwards and the pass would re-read an ever-growing window forever, with
      // every job row reading ok. Today that is prevented because the pending read
      // sits inside the `cursor !== null` branch; this test is what stops a future
      // "hoist the read for clarity" refactor from silently undoing it.
      const STALE_PENDING = '2026-08-19T00:00:00.000Z';
      const before = Date.now();
      distinctPages(100, 2);
      stubCursors({ [WATERMARK_KEY]: PREVIOUS_WATERMARK, [PENDING_KEY]: STALE_PENDING });

      await handler.execute(createJob());

      const watermarkWrite = cursors.advanceCursor.mock.calls.find(
        (call) => call[1] === WATERMARK_KEY
      );
      expect(watermarkWrite?.[2]).not.toBe(STALE_PENDING);
      const stamped = new Date(String(watermarkWrite?.[2])).getTime();
      expect(stamped).toBeGreaterThanOrEqual(before);
      expect(stamped).toBeGreaterThan(new Date(PREVIOUS_WATERMARK).getTime());
    });

    it('should treat an unparseable watermark as absent rather than wedging the sweep', async () => {
      stubCursors({ [WATERMARK_KEY]: 'not-a-date' });

      const result = await handler.execute(createJob());

      expect(result).toEqual({ outcome: 'ok' });
      expect(productMaster.listExternalIdsModifiedSince).not.toHaveBeenCalled();
      expect(cursors.advanceCursor).toHaveBeenCalledWith(
        'conn-1',
        WATERMARK_KEY,
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
      );
    });
  });

  describe('fan-out', () => {
    it('should enqueue one per-product child per changed id, and nothing else', async () => {
      distinctPages(100, 3);

      await handler.execute(createJob());

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(3);
      const jobTypes = new Set(
        (jobEnqueue.enqueueJob.mock.calls as unknown[][]).map(
          (call) => (call[0] as { jobType: string }).jobType
        )
      );
      // ADR-048 decision 2: the delta path may not reach any catalog-level prune,
      // and the only thing it is allowed to enqueue is the per-product child.
      expect(jobTypes).toEqual(new Set(['master.product.syncByExternalId']));
    });

    it('should key children on the cycle in a namespace distinct from the full sweep', async () => {
      distinctPages(100, 1);

      await handler.execute(createJob());

      const key = (jobEnqueue.enqueueJob.mock.calls[0]?.[0] as { idempotencyKey: string })
        .idempotencyKey;
      expect(key).toContain('product:syncDelta:p0:');
      // Must not collide with the full sweep's namespace, and must not embed the
      // outer job id (a resuming tick is a different job).
      expect(key).not.toContain('product:sync:');
      expect(key).not.toContain('outer-job-1');
    });

    it('should honour the budget, truncating at a page boundary', async () => {
      // Page size below the budget, so the budget (not a short page) is what stops
      // the loop. `readPage` collects whole pages while under budget, so the bound
      // is exact here and overshoots by at most one page when it is not a multiple.
      configGet.mockImplementation((key: string, defaultValue?: unknown) =>
        key === 'OL_PRODUCT_SYNC_PAGE_SIZE' ? '10' : defaultValue
      );
      distinctPages(10, 500);

      await handler.execute(createJob({ pageLimit: 30 }));

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(30);
    });

    it('should clear the sweep cursor when the cycle completes', async () => {
      distinctPages(100, 3);

      await handler.execute(createJob());

      const cursorWrite = cursors.advanceCursor.mock.calls.find((call) => call[1] === CURSOR_KEY);
      expect(cursorWrite?.[2]).toBe('');
    });
  });
});
