/**
 * Content State Reader — Unit Tests
 *
 * Covers the read-side orchestration: row composition, channel eligibility
 * filter (active + OfferFieldUpdater + linked-offer count ≥ 1), bulk
 * offer-mapping count, and deterministic channel sort. Propagation of
 * ProductMaster read failures is verified by letting the rejection bubble
 * instead of silently returning an empty channel list.
 */
import { ContentStateReaderService } from './content-state-reader.service';
import type { ProductContentField } from '../../domain/entities/product-content-field.entity';
import type { ProductContentFieldRepositoryPort } from '../../domain/ports/product-content-field-repository.port';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IOfferMappingsService, OfferManagerPort } from '@openlinker/core/listings';
import type { ProductMasterPort } from '@openlinker/core/products';
import type { ProductVariant } from '@openlinker/core/products';

function makeRow(overrides: Partial<ProductContentField> = {}): ProductContentField {
  return {
    id: 'row-1',
    productId: 'ol_product_1',
    connectionId: null,
    fieldKey: 'description',
    draftValue: null,
    baseValue: 'base',
    baseVersion: null,
    hasConflict: false,
    updatedAt: new Date('2026-04-20T10:00:00.000Z'),
    updatedBy: 'admin@example.com',
    createdAt: new Date('2026-04-20T10:00:00.000Z'),
    ...overrides,
  } as ProductContentField;
}

function buildRepoMock(
  rows: ProductContentField[] = []
): jest.Mocked<ProductContentFieldRepositoryPort> {
  return {
    findByKey: jest.fn(),
    findByProduct: jest.fn().mockResolvedValue(rows),
    upsert: jest.fn(),
    delete: jest.fn(),
  };
}

function buildOfferMappingsMock(
  counts: Map<string, number> = new Map()
): jest.Mocked<Pick<IOfferMappingsService, 'countForVariants'>> {
  return {
    countForVariants: jest.fn().mockResolvedValue(counts),
  };
}

function channelAdapterWithFieldUpdater(): OfferManagerPort {
  return {
    updateOfferQuantity: jest.fn(),
    updateOfferFields: jest.fn(),
  } as unknown as OfferManagerPort;
}

function channelAdapterWithoutFieldUpdater(): OfferManagerPort {
  return {
    updateOfferQuantity: jest.fn(),
  } as unknown as OfferManagerPort;
}

describe('ContentStateReaderService', () => {
  it('should filter out connections that are not active', async () => {
    const repo = buildRepoMock([]);
    const offerMappings = buildOfferMappingsMock(new Map([['ol_variant_a', 1]]));
    const productMaster: jest.Mocked<Pick<ProductMasterPort, 'getProductVariants'>> = {
      getProductVariants: jest.fn().mockResolvedValue([{ id: 'ol_variant_a' } as ProductVariant]),
    };
    const integrations: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>> = {
      listCapabilityAdapters: jest.fn().mockImplementation((query: { capability: string }) => {
        if (query.capability === 'ProductMaster') {
          return Promise.resolve([
            {
              connectionId: 'conn-master',
              connection: { name: 'PrestaShop', platformType: 'prestashop', status: 'active' },
              adapter: productMaster as unknown as ProductMasterPort,
              metadata: {},
            },
          ]);
        }
        // OfferManager: one active + one disabled
        return Promise.resolve([
          {
            connectionId: 'conn-allegro-1',
            connection: { name: 'Allegro PL', platformType: 'allegro', status: 'active' },
            adapter: channelAdapterWithFieldUpdater(),
            metadata: {},
          },
          {
            connectionId: 'conn-allegro-2',
            connection: { name: 'Allegro Backup', platformType: 'allegro', status: 'disabled' },
            adapter: channelAdapterWithFieldUpdater(),
            metadata: {},
          },
        ]);
      }),
    };

    const service = new ContentStateReaderService(
      repo,
      integrations as unknown as IIntegrationsService,
      offerMappings as unknown as IOfferMappingsService
    );
    const state = await service.readState('ol_product_1');

    expect(state.channels.map((c) => c.connectionId)).toEqual(['conn-allegro-1']);
  });

  it('should filter out OfferManager adapters that do not implement OfferFieldUpdater', async () => {
    const repo = buildRepoMock([]);
    const offerMappings = buildOfferMappingsMock(new Map([['ol_variant_a', 2]]));
    const productMaster: jest.Mocked<Pick<ProductMasterPort, 'getProductVariants'>> = {
      getProductVariants: jest.fn().mockResolvedValue([{ id: 'ol_variant_a' } as ProductVariant]),
    };
    const integrations: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>> = {
      listCapabilityAdapters: jest.fn().mockImplementation((query: { capability: string }) => {
        if (query.capability === 'ProductMaster') {
          return Promise.resolve([
            {
              connectionId: 'conn-master',
              connection: { name: 'PrestaShop', platformType: 'prestashop', status: 'active' },
              adapter: productMaster as unknown as ProductMasterPort,
              metadata: {},
            },
          ]);
        }
        return Promise.resolve([
          {
            connectionId: 'conn-legacy',
            connection: { name: 'Legacy', platformType: 'legacy', status: 'active' },
            adapter: channelAdapterWithoutFieldUpdater(),
            metadata: {},
          },
        ]);
      }),
    };

    const service = new ContentStateReaderService(
      repo,
      integrations as unknown as IIntegrationsService,
      offerMappings as unknown as IOfferMappingsService
    );
    const state = await service.readState('ol_product_1');

    expect(state.channels).toHaveLength(0);
  });

  it('should omit connections with zero linked offers', async () => {
    const repo = buildRepoMock([]);
    // No entries in the count map = zero offers for the queried variants.
    const offerMappings = buildOfferMappingsMock(new Map());
    const productMaster: jest.Mocked<Pick<ProductMasterPort, 'getProductVariants'>> = {
      getProductVariants: jest.fn().mockResolvedValue([{ id: 'ol_variant_a' } as ProductVariant]),
    };
    const integrations: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>> = {
      listCapabilityAdapters: jest.fn().mockImplementation((query: { capability: string }) => {
        if (query.capability === 'ProductMaster') {
          return Promise.resolve([
            {
              connectionId: 'conn-master',
              connection: { name: 'PrestaShop', platformType: 'prestashop', status: 'active' },
              adapter: productMaster as unknown as ProductMasterPort,
              metadata: {},
            },
          ]);
        }
        return Promise.resolve([
          {
            connectionId: 'conn-allegro-1',
            connection: { name: 'Allegro PL', platformType: 'allegro', status: 'active' },
            adapter: channelAdapterWithFieldUpdater(),
            metadata: {},
          },
        ]);
      }),
    };

    const service = new ContentStateReaderService(
      repo,
      integrations as unknown as IIntegrationsService,
      offerMappings as unknown as IOfferMappingsService
    );
    const state = await service.readState('ol_product_1');

    expect(state.channels).toHaveLength(0);
  });

  it('should compose master row fields into the state payload', async () => {
    const row = makeRow({
      draftValue: 'draft text',
      baseValue: 'base text',
      hasConflict: true,
      updatedBy: 'ops@example.com',
    });
    const repo = buildRepoMock([row]);
    const offerMappings = buildOfferMappingsMock();
    const integrations: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>> = {
      listCapabilityAdapters: jest.fn().mockResolvedValue([]),
    };

    const service = new ContentStateReaderService(
      repo,
      integrations as unknown as IIntegrationsService,
      offerMappings as unknown as IOfferMappingsService
    );
    const state = await service.readState('ol_product_1');

    expect(state.master).toEqual({
      baseValue: 'base text',
      draftValue: 'draft text',
      hasConflict: true,
      updatedAt: '2026-04-20T10:00:00.000Z',
      updatedBy: 'ops@example.com',
    });
  });

  it('should propagate ProductMaster failures instead of swallowing them', async () => {
    const repo = buildRepoMock([]);
    const offerMappings = buildOfferMappingsMock();
    const productMaster: jest.Mocked<Pick<ProductMasterPort, 'getProductVariants'>> = {
      getProductVariants: jest.fn().mockRejectedValue(new Error('upstream down')),
    };
    const integrations: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>> = {
      listCapabilityAdapters: jest.fn().mockImplementation((query: { capability: string }) => {
        if (query.capability === 'ProductMaster') {
          return Promise.resolve([
            {
              connectionId: 'conn-master',
              connection: { name: 'PrestaShop', platformType: 'prestashop', status: 'active' },
              adapter: productMaster as unknown as ProductMasterPort,
              metadata: {},
            },
          ]);
        }
        return Promise.resolve([]);
      }),
    };

    const service = new ContentStateReaderService(
      repo,
      integrations as unknown as IIntegrationsService,
      offerMappings as unknown as IOfferMappingsService
    );
    await expect(service.readState('ol_product_1')).rejects.toThrow('upstream down');
  });

  it('should sort channels by connection name (case-insensitive) then id', async () => {
    const repo = buildRepoMock([]);
    const offerMappings = buildOfferMappingsMock(new Map([['ol_variant_a', 1]]));
    const productMaster: jest.Mocked<Pick<ProductMasterPort, 'getProductVariants'>> = {
      getProductVariants: jest.fn().mockResolvedValue([{ id: 'ol_variant_a' } as ProductVariant]),
    };
    const integrations: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>> = {
      listCapabilityAdapters: jest.fn().mockImplementation((query: { capability: string }) => {
        if (query.capability === 'ProductMaster') {
          return Promise.resolve([
            {
              connectionId: 'conn-master',
              connection: { name: 'PrestaShop', platformType: 'prestashop', status: 'active' },
              adapter: productMaster as unknown as ProductMasterPort,
              metadata: {},
            },
          ]);
        }
        return Promise.resolve([
          {
            connectionId: 'conn-2',
            connection: { name: 'Zeta', platformType: 'allegro', status: 'active' },
            adapter: channelAdapterWithFieldUpdater(),
            metadata: {},
          },
          {
            connectionId: 'conn-1',
            connection: { name: 'Alpha', platformType: 'allegro', status: 'active' },
            adapter: channelAdapterWithFieldUpdater(),
            metadata: {},
          },
        ]);
      }),
    };

    const service = new ContentStateReaderService(
      repo,
      integrations as unknown as IIntegrationsService,
      offerMappings as unknown as IOfferMappingsService
    );
    const state = await service.readState('ol_product_1');

    expect(state.channels.map((c) => c.connectionName)).toEqual(['Alpha', 'Zeta']);
  });
});
