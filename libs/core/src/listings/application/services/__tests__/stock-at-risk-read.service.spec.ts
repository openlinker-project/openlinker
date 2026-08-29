/**
 * Stock At Risk Read Service unit tests (#1983, rewired onto the availability
 * seam by #2323)
 *
 * The predicate under test is now `availableToPromise <= 0` in the
 * destination's `channel` scope. Every "buffer threshold" case below therefore
 * seeds the SEAM with what it would compute on a Wave-1b install
 * (`max(0, masterStock − buffer)`, empty ledger) — which is exactly the number
 * the pre-#2323 service computed inline, so these assertions are the parity
 * check as much as they are unit tests.
 */
import { StockAtRiskReadService } from '../stock-at-risk-read.service';
import type { OfferMappingRepositoryPort } from '../../../domain/ports/offer-mapping-repository.port';
import type { ShopProductMappingRepositoryPort } from '../../../domain/ports/shop-product-mapping-repository.port';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IAvailabilityService, IInventoryQueryService } from '@openlinker/core/inventory';

describe('StockAtRiskReadService', () => {
  let offerRepo: jest.Mocked<OfferMappingRepositoryPort>;
  let shopRepo: jest.Mocked<ShopProductMappingRepositoryPort>;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let inventoryQueryService: jest.Mocked<IInventoryQueryService>;
  let availabilityService: jest.Mocked<IAvailabilityService>;
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
    } as unknown as jest.Mocked<OfferMappingRepositoryPort>;
    shopRepo = {
      countByConnectionAndVariants: jest.fn(),
      countListedVariantsByProducts: jest.fn(),
      findRecentlyListedVariantIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<ShopProductMappingRepositoryPort>;
    integrationsService = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
      listCapabilityAdapters: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IIntegrationsService>;
    inventoryQueryService = {
      listInventoryItems: jest.fn(),
      getAvailabilityByVariantIds: jest.fn().mockResolvedValue([]),
      getProductStockAggregates: jest.fn(),
      getDuplicatePositionReport: jest.fn(),
    } as unknown as jest.Mocked<IInventoryQueryService>;
    availabilityService = {
      getPromisableQuantities: jest.fn().mockResolvedValue([]),
      applyPublishControls: jest.fn(),
      getAppliedReserve: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<IAvailabilityService>;
    service = new StockAtRiskReadService(
      offerRepo,
      shopRepo,
      integrationsService,
      inventoryQueryService,
      availabilityService
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
    availabilityService.getAppliedReserve.mockResolvedValue(buffer ?? 0);
  }

  /** One listed variant, with the master stock and the ATP the seam reports. */
  function listedVariant(input: {
    variantId: string;
    productId: string;
    masterStock: number;
    availableToPromise: number | null;
  }): void {
    offerRepo.findRecentlyListedVariantIds.mockResolvedValue([
      {
        variantId: input.variantId,
        productId: input.productId,
        latestMappedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    inventoryQueryService.getAvailabilityByVariantIds.mockResolvedValue([
      {
        productVariantId: input.variantId,
        totalAvailable: input.masterStock,
        locationCount: 1,
        availableToPromise: input.availableToPromise,
      },
    ]);
    availabilityService.getPromisableQuantities.mockResolvedValue([
      {
        productVariantId: input.variantId,
        quantity: input.availableToPromise,
        provenance: input.availableToPromise === null ? 'unknown' : 'computed',
        observedAt: null,
        stalenessMs: null,
        olHeldNotReflected: null,
      },
    ]);
  }

  it('should still scan a connection with no configured stock safety buffer', async () => {
    connectionWithBuffer('conn-a', undefined);
    listedVariant({ variantId: 'v1', productId: 'p1', masterStock: 50, availableToPromise: 50 });

    const result = await service.findStockAtRisk(20);

    expect(offerRepo.findRecentlyListedVariantIds).toHaveBeenCalled();
    expect(result).toEqual({ items: [], totalCount: 0 });
  });

  it('should report zero master stock on a connection with no configured buffer', async () => {
    connectionWithBuffer('conn-a', undefined);
    listedVariant({ variantId: 'v1', productId: 'p1', masterStock: 0, availableToPromise: 0 });

    const result = await service.findStockAtRisk(20);

    expect(result.totalCount).toBe(1);
    expect(result.items).toEqual([
      {
        variantId: 'v1',
        productId: 'p1',
        connectionId: 'conn-a',
        masterStock: 0,
        stockSafetyBuffer: 0,
        availableToPromise: 0,
        shortfall: 0,
        stockZeroThreshold: 0,
      },
    ]);
  });

  it('should report a variant the zero threshold silenced, not only the buffer (#2610)', async () => {
    // The threshold is a second way to publish nothing. Leaving it out made
    // this aggregate under-report exactly the lines the threshold had hidden.
    //
    // Since #2323 the threshold is applied by the availability seam rather than
    // recomputed here, so the seam is seeded with what it reports for a stock of
    // 3 under a threshold of 5: zero promisable. The row must still appear, and
    // must still name the threshold as the knob that silenced it.
    connectionWithPolicy('conn-a', 0, 5);
    listedVariant({ variantId: 'v1', productId: 'p1', masterStock: 3, availableToPromise: 0 });

    const result = await service.findStockAtRisk(20);

    expect(result.totalCount).toBe(1);
    expect(result.items[0]?.stockZeroThreshold).toBe(5);
    expect(result.items[0]?.masterStock).toBe(3);
  });

  it('should report a variant at or below the buffer threshold', async () => {
    connectionWithBuffer('conn-a', 5);
    // Wave-1b ATP for masterStock 5 / buffer 5 is max(0, 5 − 5) = 0.
    listedVariant({ variantId: 'v1', productId: 'p1', masterStock: 5, availableToPromise: 0 });

    const result = await service.findStockAtRisk(20);

    expect(result.totalCount).toBe(1);
    expect(result.items).toEqual([
      {
        variantId: 'v1',
        productId: 'p1',
        connectionId: 'conn-a',
        masterStock: 5,
        stockSafetyBuffer: 5,
        availableToPromise: 0,
        shortfall: 0,
        stockZeroThreshold: 0,
      },
    ]);
  });

  it('should not report a variant comfortably above the buffer threshold', async () => {
    connectionWithBuffer('conn-a', 5);
    listedVariant({ variantId: 'v1', productId: 'p1', masterStock: 50, availableToPromise: 45 });

    const result = await service.findStockAtRisk(20);

    expect(result).toEqual({ items: [], totalCount: 0 });
  });

  it('should pass the destination connection as the availability scope', async () => {
    connectionWithBuffer('conn-a', 5);
    listedVariant({ variantId: 'v1', productId: 'p1', masterStock: 50, availableToPromise: 45 });

    await service.findStockAtRisk(20);

    // The buffer must be inside the number, not applied again here — a
    // channel-scoped read is what makes that true.
    expect(availabilityService.getPromisableQuantities).toHaveBeenCalledWith({
      variantIds: ['v1'],
      scope: { kind: 'channel', connectionId: 'conn-a' },
    });
    expect(availabilityService.getAppliedReserve).toHaveBeenCalledWith({
      kind: 'channel',
      connectionId: 'conn-a',
    });
  });

  /**
   * AC4 — the shortfall column, proven through the seam.
   *
   * With the Wave-1b empty ledger promised ≡ 0, so a real install produces zero
   * shortfall rows and that is CORRECT, not a stub. This case mocks the seam to
   * the state a non-empty ledger creates (`atp < masterStock − reserve`) and
   * asserts the row surfaces the gap — the same fake-reachable proof #2321 used
   * for its AC-c.
   */
  it('should report the shortfall when reservations have consumed the sellable stock', async () => {
    connectionWithBuffer('conn-a', 2);
    // masterStock 10, buffer 2 => 8 sellable on paper; 6 units are reserved.
    listedVariant({ variantId: 'v1', productId: 'p1', masterStock: 10, availableToPromise: 0 });

    const result = await service.findStockAtRisk(20);

    expect(result.items).toEqual([
      {
        variantId: 'v1',
        productId: 'p1',
        connectionId: 'conn-a',
        masterStock: 10,
        stockSafetyBuffer: 2,
        stockZeroThreshold: 0,
        availableToPromise: 0,
        shortfall: 8,
      },
    ]);
  });

  it('should skip a variant whose availability is unknown rather than report it at risk', async () => {
    connectionWithBuffer('conn-a', 0);
    listedVariant({ variantId: 'v1', productId: 'p1', masterStock: 0, availableToPromise: null });

    const result = await service.findStockAtRisk(20);

    // A row here asserts a number about the operator's stock. OL does not have
    // one, so it says nothing rather than something false.
    expect(result).toEqual({ items: [], totalCount: 0 });
  });
});
