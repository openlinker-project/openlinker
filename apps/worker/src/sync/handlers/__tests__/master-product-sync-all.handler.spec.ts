/**
 * Master Product Sync All Handler Tests
 *
 * Unit tests for MasterProductSyncAllHandler. Covers pagination, fan-out, partial
 * failure tolerance, empty-catalog handling, and enumeration-failure propagation.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MasterProductSyncAllHandler } from '../master-product-sync-all.handler';
import type { JobEnqueuePort } from '@openlinker/core/sync';
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { ProductMasterPort } from '@openlinker/core/products';
import type { ConfigService } from '@nestjs/config';

describe('MasterProductSyncAllHandler', () => {
  let handler: MasterProductSyncAllHandler;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let productMaster: jest.Mocked<ProductMasterPort>;

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

    const configService = {
      get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
    } as unknown as jest.Mocked<ConfigService>;

    handler = new MasterProductSyncAllHandler(integrationsService, jobEnqueue, configService);
  });

  const createJob = (connectionId: string): SyncJob => ({
    id: 'outer-job-1',
    jobType: 'master.product.syncAll',
    connectionId,
    payload: { schemaVersion: 1 },
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

  it('should enqueue per-product sync job for each discovered external id', async () => {
    productMaster.listExternalIds.mockResolvedValueOnce(['1', '2', '3']).mockResolvedValueOnce([]);
    jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

    await handler.execute(createJob('conn-1'));

    expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
      'conn-1',
      'ProductMaster'
    );
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(3);
    const first = jobEnqueue.enqueueJob.mock.calls[0][0];
    expect(first.jobType).toBe('master.product.syncByExternalId');
    expect(first.connectionId).toBe('conn-1');
    expect(first.payload).toEqual({ schemaVersion: 1, externalId: '1', objectType: 'Product' });
    expect(first.idempotencyKey).toBe('master:conn-1:product:sync:1:outer-job-1');
  });

  it('should paginate through multiple pages until a short page is returned', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => String(i));
    productMaster.listExternalIds
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce(['x1', 'x2']);
    jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

    await handler.execute(createJob('conn-1'));

    expect(productMaster.listExternalIds).toHaveBeenCalledTimes(2);
    expect(productMaster.listExternalIds).toHaveBeenNthCalledWith(1, { limit: 100, offset: 0 });
    expect(productMaster.listExternalIds).toHaveBeenNthCalledWith(2, { limit: 100, offset: 100 });
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(102);
  });

  it('should deduplicate external ids repeated across pages', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => String(i));
    // Second page overlaps with first — defensive dedupe should keep the count honest.
    productMaster.listExternalIds
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce(['99', '100']);
    jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: false });

    await handler.execute(createJob('conn-1'));

    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(101);
  });

  it('should handle empty catalog gracefully', async () => {
    productMaster.listExternalIds.mockResolvedValue([]);

    await handler.execute(createJob('conn-1'));

    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('should not throw when some enqueue calls fail', async () => {
    productMaster.listExternalIds.mockResolvedValueOnce(['1', '2']).mockResolvedValueOnce([]);
    jobEnqueue.enqueueJob
      .mockResolvedValueOnce({ jobId: 'j1', isExisting: false })
      .mockRejectedValueOnce(new Error('queue full'));

    await expect(handler.execute(createJob('conn-1'))).resolves.toEqual({ outcome: 'ok' });
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
});
