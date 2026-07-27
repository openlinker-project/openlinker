/**
 * Offer Creation Enqueue Service Tests
 *
 * Covers the pre-enqueue orchestration: adapter capability check, record
 * creation, payload construction, idempotency-key handling, and
 * exception propagation for all connection-failure modes.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */

import { UnprocessableEntityException } from '@nestjs/common';

import type { OfferManagerPort } from '@openlinker/core/listings';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { JobEnqueuePort } from '@openlinker/core/sync';

import { OfferCreationRecord } from '../../../domain/entities/offer-creation-record.entity';
import type { OfferCreationRecordRepositoryPort } from '../../../domain/ports/offer-creation-record-repository.port';
import { OfferCreationEnqueueService } from '../offer-creation-enqueue.service';

describe('OfferCreationEnqueueService', () => {
  let service: OfferCreationEnqueueService;
  let integrations: jest.Mocked<IIntegrationsService>;
  let records: jest.Mocked<OfferCreationRecordRepositoryPort>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;

  const connectionId = 'conn-xyz';
  const variantId = 'ol_variant_abc';

  const mockRecord = new OfferCreationRecord(
    'record-1',
    variantId,
    connectionId,
    null,
    'pending',
    null,
    false,
    new Date('2026-04-21T10:00:00Z'),
    new Date('2026-04-21T10:00:00Z')
  );

  const adapterWith = (createOffer: jest.Mock | undefined): OfferManagerPort =>
    ({
      ...(createOffer ? { createOffer } : {}),
    }) as unknown as OfferManagerPort;

  beforeEach(() => {
    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    records = {
      create: jest.fn().mockResolvedValue(mockRecord),
      findById: jest.fn(),
      findLatestByVariantAndConnection: jest.fn(),
      findByExternalOfferIdAndConnectionId: jest.fn(),
      updateStatus: jest.fn(),
      updateExternalOfferId: jest.fn(),
      updateExternalIdAndStatus: jest.fn(),
      findByBulkBatchId: jest.fn(),
      updateClassificationReport: jest.fn(),
      resetForRetry: jest.fn(),
      deleteById: jest.fn(),
    };

    jobEnqueue = {
      enqueueJob: jest.fn().mockResolvedValue({ jobId: 'job-1', isExisting: false }),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    service = new OfferCreationEnqueueService(integrations, records, jobEnqueue);
  });

  it('happy path: creates a record then enqueues a job with offerCreationRecordId', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(jest.fn()));

    const result = await service.enqueueCreation({
      internalVariantId: variantId,
      connectionId,
      stock: 5,
      publishImmediately: false,
      price: { amount: 99.99, currency: 'PLN' },
    });

    expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(connectionId, 'OfferManager');
    expect(records.create).toHaveBeenCalledWith({
      internalVariantId: variantId,
      connectionId,
      externalOfferId: null,
      status: 'pending',
      errors: null,
      publishImmediately: false,
      request: {
        schemaVersion: 1,
        internalVariantId: variantId,
        stock: 5,
        publishImmediately: false,
        price: { amount: 99.99, currency: 'PLN' },
      },
    });
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith({
      jobType: 'marketplace.offer.create',
      connectionId,
      idempotencyKey: 'offer-create:record-1',
      payload: expect.objectContaining({
        schemaVersion: 1,
        internalVariantId: variantId,
        stock: 5,
        publishImmediately: false,
        offerCreationRecordId: 'record-1',
        price: { amount: 99.99, currency: 'PLN' },
      }),
    });
    expect(result).toEqual({ jobId: 'job-1', offerCreationRecord: mockRecord });
  });

  it('uses the caller-supplied idempotency key when provided', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(jest.fn()));

    await service.enqueueCreation({
      internalVariantId: variantId,
      connectionId,
      stock: 1,
      publishImmediately: true,
      idempotencyKey: 'client-key-42',
    });

    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'client-key-42' })
    );
  });

  it('throws UnprocessableEntityException without touching repo or queue when adapter lacks createOffer', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(undefined));

    await expect(
      service.enqueueCreation({
        internalVariantId: variantId,
        connectionId,
        stock: 1,
        publishImmediately: false,
      })
    ).rejects.toThrow(UnprocessableEntityException);

    expect(records.create).not.toHaveBeenCalled();
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('propagates exceptions from getCapabilityAdapter (e.g. ConnectionDisabledException)', async () => {
    integrations.getCapabilityAdapter.mockRejectedValue(new Error('ConnectionDisabledException'));

    await expect(
      service.enqueueCreation({
        internalVariantId: variantId,
        connectionId,
        stock: 1,
        publishImmediately: false,
      })
    ).rejects.toThrow('ConnectionDisabledException');

    expect(records.create).not.toHaveBeenCalled();
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('omits price/overrides from the payload when not supplied', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(jest.fn()));

    await service.enqueueCreation({
      internalVariantId: variantId,
      connectionId,
      stock: 1,
      publishImmediately: false,
    });

    const payload = jobEnqueue.enqueueJob.mock.calls[0][0].payload;
    expect(payload).not.toHaveProperty('price');
    expect(payload).not.toHaveProperty('overrides');
  });

  it('forwards overrides unchanged when supplied', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(jest.fn()));
    const overrides = {
      title: 'Custom title',
      platformParams: { deliveryPolicyId: 'd-1' },
    };

    await service.enqueueCreation({
      internalVariantId: variantId,
      connectionId,
      stock: 1,
      publishImmediately: false,
      overrides,
    });

    const payload = jobEnqueue.enqueueJob.mock.calls[0][0].payload;
    expect(payload.overrides).toEqual(overrides);
  });

  it('persists the full request snapshot including overrides and schemaVersion', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(jest.fn()));
    const overrides = {
      title: 'Shipped title',
      categoryId: 'allegro-cat-1',
      description: 'desc',
      platformParams: { deliveryPolicyId: 'del-1', warrantyId: 'war-1' },
    };

    await service.enqueueCreation({
      internalVariantId: variantId,
      connectionId,
      stock: 7,
      publishImmediately: true,
      price: { amount: 49.5, currency: 'PLN' },
      overrides,
    });

    const createdWith = records.create.mock.calls[0][0];
    expect(createdWith.request).toEqual({
      schemaVersion: 1,
      internalVariantId: variantId,
      stock: 7,
      publishImmediately: true,
      price: { amount: 49.5, currency: 'PLN' },
      overrides,
    });
  });

  it('omits price and overrides from the request snapshot when the caller does not supply them', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(jest.fn()));

    await service.enqueueCreation({
      internalVariantId: variantId,
      connectionId,
      stock: 1,
      publishImmediately: false,
    });

    const createdWith = records.create.mock.calls[0][0];
    expect(createdWith.request).toEqual({
      schemaVersion: 1,
      internalVariantId: variantId,
      stock: 1,
      publishImmediately: false,
    });
    expect(createdWith.request).not.toHaveProperty('price');
    expect(createdWith.request).not.toHaveProperty('overrides');
  });

  describe('bulk path (#736)', () => {
    it('emits a V2 payload with bulkBatchId and stamps the bulk idempotency key', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(jest.fn()));

      await service.enqueueCreation({
        internalVariantId: variantId,
        connectionId,
        stock: 3,
        publishImmediately: false,
        bulkBatchId: 'batch-1',
        generateDescription: true,
        descriptionTone: 'concise',
      });

      // bulkBatchId is forwarded to the persisted record so the GET
      // endpoint's findByBulkBatchId read finds the row.
      expect(records.create).toHaveBeenCalledWith(
        expect.objectContaining({ bulkBatchId: 'batch-1' })
      );

      const enqueuedWith = jobEnqueue.enqueueJob.mock.calls[0][0];
      expect(enqueuedWith).toEqual({
        jobType: 'marketplace.offer.create',
        connectionId,
        idempotencyKey: `bulk:batch-1:variant:${variantId}`,
        payload: expect.objectContaining({
          schemaVersion: 2,
          bulkBatchId: 'batch-1',
          generateDescription: true,
          descriptionTone: 'concise',
          offerCreationRecordId: 'record-1',
        }),
      });
    });

    it('defaults generateDescription to false and omits descriptionTone when unset', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(jest.fn()));

      await service.enqueueCreation({
        internalVariantId: variantId,
        connectionId,
        stock: 3,
        publishImmediately: false,
        bulkBatchId: 'batch-1',
      });

      const payload = jobEnqueue.enqueueJob.mock.calls[0][0].payload;
      expect(payload.generateDescription).toBe(false);
      expect(payload).not.toHaveProperty('descriptionTone');
    });
  });
});
