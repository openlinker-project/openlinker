/**
 * Listings Controller Unit Tests
 *
 * @module apps/api/src/listings/http
 */
import 'reflect-metadata';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { ROLES_KEY } from '../../auth/decorators/roles.decorator';

import type {
  CatalogProduct,
  CatalogProductMatchResult,
  CategoryParameter,
  EanMatchResult,
  OfferManagerPort,
  SellerPolicies,
} from '@openlinker/core/listings';
import {
  AdapterCapabilityNotSupportedException,
  CatalogProductNotFoundException,
  CategoryNotFoundException,
  OfferNotFoundOnMarketplaceException,
} from '@openlinker/core/listings';
import {
  ConnectionNotFoundException,
  IdentifierMapping,
} from '@openlinker/core/identifier-mapping';
import {
  CATEGORY_RESOLUTION_SERVICE_TOKEN,
  OFFER_CREATION_ENQUEUE_SERVICE_TOKEN,
  OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
  OFFER_MAPPING_REPOSITORY_TOKEN,
  OFFER_STATUS_READ_SERVICE_TOKEN,
  OFFER_STATUS_SYNC_SERVICE_TOKEN,
  OfferCreationRecord,
  SELLER_POLICIES_SERVICE_TOKEN,
  RESPONSIBLE_PRODUCER_SERVICE_TOKEN,
  DELIVERY_PRICE_LIST_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import type {
  ICategoryResolutionService,
  IOfferCreationEnqueueService,
  IOfferStatusReadService,
  IOfferStatusSyncService,
  ISellerPoliciesService,
  IResponsibleProducerService,
  IDeliveryPriceListService,
  OfferCreationRecordRepositoryPort,
  OfferMappingRepositoryPort,
  OfferStatusSnapshot,
} from '@openlinker/core/listings';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { PRODUCT_VARIANT_REPOSITORY_TOKEN } from '@openlinker/core/products';
import type { ProductVariant, ProductVariantRepositoryPort } from '@openlinker/core/products';
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
  let responsibleProducers: jest.Mocked<IResponsibleProducerService>;
  let deliveryPriceLists: jest.Mocked<IDeliveryPriceListService>;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let productVariantRepository: jest.Mocked<ProductVariantRepositoryPort>;
  let categoryResolution: jest.Mocked<ICategoryResolutionService>;
  let offerStatusRead: jest.Mocked<IOfferStatusReadService>;
  let offerStatusSync: jest.Mocked<Pick<IOfferStatusSyncService, 'refreshOne'>>;

  const mockMapping = new IdentifierMapping(
    'uuid-1',
    'Offer',
    'ol_offer_variant123',
    'allegro-offer-456',
    'allegro',
    'conn-1',
    null,
    new Date('2026-01-01T00:00:00Z'),
    new Date('2026-01-01T00:00:00Z')
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
    new Date('2026-04-20T10:00:00Z')
  );

  beforeEach(async () => {
    repository = {
      findById: jest.fn(),
      findMany: jest.fn(),
      countByConnectionAndVariants: jest.fn().mockResolvedValue(new Map<string, number>()),
      countListedVariantsByProducts: jest.fn().mockResolvedValue([]),
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
      findByBulkBatchId: jest.fn(),
      updateClassificationReport: jest.fn(),
      resetForRetry: jest.fn(),
    };
    offerCreationEnqueue = {
      enqueueCreation: jest.fn(),
    };
    deliveryPriceLists = {
      listDeliveryPriceLists: jest.fn(),
    };

    sellerPolicies = {
      getSellerPolicies: jest.fn(),
    };
    responsibleProducers = {
      listResponsibleProducers: jest.fn(),
    };
    integrationsService = {
      getCapabilityAdapter: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;
    productVariantRepository = {
      findById: jest.fn().mockResolvedValue(null),
      findByProductId: jest.fn(),
      countByProductIds: jest.fn().mockResolvedValue(new Map<string, number>()),
      findBySku: jest.fn(),
      findBySkuIn: jest.fn(),
      findByEanOrGtinIn: jest.fn(),
      upsert: jest.fn(),
      upsertMany: jest.fn(),
      findMany: jest.fn(),
      markStaleExceptVariants: jest.fn(),
    };
    categoryResolution = {
      resolveCategory: jest.fn(),
      resolveCategoriesBatch: jest.fn(),
    };
    offerStatusRead = {
      getPublicationStatusForProduct: jest.fn(),
    };
    offerStatusSync = {
      refreshOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [
        { provide: OFFER_MAPPING_REPOSITORY_TOKEN, useValue: repository },
        { provide: JOB_ENQUEUE_TOKEN, useValue: jobEnqueue },
        { provide: OFFER_CREATION_RECORD_REPOSITORY_TOKEN, useValue: offerCreationRecords },
        { provide: OFFER_CREATION_ENQUEUE_SERVICE_TOKEN, useValue: offerCreationEnqueue },
        { provide: SELLER_POLICIES_SERVICE_TOKEN, useValue: sellerPolicies },
        { provide: RESPONSIBLE_PRODUCER_SERVICE_TOKEN, useValue: responsibleProducers },
        { provide: DELIVERY_PRICE_LIST_SERVICE_TOKEN, useValue: deliveryPriceLists },
        { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: integrationsService },
        { provide: PRODUCT_VARIANT_REPOSITORY_TOKEN, useValue: productVariantRepository },
        { provide: CATEGORY_RESOLUTION_SERVICE_TOKEN, useValue: categoryResolution },
        { provide: OFFER_STATUS_READ_SERVICE_TOKEN, useValue: offerStatusRead },
        { provide: OFFER_STATUS_SYNC_SERVICE_TOKEN, useValue: offerStatusSync },
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
        {
          connectionId: undefined,
          platformType: undefined,
          internalId: undefined,
          search: undefined,
        },
        { limit: 20, offset: 0 }
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
        {
          connectionId: 'conn-1',
          platformType: 'allegro',
          internalId: 'ol_offer_variant123',
          search: '456',
        },
        { limit: 10, offset: 5 }
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
        new Date('2026-04-20T11:00:00Z')
      );
      offerCreationRecords.findByExternalOfferIdAndConnectionId.mockResolvedValue(linkedRecord);

      const result = await controller.getOfferMapping('uuid-1');

      expect(offerCreationRecords.findByExternalOfferIdAndConnectionId).toHaveBeenCalledWith(
        'allegro-offer-456',
        'conn-1'
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
        new Date('2026-01-01T00:00:00Z')
      );
      repository.findById.mockResolvedValue(productMapping);

      const result = await controller.getOfferMapping('uuid-2');

      expect(offerCreationRecords.findByExternalOfferIdAndConnectionId).not.toHaveBeenCalled();
      expect(productVariantRepository.findById).not.toHaveBeenCalled();
      expect(result.offerCreation).toBeUndefined();
      expect(result.linkedProductId).toBeUndefined();
      expect(result.entityType).toBe('Product');
    });

    it('should embed linkedProductId when the linked variant exists (#485)', async () => {
      repository.findById.mockResolvedValue(mockMapping);
      offerCreationRecords.findByExternalOfferIdAndConnectionId.mockResolvedValue(null);
      const linkedVariant: ProductVariant = {
        id: 'ol_offer_variant123',
        productId: 'ol_product_xyz789',
        sku: 'SKU-1',
        attributes: null,
        ean: null,
        gtin: null,
      };
      productVariantRepository.findById.mockResolvedValue(linkedVariant);

      const result = await controller.getOfferMapping('uuid-1');

      expect(productVariantRepository.findById).toHaveBeenCalledWith('ol_offer_variant123');
      expect(result.linkedProductId).toBe('ol_product_xyz789');
    });

    it('should omit linkedProductId when the linked variant cannot be resolved (#485)', async () => {
      repository.findById.mockResolvedValue(mockMapping);
      offerCreationRecords.findByExternalOfferIdAndConnectionId.mockResolvedValue(null);
      productVariantRepository.findById.mockResolvedValue(null);

      const result = await controller.getOfferMapping('uuid-1');

      expect(productVariantRepository.findById).toHaveBeenCalledWith('ol_offer_variant123');
      expect(result.linkedProductId).toBeUndefined();
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
      endsAt: '2026-04-30T10:00:00Z',
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
      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        'conn-1',
        'OfferManager'
      );
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
        endsAt: '2026-04-30T10:00:00Z',
      });
    });

    it('should throw NotFoundException when mapping does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(controller.getMarketplaceOffer('uuid-missing')).rejects.toThrow(
        NotFoundException
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
        new Date()
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
        UnprocessableEntityException
      );
    });

    it('should propagate adapter errors verbatim', async () => {
      repository.findById.mockResolvedValue(mockMapping);
      const upstream = new Error('Allegro 502');
      const getOffer = jest.fn().mockRejectedValue(upstream);
      integrationsService.getCapabilityAdapter.mockResolvedValue(makeOfferReaderAdapter(getOffer));

      await expect(controller.getMarketplaceOffer('uuid-1')).rejects.toThrow('Allegro 502');
    });

    it('should map OfferNotFoundOnMarketplaceException to a soft 404 (live data unavailable)', async () => {
      repository.findById.mockResolvedValue(mockMapping);
      const getOffer = jest
        .fn()
        .mockRejectedValue(new OfferNotFoundOnMarketplaceException('allegro-offer-456', 'conn-1'));
      integrationsService.getCapabilityAdapter.mockResolvedValue(makeOfferReaderAdapter(getOffer));

      await expect(controller.getMarketplaceOffer('uuid-1')).rejects.toThrow(NotFoundException);
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
        expect.objectContaining({ idempotencyKey: 'client-key-42' })
      );
    });

    it('propagates UnprocessableEntityException from the service (adapter lacks createOffer)', async () => {
      offerCreationEnqueue.enqueueCreation.mockRejectedValue(
        new UnprocessableEntityException('adapter does not support offer creation')
      );

      await expect(controller.createOffer('conn-1', validDto)).rejects.toThrow(
        UnprocessableEntityException
      );
    });

    it('propagates connection-level exceptions from the service unchanged', async () => {
      offerCreationEnqueue.enqueueCreation.mockRejectedValue(
        new Error('ConnectionDisabledException')
      );

      await expect(controller.createOffer('conn-1', validDto)).rejects.toThrow(
        'ConnectionDisabledException'
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
        request
      );
      offerCreationRecords.findById.mockResolvedValue(recordWithRequest);

      const result = await controller.getOfferCreationStatus('conn-1', 'record-2');

      expect(result.request).toEqual(request);
      expect(result.request?.schemaVersion).toBe(1);
    });

    it('throws NotFoundException when record does not exist', async () => {
      offerCreationRecords.findById.mockResolvedValue(null);

      await expect(controller.getOfferCreationStatus('conn-1', 'missing')).rejects.toThrow(
        NotFoundException
      );
    });

    it('throws NotFoundException when record belongs to a different connection', async () => {
      offerCreationRecords.findById.mockResolvedValue(mockRecord);

      await expect(controller.getOfferCreationStatus('conn-other', 'record-1')).rejects.toThrow(
        NotFoundException
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

  describe('getResponsibleProducers', () => {
    it('delegates to the responsible-producer service and wraps the result', async () => {
      responsibleProducers.listResponsibleProducers.mockResolvedValue([
        { id: '1', name: 'ACME Sp. z o.o.', kind: 'PRODUCER' },
        { id: '2', name: 'Importer Ltd', kind: 'PRODUCER' },
      ]);

      const result = await controller.getResponsibleProducers('conn-1');

      expect(result).toEqual({
        responsibleProducers: [
          { id: '1', name: 'ACME Sp. z o.o.', kind: 'PRODUCER' },
          { id: '2', name: 'Importer Ltd', kind: 'PRODUCER' },
        ],
      });
      expect(responsibleProducers.listResponsibleProducers).toHaveBeenCalledWith('conn-1');
    });
  });

  describe('getDeliveryPriceLists', () => {
    it('delegates to the delivery-price-list service and wraps the result', async () => {
      deliveryPriceLists.listDeliveryPriceLists.mockResolvedValue([
        { id: '1', name: '*' },
        { id: '2', name: 'Kurier' },
      ]);

      const result = await controller.getDeliveryPriceLists('conn-1');

      expect(result).toEqual({
        deliveryPriceLists: [
          { id: '1', name: '*' },
          { id: '2', name: 'Kurier' },
        ],
      });
      expect(deliveryPriceLists.listDeliveryPriceLists).toHaveBeenCalledWith('conn-1');
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
      fetch: jest.Mock = jest.fn().mockResolvedValue(sampleNeutral)
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

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        'conn-1',
        'OfferManager'
      );
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
        UnprocessableEntityException
      );
    });

    it('translates CategoryNotFoundException to a 404 NotFoundException', async () => {
      const fetch = jest.fn().mockRejectedValue(new CategoryNotFoundException('999999', 'allegro'));
      integrationsService.getCapabilityAdapter.mockResolvedValue(makeAdapter(true, fetch));

      await expect(controller.getCategoryParameters('conn-1', '999999')).rejects.toBeInstanceOf(
        NotFoundException
      );
    });

    it('propagates upstream errors that are not CategoryNotFoundException', async () => {
      const fetch = jest.fn().mockRejectedValue(new Error('upstream-503'));
      integrationsService.getCapabilityAdapter.mockResolvedValue(makeAdapter(true, fetch));

      await expect(controller.getCategoryParameters('conn-1', '257933')).rejects.toThrow(
        'upstream-503'
      );
    });
  });

  describe('getCategoryPath (#1752)', () => {
    const samplePath = [
      { id: '1', name: 'Electronics' },
      { id: '10', name: 'Smartphones' },
    ];

    function makeAdapter(
      withCategoryPathReader: boolean,
      fetch: jest.Mock = jest.fn().mockResolvedValue(samplePath)
    ): OfferManagerPort {
      const base = { updateOfferQuantity: jest.fn() } as unknown as OfferManagerPort;
      if (withCategoryPathReader) {
        return Object.assign(base, { fetchCategoryPath: fetch });
      }
      return base;
    }

    it('returns the breadcrumb wrapped under `path`, root -> leaf', async () => {
      const fetch = jest.fn().mockResolvedValue(samplePath);
      integrationsService.getCapabilityAdapter.mockResolvedValue(makeAdapter(true, fetch));

      const result = await controller.getCategoryPath('conn-1', '10');

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith('conn-1', 'OfferManager');
      expect(fetch).toHaveBeenCalledWith('10');
      expect(result.path).toEqual(samplePath);
    });

    it('throws 422 when the adapter does not implement CategoryPathReader', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue(makeAdapter(false));

      await expect(controller.getCategoryPath('conn-1', '10')).rejects.toBeInstanceOf(
        UnprocessableEntityException
      );
    });

    it('translates CategoryNotFoundException to a 404 NotFoundException', async () => {
      const fetch = jest.fn().mockRejectedValue(new CategoryNotFoundException('999999', 'allegro'));
      integrationsService.getCapabilityAdapter.mockResolvedValue(makeAdapter(true, fetch));

      await expect(controller.getCategoryPath('conn-1', '999999')).rejects.toBeInstanceOf(
        NotFoundException
      );
    });

    it('propagates upstream errors that are not CategoryNotFoundException', async () => {
      const fetch = jest.fn().mockRejectedValue(new Error('upstream-503'));
      integrationsService.getCapabilityAdapter.mockResolvedValue(makeAdapter(true, fetch));

      await expect(controller.getCategoryPath('conn-1', '10')).rejects.toThrow('upstream-503');
    });
  });

  describe('resolveCategory (#631)', () => {
    // Opaque adapter — the integration-service mock returns it just to satisfy
    // the pre-flight connection-validity check; the resolveCategory service
    // is fully mocked, so the adapter's actual surface doesn't matter here.
    const opaqueAdapter = { updateOfferQuantity: jest.fn() } as unknown as OfferManagerPort;

    it('returns method=auto_detect when the barcode resolves', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue(opaqueAdapter);
      categoryResolution.resolveCategory.mockResolvedValue({
        destinationCategoryId: '257933',
        provenance: 'borrows',
        method: 'auto_detect',
      });

      const result = await controller.resolveCategory('conn-1', {
        barcode: '5901234567890',
      });

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        'conn-1',
        'OfferManager'
      );
      expect(categoryResolution.resolveCategory).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        barcode: '5901234567890',
        sourceCategoryIds: undefined,
      });
      expect(result).toEqual({ allegroCategoryId: '257933', method: 'auto_detect' });
    });

    it('returns method=category_mapping when sourceCategoryIds resolve', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue(opaqueAdapter);
      categoryResolution.resolveCategory.mockResolvedValue({
        destinationCategoryId: '12345',
        provenance: null,
        method: 'category_mapping',
      });

      const result = await controller.resolveCategory('conn-1', {
        sourceCategoryIds: ['ps-cat-99', 'ps-cat-7'],
      });

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        'conn-1',
        'OfferManager'
      );
      expect(categoryResolution.resolveCategory).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        barcode: null,
        sourceCategoryIds: ['ps-cat-99', 'ps-cat-7'],
      });
      expect(result).toEqual({ allegroCategoryId: '12345', method: 'category_mapping' });
    });

    it('returns method=manual with null allegroCategoryId when nothing resolves', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue(opaqueAdapter);
      categoryResolution.resolveCategory.mockResolvedValue({
        destinationCategoryId: null,
        provenance: null,
        method: 'manual',
      });

      const result = await controller.resolveCategory('conn-1', {});

      // `manual` is a normal outcome — the controller surfaces it as a 200
      // response (decorator-level @HttpCode is implicit) with the null id.
      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        'conn-1',
        'OfferManager'
      );
      expect(result).toEqual({ allegroCategoryId: null, method: 'manual' });
    });

    it('propagates ConnectionNotFoundException from the pre-flight without calling resolveCategory', async () => {
      // The domain exception the integrations service actually throws; the
      // global filter maps it to a 404. The pre-flight is the value-add of
      // this controller — without it, an unknown connection would silently
      // fall through to method=manual inside the service.
      integrationsService.getCapabilityAdapter.mockRejectedValue(
        new ConnectionNotFoundException('conn-missing')
      );

      await expect(
        controller.resolveCategory('conn-missing', { barcode: '5901234567890' })
      ).rejects.toBeInstanceOf(ConnectionNotFoundException);

      expect(categoryResolution.resolveCategory).not.toHaveBeenCalled();
    });
  });

  describe('resolveCategoriesBatch (#795)', () => {
    it('maps null EANs through and converts the service Map to a results record', async () => {
      const serviceResult = new Map<string, EanMatchResult>([
        ['v1', { kind: 'matched', allegroCategoryId: '257933', productCardId: 'card-1' }],
        ['v2', { kind: 'no-ean' }],
      ]);
      categoryResolution.resolveCategoriesBatch.mockResolvedValue(serviceResult);

      const result = await controller.resolveCategoriesBatch('conn-1', {
        items: [
          { variantId: 'v1', ean: '5901234567890' },
          { variantId: 'v2' },
        ],
      });

      expect(categoryResolution.resolveCategoriesBatch).toHaveBeenCalledWith('conn-1', {
        items: [
          { variantId: 'v1', ean: '5901234567890' },
          { variantId: 'v2', ean: null },
        ],
      });
      expect(result).toEqual({
        results: {
          v1: { kind: 'matched', allegroCategoryId: '257933', productCardId: 'card-1' },
          v2: { kind: 'no-ean' },
        },
      });
    });

    it('forwards sourceCategoryIds and surfaces a category_mapping result (#1522)', async () => {
      const serviceResult = new Map<string, EanMatchResult>([
        [
          'v1',
          {
            kind: 'matched',
            allegroCategoryId: '89508',
            productCardId: '',
            method: 'category_mapping',
          },
        ],
      ]);
      categoryResolution.resolveCategoriesBatch.mockResolvedValue(serviceResult);

      const result = await controller.resolveCategoriesBatch('conn-1', {
        items: [{ variantId: 'v1', ean: '5901234567890', sourceCategoryIds: ['ps-cat-42'] }],
      });

      expect(categoryResolution.resolveCategoriesBatch).toHaveBeenCalledWith('conn-1', {
        items: [{ variantId: 'v1', ean: '5901234567890', sourceCategoryIds: ['ps-cat-42'] }],
      });
      expect(result).toEqual({
        results: {
          v1: {
            kind: 'matched',
            allegroCategoryId: '89508',
            productCardId: '',
            method: 'category_mapping',
          },
        },
      });
    });

    it('maps AdapterCapabilityNotSupportedException to 422', async () => {
      categoryResolution.resolveCategoriesBatch.mockRejectedValue(
        new AdapterCapabilityNotSupportedException('conn-1', 'EanCategoryMatcher')
      );

      await expect(
        controller.resolveCategoriesBatch('conn-1', { items: [{ variantId: 'v1', ean: '590' }] })
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('propagates non-capability errors (e.g. connection not found) untouched', async () => {
      categoryResolution.resolveCategoriesBatch.mockRejectedValue(
        new ConnectionNotFoundException('conn-missing')
      );

      await expect(
        controller.resolveCategoriesBatch('conn-missing', {
          items: [{ variantId: 'v1', ean: '590' }],
        })
      ).rejects.toBeInstanceOf(ConnectionNotFoundException);
    });
  });

  describe('CatalogProductReader (#633)', () => {
    function makeAdapter(
      catalogReader: boolean,
      methods: Partial<{
        findProductsByBarcode: jest.Mock;
        getProduct: jest.Mock;
      }> = {}
    ): OfferManagerPort {
      const base = { updateOfferQuantity: jest.fn() } as unknown as OfferManagerPort;
      if (catalogReader) {
        return Object.assign(base, {
          findProductsByBarcode: methods.findProductsByBarcode ?? jest.fn(),
          getProduct: methods.getProduct ?? jest.fn(),
        });
      }
      return base;
    }

    const sampleProduct: CatalogProduct = {
      id: 'p1',
      name: 'Canon SX740 HS',
      ean: '5901234123457',
      imageUrl: 'https://img/a.jpg',
      images: ['https://img/a.jpg'],
      parameters: [{ parameterId: '224017', name: 'Brand', valueStrings: ['Canon'] }],
    };

    describe('findProductsByBarcode', () => {
      it('returns the unique branch with the eager-fetched product', async () => {
        const find = jest.fn().mockResolvedValue({
          kind: 'unique',
          product: sampleProduct,
        } satisfies CatalogProductMatchResult);
        integrationsService.getCapabilityAdapter.mockResolvedValue(
          makeAdapter(true, { findProductsByBarcode: find })
        );

        const result = await controller.findProductsByBarcode('conn-1', {
          barcode: '5901234123457',
          categoryId: 'cat-1',
        });

        expect(find).toHaveBeenCalledWith({ barcode: '5901234123457', categoryId: 'cat-1' });
        expect(result).toEqual({ kind: 'unique', product: sampleProduct });
      });

      it('returns ambiguous summaries verbatim', async () => {
        const find = jest.fn().mockResolvedValue({
          kind: 'ambiguous',
          products: [
            { id: 'p1', name: 'A', ean: '5901234123457' },
            { id: 'p2', name: 'B', ean: '5901234123457' },
          ],
        } satisfies CatalogProductMatchResult);
        integrationsService.getCapabilityAdapter.mockResolvedValue(
          makeAdapter(true, { findProductsByBarcode: find })
        );

        const result = await controller.findProductsByBarcode('conn-1', {
          barcode: '5901234123457',
          categoryId: 'cat-1',
        });

        expect(result).toEqual({
          kind: 'ambiguous',
          products: [
            { id: 'p1', name: 'A', ean: '5901234123457' },
            { id: 'p2', name: 'B', ean: '5901234123457' },
          ],
        });
      });

      it('returns no_match as a 200 (not a 404)', async () => {
        const find = jest
          .fn()
          .mockResolvedValue({ kind: 'no_match' } satisfies CatalogProductMatchResult);
        integrationsService.getCapabilityAdapter.mockResolvedValue(
          makeAdapter(true, { findProductsByBarcode: find })
        );

        const result = await controller.findProductsByBarcode('conn-1', {
          barcode: '5901234123457',
          categoryId: 'cat-1',
        });

        expect(result).toEqual({ kind: 'no_match' });
      });

      it('throws 422 when the adapter does not implement CatalogProductReader', async () => {
        integrationsService.getCapabilityAdapter.mockResolvedValue(makeAdapter(false));

        await expect(
          controller.findProductsByBarcode('conn-1', { barcode: '5901234123457' })
        ).rejects.toBeInstanceOf(UnprocessableEntityException);
      });

      it('propagates ConnectionNotFoundException from the capability pre-flight', async () => {
        integrationsService.getCapabilityAdapter.mockRejectedValue(
          new ConnectionNotFoundException('conn-missing')
        );

        await expect(
          controller.findProductsByBarcode('conn-missing', { barcode: '5901234123457' })
        ).rejects.toBeInstanceOf(ConnectionNotFoundException);
      });
    });

    describe('getCatalogProduct', () => {
      it('returns the catalog product', async () => {
        const get = jest.fn().mockResolvedValue(sampleProduct);
        integrationsService.getCapabilityAdapter.mockResolvedValue(
          makeAdapter(true, { getProduct: get })
        );

        const result = await controller.getCatalogProduct('conn-1', 'p1');

        expect(get).toHaveBeenCalledWith({ productId: 'p1' });
        expect(result).toEqual(sampleProduct);
      });

      it('throws 422 when the adapter does not implement CatalogProductReader', async () => {
        integrationsService.getCapabilityAdapter.mockResolvedValue(makeAdapter(false));

        await expect(controller.getCatalogProduct('conn-1', 'p1')).rejects.toBeInstanceOf(
          UnprocessableEntityException
        );
      });

      it('translates CatalogProductNotFoundException to a 404 NotFoundException', async () => {
        const get = jest.fn().mockRejectedValue(new CatalogProductNotFoundException('missing'));
        integrationsService.getCapabilityAdapter.mockResolvedValue(
          makeAdapter(true, { getProduct: get })
        );

        await expect(controller.getCatalogProduct('conn-1', 'missing')).rejects.toBeInstanceOf(
          NotFoundException
        );
      });

      it('propagates non-CatalogProductNotFoundException errors unchanged', async () => {
        const get = jest.fn().mockRejectedValue(new Error('upstream-503'));
        integrationsService.getCapabilityAdapter.mockResolvedValue(
          makeAdapter(true, { getProduct: get })
        );

        await expect(controller.getCatalogProduct('conn-1', 'p1')).rejects.toThrow('upstream-503');
      });
    });
  });

  // ─── @Roles metadata (#1608) ────────────────────────────────────────────────
  //
  // Demo-mode `viewer` accounts must reach step 4 (Confirm) of the bulk-create
  // offer wizard: all read-only lookups it drives must include 'viewer' in
  // their @Roles set, while every write/submit endpoint stays admin+operator
  // only. Reads decorator metadata directly (no HTTP layer / DB needed) so
  // this stays in the fast unit-test tier; the end-to-end guard behaviour is
  // covered by viewer-role-authz.int-spec.ts.
  describe('@Roles metadata (#1608 — viewer wizard-read access)', () => {
    const READ_LOOKUP_METHODS = [
      'getSellerPolicies',
      'getResponsibleProducers',
      'getDeliveryPriceLists',
      'getCategoryParameters',
      'resolveCategory',
      'resolveCategoriesBatch',
      'findProductsByBarcode',
      'getCatalogProduct',
    ] as const;

    const WRITE_METHODS = ['updateOfferFields', 'autoMatchVariants', 'createOffer'] as const;

    function rolesOf(methodName: string): string[] | undefined {
      const proto = ListingsController.prototype as unknown as Record<string, unknown>;
      return Reflect.getMetadata(ROLES_KEY, proto[methodName] as object) as string[] | undefined;
    }

    it.each(READ_LOOKUP_METHODS)('%s includes admin, operator, and viewer', (methodName) => {
      expect(rolesOf(methodName)).toEqual(['admin', 'operator', 'viewer']);
    });

    it.each(WRITE_METHODS)('%s stays restricted to admin and operator (no viewer)', (methodName) => {
      expect(rolesOf(methodName)).toEqual(['admin', 'operator']);
    });
  });

  describe('getProductOfferStatus (#1760)', () => {
    it('maps snapshots to publication-status DTOs', async () => {
      const syncedAt = new Date('2026-07-22T08:00:00Z');
      offerStatusRead.getPublicationStatusForProduct.mockResolvedValue([
        {
          connectionId: 'conn-1',
          externalOfferId: '7781896308',
          internalVariantId: 'ol_variant_1',
          publicationStatus: 'active',
          statusDetails: { validationMessages: ['note'] },
          lastStatusSyncedAt: syncedAt,
        } as OfferStatusSnapshot,
      ]);

      const result = await controller.getProductOfferStatus('ol_product_1', 'conn-1');

      expect(offerStatusRead.getPublicationStatusForProduct).toHaveBeenCalledWith(
        'ol_product_1',
        'conn-1'
      );
      expect(result).toEqual([
        {
          connectionId: 'conn-1',
          externalOfferId: '7781896308',
          internalVariantId: 'ol_variant_1',
          publicationStatus: 'active',
          validationMessages: ['note'],
          lastStatusSyncedAt: syncedAt.toISOString(),
        },
      ]);
    });
  });

  describe('refreshOfferStatus (#1760)', () => {
    const body = { internalVariantId: 'ol_variant_1' };

    it('returns the refreshed publication status', async () => {
      offerStatusSync.refreshOne.mockResolvedValue('active');

      const result = await controller.refreshOfferStatus('conn-1', '7781896308', body);

      expect(offerStatusSync.refreshOne).toHaveBeenCalledWith('conn-1', {
        externalOfferId: '7781896308',
        internalVariantId: 'ol_variant_1',
      });
      expect(result).toEqual({ publicationStatus: 'active' });
    });

    it('throws 404 when live status is unavailable', async () => {
      offerStatusSync.refreshOne.mockResolvedValue(null);

      await expect(controller.refreshOfferStatus('conn-1', '7781896308', body)).rejects.toBeInstanceOf(
        NotFoundException
      );
    });
  });
});
