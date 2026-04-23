/**
 * Offer Mapping Sync Service Tests
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import { OfferMappingSyncService } from '../offer-mapping-sync.service';
import { OfferLinkingService } from '../offer-linking.service';
import { OfferManagerPort, OfferLister, OfferEventReader } from '@openlinker/core/listings';
import { IIntegrationsService } from '@openlinker/core/integrations';
import { IIdentifierMappingService, IdentifierMappingConflictException } from '@openlinker/core/identifier-mapping';
import { ProductVariantRepositoryPort } from '@openlinker/core/products/domain/ports/product-variant-repository.port';
import { ProductVariant } from '@openlinker/core/products';

function makeVariant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: overrides.id ?? 'variant-1',
    productId: overrides.productId ?? 'product-1',
    sku: overrides.sku ?? 'SKU-1',
    attributes: overrides.attributes ?? null,
    ean: overrides.ean ?? null,
    gtin: overrides.gtin ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  };
}

describe('OfferMappingSyncService', () => {
  let service: OfferMappingSyncService;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let variantRepository: jest.Mocked<ProductVariantRepositoryPort>;
  let marketplace: jest.Mocked<OfferManagerPort & OfferLister & OfferEventReader>;

  beforeEach(() => {
    marketplace = {
      listOrderFeed: jest.fn(),
      getOrder: jest.fn(),
      updateOfferQuantity: jest.fn(),
      listOffers: jest.fn(),
      listOfferEvents: jest.fn(),
    } as unknown as jest.Mocked<OfferManagerPort & OfferLister & OfferEventReader>;

    integrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(marketplace),
      getAdapter: jest.fn().mockResolvedValue({
        connection: {
          id: 'connection-1',
          platformType: 'allegro',
          name: 'Allegro',
          status: 'active',
          config: { masterCatalogConnectionId: 'master-1' },
          credentialsRef: 'cred',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        adapter: marketplace,
        metadata: {
          adapterKey: 'allegro',
          supportedCapabilities: ['OfferManager'],
          platformType: 'allegro',
        },
      }),
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    identifierMapping = {
      getOrCreateInternalId: jest.fn(),
      getInternalId: jest.fn(),
      getExternalIds: jest.fn(),
      createMapping: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
      getOrCreateExactMapping: jest.fn(),
      deleteMapping: jest.fn(),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    variantRepository = {
      findById: jest.fn(),
      findByProductId: jest.fn(),
      findBySku: jest.fn(),
      findBySkuIn: jest.fn(),
      findByEanOrGtinIn: jest.fn(),
      upsert: jest.fn(),
      upsertMany: jest.fn(),
    } as unknown as jest.Mocked<ProductVariantRepositoryPort>;

    service = new OfferMappingSyncService(
      integrationsService,
      identifierMapping,
      variantRepository,
      new OfferLinkingService(),
    );
  });

  it('links offers deterministically and upserts mappings', async () => {
    (marketplace.listOffers as jest.Mock).mockResolvedValue({
      items: [
        { offerId: 'offer-1', externalRef: 'SKU-1' },
        { offerId: 'offer-2', sku: 'SKU-2' },
      ],
      nextCursor: null,
    });

    variantRepository.findBySkuIn.mockResolvedValue([
      makeVariant({ id: 'variant-1', productId: 'product-1', sku: 'SKU-1' }),
      makeVariant({ id: 'variant-2', productId: 'product-2', sku: 'SKU-2' }),
    ]);

    variantRepository.findByEanOrGtinIn.mockResolvedValue([]);

    const result = await service.sync('connection-1', { limit: 50, cursor: null });

    expect(result).toEqual({ scanned: 2, linked: 2, skipped: 0, nextCursor: null });
    expect(identifierMapping.getOrCreateExactMapping).toHaveBeenCalledTimes(2);
  });

  it('skips conflicting mappings and continues', async () => {
    (marketplace.listOffers as jest.Mock).mockResolvedValue({
      items: [{ offerId: 'offer-1', externalRef: 'SKU-1' }],
      nextCursor: null,
    });

    variantRepository.findBySkuIn.mockResolvedValue([
      makeVariant({ id: 'variant-1', productId: 'product-1', sku: 'SKU-1' }),
    ]);
    variantRepository.findByEanOrGtinIn.mockResolvedValue([]);

    identifierMapping.getOrCreateExactMapping.mockRejectedValue(
      new IdentifierMappingConflictException('Offer', 'offer-1', 'connection-1', 'old', 'new'),
    );

    const result = await service.sync('connection-1', { limit: 50, cursor: null });

    expect(result).toEqual({ scanned: 1, linked: 0, skipped: 1, nextCursor: null });
  });

  it('skips barcode lookup when masterCatalogConnectionId is missing', async () => {
    integrationsService.getAdapter.mockResolvedValueOnce({
      connection: {
        id: 'connection-1',
        platformType: 'allegro',
        name: 'Allegro',
        status: 'active',
        config: {},
        credentialsRef: 'cred',
        adapterKey: undefined,
        enabledCapabilities: ['OfferManager'],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      adapter: marketplace,
      metadata: {
        adapterKey: 'allegro',
        supportedCapabilities: ['OfferManager'],
        platformType: 'allegro',
      },
    });

    (marketplace.listOffers as jest.Mock).mockResolvedValue({
      items: [{ offerId: 'offer-1', ean: '5901234123457' }],
      nextCursor: null,
    });

    variantRepository.findBySkuIn.mockResolvedValue([]);
    variantRepository.findByEanOrGtinIn.mockResolvedValue([]);

    const result = await service.sync('connection-1', { limit: 50, cursor: null });

    expect(result).toEqual({ scanned: 1, linked: 0, skipped: 1, nextCursor: null });
    expect(variantRepository.findByEanOrGtinIn).not.toHaveBeenCalled();
  });

  it('uses masterCatalogConnectionId for barcode lookup', async () => {
    (marketplace.listOffers as jest.Mock).mockResolvedValue({
      items: [{ offerId: 'offer-1', ean: '5901234123457' }],
      nextCursor: null,
    });

    variantRepository.findBySkuIn.mockResolvedValue([]);
    variantRepository.findByEanOrGtinIn.mockResolvedValue([
      makeVariant({
        id: 'variant-1',
        productId: 'product-1',
        sku: 'SKU-1',
        ean: '5901234123457',
      }),
    ]);

    const result = await service.sync('connection-1', { limit: 50, cursor: null });

    expect(result).toEqual({ scanned: 1, linked: 1, skipped: 0, nextCursor: null });
    expect(variantRepository.findByEanOrGtinIn).toHaveBeenCalledWith(
      'master-1',
      ['5901234123457'],
      'ean',
    );
  });
});
