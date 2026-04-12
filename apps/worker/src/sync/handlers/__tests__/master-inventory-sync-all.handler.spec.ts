/**
 * Master Inventory Sync All Handler Tests
 *
 * Unit tests for MasterInventorySyncAllHandler. Tests fan-out of
 * per-product inventory sync jobs from connection-level syncAll job.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MasterInventorySyncAllHandler } from '../master-inventory-sync-all.handler';
import { IdentifierMappingQueryPort } from '@openlinker/core/identifier-mapping';
import { JobEnqueuePort } from '@openlinker/core/sync';
import { SyncJob } from '@openlinker/core/sync/domain/entities/sync-job.entity';
import { SyncJobExecutionError } from '@openlinker/core/sync/domain/exceptions/sync-job-execution.error';

describe('MasterInventorySyncAllHandler', () => {
  let handler: MasterInventorySyncAllHandler;
  let identifierMapping: jest.Mocked<IdentifierMappingQueryPort>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;

  beforeEach(() => {
    identifierMapping = {
      getInternalId: jest.fn(),
      getExternalIds: jest.fn(),
      listExternalIdsByConnection: jest.fn(),
    };

    jobEnqueue = {
      enqueueJob: jest.fn(),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    handler = new MasterInventorySyncAllHandler(identifierMapping, jobEnqueue);
  });

  const createJob = (connectionId: string): SyncJob => ({
    id: 'job-id',
    jobType: 'master.inventory.syncAll',
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

  it('should enqueue syncByExternalId jobs for all products', async () => {
    identifierMapping.listExternalIdsByConnection.mockResolvedValue(['ext-1', 'ext-2', 'ext-3']);
    jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'new-job', isExisting: false });

    await handler.execute(createJob('conn-1'));

    expect(identifierMapping.listExternalIdsByConnection).toHaveBeenCalledWith('Product', 'conn-1');
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(3);

    const firstCall = jobEnqueue.enqueueJob.mock.calls[0][0];
    expect(firstCall.jobType).toBe('master.inventory.syncByExternalId');
    expect(firstCall.connectionId).toBe('conn-1');
    expect(firstCall.payload).toEqual(
      expect.objectContaining({ schemaVersion: 1, externalId: 'ext-1', objectType: 'Product' }),
    );
  });

  it('should handle empty product list gracefully', async () => {
    identifierMapping.listExternalIdsByConnection.mockResolvedValue([]);

    await handler.execute(createJob('conn-1'));

    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('should not throw when some enqueue calls fail', async () => {
    identifierMapping.listExternalIdsByConnection.mockResolvedValue(['ext-1', 'ext-2']);
    jobEnqueue.enqueueJob
      .mockResolvedValueOnce({ jobId: 'j1', isExisting: false })
      .mockRejectedValueOnce(new Error('queue full'));

    await expect(handler.execute(createJob('conn-1'))).resolves.toBeUndefined();
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
  });

  it('should throw SyncJobExecutionError when listing mappings fails', async () => {
    identifierMapping.listExternalIdsByConnection.mockRejectedValue(new Error('db down'));

    await expect(handler.execute(createJob('conn-1'))).rejects.toThrow(SyncJobExecutionError);
  });
});
