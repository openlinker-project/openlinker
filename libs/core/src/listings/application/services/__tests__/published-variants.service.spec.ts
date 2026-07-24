/**
 * Published Variants Service unit tests (#1837)
 */
import { PublishedVariantsService } from '../published-variants.service';
import type { OfferMappingRepositoryPort } from '../../../domain/ports/offer-mapping-repository.port';
import type { ShopProductMappingRepositoryPort } from '../../../domain/ports/shop-product-mapping-repository.port';

describe('PublishedVariantsService', () => {
  let offerRepo: jest.Mocked<OfferMappingRepositoryPort>;
  let shopRepo: jest.Mocked<ShopProductMappingRepositoryPort>;
  let service: PublishedVariantsService;

  beforeEach(() => {
    offerRepo = {
      findById: jest.fn(),
      findMany: jest.fn(),
      countByConnectionAndVariants: jest.fn(),
      countListedVariantsByProducts: jest.fn(),
    };
    shopRepo = {
      countByConnectionAndVariants: jest.fn(),
    };
    service = new PublishedVariantsService(offerRepo, shopRepo);
  });

  it('should return an empty array without hitting storage when input is empty', async () => {
    const result = await service.getPublishedVariantIds('conn-1', []);

    expect(result).toEqual([]);
    expect(offerRepo.countByConnectionAndVariants).not.toHaveBeenCalled();
    expect(shopRepo.countByConnectionAndVariants).not.toHaveBeenCalled();
  });

  it('should return variant ids flagged by the offer mapping repository', async () => {
    offerRepo.countByConnectionAndVariants.mockResolvedValue(new Map([['v1', 2]]));
    shopRepo.countByConnectionAndVariants.mockResolvedValue(new Map());

    const result = await service.getPublishedVariantIds('conn-1', ['v1', 'v2']);

    expect(result).toEqual(['v1']);
  });

  it('should return variant ids flagged by the shop-product mapping repository', async () => {
    offerRepo.countByConnectionAndVariants.mockResolvedValue(new Map());
    shopRepo.countByConnectionAndVariants.mockResolvedValue(new Map([['v2', 1]]));

    const result = await service.getPublishedVariantIds('conn-1', ['v1', 'v2']);

    expect(result).toEqual(['v2']);
  });

  it('should union both mapping kinds and de-duplicate the result', async () => {
    offerRepo.countByConnectionAndVariants.mockResolvedValue(new Map([['v1', 1]]));
    shopRepo.countByConnectionAndVariants.mockResolvedValue(
      new Map([
        ['v1', 1],
        ['v3', 1],
      ]),
    );

    const result = await service.getPublishedVariantIds('conn-1', ['v1', 'v2', 'v3']);

    expect(result.sort()).toEqual(['v1', 'v3']);
  });

  it('should de-duplicate the input before querying', async () => {
    offerRepo.countByConnectionAndVariants.mockResolvedValue(new Map());
    shopRepo.countByConnectionAndVariants.mockResolvedValue(new Map());

    await service.getPublishedVariantIds('conn-1', ['v1', 'v1', 'v2']);

    expect(offerRepo.countByConnectionAndVariants).toHaveBeenCalledWith('conn-1', ['v1', 'v2']);
    expect(shopRepo.countByConnectionAndVariants).toHaveBeenCalledWith('conn-1', ['v1', 'v2']);
  });

  it('should throw when the input exceeds the per-call cap', async () => {
    const tooMany = Array.from({ length: 1001 }, (_, i) => `v${String(i)}`);

    await expect(service.getPublishedVariantIds('conn-1', tooMany)).rejects.toThrow(
      /at most 1000 variantIds/,
    );
  });
});
