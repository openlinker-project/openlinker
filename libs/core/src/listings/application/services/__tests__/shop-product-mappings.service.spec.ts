/**
 * Shop Product Mappings Service Tests
 *
 * Mirrors OfferMappingsService's countListedVariantsByProducts coverage
 * (#1838 follow-up fix) - the empty-input short-circuit, the passthrough
 * forwarding semantics, and the 200-id cap.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import { ShopProductMappingsService } from '../shop-product-mappings.service';
import type { ShopProductMappingRepositoryPort } from '../../../domain/ports/shop-product-mapping-repository.port';

function buildRepoMock(): jest.Mocked<ShopProductMappingRepositoryPort> {
  return {
    countByConnectionAndVariants: jest.fn(),
    countListedVariantsByProducts: jest.fn(),
    findRecentlyListedVariantIds: jest.fn(),
  };
}

describe('ShopProductMappingsService', () => {
  describe('countListedVariantsByProducts', () => {
    it('should return [] without hitting the repository when productIds is empty', async () => {
      const repo = buildRepoMock();
      const service = new ShopProductMappingsService(repo);

      const result = await service.countListedVariantsByProducts([]);

      expect(result).toEqual([]);
      expect(repo.countListedVariantsByProducts).not.toHaveBeenCalled();
    });

    it('should forward productIds to the repository and return its rows verbatim', async () => {
      const repo = buildRepoMock();
      const rows = [
        {
          productId: 'ol_product_1',
          connectionId: 'conn-woo-1',
          platformType: 'woocommerce',
          listedVariants: 1,
        },
      ];
      repo.countListedVariantsByProducts.mockResolvedValue(rows);
      const service = new ShopProductMappingsService(repo);

      const result = await service.countListedVariantsByProducts(['ol_product_1', 'ol_product_2']);

      expect(repo.countListedVariantsByProducts).toHaveBeenCalledWith([
        'ol_product_1',
        'ol_product_2',
      ]);
      expect(result).toBe(rows);
    });

    it('should reject input exceeding the 200-id cap without hitting the repository', async () => {
      const repo = buildRepoMock();
      const service = new ShopProductMappingsService(repo);
      const oversize = Array.from({ length: 201 }, (_, i) => `ol_product_${String(i)}`);

      await expect(service.countListedVariantsByProducts(oversize)).rejects.toThrow(
        /at most 200 productIds/
      );
      expect(repo.countListedVariantsByProducts).not.toHaveBeenCalled();
    });
  });
});
