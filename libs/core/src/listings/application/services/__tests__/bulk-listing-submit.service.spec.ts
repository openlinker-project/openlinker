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
import type { IProductsService, ProductVariant } from '@openlinker/core/products';
import type { IInventoryQueryService } from '@openlinker/core/inventory';

import type { OfferCreationRecord } from '../../../domain/entities/offer-creation-record.entity';
import { BulkListingBatch } from '../../../domain/entities/bulk-listing-batch.entity';
import { EmptyBulkSubmissionException } from '../../../domain/exceptions/empty-bulk-submission.exception';
import type { BulkListingBatchRepositoryPort } from '../../../domain/ports/bulk-listing-batch-repository.port';
import type { OfferCreationRecordRepositoryPort } from '../../../domain/ports/offer-creation-record-repository.port';
import type { IOfferCreationEnqueueService } from '../../interfaces/offer-creation-enqueue.service.interface';
import { BulkListingSubmitService } from '../bulk-listing-submit.service';

describe('BulkListingSubmitService', () => {
  let service: BulkListingSubmitService;
  let bulkBatchRepo: jest.Mocked<BulkListingBatchRepositoryPort>;
  let offerCreationRecords: jest.Mocked<OfferCreationRecordRepositoryPort>;
  let enqueueService: jest.Mocked<IOfferCreationEnqueueService>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let products: jest.Mocked<Pick<IProductsService, 'getVariant' | 'getVariantsByProductId'>>;
  let inventoryQuery: jest.Mocked<Pick<IInventoryQueryService, 'getAvailabilityByVariantIds'>>;

  const connectionId = 'conn-1';
  const initiatedBy = 'user-1';

  const adapterWith = (createOffer: jest.Mock | undefined): OfferManagerPort =>
    ({
      ...(createOffer ? { createOffer } : {}),
    }) as unknown as OfferManagerPort;

  const variant = (overrides: Partial<ProductVariant> & Pick<ProductVariant, 'id' | 'productId'>): ProductVariant => ({
    sku: null,
    attributes: null,
    ean: null,
    gtin: null,
    ...overrides,
  });

  const makeBatch = (overrides: Partial<BulkListingBatch> = {}): BulkListingBatch =>
    new BulkListingBatch(
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
      resetForRetry: jest.fn(),
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

    // Default: every id resolves to an unknown variant → passthrough (pre-#824
    // behaviour). Multi-variant tests override per-id.
    products = {
      getVariant: jest.fn().mockResolvedValue(null),
      getVariantsByProductId: jest.fn().mockResolvedValue([]),
    };
    inventoryQuery = {
      getAvailabilityByVariantIds: jest.fn().mockResolvedValue([]),
    };

    service = new BulkListingSubmitService(
      bulkBatchRepo,
      offerCreationRecords,
      enqueueService,
      integrations,
      products as unknown as IProductsService,
      inventoryQuery as unknown as IInventoryQueryService
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

    it('preserves shared platformParams when a per-product override has none, and deep-merges when it does (#808)', async () => {
      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['v-a', 'v-b'],
        sharedConfig: {
          stock: 5,
          publishImmediately: false,
          overrides: {
            platformParams: { deliveryPolicyId: 'dp-shared', handlingTime: 'PT24H' },
          },
        },
        perProductOverrides: {
          // Row override carries category/card but NO platformParams — the
          // shared deliveryPolicyId must still flow through (the bug: a
          // wholesale replace dropped it → DefaultShippingRatesNotFound).
          'v-a': { overrides: { categoryId: '257933', productCardId: 'card-a' } },
          // Row override with its own platformParams — deep-merged: per-product
          // key wins, shared sibling key survives.
          'v-b': { overrides: { platformParams: { deliveryPolicyId: 'dp-b' } } },
        },
      });

      expect(enqueueService.enqueueCreation.mock.calls[0][0]).toMatchObject({
        internalVariantId: 'v-a',
        overrides: {
          categoryId: '257933',
          productCardId: 'card-a',
          platformParams: { deliveryPolicyId: 'dp-shared', handlingTime: 'PT24H' },
        },
      });
      expect(enqueueService.enqueueCreation.mock.calls[1][0]).toMatchObject({
        internalVariantId: 'v-b',
        overrides: {
          platformParams: { deliveryPolicyId: 'dp-b', handlingTime: 'PT24H' },
        },
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

  describe('multi-variant expansion (#824)', () => {
    it('expands a multi-variant product into one offer per variant with per-variant master stock', async () => {
      products.getVariant.mockResolvedValue(variant({ id: 'v-a', productId: 'P', ean: '111' }));
      products.getVariantsByProductId.mockResolvedValue([
        variant({ id: 'v-a', productId: 'P', ean: '111' }),
        variant({ id: 'v-b', productId: 'P', ean: '222' }),
        variant({ id: 'v-c', productId: 'P', ean: '333' }),
      ]);
      inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'v-a', totalAvailable: 10, locationCount: 1 },
        { productVariantId: 'v-b', totalAvailable: 5, locationCount: 1 },
        { productVariantId: 'v-c', totalAvailable: 0, locationCount: 0 },
      ]);

      const result = await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['v-a'],
        sharedConfig: { stock: 7, publishImmediately: false },
      });

      expect(inventoryQuery.getAvailabilityByVariantIds).toHaveBeenCalledWith(['v-a', 'v-b', 'v-c']);
      expect(bulkBatchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ totalCount: 3 })
      );
      expect(enqueueService.enqueueCreation).toHaveBeenCalledTimes(3);
      expect(enqueueService.enqueueCreation.mock.calls.map((c) => c[0])).toEqual([
        expect.objectContaining({ internalVariantId: 'v-a', stock: 10 }),
        expect.objectContaining({ internalVariantId: 'v-b', stock: 5 }),
        // v-c has 0 master stock → master is authoritative, lists as 0 (no
        // phantom backfill to the operator's bulk quantity of 7).
        expect.objectContaining({ internalVariantId: 'v-c', stock: 0 }),
      ]);
      expect(result.jobIds).toEqual(['job-v-a', 'job-v-b', 'job-v-c']);
    });

    it('expands each selected product once when two variants of the same product are submitted', async () => {
      products.getVariant.mockImplementation((id: string) =>
        Promise.resolve(variant({ id, productId: 'P', ean: id }))
      );
      products.getVariantsByProductId.mockResolvedValue([
        variant({ id: 'v-a', productId: 'P', ean: '111' }),
        variant({ id: 'v-b', productId: 'P', ean: '222' }),
        variant({ id: 'v-c', productId: 'P', ean: '333' }),
      ]);
      inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'v-a', totalAvailable: 1, locationCount: 1 },
        { productVariantId: 'v-b', totalAvailable: 1, locationCount: 1 },
        { productVariantId: 'v-c', totalAvailable: 1, locationCount: 1 },
      ]);

      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['v-a', 'v-b'],
        sharedConfig: { stock: 7, publishImmediately: false },
      });

      // 3 distinct variants, not 6 — the second selected id is already covered.
      expect(enqueueService.enqueueCreation).toHaveBeenCalledTimes(3);
      expect(products.getVariantsByProductId).toHaveBeenCalledTimes(1);
      expect(bulkBatchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ totalCount: 3 })
      );
    });

    it('leaves a single-variant product unchanged and issues no inventory query', async () => {
      products.getVariant.mockResolvedValue(variant({ id: 'v-a', productId: 'P', ean: '111' }));
      products.getVariantsByProductId.mockResolvedValue([
        variant({ id: 'v-a', productId: 'P', ean: '111' }),
      ]);

      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['v-a'],
        sharedConfig: { stock: 9, publishImmediately: false },
      });

      expect(enqueueService.enqueueCreation).toHaveBeenCalledTimes(1);
      expect(enqueueService.enqueueCreation.mock.calls[0][0]).toMatchObject({
        internalVariantId: 'v-a',
        stock: 9,
      });
      expect(inventoryQuery.getAvailabilityByVariantIds).not.toHaveBeenCalled();
      expect(bulkBatchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ totalCount: 1 })
      );
    });

    it('skips sibling variants without a barcode (cannot link to a catalog product)', async () => {
      products.getVariant.mockResolvedValue(variant({ id: 'v-a', productId: 'P', ean: '111' }));
      products.getVariantsByProductId.mockResolvedValue([
        variant({ id: 'v-a', productId: 'P', ean: '111' }),
        variant({ id: 'v-b', productId: 'P' }), // no ean/gtin → skipped
        variant({ id: 'v-c', productId: 'P', gtin: '333' }),
      ]);
      inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'v-a', totalAvailable: 4, locationCount: 1 },
        { productVariantId: 'v-c', totalAvailable: 2, locationCount: 1 },
      ]);

      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['v-a'],
        sharedConfig: { stock: 7, publishImmediately: false },
      });

      expect(enqueueService.enqueueCreation).toHaveBeenCalledTimes(2);
      expect(enqueueService.enqueueCreation.mock.calls.map((c) => c[0].internalVariantId)).toEqual([
        'v-a',
        'v-c',
      ]);
      expect(inventoryQuery.getAvailabilityByVariantIds).toHaveBeenCalledWith(['v-a', 'v-c']);
    });

    it('still lists the selected variant when the product variant list omits it (defensive)', async () => {
      products.getVariant.mockResolvedValue(variant({ id: 'v-a', productId: 'P', ean: '111' }));
      // Inconsistent: siblings do not include the selected v-a.
      products.getVariantsByProductId.mockResolvedValue([
        variant({ id: 'v-b', productId: 'P', ean: '222' }),
        variant({ id: 'v-c', productId: 'P', ean: '333' }),
      ]);
      inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'v-b', totalAvailable: 1, locationCount: 1 },
        { productVariantId: 'v-c', totalAvailable: 1, locationCount: 1 },
        { productVariantId: 'v-a', totalAvailable: 1, locationCount: 1 },
      ]);

      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['v-a'],
        sharedConfig: { stock: 7, publishImmediately: false },
      });

      const enqueuedIds = enqueueService.enqueueCreation.mock.calls.map((c) => c[0].internalVariantId);
      expect(enqueuedIds).toContain('v-a');
      expect(enqueuedIds).toHaveLength(3);
    });

    it('keeps the FE-resolved productCardId for the selected variant but drops it for siblings', async () => {
      products.getVariant.mockResolvedValue(variant({ id: 'v-a', productId: 'P', ean: '111' }));
      products.getVariantsByProductId.mockResolvedValue([
        variant({ id: 'v-a', productId: 'P', ean: '111' }),
        variant({ id: 'v-b', productId: 'P', ean: '222' }),
      ]);
      inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'v-a', totalAvailable: 3, locationCount: 1 },
        { productVariantId: 'v-b', totalAvailable: 3, locationCount: 1 },
      ]);

      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['v-a'],
        sharedConfig: {
          stock: 7,
          publishImmediately: false,
          overrides: { categoryId: 'cat-1', productCardId: 'card-shared' },
        },
      });

      // Selected variant keeps the wizard-resolved card.
      expect(enqueueService.enqueueCreation.mock.calls[0][0].overrides).toEqual({
        categoryId: 'cat-1',
        productCardId: 'card-shared',
      });
      // Sibling self-links by its own barcode → no inherited card, other overrides survive.
      expect(enqueueService.enqueueCreation.mock.calls[1][0].overrides).toEqual({
        categoryId: 'cat-1',
      });
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
