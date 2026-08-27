/**
 * Master Product Sync Batch Handler Tests (#2593)
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MasterProductSyncBatchHandler } from '../master-product-sync-batch.handler';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { JobEnqueuePort, SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import type { IMasterProductSyncService, MasterProductSyncResult } from '@openlinker/core/products';
import type { IdentifierMappingQueryPort } from '@openlinker/core/identifier-mapping';

const syncedProduct = (overrides: Partial<MasterProductSyncResult> = {}): MasterProductSyncResult => ({
  internalProductId: 'ol_product_1',
  variantsUpserted: 1,
  masterDeleted: false,
  pruneSkipped: false,
  pruneSkippedReason: null,
  taxRateChanges: [],
  ...overrides,
});

describe('MasterProductSyncBatchHandler', () => {
  let handler: MasterProductSyncBatchHandler;
  let masterProductSync: jest.Mocked<IMasterProductSyncService>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let identifierMapping: jest.Mocked<IdentifierMappingQueryPort>;

  beforeEach(() => {
    masterProductSync = {
      syncFromMasterByExternalId: jest.fn(),
      syncFromMasterByExternalIds: jest.fn().mockResolvedValue({
        results: [syncedProduct()],
        failures: [],
        prefetched: true,
      }),
      markProductDeletedAtMaster: jest.fn(),
    } as unknown as jest.Mocked<IMasterProductSyncService>;
    jobEnqueue = {
      enqueueJob: jest.fn().mockResolvedValue({ jobId: 'j', isExisting: false }),
    } as unknown as jest.Mocked<JobEnqueuePort>;
    identifierMapping = {
      getExternalIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IdentifierMappingQueryPort>;

    handler = new MasterProductSyncBatchHandler(
      masterProductSync,
      jobEnqueue,
      identifierMapping
    );
  });

  const createJob = (payload: unknown): SyncJob =>
    ({
      id: 'batch-job-1',
      jobType: 'master.product.syncBatch',
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

    expect(masterProductSync.syncFromMasterByExternalIds).toHaveBeenCalledTimes(1);
    expect(masterProductSync.syncFromMasterByExternalIds).toHaveBeenCalledWith('conn-1', [
      '1',
      '2',
      '3',
    ]);
    expect(result).toEqual({ outcome: 'ok' });
  });

  it('should re-enqueue a failed product as a per-product job, not fail the page', async () => {
    masterProductSync.syncFromMasterByExternalIds.mockResolvedValue({
      results: [syncedProduct()],
      failures: [{ externalId: '2', message: 'read timeout' }],
      prefetched: true,
    });

    const result = await handler.execute(
      createJob({ schemaVersion: 1, externalIds: ['1', '2'] })
    );

    expect(result).toEqual({ outcome: 'ok' });
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
    const request = jobEnqueue.enqueueJob.mock.calls[0][0];
    expect(request.jobType).toBe('master.product.syncByExternalId');
    expect(request.payload).toEqual({
      schemaVersion: 1,
      externalId: '2',
      objectType: 'Product',
    });
  });

  it('should stay ok when the per-product re-enqueue itself fails', async () => {
    masterProductSync.syncFromMasterByExternalIds.mockResolvedValue({
      results: [],
      failures: [{ externalId: '2', message: 'read timeout' }],
      prefetched: false,
    });
    jobEnqueue.enqueueJob.mockRejectedValue(new Error('queue down'));

    await expect(
      handler.execute(createJob({ schemaVersion: 1, externalIds: ['2'] }))
    ).resolves.toEqual({ outcome: 'ok' });
  });

  it('should propagate a changed tax rate to the variant offers', async () => {
    masterProductSync.syncFromMasterByExternalIds.mockResolvedValue({
      results: [syncedProduct({ taxRateChanges: [{ variantId: 'ol_variant_1', taxRate: '23' }] })],
      failures: [],
      prefetched: true,
    });
    identifierMapping.getExternalIds = jest
      .fn()
      .mockResolvedValue([
        { entityType: 'Offer', connectionId: 'allegro-1', externalId: 'offer-1' },
      ]);

    await handler.execute(createJob({ schemaVersion: 1, externalIds: ['1'] }));

    const request = jobEnqueue.enqueueJob.mock.calls[0][0];
    expect(request.jobType).toBe('marketplace.offer.updateFields');
    expect(request.connectionId).toBe('allegro-1');
    expect(request.idempotencyKey).toBe('taxrate:allegro-1:ol_variant_1:23');
  });

  it('should throw for a whole-page failure so the job retries', async () => {
    masterProductSync.syncFromMasterByExternalIds.mockRejectedValue(new Error('no adapter'));

    await expect(
      handler.execute(createJob({ schemaVersion: 1, externalIds: ['1'] }))
    ).rejects.toThrow(SyncJobExecutionError);
  });

  it('should refuse an empty or malformed id list rather than report a healthy no-op', async () => {
    await expect(handler.execute(createJob({ schemaVersion: 1, externalIds: [] }))).rejects.toThrow(
      SyncJobExecutionError
    );
    await expect(handler.execute(createJob({ schemaVersion: 1 }))).rejects.toThrow(
      SyncJobExecutionError
    );
    await expect(
      handler.execute(createJob({ schemaVersion: 1, externalIds: [1, 2] }))
    ).rejects.toThrow(SyncJobExecutionError);
    expect(masterProductSync.syncFromMasterByExternalIds).not.toHaveBeenCalled();
  });
});
