/**
 * Bulk Offer Creation Submit Service Tests (#736)
 *
 * Covers happy-path fan-out, partial-enqueue failure → batch flipped to
 * `'failed'`, capability check propagation, empty-productIds guard, and
 * the `getBatch` read.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */

import { UnprocessableEntityException } from '@nestjs/common';

import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { OfferManagerPort } from '@openlinker/core/listings';

import type { OfferCreationRecord } from '../../../domain/entities/offer-creation-record.entity';
import { BulkOfferCreationBatch } from '../../../domain/entities/bulk-offer-creation-batch.entity';
import { EmptyBulkSubmissionException } from '../../../domain/exceptions/empty-bulk-submission.exception';
import type { BulkOfferCreationBatchRepositoryPort } from '../../../domain/ports/bulk-offer-creation-batch-repository.port';
import type { OfferCreationRecordRepositoryPort } from '../../../domain/ports/offer-creation-record-repository.port';
import type { IOfferCreationEnqueueService } from '../../interfaces/offer-creation-enqueue.service.interface';
import { BulkOfferCreationSubmitService } from '../bulk-offer-creation-submit.service';

describe('BulkOfferCreationSubmitService', () => {
  let service: BulkOfferCreationSubmitService;
  let bulkBatchRepo: jest.Mocked<BulkOfferCreationBatchRepositoryPort>;
  let offerCreationRecords: jest.Mocked<OfferCreationRecordRepositoryPort>;
  let enqueueService: jest.Mocked<IOfferCreationEnqueueService>;
  let integrations: jest.Mocked<IIntegrationsService>;

  const connectionId = 'conn-1';
  const initiatedBy = 'user-1';

  const adapterWith = (createOffer: jest.Mock | undefined): OfferManagerPort =>
    ({
      ...(createOffer ? { createOffer } : {}),
    }) as unknown as OfferManagerPort;

  const makeBatch = (overrides: Partial<BulkOfferCreationBatch> = {}): BulkOfferCreationBatch =>
    new BulkOfferCreationBatch(
      overrides.id ?? 'batch-1',
      overrides.connectionId ?? connectionId,
      overrides.initiatedBy ?? initiatedBy,
      overrides.status ?? 'pending',
      overrides.totalCount ?? 3,
      overrides.succeededCount ?? 0,
      overrides.failedCount ?? 0,
      overrides.sharedConfig ?? {},
      overrides.createdAt ?? new Date('2026-05-17T10:00:00Z'),
      overrides.updatedAt ?? new Date('2026-05-17T10:00:00Z')
    );

  beforeEach(() => {
    bulkBatchRepo = {
      create: jest.fn().mockResolvedValue(makeBatch()),
      findById: jest.fn(),
      incrementCounters: jest.fn(),
      updateStatus: jest.fn().mockImplementation((id: string, status: string) =>
        Promise.resolve(makeBatch({ id, status: status as never }))
      ),
    };
    offerCreationRecords = {
      create: jest.fn(),
      findById: jest.fn(),
      findLatestByVariantAndConnection: jest.fn(),
      findByExternalOfferIdAndConnectionId: jest.fn(),
      updateStatus: jest.fn(),
      updateExternalOfferId: jest.fn(),
      updateExternalIdAndStatus: jest.fn(),
      findByBulkBatchId: jest.fn().mockResolvedValue([]),
      updateClassificationReport: jest.fn(),
    };
    enqueueService = {
      enqueueCreation: jest
        .fn()
        .mockImplementation((input: { internalVariantId: string }) =>
          Promise.resolve({
            jobId: `job-${input.internalVariantId}`,
            offerCreationRecord: {
              id: `record-${input.internalVariantId}`,
              internalVariantId: input.internalVariantId,
              connectionId,
            } as unknown as OfferCreationRecord,
          })
        ),
    };

    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn().mockResolvedValue(adapterWith(jest.fn())),
      listCapabilityAdapters: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    service = new BulkOfferCreationSubmitService(
      bulkBatchRepo,
      offerCreationRecords,
      enqueueService,
      integrations
    );
  });

  describe('submit', () => {
    it('persists the batch, fans out enqueues, returns batchId + positional jobIds, advances to running', async () => {
      const result = await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['v-a', 'v-b', 'v-c'],
        sharedConfig: { stock: 5, publishImmediately: false },
      });

      expect(bulkBatchRepo.create).toHaveBeenCalledWith({
        connectionId,
        initiatedBy,
        totalCount: 3,
        sharedConfig: { stock: 5, publishImmediately: false },
      });
      expect(enqueueService.enqueueCreation).toHaveBeenCalledTimes(3);
      expect(enqueueService.enqueueCreation.mock.calls[0][0]).toEqual({
        internalVariantId: 'v-a',
        connectionId,
        stock: 5,
        publishImmediately: false,
        bulkBatchId: 'batch-1',
        generateDescription: false,
      });
      expect(result).toEqual({
        batchId: 'batch-1',
        jobIds: ['job-v-a', 'job-v-b', 'job-v-c'],
      });
      expect(bulkBatchRepo.updateStatus).toHaveBeenCalledWith('batch-1', 'running');
    });

    it('merges per-product overrides over the shared config (per-product wins per field)', async () => {
      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['v-a', 'v-b'],
        sharedConfig: {
          stock: 5,
          publishImmediately: false,
          price: { amount: 10, currency: 'PLN' },
        },
        perProductOverrides: {
          'v-b': {
            stock: 99,
            price: { amount: 20, currency: 'PLN' },
          },
        },
      });

      expect(enqueueService.enqueueCreation.mock.calls[0][0]).toMatchObject({
        internalVariantId: 'v-a',
        stock: 5,
        price: { amount: 10, currency: 'PLN' },
      });
      expect(enqueueService.enqueueCreation.mock.calls[1][0]).toMatchObject({
        internalVariantId: 'v-b',
        stock: 99,
        price: { amount: 20, currency: 'PLN' },
      });
    });

    it('forwards AI flags from shared config into every enqueue call', async () => {
      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['v-a'],
        sharedConfig: {
          stock: 1,
          publishImmediately: false,
          generateDescription: true,
          descriptionTone: 'detailed',
        },
      });

      expect(enqueueService.enqueueCreation.mock.calls[0][0]).toMatchObject({
        generateDescription: true,
        descriptionTone: 'detailed',
      });
    });

    it('throws EmptyBulkSubmissionException without touching repos when productIds is empty', async () => {
      await expect(
        service.submit({
          connectionId,
          initiatedBy,
          productIds: [],
          sharedConfig: { stock: 5, publishImmediately: false },
        })
      ).rejects.toBeInstanceOf(EmptyBulkSubmissionException);

      expect(bulkBatchRepo.create).not.toHaveBeenCalled();
      expect(enqueueService.enqueueCreation).not.toHaveBeenCalled();
    });

    it('marks the batch as failed and re-throws when an enqueue rejects mid-fan-out', async () => {
      enqueueService.enqueueCreation
        .mockResolvedValueOnce({
          jobId: 'job-1',
          offerCreationRecord: {} as unknown as OfferCreationRecord,
        })
        .mockRejectedValueOnce(new Error('Redis Streams write failed'));

      await expect(
        service.submit({
          connectionId,
          initiatedBy,
          productIds: ['v-a', 'v-b', 'v-c'],
          sharedConfig: { stock: 5, publishImmediately: false },
        })
      ).rejects.toThrow('Redis Streams write failed');

      expect(bulkBatchRepo.updateStatus).toHaveBeenCalledWith('batch-1', 'failed');
      // The running-status flip never reaches, only the failed-flip is observed.
      expect(bulkBatchRepo.updateStatus).toHaveBeenCalledTimes(1);
    });

    it('does not crash when the failed-status flip itself also fails (best-effort)', async () => {
      enqueueService.enqueueCreation.mockRejectedValueOnce(new Error('downstream-fail'));
      bulkBatchRepo.updateStatus.mockRejectedValueOnce(new Error('db-down'));

      await expect(
        service.submit({
          connectionId,
          initiatedBy,
          productIds: ['v-a'],
          sharedConfig: { stock: 1, publishImmediately: false },
        })
      ).rejects.toThrow('downstream-fail');
    });

    it('propagates connection / capability exceptions from getCapabilityAdapter (no batch row created)', async () => {
      const err = Object.assign(new Error('OfferManager not supported'), {
        name: 'CapabilityNotSupportedException',
      });
      integrations.getCapabilityAdapter.mockRejectedValueOnce(err);

      await expect(
        service.submit({
          connectionId,
          initiatedBy,
          productIds: ['v-a'],
          sharedConfig: { stock: 1, publishImmediately: false },
        })
      ).rejects.toThrow('OfferManager not supported');

      expect(bulkBatchRepo.create).not.toHaveBeenCalled();
      expect(enqueueService.enqueueCreation).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException when the adapter lacks createOffer (no batch row created)', async () => {
      integrations.getCapabilityAdapter.mockResolvedValueOnce(adapterWith(undefined));

      await expect(
        service.submit({
          connectionId,
          initiatedBy,
          productIds: ['v-a'],
          sharedConfig: { stock: 1, publishImmediately: false },
        })
      ).rejects.toBeInstanceOf(UnprocessableEntityException);

      expect(bulkBatchRepo.create).not.toHaveBeenCalled();
      expect(enqueueService.enqueueCreation).not.toHaveBeenCalled();
    });
  });

  describe('getBatch', () => {
    it('returns null when the batch id is unknown', async () => {
      bulkBatchRepo.findById.mockResolvedValue(null);

      const result = await service.getBatch('missing');

      expect(result).toBeNull();
      expect(offerCreationRecords.findByBulkBatchId).not.toHaveBeenCalled();
    });

    it('returns batch + per-product records when found', async () => {
      const batch = makeBatch();
      bulkBatchRepo.findById.mockResolvedValue(batch);
      const records = [{ id: 'r-1' } as unknown as OfferCreationRecord];
      offerCreationRecords.findByBulkBatchId.mockResolvedValue(records);

      const result = await service.getBatch('batch-1');

      expect(result).toEqual({ batch, records });
      expect(offerCreationRecords.findByBulkBatchId).toHaveBeenCalledWith('batch-1');
    });
  });
});
