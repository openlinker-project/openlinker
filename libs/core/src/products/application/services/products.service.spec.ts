/**
 * Products Service Unit Tests
 *
 * Tests for product and variant read operations.
 *
 * @module libs/core/src/products/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ProductsService } from './products.service';
import type { ProductRepositoryPort } from '../../domain/ports/product-repository.port';
import type { ProductVariantRepositoryPort } from '../../domain/ports/product-variant-repository.port';
import type { Product } from '../../domain/entities/product.entity';
import type { ProductVariant } from '../../domain/entities/product-variant.entity';
import { PRODUCT_REPOSITORY_TOKEN, PRODUCT_VARIANT_REPOSITORY_TOKEN } from '../../products.tokens';

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

describe('ProductsService', () => {
  let service: ProductsService;
  let productRepo: jest.Mocked<ProductRepositoryPort>;
  let variantRepo: jest.Mocked<ProductVariantRepositoryPort>;

  const mockProductRepo: jest.Mocked<ProductRepositoryPort> = {
    findById: jest.fn(),
    findByIds: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
  };

  const mockVariantRepo: jest.Mocked<ProductVariantRepositoryPort> = {
    findById: jest.fn(),
    findByProductId: jest.fn(),
    findBySku: jest.fn(),
    findBySkuIn: jest.fn(),
    findByEanOrGtinIn: jest.fn(),
    upsert: jest.fn(),
    upsertMany: jest.fn(),
    findMany: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PRODUCT_REPOSITORY_TOKEN, useValue: mockProductRepo },
        { provide: PRODUCT_VARIANT_REPOSITORY_TOKEN, useValue: mockVariantRepo },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    productRepo = module.get(PRODUCT_REPOSITORY_TOKEN);
    variantRepo = module.get(PRODUCT_VARIANT_REPOSITORY_TOKEN);

    jest.clearAllMocks();
  });

  describe('getProduct', () => {
    it('should return product when found', async () => {
      const product = makeProduct();
      productRepo.findById.mockResolvedValue(product);

      const result = await service.getProduct('ol_product_1');

      expect(result).toBe(product);
      expect(productRepo.findById).toHaveBeenCalledWith('ol_product_1');
    });

    it('should return null when product not found', async () => {
      productRepo.findById.mockResolvedValue(null);

      const result = await service.getProduct('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getProductsByIds', () => {
    it('returns [] without hitting the repository for an empty input', async () => {
      const result = await service.getProductsByIds([]);

      expect(result).toEqual([]);
      expect(productRepo.findByIds).not.toHaveBeenCalled();
    });

    it('forwards the id list to the repository and returns the result', async () => {
      const products = [makeProduct(), makeProduct({ id: 'ol_product_2', name: 'Second' })];
      productRepo.findByIds.mockResolvedValue(products);

      const result = await service.getProductsByIds(['ol_product_1', 'ol_product_2']);

      expect(result).toBe(products);
      expect(productRepo.findByIds).toHaveBeenCalledWith(['ol_product_1', 'ol_product_2']);
    });
  });

  describe('getVariantsBySkus', () => {
    it('returns [] without hitting the repository for an empty input', async () => {
      const result = await service.getVariantsBySkus([]);

      expect(result).toEqual([]);
      expect(variantRepo.findBySkuIn).not.toHaveBeenCalled();
    });

    it('forwards the sku list to the repository and returns the result', async () => {
      const variants = [makeVariant()];
      variantRepo.findBySkuIn.mockResolvedValue(variants);

      const result = await service.getVariantsBySkus(['SKU-A', 'SKU-B']);

      expect(result).toBe(variants);
      expect(variantRepo.findBySkuIn).toHaveBeenCalledWith(['SKU-A', 'SKU-B']);
    });
  });

  describe('getVariantsByBarcodes', () => {
    it('returns [] without hitting the repository for an empty values input', async () => {
      const result = await service.getVariantsByBarcodes('conn-1', [], 'ean');

      expect(result).toEqual([]);
      expect(variantRepo.findByEanOrGtinIn).not.toHaveBeenCalled();
    });

    it('forwards the (connectionId, values, field) triple to the repository', async () => {
      const variants = [makeVariant()];
      variantRepo.findByEanOrGtinIn.mockResolvedValue(variants);

      const result = await service.getVariantsByBarcodes('conn-1', ['5901234567890'], 'ean');

      expect(result).toBe(variants);
      expect(variantRepo.findByEanOrGtinIn).toHaveBeenCalledWith(
        'conn-1',
        ['5901234567890'],
        'ean'
      );
    });
  });

  describe('listProducts', () => {
    it('should return paginated products', async () => {
      const products = [makeProduct(), makeProduct({ id: 'ol_product_2', name: 'Second' })];
      productRepo.findMany.mockResolvedValue({ items: products, total: 2 });

      const result = await service.listProducts({}, { limit: 20, offset: 0 });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(productRepo.findMany).toHaveBeenCalledWith({}, { limit: 20, offset: 0 });
    });

    it('should pass search filter to repository', async () => {
      productRepo.findMany.mockResolvedValue({ items: [], total: 0 });

      await service.listProducts({ search: 'shirt' }, { limit: 10, offset: 5 });

      expect(productRepo.findMany).toHaveBeenCalledWith(
        { search: 'shirt' },
        { limit: 10, offset: 5 }
      );
    });
  });

  describe('listVariants', () => {
    it('should return paginated variants for a product', async () => {
      const variants = [makeVariant()];
      variantRepo.findMany.mockResolvedValue({ items: variants, total: 1 });

      const result = await service.listVariants(
        { productId: 'ol_product_1' },
        { limit: 20, offset: 0 }
      );

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(variantRepo.findMany).toHaveBeenCalledWith(
        { productId: 'ol_product_1' },
        { limit: 20, offset: 0 }
      );
    });

    it('should pass search filter to repository', async () => {
      variantRepo.findMany.mockResolvedValue({ items: [], total: 0 });

      await service.listVariants({ search: '1234567890123' }, { limit: 20, offset: 0 });

      expect(variantRepo.findMany).toHaveBeenCalledWith(
        { search: '1234567890123' },
        { limit: 20, offset: 0 }
      );
    });
  });
});
