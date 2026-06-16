/**
 * Bulk Shop Publish Submit Service — unit spec
 *
 * Covers empty-submission guard, capability validation, batch persistence,
 * per-variant fan-out through the single-publish primitive (with bulkBatchId),
 * pending→running transition, first-enqueue-failure → batch failed, and getBatch.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */

import { EmptyBulkSubmissionException } from '../../../domain/exceptions/empty-bulk-submission.exception';
import { BulkShopPublishSubmitService } from '../bulk-shop-publish-submit.service';

const CONN = 'conn-shop-1';
const USER = 'user-1';

describe('BulkShopPublishSubmitService', () => {
  let integrations: { getCapabilityAdapter: jest.Mock };
  let batchRepo: { create: jest.Mock; findById: jest.Mock; updateStatus: jest.Mock };
  let enqueue: { enqueuePublish: jest.Mock };
  let records: { findByBulkBatchId: jest.Mock };
  let service: BulkShopPublishSubmitService;

  const input = {
    connectionId: CONN,
    initiatedBy: USER,
    internalVariantIds: ['v1', 'v2'],
    status: 'published' as const,
    stock: 3,
  };

  beforeEach(() => {
    integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue({ publishProduct: jest.fn() }),
    };
    batchRepo = {
      create: jest.fn().mockResolvedValue({ id: 'batch-1', totalCount: 2 }),
      findById: jest.fn(),
      updateStatus: jest.fn().mockResolvedValue({ id: 'batch-1' }),
    };
    enqueue = {
      enqueuePublish: jest
        .fn()
        .mockImplementation(({ internalVariantId }: { internalVariantId: string }) =>
          Promise.resolve({
            jobId: `job-${internalVariantId}`,
            listingCreationRecord: { id: `rec-${internalVariantId}` },
          }),
        ),
    };
    records = { findByBulkBatchId: jest.fn() };
    service = new BulkShopPublishSubmitService(
      integrations as never,
      batchRepo as never,
      enqueue as never,
      records as never,
    );
  });

  it('should reject an empty submission', async () => {
    await expect(service.submit({ ...input, internalVariantIds: [] })).rejects.toBeInstanceOf(
      EmptyBulkSubmissionException,
    );
    expect(batchRepo.create).not.toHaveBeenCalled();
  });

  it('should persist the batch, fan out one publish per variant with bulkBatchId, and flip to running', async () => {
    const result = await service.submit(input);

    expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(CONN, 'ProductPublisher');
    expect(batchRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: CONN, initiatedBy: USER, totalCount: 2 }),
    );
    expect(enqueue.enqueuePublish).toHaveBeenCalledTimes(2);
    expect(enqueue.enqueuePublish).toHaveBeenCalledWith(
      expect.objectContaining({ internalVariantId: 'v1', bulkBatchId: 'batch-1', stock: 3 }),
    );
    expect(batchRepo.updateStatus).toHaveBeenCalledWith('batch-1', 'running');
    expect(result).toEqual({
      batchId: 'batch-1',
      items: [
        { internalVariantId: 'v1', jobId: 'job-v1', listingCreationRecordId: 'rec-v1' },
        { internalVariantId: 'v2', jobId: 'job-v2', listingCreationRecordId: 'rec-v2' },
      ],
    });
  });

  it('should mark the batch failed and rethrow on a partial enqueue failure', async () => {
    enqueue.enqueuePublish
      .mockResolvedValueOnce({ jobId: 'job-v1', listingCreationRecord: { id: 'rec-v1' } })
      .mockRejectedValueOnce(new Error('redis down'));

    await expect(service.submit(input)).rejects.toThrow('redis down');
    expect(batchRepo.updateStatus).toHaveBeenCalledWith('batch-1', 'failed');
    expect(batchRepo.updateStatus).not.toHaveBeenCalledWith('batch-1', 'running');
  });

  describe('getBatch', () => {
    it('should return the batch + its child records', async () => {
      batchRepo.findById.mockResolvedValue({ id: 'batch-1' });
      records.findByBulkBatchId.mockResolvedValue([{ id: 'rec-v1' }]);

      const summary = await service.getBatch('batch-1');

      expect(summary).toEqual({ batch: { id: 'batch-1' }, records: [{ id: 'rec-v1' }] });
    });

    it('should return null for an unknown batch', async () => {
      batchRepo.findById.mockResolvedValue(null);
      expect(await service.getBatch('nope')).toBeNull();
      expect(records.findByBulkBatchId).not.toHaveBeenCalled();
    });
  });
});
