/**
 * Offer Mapping Sync Service Tests
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import { OfferMappingSyncService } from '../offer-mapping-sync.service';
import { OfferLinkingService } from '../offer-linking.service';
import type { OfferManagerPort, OfferLister, OfferEventReader } from '@openlinker/core/listings';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import { IdentifierMappingConflictException } from '@openlinker/core/identifier-mapping';
import type { IProductsService } from '@openlinker/core/products';
import type { ProductVariant } from '@openlinker/core/products';

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
  // Only the two products-service methods the SUT actually calls — keeps the
  // mock surface tight per #718 review.
  let productsService: jest.Mocked<Pick<IProductsService, 'getVariantsBySkus' | 'getVariantsByBarcodes'>>;
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

    productsService = {
      getVariantsBySkus: jest.fn(),
      getVariantsByBarcodes: jest.fn(),
    };

    service = new OfferMappingSyncService(
      integrationsService,
      identifierMapping,
      productsService as unknown as IProductsService,
      new OfferLinkingService()
    );
  });

  it('no-ops for an adapter that supports neither listOffers nor listOfferEvents (#1096)', async () => {
    // Reconciliation-first adapter (e.g. Erli) — offer mappings are created at
    // offer-creation time, so a scheduled offers-sync must skip, not throw.
    const bareAdapter = { updateOfferQuantity: jest.fn() } as unknown as OfferManagerPort;
    (integrationsService.getCapabilityAdapter as jest.Mock).mockResolvedValue(bareAdapter);

    const result = await service.sync('connection-1', { limit: 50 });

    expect(result).toEqual({ scanned: 0, linked: 0, skipped: 0, nextCursor: null });
    expect(identifierMapping.getOrCreateExactMapping).not.toHaveBeenCalled();
  });

  it('links offers deterministically and upserts mappings', async () => {
    (marketplace.listOffers as jest.Mock).mockResolvedValue({
      items: [
        { offerId: 'offer-1', externalRef: 'SKU-1' },
        { offerId: 'offer-2', sku: 'SKU-2' },
      ],
      nextCursor: null,
    });

    productsService.getVariantsBySkus.mockResolvedValue([
      makeVariant({ id: 'variant-1', productId: 'product-1', sku: 'SKU-1' }),
      makeVariant({ id: 'variant-2', productId: 'product-2', sku: 'SKU-2' }),
    ]);

    productsService.getVariantsByBarcodes.mockResolvedValue([]);

    const result = await service.sync('connection-1', { limit: 50, cursor: null });

    expect(result).toEqual({ scanned: 2, linked: 2, skipped: 0, nextCursor: null });
    expect(identifierMapping.getOrCreateExactMapping).toHaveBeenCalledTimes(2);
  });

  it('skips conflicting mappings and continues', async () => {
    (marketplace.listOffers as jest.Mock).mockResolvedValue({
      items: [{ offerId: 'offer-1', externalRef: 'SKU-1' }],
      nextCursor: null,
    });

    productsService.getVariantsBySkus.mockResolvedValue([
      makeVariant({ id: 'variant-1', productId: 'product-1', sku: 'SKU-1' }),
    ]);
    productsService.getVariantsByBarcodes.mockResolvedValue([]);

    identifierMapping.getOrCreateExactMapping.mockRejectedValue(
      new IdentifierMappingConflictException('Offer', 'offer-1', 'connection-1', 'old', 'new')
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

    productsService.getVariantsBySkus.mockResolvedValue([]);
    productsService.getVariantsByBarcodes.mockResolvedValue([]);

    const result = await service.sync('connection-1', { limit: 50, cursor: null });

    expect(result).toEqual({ scanned: 1, linked: 0, skipped: 1, nextCursor: null });
    expect(productsService.getVariantsByBarcodes).not.toHaveBeenCalled();
  });

  it('uses masterCatalogConnectionId for barcode lookup', async () => {
    (marketplace.listOffers as jest.Mock).mockResolvedValue({
      items: [{ offerId: 'offer-1', ean: '5901234123457' }],
      nextCursor: null,
    });

    productsService.getVariantsBySkus.mockResolvedValue([]);
    productsService.getVariantsByBarcodes.mockResolvedValue([
      makeVariant({
        id: 'variant-1',
        productId: 'product-1',
        sku: 'SKU-1',
        ean: '5901234123457',
      }),
    ]);

    const result = await service.sync('connection-1', { limit: 50, cursor: null });

    expect(result).toEqual({ scanned: 1, linked: 1, skipped: 0, nextCursor: null });
    expect(productsService.getVariantsByBarcodes).toHaveBeenCalledWith(
      'master-1',
      ['5901234123457'],
      'ean'
    );
  });
});
