/**
 * Coverage Gap Read Service unit tests (#1983)
 */
import { CoverageGapReadService } from '../coverage-gap-read.service';
import type { OfferMappingRepositoryPort } from '../../../domain/ports/offer-mapping-repository.port';
import type { ShopProductMappingRepositoryPort } from '../../../domain/ports/shop-product-mapping-repository.port';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IPublishedVariantsService } from '../published-variants.service.interface';

describe('CoverageGapReadService', () => {
  let offerRepo: jest.Mocked<OfferMappingRepositoryPort>;
  let shopRepo: jest.Mocked<ShopProductMappingRepositoryPort>;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let publishedVariantsService: jest.Mocked<IPublishedVariantsService>;
  let service: CoverageGapReadService;

  beforeEach(() => {
    offerRepo = {
      findById: jest.fn(),
      findMany: jest.fn(),
      countByConnectionAndVariants: jest.fn(),
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
    publishedVariantsService = {
      getPublishedVariantIds: jest.fn().mockResolvedValue([]),
    };
    service = new CoverageGapReadService(
      offerRepo,
      shopRepo,
      integrationsService,
      publishedVariantsService
    );
  });

  function capableConnections(...connectionIds: string[]): void {
    integrationsService.listCapabilityAdapters.mockImplementation(({ capability }) => {
      const ids = capability === 'OfferManager' ? connectionIds.slice(0, 1) : connectionIds.slice(1);
      return Promise.resolve(
        ids.map((connectionId) => ({
          connectionId,
          connection: {} as never,
          adapter: {} as never,
          metadata: {} as never,
        }))
      );
    });
  }

  it('should return no gaps when fewer than two listing-capable connections exist', async () => {
    capableConnections('conn-a');

    const result = await service.findCoverageGaps(20);

    expect(result).toEqual({ items: [], totalCount: 0 });
    expect(offerRepo.findRecentlyListedVariantIds).not.toHaveBeenCalled();
  });

  it('should report a variant listed on one capable connection but missing from another', async () => {
    capableConnections('conn-a', 'conn-b');
    offerRepo.findRecentlyListedVariantIds.mockResolvedValue([
      { variantId: 'v1', productId: 'p1', latestMappedAt: new Date('2026-01-01T00:00:00Z') },
    ]);
    publishedVariantsService.getPublishedVariantIds.mockImplementation((connectionId) =>
      Promise.resolve(connectionId === 'conn-a' ? ['v1'] : [])
    );

    const result = await service.findCoverageGaps(20);

    expect(result.totalCount).toBe(1);
    expect(result.items).toEqual([
      {
        variantId: 'v1',
        productId: 'p1',
        listedOnConnectionIds: ['conn-a'],
        missingFromConnectionIds: ['conn-b'],
      },
    ]);
  });

  it('should not report a variant listed on every capable connection', async () => {
    capableConnections('conn-a', 'conn-b');
    offerRepo.findRecentlyListedVariantIds.mockResolvedValue([
      { variantId: 'v1', productId: 'p1', latestMappedAt: new Date('2026-01-01T00:00:00Z') },
    ]);
    publishedVariantsService.getPublishedVariantIds.mockResolvedValue(['v1']);

    const result = await service.findCoverageGaps(20);

    expect(result).toEqual({ items: [], totalCount: 0 });
  });

  it('should cap output at the requested limit while reporting the true totalCount', async () => {
    capableConnections('conn-a', 'conn-b');
    offerRepo.findRecentlyListedVariantIds.mockResolvedValue([
      { variantId: 'v1', productId: 'p1', latestMappedAt: new Date('2026-01-01T00:00:00Z') },
      { variantId: 'v2', productId: 'p2', latestMappedAt: new Date('2026-01-02T00:00:00Z') },
    ]);
    publishedVariantsService.getPublishedVariantIds.mockImplementation((connectionId) =>
      Promise.resolve(connectionId === 'conn-a' ? ['v1', 'v2'] : [])
    );

    const result = await service.findCoverageGaps(1);

    expect(result.items).toHaveLength(1);
    expect(result.totalCount).toBe(2);
  });

  it('should re-sort merged offer/shop candidates by latestMappedAt rather than insertion order', async () => {
    capableConnections('conn-a', 'conn-b');
    // Offer row is older; shop row is more recent — insertion order alone
    // (offers first) would wrongly favour the older offer row if the merge
    // did not re-sort by recency.
    offerRepo.findRecentlyListedVariantIds.mockResolvedValue([
      { variantId: 'v-old', productId: 'p-old', latestMappedAt: new Date('2026-01-01T00:00:00Z') },
    ]);
    shopRepo.findRecentlyListedVariantIds.mockResolvedValue([
      { variantId: 'v-new', productId: 'p-new', latestMappedAt: new Date('2026-06-01T00:00:00Z') },
    ]);
    publishedVariantsService.getPublishedVariantIds.mockImplementation((connectionId) =>
      Promise.resolve(connectionId === 'conn-a' ? ['v-new'] : [])
    );

    const result = await service.findCoverageGaps(20);

    expect(result.items.map((item) => item.variantId)).toContain('v-new');
  });
});
