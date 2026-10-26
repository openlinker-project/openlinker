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
import type {
  IInventoryQueryService,
  InventoryItemView,
  VariantStockView,
} from '@openlinker/core/inventory';
import { NotFoundException } from '@nestjs/common';
import {
  StockViewProductNotFoundError,
  StockViewService,
  type ProductStockView,
} from '../application/services/stock-view.service';

describe('InventoryController', () => {
  let controller: InventoryController;
  let queryService: jest.Mocked<IInventoryQueryService>;
  let stockView: jest.Mocked<Pick<StockViewService, 'getVariantStockViews' | 'getProductStockView'>>;

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
      findAvailabilityByVariantIds: jest.fn(),
      findBinCodesByVariantIds: jest.fn(),
      getProductStockAggregates: jest.fn(),
      getStockViewByVariantIds: jest.fn(),
      getDuplicatePositionReport: jest.fn(),
      getProvenanceBackfillStatus: jest.fn(),
      resolveStockOwner: jest.fn(),
      listPublishedReservedByLocation: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [
        {
          provide: INVENTORY_QUERY_SERVICE_TOKEN,
          useValue: mockQueryService,
        },
        {
          provide: StockViewService,
          useValue: {
            getVariantStockViews: jest.fn().mockResolvedValue([]),
            getProductStockView: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<InventoryController>(InventoryController);
    queryService = module.get(INVENTORY_QUERY_SERVICE_TOKEN);
    stockView = module.get(StockViewService);
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
        sourceConnectionId: null,
        isStale: false,
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

  describe('getAvailability (#792, #3621)', () => {
    const stockViewRow = (overrides: Partial<VariantStockView> = {}): VariantStockView => ({
      productVariantId: 'var-a',
      masterAvailable: 5,
      masterReserved: 0,
      availableToPromise: 3,
      provenance: 'computed',
      observedAt: new Date('2026-10-26T10:00:00Z'),
      stalenessMs: 7_200_000,
      olHeldNotReflected: null,
      heldCounted: 2,
      heldRecordedOnly: 1,
      livePositionCount: 1,
      positions: [],
      holds: [],
      isStaleSync: false,
      ...overrides,
    });

    it('should keep the legacy fields and add provenance, freshness and the held split', async () => {
      queryService.getAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'var-a', totalAvailable: 5, locationCount: 1, availableToPromise: 3 },
      ]);
      stockView.getVariantStockViews.mockResolvedValue([stockViewRow()]);

      const result = await controller.getAvailability({ productVariantIds: ['var-a'] });

      expect(queryService.getAvailabilityByVariantIds).toHaveBeenCalledWith(['var-a']);
      expect(stockView.getVariantStockViews).toHaveBeenCalledWith(['var-a']);
      expect(result).toEqual({
        items: [
          {
            productVariantId: 'var-a',
            totalAvailable: 5,
            locationCount: 1,
            availableToPromise: 3,
            provenance: 'computed',
            observedAt: '2026-10-26T10:00:00.000Z',
            stalenessMs: 7_200_000,
            isStaleSync: false,
            olHeldNotReflected: null,
            heldCounted: 2,
            heldRecordedOnly: 1,
            livePositionCount: 1,
          },
        ],
      });
    });

    it('should report an unknown promise as null with null held figures, never 0', async () => {
      queryService.getAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'var-a', totalAvailable: 5, locationCount: 1, availableToPromise: null },
      ]);
      stockView.getVariantStockViews.mockResolvedValue([
        stockViewRow({
          availableToPromise: null,
          provenance: 'unknown',
          heldCounted: null,
          heldRecordedOnly: null,
        }),
      ]);

      const [item] = (await controller.getAvailability({ productVariantIds: ['var-a'] })).items;

      expect(item.availableToPromise).toBeNull();
      expect(item.provenance).toBe('unknown');
      expect(item.heldCounted).toBeNull();
      expect(item.heldRecordedOnly).toBeNull();
      // The raw master sum is unaffected by an unknown promise.
      expect(item.totalAvailable).toBe(5);
    });

    it('should fall back to unknown, not zero, when the stock view has no row for a variant', async () => {
      queryService.getAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'var-a', totalAvailable: 0, locationCount: 0, availableToPromise: 0 },
      ]);
      stockView.getVariantStockViews.mockResolvedValue([]);

      const [item] = (await controller.getAvailability({ productVariantIds: ['var-a'] })).items;

      expect(item.availableToPromise).toBeNull();
      expect(item.provenance).toBe('unknown');
    });

    it('returns an empty items[] when the service returns no rows', async () => {
      queryService.getAvailabilityByVariantIds.mockResolvedValue([]);

      const result = await controller.getAvailability({ productVariantIds: ['var-x'] });

      expect(result).toEqual({ items: [] });
    });
  });

  describe('getStockView (#3621)', () => {
    it('should answer 404 for an unknown product', async () => {
      stockView.getProductStockView.mockRejectedValue(new StockViewProductNotFoundError('nope'));

      await expect(controller.getStockView({ productId: 'nope' })).rejects.toThrow(
        NotFoundException
      );
    });

    it('should serialise dates to ISO strings and keep nulls as null', async () => {
      const view: ProductStockView = {
        productId: 'prod-1',
        productName: 'Product One',
        productSku: 'SKU-1',
        staleSyncThreshold: { hours: 6, ms: 21_600_000, source: 'default' },
        channelsStatus: 'ok',
        variants: [
          {
            productVariantId: 'var-a',
            sku: 'SKU-1-S',
            attributes: { size: 'S' },
            masterAvailable: 5,
            masterReserved: 1,
            availableToPromise: null,
            provenance: 'unknown',
            observedAt: new Date('2026-10-26T10:00:00Z'),
            stalenessMs: 1,
            olHeldNotReflected: null,
            heldCounted: null,
            heldRecordedOnly: null,
            livePositionCount: 1,
            isStaleSync: false,
            positions: [
              {
                locationId: 'loc-1',
                locationName: 'MAIN',
                sourceConnectionId: 'conn-1',
                sourceConnectionName: 'PrestaShop',
                isStale: false,
                availableQuantity: 5,
                reservedQuantity: 1,
                updatedAt: new Date('2026-10-26T10:00:00Z'),
              },
            ],
            holds: null,
            channels: [
              {
                connectionId: 'conn-2',
                connectionName: 'Allegro',
                platformType: 'allegro',
                rule: { stockSafetyBuffer: 1, stockZeroThreshold: 0 },
                willPublish: { quantity: null, provenance: 'unknown' },
                channelShows: { quantity: null, observedAt: null },
              },
            ],
          },
        ],
      };
      stockView.getProductStockView.mockResolvedValue(view);

      const result = await controller.getStockView({ productId: 'prod-1' });

      expect(result.variants[0].observedAt).toBe('2026-10-26T10:00:00.000Z');
      expect(result.variants[0].positions[0].updatedAt).toBe('2026-10-26T10:00:00.000Z');
      expect(result.variants[0].holds).toBeNull();
      expect(result.variants[0].channels[0].willPublish).toEqual({
        quantity: null,
        provenance: 'unknown',
      });
      expect(result.variants[0].channels[0].channelShows).toEqual({
        quantity: null,
        observedAt: null,
      });
      expect(result.staleSyncThreshold).toEqual({ hours: 6, ms: 21_600_000, source: 'default' });
    });
  });

  describe('getDuplicatePositions (#2319)', () => {
    it('forwards maxGroups and serialises row dates to ISO strings', async () => {
      const updatedAt = new Date('2026-05-02T10:00:00Z');
      queryService.getDuplicatePositionReport.mockResolvedValue({
        groupCount: 1,
        rowCount: 2,
        excessRowCount: 1,
        truncated: false,
        groups: [
          {
            productId: 'prod-1',
            productVariantId: null,
            locationId: null,
            sourceConnectionId: null,
            rowCount: 2,
            liveRowCount: 1,
            productName: 'Merino Wool Beanie',
            sku: 'BEA-MER-001',
            connectionName: null,
            locationName: null,
            rows: [
              {
                id: 'inv-1',
                availableQuantity: 7,
                reservedQuantity: 0,
                isStale: false,
                updatedAt,
              },
              {
                id: 'inv-2',
                availableQuantity: 3,
                reservedQuantity: 1,
                isStale: true,
                updatedAt,
              },
            ],
          },
        ],
      });

      const result = await controller.getDuplicatePositions({ maxGroups: 50 });

      expect(queryService.getDuplicatePositionReport).toHaveBeenCalledWith(50);
      expect(result.groupCount).toBe(1);
      expect(result.excessRowCount).toBe(1);
      expect(result.groups[0].liveRowCount).toBe(1);
      // Enrichment (#3239) is passed through the transport mapping verbatim —
      // this controller never resolves names itself.
      expect(result.groups[0].productName).toBe('Merino Wool Beanie');
      expect(result.groups[0].sku).toBe('BEA-MER-001');
      expect(result.groups[0].connectionName).toBeNull();
      expect(result.groups[0].locationName).toBeNull();
      expect(result.groups[0].rows[0].updatedAt).toBe(updatedAt.toISOString());
      // Stale rows reach the transport layer — the report is deliberately
      // stricter than the availability read.
      expect(result.groups[0].rows[1].isStale).toBe(true);
      expect(typeof result.generatedAt).toBe('string');
    });

    it('passes an absent maxGroups straight through so the service default applies', async () => {
      queryService.getDuplicatePositionReport.mockResolvedValue({
        groupCount: 0,
        rowCount: 0,
        excessRowCount: 0,
        groups: [],
        truncated: false,
      });

      const result = await controller.getDuplicatePositions({});

      expect(queryService.getDuplicatePositionReport).toHaveBeenCalledWith(undefined);
      // The clean-table answer an operator checks before running #2325.
      expect(result.groupCount).toBe(0);
      expect(result.groups).toEqual([]);
      expect(result.truncated).toBe(false);
    });
  });

  describe('getProvenanceBackfillStatus (#3240)', () => {
    it('passes the service answer through verbatim when the backfill is complete', async () => {
      queryService.getProvenanceBackfillStatus.mockResolvedValue({
        remainingNull: 0,
        completed: true,
        latchedAt: '2026-08-01T00:00:00.000Z',
      });

      const result = await controller.getProvenanceBackfillStatus();

      expect(queryService.getProvenanceBackfillStatus).toHaveBeenCalledWith();
      expect(result).toEqual({
        remainingNull: 0,
        completed: true,
        latchedAt: '2026-08-01T00:00:00.000Z',
      });
    });

    it('reports the count and false when rows are still missing provenance', async () => {
      queryService.getProvenanceBackfillStatus.mockResolvedValue({
        remainingNull: 37,
        completed: false,
        latchedAt: null,
      });

      const result = await controller.getProvenanceBackfillStatus();

      expect(result).toEqual({ remainingNull: 37, completed: false, latchedAt: null });
    });
  });
});
