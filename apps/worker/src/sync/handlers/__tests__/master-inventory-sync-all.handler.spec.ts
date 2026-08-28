/**
 * Master Inventory Sync All Handler Tests
 *
 * Unit tests for MasterInventorySyncAllHandler. Tests fan-out of per-product
 * inventory sync jobs from a connection-level syncAll job, plus the bounded /
 * resumable behaviour added in #2219 (paged enumeration, budget, cursor resume,
 * cursor safety on partial failure, lock contention).
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MasterInventorySyncAllHandler } from '../master-inventory-sync-all.handler';
import type { IdentifierMappingQueryPort } from '@openlinker/core/identifier-mapping';
import type {
  JobEnqueuePort,
  ISyncCursorsService,
  SyncLockPort,
} from '@openlinker/core/sync';
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { ConfigService } from '@nestjs/config';
import { FakeOperationalSettingsService } from '../../../testing/operational-settings.double';

describe('MasterInventorySyncAllHandler', () => {
  let handler: MasterInventorySyncAllHandler;
  let operationalSettings: FakeOperationalSettingsService;
  let identifierMapping: jest.Mocked<IdentifierMappingQueryPort>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let cursors: jest.Mocked<ISyncCursorsService>;
  let syncLock: jest.Mocked<SyncLockPort>;

  const CURSOR_KEY = 'master.inventory.sweep:connection:conn-1';
  const LOCK_KEY = 'master:inventory:sweep:conn-1';

  beforeEach(() => {
    identifierMapping = {
      getInternalId: jest.fn(),
      getExternalIds: jest.fn(),
      listExternalIdsByConnection: jest.fn(),
    };

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

    handler = new MasterInventorySyncAllHandler(
      identifierMapping,
      jobEnqueue,
      cursors,
      syncLock,
      operationalSettings,
      configService
    );
  });

  const createJob = (connectionId: string, pageLimit?: number): SyncJob => ({
    id: 'job-id',
    jobType: 'master.inventory.syncAll',
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
  });

  it('should enqueue ONE batch child carrying the whole page (#2648)', async () => {
    identifierMapping.listExternalIdsByConnection.mockResolvedValue(['ext-1', 'ext-2', 'ext-3']);
    jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'new-job', isExisting: false });

    await handler.execute(createJob('conn-1'));

    expect(identifierMapping.listExternalIdsByConnection).toHaveBeenCalledWith(
      'Product',
      'conn-1',
      { limit: 100, offset: 0 }
    );
    // One child, not three: a per-product child builds its own adapter instance
    // and so can never share a bulk stock read.
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);

    const firstCall = jobEnqueue.enqueueJob.mock.calls[0][0];
    expect(firstCall.jobType).toBe('master.inventory.syncBatch');
    expect(firstCall.connectionId).toBe('conn-1');
    expect(firstCall.payload).toEqual(
      expect.objectContaining({ schemaVersion: 1, externalIds: ['ext-1', 'ext-2', 'ext-3'] })
    );
  });

  it('should keep the budget at the per-item default rather than raising it with the batching', async () => {
    // #2648 makes the CHILD cheap; what the run may then afford is a separate
    // decision. A silent jump to the product sweep's batched 500 would be that
    // decision taken by accident.
    identifierMapping.listExternalIdsByConnection.mockResolvedValue([]);

    await handler.execute(createJob('conn-1'));

    expect(identifierMapping.listExternalIdsByConnection).toHaveBeenCalledWith(
      'Product',
      'conn-1',
      { limit: 100, offset: 0 }
    );
  });

  it('should handle empty product list gracefully', async () => {
    identifierMapping.listExternalIdsByConnection.mockResolvedValue([]);

    await handler.execute(createJob('conn-1'));

    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('should not throw when an enqueue call fails', async () => {
    identifierMapping.listExternalIdsByConnection.mockResolvedValue(['ext-1', 'ext-2']);
    jobEnqueue.enqueueJob.mockRejectedValueOnce(new Error('queue full'));

    await expect(handler.execute(createJob('conn-1'))).resolves.toEqual({ outcome: 'ok' });
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
  });

  it('should skip synthetic variant external IDs (product: prefix)', async () => {
    // 'product:13' is a synthetic variant mapping created by the PS adapter for simple
    // products. Its internal ID is a variant ID, not a product ID, so inserting inventory
    // for it violates the inventory_items.productId FK. Plain '13' covers the same product.
    identifierMapping.listExternalIdsByConnection.mockResolvedValue(['13', 'product:13', '14']);
    jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'new-job', isExisting: false });

    await handler.execute(createJob('conn-1'));

    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
    const enqueuedIds = jobEnqueue.enqueueJob.mock.calls[0][0].payload.externalIds;
    expect(enqueuedIds).toEqual(['13', '14']);
    expect(enqueuedIds).not.toContain('product:13');
  });

  it('should throw SyncJobExecutionError when listing mappings fails', async () => {
    identifierMapping.listExternalIdsByConnection.mockRejectedValue(new Error('db down'));

    await expect(handler.execute(createJob('conn-1'))).rejects.toThrow(SyncJobExecutionError);
  });

  it('should key the child idempotency key on the cycle, not the outer job id', async () => {
    identifierMapping.listExternalIdsByConnection.mockResolvedValue(['ext-1']);
    jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'new-job', isExisting: false });

    await handler.execute(createJob('conn-1'));

    const key = jobEnqueue.enqueueJob.mock.calls[0][0].idempotencyKey;
    expect(key).toMatch(/^master:conn-1:inventory:syncBatch:ext-1:/);
    expect(key).not.toContain('job-id');
  });

  describe('bounded and resumable behaviour (#2219)', () => {
    it('should request only a budget-sized page rather than the whole mapping set', async () => {
      identifierMapping.listExternalIdsByConnection.mockResolvedValue(['ext-1']);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

      await handler.execute(createJob('conn-1', 25));

      expect(identifierMapping.listExternalIdsByConnection).toHaveBeenCalledWith(
        'Product',
        'conn-1',
        { limit: 25, offset: 0 }
      );
    });

    it('should resume from the stored cursor and reuse its cycle id', async () => {
      cursors.getCursor.mockResolvedValue('cycle-abc:200');
      identifierMapping.listExternalIdsByConnection.mockResolvedValue(['ext-9']);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

      await handler.execute(createJob('conn-1'));

      expect(cursors.getCursor).toHaveBeenCalledWith('conn-1', CURSOR_KEY);
      expect(identifierMapping.listExternalIdsByConnection).toHaveBeenCalledWith(
        'Product',
        'conn-1',
        { limit: 100, offset: 200 }
      );
      expect(jobEnqueue.enqueueJob.mock.calls[0][0].idempotencyKey).toBe(
        'master:conn-1:inventory:syncBatch:ext-9:cycle-abc'
      );
    });

    it('should advance the cursor by rows READ, not by children enqueued', async () => {
      // Filtered synthetic ids still consumed a row; counting only survivors would
      // re-read them on every tick.
      const page = Array.from({ length: 100 }, (_, i) =>
        i % 2 === 0 ? `p-${String(i)}` : `product:${String(i)}`
      );
      identifierMapping.listExternalIdsByConnection.mockResolvedValue(page);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

      await handler.execute(createJob('conn-1'));

      // One batch child carrying the 50 survivors, while the cursor still moves
      // by the 100 rows the page actually read.
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
      expect(jobEnqueue.enqueueJob.mock.calls[0][0].payload.externalIds).toHaveLength(50);
      expect(cursors.advanceCursor.mock.calls[0][2]).toMatch(/:100$/);
    });

    it('should clear the cursor when the page is short (store exhausted)', async () => {
      identifierMapping.listExternalIdsByConnection.mockResolvedValue(['ext-1']);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

      await handler.execute(createJob('conn-1'));

      expect(cursors.advanceCursor).toHaveBeenCalledWith('conn-1', CURSOR_KEY, '');
    });

    it('should NOT advance the cursor past a failed enqueue', async () => {
      cursors.getCursor.mockResolvedValue('cycle-abc:50');
      identifierMapping.listExternalIdsByConnection.mockResolvedValue(['ext-1', 'ext-2']);
      jobEnqueue.enqueueJob.mockRejectedValueOnce(new Error('queue full'));

      await handler.execute(createJob('conn-1'));

      expect(cursors.advanceCursor).toHaveBeenCalledWith('conn-1', CURSOR_KEY, 'cycle-abc:50');
    });

    // #2651 — read per tick, not at boot.
    it('should use the operator-set inventory budget on the next tick, with no restart', async () => {
      identifierMapping.listExternalIdsByConnection.mockResolvedValue(['ext-1']);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

      await handler.execute(createJob('conn-1'));
      expect(identifierMapping.listExternalIdsByConnection).toHaveBeenCalledWith(
        'Product',
        'conn-1',
        { limit: 100, offset: 0 }
      );

      operationalSettings.setValues({
        inventorySweepBudget: { value: 1500, source: 'setting' },
      });
      identifierMapping.listExternalIdsByConnection.mockClear();

      await handler.execute(createJob('conn-1'));

      // 1500 is above the legacy SWEEP_BUDGET_MAX of 500 — the settings bound
      // is what applies, so what an operator is told is accepted is what runs.
      expect(identifierMapping.listExternalIdsByConnection).toHaveBeenCalledWith(
        'Product',
        'conn-1',
        { limit: 1500, offset: 0 }
      );
    });

    it('should skip without throwing when another run holds the lock', async () => {
      syncLock.acquire.mockResolvedValue(null);

      await expect(handler.execute(createJob('conn-1'))).resolves.toEqual({ outcome: 'ok' });
      expect(identifierMapping.listExternalIdsByConnection).not.toHaveBeenCalled();
      expect(cursors.advanceCursor).not.toHaveBeenCalled();
    });

    it('should release the lock on the success path', async () => {
      identifierMapping.listExternalIdsByConnection.mockResolvedValue(['ext-1']);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

      await handler.execute(createJob('conn-1'));

      expect(syncLock.release).toHaveBeenCalledWith(LOCK_KEY, 'lock-token');
    });

    it('should release the lock even when the run throws', async () => {
      identifierMapping.listExternalIdsByConnection.mockRejectedValue(new Error('db down'));

      await expect(handler.execute(createJob('conn-1'))).rejects.toThrow(SyncJobExecutionError);
      expect(syncLock.release).toHaveBeenCalledWith(LOCK_KEY, 'lock-token');
    });
  });
});
