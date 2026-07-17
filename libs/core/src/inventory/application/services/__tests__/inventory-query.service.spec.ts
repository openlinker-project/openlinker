/**
 * Inventory Query Service Tests
 *
 * Unit tests for InventoryQueryService. Covers composition of inventory items
 * with master-catalog product details, product-lookup deduplication, null
 * handling, and order preservation.
 *
 * @module libs/core/src/inventory/application/services/__tests__
 */

import { InventoryQueryService } from '../inventory-query.service';
import { InventoryItem } from '../../../domain/entities/inventory-item.entity';
import type { InventoryRepositoryPort } from '../../../domain/ports/inventory-repository.port';
import type { IProductsService, Product } from '@openlinker/core/products';

// Only the products-service method the SUT actually calls — keeps the
// mock surface tight per #718 review.
type ProductsServiceMock = Pick<IProductsService, 'getProductsByIds'>;

describe('InventoryQueryService', () => {
  let service: InventoryQueryService;
  let inventoryRepository: jest.Mocked<InventoryRepositoryPort>;
  let productsService: jest.Mocked<ProductsServiceMock>;

  const itemA = new InventoryItem(
    'inv-a',
    'prod-1',
    'var-a',
    50,
    5,
    null,
    new Date('2026-04-01T00:00:00Z'),
  );
  const itemB = new InventoryItem(
    'inv-b',
    'prod-1',
    null,
    10,
    0,
    null,
    new Date('2026-04-02T00:00:00Z'),
  );
  const itemC = new InventoryItem(
    'inv-c',
    'prod-2',
    null,
    3,
    1,
    null,
    new Date('2026-04-03T00:00:00Z'),
  );

  const product1: Product = {
    id: 'prod-1',
    name: 'Product One',
    sku: 'SKU-1',
    price: 99.99,
    currency: null,
    description: null,
    images: ['https://shop.test/img/1/cover.jpg', 'https://shop.test/img/1/alt.jpg'],
  };
  const product2: Product = {
    id: 'prod-2',
    name: 'Product Two',
    sku: null,
    price: null,
    currency: null,
    description: null,
    images: null,
  };

  beforeEach(() => {
    inventoryRepository = {
      findByProductAndVariant: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
      findAvailabilityByVariantIds: jest.fn(),
      findStockAggregatesByProductIds: jest.fn(),
      markStaleExceptVariants: jest.fn(),
    };

    productsService = {
      getProductsByIds: jest.fn(),
    };

    service = new InventoryQueryService(
      inventoryRepository,
      productsService as unknown as IProductsService,
    );
  });

  describe('listInventoryItems', () => {
    it('composes product details onto each item', async () => {
      inventoryRepository.findMany.mockResolvedValue({ items: [itemA], total: 1 });
      productsService.getProductsByIds.mockResolvedValue([product1]);

      const result = await service.listInventoryItems({}, { limit: 20, offset: 0 });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].item).toBe(itemA);
      expect(result.items[0].product).toEqual({
        name: 'Product One',
        sku: 'SKU-1',
        coverImageUrl: 'https://shop.test/img/1/cover.jpg',
      });
    });

    it('deduplicates product lookups via getProductsByIds when items share a productId', async () => {
      inventoryRepository.findMany.mockResolvedValue({ items: [itemA, itemB], total: 2 });
      productsService.getProductsByIds.mockResolvedValue([product1]);

      await service.listInventoryItems({}, { limit: 20, offset: 0 });

      expect(productsService.getProductsByIds).toHaveBeenCalledTimes(1);
      expect(productsService.getProductsByIds).toHaveBeenCalledWith(['prod-1']);
    });

    it('returns product: null on each view when the product lookup returns []', async () => {
      inventoryRepository.findMany.mockResolvedValue({ items: [itemA, itemB], total: 2 });
      productsService.getProductsByIds.mockResolvedValue([]);

      const result = await service.listInventoryItems({}, { limit: 20, offset: 0 });

      expect(result.items).toHaveLength(2);
      expect(result.items[0].product).toBeNull();
      expect(result.items[1].product).toBeNull();
    });

    it('passes filters and pagination through to the repository unchanged', async () => {
      inventoryRepository.findMany.mockResolvedValue({ items: [], total: 0 });
      productsService.getProductsByIds.mockResolvedValue([]);

      await service.listInventoryItems(
        { productId: 'prod-1', productVariantId: 'var-a', locationId: 'loc-1' },
        { limit: 10, offset: 5 },
      );

      expect(inventoryRepository.findMany).toHaveBeenCalledWith(
        { productId: 'prod-1', productVariantId: 'var-a', locationId: 'loc-1' },
        { limit: 10, offset: 5 },
      );
    });

    it('returns an empty view when the repository returns no items', async () => {
      inventoryRepository.findMany.mockResolvedValue({ items: [], total: 0 });
      productsService.getProductsByIds.mockResolvedValue([]);

      const result = await service.listInventoryItems({}, { limit: 20, offset: 0 });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      // getProductsByIds short-circuits internally on [], but the call is fine either way.
    });

    it('preserves repository.findMany ordering after composition', async () => {
      // Repo returns prod-2 first, prod-1 second; after dedup via Set the
      // composed output must still reflect the input order.
      inventoryRepository.findMany.mockResolvedValue({
        items: [itemC, itemA, itemB],
        total: 3,
      });
      productsService.getProductsByIds.mockResolvedValue([product1, product2]);

      const result = await service.listInventoryItems({}, { limit: 20, offset: 0 });

      expect(result.items.map((v) => v.item.id)).toEqual(['inv-c', 'inv-a', 'inv-b']);
    });
  });

  describe('getAvailabilityByVariantIds (#792)', () => {
    it('returns an empty array on empty input without hitting the repository', async () => {
      const result = await service.getAvailabilityByVariantIds([]);

      expect(result).toEqual([]);
      // Hook layer short-circuits empty input too, but the service must be
      // robust against direct callers passing []. The repo call is allowed
      // either way (it also short-circuits) — assertion intentionally omitted.
    });

    it('passes through all-found rows unchanged in input order', async () => {
      inventoryRepository.findAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'var-b', totalAvailable: 7, locationCount: 2 },
        { productVariantId: 'var-a', totalAvailable: 3, locationCount: 1 },
      ]);

      const result = await service.getAvailabilityByVariantIds(['var-a', 'var-b']);

      expect(result).toEqual([
        { productVariantId: 'var-a', totalAvailable: 3, locationCount: 1 },
        { productVariantId: 'var-b', totalAvailable: 7, locationCount: 2 },
      ]);
    });

    it('zero-fills variants with no inventory rows so the caller can build a Map directly', async () => {
      inventoryRepository.findAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'var-a', totalAvailable: 5, locationCount: 1 },
      ]);

      const result = await service.getAvailabilityByVariantIds(['var-a', 'var-missing', 'var-also-missing']);

      expect(result).toEqual([
        { productVariantId: 'var-a', totalAvailable: 5, locationCount: 1 },
        { productVariantId: 'var-missing', totalAvailable: 0, locationCount: 0 },
        { productVariantId: 'var-also-missing', totalAvailable: 0, locationCount: 0 },
      ]);
    });

    it('preserves input order when the repo returns rows in a different order', async () => {
      inventoryRepository.findAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'var-z', totalAvailable: 1, locationCount: 1 },
        { productVariantId: 'var-a', totalAvailable: 2, locationCount: 1 },
      ]);

      const result = await service.getAvailabilityByVariantIds(['var-a', 'var-m', 'var-z']);

      expect(result.map((r) => r.productVariantId)).toEqual(['var-a', 'var-m', 'var-z']);
      expect(result[1]).toEqual({ productVariantId: 'var-m', totalAvailable: 0, locationCount: 0 });
    });
  });

  describe('getProductStockAggregates (#1720)', () => {
    it('returns an empty array on empty input without hitting the repository', async () => {
      const result = await service.getProductStockAggregates([]);

      expect(result).toEqual([]);
      expect(inventoryRepository.findStockAggregatesByProductIds).not.toHaveBeenCalled();
    });

    it('delegates to the repository and returns its rows verbatim (no zero-fill)', async () => {
      const rows = [
        {
          productId: 'prod-1',
          totalAvailable: 12,
          totalReserved: 3,
          stockUpdatedAt: new Date('2026-04-01T00:00:00Z'),
        },
      ];
      inventoryRepository.findStockAggregatesByProductIds.mockResolvedValue(rows);

      const result = await service.getProductStockAggregates(['prod-1', 'prod-without-stock']);

      expect(inventoryRepository.findStockAggregatesByProductIds).toHaveBeenCalledWith([
        'prod-1',
        'prod-without-stock',
      ]);
      // Products absent from the repo result stay absent - the caller decides
      // whether to zero-fill for display.
      expect(result).toBe(rows);
    });

    it('rejects input exceeding the 200-id cap without hitting the repository', async () => {
      const oversize = Array.from({ length: 201 }, (_, i) => `prod-${String(i)}`);

      await expect(service.getProductStockAggregates(oversize)).rejects.toThrow(
        /at most 200 productIds/
      );
      expect(inventoryRepository.findStockAggregatesByProductIds).not.toHaveBeenCalled();
    });
  });
});
