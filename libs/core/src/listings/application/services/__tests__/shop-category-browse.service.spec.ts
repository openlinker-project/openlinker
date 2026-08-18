/**
 * Shop Category Browse Service Tests (#1834, rewritten for #2085)
 *
 * Unit tests for the projection delegation: parent-id forwarding, the
 * DestinationCategory -> ShopCategory mapping, error propagation, and the
 * invariant the delegation exists to establish — the live shop is never read.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */

import type { DestinationCategory } from '@openlinker/core/listings';

import type { IDestinationTaxonomyService } from '../../interfaces/destination-taxonomy.service.interface';

import { ShopCategoryBrowseService } from '../shop-category-browse.service';

describe('ShopCategoryBrowseService', () => {
  let service: ShopCategoryBrowseService;
  let taxonomy: jest.Mocked<IDestinationTaxonomyService>;

  const connectionId = 'conn-shop-1';

  const projected = (
    externalId: string,
    name: string,
    parentId: string | null,
  ): DestinationCategory =>
    ({
      taxonomyOwner: null,
      connectionId,
      externalId,
      name,
      parentId,
      leaf: null,
      syncedAt: new Date('2026-08-16T00:00:00.000Z'),
    } as DestinationCategory);

  beforeEach(() => {
    taxonomy = {
      browse: jest.fn(),
      search: jest.fn(),
      syncTaxonomy: jest.fn(),
      path: jest.fn(),
      resolveScope: jest.fn(),
    } as unknown as jest.Mocked<IDestinationTaxonomyService>;

    service = new ShopCategoryBrowseService(taxonomy);
  });

  it('should map projected categories to ShopCategory when browsing the root level', async () => {
    taxonomy.browse.mockResolvedValue([
      projected('10', 'Clothing', null),
      projected('11', 'Shoes', null),
    ]);

    const result = await service.browseCategories(connectionId);

    // Only the three ShopCategory fields survive — `leaf` and `syncedAt` are
    // projection bookkeeping and must not leak into the shop-facing shape (a
    // shop tree has no leaf gating, ADR-024).
    expect(result).toEqual([
      { id: '10', name: 'Clothing', parentId: null },
      { id: '11', name: 'Shoes', parentId: null },
    ]);
    expect(taxonomy.browse).toHaveBeenCalledWith(connectionId, undefined);
  });

  it('should forward the parentId to the projection read when drilling down', async () => {
    taxonomy.browse.mockResolvedValue([projected('20', 'Sneakers', '11')]);

    const result = await service.browseCategories(connectionId, '11');

    expect(taxonomy.browse).toHaveBeenCalledWith(connectionId, '11');
    expect(result).toEqual([{ id: '20', name: 'Sneakers', parentId: '11' }]);
  });

  it('should return an empty list when the scope has no rows yet', async () => {
    taxonomy.browse.mockResolvedValue([]);

    await expect(service.browseCategories(connectionId)).resolves.toEqual([]);
  });

  it('should propagate scope-resolution failures (no taxonomy source / connection disabled)', async () => {
    taxonomy.browse.mockRejectedValue(new Error('TaxonomySourceUnavailableException'));

    await expect(service.browseCategories(connectionId)).rejects.toThrow(
      'TaxonomySourceUnavailableException',
    );
  });
});
