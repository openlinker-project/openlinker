/**
 * Master Product Sync All Handler Tests
 *
 * Unit tests for MasterProductSyncAllHandler. Covers pagination, fan-out, partial
 * failure tolerance, empty-catalog handling, enumeration-failure propagation, and
 * the bounded/resumable behaviour added in #2218 (budget, cursor resume, cursor
 * safety on partial failure, lock contention).
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MasterProductSyncAllHandler } from '../master-product-sync-all.handler';
import type { JobEnqueuePort, ISyncCursorsService, SyncLockPort } from '@openlinker/core/sync';
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { ProductMasterPort } from '@openlinker/core/products';
import type { ConfigService } from '@nestjs/config';
import {
  FakeOperationalSettingsService,
  settingNumber,
} from '../../../testing/operational-settings.double';

describe('MasterProductSyncAllHandler', () => {
  let handler: MasterProductSyncAllHandler;
  let operationalSettings: FakeOperationalSettingsService;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let productMaster: jest.Mocked<ProductMasterPort>;
  let cursors: jest.Mocked<ISyncCursorsService>;
  let syncLock: jest.Mocked<SyncLockPort>;

  const CURSOR_KEY = 'master.product.sweep:connection:conn-1';
  const LOCK_KEY = 'master:product:sweep:conn-1';

  beforeEach(() => {
    productMaster = {
      listExternalIds: jest.fn(),
    } as unknown as jest.Mocked<ProductMasterPort>;

    integrationsService = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn().mockResolvedValue(productMaster),
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    jobEnqueue = {
      enqueueJob: jest.fn(),
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

    operationalSettings = new FakeOperationalSettingsService();

    handler = new MasterProductSyncAllHandler(
      integrationsService,
      jobEnqueue,
      cursors,
      syncLock,
      operationalSettings,
      configService
    );
  });

  const createJob = (connectionId: string, pageLimit?: number): SyncJob =>
    ({
      id: 'outer-job-1',
      jobType: 'master.product.syncAll',
      connectionId,
      payload: { schemaVersion: 1, ...(pageLimit === undefined ? {} : { pageLimit }) },
      idempotencyKey: 'key',
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      nextRunAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as SyncJob;

  /** Distinct ids per offset — a repeated page would collapse under the dedupe. */
  const distinctPages = (pageSize: number): void => {
    productMaster.listExternalIds.mockImplementation((filters) => {
      const offset = filters?.offset ?? 0;
      return Promise.resolve(
        Array.from({ length: pageSize }, (_, i) => `p-${String(offset + i)}`)
      );
    });
  };

  /** The cycle id is a `randomUUID`, so assertions read it off the written cursor. */
  const writtenCursorValue = (): string =>
    String(cursors.advanceCursor.mock.calls[0][2]);

  it('should enqueue ONE batch child covering the whole page (#2593)', async () => {
    productMaster.listExternalIds.mockResolvedValueOnce(['1', '2', '3']).mockResolvedValueOnce([]);
    jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

    await handler.execute(createJob('conn-1'));

    expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
      'conn-1',
      'ProductMaster'
    );
    // One child, not three: a per-product child builds its own adapter instance
    // and so can never share a bulk read.
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
    const first = jobEnqueue.enqueueJob.mock.calls[0][0];
    expect(first.jobType).toBe('master.product.syncBatch');
    expect(first.connectionId).toBe('conn-1');
    expect(first.payload).toEqual({ schemaVersion: 1, externalIds: ['1', '2', '3'] });
  });

  it('should cut a page into batches of the configured size', async () => {
    distinctPages(100);
    jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

    await handler.execute(createJob('conn-1', 250));

    // The budget truncates at a PAGE boundary, so 250 overshoots to 300 items -
    // three batches of 100.
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(3);
    const sizes = jobEnqueue.enqueueJob.mock.calls.map(
      (call) => (call[0].payload as { externalIds: string[] }).externalIds.length
    );
    expect(sizes).toEqual([100, 100, 100]);
  });

  it('should key the child idempotency key on the cycle, not the outer job id', async () => {
    // A resuming tick is a different job, so a job-scoped key would re-enqueue the
    // same child under a fresh key on every overlapping page (#2039's lesson).
    productMaster.listExternalIds.mockResolvedValueOnce(['1']).mockResolvedValueOnce([]);
    jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

    await handler.execute(createJob('conn-1'));

    const key = jobEnqueue.enqueueJob.mock.calls[0][0].idempotencyKey;
    expect(key).toMatch(/^master:conn-1:product:syncBatch:1:/);
    expect(key).not.toContain('outer-job-1');
  });

  it('should paginate through multiple pages until a short page is returned', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => String(i));
    productMaster.listExternalIds
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce(['x1', 'x2']);
    jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

    await handler.execute(createJob('conn-1', 500));

    expect(productMaster.listExternalIds).toHaveBeenNthCalledWith(1, { limit: 100, offset: 0 });
    expect(productMaster.listExternalIds).toHaveBeenNthCalledWith(2, { limit: 100, offset: 100 });
    // 102 items over two batches.
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
  });

  it('should deduplicate external ids repeated across pages', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => String(i));
    productMaster.listExternalIds
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce(['99', '100']);
    jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

    await handler.execute(createJob('conn-1', 500));

    const enqueued = jobEnqueue.enqueueJob.mock.calls.flatMap(
      (call) => (call[0].payload as { externalIds: string[] }).externalIds
    );
    expect(enqueued).toHaveLength(101);
    expect(new Set(enqueued).size).toBe(101);
  });

  it('should handle empty catalog gracefully', async () => {
    productMaster.listExternalIds.mockResolvedValue([]);

    await handler.execute(createJob('conn-1'));

    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('should not throw when some enqueue calls fail', async () => {
    distinctPages(100);
    jobEnqueue.enqueueJob
      .mockResolvedValueOnce({ jobId: 'j1', isExisting: false })
      .mockRejectedValueOnce(new Error('queue full'));

    await expect(handler.execute(createJob('conn-1', 200))).resolves.toEqual({ outcome: 'ok' });
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
  });

  it('should throw SyncJobExecutionError when enumeration fails', async () => {
    productMaster.listExternalIds.mockRejectedValue(new Error('upstream 500'));

    await expect(handler.execute(createJob('conn-1'))).rejects.toThrow(SyncJobExecutionError);
  });

  it('should throw SyncJobExecutionError when adapter resolution fails', async () => {
    integrationsService.getCapabilityAdapter.mockRejectedValueOnce(new Error('no adapter'));

    await expect(handler.execute(createJob('conn-1'))).rejects.toThrow(SyncJobExecutionError);
  });

  it('should release the lock on the success path', async () => {
    productMaster.listExternalIds.mockResolvedValueOnce(['1']).mockResolvedValueOnce([]);
    jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

    await handler.execute(createJob('conn-1'));

    expect(syncLock.release).toHaveBeenCalledWith(LOCK_KEY, 'lock-token');
  });

  it('should release the lock even when the run throws', async () => {
    productMaster.listExternalIds.mockRejectedValue(new Error('upstream 500'));

    await expect(handler.execute(createJob('conn-1'))).rejects.toThrow(SyncJobExecutionError);
    expect(syncLock.release).toHaveBeenCalledWith(LOCK_KEY, 'lock-token');
  });

  describe('bounded and resumable behaviour (#2218)', () => {
    it('should stop at the budget and persist a resume cursor', async () => {
      distinctPages(100);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

      await handler.execute(createJob('conn-1', 100));

      // The budget still bounds ITEMS - 100 of them, in one batch child.
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
      expect(cursors.advanceCursor).toHaveBeenCalledTimes(1);
      expect(writtenCursorValue()).toMatch(/:100$/);
    });

    it('should resume from the stored cursor and reuse its cycle id', async () => {
      cursors.getCursor.mockResolvedValue('cycle-abc:100');
      productMaster.listExternalIds.mockResolvedValueOnce(['a']).mockResolvedValueOnce([]);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

      await handler.execute(createJob('conn-1'));

      expect(cursors.getCursor).toHaveBeenCalledWith('conn-1', CURSOR_KEY);
      expect(productMaster.listExternalIds).toHaveBeenNthCalledWith(1, {
        limit: 100,
        offset: 100,
      });
      expect(jobEnqueue.enqueueJob.mock.calls[0][0].idempotencyKey).toBe(
        'master:conn-1:product:syncBatch:a:cycle-abc'
      );
    });

    it('should clear the cursor when the cycle completes', async () => {
      productMaster.listExternalIds.mockResolvedValueOnce(['1']).mockResolvedValueOnce([]);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

      await handler.execute(createJob('conn-1'));

      expect(cursors.advanceCursor).toHaveBeenCalledWith('conn-1', CURSOR_KEY, '');
    });

    it('should NOT advance the cursor past a failed enqueue', async () => {
      // Cursor safety: advancing would skip the failed id until the next full
      // cycle, which is many ticks away.
      cursors.getCursor.mockResolvedValue('cycle-abc:40');
      productMaster.listExternalIds.mockResolvedValueOnce(['a', 'b']).mockResolvedValueOnce([]);
      jobEnqueue.enqueueJob.mockRejectedValueOnce(new Error('queue full'));

      await handler.execute(createJob('conn-1'));

      expect(cursors.advanceCursor).toHaveBeenCalledWith('conn-1', CURSOR_KEY, 'cycle-abc:40');
    });

    it('should NOT advance the cursor when one batch of several fails (#2593)', async () => {
      // Batching does not weaken the rule: a page whose second batch failed
      // holds the cursor at the page start, so the whole page retries.
      cursors.getCursor.mockResolvedValue('cycle-abc:200');
      distinctPages(100);
      jobEnqueue.enqueueJob
        .mockResolvedValueOnce({ jobId: 'j1', isExisting: false })
        .mockRejectedValueOnce(new Error('queue full'));

      await handler.execute(createJob('conn-1', 200));

      expect(cursors.advanceCursor).toHaveBeenCalledWith('conn-1', CURSOR_KEY, 'cycle-abc:200');
    });

    it('should start a fresh cycle when the stored cursor is malformed', async () => {
      cursors.getCursor.mockResolvedValue('legacy-scalar-value');
      productMaster.listExternalIds.mockResolvedValueOnce(['a']).mockResolvedValueOnce([]);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

      await handler.execute(createJob('conn-1'));

      expect(productMaster.listExternalIds).toHaveBeenNthCalledWith(1, { limit: 100, offset: 0 });
    });

    it('should skip without throwing when another run holds the lock', async () => {
      syncLock.acquire.mockResolvedValue(null);

      await expect(handler.execute(createJob('conn-1'))).resolves.toEqual({ outcome: 'ok' });
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
      expect(cursors.advanceCursor).not.toHaveBeenCalled();
    });

    it('should default the budget to the batched default when no override exists', async () => {
      distinctPages(100);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

      await handler.execute(createJob('conn-1'));

      // 500 items per run, 100 per batch.
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(5);
      expect(writtenCursorValue()).toMatch(/:500$/);
    });

    // #2651 — the operator-settable budget is read PER TICK. This is the
    // acceptance criterion the issue asks to be PROVEN rather than asserted:
    // the handler instance below is never re-constructed, and no module is
    // re-created, so a passing assertion means a budget change reaches a
    // running worker with no restart.
    it('should pick up an operator budget change on the next tick, with no restart', async () => {
      distinctPages(100);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

      await handler.execute(createJob('conn-1'));
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(5); // 500 items / 100

      operationalSettings.setValues({
        catalogueSweepBudget: settingNumber('catalogueSweepBudget', 1000),
      });
      jobEnqueue.enqueueJob.mockClear();
      cursors.getCursor.mockResolvedValue(null);

      await handler.execute(createJob('conn-1'));

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(10); // 1000 items / 100
    });

    it('should let an operator page size resize the batch children', async () => {
      distinctPages(100);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });
      operationalSettings.setValues({
        catalogueSweepBudget: settingNumber('catalogueSweepBudget', 100),
        sweepPageSize: settingNumber('sweepPageSize', 25),
      });

      await handler.execute(createJob('conn-1'));

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(4);
    });

    // The two ceilings are earned differently, so they clamp differently.
    // Reaching the settings surface with a value above our recommendation
    // required an explicit acknowledgement; a raw job payload has nowhere to
    // record one, so it keeps the narrower bound.
    it('should honour an acknowledged setting above the recommended ceiling', async () => {
      distinctPages(100);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });
      operationalSettings.setValues({
        catalogueSweepBudget: settingNumber('catalogueSweepBudget', 3000),
      });

      await handler.execute(createJob('conn-1'));

      // 3000 items, 100 per batch — not clamped back to the recommended 2000.
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(30);
    });

    it('should still clamp a raw payload limit to the RECOMMENDED ceiling', async () => {
      distinctPages(100);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });
      operationalSettings.setValues({
        catalogueSweepBudget: settingNumber('catalogueSweepBudget', 3000),
      });

      await handler.execute(createJob('conn-1', 9000));

      // The payload wins over the setting, and is bounded at 2000.
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(20);
    });

    it('should clamp a payload page limit above the ceiling', async () => {
      distinctPages(100);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

      await handler.execute(createJob('conn-1', 100_000));

      // 2 000 is the batched ceiling; 20 pages of 100 items, one batch child each.
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(20);
    });
  });
});
