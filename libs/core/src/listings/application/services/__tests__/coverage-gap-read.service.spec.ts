/**
 * Coverage Gap Read Service unit tests (#1983)
 */
import { CoverageGapReadService } from '../coverage-gap-read.service';
import type { OfferMappingRepositoryPort } from '../../../domain/ports/offer-mapping-repository.port';
import type { ShopProductMappingRepositoryPort } from '../../../domain/ports/shop-product-mapping-repository.port';
import type { IIntegrationsService } from '@openlinker/core/integrations';

describe('CoverageGapReadService', () => {
  let offerRepo: jest.Mocked<OfferMappingRepositoryPort>;
  let shopRepo: jest.Mocked<ShopProductMappingRepositoryPort>;
  let integrationsService: jest.Mocked<IIntegrationsService>;
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
    service = new CoverageGapReadService(offerRepo, shopRepo, integrationsService);
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
      { variantId: 'v1', productId: 'p1' },
    ]);
    offerRepo.countByConnectionAndVariants.mockImplementation((connectionId) =>
      Promise.resolve(connectionId === 'conn-a' ? new Map([['v1', 1]]) : new Map())
    );
    shopRepo.countByConnectionAndVariants.mockResolvedValue(new Map());

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
      { variantId: 'v1', productId: 'p1' },
    ]);
    offerRepo.countByConnectionAndVariants.mockResolvedValue(new Map([['v1', 1]]));
    shopRepo.countByConnectionAndVariants.mockResolvedValue(new Map());

    const result = await service.findCoverageGaps(20);

    expect(result).toEqual({ items: [], totalCount: 0 });
  });

  it('should cap output at the requested limit while reporting the true totalCount', async () => {
    capableConnections('conn-a', 'conn-b');
    offerRepo.findRecentlyListedVariantIds.mockResolvedValue([
      { variantId: 'v1', productId: 'p1' },
      { variantId: 'v2', productId: 'p2' },
    ]);
    offerRepo.countByConnectionAndVariants.mockImplementation((connectionId) =>
      Promise.resolve(connectionId === 'conn-a' ? new Map([['v1', 1], ['v2', 1]]) : new Map())
    );
    shopRepo.countByConnectionAndVariants.mockResolvedValue(new Map());

    const result = await service.findCoverageGaps(1);

    expect(result.items).toHaveLength(1);
    expect(result.totalCount).toBe(2);
  });
});
