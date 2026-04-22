/**
 * Listings Controller Unit Tests
 *
 * @module apps/api/src/listings/http
 */
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import type { SellerPolicies } from '@openlinker/core/integrations';
import { IdentifierMapping } from '@openlinker/core/identifier-mapping';
import {
  OFFER_CREATION_ENQUEUE_SERVICE_TOKEN,
  OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
  OFFER_MAPPING_REPOSITORY_TOKEN,
  OfferCreationRecord,
  SELLER_POLICIES_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import type {
  IOfferCreationEnqueueService,
  ISellerPoliciesService,
  OfferCreationRecordRepositoryPort,
  OfferMappingRepositoryPort,
} from '@openlinker/core/listings';
import { JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import type { JobEnqueuePort } from '@openlinker/core/sync';

import { ListingsController } from './listings.controller';

describe('ListingsController', () => {
  let controller: ListingsController;
  let repository: jest.Mocked<OfferMappingRepositoryPort>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let offerCreationRecords: jest.Mocked<OfferCreationRecordRepositoryPort>;
  let offerCreationEnqueue: jest.Mocked<IOfferCreationEnqueueService>;
  let sellerPolicies: jest.Mocked<ISellerPoliciesService>;

  const mockMapping = new IdentifierMapping(
    'uuid-1',
    'Offer',
    'ol_offer_variant123',
    'allegro-offer-456',
    'allegro',
    'conn-1',
    null,
    new Date('2026-01-01T00:00:00Z'),
    new Date('2026-01-01T00:00:00Z'),
  );

  const mockRecord = new OfferCreationRecord(
    'record-1',
    'ol_variant_abc123',
    'conn-1',
    null,
    'pending',
    null,
    false,
    new Date('2026-04-20T10:00:00Z'),
    new Date('2026-04-20T10:00:00Z'),
  );

  beforeEach(async () => {
    repository = {
      findById: jest.fn(),
      findMany: jest.fn(),
    };
    jobEnqueue = { enqueueJob: jest.fn() } as unknown as jest.Mocked<JobEnqueuePort>;
    offerCreationRecords = {
      create: jest.fn(),
      findById: jest.fn(),
      findLatestByVariantAndConnection: jest.fn(),
      findByExternalOfferIdAndConnectionId: jest.fn(),
      updateStatus: jest.fn(),
      updateExternalOfferId: jest.fn(),
      updateExternalIdAndStatus: jest.fn(),
    };
    offerCreationEnqueue = {
      enqueueCreation: jest.fn(),
    };
    sellerPolicies = {
      getSellerPolicies: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [
        { provide: OFFER_MAPPING_REPOSITORY_TOKEN, useValue: repository },
        { provide: JOB_ENQUEUE_TOKEN, useValue: jobEnqueue },
        { provide: OFFER_CREATION_RECORD_REPOSITORY_TOKEN, useValue: offerCreationRecords },
        { provide: OFFER_CREATION_ENQUEUE_SERVICE_TOKEN, useValue: offerCreationEnqueue },
        { provide: SELLER_POLICIES_SERVICE_TOKEN, useValue: sellerPolicies },
      ],
    }).compile();

    controller = module.get<ListingsController>(ListingsController);
  });

  describe('listOfferMappings', () => {
    it('should return paginated offer mappings with default pagination', async () => {
      repository.findMany.mockResolvedValue({ items: [mockMapping], total: 1 });

      const result = await controller.listOfferMappings({});

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(repository.findMany).toHaveBeenCalledWith(
        { connectionId: undefined, platformType: undefined, internalId: undefined, search: undefined },
        { limit: 20, offset: 0 },
      );
    });

    it('should pass filters to repository', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0 });

      await controller.listOfferMappings({
        connectionId: 'conn-1',
        platformType: 'allegro',
        internalId: 'ol_offer_variant123',
        search: '456',
        limit: 10,
        offset: 5,
      });

      expect(repository.findMany).toHaveBeenCalledWith(
        { connectionId: 'conn-1', platformType: 'allegro', internalId: 'ol_offer_variant123', search: '456' },
        { limit: 10, offset: 5 },
      );
    });

    it('should serialize dates as ISO 8601 strings', async () => {
      repository.findMany.mockResolvedValue({ items: [mockMapping], total: 1 });

      const result = await controller.listOfferMappings({});

      expect(result.items[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(result.items[0].updatedAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('getOfferMapping', () => {
    it('should return offer mapping when found', async () => {
      repository.findById.mockResolvedValue(mockMapping);
      offerCreationRecords.findByExternalOfferIdAndConnectionId.mockResolvedValue(null);

      const result = await controller.getOfferMapping('uuid-1');

      expect(result.id).toBe('uuid-1');
      expect(result.entityType).toBe('Offer');
      expect(result.externalId).toBe('allegro-offer-456');
      expect(result.platformType).toBe('allegro');
    });

    it('should throw NotFoundException when offer mapping not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(controller.getOfferMapping('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should embed offerCreation when an Offer mapping has a matching record', async () => {
      repository.findById.mockResolvedValue(mockMapping);
      const linkedRecord = new OfferCreationRecord(
        'record-42',
        'ol_variant_abc123',
        'conn-1',
        'allegro-offer-456',
        'active',
        null,
        true,
        new Date('2026-04-20T10:00:00Z'),
        new Date('2026-04-20T11:00:00Z'),
      );
      offerCreationRecords.findByExternalOfferIdAndConnectionId.mockResolvedValue(linkedRecord);

      const result = await controller.getOfferMapping('uuid-1');

      expect(offerCreationRecords.findByExternalOfferIdAndConnectionId).toHaveBeenCalledWith(
        'allegro-offer-456',
        'conn-1',
      );
      expect(result.offerCreation).toEqual({
        id: 'record-42',
        internalVariantId: 'ol_variant_abc123',
        connectionId: 'conn-1',
        externalOfferId: 'allegro-offer-456',
        status: 'active',
        errors: null,
        publishImmediately: true,
        createdAt: '2026-04-20T10:00:00.000Z',
        updatedAt: '2026-04-20T11:00:00.000Z',
      });
    });

    it('should omit offerCreation when an Offer mapping has no matching record (synced-in)', async () => {
      repository.findById.mockResolvedValue(mockMapping);
      offerCreationRecords.findByExternalOfferIdAndConnectionId.mockResolvedValue(null);

      const result = await controller.getOfferMapping('uuid-1');

      expect(offerCreationRecords.findByExternalOfferIdAndConnectionId).toHaveBeenCalledTimes(1);
      expect(result.offerCreation).toBeUndefined();
    });

    it('should skip the creation-record lookup entirely for non-Offer entity types', async () => {
      const productMapping = new IdentifierMapping(
        'uuid-2',
        'Product',
        'ol_product_abc',
        'prestashop-product-7',
        'prestashop',
        'conn-2',
        null,
        new Date('2026-01-01T00:00:00Z'),
        new Date('2026-01-01T00:00:00Z'),
      );
      repository.findById.mockResolvedValue(productMapping);

      const result = await controller.getOfferMapping('uuid-2');

      expect(offerCreationRecords.findByExternalOfferIdAndConnectionId).not.toHaveBeenCalled();
      expect(result.offerCreation).toBeUndefined();
      expect(result.entityType).toBe('Product');
    });
  });

  describe('createOffer', () => {
    const validDto = {
      internalVariantId: 'ol_variant_abc123',
      stock: 5,
      publishImmediately: false,
      price: { amount: 99.99, currency: 'PLN' },
    };

    it('delegates to the enqueue service and flattens the result', async () => {
      offerCreationEnqueue.enqueueCreation.mockResolvedValue({
        jobId: 'job-1',
        offerCreationRecord: mockRecord,
      });

      const result = await controller.createOffer('conn-1', validDto);

      expect(result).toEqual({ jobId: 'job-1', offerCreationRecordId: 'record-1' });
      expect(offerCreationEnqueue.enqueueCreation).toHaveBeenCalledWith({
        internalVariantId: 'ol_variant_abc123',
        connectionId: 'conn-1',
        stock: 5,
        publishImmediately: false,
        price: { amount: 99.99, currency: 'PLN' },
        overrides: undefined,
        idempotencyKey: undefined,
      });
    });

    it('forwards x-idempotency-key header to the service', async () => {
      offerCreationEnqueue.enqueueCreation.mockResolvedValue({
        jobId: 'job-1',
        offerCreationRecord: mockRecord,
      });

      await controller.createOffer('conn-1', validDto, 'client-key-42');

      expect(offerCreationEnqueue.enqueueCreation).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'client-key-42' }),
      );
    });

    it('propagates UnprocessableEntityException from the service (adapter lacks createOffer)', async () => {
      offerCreationEnqueue.enqueueCreation.mockRejectedValue(
        new UnprocessableEntityException('adapter does not support offer creation'),
      );

      await expect(controller.createOffer('conn-1', validDto)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('propagates connection-level exceptions from the service unchanged', async () => {
      offerCreationEnqueue.enqueueCreation.mockRejectedValue(
        new Error('ConnectionDisabledException'),
      );

      await expect(controller.createOffer('conn-1', validDto)).rejects.toThrow(
        'ConnectionDisabledException',
      );
    });
  });

  describe('getOfferCreationStatus', () => {
    it('returns the record on happy path with ISO timestamps', async () => {
      offerCreationRecords.findById.mockResolvedValue(mockRecord);

      const result = await controller.getOfferCreationStatus('conn-1', 'record-1');

      expect(result).toEqual({
        id: 'record-1',
        internalVariantId: 'ol_variant_abc123',
        connectionId: 'conn-1',
        externalOfferId: null,
        status: 'pending',
        errors: null,
        publishImmediately: false,
        createdAt: '2026-04-20T10:00:00.000Z',
        updatedAt: '2026-04-20T10:00:00.000Z',
      });
    });

    it('throws NotFoundException when record does not exist', async () => {
      offerCreationRecords.findById.mockResolvedValue(null);

      await expect(controller.getOfferCreationStatus('conn-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when record belongs to a different connection', async () => {
      offerCreationRecords.findById.mockResolvedValue(mockRecord);

      await expect(controller.getOfferCreationStatus('conn-other', 'record-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getSellerPolicies', () => {
    it('delegates to the seller-policies service and returns its result', async () => {
      const policies: SellerPolicies = {
        deliveryPolicies: [{ id: 'd1', name: 'Standard' }],
        returnPolicies: [{ id: 'r1', name: '14-day' }],
        warranties: [],
        impliedWarranties: [{ id: 'iw1', name: 'Consumer rights' }],
      };
      sellerPolicies.getSellerPolicies.mockResolvedValue(policies);

      const result = await controller.getSellerPolicies('conn-1');

      expect(result).toEqual(policies);
      expect(sellerPolicies.getSellerPolicies).toHaveBeenCalledWith('conn-1');
    });
  });
});
