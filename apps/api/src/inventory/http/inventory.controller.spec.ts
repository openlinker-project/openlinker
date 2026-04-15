/**
 * Inventory Controller Unit Tests
 *
 * @module apps/api/src/inventory/http
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import {
  INVENTORY_REPOSITORY_TOKEN,
  InventoryItemEntity as InventoryItem,
} from '@openlinker/core/inventory';
import type { InventoryRepositoryPort } from '@openlinker/core/inventory';
import {
  PRODUCT_REPOSITORY_TOKEN,
  ProductEntity as Product,
} from '@openlinker/core/products';
import type { ProductRepositoryPort } from '@openlinker/core/products';

describe('InventoryController', () => {
  let controller: InventoryController;
  let repository: jest.Mocked<InventoryRepositoryPort>;
  let productRepository: jest.Mocked<ProductRepositoryPort>;

  const mockItem = new InventoryItem(
    'inv-001',
    'prod-001',
    'var-001',
    50,
    5,
    null,
    new Date('2026-04-01T00:00:00Z'),
  );

  const mockProduct = new Product(
    'prod-001',
    'Test Product',
    'SKU-001',
    99.99,
    null,
    null,
    new Date('2026-01-01T00:00:00Z'),
    new Date('2026-04-01T00:00:00Z'),
  );

  beforeEach(async () => {
    const mockRepository: jest.Mocked<InventoryRepositoryPort> = {
      findByProductAndVariant: jest.fn(),
      upsert: jest.fn(),
      findById: jest.fn(),
      findMany: jest.fn(),
    };

    const mockProductRepository: jest.Mocked<ProductRepositoryPort> = {
      findById: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [
        {
          provide: INVENTORY_REPOSITORY_TOKEN,
          useValue: mockRepository,
        },
        {
          provide: PRODUCT_REPOSITORY_TOKEN,
          useValue: mockProductRepository,
        },
      ],
    }).compile();

    controller = module.get<InventoryController>(InventoryController);
    repository = module.get(INVENTORY_REPOSITORY_TOKEN);
    productRepository = module.get(PRODUCT_REPOSITORY_TOKEN);
  });

  describe('listInventory', () => {
    it('should return paginated inventory items with product name and SKU', async () => {
      repository.findMany.mockResolvedValue({ items: [mockItem], total: 1 });
      productRepository.findById.mockResolvedValue(mockProduct);

      const result = await controller.listInventory({ limit: 20, offset: 0 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(result.items[0].id).toBe('inv-001');
      expect(result.items[0].updatedAt).toBe('2026-04-01T00:00:00.000Z');
      expect(result.items[0].productName).toBe('Test Product');
      expect(result.items[0].productSku).toBe('SKU-001');
    });

    it('should return null productName and productSku when product not found', async () => {
      repository.findMany.mockResolvedValue({ items: [mockItem], total: 1 });
      productRepository.findById.mockResolvedValue(null);

      const result = await controller.listInventory({ limit: 20, offset: 0 });

      expect(result.items[0].productName).toBeNull();
      expect(result.items[0].productSku).toBeNull();
    });

    it('should pass filters to repository', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0 });

      await controller.listInventory({
        productId: 'prod-001',
        productVariantId: 'var-001',
        locationId: 'loc-001',
        limit: 10,
        offset: 5,
      });

      expect(repository.findMany).toHaveBeenCalledWith(
        { productId: 'prod-001', productVariantId: 'var-001', locationId: 'loc-001' },
        { limit: 10, offset: 5 },
      );
    });

    it('should return empty list when no items match', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0 });

      const result = await controller.listInventory({ limit: 20, offset: 0 });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('getInventoryItem', () => {
    it('should return inventory item with product name and SKU when found', async () => {
      repository.findById.mockResolvedValue(mockItem);
      productRepository.findById.mockResolvedValue(mockProduct);

      const result = await controller.getInventoryItem('inv-001');

      expect(result.id).toBe('inv-001');
      expect(result.productId).toBe('prod-001');
      expect(result.availableQuantity).toBe(50);
      expect(result.reservedQuantity).toBe(5);
      expect(result.productName).toBe('Test Product');
      expect(result.productSku).toBe('SKU-001');
    });

    it('should throw NotFoundException when item not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(controller.getInventoryItem('inv-999')).rejects.toThrow(NotFoundException);
    });
  });
});
