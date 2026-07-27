/**
 * Bulk Offer Creation Retry Service — Unit Tests (#742)
 *
 * Covers 15 cases per plan §8:
 *  - 4 throw paths (batch not found, no failed, capability not supported, snapshot null)
 *  - Selective retry (mixed status filter)
 *  - V2 payload reconstruction (sharedConfig AI flags + snapshot fields)
 *  - AI flag fallbacks (missing / unknown tone)
 *  - Wave-distinct idempotency key
 *  - Per-record counter decrement (lock-stepped)
 *  - Terminal-state reopen (3 sources: partially-failed / failed / completed)
 *  - No flip when already running
 *  - Loop ordering (a)→(b)→(c)→(d)
 *  - Partial-failure recoverability (mid-loop throw)
 *
 * Mocks the five collaborators directly via port interfaces. No real DB or
 * Redis — repository's `deleteForRecord` SQL behaviour is covered by the
 * integration spec.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { OfferManagerPort } from '@openlinker/core/listings';
import type { JobEnqueuePort } from '@openlinker/core/sync';

import { BulkListingBatch } from '../../../domain/entities/bulk-listing-batch.entity';
import { AdapterCapabilityNotSupportedException } from '../../../domain/exceptions/adapter-capability-not-supported.exception';
import { BulkListingBatchNotFoundException } from '../../../domain/exceptions/bulk-listing-batch-not-found.exception';
import { BulkRetryMissingSnapshotException } from '../../../domain/exceptions/bulk-retry-missing-snapshot.exception';
import { NoFailedChildrenToRetryException } from '../../../domain/exceptions/no-failed-children-to-retry.exception';
import { OfferCreationRecord } from '../../../domain/entities/offer-creation-record.entity';
import type { BulkBatchAdvancementRepositoryPort } from '../../../domain/ports/bulk-batch-advancement-repository.port';
import type { BulkListingBatchRepositoryPort } from '../../../domain/ports/bulk-listing-batch-repository.port';
import type { OfferCreationRecordRepositoryPort } from '../../../domain/ports/offer-creation-record-repository.port';
import { BULK_BATCH_STATUS } from '../../../domain/types/bulk-listing-batch.types';
import type { OfferCreationStatus } from '../../../domain/types/offer-creation-record.types';
import type { OfferCreationRequestSnapshot } from '../../../domain/types/offer-creation-request-snapshot.types';
import { BulkListingRetryService } from '../bulk-listing-retry.service';

const BATCH_ID = 'batch-uuid-1';
const CONNECTION_ID = 'conn-allegro-1';
const VARIANT_A = 'ol_variant_a';
const VARIANT_B = 'ol_variant_b';

function makeRequestSnapshot(
  variantId: string,
  overrides: Partial<OfferCreationRequestSnapshot> = {}
): OfferCreationRequestSnapshot {
  return {
    schemaVersion: 1,
    internalVariantId: variantId,
    stock: overrides.stock ?? 3,
    publishImmediately: overrides.publishImmediately ?? true,
    ...(overrides.price !== undefined && { price: overrides.price }),
    ...(overrides.overrides !== undefined && { overrides: overrides.overrides }),
  };
}

function makeRecord(
  id: string,
  variantId: string,
  status: OfferCreationStatus,
  overrides: Partial<OfferCreationRecord> = {}
): OfferCreationRecord {
  const now = new Date('2026-05-18T10:00:00Z');
  // `??` would coerce explicit null to default — use `in` to preserve null.
  const request =
    'request' in overrides ? overrides.request ?? null : makeRequestSnapshot(variantId);
  return new OfferCreationRecord(
    id,
    variantId,
    CONNECTION_ID,
    overrides.externalOfferId ?? null,
    status,
    overrides.errors ?? null,
    overrides.publishImmediately ?? true,
    now,
    now,
    request,
    BATCH_ID,
    overrides.classificationReport ?? null
  );
}

function makeBatch(
  overrides: Partial<BulkListingBatch> = {}
): BulkListingBatch {
  const now = new Date('2026-05-18T09:00:00Z');
  return new BulkListingBatch(
    overrides.id ?? BATCH_ID,
    overrides.connectionId ?? CONNECTION_ID,
    overrides.initiatedBy ?? 'user-1',
    overrides.status ?? BULK_BATCH_STATUS.PartiallyFailed,
    overrides.totalCount ?? 5,
    overrides.succeededCount ?? 3,
    overrides.failedCount ?? 2,
    overrides.sharedConfig ?? {},
    now,
    now
  );
}

describe('BulkListingRetryService', () => {
  let service: BulkListingRetryService;
  let batches: jest.Mocked<BulkListingBatchRepositoryPort>;
  let records: jest.Mocked<OfferCreationRecordRepositoryPort>;
  let advancements: jest.Mocked<BulkBatchAdvancementRepositoryPort>;
  let integrations: jest.Mocked<Pick<IIntegrationsService, 'getCapabilityAdapter'>>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;

  beforeEach(() => {
    batches = {
      create: jest.fn(),
      findById: jest.fn(),
      incrementCounters: jest.fn().mockResolvedValue(makeBatch({ failedCount: 0 })),
      updateStatus: jest.fn().mockResolvedValue(makeBatch({ status: BULK_BATCH_STATUS.Running })),
      updateTotalCount: jest.fn(),
    };
    records = {
      create: jest.fn(),
      findById: jest.fn(),
      findLatestByVariantAndConnection: jest.fn(),
      findByExternalOfferIdAndConnectionId: jest.fn(),
      updateStatus: jest.fn(),
      updateExternalOfferId: jest.fn(),
      updateExternalIdAndStatus: jest.fn(),
      findByBulkBatchId: jest.fn(),
      deleteById: jest.fn(),
      updateClassificationReport: jest.fn(),
      resetForRetry: jest.fn().mockImplementation((id: string) =>
        Promise.resolve(makeRecord(id, VARIANT_A, 'pending'))
      ),
    };
    advancements = {
      markAdvancedIfNotExists: jest.fn(),
      deleteForRecord: jest.fn().mockResolvedValue(undefined),
    };
    const adapter = { createOffer: jest.fn() } as unknown as OfferManagerPort;
    integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(adapter),
    };
    jobEnqueue = {
      enqueueJob: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    service = new BulkListingRetryService(
      batches,
      records,
      advancements,
      integrations as unknown as IIntegrationsService,
      jobEnqueue
    );
  });

  // ── Throw paths ─────────────────────────────────────────────────────

  it('throws BulkListingBatchNotFoundException when batch missing', async () => {
    batches.findById.mockResolvedValueOnce(null);

    await expect(service.retryFailed(BATCH_ID)).rejects.toBeInstanceOf(
      BulkListingBatchNotFoundException
    );
    expect(records.findByBulkBatchId).not.toHaveBeenCalled();
  });

  it('throws NoFailedChildrenToRetryException when zero failed children', async () => {
    batches.findById.mockResolvedValueOnce(makeBatch());
    records.findByBulkBatchId.mockResolvedValueOnce([
      makeRecord('rec-1', VARIANT_A, 'active'),
      makeRecord('rec-2', VARIANT_B, 'active'),
    ]);

    await expect(service.retryFailed(BATCH_ID)).rejects.toBeInstanceOf(
      NoFailedChildrenToRetryException
    );
    expect(advancements.deleteForRecord).not.toHaveBeenCalled();
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    expect(batches.incrementCounters).not.toHaveBeenCalled();
    expect(batches.updateStatus).not.toHaveBeenCalled();
  });

  it('throws AdapterCapabilityNotSupportedException (domain, not NestJS) when adapter lacks createOffer', async () => {
    batches.findById.mockResolvedValueOnce(makeBatch());
    records.findByBulkBatchId.mockResolvedValueOnce([makeRecord('rec-1', VARIANT_A, 'failed')]);
    integrations.getCapabilityAdapter.mockResolvedValueOnce({} as unknown as OfferManagerPort);

    await expect(service.retryFailed(BATCH_ID)).rejects.toBeInstanceOf(
      AdapterCapabilityNotSupportedException
    );
    expect(advancements.deleteForRecord).not.toHaveBeenCalled();
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('throws BulkRetryMissingSnapshotException when a failed record has request=null (invariant)', async () => {
    batches.findById.mockResolvedValueOnce(makeBatch());
    records.findByBulkBatchId.mockResolvedValueOnce([
      makeRecord('rec-legacy', VARIANT_A, 'failed', {
        request: null as unknown as OfferCreationRequestSnapshot,
      }),
    ]);

    await expect(service.retryFailed(BATCH_ID)).rejects.toBeInstanceOf(
      BulkRetryMissingSnapshotException
    );
    expect(advancements.deleteForRecord).not.toHaveBeenCalled();
    expect(records.resetForRetry).not.toHaveBeenCalled();
    expect(batches.incrementCounters).not.toHaveBeenCalled();
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  // ── Selective retry ─────────────────────────────────────────────────

  it('retries only failed children, leaves succeeded/pending untouched', async () => {
    batches.findById.mockResolvedValueOnce(makeBatch());
    records.findByBulkBatchId.mockResolvedValueOnce([
      makeRecord('rec-1', VARIANT_A, 'active'), // skip
      makeRecord('rec-2', VARIANT_B, 'failed'), // retry
      makeRecord('rec-3', 'ol_variant_c', 'pending'), // skip
      makeRecord('rec-4', 'ol_variant_d', 'failed'), // retry
    ]);

    const result = await service.retryFailed(BATCH_ID);

    expect(result.retriedCount).toBe(2);
    expect(result.retriedRecordIds).toEqual(['rec-2', 'rec-4']);
    expect(advancements.deleteForRecord).toHaveBeenCalledTimes(2);
    expect(advancements.deleteForRecord).toHaveBeenNthCalledWith(1, BATCH_ID, 'rec-2');
    expect(advancements.deleteForRecord).toHaveBeenNthCalledWith(2, BATCH_ID, 'rec-4');
    expect(records.resetForRetry).toHaveBeenCalledTimes(2);
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
  });

  // ── V2 payload reconstruction ────────────────────────────────────────

  it('reconstructs V2 payload from snapshot + sharedConfig AI flags', async () => {
    batches.findById.mockResolvedValueOnce(
      makeBatch({
        sharedConfig: { generateDescription: true, descriptionTone: 'detailed' },
      })
    );
    records.findByBulkBatchId.mockResolvedValueOnce([
      makeRecord('rec-1', VARIANT_A, 'failed', {
        request: makeRequestSnapshot(VARIANT_A, {
          stock: 7,
          publishImmediately: false,
          price: { amount: 49.99, currency: 'PLN' },
        }),
      }),
    ]);

    await service.retryFailed(BATCH_ID);

    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith({
      jobType: 'marketplace.offer.create',
      connectionId: CONNECTION_ID,
      idempotencyKey: expect.stringMatching(
        new RegExp(`^bulk:${BATCH_ID}:variant:${VARIANT_A}:retry:[0-9a-f-]{36}$`)
      ),
      payload: expect.objectContaining({
        schemaVersion: 2,
        internalVariantId: VARIANT_A,
        stock: 7,
        publishImmediately: false,
        offerCreationRecordId: 'rec-1',
        bulkBatchId: BATCH_ID,
        generateDescription: true,
        descriptionTone: 'detailed',
        price: { amount: 49.99, currency: 'PLN' },
      }),
    });
  });

  it('defaults generateDescription to false when sharedConfig lacks it', async () => {
    batches.findById.mockResolvedValueOnce(makeBatch({ sharedConfig: {} }));
    records.findByBulkBatchId.mockResolvedValueOnce([
      makeRecord('rec-1', VARIANT_A, 'failed'),
    ]);

    await service.retryFailed(BATCH_ID);

    const payload = jobEnqueue.enqueueJob.mock.calls[0][0].payload;
    expect(payload.generateDescription).toBe(false);
    expect(payload.descriptionTone).toBeUndefined();
  });

  it('ignores unknown descriptionTone values in sharedConfig', async () => {
    batches.findById.mockResolvedValueOnce(
      makeBatch({
        sharedConfig: { generateDescription: true, descriptionTone: 'shouty' },
      })
    );
    records.findByBulkBatchId.mockResolvedValueOnce([
      makeRecord('rec-1', VARIANT_A, 'failed'),
    ]);

    await service.retryFailed(BATCH_ID);

    const payload = jobEnqueue.enqueueJob.mock.calls[0][0].payload;
    expect(payload.generateDescription).toBe(true);
    expect(payload.descriptionTone).toBeUndefined();
  });

  it('shares one retryWaveId across all children in a single call', async () => {
    batches.findById.mockResolvedValueOnce(makeBatch());
    records.findByBulkBatchId.mockResolvedValueOnce([
      makeRecord('rec-1', VARIANT_A, 'failed'),
      makeRecord('rec-2', VARIANT_B, 'failed'),
    ]);

    const result = await service.retryFailed(BATCH_ID);

    const keys = jobEnqueue.enqueueJob.mock.calls.map(
      (c) => c[0].idempotencyKey
    );
    const waveIds = keys.map((k) => k.split(':retry:')[1]);
    expect(waveIds[0]).toBe(waveIds[1]);
    expect(waveIds[0]).toBe(result.retryWaveId);
  });

  // ── Counter + status math ─────────────────────────────────────────────

  it('decrements failedCount per retried record (lock-stepped, not bulk after-loop)', async () => {
    batches.findById.mockResolvedValueOnce(
      makeBatch({ status: BULK_BATCH_STATUS.PartiallyFailed })
    );
    records.findByBulkBatchId.mockResolvedValueOnce([
      makeRecord('rec-1', VARIANT_A, 'failed'),
      makeRecord('rec-2', VARIANT_B, 'failed'),
    ]);

    const result = await service.retryFailed(BATCH_ID);

    expect(batches.incrementCounters).toHaveBeenCalledTimes(2);
    expect(batches.incrementCounters).toHaveBeenNthCalledWith(1, BATCH_ID, { failed: -1 });
    expect(batches.incrementCounters).toHaveBeenNthCalledWith(2, BATCH_ID, { failed: -1 });
    expect(batches.updateStatus).toHaveBeenCalledWith(BATCH_ID, BULK_BATCH_STATUS.Running);
    expect(result.batchStatus).toBe(BULK_BATCH_STATUS.Running);
  });

  it('does not flip batch status when batch was already running', async () => {
    batches.findById.mockResolvedValueOnce(makeBatch({ status: BULK_BATCH_STATUS.Running }));
    records.findByBulkBatchId.mockResolvedValueOnce([
      makeRecord('rec-1', VARIANT_A, 'failed'),
    ]);

    await service.retryFailed(BATCH_ID);

    expect(batches.incrementCounters).toHaveBeenCalledWith(BATCH_ID, { failed: -1 });
    expect(batches.updateStatus).not.toHaveBeenCalled();
  });

  it('reopens both `failed` and `completed` batches', async () => {
    for (const fromStatus of [BULK_BATCH_STATUS.Failed, BULK_BATCH_STATUS.Completed]) {
      batches.updateStatus.mockClear();
      batches.findById.mockResolvedValueOnce(makeBatch({ status: fromStatus }));
      records.findByBulkBatchId.mockResolvedValueOnce([
        makeRecord('rec-1', VARIANT_A, 'failed'),
      ]);

      await service.retryFailed(BATCH_ID);

      expect(batches.updateStatus).toHaveBeenCalledWith(BATCH_ID, BULK_BATCH_STATUS.Running);
    }
  });

  // ── Critical ordering (a)→(b)→(c)→(d) ─────────────────────────────────

  it('opens the advancement gate BEFORE enqueueing each job (prevents worker-handler swallow)', async () => {
    batches.findById.mockResolvedValueOnce(makeBatch());
    records.findByBulkBatchId.mockResolvedValueOnce([
      makeRecord('rec-1', VARIANT_A, 'failed'),
    ]);
    const callOrder: string[] = [];
    advancements.deleteForRecord.mockImplementationOnce(() => {
      callOrder.push('deleteForRecord');
      return Promise.resolve();
    });
    records.resetForRetry.mockImplementationOnce(() => {
      callOrder.push('resetForRetry');
      return Promise.resolve(makeRecord('rec-1', VARIANT_A, 'pending'));
    });
    batches.incrementCounters.mockImplementationOnce(() => {
      callOrder.push('incrementCounters');
      return Promise.resolve(makeBatch({ failedCount: 0 }));
    });
    jobEnqueue.enqueueJob.mockImplementationOnce(() => {
      callOrder.push('enqueueJob');
      return Promise.resolve({ jobId: 'job-1' } as never);
    });

    await service.retryFailed(BATCH_ID);

    expect(callOrder).toEqual([
      'deleteForRecord',
      'resetForRetry',
      'incrementCounters',
      'enqueueJob',
    ]);
  });

  it('partial-failure mid-loop: locally-mutated state stays consistent (recoverable on re-invoke)', async () => {
    batches.findById.mockResolvedValueOnce(makeBatch());
    records.findByBulkBatchId.mockResolvedValueOnce([
      makeRecord('rec-1', VARIANT_A, 'failed'),
      makeRecord('rec-2', VARIANT_B, 'failed'),
    ]);
    // First enqueue succeeds; second throws AFTER its local writes
    // (delete + reset + decrement) have run.
    jobEnqueue.enqueueJob
      .mockResolvedValueOnce({ jobId: 'job-1' } as never)
      .mockRejectedValueOnce(new Error('Redis blip'));

    await expect(service.retryFailed(BATCH_ID)).rejects.toThrow('Redis blip');

    expect(advancements.deleteForRecord).toHaveBeenCalledTimes(2);
    expect(records.resetForRetry).toHaveBeenCalledTimes(2);
    expect(batches.incrementCounters).toHaveBeenCalledTimes(2);
    expect(batches.updateStatus).not.toHaveBeenCalled();
    // Operator re-invokes retryFailed; upstream `status='failed'` filter
    // skips already-recovered rows, so the second record (now 'pending')
    // won't be re-iterated.
  });
});
