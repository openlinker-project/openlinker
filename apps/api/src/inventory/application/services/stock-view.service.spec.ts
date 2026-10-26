/**
 * Stock View Service Tests (#3621)
 *
 * Pins the composition rules the operator's stock panel depends on: channels
 * come from capability discovery + published variants, "will publish" goes
 * through the availability seam and stays unknown when the promise is unknown,
 * and a snapshot that was never taken is null rather than zero.
 *
 * @module apps/api/src/inventory/application/services
 */
import type {
  IAvailabilityService,
  IInventoryQueryService,
  ILocationService,
  VariantStockView,
} from '@openlinker/core/inventory';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type {
  IOfferCommercialReadService,
  IPublishedVariantsService,
} from '@openlinker/core/listings';
import type { IOperationalSettingsService } from '@openlinker/core/operational-settings';
import type { IOrderRecordService } from '@openlinker/core/orders';
import type { IProductsService, Product, ProductVariant } from '@openlinker/core/products';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import { StockViewProductNotFoundError, StockViewService } from './stock-view.service';

const view = (overrides: Partial<VariantStockView> = {}): VariantStockView => ({
  productVariantId: 'var-a',
  masterAvailable: 10,
  masterReserved: 0,
  availableToPromise: 8,
  provenance: 'computed',
  observedAt: new Date('2026-10-26T10:00:00Z'),
  stalenessMs: 3_600_000,
  olHeldNotReflected: null,
  heldCounted: 2,
  heldRecordedOnly: 0,
  livePositionCount: 1,
  positions: [
    {
      locationId: 'loc-1',
      sourceConnectionId: 'conn-master',
      isStale: false,
      availableQuantity: 10,
      reservedQuantity: 0,
      updatedAt: new Date('2026-10-26T10:00:00Z'),
    },
  ],
  holds: [],
  isStaleSync: false,
  ...overrides,
});

describe('StockViewService', () => {
  let inventoryQuery: jest.Mocked<Pick<IInventoryQueryService, 'getStockViewByVariantIds'>>;
  let availability: jest.Mocked<
    Pick<IAvailabilityService, 'applyPublishControlsBatch' | 'getAppliedControls'>
  >;
  let locations: jest.Mocked<Pick<ILocationService, 'getLocationsByIds'>>;
  let products: jest.Mocked<Pick<IProductsService, 'getProduct' | 'getVariantsByProductId'>>;
  let integrations: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>>;
  let published: jest.Mocked<IPublishedVariantsService>;
  let commercial: jest.Mocked<IOfferCommercialReadService>;
  let orderRecords: jest.Mocked<Pick<IOrderRecordService, 'findByIds'>>;
  let connections: jest.Mocked<Pick<ConnectionPort, 'get'>>;
  let settings: jest.Mocked<Pick<IOperationalSettingsService, 'resolve'>>;
  let service: StockViewService;

  const channelEntry = (
    connectionId: string,
    name: string,
    platformType: string
  ): Record<string, unknown> => ({
    connectionId,
    connection: { id: connectionId, name, platformType },
    adapter: {},
    metadata: {},
  });

  beforeEach(() => {
    inventoryQuery = { getStockViewByVariantIds: jest.fn().mockResolvedValue([view()]) };
    availability = {
      applyPublishControlsBatch: jest
        .fn()
        .mockResolvedValue([{ quantity: 7, provenance: 'computed' }]),
      getAppliedControls: jest.fn().mockResolvedValue({ buffer: 1, zeroThreshold: 0 }),
    };
    locations = {
      getLocationsByIds: jest.fn().mockResolvedValue([{ id: 'loc-1', name: 'MAIN' }]),
    } as never;
    products = {
      getProduct: jest.fn().mockResolvedValue({ id: 'prod-1', name: 'Mug', sku: 'MUG' } as Product),
      getVariantsByProductId: jest
        .fn()
        .mockResolvedValue([
          { id: 'var-a', productId: 'prod-1', sku: 'MUG-S', attributes: { size: 'S' } },
        ] as unknown as ProductVariant[]),
    };
    integrations = {
      listCapabilityAdapters: jest
        .fn()
        .mockImplementation(({ capability }: { capability: string }) =>
          Promise.resolve(
            capability === 'OfferManager' ? [channelEntry('conn-allegro', 'Allegro', 'allegro')] : []
          )
        ),
    } as never;
    published = { getPublishedVariantIds: jest.fn().mockResolvedValue(['var-a']) };
    commercial = { getObservedQuantities: jest.fn().mockResolvedValue([]) };
    orderRecords = { findByIds: jest.fn().mockResolvedValue([]) };
    connections = { get: jest.fn().mockResolvedValue({ name: 'PrestaShop' }) } as never;
    settings = {
      resolve: jest.fn().mockResolvedValue({
        stockStaleSyncThresholdHours: { value: 6, source: 'default' },
      }),
    } as never;

    service = new StockViewService(
      inventoryQuery as unknown as IInventoryQueryService,
      availability as unknown as IAvailabilityService,
      locations as unknown as ILocationService,
      products as unknown as IProductsService,
      integrations as unknown as IIntegrationsService,
      published,
      commercial,
      orderRecords as unknown as IOrderRecordService,
      connections as unknown as ConnectionPort,
      settings as unknown as IOperationalSettingsService
    );
  });

  it('should throw a not-found error for an unknown product', async () => {
    products.getProduct.mockResolvedValue(null);

    await expect(service.getProductStockView('nope')).rejects.toBeInstanceOf(
      StockViewProductNotFoundError
    );
  });

  it('should pass the resolved threshold to the core read in milliseconds', async () => {
    settings.resolve.mockResolvedValue({
      stockStaleSyncThresholdHours: { value: 12, source: 'setting' },
    } as never);

    const result = await service.getProductStockView('prod-1');

    expect(inventoryQuery.getStockViewByVariantIds).toHaveBeenCalledWith({
      variantIds: ['var-a'],
      staleSyncThresholdMs: 12 * 3_600_000,
    });
    expect(result.staleSyncThreshold).toEqual({ hours: 12, ms: 12 * 3_600_000, source: 'setting' });
  });

  it('should fall back to the 6 h default when the settings read fails', async () => {
    settings.resolve.mockRejectedValue(new Error('db down'));

    const result = await service.getProductStockView('prod-1');

    expect(result.staleSyncThreshold).toEqual({ hours: 6, ms: 21_600_000, source: 'default' });
  });

  it('should build a channel with its rule, the controlled figure and what the channel shows', async () => {
    commercial.getObservedQuantities.mockResolvedValue([
      {
        connectionId: 'conn-allegro',
        internalVariantId: 'var-a',
        externalOfferId: 'o-1',
        availableQuantity: 6,
        observedAt: new Date('2026-10-26T09:00:00Z'),
      },
    ]);

    const result = await service.getProductStockView('prod-1');

    expect(availability.applyPublishControlsBatch).toHaveBeenCalledWith({
      quantities: [8],
      scope: { kind: 'channel', connectionId: 'conn-allegro' },
    });
    expect(result.channelsStatus).toBe('ok');
    expect(result.variants[0].channels).toEqual([
      {
        connectionId: 'conn-allegro',
        connectionName: 'Allegro',
        platformType: 'allegro',
        rule: { stockSafetyBuffer: 1, stockZeroThreshold: 0 },
        willPublish: { quantity: 7, provenance: 'computed' },
        channelShows: { quantity: 6, observedAt: new Date('2026-10-26T09:00:00Z') },
      },
    ]);
  });

  it('should report "channel shows" as null, not zero, when no snapshot exists', async () => {
    const result = await service.getProductStockView('prod-1');

    expect(result.variants[0].channels[0].channelShows).toEqual({
      quantity: null,
      observedAt: null,
    });
  });

  it('should keep "will publish" unknown and never run the Controls over an unknown promise', async () => {
    inventoryQuery.getStockViewByVariantIds.mockResolvedValue([
      view({ availableToPromise: null, provenance: 'unknown', heldCounted: null }),
    ]);

    const result = await service.getProductStockView('prod-1');

    expect(availability.applyPublishControlsBatch).not.toHaveBeenCalled();
    expect(result.variants[0].channels[0].willPublish).toEqual({
      quantity: null,
      provenance: 'unknown',
    });
  });

  it('should list only channels the variant is published on', async () => {
    published.getPublishedVariantIds.mockResolvedValue([]);

    const result = await service.getProductStockView('prod-1');

    expect(result.variants[0].channels).toEqual([]);
    expect(result.channelsStatus).toBe('ok');
  });

  it('should mark channels unavailable, not empty, when discovery fails', async () => {
    integrations.listCapabilityAdapters.mockRejectedValue(new Error('registry down'));

    const result = await service.getProductStockView('prod-1');

    expect(result.channelsStatus).toBe('unavailable');
    expect(result.variants[0].channels).toEqual([]);
  });

  it('should omit one failing channel and report the response partial', async () => {
    published.getPublishedVariantIds.mockRejectedValue(new Error('boom'));

    const result = await service.getProductStockView('prod-1');

    expect(result.channelsStatus).toBe('partial');
    expect(result.variants[0].channels).toEqual([]);
  });

  it('should degrade a rule that cannot be read to null without dropping the channel', async () => {
    availability.getAppliedControls.mockRejectedValue(new Error('no connection'));

    const result = await service.getProductStockView('prod-1');

    expect(result.variants[0].channels[0].rule).toBeNull();
    expect(result.variants[0].channels[0].willPublish.quantity).toBe(7);
  });

  it('should name positions by location and master connection and leave unnamed ones null', async () => {
    connections.get.mockRejectedValue(new Error('gone'));

    const result = await service.getProductStockView('prod-1');

    expect(result.variants[0].positions[0]).toMatchObject({
      locationName: 'MAIN',
      sourceConnectionName: null,
    });
  });

  it('should resolve hold order numbers and keep null holds null', async () => {
    inventoryQuery.getStockViewByVariantIds.mockResolvedValue([
      view({
        holds: [
          {
            orderRecordId: 'ord-1',
            quantity: 2,
            atpEffect: 'published',
            expiresAt: new Date('2026-11-01T00:00:00Z'),
            createdAt: new Date('2026-10-25T00:00:00Z'),
          },
        ],
      }),
    ]);
    orderRecords.findByIds.mockResolvedValue([
      { internalOrderId: 'ord-1', orderSnapshot: { orderNumber: 'A-100', items: [{ name: 'x' }] } },
    ] as never);

    const withHolds = await service.getProductStockView('prod-1');
    expect(withHolds.variants[0].holds).toEqual([
      expect.objectContaining({ orderRecordId: 'ord-1', orderNumber: 'A-100', quantity: 2 }),
    ]);

    inventoryQuery.getStockViewByVariantIds.mockResolvedValue([view({ holds: null })]);
    const withoutHolds = await service.getProductStockView('prod-1');
    expect(withoutHolds.variants[0].holds).toBeNull();
  });
});
