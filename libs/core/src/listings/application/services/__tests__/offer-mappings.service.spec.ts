/**
 * Offer Mappings Service Tests
 *
 * Exercises the two query shapes the service exposes and the pure-passthrough
 * forwarding semantics (no domain logic to verify beyond the empty-input
 * short-circuit and default-pagination behaviour).
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import { OfferMappingsService } from '../offer-mappings.service';
import type { OfferMappingRepositoryPort } from '../../../domain/ports/offer-mapping-repository.port';
import type { PaginatedOfferMappings } from '../../../domain/types/offer-mapping.types';

function buildRepoMock(): jest.Mocked<OfferMappingRepositoryPort> {
  return {
    findById: jest.fn(),
    findMany: jest.fn(),
    countByConnectionAndVariants: jest.fn(),
    countListedVariantsByProducts: jest.fn(),
  };
}

describe('OfferMappingsService', () => {
  describe('findForVariant', () => {
    it('should forward (connectionId, variantId) to repository.findMany and return the page verbatim', async () => {
      const repo = buildRepoMock();
      const page: PaginatedOfferMappings = { items: [], total: 0 };
      repo.findMany.mockResolvedValue(page);
      const service = new OfferMappingsService(repo);

      const result = await service.findForVariant('conn-1', 'ol_variant_a', {
        limit: 25,
        offset: 50,
      });

      expect(repo.findMany).toHaveBeenCalledWith(
        { connectionId: 'conn-1', internalId: 'ol_variant_a' },
        { limit: 25, offset: 50 }
      );
      expect(result).toBe(page);
    });

    it('should default pagination to { limit: 100, offset: 0 } when omitted', async () => {
      const repo = buildRepoMock();
      repo.findMany.mockResolvedValue({ items: [], total: 0 });
      const service = new OfferMappingsService(repo);

      await service.findForVariant('conn-1', 'ol_variant_a');

      expect(repo.findMany).toHaveBeenCalledWith(
        { connectionId: 'conn-1', internalId: 'ol_variant_a' },
        { limit: 100, offset: 0 }
      );
    });
  });

  describe('countForVariants', () => {
    it('should return an empty map without hitting the repository when variantIds is empty', async () => {
      const repo = buildRepoMock();
      const service = new OfferMappingsService(repo);

      const result = await service.countForVariants('conn-1', []);

      expect(result).toEqual(new Map());
      expect(repo.countByConnectionAndVariants).not.toHaveBeenCalled();
    });

    it('should forward (connectionId, variantIds) to repository and return the map verbatim', async () => {
      const repo = buildRepoMock();
      const counts = new Map([
        ['ol_variant_a', 2],
        ['ol_variant_b', 1],
      ]);
      repo.countByConnectionAndVariants.mockResolvedValue(counts);
      const service = new OfferMappingsService(repo);

      const result = await service.countForVariants('conn-1', ['ol_variant_a', 'ol_variant_b']);

      expect(repo.countByConnectionAndVariants).toHaveBeenCalledWith('conn-1', [
        'ol_variant_a',
        'ol_variant_b',
      ]);
      expect(result).toBe(counts);
    });
  });

  describe('countListedVariantsByProducts (#1720)', () => {
    it('should return [] without hitting the repository when productIds is empty', async () => {
      const repo = buildRepoMock();
      const service = new OfferMappingsService(repo);

      const result = await service.countListedVariantsByProducts([]);

      expect(result).toEqual([]);
      expect(repo.countListedVariantsByProducts).not.toHaveBeenCalled();
    });

    it('should forward productIds to the repository and return its rows verbatim', async () => {
      const repo = buildRepoMock();
      const rows = [
        {
          productId: 'ol_product_1',
          connectionId: 'conn-1',
          platformType: 'allegro',
          listedVariants: 2,
        },
      ];
      repo.countListedVariantsByProducts.mockResolvedValue(rows);
      const service = new OfferMappingsService(repo);

      const result = await service.countListedVariantsByProducts(['ol_product_1', 'ol_product_2']);

      expect(repo.countListedVariantsByProducts).toHaveBeenCalledWith([
        'ol_product_1',
        'ol_product_2',
      ]);
      expect(result).toBe(rows);
    });

    it('should reject input exceeding the 200-id cap without hitting the repository', async () => {
      const repo = buildRepoMock();
      const service = new OfferMappingsService(repo);
      const oversize = Array.from({ length: 201 }, (_, i) => `ol_product_${String(i)}`);

      await expect(service.countListedVariantsByProducts(oversize)).rejects.toThrow(
        /at most 200 productIds/
      );
      expect(repo.countListedVariantsByProducts).not.toHaveBeenCalled();
    });
  });
});
