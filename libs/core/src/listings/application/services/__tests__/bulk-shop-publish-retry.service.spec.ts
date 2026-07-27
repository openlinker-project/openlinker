/**
 * Bulk Shop Publish Retry Service — unit spec (#1845)
 *
 * Covers the throw paths (batch not found, no failed children, missing
 * snapshot), selective retry of only failed children, V2 payload rebuild from
 * the record's request snapshot, wave-distinct idempotency key, per-record
 * counter decrement + advancement-gate delete + reset ordering, and the single
 * terminal->running flip.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import { BulkListingBatch } from '../../../domain/entities/bulk-listing-batch.entity';
import { ListingCreationRecord } from '../../../domain/entities/listing-creation-record.entity';
import { BulkListingBatchNotFoundException } from '../../../domain/exceptions/bulk-listing-batch-not-found.exception';
import { BulkRetryMissingSnapshotException } from '../../../domain/exceptions/bulk-retry-missing-snapshot.exception';
import { NoFailedChildrenToRetryException } from '../../../domain/exceptions/no-failed-children-to-retry.exception';
import {
  BULK_BATCH_STATUS,
  type BulkBatchStatus,
} from '../../../domain/types/bulk-listing-batch.types';
import {
  LISTING_CREATION_STATUS,
  type ListingCreationStatus,
  type ShopPublishRequestSnapshot,
} from '../../../domain/types/listing-creation-record.types';
import { BulkShopPublishRetryService } from '../bulk-shop-publish-retry.service';

const BATCH_ID = 'batch-1';
const CONN = 'conn-shop-1';
const VARIANT_A = 'ol_variant_a';
const VARIANT_B = 'ol_variant_b';

function snapshot(variantId: string): ShopPublishRequestSnapshot {
  return {
    internalVariantId: variantId,
    status: 'published',
    stock: 4,
    price: { amount: 10, currency: 'PLN' },
  };
}

function makeRecord(
  id: string,
  variantId: string,
  status: ListingCreationStatus,
  request: ShopPublishRequestSnapshot | null = snapshot(variantId),
): ListingCreationRecord {
  const now = new Date('2026-07-01T10:00:00Z');
  return new ListingCreationRecord(
    id,
    variantId,
    CONN,
    null,
    status,
    null,
    now,
    now,
    BATCH_ID,
    null,
    request,
  );
}

function makeBatch(status: BulkBatchStatus = BULK_BATCH_STATUS.PartiallyFailed): BulkListingBatch {
  return new BulkListingBatch(
    BATCH_ID,
    CONN,
    'user-1',
    status,
    2,
    1,
    1,
    {},
    new Date(),
    new Date(),
  );
}

describe('BulkShopPublishRetryService', () => {
  let batchRepo: {
    findById: jest.Mock;
    incrementCounters: jest.Mock;
    updateStatus: jest.Mock;
  };
  let records: { findByBulkBatchId: jest.Mock; resetForRetry: jest.Mock };
  let advancements: { deleteForRecord: jest.Mock };
  let integrations: { getCapabilityAdapter: jest.Mock };
  let jobEnqueue: { enqueueJob: jest.Mock };
  let service: BulkShopPublishRetryService;

  beforeEach(() => {
    batchRepo = {
      findById: jest.fn().mockResolvedValue(makeBatch()),
      incrementCounters: jest.fn().mockResolvedValue(makeBatch()),
      updateStatus: jest.fn().mockResolvedValue(makeBatch(BULK_BATCH_STATUS.Running)),
    };
    records = {
      findByBulkBatchId: jest.fn().mockResolvedValue([
        makeRecord('rec-a', VARIANT_A, LISTING_CREATION_STATUS.Failed),
        makeRecord('rec-b', VARIANT_B, LISTING_CREATION_STATUS.Published),
      ]),
      resetForRetry: jest.fn().mockResolvedValue(undefined),
    };
    advancements = { deleteForRecord: jest.fn().mockResolvedValue(undefined) };
    integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue({ publishProduct: jest.fn() }),
    };
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'job-1' }) };
    service = new BulkShopPublishRetryService(
      batchRepo as never,
      records as never,
      advancements as never,
      integrations as never,
      jobEnqueue as never,
    );
  });

  it('should throw when the batch is unknown', async () => {
    batchRepo.findById.mockResolvedValue(null);
    await expect(service.retryFailed(BATCH_ID)).rejects.toBeInstanceOf(
      BulkListingBatchNotFoundException,
    );
  });

  it('should throw when there are no failed children', async () => {
    records.findByBulkBatchId.mockResolvedValue([
      makeRecord('rec-b', VARIANT_B, LISTING_CREATION_STATUS.Published),
    ]);
    await expect(service.retryFailed(BATCH_ID)).rejects.toBeInstanceOf(
      NoFailedChildrenToRetryException,
    );
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('should throw when a failed record has no request snapshot', async () => {
    records.findByBulkBatchId.mockResolvedValue([
      makeRecord('rec-a', VARIANT_A, LISTING_CREATION_STATUS.Failed, null),
    ]);
    await expect(service.retryFailed(BATCH_ID)).rejects.toBeInstanceOf(
      BulkRetryMissingSnapshotException,
    );
  });

  it('should re-enqueue only failed children with a rebuilt V2 payload + wave-distinct key', async () => {
    const result = await service.retryFailed(BATCH_ID);

    expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(CONN, 'ProductPublisher');
    // Only the failed child (rec-a) is retried; the published one is skipped.
    expect(records.resetForRetry).toHaveBeenCalledTimes(1);
    expect(records.resetForRetry).toHaveBeenCalledWith('rec-a');
    expect(advancements.deleteForRecord).toHaveBeenCalledWith(BATCH_ID, 'rec-a');
    expect(batchRepo.incrementCounters).toHaveBeenCalledWith(BATCH_ID, { failed: -1 });

    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'shop.product.publish',
        connectionId: CONN,
        idempotencyKey: expect.stringMatching(
          new RegExp(`^bulk-publish:${BATCH_ID}:variant:${VARIANT_A}:retry:`),
        ) as unknown as string,
        payload: expect.objectContaining({
          schemaVersion: 2,
          internalVariantId: VARIANT_A,
          status: 'published',
          stock: 4,
          bulkBatchId: BATCH_ID,
          listingCreationRecordId: 'rec-a',
          price: { amount: 10, currency: 'PLN' },
        }),
      }),
    );

    expect(batchRepo.updateStatus).toHaveBeenCalledWith(BATCH_ID, BULK_BATCH_STATUS.Running);
    expect(result.retriedCount).toBe(1);
    expect(result.retriedRecordIds).toEqual(['rec-a']);
    expect(result.batchStatus).toBe(BULK_BATCH_STATUS.Running);
  });

  it('should not flip status when the batch is already running', async () => {
    batchRepo.findById.mockResolvedValue(makeBatch(BULK_BATCH_STATUS.Running));
    await service.retryFailed(BATCH_ID);
    expect(batchRepo.updateStatus).not.toHaveBeenCalled();
  });
});
