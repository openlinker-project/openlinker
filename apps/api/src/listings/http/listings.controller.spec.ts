/**
 * Listings Controller Unit Tests
 *
 * @module apps/api/src/listings/http
 */
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import type { CategoryParameter, OfferManagerPort, SellerPolicies } from '@openlinker/core/listings';
import { CategoryNotFoundException } from '@openlinker/core/listings';
import { IdentifierMapping } from '@openlinker/core/identifier-mapping';
import { OFFER_CREATION_ENQUEUE_SERVICE_TOKEN, OFFER_CREATION_RECORD_REPOSITORY_TOKEN, OFFER_MAPPING_REPOSITORY_TOKEN, OfferCreationRecord, SELLER_POLICIES_SERVICE_TOKEN } from '@openlinker/core/listings';
import type { IOfferCreationEnqueueService, ISellerPoliciesService, OfferCreationRecordRepositoryPort, OfferMappingRepositoryPort } from '@openlinker/core/listings';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { IIntegrationsService } from '@openlinker/core/integrations';
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
  let integrationsService: jest.Mocked<IIntegrationsService>;

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
      countByConnectionAndVariants: jest.fn().mockResolvedValue(new Map<string, number>()),
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
    integrationsService = {
      getCapabilityAdapter: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [
        { provide: OFFER_MAPPING_REPOSITORY_TOKEN, useValue: repository },
        { provide: JOB_ENQUEUE_TOKEN, useValue: jobEnqueue },
        { provide: OFFER_CREATION_RECORD_REPOSITORY_TOKEN, useValue: offerCreationRecords },
        { provide: OFFER_CREATION_ENQUEUE_SERVICE_TOKEN, useValue: offerCreationEnqueue },
        { provide: SELLER_POLICIES_SERVICE_TOKEN, useValue: sellerPolicies },
        { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: integrationsService },
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
        request: null,
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

  describe('getMarketplaceOffer (#464)', () => {
    const liveOffer = {
      externalId: 'allegro-offer-456',
      title: 'Vintage Camera Lens',
      description: 'Mint condition, original case included.',
      imageUrl: 'https://a.allegroimg.com/original/abc/lens.jpg',
      price: { amount: '249.00', currency: 'PLN' },
      availableQuantity: 3,
      status: 'ACTIVE',
      category: { id: '12345', name: 'Lenses' },
      marketplaceUrl: 'https://allegro.pl/oferta/allegro-offer-456',
      updatedAt: '2026-04-30T10:00:00Z',
    };

    function makeOfferReaderAdapter(getOffer: jest.Mock): OfferManagerPort {
      return {
        updateOfferQuantity: jest.fn(),
        getOffer,
      } as unknown as OfferManagerPort;
    }

    it('should return MarketplaceOfferResponseDto on happy path', async () => {
      repository.findById.mockResolvedValue(mockMapping);
      const getOffer = jest.fn().mockResolvedValue(liveOffer);
      integrationsService.getCapabilityAdapter.mockResolvedValue(makeOfferReaderAdapter(getOffer));

      const result = await controller.getMarketplaceOffer('uuid-1');

      expect(repository.findById).toHaveBeenCalledWith('uuid-1');
      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith('conn-1', 'OfferManager');
      expect(getOffer).toHaveBeenCalledWith({ externalId: 'allegro-offer-456' });
      expect(result).toEqual({
        externalId: 'allegro-offer-456',
        title: 'Vintage Camera Lens',
        description: 'Mint condition, original case included.',
        imageUrl: 'https://a.allegroimg.com/original/abc/lens.jpg',
        price: { amount: '249.00', currency: 'PLN' },
        availableQuantity: 3,
        status: 'ACTIVE',
        category: { id: '12345', name: 'Lenses' },
        marketplaceUrl: 'https://allegro.pl/oferta/allegro-offer-456',
        updatedAt: '2026-04-30T10:00:00Z',
      });
    });

    it('should throw NotFoundException when mapping does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(controller.getMarketplaceOffer('uuid-missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when mapping entityType is not Offer', async () => {
      const productMapping = new IdentifierMapping(
        'uuid-2',
        'Product',
        'ol_product_1',
        'ext-product-1',
        'allegro',
        'conn-1',
        null,
        new Date(),
        new Date(),
      );
      repository.findById.mockResolvedValue(productMapping);

      await expect(controller.getMarketplaceOffer('uuid-2')).rejects.toThrow(NotFoundException);
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('should throw UnprocessableEntityException when adapter does not implement OfferReader', async () => {
      repository.findById.mockResolvedValue(mockMapping);
      // Adapter without `getOffer` method.
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
      } as unknown as OfferManagerPort);

      await expect(controller.getMarketplaceOffer('uuid-1')).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('should propagate adapter errors verbatim', async () => {
      repository.findById.mockResolvedValue(mockMapping);
      const upstream = new Error('Allegro 502');
      const getOffer = jest.fn().mockRejectedValue(upstream);
      integrationsService.getCapabilityAdapter.mockResolvedValue(makeOfferReaderAdapter(getOffer));

      await expect(controller.getMarketplaceOffer('uuid-1')).rejects.toThrow('Allegro 502');
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
        request: null,
      });
    });

    it('surfaces the request snapshot when the record carries one', async () => {
      const request = {
        schemaVersion: 1 as const,
        internalVariantId: 'ol_variant_abc123',
        stock: 3,
        publishImmediately: true,
        price: { amount: 19.99, currency: 'PLN' },
        overrides: {
          title: 'Retry pre-fill title',
          categoryId: 'allegro-cat-1',
          platformParams: { deliveryPolicyId: 'del-1' },
        },
      };
      const recordWithRequest = new OfferCreationRecord(
        'record-2',
        'ol_variant_abc123',
        'conn-1',
        null,
        'failed',
        [{ code: 'VALIDATION', message: 'Invalid category' }],
        true,
        new Date('2026-04-22T10:00:00Z'),
        new Date('2026-04-22T10:00:01Z'),
        request,
      );
      offerCreationRecords.findById.mockResolvedValue(recordWithRequest);

      const result = await controller.getOfferCreationStatus('conn-1', 'record-2');

      expect(result.request).toEqual(request);
      expect(result.request?.schemaVersion).toBe(1);
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

  describe('getCategoryParameters', () => {
    const sampleNeutral: CategoryParameter[] = [
      {
        id: '11323',
        name: 'Stan',
        type: 'dictionary',
        required: true,
        dictionary: [{ id: '11323_1', value: 'Nowy' }],
        restrictions: { multipleChoices: false },
        section: 'offer',
      },
      {
        id: '229205',
        name: 'Stan opakowania',
        type: 'dictionary',
        required: false,
        dictionary: [
          {
            id: '229205_340245',
            value: 'oryginalne',
            dependsOnValueIds: ['11323_1'],
          },
        ],
        restrictions: { multipleChoices: false },
        dependsOn: { parameterId: '11323', valueIds: ['11323_1'] },
        section: 'offer',
      },
    ];

    function makeAdapter(
      withCategoryParametersReader: boolean,
      fetch: jest.Mock = jest.fn().mockResolvedValue(sampleNeutral),
    ): OfferManagerPort {
      // Adapter is a plain object — only the `fetchCategoryParameters` method
      // matters for the type-guard narrowing.
      const base = { updateOfferQuantity: jest.fn() } as unknown as OfferManagerPort;
      if (withCategoryParametersReader) {
        return Object.assign(base, { fetchCategoryParameters: fetch });
      }
      return base;
    }

    it('returns parameters wrapped under `parameters`, mapping the neutral shape verbatim', async () => {
      const fetch = jest.fn().mockResolvedValue(sampleNeutral);
      integrationsService.getCapabilityAdapter.mockResolvedValue(makeAdapter(true, fetch));

      const result = await controller.getCategoryParameters('conn-1', '257933');

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith('conn-1', 'OfferManager');
      expect(fetch).toHaveBeenCalledWith({ categoryId: '257933' });
      expect(result.parameters).toHaveLength(2);
      expect(result.parameters[0]).toMatchObject({
        id: '11323',
        type: 'dictionary',
        required: true,
        dictionary: [{ id: '11323_1', value: 'Nowy' }],
      });
      expect(result.parameters[1].dependsOn).toEqual({
        parameterId: '11323',
        valueIds: ['11323_1'],
      });
      expect(result.parameters[1].dictionary?.[0].dependsOnValueIds).toEqual(['11323_1']);
    });

    it('round-trips the section field from neutral metadata onto the response (#415)', async () => {
      const fetch = jest.fn().mockResolvedValue([
        {
          ...sampleNeutral[0],
          id: '248811',
          name: 'Marka',
          section: 'product' as const,
        },
        sampleNeutral[1], // section: 'offer'
      ]);
      integrationsService.getCapabilityAdapter.mockResolvedValue(makeAdapter(true, fetch));

      const result = await controller.getCategoryParameters('conn-1', '257932');

      expect(result.parameters[0].section).toBe('product');
      expect(result.parameters[1].section).toBe('offer');
    });

    it('throws 422 when the adapter does not implement CategoryParametersReader', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue(makeAdapter(false));

      await expect(controller.getCategoryParameters('conn-1', '257933')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('translates CategoryNotFoundException to a 404 NotFoundException', async () => {
      const fetch = jest
        .fn()
        .mockRejectedValue(new CategoryNotFoundException('999999', 'allegro'));
      integrationsService.getCapabilityAdapter.mockResolvedValue(makeAdapter(true, fetch));

      await expect(controller.getCategoryParameters('conn-1', '999999')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('propagates upstream errors that are not CategoryNotFoundException', async () => {
      const fetch = jest.fn().mockRejectedValue(new Error('upstream-503'));
      integrationsService.getCapabilityAdapter.mockResolvedValue(makeAdapter(true, fetch));

      await expect(controller.getCategoryParameters('conn-1', '257933')).rejects.toThrow(
        'upstream-503',
      );
    });
  });
});
