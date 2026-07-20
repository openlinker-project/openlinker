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
import { InvalidEanException } from '../../../domain/exceptions/invalid-ean.exception';
import { DuplicateBatchEanException } from '../../../domain/exceptions/duplicate-batch-ean.exception';
import { CurrencyMismatchException } from '../../../domain/exceptions/currency-mismatch.exception';
import { InvalidOverrideKeyException } from '../../../domain/exceptions/invalid-override-key.exception';
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
      updateTotalCount: jest.fn().mockImplementation((id: string, totalCount: number) =>
        Promise.resolve(makeBatch({ id, totalCount }))
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
        productIds: ['ol_variant_a', 'ol_variant_b'],
        sharedConfig: {
          stock: 5,
          publishImmediately: false,
          price: { amount: 10, currency: 'PLN' },
        },
        perProductOverrides: {
          ol_variant_b: {
            stock: 99,
            price: { amount: 20, currency: 'PLN' },
          },
        },
      });

      expect(enqueueService.enqueueCreation.mock.calls[0][0]).toMatchObject({
        internalVariantId: 'ol_variant_a',
        stock: 5,
        price: { amount: 10, currency: 'PLN' },
      });
      expect(enqueueService.enqueueCreation.mock.calls[1][0]).toMatchObject({
        internalVariantId: 'ol_variant_b',
        stock: 99,
        price: { amount: 20, currency: 'PLN' },
      });
    });

    it('preserves shared platformParams when a per-product override has none, and deep-merges when it does (#808)', async () => {
      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['ol_variant_a', 'ol_variant_b'],
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
          ol_variant_a: { overrides: { categoryId: '257933', productCardId: 'card-a' } },
          // Row override with its own platformParams — deep-merged: per-product
          // key wins, shared sibling key survives.
          ol_variant_b: { overrides: { platformParams: { deliveryPolicyId: 'dp-b' } } },
        },
      });

      expect(enqueueService.enqueueCreation.mock.calls[0][0]).toMatchObject({
        internalVariantId: 'ol_variant_a',
        overrides: {
          categoryId: '257933',
          productCardId: 'card-a',
          platformParams: { deliveryPolicyId: 'dp-shared', handlingTime: 'PT24H' },
        },
      });
      expect(enqueueService.enqueueCreation.mock.calls[1][0]).toMatchObject({
        internalVariantId: 'ol_variant_b',
        overrides: {
          platformParams: { deliveryPolicyId: 'dp-b', handlingTime: 'PT24H' },
        },
      });
    });

    it('replaces overrides.parameters wholesale per-product, else inherits shared (#1071)', async () => {
      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['ol_variant_a', 'ol_variant_b'],
        sharedConfig: {
          stock: 5,
          publishImmediately: false,
          overrides: {
            parameters: [{ id: 'shared-1', values: ['S'], section: 'offer' }],
          },
        },
        perProductOverrides: {
          // No row params → inherit the shared parameters.
          ol_variant_a: { overrides: { categoryId: '257933' } },
          // Row params → REPLACE the shared set wholesale (a row supplies the
          // complete param set for its own category).
          ol_variant_b: { overrides: { parameters: [{ id: 'row-1', values: ['R'], section: 'product' }] } },
        },
      });

      expect(enqueueService.enqueueCreation.mock.calls[0][0]).toMatchObject({
        internalVariantId: 'ol_variant_a',
        overrides: { parameters: [{ id: 'shared-1', values: ['S'], section: 'offer' }] },
      });
      expect(enqueueService.enqueueCreation.mock.calls[1][0]).toMatchObject({
        internalVariantId: 'ol_variant_b',
        overrides: { parameters: [{ id: 'row-1', values: ['R'], section: 'product' }] },
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

    it('reconciles totalCount to the number enqueued + advances to running when an enqueue rejects mid-fan-out (#1741)', async () => {
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

      // Partial fan-out (1 of 3 enqueued): totalCount reconciled to 1 so the
      // #737 counter gate can terminate, then advanced to 'running' - never
      // 'failed' (that would strand the one enqueued child's counters).
      expect(bulkBatchRepo.updateTotalCount).toHaveBeenCalledWith('batch-1', 1);
      expect(bulkBatchRepo.updateStatus).toHaveBeenCalledWith('batch-1', 'running');
      expect(bulkBatchRepo.updateStatus).not.toHaveBeenCalledWith('batch-1', 'failed');
    });

    it('flips terminal failed when the very first enqueue rejects (nothing enqueued, #1741)', async () => {
      enqueueService.enqueueCreation.mockRejectedValueOnce(new Error('Redis down'));

      await expect(
        service.submit({
          connectionId,
          initiatedBy,
          productIds: ['v-a', 'v-b'],
          sharedConfig: { stock: 5, publishImmediately: false },
        })
      ).rejects.toThrow('Redis down');

      expect(bulkBatchRepo.updateStatus).toHaveBeenCalledWith('batch-1', 'failed');
      expect(bulkBatchRepo.updateTotalCount).not.toHaveBeenCalled();
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

  describe('per-variant configuration (#1741)', () => {
    // A multi-variant product P with three siblings; helper to wire the mocks.
    const wireMultiVariant = (
      siblings: Array<Partial<ProductVariant> & Pick<ProductVariant, 'id'>>,
      availability: Array<{ productVariantId: string; totalAvailable: number }>
    ): void => {
      const built = siblings.map((s) => variant({ productId: 'P', ...s }));
      products.getVariant.mockImplementation((id: string) =>
        Promise.resolve(built.find((v) => v.id === id) ?? built[0])
      );
      products.getVariantsByProductId.mockResolvedValue(built);
      inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue(
        availability.map((a) => ({ ...a, locationCount: 1 }))
      );
    };

    it('layers scalars 3-way: variant wins over family over base, and false is preserved', async () => {
      // Two passthrough (unknown → single-offer) variants so selectedId === variantId.
      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['ol_variant_a', 'ol_variant_b'],
        sharedConfig: { stock: 5, publishImmediately: true, price: { amount: 10, currency: 'PLN' } },
        perProductOverrides: {
          ol_variant_a: { publishImmediately: true, price: { amount: 20, currency: 'PLN' } },
          ol_variant_b: { publishImmediately: true, price: { amount: 20, currency: 'PLN' } },
        },
        perVariantOverrides: {
          // Variant layer wins: publish:false beats family/base true (false is
          // preserved, not treated as "absent"); price 30 beats 20/10.
          ol_variant_a: { publishImmediately: false, price: { amount: 30, currency: 'PLN' }, stock: 8 },
        },
      });

      expect(enqueueService.enqueueCreation.mock.calls[0][0]).toMatchObject({
        internalVariantId: 'ol_variant_a',
        publishImmediately: false,
        price: { amount: 30, currency: 'PLN' },
        stock: 8,
      });
      // b has no per-variant entry → family layer wins over base.
      expect(enqueueService.enqueueCreation.mock.calls[1][0]).toMatchObject({
        internalVariantId: 'ol_variant_b',
        publishImmediately: true,
        price: { amount: 20, currency: 'PLN' },
        stock: 5,
      });
    });

    it('excludes a sibling and totalCount reflects the post-exclusion fan-out', async () => {
      wireMultiVariant(
        [
          { id: 'ol_variant_a', ean: '111' },
          { id: 'ol_variant_b', ean: '222' },
          { id: 'ol_variant_c', ean: '333' },
        ],
        [
          { productVariantId: 'ol_variant_a', totalAvailable: 3 },
          { productVariantId: 'ol_variant_c', totalAvailable: 3 },
        ]
      );

      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['ol_variant_a'],
        sharedConfig: { stock: 7, publishImmediately: false },
        excludedVariantIds: ['ol_variant_b'],
      });

      expect(enqueueService.enqueueCreation.mock.calls.map((c) => c[0].internalVariantId)).toEqual([
        'ol_variant_a',
        'ol_variant_c',
      ]);
      expect(bulkBatchRepo.create).toHaveBeenCalledWith(expect.objectContaining({ totalCount: 2 }));
    });

    it('never resurrects an excluded seed/primary variant', async () => {
      wireMultiVariant(
        [
          { id: 'ol_variant_a', ean: '111' },
          { id: 'ol_variant_b', ean: '222' },
          { id: 'ol_variant_c', ean: '333' },
        ],
        [
          { productVariantId: 'ol_variant_b', totalAvailable: 1 },
          { productVariantId: 'ol_variant_c', totalAvailable: 1 },
        ]
      );

      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['ol_variant_a'],
        sharedConfig: { stock: 7, publishImmediately: false },
        excludedVariantIds: ['ol_variant_a'],
      });

      const ids = enqueueService.enqueueCreation.mock.calls.map((c) => c[0].internalVariantId);
      expect(ids).toEqual(['ol_variant_b', 'ol_variant_c']);
      expect(ids).not.toContain('ol_variant_a');
    });

    it('keeps a barcode-less sibling rescued by an override EAN', async () => {
      wireMultiVariant(
        [
          { id: 'ol_variant_a', ean: '111' },
          { id: 'ol_variant_b' }, // no ean/gtin
          { id: 'ol_variant_c', ean: '333' },
        ],
        [
          { productVariantId: 'ol_variant_a', totalAvailable: 2 },
          { productVariantId: 'ol_variant_b', totalAvailable: 2 },
          { productVariantId: 'ol_variant_c', totalAvailable: 2 },
        ]
      );

      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['ol_variant_a'],
        sharedConfig: { stock: 7, publishImmediately: false },
        perVariantOverrides: {
          ol_variant_b: { overrides: { ean: '5901234123457' } },
        },
      });

      const ids = enqueueService.enqueueCreation.mock.calls.map((c) => c[0].internalVariantId);
      expect(ids).toEqual(['ol_variant_a', 'ol_variant_b', 'ol_variant_c']);
    });

    it('keeps an explicit per-variant productCardId through clearProductCard', async () => {
      wireMultiVariant(
        [
          { id: 'ol_variant_a', ean: '111' },
          { id: 'ol_variant_b', ean: '222' },
        ],
        [
          { productVariantId: 'ol_variant_a', totalAvailable: 3 },
          { productVariantId: 'ol_variant_b', totalAvailable: 3 },
        ]
      );

      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['ol_variant_a'],
        sharedConfig: {
          stock: 7,
          publishImmediately: false,
          overrides: { categoryId: 'cat-1', productCardId: 'card-shared' },
        },
        perVariantOverrides: {
          // Operator picked a specific card for the sibling (multi-match pick) -
          // it must survive the clearProductCard strip.
          ol_variant_b: { overrides: { productCardId: 'card-b-explicit' } },
        },
      });

      // selected keeps shared card; sibling keeps its explicit card (not stripped).
      expect(enqueueService.enqueueCreation.mock.calls[0][0].overrides).toEqual({
        categoryId: 'cat-1',
        productCardId: 'card-shared',
      });
      expect(enqueueService.enqueueCreation.mock.calls[1][0].overrides).toEqual({
        categoryId: 'cat-1',
        productCardId: 'card-b-explicit',
      });
    });

    it('resolves a sibling absent from the availability map to 0 stock (no phantom stock)', async () => {
      wireMultiVariant(
        [
          { id: 'ol_variant_a', ean: '111' },
          { id: 'ol_variant_b', ean: '222' },
        ],
        // ol_variant_b entirely absent from the availability map.
        [{ productVariantId: 'ol_variant_a', totalAvailable: 9 }]
      );

      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['ol_variant_a'],
        sharedConfig: { stock: 7, publishImmediately: false },
      });

      expect(enqueueService.enqueueCreation.mock.calls[0][0]).toMatchObject({
        internalVariantId: 'ol_variant_a',
        stock: 9,
      });
      expect(enqueueService.enqueueCreation.mock.calls[1][0]).toMatchObject({
        internalVariantId: 'ol_variant_b',
        stock: 0,
      });
    });

    it('forces publishImmediately false for a 0-stock sibling (draft), true for in-stock (#1741)', async () => {
      wireMultiVariant(
        [
          { id: 'ol_variant_a', ean: '111' },
          { id: 'ol_variant_b', ean: '222' },
        ],
        [
          { productVariantId: 'ol_variant_a', totalAvailable: 4 },
          { productVariantId: 'ol_variant_b', totalAvailable: 0 },
        ]
      );

      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['ol_variant_a'],
        sharedConfig: { stock: 7, publishImmediately: true },
      });

      expect(enqueueService.enqueueCreation.mock.calls[0][0]).toMatchObject({
        internalVariantId: 'ol_variant_a',
        stock: 4,
        publishImmediately: true,
      });
      // 0-stock sibling cannot be activated → forced to draft.
      expect(enqueueService.enqueueCreation.mock.calls[1][0]).toMatchObject({
        internalVariantId: 'ol_variant_b',
        stock: 0,
        publishImmediately: false,
      });
    });

    it('throws EmptyBulkSubmissionException (no batch row) when every variant is excluded', async () => {
      wireMultiVariant(
        [
          { id: 'ol_variant_a', ean: '111' },
          { id: 'ol_variant_b', ean: '222' },
          { id: 'ol_variant_c', ean: '333' },
        ],
        []
      );

      await expect(
        service.submit({
          connectionId,
          initiatedBy,
          productIds: ['ol_variant_a'],
          sharedConfig: { stock: 7, publishImmediately: false },
          excludedVariantIds: ['ol_variant_a', 'ol_variant_b', 'ol_variant_c'],
        })
      ).rejects.toBeInstanceOf(EmptyBulkSubmissionException);

      expect(bulkBatchRepo.create).not.toHaveBeenCalled();
      expect(enqueueService.enqueueCreation).not.toHaveBeenCalled();
    });

    it('rejects an effective EAN with an invalid GS1 check digit', async () => {
      await expect(
        service.submit({
          connectionId,
          initiatedBy,
          productIds: ['ol_variant_a'],
          sharedConfig: { stock: 1, publishImmediately: false },
          // Passthrough variant (unknown) + a 13-digit override EAN with a bad
          // check digit (…457 is valid, …458 is not).
          perVariantOverrides: { ol_variant_a: { overrides: { ean: '5901234123458' } } },
        })
      ).rejects.toBeInstanceOf(InvalidEanException);

      expect(bulkBatchRepo.create).not.toHaveBeenCalled();
      expect(enqueueService.enqueueCreation).not.toHaveBeenCalled();
    });

    it('rejects two included variants that resolve to the same effective EAN', async () => {
      wireMultiVariant(
        [
          { id: 'ol_variant_a', ean: '5901234123457' },
          { id: 'ol_variant_b', ean: '5901234123457' }, // duplicate barcode
        ],
        [
          { productVariantId: 'ol_variant_a', totalAvailable: 1 },
          { productVariantId: 'ol_variant_b', totalAvailable: 1 },
        ]
      );

      await expect(
        service.submit({
          connectionId,
          initiatedBy,
          productIds: ['ol_variant_a'],
          sharedConfig: { stock: 1, publishImmediately: false },
        })
      ).rejects.toBeInstanceOf(DuplicateBatchEanException);

      expect(bulkBatchRepo.create).not.toHaveBeenCalled();
    });

    it('strips categoryId from a per-variant override', async () => {
      await service.submit({
        connectionId,
        initiatedBy,
        productIds: ['ol_variant_a'],
        sharedConfig: { stock: 1, publishImmediately: false },
        perVariantOverrides: {
          ol_variant_a: { overrides: { categoryId: 'cat-x', title: 'Variant title' } },
        },
      });

      const overrides = enqueueService.enqueueCreation.mock.calls[0][0].overrides;
      expect(overrides).toEqual({ title: 'Variant title' });
      expect(overrides).not.toHaveProperty('categoryId');
    });

    it('rejects a per-variant override whose price currency diverges from the batch currency', async () => {
      await expect(
        service.submit({
          connectionId,
          initiatedBy,
          productIds: ['ol_variant_a'],
          sharedConfig: { stock: 1, publishImmediately: false, price: { amount: 10, currency: 'PLN' } },
          perVariantOverrides: {
            ol_variant_a: { price: { amount: 5, currency: 'EUR' } },
          },
        })
      ).rejects.toBeInstanceOf(CurrencyMismatchException);

      expect(bulkBatchRepo.create).not.toHaveBeenCalled();
    });

    it('rejects an override-map key that is not a valid internal variant id', async () => {
      await expect(
        service.submit({
          connectionId,
          initiatedBy,
          productIds: ['ol_variant_a'],
          sharedConfig: { stock: 1, publishImmediately: false },
          perVariantOverrides: { 'not-a-variant': { stock: 1 } },
        })
      ).rejects.toBeInstanceOf(InvalidOverrideKeyException);

      expect(bulkBatchRepo.create).not.toHaveBeenCalled();
    });

    it('rejects a prototype-pollution (__proto__) own key in an override map', async () => {
      // JSON.parse creates an OWN "__proto__" property (unlike an object literal),
      // which Object.keys enumerates and the shape guard rejects.
      const polluted = JSON.parse('{"__proto__": {"stock": 1}}') as Record<
        string,
        { stock?: number }
      >;

      await expect(
        service.submit({
          connectionId,
          initiatedBy,
          productIds: ['ol_variant_a'],
          sharedConfig: { stock: 1, publishImmediately: false },
          perVariantOverrides: polluted,
        })
      ).rejects.toBeInstanceOf(InvalidOverrideKeyException);
    });

    it('rejects a malformed excludedVariantIds entry', async () => {
      await expect(
        service.submit({
          connectionId,
          initiatedBy,
          productIds: ['ol_variant_a'],
          sharedConfig: { stock: 1, publishImmediately: false },
          excludedVariantIds: ['bad-id'],
        })
      ).rejects.toBeInstanceOf(InvalidOverrideKeyException);

      expect(bulkBatchRepo.create).not.toHaveBeenCalled();
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
