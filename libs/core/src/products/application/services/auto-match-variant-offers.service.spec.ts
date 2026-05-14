/**
 * Auto-Match Variant Offers Service Tests
 *
 * @module libs/core/src/products/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { AutoMatchVariantOffersService } from './auto-match-variant-offers.service';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IdentifierMappingConflictException,
} from '@openlinker/core/identifier-mapping';
import { PRODUCT_VARIANT_REPOSITORY_TOKEN } from '../../products.tokens';

const createMockIntegrationsService = () => ({
  getAdapter: jest.fn(),
  getCapabilityAdapter: jest.fn(),
  listCapabilityAdapters: jest.fn(),
});

const createMockIdentifierMapping = () => ({
  getOrCreateInternalId: jest.fn(),
  getInternalId: jest.fn(),
  getExternalIds: jest.fn(),
  createMapping: jest.fn(),
  batchGetOrCreateInternalIds: jest.fn(),
  getOrCreateExactMapping: jest.fn(),
  deleteMapping: jest.fn(),
});

const createMockVariantRepository = () => ({
  findById: jest.fn(),
  findByProductId: jest.fn(),
  findBySku: jest.fn(),
  findBySkuIn: jest.fn(),
  findByEanOrGtinIn: jest.fn(),
  upsert: jest.fn(),
  upsertMany: jest.fn(),
  findMany: jest.fn(),
});

const createMockMarketplace = () => ({
  listOrderFeed: jest.fn(),
  getOrder: jest.fn(),
  updateOfferQuantity: jest.fn(),
  listOffers: jest.fn(),
});

describe('AutoMatchVariantOffersService', () => {
  let service: AutoMatchVariantOffersService;
  let integrationsService: ReturnType<typeof createMockIntegrationsService>;
  let identifierMapping: ReturnType<typeof createMockIdentifierMapping>;
  let variantRepository: ReturnType<typeof createMockVariantRepository>;
  let marketplace: ReturnType<typeof createMockMarketplace>;

  beforeEach(async () => {
    integrationsService = createMockIntegrationsService();
    identifierMapping = createMockIdentifierMapping();
    variantRepository = createMockVariantRepository();
    marketplace = createMockMarketplace();

    integrationsService.getAdapter.mockResolvedValue({
      connection: { config: { masterCatalogConnectionId: 'master-conn-1' } },
      adapter: {},
      metadata: {},
    });
    integrationsService.getCapabilityAdapter.mockResolvedValue(marketplace);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutoMatchVariantOffersService,
        { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: integrationsService },
        { provide: IDENTIFIER_MAPPING_SERVICE_TOKEN, useValue: identifierMapping },
        { provide: PRODUCT_VARIANT_REPOSITORY_TOKEN, useValue: variantRepository },
      ],
    }).compile();

    service = module.get(AutoMatchVariantOffersService);
  });

  function setupOffers(
    offers: Array<{
      offerId: string;
      ean?: string | null;
      sku?: string | null;
      externalRef?: string | null;
    }>
  ) {
    marketplace.listOffers.mockResolvedValueOnce({
      items: offers.map((o) => ({
        offerId: o.offerId,
        ean: o.ean ?? null,
        sku: o.sku ?? null,
        externalRef: o.externalRef ?? null,
      })),
      nextCursor: null,
    });
  }

  function setupVariants(
    variants: Array<{ id: string; ean?: string | null; sku?: string | null }>
  ) {
    variantRepository.findMany.mockResolvedValue({
      items: variants.map((v) => ({
        id: v.id,
        productId: 'prod-1',
        sku: v.sku ?? null,
        ean: v.ean ?? null,
        gtin: null,
        attributes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      total: variants.length,
    });
  }

  it('should match variant to offer by exact EAN', async () => {
    setupOffers([{ offerId: 'offer-1', ean: '5901234123457' }]);
    setupVariants([{ id: 'variant-1', ean: '5901234123457' }]);
    identifierMapping.getOrCreateExactMapping.mockResolvedValue('offer-1');

    const result = await service.autoMatch('conn-1', {});

    expect(result.matched).toBe(1);
    expect(result.skippedAmbiguous).toBe(0);
    expect(result.skippedNoMatch).toBe(0);
    expect(identifierMapping.getOrCreateExactMapping).toHaveBeenCalledWith(
      'Offer',
      'offer-1',
      'variant-1',
      'conn-1',
      expect.objectContaining({
        metadata: expect.objectContaining({ linkMethod: 'ean' }),
      })
    );
  });

  it('should match variant to offer by SKU when no EAN match', async () => {
    setupOffers([{ offerId: 'offer-1', sku: 'SKU-ABC' }]);
    setupVariants([{ id: 'variant-1', sku: 'SKU-ABC' }]);
    identifierMapping.getOrCreateExactMapping.mockResolvedValue('offer-1');

    const result = await service.autoMatch('conn-1', {});

    expect(result.matched).toBe(1);
    expect(identifierMapping.getOrCreateExactMapping).toHaveBeenCalledWith(
      'Offer',
      'offer-1',
      'variant-1',
      'conn-1',
      expect.objectContaining({
        metadata: expect.objectContaining({ linkMethod: 'sku' }),
      })
    );
  });

  it('should skip ambiguous matches when multiple offers share the same EAN', async () => {
    setupOffers([
      { offerId: 'offer-1', ean: '5901234123457' },
      { offerId: 'offer-2', ean: '5901234123457' },
    ]);
    setupVariants([{ id: 'variant-1', ean: '5901234123457' }]);

    const result = await service.autoMatch('conn-1', {});

    expect(result.matched).toBe(0);
    expect(result.skippedAmbiguous).toBe(1);
    expect(identifierMapping.getOrCreateExactMapping).not.toHaveBeenCalled();
  });

  it('should skip variants with no matching offer', async () => {
    setupOffers([{ offerId: 'offer-1', ean: '1111111111111' }]);
    setupVariants([{ id: 'variant-1', ean: '9999999999999' }]);

    const result = await service.autoMatch('conn-1', {});

    expect(result.matched).toBe(0);
    expect(result.skippedNoMatch).toBe(1);
    expect(identifierMapping.getOrCreateExactMapping).not.toHaveBeenCalled();
  });

  it('should not persist mappings when dryRun is true', async () => {
    setupOffers([{ offerId: 'offer-1', ean: '5901234123457' }]);
    setupVariants([{ id: 'variant-1', ean: '5901234123457' }]);

    const result = await service.autoMatch('conn-1', { dryRun: true });

    expect(result.matched).toBe(1);
    expect(identifierMapping.getOrCreateExactMapping).not.toHaveBeenCalled();
  });

  it('should handle mapping conflict gracefully', async () => {
    setupOffers([{ offerId: 'offer-1', ean: '5901234123457' }]);
    setupVariants([{ id: 'variant-1', ean: '5901234123457' }]);
    identifierMapping.getOrCreateExactMapping.mockRejectedValue(
      new IdentifierMappingConflictException(
        'Offer',
        'offer-1',
        'conn-1',
        'existing-variant',
        'variant-1'
      )
    );

    const result = await service.autoMatch('conn-1', {});

    expect(result.matched).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].variantId).toBe('variant-1');
    expect(result.errors[0].offerId).toBe('offer-1');
  });

  it('should prefer EAN match over SKU match', async () => {
    setupOffers([
      { offerId: 'offer-ean', ean: '5901234123457', sku: 'SKU-A' },
      { offerId: 'offer-sku', sku: 'SKU-A' },
    ]);
    setupVariants([{ id: 'variant-1', ean: '5901234123457', sku: 'SKU-A' }]);
    identifierMapping.getOrCreateExactMapping.mockResolvedValue('offer-ean');

    const result = await service.autoMatch('conn-1', {});

    expect(result.matched).toBe(1);
    expect(identifierMapping.getOrCreateExactMapping).toHaveBeenCalledWith(
      'Offer',
      'offer-ean',
      'variant-1',
      'conn-1',
      expect.objectContaining({
        metadata: expect.objectContaining({ linkMethod: 'ean' }),
      })
    );
  });

  it('should return empty result when masterCatalogConnectionId is not configured', async () => {
    integrationsService.getAdapter.mockResolvedValue({
      connection: { config: {} },
      adapter: {},
      metadata: {},
    });

    const result = await service.autoMatch('conn-1', {});

    expect(result.matched).toBe(0);
    expect(result.skippedNoMatch).toBe(0);
    expect(marketplace.listOffers).not.toHaveBeenCalled();
  });

  it('should use externalRef as SKU fallback for offers', async () => {
    setupOffers([{ offerId: 'offer-1', externalRef: 'REF-123' }]);
    setupVariants([{ id: 'variant-1', sku: 'REF-123' }]);
    identifierMapping.getOrCreateExactMapping.mockResolvedValue('offer-1');

    const result = await service.autoMatch('conn-1', {});

    expect(result.matched).toBe(1);
    expect(identifierMapping.getOrCreateExactMapping).toHaveBeenCalledWith(
      'Offer',
      'offer-1',
      'variant-1',
      'conn-1',
      expect.objectContaining({
        metadata: expect.objectContaining({ linkMethod: 'sku' }),
      })
    );
  });
});
