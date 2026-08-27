/**
 * Stock At Risk Read Service unit tests (#1983)
 */
import { StockAtRiskReadService } from '../stock-at-risk-read.service';
import type { OfferMappingRepositoryPort } from '../../../domain/ports/offer-mapping-repository.port';
import type { ShopProductMappingRepositoryPort } from '../../../domain/ports/shop-product-mapping-repository.port';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IInventoryQueryService } from '@openlinker/core/inventory';

describe('StockAtRiskReadService', () => {
  let offerRepo: jest.Mocked<OfferMappingRepositoryPort>;
  let shopRepo: jest.Mocked<ShopProductMappingRepositoryPort>;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let inventoryQueryService: jest.Mocked<IInventoryQueryService>;
  let service: StockAtRiskReadService;

  beforeEach(() => {
    offerRepo = {
      findById: jest.fn(),
      findMany: jest.fn(),
      findMappingPage: jest.fn(),
      countByConnectionAndVariants: jest.fn(),
      countByLifecycle: jest.fn(),
      countListedVariantsByProducts: jest.fn(),
      findStaleMappedVariants: jest.fn(),
      findRecentlyListedVariantIds: jest.fn().mockResolvedValue([]),
    };
    shopRepo = {
      countByConnectionAndVariants: jest.fn(),
      countListedVariantsByProducts: jest.fn(),
      findRecentlyListedVariantIds: jest.fn().mockResolvedValue([]),
    };
    integrationsService = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
      listCapabilityAdapters: jest.fn().mockResolvedValue([]),
    };
    inventoryQueryService = {
      listInventoryItems: jest.fn(),
      getAvailabilityByVariantIds: jest.fn().mockResolvedValue([]),
      getProductStockAggregates: jest.fn(),
    };
    service = new StockAtRiskReadService(
      offerRepo,
      shopRepo,
      integrationsService,
      inventoryQueryService
    );
  });

  function connectionWithBuffer(connectionId: string, buffer: number | undefined): void {
    connectionWithPolicy(connectionId, buffer, undefined);
  }

  function connectionWithPolicy(
    connectionId: string,
    buffer: number | undefined,
    zeroThreshold: number | undefined
  ): void {
    integrationsService.listCapabilityAdapters.mockImplementation(({ capability }) =>
      Promise.resolve(
        capability === 'OfferManager'
          ? [
              {
                connectionId,
                connection: {
                  config: { stockSafetyBuffer: buffer, stockZeroThreshold: zeroThreshold },
                } as never,
                adapter: {} as never,
                metadata: {} as never,
              },
            ]
          : []
      )
    );
  }

  it('should still scan a connection with no configured stock safety buffer', async () => {
    connectionWithBuffer('conn-a', undefined);
    offerRepo.findRecentlyListedVariantIds.mockResolvedValue([
      { variantId: 'v1', productId: 'p1', latestMappedAt: new Date('2026-01-01T00:00:00Z') },
    ]);
    inventoryQueryService.getAvailabilityByVariantIds.mockResolvedValue([
      { productVariantId: 'v1', totalAvailable: 50, locationCount: 1 },
    ]);

    const result = await service.findStockAtRisk(20);

    expect(offerRepo.findRecentlyListedVariantIds).toHaveBeenCalled();
    expect(result).toEqual({ items: [], totalCount: 0 });
  });

  it('should report zero master stock on a connection with no configured buffer', async () => {
    connectionWithBuffer('conn-a', undefined);
    offerRepo.findRecentlyListedVariantIds.mockResolvedValue([
      { variantId: 'v1', productId: 'p1', latestMappedAt: new Date('2026-01-01T00:00:00Z') },
    ]);
    inventoryQueryService.getAvailabilityByVariantIds.mockResolvedValue([
      { productVariantId: 'v1', totalAvailable: 0, locationCount: 1 },
    ]);

    const result = await service.findStockAtRisk(20);

    expect(result.totalCount).toBe(1);
    expect(result.items).toEqual([
      {
        variantId: 'v1',
        productId: 'p1',
        connectionId: 'conn-a',
        masterStock: 0,
        stockSafetyBuffer: 0,
        stockZeroThreshold: 0,
      },
    ]);
  });

  it('should report a variant the zero threshold silenced, not only the buffer (#2610)', async () => {
    // The threshold is a second way to publish nothing. Leaving it out made
    // this aggregate under-report exactly the lines the threshold had hidden.
    connectionWithPolicy('conn-a', 0, 5);
    offerRepo.findRecentlyListedVariantIds.mockResolvedValue([
      { variantId: 'v1', productId: 'p1', latestMappedAt: new Date('2026-01-01T00:00:00Z') },
    ]);
    inventoryQueryService.getAvailabilityByVariantIds.mockResolvedValue([
      { productVariantId: 'v1', totalAvailable: 3, locationCount: 1 },
    ]);

    const result = await service.findStockAtRisk(20);

    expect(result.totalCount).toBe(1);
    expect(result.items[0]?.stockZeroThreshold).toBe(5);
    expect(result.items[0]?.masterStock).toBe(3);
  });

  it('should report a variant at or below the buffer threshold', async () => {
    connectionWithBuffer('conn-a', 5);
    offerRepo.findRecentlyListedVariantIds.mockResolvedValue([
      { variantId: 'v1', productId: 'p1', latestMappedAt: new Date('2026-01-01T00:00:00Z') },
    ]);
    inventoryQueryService.getAvailabilityByVariantIds.mockResolvedValue([
      { productVariantId: 'v1', totalAvailable: 5, locationCount: 1 },
    ]);

    const result = await service.findStockAtRisk(20);

    expect(result.totalCount).toBe(1);
    expect(result.items).toEqual([
      {
        variantId: 'v1',
        productId: 'p1',
        connectionId: 'conn-a',
        masterStock: 5,
        stockSafetyBuffer: 5,
        stockZeroThreshold: 0,
      },
    ]);
  });

  it('should not report a variant comfortably above the buffer threshold', async () => {
    connectionWithBuffer('conn-a', 5);
    offerRepo.findRecentlyListedVariantIds.mockResolvedValue([
      { variantId: 'v1', productId: 'p1', latestMappedAt: new Date('2026-01-01T00:00:00Z') },
    ]);
    inventoryQueryService.getAvailabilityByVariantIds.mockResolvedValue([
      { productVariantId: 'v1', totalAvailable: 50, locationCount: 1 },
    ]);

    const result = await service.findStockAtRisk(20);

    expect(result).toEqual({ items: [], totalCount: 0 });
  });
});
