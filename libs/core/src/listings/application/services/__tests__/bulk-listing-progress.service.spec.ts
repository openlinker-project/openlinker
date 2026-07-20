/**
 * Bulk Offer Creation Progress Service — Unit Tests
 *
 * Covers the terminal-status derivation rule and the at-most-once gate via
 * `BulkBatchAdvancementRepositoryPort.markAdvancedIfNotExists`. Mocks both
 * repository ports; the service has no other collaborators.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import { BulkListingProgressService } from '../bulk-listing-progress.service';
import { BulkListingBatch } from '../../../domain/entities/bulk-listing-batch.entity';
import { BULK_BATCH_STATUS } from '../../../domain/types/bulk-listing-batch.types';
import type { BulkBatchAdvancementRepositoryPort } from '../../../domain/ports/bulk-batch-advancement-repository.port';
import type { BulkListingBatchRepositoryPort } from '../../../domain/ports/bulk-listing-batch-repository.port';

const BATCH_ID = 'batch-uuid-1';
const RECORD_ID = 'rec-uuid-1';

const buildBatch = (overrides: Partial<BulkListingBatch> = {}): BulkListingBatch => {
  const now = new Date('2026-05-17T10:00:00Z');
  return new BulkListingBatch(
    overrides.id ?? BATCH_ID,
    overrides.connectionId ?? 'conn-1',
    overrides.initiatedBy ?? 'user-1',
    overrides.status ?? BULK_BATCH_STATUS.Running,
    overrides.totalCount ?? 3,
    overrides.succeededCount ?? 0,
    overrides.failedCount ?? 0,
    overrides.sharedConfig ?? {},
    overrides.createdAt ?? now,
    overrides.updatedAt ?? now
  );
};

describe('BulkListingProgressService', () => {
  let service: BulkListingProgressService;
  let batches: jest.Mocked<BulkListingBatchRepositoryPort>;
  let advancements: jest.Mocked<BulkBatchAdvancementRepositoryPort>;

  beforeEach(() => {
    batches = {
      create: jest.fn(),
      findById: jest.fn(),
      incrementCounters: jest.fn(),
      updateStatus: jest.fn(),
      updateTotalCount: jest.fn(),
    };
    advancements = {
      markAdvancedIfNotExists: jest.fn(),
      deleteForRecord: jest.fn(),
    };
    service = new BulkListingProgressService(batches, advancements);
  });

  it('skips counter increment when advancement already exists (idempotent retry)', async () => {
    advancements.markAdvancedIfNotExists.mockResolvedValue({ created: false });

    const result = await service.advanceBatchStatus(BATCH_ID, RECORD_ID, 'succeeded');

    expect(result).toBeNull();
    expect(batches.incrementCounters).not.toHaveBeenCalled();
    expect(batches.updateStatus).not.toHaveBeenCalled();
  });

  it('increments succeeded counter when outcome=succeeded and not yet finished', async () => {
    advancements.markAdvancedIfNotExists.mockResolvedValue({ created: true });
    batches.incrementCounters.mockResolvedValue(
      buildBatch({ totalCount: 3, succeededCount: 1, failedCount: 0 })
    );

    const result = await service.advanceBatchStatus(BATCH_ID, RECORD_ID, 'succeeded');

    expect(advancements.markAdvancedIfNotExists).toHaveBeenCalledWith(BATCH_ID, RECORD_ID);
    expect(batches.incrementCounters).toHaveBeenCalledWith(BATCH_ID, { succeeded: 1 });
    expect(batches.updateStatus).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('increments failed counter when outcome=failed and not yet finished', async () => {
    advancements.markAdvancedIfNotExists.mockResolvedValue({ created: true });
    batches.incrementCounters.mockResolvedValue(
      buildBatch({ totalCount: 3, succeededCount: 0, failedCount: 1 })
    );

    const result = await service.advanceBatchStatus(BATCH_ID, RECORD_ID, 'failed');

    expect(batches.incrementCounters).toHaveBeenCalledWith(BATCH_ID, { failed: 1 });
    expect(batches.updateStatus).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('transitions to completed when all children succeed', async () => {
    advancements.markAdvancedIfNotExists.mockResolvedValue({ created: true });
    batches.incrementCounters.mockResolvedValue(
      buildBatch({ totalCount: 3, succeededCount: 3, failedCount: 0 })
    );
    const completedBatch = buildBatch({
      totalCount: 3,
      succeededCount: 3,
      failedCount: 0,
      status: BULK_BATCH_STATUS.Completed,
    });
    batches.updateStatus.mockResolvedValue(completedBatch);

    const result = await service.advanceBatchStatus(BATCH_ID, RECORD_ID, 'succeeded');

    expect(batches.updateStatus).toHaveBeenCalledWith(BATCH_ID, BULK_BATCH_STATUS.Completed);
    expect(result).toEqual(completedBatch);
  });

  it('transitions to failed when all children fail', async () => {
    advancements.markAdvancedIfNotExists.mockResolvedValue({ created: true });
    batches.incrementCounters.mockResolvedValue(
      buildBatch({ totalCount: 3, succeededCount: 0, failedCount: 3 })
    );
    const failedBatch = buildBatch({
      totalCount: 3,
      succeededCount: 0,
      failedCount: 3,
      status: BULK_BATCH_STATUS.Failed,
    });
    batches.updateStatus.mockResolvedValue(failedBatch);

    const result = await service.advanceBatchStatus(BATCH_ID, RECORD_ID, 'failed');

    expect(batches.updateStatus).toHaveBeenCalledWith(BATCH_ID, BULK_BATCH_STATUS.Failed);
    expect(result).toEqual(failedBatch);
  });

  it('transitions to partially-failed when mixed outcomes', async () => {
    advancements.markAdvancedIfNotExists.mockResolvedValue({ created: true });
    batches.incrementCounters.mockResolvedValue(
      buildBatch({ totalCount: 3, succeededCount: 2, failedCount: 1 })
    );
    const partialBatch = buildBatch({
      totalCount: 3,
      succeededCount: 2,
      failedCount: 1,
      status: BULK_BATCH_STATUS.PartiallyFailed,
    });
    batches.updateStatus.mockResolvedValue(partialBatch);

    const result = await service.advanceBatchStatus(BATCH_ID, RECORD_ID, 'failed');

    expect(batches.updateStatus).toHaveBeenCalledWith(BATCH_ID, BULK_BATCH_STATUS.PartiallyFailed);
    expect(result).toEqual(partialBatch);
  });

  it('does not transition status when totalCount has not been reached', async () => {
    advancements.markAdvancedIfNotExists.mockResolvedValue({ created: true });
    batches.incrementCounters.mockResolvedValue(
      buildBatch({ totalCount: 10, succeededCount: 5, failedCount: 2 })
    );

    const result = await service.advanceBatchStatus(BATCH_ID, RECORD_ID, 'succeeded');

    expect(batches.updateStatus).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
