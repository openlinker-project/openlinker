/**
 * PrestaShop Product Sync Handler Unit Tests
 *
 * Unit tests for PrestashopProductSyncHandler, verifying product sync workflow,
 * error handling, and domain entity conversion.
 *
 * @module apps/worker/src/sync/handlers
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-var-requires */
import { Test, TestingModule } from '@nestjs/testing';
import { PrestashopProductSyncHandler } from '../prestashop-product-sync.handler';
import { SyncJob } from '@openlinker/core/sync/domain/entities/sync-job.entity';
import { SyncJobExecutionError } from '@openlinker/core/sync/domain/exceptions/sync-job-execution.error';
import { IIntegrationsService } from '@openlinker/core/integrations/application/interfaces/integrations.service.interface';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations/integrations.tokens';
import { IIdentifierMappingService } from '@openlinker/core/identifier-mapping/application/services/identifier-mapping.service.interface';
import { IDENTIFIER_MAPPING_SERVICE_TOKEN } from '@openlinker/core/identifier-mapping/identifier-mapping.tokens';
import {
  IProductsService,
  PRODUCTS_SERVICE_TOKEN,
  ProductEntity,
  ProductVariantEntity,
  ProductMasterPort,
  Product as ProductPortInterface,
  ProductVariant as ProductVariantPortInterface,
} from '@openlinker/core/products';
import {
  PrestashopResourceNotFoundException,
  PrestashopAuthenticationException,
} from '@openlinker/integrations-prestashop';
import { randomUUID } from 'crypto';

describe('PrestashopProductSyncHandler', () => {
  let handler: PrestashopProductSyncHandler;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let productsService: jest.Mocked<IProductsService>;
  let productAdapter: jest.Mocked<ProductMasterPort>;
  let module: TestingModule;

  beforeEach(async () => {
    // Mock product adapter
    productAdapter = {
      getProduct: jest.fn(),
      getProductVariants: jest.fn(),
      getProducts: jest.fn(),
      getCategories: jest.fn(),
    } as unknown as jest.Mocked<ProductMasterPort>;

    // Mock integrations service
    const mockIntegrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(productAdapter),
    } as unknown as jest.Mocked<IIntegrationsService>;

    // Mock identifier mapping service
    const mockIdentifierMapping = {
      getOrCreateInternalId: jest.fn(),
      getExternalId: jest.fn(),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    // Mock products service
    const mockProductsService = {
      upsertProduct: jest.fn(),
      upsertVariants: jest.fn(),
      getProduct: jest.fn(),
      getProducts: jest.fn(),
    } as unknown as jest.Mocked<IProductsService>;

    module = await Test.createTestingModule({
      providers: [
        PrestashopProductSyncHandler,
        {
          provide: INTEGRATIONS_SERVICE_TOKEN,
          useValue: mockIntegrationsService,
        },
        {
          provide: IDENTIFIER_MAPPING_SERVICE_TOKEN,
          useValue: mockIdentifierMapping,
        },
        {
          provide: PRODUCTS_SERVICE_TOKEN,
          useValue: mockProductsService,
        },
      ],
    }).compile();

    handler = module.get<PrestashopProductSyncHandler>(PrestashopProductSyncHandler);
    integrationsService = module.get(INTEGRATIONS_SERVICE_TOKEN);
    identifierMapping = module.get(IDENTIFIER_MAPPING_SERVICE_TOKEN);
    productsService = module.get(PRODUCTS_SERVICE_TOKEN);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    // Close the testing module to trigger OnModuleDestroy on all providers
    if (module) {
      await module.close();
    }
  });

  const createMockJob = (overrides?: Partial<SyncJob>): SyncJob => {
    return new SyncJob(
      randomUUID(),
      'prestashop.product.syncByExternalId',
      randomUUID(),
      {
        externalId: '1',
        objectType: 'Product',
        eventType: 'product.updated',
        ...overrides?.payload,
      },
      'running',
      `test-key-${randomUUID()}`,
      0,
      10,
      new Date(),
      new Date(),
      'worker-123',
      null,
      new Date(),
      new Date(),
    );
  };

  const createMockProductPort = (overrides?: Partial<ProductPortInterface>): ProductPortInterface => {
    return {
      id: `ol_product_${randomUUID()}`,
      name: 'Test Product',
      sku: 'TEST-SKU',
      price: 19.99,
      description: 'Test Description',
      images: ['http://example.com/image.jpg'],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  };

  const createMockVariantPort = (
    overrides?: Partial<ProductVariantPortInterface>,
  ): ProductVariantPortInterface => {
    return {
      id: `ol_variant_${randomUUID()}`,
      productId: `ol_product_${randomUUID()}`, // Required field
      sku: 'TEST-VARIANT-SKU',
      attributes: { size: 'M', color: 'Blue' },
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  };

  describe('execute', () => {
    it('should sync product successfully', async () => {
      const job = createMockJob();
      const internalProductId = `ol_product_${randomUUID()}`;
      const productPort = createMockProductPort({ id: internalProductId });
      const variantPort = createMockVariantPort();

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      productAdapter.getProduct.mockResolvedValueOnce(productPort);
      productAdapter.getProductVariants.mockResolvedValueOnce([variantPort]);
      productsService.upsertProduct.mockResolvedValueOnce({
        ...productPort,
        sku: productPort.sku ?? null,
        price: productPort.price ?? null,
        description: productPort.description ?? null,
        images: productPort.images ?? null,
      } as any);
      productsService.upsertVariants.mockResolvedValueOnce(undefined);

      await handler.execute(job);

      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Product',
        '1',
        job.connectionId,
      );
      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        job.connectionId,
        'ProductMaster',
      );
      expect(productAdapter.getProduct).toHaveBeenCalledWith(internalProductId);
      expect(productAdapter.getProductVariants).toHaveBeenCalledWith(internalProductId);
      expect(productsService.upsertProduct).toHaveBeenCalled();
      expect(productsService.upsertVariants).toHaveBeenCalledWith(internalProductId, expect.any(Array));
    });

    it('should handle product without variants', async () => {
      const job = createMockJob();
      const internalProductId = `ol_product_${randomUUID()}`;
      const productPort = createMockProductPort({ id: internalProductId });

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      productAdapter.getProduct.mockResolvedValueOnce(productPort);
      productAdapter.getProductVariants.mockResolvedValueOnce([]);
      productsService.upsertProduct.mockResolvedValueOnce(productPort as any);

      await handler.execute(job);

      expect(productsService.upsertProduct).toHaveBeenCalled();
      expect(productsService.upsertVariants).not.toHaveBeenCalled();
    });

    it('should throw error when externalId is missing', async () => {
      const job = createMockJob({ payload: { externalId: undefined, objectType: 'Product' } }); // Missing externalId

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
      await expect(handler.execute(job)).rejects.toThrow(/Missing or invalid externalId/);
    });

    it('should throw error when externalId is not a string', async () => {
      const job = createMockJob({ payload: { externalId: 123, objectType: 'Product' } });

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
      await expect(handler.execute(job)).rejects.toThrow('Missing or invalid externalId');
    });

    it('should throw error when objectType is missing', async () => {
      const job = createMockJob({ payload: { externalId: '1', objectType: undefined } }); // Missing objectType

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
      await expect(handler.execute(job)).rejects.toThrow(/Missing or invalid objectType/);
    });

    it('should throw error when objectType is not "Product"', async () => {
      const job = createMockJob({ payload: { externalId: '1', objectType: 'Inventory' } });

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
      await expect(handler.execute(job)).rejects.toThrow("Invalid objectType for product sync: Inventory. Expected 'Product'.");
    });

    it('should handle PrestashopResourceNotFoundException (404)', async () => {
      const job = createMockJob();
      const internalProductId = `ol_product_${randomUUID()}`;
      const error = new PrestashopResourceNotFoundException('Product not found');

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      productAdapter.getProduct.mockRejectedValueOnce(error);

      await expect(handler.execute(job)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringMatching(/Product not found/),
        }),
      );
    });

    it('should handle PrestashopAuthenticationException (401)', async () => {
      const job = createMockJob();
      const internalProductId = `ol_product_${randomUUID()}`;
      const error = new PrestashopAuthenticationException('Invalid API key');

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      productAdapter.getProduct.mockRejectedValueOnce(error);

      await expect(handler.execute(job)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringMatching(/Authentication failed/),
        }),
      );
    });

    it('should handle generic errors and wrap in SyncJobExecutionError', async () => {
      const job = createMockJob();
      const internalProductId = `ol_product_${randomUUID()}`;
      const error = new Error('Network timeout');

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      productAdapter.getProduct.mockRejectedValueOnce(error);

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
      await expect(handler.execute(job)).rejects.toThrow('Product sync failed');
    });

    it('should preserve null values using nullish coalescing', async () => {
      const job = createMockJob();
      const internalProductId = `ol_product_${randomUUID()}`;
      const productPort = createMockProductPort({
        id: internalProductId,
        sku: '', // Empty string (falsy but valid)
        price: 0, // Zero (falsy but valid)
        description: undefined,
        images: undefined,
      });

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      productAdapter.getProduct.mockResolvedValueOnce(productPort);
      productAdapter.getProductVariants.mockResolvedValueOnce([]);
      productsService.upsertProduct.mockResolvedValueOnce(productPort as any);

      await handler.execute(job);

      const upsertCall = productsService.upsertProduct.mock.calls[0][0];
      // Empty string and 0 should be preserved (not converted to null)
      expect(upsertCall.sku).toBe(''); // Preserved empty string
      expect(upsertCall.price).toBe(0); // Preserved zero
      expect(upsertCall.description).toBeNull();
      expect(upsertCall.images).toBeNull();
    });
  });

  describe('toDomainProduct', () => {
    it('should convert port Product to domain Product entity', () => {
      const productPort = createMockProductPort();
      const domainProduct = (handler as any).toDomainProduct(productPort);

      expect(domainProduct).toBeInstanceOf(ProductEntity);
      expect(domainProduct.id).toBe(productPort.id);
      expect(domainProduct.name).toBe(productPort.name);
      expect(domainProduct.sku).toBe(productPort.sku);
      expect(domainProduct.price).toBe(productPort.price);
      expect(domainProduct.description).toBe(productPort.description);
      expect(domainProduct.images).toBe(productPort.images);
    });

    it('should use nullish coalescing for optional fields', () => {
      const productPort = createMockProductPort({
        sku: undefined,
        price: undefined,
        description: undefined,
        images: undefined,
      });

      const domainProduct = (handler as any).toDomainProduct(productPort);

      expect(domainProduct.sku).toBeNull();
      expect(domainProduct.price).toBeNull();
      expect(domainProduct.description).toBeNull();
      expect(domainProduct.images).toBeNull();
    });

    it('should preserve falsy values (empty string, zero)', () => {
      const productPort = createMockProductPort({
        sku: '',
        price: 0,
      });

      const domainProduct = (handler as any).toDomainProduct(productPort);

      expect(domainProduct.sku).toBe(''); // Preserved, not null
      expect(domainProduct.price).toBe(0); // Preserved, not null
    });

    it('should use default dates when createdAt/updatedAt are missing', () => {
      const productPort = createMockProductPort({
        createdAt: undefined,
        updatedAt: undefined,
      });

      const domainProduct = (handler as any).toDomainProduct(productPort);

      expect(domainProduct.createdAt).toBeInstanceOf(Date);
      expect(domainProduct.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('toDomainVariant', () => {
    it('should convert port ProductVariant to domain ProductVariant entity', () => {
      const variantPort = createMockVariantPort();
      const productId = `ol_product_${randomUUID()}`;
      const domainVariant = (handler as any).toDomainVariant(variantPort, productId);

      expect(domainVariant).toBeInstanceOf(ProductVariantEntity);
      expect(domainVariant.id).toBe(variantPort.id);
      expect(domainVariant.productId).toBe(productId);
      expect(domainVariant.sku).toBe(variantPort.sku);
      expect(domainVariant.attributes).toBe(variantPort.attributes);
      expect(domainVariant.createdAt).toBeInstanceOf(Date);
      expect(domainVariant.updatedAt).toBeInstanceOf(Date);
    });

    it('should use nullish coalescing for optional fields', () => {
      const variantPort = createMockVariantPort({
        sku: undefined,
        attributes: undefined,
      });
      const productId = `ol_product_${randomUUID()}`;

      const domainVariant = (handler as any).toDomainVariant(variantPort, productId);

      expect(domainVariant.sku).toBeNull();
      expect(domainVariant.attributes).toBeNull();
    });

    it('should preserve empty string for sku', () => {
      const variantPort = createMockVariantPort({
        sku: '',
      });
      const productId = `ol_product_${randomUUID()}`;

      const domainVariant = (handler as any).toDomainVariant(variantPort, productId);

      expect(domainVariant.sku).toBe(''); // Preserved, not null
    });
  });

  describe('getExternalId', () => {
    it('should extract externalId from job payload', () => {
      const job = createMockJob();
      const externalId = (handler as any).getExternalId(job);
      expect(externalId).toBe('1');
    });

    it('should throw SyncJobExecutionError when externalId is missing', () => {
      const job = createMockJob({ payload: { externalId: undefined, objectType: 'Product' } });

      expect(() => (handler as any).getExternalId(job)).toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError when externalId is not a string', () => {
      const job = createMockJob({ payload: { externalId: 123, objectType: 'Product' } });

      expect(() => (handler as any).getExternalId(job)).toThrow(SyncJobExecutionError);
    });
  });

  describe('getObjectType', () => {
    it('should extract objectType from job payload', () => {
      const job = createMockJob();
      const objectType = (handler as any).getObjectType(job);
      expect(objectType).toBe('Product');
    });

    it('should throw SyncJobExecutionError when objectType is missing', () => {
      const job = createMockJob({ payload: { externalId: '1', objectType: undefined } });

      expect(() => (handler as any).getObjectType(job)).toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError when objectType is not a string', () => {
      const job = createMockJob({ payload: { externalId: '1', objectType: 123 } });

      expect(() => (handler as any).getObjectType(job)).toThrow(SyncJobExecutionError);
    });
  });
});

