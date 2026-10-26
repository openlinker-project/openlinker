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
      findByIdempotencyKey: jest.fn(),
      clearIdempotencyKey: jest.fn(),
    };
    advancements = {
      markAdvancedIfNotExists: jest.fn(),
      reclassifySucceededAsFailed: jest.fn(),
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

    expect(advancements.markAdvancedIfNotExists).toHaveBeenCalledWith(
      BATCH_ID,
      RECORD_ID,
      'succeeded'
    );
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
  describe('reclassifyChildAsFailed (E2E-21)', () => {
    it('should move a succeeded child to failed and re-derive a one-child batch as failed', async () => {
      advancements.reclassifySucceededAsFailed.mockResolvedValue({ reclassified: true });
      batches.incrementCounters.mockResolvedValue(
        buildBatch({ totalCount: 1, succeededCount: 0, failedCount: 1 })
      );
      const failedBatch = buildBatch({
        totalCount: 1,
        succeededCount: 0,
        failedCount: 1,
        status: BULK_BATCH_STATUS.Failed,
      });
      batches.updateStatus.mockResolvedValue(failedBatch);

      const result = await service.reclassifyChildAsFailed(BATCH_ID, RECORD_ID);

      expect(advancements.reclassifySucceededAsFailed).toHaveBeenCalledWith(BATCH_ID, RECORD_ID);
      expect(batches.incrementCounters).toHaveBeenCalledWith(BATCH_ID, {
        succeeded: -1,
        failed: 1,
      });
      expect(advancements.markAdvancedIfNotExists).not.toHaveBeenCalled();
      expect(batches.updateStatus).toHaveBeenCalledWith(BATCH_ID, BULK_BATCH_STATUS.Failed);
      expect(result).toEqual(failedBatch);
    });

    it('should re-derive a mixed finished batch as partially-failed', async () => {
      advancements.reclassifySucceededAsFailed.mockResolvedValue({ reclassified: true });
      batches.incrementCounters.mockResolvedValue(
        buildBatch({ totalCount: 3, succeededCount: 2, failedCount: 1 })
      );

      await service.reclassifyChildAsFailed(BATCH_ID, RECORD_ID);

      expect(batches.updateStatus).toHaveBeenCalledWith(
        BATCH_ID,
        BULK_BATCH_STATUS.PartiallyFailed
      );
    });

    it('should adjust counters but leave status alone while children are outstanding', async () => {
      advancements.reclassifySucceededAsFailed.mockResolvedValue({ reclassified: true });
      batches.incrementCounters.mockResolvedValue(
        buildBatch({ totalCount: 3, succeededCount: 0, failedCount: 1 })
      );

      const result = await service.reclassifyChildAsFailed(BATCH_ID, RECORD_ID);

      expect(batches.incrementCounters).toHaveBeenCalledWith(BATCH_ID, {
        succeeded: -1,
        failed: 1,
      });
      expect(batches.updateStatus).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should adjust nothing when the child is already counted (replayed poll)', async () => {
      advancements.reclassifySucceededAsFailed.mockResolvedValue({ reclassified: false });
      advancements.markAdvancedIfNotExists.mockResolvedValue({ created: false });

      const result = await service.reclassifyChildAsFailed(BATCH_ID, RECORD_ID);

      expect(batches.incrementCounters).not.toHaveBeenCalled();
      expect(batches.updateStatus).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should count the child as failed when the poller wins the race against the create handler', async () => {
      advancements.reclassifySucceededAsFailed.mockResolvedValue({ reclassified: false });
      advancements.markAdvancedIfNotExists.mockResolvedValue({ created: true });
      batches.incrementCounters.mockResolvedValue(
        buildBatch({ totalCount: 3, succeededCount: 0, failedCount: 1 })
      );

      await service.reclassifyChildAsFailed(BATCH_ID, RECORD_ID);

      expect(advancements.markAdvancedIfNotExists).toHaveBeenCalledWith(
        BATCH_ID,
        RECORD_ID,
        'failed'
      );
      expect(batches.incrementCounters).toHaveBeenCalledWith(BATCH_ID, { failed: 1 });
    });
  });

  /**
   * Stateful regression for the live E2E-21 sequence, driven through in-memory
   * fakes of both ports so the counters and status are observed end to end
   * rather than asserted call by call.
   */
  describe('E2E-21 sequence against stateful fakes', () => {
    type Row = { outcome: 'succeeded' | 'failed' | null };

    function buildStateful(totalCount: number): {
      service: BulkListingProgressService;
      batch: () => BulkListingBatch;
      rows: Map<string, Row>;
    } {
      let state = buildBatch({ totalCount, status: BULK_BATCH_STATUS.Running });
      const rows = new Map<string, Row>();
      const statefulBatches: BulkListingBatchRepositoryPort = {
        create: jest.fn(),
        findById: jest.fn(),
        updateTotalCount: jest.fn(),
        findByIdempotencyKey: jest.fn(),
        clearIdempotencyKey: jest.fn(),
        incrementCounters: jest.fn((_id, d) => {
          state = buildBatch({
            ...state,
            succeededCount: state.succeededCount + (d.succeeded ?? 0),
            failedCount: state.failedCount + (d.failed ?? 0),
          });
          return Promise.resolve(state);
        }),
        updateStatus: jest.fn((_id, status) => {
          state = buildBatch({ ...state, status });
          return Promise.resolve(state);
        }),
      };
      const statefulAdvancements: BulkBatchAdvancementRepositoryPort = {
        markAdvancedIfNotExists: jest.fn((_b, recordId, outcome) => {
          if (rows.has(recordId)) return Promise.resolve({ created: false });
          rows.set(recordId, { outcome });
          return Promise.resolve({ created: true });
        }),
        reclassifySucceededAsFailed: jest.fn((_b, recordId) => {
          const row = rows.get(recordId);
          if (row?.outcome !== 'succeeded') return Promise.resolve({ reclassified: false });
          row.outcome = 'failed';
          return Promise.resolve({ reclassified: true });
        }),
        deleteForRecord: jest.fn(),
      };
      return {
        service: new BulkListingProgressService(statefulBatches, statefulAdvancements),
        batch: () => state,
        rows,
      };
    }

    it('should end FAILED 0/1 when the only child is accepted, counted, then rejected by the poller', async () => {
      const { service: svc, batch } = buildStateful(1);

      await svc.advanceBatchStatus(BATCH_ID, RECORD_ID, 'succeeded');
      expect(batch().status).toBe(BULK_BATCH_STATUS.Completed);

      await svc.reclassifyChildAsFailed(BATCH_ID, RECORD_ID);

      expect(batch()).toMatchObject({
        status: BULK_BATCH_STATUS.Failed,
        succeededCount: 0,
        failedCount: 1,
      });
    });

    it('should not double-adjust when the poll is replayed', async () => {
      const { service: svc, batch } = buildStateful(2);
      await svc.advanceBatchStatus(BATCH_ID, 'rec-a', 'succeeded');
      await svc.advanceBatchStatus(BATCH_ID, 'rec-b', 'succeeded');

      await svc.reclassifyChildAsFailed(BATCH_ID, 'rec-a');
      await svc.reclassifyChildAsFailed(BATCH_ID, 'rec-a');

      expect(batch()).toMatchObject({
        status: BULK_BATCH_STATUS.PartiallyFailed,
        succeededCount: 1,
        failedCount: 1,
      });
    });

    it('should keep a later create-handler advance from recounting a child the poller already failed', async () => {
      const { service: svc, batch } = buildStateful(1);

      await svc.reclassifyChildAsFailed(BATCH_ID, RECORD_ID);
      await svc.advanceBatchStatus(BATCH_ID, RECORD_ID, 'succeeded');

      expect(batch()).toMatchObject({
        status: BULK_BATCH_STATUS.Failed,
        succeededCount: 0,
        failedCount: 1,
      });
    });

    it('should never reclassify a legacy row with no recorded outcome', async () => {
      const { service: svc, batch, rows } = buildStateful(1);
      await svc.advanceBatchStatus(BATCH_ID, RECORD_ID, 'succeeded');
      rows.set(RECORD_ID, { outcome: null });

      await svc.reclassifyChildAsFailed(BATCH_ID, RECORD_ID);

      expect(batch()).toMatchObject({ succeededCount: 1, failedCount: 0 });
    });
  });
});
