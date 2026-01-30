/**
 * Offer Mapping Sync Service Tests
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import { OfferMappingSyncService } from '../offer-mapping-sync.service';
import { OfferLinkingService } from '../offer-linking.service';
import { IIntegrationsService, MarketplacePort } from '@openlinker/core/integrations';
import { IIdentifierMappingService, IdentifierMappingConflictException } from '@openlinker/core/identifier-mapping';
import { ProductVariantRepositoryPort } from '@openlinker/core/products/domain/ports/product-variant-repository.port';
import { ProductVariantEntity } from '@openlinker/core/products';

describe('OfferMappingSyncService', () => {
  let service: OfferMappingSyncService;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let variantRepository: jest.Mocked<ProductVariantRepositoryPort>;
  let marketplace: jest.Mocked<MarketplacePort>;

  beforeEach(() => {
    marketplace = {
      listOrderFeed: jest.fn(),
      getOrder: jest.fn(),
      updateOfferQuantity: jest.fn(),
      listOffers: jest.fn(),
    } as unknown as jest.Mocked<MarketplacePort>;

    integrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(marketplace),
      getAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    identifierMapping = {
      getOrCreateInternalId: jest.fn(),
      getInternalId: jest.fn(),
      getExternalIds: jest.fn(),
      createMapping: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
      getOrCreateExactMapping: jest.fn(),
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
      new ProductVariantEntity('variant-1', 'product-1', 'SKU-1', null, new Date(), new Date()),
      new ProductVariantEntity('variant-2', 'product-2', 'SKU-2', null, new Date(), new Date()),
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
      new ProductVariantEntity('variant-1', 'product-1', 'SKU-1', null, new Date(), new Date()),
    ]);
    variantRepository.findByEanOrGtinIn.mockResolvedValue([]);

    identifierMapping.getOrCreateExactMapping.mockRejectedValue(
      new IdentifierMappingConflictException('Offer', 'offer-1', 'connection-1', 'old', 'new'),
    );

    const result = await service.sync('connection-1', { limit: 50, cursor: null });

    expect(result).toEqual({ scanned: 1, linked: 0, skipped: 1, nextCursor: null });
  });
});
