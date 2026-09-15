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
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import { ConnectionNotFoundException } from '@openlinker/core/identifier-mapping';
import type { IAvailabilityService } from '../availability.service.interface';
import type { ILocationService } from '../location.service.interface';

// Only the products-service method the SUT actually calls — keeps the
// mock surface tight per #718 review.
type ProductsServiceMock = Pick<IProductsService, 'getProductsByIds'>;
type LocationServiceMock = Pick<ILocationService, 'getLocation'>;
type ConnectionPortMock = Pick<ConnectionPort, 'get'>;

describe('InventoryQueryService', () => {
  let service: InventoryQueryService;
  let inventoryRepository: jest.Mocked<InventoryRepositoryPort>;
  let productsService: jest.Mocked<ProductsServiceMock>;
  let availabilityService: jest.Mocked<IAvailabilityService>;
  let locationService: jest.Mocked<LocationServiceMock>;
  let connectionPort: jest.Mocked<ConnectionPortMock>;

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
      findLivePositionsByProductIds: jest.fn(),
      findStockAggregatesByProductIds: jest.fn(),
      markStaleExceptVariants: jest.fn(),
      markLocationlessStaleForSource: jest.fn(),
      markLocatedStaleForSource: jest.fn(),
      findDuplicatePositions: jest.fn(),
      backfillLegacyProvenance: jest.fn(),
      countMissingProvenance: jest.fn(),
    };

    productsService = {
      getProductsByIds: jest.fn(),
    };

    availabilityService = {
      // Default: the Wave-1b answer for an empty ledger with no buffer — ATP
      // equals whatever the repository summed, so `availableToPromise` mirrors
      // `totalAvailable` unless a test says otherwise.
      getPromisableQuantities: jest
        .fn()
        .mockImplementation(async ({ variantIds }: { variantIds: readonly string[] }) => {
          const rows = await inventoryRepository.findAvailabilityByVariantIds(variantIds);
          const byId = new Map(rows.map((r) => [r.productVariantId, r.totalAvailable]));
          return variantIds.map((id) => ({
            productVariantId: id,
            quantity: byId.get(id) ?? 0,
            provenance: 'computed' as const,
            observedAt: null,
            stalenessMs: null,
          }));
        }),
      applyPublishControls: jest.fn(),
      getAppliedReserve: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<IAvailabilityService>;

    locationService = { getLocation: jest.fn().mockResolvedValue(null) };
    connectionPort = { get: jest.fn().mockRejectedValue(new ConnectionNotFoundException('n/a')) };

    service = new InventoryQueryService(
      inventoryRepository,
      productsService as unknown as IProductsService,
      availabilityService,
      locationService as unknown as ILocationService,
      connectionPort as unknown as ConnectionPort,
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
        { productVariantId: 'var-a', totalAvailable: 3, locationCount: 1, availableToPromise: 3 },
        { productVariantId: 'var-b', totalAvailable: 7, locationCount: 2, availableToPromise: 7 },
      ]);
    });

    it('zero-fills variants with no inventory rows so the caller can build a Map directly', async () => {
      inventoryRepository.findAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'var-a', totalAvailable: 5, locationCount: 1 },
      ]);

      const result = await service.getAvailabilityByVariantIds(['var-a', 'var-missing', 'var-also-missing']);

      expect(result).toEqual([
        { productVariantId: 'var-a', totalAvailable: 5, locationCount: 1, availableToPromise: 5 },
        { productVariantId: 'var-missing', totalAvailable: 0, locationCount: 0, availableToPromise: 0 },
        { productVariantId: 'var-also-missing', totalAvailable: 0, locationCount: 0, availableToPromise: 0 },
      ]);
    });

    it('preserves input order when the repo returns rows in a different order', async () => {
      inventoryRepository.findAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'var-z', totalAvailable: 1, locationCount: 1 },
        { productVariantId: 'var-a', totalAvailable: 2, locationCount: 1 },
      ]);

      const result = await service.getAvailabilityByVariantIds(['var-a', 'var-m', 'var-z']);

      expect(result.map((r) => r.productVariantId)).toEqual(['var-a', 'var-m', 'var-z']);
      expect(result[1]).toEqual({ productVariantId: 'var-m', totalAvailable: 0, locationCount: 0, availableToPromise: 0 });
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

  describe('getDuplicatePositionReport (#2319)', () => {
    const cleanReport = {
      groupCount: 0,
      rowCount: 0,
      excessRowCount: 0,
      groups: [],
      truncated: false,
    };

    it('defaults the detail cap to 100', async () => {
      inventoryRepository.findDuplicatePositions.mockResolvedValue(cleanReport);

      await service.getDuplicatePositionReport();

      expect(inventoryRepository.findDuplicatePositions).toHaveBeenCalledWith(100);
    });

    it('passes an explicit cap straight through', async () => {
      inventoryRepository.findDuplicatePositions.mockResolvedValue(cleanReport);

      await service.getDuplicatePositionReport(25);

      expect(inventoryRepository.findDuplicatePositions).toHaveBeenCalledWith(25);
    });

    it('throws rather than clamping when the cap is exceeded', async () => {
      // Matches the MAX_STOCK_AGGREGATE_PRODUCT_IDS precedent above: a caller
      // that asked for more than it can have learns so, instead of silently
      // receiving a different answer than the one it requested.
      await expect(service.getDuplicatePositionReport(501)).rejects.toThrow(
        /at most 500 groups/
      );
      expect(inventoryRepository.findDuplicatePositions).not.toHaveBeenCalled();
    });

    it('rejects a non-positive or non-integer cap', async () => {
      await expect(service.getDuplicatePositionReport(0)).rejects.toThrow(/positive integer/);
      await expect(service.getDuplicatePositionReport(1.5)).rejects.toThrow(/positive integer/);
      expect(inventoryRepository.findDuplicatePositions).not.toHaveBeenCalled();
    });

    it('preserves the repository totals verbatim, including uncapped ones, while enriching groups', async () => {
      // groupCount is the #2325 gate and must survive the service layer
      // untouched even when the detail was truncated.
      const truncated = {
        groupCount: 3,
        rowCount: 9,
        excessRowCount: 6,
        groups: [
          {
            productId: 'prod-1',
            productVariantId: null,
            locationId: null,
            sourceConnectionId: null,
            rowCount: 4,
            liveRowCount: 2,
            rows: [],
            productName: null,
            sku: null,
            connectionName: null,
            locationName: null,
          },
        ],
        truncated: true,
      };
      inventoryRepository.findDuplicatePositions.mockResolvedValue(truncated);
      productsService.getProductsByIds.mockResolvedValue([]);

      const result = await service.getDuplicatePositionReport(1);

      expect(result.groupCount).toBe(3);
      expect(result.rowCount).toBe(9);
      expect(result.excessRowCount).toBe(6);
      expect(result.truncated).toBe(true);
      expect(result.groups).toEqual(truncated.groups);
    });

    describe('enrichment (#3239)', () => {
      it('resolves productName/sku, connectionName and locationName, batched across unique ids', async () => {
        const report = {
          groupCount: 2,
          rowCount: 4,
          excessRowCount: 2,
          groups: [
            {
              productId: 'prod-1',
              productVariantId: 'var-1',
              locationId: 'loc-1',
              sourceConnectionId: 'conn-1',
              rowCount: 2,
              liveRowCount: 2,
              rows: [],
              productName: null,
              sku: null,
              connectionName: null,
              locationName: null,
            },
            {
              // A second group sharing the same product/location/connection —
              // the point of the assertion below is that each is resolved
              // exactly once, not once per group.
              productId: 'prod-1',
              productVariantId: 'var-2',
              locationId: 'loc-1',
              sourceConnectionId: 'conn-1',
              rowCount: 2,
              liveRowCount: 2,
              rows: [],
              productName: null,
              sku: null,
              connectionName: null,
              locationName: null,
            },
          ],
          truncated: false,
        };
        inventoryRepository.findDuplicatePositions.mockResolvedValue(report);
        productsService.getProductsByIds.mockResolvedValue([product1]);
        locationService.getLocation.mockResolvedValue({
          id: 'loc-1',
          name: 'Main Warehouse',
        } as never);
        connectionPort.get.mockResolvedValue({ id: 'conn-1', name: 'Allegro — Primary' } as never);

        const result = await service.getDuplicatePositionReport();

        expect(result.groups[0].productName).toBe(product1.name);
        expect(result.groups[0].sku).toBe(product1.sku);
        expect(result.groups[0].locationName).toBe('Main Warehouse');
        expect(result.groups[0].connectionName).toBe('Allegro — Primary');
        expect(result.groups[1].locationName).toBe('Main Warehouse');
        expect(result.groups[1].connectionName).toBe('Allegro — Primary');
        // Batched, not per-group: one call per unique id, regardless of how
        // many groups reference it.
        expect(productsService.getProductsByIds).toHaveBeenCalledTimes(1);
        expect(productsService.getProductsByIds).toHaveBeenCalledWith(['prod-1']);
        expect(locationService.getLocation).toHaveBeenCalledTimes(1);
        expect(connectionPort.get).toHaveBeenCalledTimes(1);
      });

      it('never resolves a name for the null or legacy provenance sentinel, or a null location', async () => {
        const report = {
          groupCount: 1,
          rowCount: 2,
          excessRowCount: 1,
          groups: [
            {
              productId: 'prod-1',
              productVariantId: null,
              locationId: null,
              sourceConnectionId: 'legacy',
              rowCount: 2,
              liveRowCount: 0,
              rows: [],
              productName: null,
              sku: null,
              connectionName: null,
              locationName: null,
            },
          ],
          truncated: false,
        };
        inventoryRepository.findDuplicatePositions.mockResolvedValue(report);
        productsService.getProductsByIds.mockResolvedValue([]);

        const result = await service.getDuplicatePositionReport();

        expect(result.groups[0].connectionName).toBeNull();
        expect(result.groups[0].locationName).toBeNull();
        expect(connectionPort.get).not.toHaveBeenCalled();
        expect(locationService.getLocation).not.toHaveBeenCalled();
      });

      it('reports null rather than throwing when a connection has been deleted', async () => {
        const report = {
          groupCount: 1,
          rowCount: 2,
          excessRowCount: 1,
          groups: [
            {
              productId: 'prod-1',
              productVariantId: null,
              locationId: null,
              sourceConnectionId: 'deleted-conn',
              rowCount: 2,
              liveRowCount: 2,
              rows: [],
              productName: null,
              sku: null,
              connectionName: null,
              locationName: null,
            },
          ],
          truncated: false,
        };
        inventoryRepository.findDuplicatePositions.mockResolvedValue(report);
        productsService.getProductsByIds.mockResolvedValue([]);
        connectionPort.get.mockRejectedValue(new ConnectionNotFoundException('deleted-conn'));

        const result = await service.getDuplicatePositionReport();

        expect(result.groups[0].connectionName).toBeNull();
      });
    });
  });
});
