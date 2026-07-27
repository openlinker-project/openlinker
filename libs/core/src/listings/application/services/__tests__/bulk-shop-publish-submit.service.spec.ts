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
  let batchRepo: {
    create: jest.Mock;
    findById: jest.Mock;
    updateStatus: jest.Mock;
    updateTotalCount: jest.Mock;
  };
  let enqueue: { enqueuePublish: jest.Mock };
  let records: { findByBulkBatchId: jest.Mock; deleteById: jest.Mock };
  let service: BulkShopPublishSubmitService;

  const input = {
    connectionId: CONN,
    initiatedBy: USER,
    items: [
      { internalVariantId: 'v1', stock: 3 },
      { internalVariantId: 'v2', stock: 5 },
    ],
    status: 'published' as const,
  };

  beforeEach(() => {
    integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue({ publishProduct: jest.fn() }),
    };
    batchRepo = {
      create: jest.fn().mockResolvedValue({ id: 'batch-1', totalCount: 2 }),
      findById: jest.fn(),
      updateStatus: jest.fn().mockResolvedValue({ id: 'batch-1' }),
      updateTotalCount: jest.fn().mockResolvedValue({
        id: 'batch-1',
        totalCount: 1,
        succeededCount: 0,
        failedCount: 0,
      }),
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
    records = { findByBulkBatchId: jest.fn().mockResolvedValue([]), deleteById: jest.fn() };
    service = new BulkShopPublishSubmitService(
      integrations as never,
      batchRepo as never,
      enqueue as never,
      records as never,
    );
  });

  it('should reject an empty submission', async () => {
    await expect(service.submit({ ...input, items: [] })).rejects.toBeInstanceOf(
      EmptyBulkSubmissionException,
    );
    expect(batchRepo.create).not.toHaveBeenCalled();
  });

  it('should persist the batch, fan out one publish per variant with bulkBatchId and its own stock, and flip to running', async () => {
    const result = await service.submit(input);

    expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(CONN, 'ProductPublisher');
    expect(batchRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: CONN, initiatedBy: USER, totalCount: 2 }),
    );
    expect(enqueue.enqueuePublish).toHaveBeenCalledTimes(2);
    expect(enqueue.enqueuePublish).toHaveBeenCalledWith(
      expect.objectContaining({ internalVariantId: 'v1', bulkBatchId: 'batch-1', stock: 3 }),
    );
    expect(enqueue.enqueuePublish).toHaveBeenCalledWith(
      expect.objectContaining({ internalVariantId: 'v2', bulkBatchId: 'batch-1', stock: 5 }),
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

  it('should let per-item content/categories/parameters win over batch-shared defaults (#1831)', async () => {
    const batchContent = { title: 'Batch title' };
    const itemContent = { title: 'Item title' };
    const itemParameters = [{ id: 'Colour', values: ['Red'], section: 'product' as const }];

    await service.submit({
      ...input,
      content: batchContent,
      items: [
        // Overriding item: its own content/categories/parameters must win.
        {
          internalVariantId: 'v1',
          stock: 3,
          content: itemContent,
          destinationCategoryIds: ['cat-override'],
          parameters: itemParameters,
        },
        // Passthrough item: falls back to the batch-shared content, no overrides.
        { internalVariantId: 'v2', stock: 5 },
      ],
    });

    expect(enqueue.enqueuePublish).toHaveBeenCalledWith(
      expect.objectContaining({
        internalVariantId: 'v1',
        content: itemContent,
        destinationCategoryIds: ['cat-override'],
        parameters: itemParameters,
      }),
    );

    const calls = enqueue.enqueuePublish.mock.calls as Array<[{ internalVariantId: string }]>;
    const v2Arg = calls.map(([arg]) => arg).find((arg) => arg.internalVariantId === 'v2');
    expect(v2Arg).toEqual(
      expect.objectContaining({ internalVariantId: 'v2', content: batchContent }),
    );
    expect(v2Arg).not.toHaveProperty('destinationCategoryIds');
    expect(v2Arg).not.toHaveProperty('parameters');
  });

  it('should forward batch-scoped AI description flags to every child enqueue (#1840)', async () => {
    await service.submit({ ...input, generateDescription: true, descriptionTone: 'concise' });

    expect(enqueue.enqueuePublish).toHaveBeenCalledTimes(2);
    for (const call of enqueue.enqueuePublish.mock.calls as Array<[Record<string, unknown>]>) {
      expect(call[0]).toEqual(
        expect.objectContaining({ generateDescription: true, descriptionTone: 'concise' }),
      );
    }
  });

  it('should reconcile totalCount, clean orphans and reach running on a partial enqueue failure (#1845)', async () => {
    // v1 enqueues; v2 pre-creates its record then throws before the stream write.
    enqueue.enqueuePublish
      .mockResolvedValueOnce({ jobId: 'job-v1', listingCreationRecord: { id: 'rec-v1' } })
      .mockRejectedValueOnce(new Error('redis down'));
    // Both records exist in the DB; rec-v2 is the orphan whose enqueue threw.
    records.findByBulkBatchId.mockResolvedValue([{ id: 'rec-v1' }, { id: 'rec-v2' }]);

    await expect(service.submit(input)).rejects.toThrow('redis down');

    // Orphan (never reached the stream) is deleted; the enqueued one is kept.
    expect(records.deleteById).toHaveBeenCalledWith('rec-v2');
    expect(records.deleteById).not.toHaveBeenCalledWith('rec-v1');
    // totalCount reconciled down to what actually enqueued (1).
    expect(batchRepo.updateTotalCount).toHaveBeenCalledWith('batch-1', 1);
    // With 1 enqueued child still pending, the batch advances to running.
    expect(batchRepo.updateStatus).toHaveBeenCalledWith('batch-1', 'running');
    expect(batchRepo.updateStatus).not.toHaveBeenCalledWith('batch-1', 'failed');
  });

  it('should derive a terminal status when all reconciled children already finished (#1845)', async () => {
    enqueue.enqueuePublish
      .mockResolvedValueOnce({ jobId: 'job-v1', listingCreationRecord: { id: 'rec-v1' } })
      .mockRejectedValueOnce(new Error('redis down'));
    records.findByBulkBatchId.mockResolvedValue([{ id: 'rec-v1' }]);
    // The single enqueued child already succeeded before reconcile ran.
    batchRepo.updateTotalCount.mockResolvedValue({
      id: 'batch-1',
      totalCount: 1,
      succeededCount: 1,
      failedCount: 0,
    });

    await expect(service.submit(input)).rejects.toThrow('redis down');
    expect(batchRepo.updateStatus).toHaveBeenCalledWith('batch-1', 'completed');
  });

  it('should mark the batch failed when nothing enqueued (#1845)', async () => {
    enqueue.enqueuePublish.mockRejectedValueOnce(new Error('redis down'));
    records.findByBulkBatchId.mockResolvedValue([{ id: 'rec-v1' }]);

    await expect(service.submit(input)).rejects.toThrow('redis down');
    // Orphan cleanup still runs, then a terminal 'failed' (no children to count).
    expect(records.deleteById).toHaveBeenCalledWith('rec-v1');
    expect(batchRepo.updateTotalCount).not.toHaveBeenCalled();
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
