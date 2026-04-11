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

describe('InventoryController', () => {
  let controller: InventoryController;
  let repository: jest.Mocked<InventoryRepositoryPort>;

  const mockItem = new InventoryItem(
    'inv-001',
    'prod-001',
    'var-001',
    50,
    5,
    null,
    new Date('2026-04-01T00:00:00Z'),
  );

  beforeEach(async () => {
    const mockRepository: jest.Mocked<InventoryRepositoryPort> = {
      findByProductAndVariant: jest.fn(),
      upsert: jest.fn(),
      findById: jest.fn(),
      findMany: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [
        {
          provide: INVENTORY_REPOSITORY_TOKEN,
          useValue: mockRepository,
        },
      ],
    }).compile();

    controller = module.get<InventoryController>(InventoryController);
    repository = module.get(INVENTORY_REPOSITORY_TOKEN);
  });

  describe('listInventory', () => {
    it('should return paginated inventory items', async () => {
      repository.findMany.mockResolvedValue({ items: [mockItem], total: 1 });

      const result = await controller.listInventory({ limit: 20, offset: 0 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(result.items[0].id).toBe('inv-001');
      expect(result.items[0].updatedAt).toBe('2026-04-01T00:00:00.000Z');
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
    it('should return inventory item when found', async () => {
      repository.findById.mockResolvedValue(mockItem);

      const result = await controller.getInventoryItem('inv-001');

      expect(result.id).toBe('inv-001');
      expect(result.productId).toBe('prod-001');
      expect(result.availableQuantity).toBe(50);
      expect(result.reservedQuantity).toBe(5);
    });

    it('should throw NotFoundException when item not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(controller.getInventoryItem('inv-999')).rejects.toThrow(NotFoundException);
    });
  });
});
