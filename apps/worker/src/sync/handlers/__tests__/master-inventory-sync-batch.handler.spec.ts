/**
 * Master Inventory Sync Batch Handler Tests (#2648)
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MasterInventorySyncBatchHandler } from '../master-inventory-sync-batch.handler';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { JobEnqueuePort, SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import type {
  IMasterInventorySyncService,
  MasterInventorySyncResult,
} from '@openlinker/core/inventory';

const syncedInventory = (
  overrides: Partial<MasterInventorySyncResult> = {}
): MasterInventorySyncResult => ({
  internalProductId: 'ol_product_1',
  itemsWritten: 1,
  availableQuantity: 5,
  reservedQuantity: 0,
  masterDeleted: false,
  pruneSkipped: false,
  ...overrides,
});

describe('MasterInventorySyncBatchHandler', () => {
  let handler: MasterInventorySyncBatchHandler;
  let masterInventorySync: jest.Mocked<IMasterInventorySyncService>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;

  beforeEach(() => {
    masterInventorySync = {
      syncFromMasterByExternalId: jest.fn(),
      syncFromMasterByExternalIds: jest.fn().mockResolvedValue({
        results: [syncedInventory()],
        failures: [],
        prefetched: true,
      }),
    } as unknown as jest.Mocked<IMasterInventorySyncService>;
    jobEnqueue = {
      enqueueJob: jest.fn().mockResolvedValue({ jobId: 'j', isExisting: false }),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    handler = new MasterInventorySyncBatchHandler(masterInventorySync, jobEnqueue);
  });

  const createJob = (payload: unknown): SyncJob =>
    ({
      id: 'batch-job-1',
      jobType: 'master.inventory.syncBatch',
      connectionId: 'conn-1',
      payload,
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
    }) as unknown as SyncJob;

  it('should sync the whole page through one service call', async () => {
    const result = await handler.execute(
      createJob({ schemaVersion: 1, externalIds: ['1', '2', '3'] })
    );

    expect(masterInventorySync.syncFromMasterByExternalIds).toHaveBeenCalledTimes(1);
    expect(masterInventorySync.syncFromMasterByExternalIds).toHaveBeenCalledWith('conn-1', [
      '1',
      '2',
      '3',
    ]);
    expect(result).toEqual({ outcome: 'ok' });
  });

  it('should re-enqueue a failed product as a per-product job, not fail the page', async () => {
    masterInventorySync.syncFromMasterByExternalIds.mockResolvedValue({
      results: [syncedInventory()],
      failures: [{ externalId: '2', message: 'read timeout' }],
      prefetched: true,
    });

    const result = await handler.execute(createJob({ schemaVersion: 1, externalIds: ['1', '2'] }));

    expect(result).toEqual({ outcome: 'ok' });
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
    const request = jobEnqueue.enqueueJob.mock.calls[0][0];
    // The sweep type, so a page-wide failure cannot fill the realtime lane with
    // stock work (#2594).
    expect(request.jobType).toBe('master.inventory.syncFromSweep');
    expect(request.payload).toEqual({
      schemaVersion: 1,
      externalId: '2',
      objectType: 'Product',
    });
    // A `batchRetry` namespace, so the same failure in a later cycle is a fresh
    // key rather than a dedup against a child that never ran.
    expect(request.idempotencyKey).toContain(':batchRetry:');
  });

  it('should stay ok when the per-product re-enqueue itself fails', async () => {
    masterInventorySync.syncFromMasterByExternalIds.mockResolvedValue({
      results: [],
      failures: [{ externalId: '2', message: 'read timeout' }],
      prefetched: false,
    });
    jobEnqueue.enqueueJob.mockRejectedValue(new Error('queue down'));

    await expect(
      handler.execute(createJob({ schemaVersion: 1, externalIds: ['2'] }))
    ).resolves.toEqual({ outcome: 'ok' });
  });

  it('should report ok for a page carrying a deletion, since the outcome label cannot describe a mixed page', async () => {
    masterInventorySync.syncFromMasterByExternalIds.mockResolvedValue({
      results: [syncedInventory(), syncedInventory({ masterDeleted: true })],
      failures: [],
      prefetched: true,
    });

    await expect(
      handler.execute(createJob({ schemaVersion: 1, externalIds: ['1', '2'] }))
    ).resolves.toEqual({ outcome: 'ok' });
    // The deletion itself already fired inside the service; nothing is
    // re-enqueued for it.
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('should throw for a whole-page failure so the job retries', async () => {
    masterInventorySync.syncFromMasterByExternalIds.mockRejectedValue(new Error('no adapter'));

    await expect(
      handler.execute(createJob({ schemaVersion: 1, externalIds: ['1'] }))
    ).rejects.toThrow(SyncJobExecutionError);
  });

  it.each([
    ['missing', null],
    ['empty', { schemaVersion: 1, externalIds: [] }],
    ['not strings', { schemaVersion: 1, externalIds: [1, 2] }],
  ])('should refuse a %s id list rather than report a healthy sync of nothing', async (_name, payload) => {
    await expect(handler.execute(createJob(payload))).rejects.toThrow(SyncJobExecutionError);
    expect(masterInventorySync.syncFromMasterByExternalIds).not.toHaveBeenCalled();
  });
});
