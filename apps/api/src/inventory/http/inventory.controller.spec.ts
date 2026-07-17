/**
 * Inventory Controller Unit Tests
 *
 * Focuses on HTTP-shape concerns: pagination echo, date serialisation, and
 * flattening of the InventoryItemView into the response DTO. Composition
 * correctness (dedup, null product fallback across a list) is covered in
 * the service spec.
 *
 * @module apps/api/src/inventory/http
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { InventoryController } from './inventory.controller';
import {
  INVENTORY_QUERY_SERVICE_TOKEN,
  InventoryItemEntity as InventoryItem,
} from '@openlinker/core/inventory';
import type { IInventoryQueryService, InventoryItemView } from '@openlinker/core/inventory';

describe('InventoryController', () => {
  let controller: InventoryController;
  let queryService: jest.Mocked<IInventoryQueryService>;

  const itemA = new InventoryItem(
    'inv-a',
    'prod-1',
    'var-a',
    50,
    5,
    null,
    new Date('2026-04-01T00:00:00Z')
  );
  const itemB = new InventoryItem(
    'inv-b',
    'prod-2',
    null,
    10,
    0,
    null,
    new Date('2026-04-02T00:00:00Z')
  );

  const viewWithProduct: InventoryItemView = {
    item: itemA,
    product: {
      name: 'Product One',
      sku: 'SKU-1',
      coverImageUrl: 'https://shop.test/img/1/cover.jpg',
    },
  };
  const viewWithoutProduct: InventoryItemView = {
    item: itemB,
    product: null,
  };

  beforeEach(async () => {
    const mockQueryService: jest.Mocked<IInventoryQueryService> = {
      listInventoryItems: jest.fn(),
      getAvailabilityByVariantIds: jest.fn(),
      getProductStockAggregates: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [
        {
          provide: INVENTORY_QUERY_SERVICE_TOKEN,
          useValue: mockQueryService,
        },
      ],
    }).compile();

    controller = module.get<InventoryController>(InventoryController);
    queryService = module.get(INVENTORY_QUERY_SERVICE_TOKEN);
  });

  describe('listInventory', () => {
    it('flattens the view into the DTO with pagination echo and ISO-string updatedAt', async () => {
      queryService.listInventoryItems.mockResolvedValue({
        items: [viewWithProduct, viewWithoutProduct],
        total: 2,
      });

      const result = await controller.listInventory({ limit: 20, offset: 0 });

      expect(result.total).toBe(2);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(result.items).toHaveLength(2);

      expect(result.items[0]).toEqual({
        id: 'inv-a',
        productId: 'prod-1',
        productVariantId: 'var-a',
        availableQuantity: 50,
        reservedQuantity: 5,
        locationId: null,
        updatedAt: '2026-04-01T00:00:00.000Z',
        productName: 'Product One',
        productSku: 'SKU-1',
        productImageUrl: 'https://shop.test/img/1/cover.jpg',
      });
    });

    it('emits null productName/Sku/ImageUrl when the view has no product', async () => {
      queryService.listInventoryItems.mockResolvedValue({
        items: [viewWithoutProduct],
        total: 1,
      });

      const result = await controller.listInventory({ limit: 20, offset: 0 });

      expect(result.items[0].productName).toBeNull();
      expect(result.items[0].productSku).toBeNull();
      expect(result.items[0].productImageUrl).toBeNull();
    });

    it('passes filters and pagination into the query service', async () => {
      queryService.listInventoryItems.mockResolvedValue({ items: [], total: 0 });

      await controller.listInventory({
        productId: 'prod-1',
        productVariantId: 'var-a',
        locationId: 'loc-1',
        limit: 10,
        offset: 5,
      });

      expect(queryService.listInventoryItems).toHaveBeenCalledWith(
        { productId: 'prod-1', productVariantId: 'var-a', locationId: 'loc-1' },
        { limit: 10, offset: 5 }
      );
    });
  });

  describe('getAvailability (#792)', () => {
    it('passes the parsed variantIds through to the service and wraps the response in items[]', async () => {
      queryService.getAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'var-a', totalAvailable: 5, locationCount: 1 },
        { productVariantId: 'var-b', totalAvailable: 0, locationCount: 0 },
      ]);

      const result = await controller.getAvailability({
        productVariantIds: ['var-a', 'var-b'],
      });

      expect(queryService.getAvailabilityByVariantIds).toHaveBeenCalledWith(['var-a', 'var-b']);
      expect(result).toEqual({
        items: [
          { productVariantId: 'var-a', totalAvailable: 5, locationCount: 1 },
          { productVariantId: 'var-b', totalAvailable: 0, locationCount: 0 },
        ],
      });
    });

    it('returns an empty items[] when the service returns no rows', async () => {
      // Service-level zero-fill guarantees an entry per requested ID, but a
      // direct caller passing a single-known-empty input still gets the
      // empty-envelope shape.
      queryService.getAvailabilityByVariantIds.mockResolvedValue([]);

      const result = await controller.getAvailability({ productVariantIds: ['var-x'] });

      expect(result).toEqual({ items: [] });
    });
  });
});
