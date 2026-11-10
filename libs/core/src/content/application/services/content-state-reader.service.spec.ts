/**
 * Content State Reader — Unit Tests
 *
 * Covers the read-side orchestration: row composition, channel eligibility
 * filter (active + OfferFieldUpdater + linked-offer count ≥ 1), bulk
 * offer-mapping count, and deterministic channel sort. Variant ids come from
 * OpenLinker's catalogue (`IProductsService`), never from a live master, so the
 * read works whatever number of ProductMaster connections exist (#4068).
 * Catalogue read failures propagate instead of silently returning an empty
 * channel list.
 */
import { ContentStateReaderService } from './content-state-reader.service';
import type { ProductContentField } from '../../domain/entities/product-content-field.entity';
import type { ProductContentFieldRepositoryPort } from '../../domain/ports/product-content-field-repository.port';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IOfferMappingsService, OfferManagerPort } from '@openlinker/core/listings';
import type { IProductsService, ProductVariant } from '@openlinker/core/products';

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

interface ChannelEntry {
  connectionId: string;
  name: string;
  status: string;
  adapter: OfferManagerPort;
}

function channel(connectionId: string, name: string, status = 'active', adapter = channelAdapterWithFieldUpdater()): ChannelEntry {
  return { connectionId, name, status, adapter };
}

function buildService(args: {
  rows?: ProductContentField[];
  channels?: ChannelEntry[];
  counts?: Map<string, number>;
  variants?: Promise<ProductVariant[]>;
}): {
  service: ContentStateReaderService;
  integrations: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>>;
  products: jest.Mocked<Pick<IProductsService, 'getVariantsByProductId'>>;
} {
  const integrations: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>> = {
    listCapabilityAdapters: jest.fn().mockResolvedValue(
      (args.channels ?? []).map((c) => ({
        connectionId: c.connectionId,
        connection: { name: c.name, platformType: 'allegro', status: c.status },
        adapter: c.adapter,
        metadata: {},
      }))
    ),
  };
  const products: jest.Mocked<Pick<IProductsService, 'getVariantsByProductId'>> = {
    getVariantsByProductId: jest
      .fn()
      .mockReturnValue(args.variants ?? Promise.resolve([{ id: 'ol_variant_a' } as ProductVariant])),
  };
  const offerMappings: jest.Mocked<Pick<IOfferMappingsService, 'countForVariants'>> = {
    countForVariants: jest.fn().mockResolvedValue(args.counts ?? new Map()),
  };
  const service = new ContentStateReaderService(
    buildRepoMock(args.rows),
    integrations as unknown as IIntegrationsService,
    offerMappings as unknown as IOfferMappingsService,
    products as unknown as IProductsService
  );
  return { service, integrations, products };
}

describe('ContentStateReaderService', () => {
  it('should filter out connections that are not active', async () => {
    const { service } = buildService({
      counts: new Map([['ol_variant_a', 1]]),
      channels: [channel('conn-allegro-1', 'Allegro PL'), channel('conn-allegro-2', 'Allegro Backup', 'disabled')],
    });

    const state = await service.readState('ol_product_1');

    expect(state.channels.map((c) => c.connectionId)).toEqual(['conn-allegro-1']);
  });

  it('should filter out OfferManager adapters that do not implement OfferFieldUpdater', async () => {
    const { service } = buildService({
      counts: new Map([['ol_variant_a', 2]]),
      channels: [channel('conn-legacy', 'Legacy', 'active', channelAdapterWithoutFieldUpdater())],
    });

    const state = await service.readState('ol_product_1');

    expect(state.channels).toHaveLength(0);
  });

  it('should omit connections with zero linked offers', async () => {
    // No entries in the count map = zero offers for the queried variants.
    const { service } = buildService({ channels: [channel('conn-allegro-1', 'Allegro PL')] });

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
    const { service } = buildService({ rows: [row] });

    const state = await service.readState('ol_product_1');

    expect(state.master).toEqual({
      baseValue: 'base text',
      draftValue: 'draft text',
      hasConflict: true,
      updatedAt: '2026-04-20T10:00:00.000Z',
      updatedBy: 'ops@example.com',
    });
  });

  it('should read variant ids from the catalogue and never ask a ProductMaster', async () => {
    const { service, integrations, products } = buildService({
      counts: new Map([['ol_variant_a', 1]]),
      channels: [channel('conn-allegro-1', 'Allegro PL')],
    });

    await service.readState('ol_product_1');

    expect(products.getVariantsByProductId).toHaveBeenCalledWith('ol_product_1');
    expect(integrations.listCapabilityAdapters).not.toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'ProductMaster' })
    );
  });

  it('should propagate catalogue read failures instead of swallowing them', async () => {
    const { service } = buildService({ variants: Promise.reject(new Error('db down')) });

    await expect(service.readState('ol_product_1')).rejects.toThrow('db down');
  });

  it('should sort channels by connection name (case-insensitive) then id', async () => {
    const { service } = buildService({
      counts: new Map([['ol_variant_a', 1]]),
      channels: [channel('conn-2', 'Zeta'), channel('conn-1', 'Alpha')],
    });

    const state = await service.readState('ol_product_1');

    expect(state.channels.map((c) => c.connectionName)).toEqual(['Alpha', 'Zeta']);
  });
});
