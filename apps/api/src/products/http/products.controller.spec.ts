/**
 * Products Controller Unit Tests
 *
 * Tests for product and variant read API endpoints.
 *
 * @module apps/api/src/products/http
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductsController, VariantsController } from './products.controller';
import { PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';
import type { IProductsService, Product, ProductVariant } from '@openlinker/core/products';
import { IDENTIFIER_MAPPING_SERVICE_TOKEN } from '@openlinker/core/identifier-mapping';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { INVENTORY_QUERY_SERVICE_TOKEN } from '@openlinker/core/inventory';
import type { IInventoryQueryService } from '@openlinker/core/inventory';
import { OFFER_MAPPINGS_SERVICE_TOKEN } from '@openlinker/core/listings';
import type { IOfferMappingsService } from '@openlinker/core/listings';

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
    price: overrides.price,
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
    getVariantsByProductId: jest.fn(),
    getVariantsBySkus: jest.fn(),
    getVariantsByBarcodes: jest.fn(),
    listProducts: jest.fn(),
    listVariants: jest.fn(),
    getVariantCountsByProductIds: jest.fn(),
    markVariantsStaleExcept: jest.fn(),
  };
}

function createMockInventoryQuery(): jest.Mocked<IInventoryQueryService> {
  return {
    listInventoryItems: jest.fn(),
    getAvailabilityByVariantIds: jest.fn(),
    getProductStockAggregates: jest.fn(),
  };
}

function createMockOfferMappings(): jest.Mocked<IOfferMappingsService> {
  return {
    findForVariant: jest.fn(),
    countForVariants: jest.fn(),
    countListedVariantsByProducts: jest.fn(),
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
  let inventoryQuery: jest.Mocked<IInventoryQueryService>;
  let offerMappings: jest.Mocked<IOfferMappingsService>;

  beforeEach(async () => {
    const mockProductsService = createMockProductsService();
    const mockIdentifierMapping = createMockIdentifierMapping();
    const mockInventoryQuery = createMockInventoryQuery();
    const mockOfferMappings = createMockOfferMappings();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: PRODUCTS_SERVICE_TOKEN, useValue: mockProductsService },
        { provide: IDENTIFIER_MAPPING_SERVICE_TOKEN, useValue: mockIdentifierMapping },
        { provide: INVENTORY_QUERY_SERVICE_TOKEN, useValue: mockInventoryQuery },
        { provide: OFFER_MAPPINGS_SERVICE_TOKEN, useValue: mockOfferMappings },
      ],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
    productsService = module.get(PRODUCTS_SERVICE_TOKEN);
    identifierMapping = module.get(IDENTIFIER_MAPPING_SERVICE_TOKEN);
    inventoryQuery = module.get(INVENTORY_QUERY_SERVICE_TOKEN);
    offerMappings = module.get(OFFER_MAPPINGS_SERVICE_TOKEN);

    jest.clearAllMocks();

    // Enrichment defaults for the list path (#1720): no stock rows, no
    // coverage, no variant counts, no external ids - individual tests
    // override where they assert enrichment mapping.
    inventoryQuery.getProductStockAggregates.mockResolvedValue([]);
    offerMappings.countListedVariantsByProducts.mockResolvedValue([]);
    productsService.getVariantCountsByProductIds.mockResolvedValue(new Map());
    identifierMapping.getExternalIds.mockResolvedValue([]);
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
        {
          search: 'shirt',
          stock: undefined,
          unlistedOnConnectionIds: undefined,
          sourceConnectionId: undefined,
        },
        { limit: 10, offset: 5 },
        undefined
      );
    });

    it('should not include variants in list response', async () => {
      productsService.listProducts.mockResolvedValue({ items: [makeProduct()], total: 1 });

      const result = await controller.listProducts({});

      expect(result.items[0].variants).toBeUndefined();
    });

    it('should pass stock/connectionId filters and sort spec through to the service (#1720)', async () => {
      productsService.listProducts.mockResolvedValue({ items: [], total: 0 });

      await controller.listProducts({
        stock: 'low',
        connectionId: '11111111-1111-4111-8111-111111111111',
        sort: 'stock',
        dir: 'asc',
        limit: 20,
        offset: 0,
      });

      expect(productsService.listProducts).toHaveBeenCalledWith(
        {
          search: undefined,
          stock: 'low',
          unlistedOnConnectionIds: undefined,
          sourceConnectionId: '11111111-1111-4111-8111-111111111111',
        },
        { limit: 20, offset: 0 },
        { field: 'stock', dir: 'asc' }
      );
    });

    it('should default sort direction to desc when only sort is given (#1720)', async () => {
      productsService.listProducts.mockResolvedValue({ items: [], total: 0 });

      await controller.listProducts({ sort: 'name' });

      expect(productsService.listProducts).toHaveBeenCalledWith(
        expect.anything(),
        { limit: 20, offset: 0 },
        { field: 'name', dir: 'desc' }
      );
    });

    it('should split, trim, dedupe, and cap the unlistedOn CSV (#1720)', async () => {
      productsService.listProducts.mockResolvedValue({ items: [], total: 0 });
      const idA = '11111111-1111-4111-8111-111111111111';
      const idB = '22222222-2222-4222-8222-222222222222';

      await controller.listProducts({ unlistedOn: ` ${idA} , ${idB},${idA},, ` });

      expect(productsService.listProducts).toHaveBeenCalledWith(
        expect.objectContaining({ unlistedOnConnectionIds: [idA, idB] }),
        { limit: 20, offset: 0 },
        undefined
      );
    });

    it('should cap unlistedOn at 20 connection ids (#1720)', async () => {
      productsService.listProducts.mockResolvedValue({ items: [], total: 0 });
      const ids = Array.from(
        { length: 25 },
        (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`
      );

      await controller.listProducts({ unlistedOn: ids.join(',') });

      const filters = productsService.listProducts.mock.calls[0][0];
      expect(filters.unlistedOnConnectionIds).toHaveLength(20);
      expect(filters.unlistedOnConnectionIds).toEqual(ids.slice(0, 20));
    });

    it('should reject non-UUID unlistedOn entries with 400 (#1720)', async () => {
      await expect(
        controller.listProducts({ unlistedOn: 'not-a-uuid' })
      ).rejects.toThrow(BadRequestException);
      expect(productsService.listProducts).not.toHaveBeenCalled();
    });

    it('should enrich list items with stock aggregates, coverage, variant counts, and external ids (#1720)', async () => {
      const product = makeProduct();
      productsService.listProducts.mockResolvedValue({ items: [product], total: 1 });
      inventoryQuery.getProductStockAggregates.mockResolvedValue([
        {
          productId: 'ol_product_1',
          totalAvailable: 12,
          totalReserved: 3,
          stockUpdatedAt: new Date('2026-05-01T12:00:00Z'),
        },
      ]);
      offerMappings.countListedVariantsByProducts.mockResolvedValue([
        {
          productId: 'ol_product_1',
          connectionId: 'conn-1',
          platformType: 'allegro',
          listedVariants: 2,
        },
      ]);
      productsService.getVariantCountsByProductIds.mockResolvedValue(
        new Map([['ol_product_1', 3]])
      );
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          externalId: '42',
          platformType: 'prestashop',
          connectionId: 'conn-src',
          entityType: 'Product',
        },
      ]);

      const result = await controller.listProducts({});

      expect(inventoryQuery.getProductStockAggregates).toHaveBeenCalledWith(['ol_product_1']);
      expect(offerMappings.countListedVariantsByProducts).toHaveBeenCalledWith(['ol_product_1']);
      expect(productsService.getVariantCountsByProductIds).toHaveBeenCalledWith(['ol_product_1']);
      expect(identifierMapping.getExternalIds).toHaveBeenCalledWith('Product', 'ol_product_1');

      const item = result.items[0];
      expect(item.totalAvailable).toBe(12);
      expect(item.totalReserved).toBe(3);
      expect(item.stockUpdatedAt).toBe('2026-05-01T12:00:00.000Z');
      expect(item.variantCount).toBe(3);
      expect(item.listingsCoverage).toEqual([
        { connectionId: 'conn-1', platformType: 'allegro', listedVariants: 2 },
      ]);
      expect(item.externalIds).toEqual([
        { externalId: '42', platformType: 'prestashop', connectionId: 'conn-src' },
      ]);
    });

    it('should zero-fill enrichment when a product has no aggregates, coverage, or variants (#1720)', async () => {
      productsService.listProducts.mockResolvedValue({ items: [makeProduct()], total: 1 });

      const result = await controller.listProducts({});

      const item = result.items[0];
      expect(item.totalAvailable).toBe(0);
      expect(item.totalReserved).toBe(0);
      expect(item.stockUpdatedAt).toBeNull();
      expect(item.variantCount).toBe(0);
      expect(item.listingsCoverage).toEqual([]);
      expect(item.externalIds).toEqual([]);
    });

    it('should skip enrichment reads entirely for an empty page (#1720)', async () => {
      productsService.listProducts.mockResolvedValue({ items: [], total: 0 });

      const result = await controller.listProducts({});

      expect(result.items).toEqual([]);
      expect(inventoryQuery.getProductStockAggregates).not.toHaveBeenCalled();
      expect(offerMappings.countListedVariantsByProducts).not.toHaveBeenCalled();
      expect(productsService.getVariantCountsByProductIds).not.toHaveBeenCalled();
      expect(identifierMapping.getExternalIds).not.toHaveBeenCalled();
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
      // Variant without a domain `price` serialises as `null` at the wire
      // boundary (variantToDto normalises `undefined ↔ null`).
      expect(result.variants![0].price).toBeNull();
      expect(result.externalIds).toHaveLength(1);
      expect(result.externalIds![0].externalId).toBe('42');
      // Verify correct entity type passed for product and variant
      expect(identifierMapping.getExternalIds).toHaveBeenCalledWith('Product', 'ol_product_1');
      expect(identifierMapping.getExternalIds).toHaveBeenCalledWith('Product', 'ol_product_v1');
    });

    it('should surface variant price when the domain entity carries one (#792)', async () => {
      productsService.getProduct.mockResolvedValue(makeProduct());
      productsService.listVariants.mockResolvedValue({
        items: [makeVariant({ price: 19.99 })],
        total: 1,
      });
      identifierMapping.getExternalIds.mockResolvedValue([]);

      const result = await controller.getProduct('ol_product_1');

      expect(result.variants![0].price).toBe(19.99);
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
