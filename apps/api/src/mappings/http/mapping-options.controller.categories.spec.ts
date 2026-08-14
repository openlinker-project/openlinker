/**
 * Mapping Options Controller — category routes unit spec (#2074)
 *
 * Pins the Wave-2a repoint: the two MARKETPLACE category routes now read the
 * destination-taxonomy projection, and `destination/categories` deliberately
 * does not (it resolves `ProductMaster`, which the projection does not model —
 * see the controller's Categories section comment).
 *
 * The response DTOs are unchanged by design, so the mapping assertions here are
 * the contract that lets the repoint be invisible to the mappings page.
 *
 * @module apps/api/src/mappings/http
 */
import { MappingOptionsController } from './mapping-options.controller';

const CONN = 'conn-allegro';

describe('MappingOptionsController — categories', () => {
  let taxonomyService: { browse: jest.Mock; search: jest.Mock; path: jest.Mock };
  let categoriesCacheService: {
    getAllegroCategories: jest.Mock;
    getAllegroCategoryPath: jest.Mock;
    getPrestashopCategories: jest.Mock;
  };
  let controller: MappingOptionsController;

  beforeEach(() => {
    taxonomyService = {
      browse: jest.fn().mockResolvedValue([]),
      search: jest.fn().mockResolvedValue([]),
      path: jest.fn().mockResolvedValue([]),
    };
    categoriesCacheService = {
      getAllegroCategories: jest.fn().mockResolvedValue([]),
      getAllegroCategoryPath: jest.fn().mockResolvedValue([]),
      getPrestashopCategories: jest.fn().mockResolvedValue([]),
    };

    // Positional order matches the controller: integrations, categories cache,
    // taxonomy, connection port.
    controller = new MappingOptionsController(
      {} as never,
      categoriesCacheService as never,
      taxonomyService as never,
      {} as never,
    );
  });

  describe('getSourceCategories', () => {
    it('should read the projection and keep the existing response shape', async () => {
      taxonomyService.browse.mockResolvedValue([
        {
          taxonomyOwner: 'allegro',
          connectionId: null,
          externalId: '258066',
          name: 'Smartfony',
          parentId: '258060',
          leaf: true,
          syncedAt: new Date('2026-08-14T00:00:00Z'),
        },
      ]);

      await expect(controller.getSourceCategories(CONN, '258060')).resolves.toEqual([
        { id: '258066', name: 'Smartfony', parentId: '258060', leaf: true },
      ]);
      expect(taxonomyService.browse).toHaveBeenCalledWith(CONN, '258060');
    });

    it('should NOT call the legacy cache service', async () => {
      // The whole point of the repoint: one reader for the marketplace tree.
      await controller.getSourceCategories(CONN);

      expect(categoriesCacheService.getAllegroCategories).not.toHaveBeenCalled();
    });

    it('should return an empty array when the taxonomy has not synced', async () => {
      // Behaviour change from the old lazily-filling cache, and the one worth
      // knowing about: the projection is as fresh as the last sync (ADR-037).
      await expect(controller.getSourceCategories(CONN)).resolves.toEqual([]);
    });
  });

  describe('getSourceCategoryPath', () => {
    it('should read the breadcrumb from the projection, not the adapter', async () => {
      taxonomyService.path.mockResolvedValue([
        { id: '258060', name: 'Elektronika' },
        { id: '258066', name: 'Smartfony' },
      ]);

      await expect(controller.getSourceCategoryPath(CONN, '258066')).resolves.toEqual([
        { id: '258060', name: 'Elektronika' },
        { id: '258066', name: 'Smartfony' },
      ]);
      expect(taxonomyService.path).toHaveBeenCalledWith(CONN, '258066');
      expect(categoriesCacheService.getAllegroCategoryPath).not.toHaveBeenCalled();
    });
  });

  describe('getDestinationCategories', () => {
    it('should still read the master catalog through the cache service', async () => {
      // Deliberately NOT repointed: it resolves ProductMaster, a third taxonomy
      // kind the projection does not model, and its DTO carries depth/active
      // which have no column. This assertion is what keeps that decision
      // visible — Wave 3 cannot delete CategoriesCacheService until it changes.
      await controller.getDestinationCategories('conn-presta');

      expect(categoriesCacheService.getPrestashopCategories).toHaveBeenCalledWith('conn-presta');
      expect(taxonomyService.browse).not.toHaveBeenCalled();
    });
  });
});
