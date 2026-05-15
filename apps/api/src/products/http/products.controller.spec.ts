/**
 * Products Controller Unit Tests
 *
 * Tests for product and variant read API endpoints.
 *
 * @module apps/api/src/products/http
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProductsController, VariantsController } from './products.controller';
import { PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';
import type { IProductsService, Product, ProductVariant } from '@openlinker/core/products';
import { IDENTIFIER_MAPPING_SERVICE_TOKEN } from '@openlinker/core/identifier-mapping';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'ol_product_1',
    name: 'Test Product',
    sku: 'SKU-001',
    price: 29.99,
    currency: null,
    description: 'A test product',
    images: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeVariant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: overrides.id ?? 'ol_product_v1',
    productId: overrides.productId ?? 'ol_product_1',
    sku: overrides.sku ?? 'SKU-001-S',
    attributes: overrides.attributes ?? { size: 'S' },
    ean: overrides.ean ?? '1234567890123',
    gtin: overrides.gtin ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-01-01T00:00:00Z'),
  };
}

function createMockProductsService(): jest.Mocked<IProductsService> {
  return {
    upsertProduct: jest.fn(),
    upsertVariants: jest.fn(),
    getProduct: jest.fn(),
    getProductsByIds: jest.fn(),
    getVariant: jest.fn(),
    getVariantsBySkus: jest.fn(),
    getVariantsByBarcodes: jest.fn(),
    listProducts: jest.fn(),
    listVariants: jest.fn(),
  };
}

function createMockIdentifierMapping(): jest.Mocked<IdentifierMappingPort> {
  return {
    getOrCreateInternalId: jest.fn(),
    getInternalId: jest.fn(),
    getExternalIds: jest.fn(),
    createMapping: jest.fn(),
    batchGetOrCreateInternalIds: jest.fn(),
    getOrCreateExactMapping: jest.fn(),
    deleteMapping: jest.fn(),
    listExternalIdsByConnection: jest.fn(),
  };
}

describe('ProductsController', () => {
  let controller: ProductsController;
  let productsService: jest.Mocked<IProductsService>;
  let identifierMapping: jest.Mocked<IdentifierMappingPort>;

  beforeEach(async () => {
    const mockProductsService = createMockProductsService();
    const mockIdentifierMapping = createMockIdentifierMapping();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: PRODUCTS_SERVICE_TOKEN, useValue: mockProductsService },
        { provide: IDENTIFIER_MAPPING_SERVICE_TOKEN, useValue: mockIdentifierMapping },
      ],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
    productsService = module.get(PRODUCTS_SERVICE_TOKEN);
    identifierMapping = module.get(IDENTIFIER_MAPPING_SERVICE_TOKEN);

    jest.clearAllMocks();
  });

  describe('listProducts', () => {
    it('should return paginated product list', async () => {
      const products = [makeProduct()];
      productsService.listProducts.mockResolvedValue({ items: products, total: 1 });

      const result = await controller.listProducts({ limit: 20, offset: 0 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(result.items[0].id).toBe('ol_product_1');
      expect(result.items[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('should pass search filter to service', async () => {
      productsService.listProducts.mockResolvedValue({ items: [], total: 0 });

      await controller.listProducts({ search: 'shirt', limit: 10, offset: 5 });

      expect(productsService.listProducts).toHaveBeenCalledWith(
        { search: 'shirt' },
        { limit: 10, offset: 5 }
      );
    });

    it('should not include variants or externalIds in list response', async () => {
      productsService.listProducts.mockResolvedValue({ items: [makeProduct()], total: 1 });

      const result = await controller.listProducts({});

      expect(result.items[0].variants).toBeUndefined();
      expect(result.items[0].externalIds).toBeUndefined();
    });
  });

  describe('getProduct', () => {
    it('should return product with variants and external IDs', async () => {
      const product = makeProduct();
      const variant = makeVariant();
      productsService.getProduct.mockResolvedValue(product);
      productsService.listVariants.mockResolvedValue({ items: [variant], total: 1 });
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          externalId: '42',
          platformType: 'prestashop',
          connectionId: 'conn-1',
          entityType: 'Product',
        },
      ]);

      const result = await controller.getProduct('ol_product_1');

      expect(result.id).toBe('ol_product_1');
      expect(result.currency).toBeNull();
      expect(result.variants).toHaveLength(1);
      expect(result.variants![0].id).toBe('ol_product_v1');
      expect(result.externalIds).toHaveLength(1);
      expect(result.externalIds![0].externalId).toBe('42');
      // Verify correct entity type passed for product and variant
      expect(identifierMapping.getExternalIds).toHaveBeenCalledWith('Product', 'ol_product_1');
      expect(identifierMapping.getExternalIds).toHaveBeenCalledWith('Product', 'ol_product_v1');
    });

    it('should surface currency when the domain entity carries one', async () => {
      productsService.getProduct.mockResolvedValue(makeProduct({ currency: 'PLN' }));
      productsService.listVariants.mockResolvedValue({ items: [], total: 0 });
      identifierMapping.getExternalIds.mockResolvedValue([]);

      const result = await controller.getProduct('ol_product_1');

      expect(result.currency).toBe('PLN');
    });

    it('should throw NotFoundException when product not found', async () => {
      productsService.getProduct.mockResolvedValue(null);

      await expect(controller.getProduct('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should load external IDs in parallel', async () => {
      const product = makeProduct();
      const variants = [makeVariant({ id: 'ol_product_v1' }), makeVariant({ id: 'ol_product_v2' })];
      productsService.getProduct.mockResolvedValue(product);
      productsService.listVariants.mockResolvedValue({ items: variants, total: 2 });
      identifierMapping.getExternalIds.mockResolvedValue([]);

      await controller.getProduct('ol_product_1');

      // 1 call for product + 2 calls for variants = 3 total
      expect(identifierMapping.getExternalIds).toHaveBeenCalledTimes(3);
    });
  });

  describe('listVariantsByProduct', () => {
    it('should return paginated variants for a product', async () => {
      const variants = [makeVariant()];
      productsService.listVariants.mockResolvedValue({ items: variants, total: 1 });

      const result = await controller.listVariantsByProduct('ol_product_1', {
        limit: 20,
        offset: 0,
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(productsService.listVariants).toHaveBeenCalledWith(
        { productId: 'ol_product_1', search: undefined },
        { limit: 20, offset: 0 }
      );
    });
  });

  describe('getVariantSummary (#464)', () => {
    it('should return id, productId, sku, ean, and attribute-derived name on hit', async () => {
      productsService.getVariant.mockResolvedValue(
        makeVariant({
          id: 'ol_variant_42',
          productId: 'ol_product_1',
          sku: 'SKU-RED-42',
          ean: '5901234123457',
          attributes: { color: 'Red', size: '42' },
        })
      );

      const result = await controller.getVariantSummary('ol_variant_42');

      expect(result).toEqual({
        id: 'ol_variant_42',
        productId: 'ol_product_1',
        sku: 'SKU-RED-42',
        ean: '5901234123457',
        name: 'Red / 42',
      });
      expect(productsService.getVariant).toHaveBeenCalledWith('ol_variant_42');
    });

    it('should leave name undefined when the variant has no string attributes', async () => {
      productsService.getVariant.mockResolvedValue(
        makeVariant({ id: 'ol_variant_43', attributes: {} })
      );

      const result = await controller.getVariantSummary('ol_variant_43');

      expect(result.name).toBeUndefined();
    });

    it('should throw NotFoundException when variant not found', async () => {
      productsService.getVariant.mockResolvedValue(null);

      await expect(controller.getVariantSummary('missing')).rejects.toThrow(NotFoundException);
    });
  });
});

describe('VariantsController', () => {
  let controller: VariantsController;
  let productsService: jest.Mocked<IProductsService>;

  beforeEach(async () => {
    const mockProductsService = createMockProductsService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VariantsController],
      providers: [{ provide: PRODUCTS_SERVICE_TOKEN, useValue: mockProductsService }],
    }).compile();

    controller = module.get<VariantsController>(VariantsController);
    productsService = module.get(PRODUCTS_SERVICE_TOKEN);

    jest.clearAllMocks();
  });

  describe('searchVariants', () => {
    it('should search variants across all products', async () => {
      const variants = [makeVariant()];
      productsService.listVariants.mockResolvedValue({ items: variants, total: 1 });

      const result = await controller.searchVariants({
        search: '1234567890123',
        limit: 20,
        offset: 0,
      });

      expect(result.items).toHaveLength(1);
      expect(productsService.listVariants).toHaveBeenCalledWith(
        { search: '1234567890123' },
        { limit: 20, offset: 0 }
      );
    });

    it('should return empty results when no match', async () => {
      productsService.listVariants.mockResolvedValue({ items: [], total: 0 });

      const result = await controller.searchVariants({ search: 'nonexistent' });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });
});
