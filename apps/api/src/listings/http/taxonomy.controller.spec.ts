/**
 * Destination Taxonomy Controller — unit spec
 *
 * Thin-wrapper behaviour: delegation, response mapping, and non-swallowing of
 * the domain exception the global filter maps to 422 (#2074).
 *
 * @module apps/api/src/listings/http
 */
import { TaxonomySourceUnavailableException } from '@openlinker/core/listings';
import { TaxonomyController } from './taxonomy.controller';

const CONN = 'conn-1';

function category(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taxonomyOwner: 'allegro',
    connectionId: null,
    externalId: '258066',
    name: 'Smartfony',
    parentId: '258060',
    leaf: true,
    syncedAt: new Date('2026-08-14T00:00:00Z'),
    ...over,
  };
}

describe('TaxonomyController', () => {
  let taxonomyService: { browse: jest.Mock; search: jest.Mock; path: jest.Mock };
  let controller: TaxonomyController;

  beforeEach(() => {
    taxonomyService = {
      browse: jest.fn().mockResolvedValue([]),
      search: jest.fn().mockResolvedValue([]),
      path: jest.fn().mockResolvedValue([]),
    };
    controller = new TaxonomyController(taxonomyService as never);
  });

  describe('browseCategories', () => {
    it('should map a projected category onto the response shape', async () => {
      taxonomyService.browse.mockResolvedValue([category()]);

      await expect(controller.browseCategories(CONN, '258060')).resolves.toEqual([
        { id: '258066', name: 'Smartfony', parentId: '258060', leaf: true },
      ]);
      expect(taxonomyService.browse).toHaveBeenCalledWith(CONN, '258060');
    });

    it('should pass undefined through for a root-level browse', async () => {
      await controller.browseCategories(CONN, undefined);

      expect(taxonomyService.browse).toHaveBeenCalledWith(CONN, undefined);
    });

    it('should preserve a null leaf for a shop node', async () => {
      // A shop accepts a product in any node, so it has no leaf concept
      // (ADR-024). Coercing null to false here would assert the node has
      // children, which is a different claim.
      taxonomyService.browse.mockResolvedValue([
        category({ taxonomyOwner: null, connectionId: CONN, leaf: null }),
      ]);

      const [node] = await controller.browseCategories(CONN);

      expect(node?.leaf).toBeNull();
    });

    it('should return an empty array when the taxonomy has not synced', async () => {
      // Not an error: the projection is as fresh as the last sync, and the
      // caller cannot tell "no categories" from "not walked yet" (ADR-037).
      // #2075 renders these as distinct empty states off this contract.
      await expect(controller.browseCategories(CONN)).resolves.toEqual([]);
    });

    it('should let a missing taxonomy source reach the global filter unchanged', async () => {
      // The 422 mapping lives in `TaxonomySourceUnavailableFilter`, not here:
      // the same exception is reachable from the repointed marketplace routes on
      // MappingOptionsController, and a per-controller catch would have left
      // those returning 500. The controller's job is to NOT swallow it.
      taxonomyService.browse.mockRejectedValue(
        new TaxonomySourceUnavailableException(CONN, 'no capability'),
      );

      await expect(controller.browseCategories(CONN)).rejects.toBeInstanceOf(
        TaxonomySourceUnavailableException,
      );
    });

    it('should let an unrelated error propagate unchanged', async () => {
      const boom = new Error('redis down');
      taxonomyService.browse.mockRejectedValue(boom);

      await expect(controller.browseCategories(CONN)).rejects.toBe(boom);
    });
  });

  describe('searchCategories', () => {
    it('should return each hit with its breadcrumb', async () => {
      taxonomyService.search.mockResolvedValue([
        {
          category: category(),
          path: [
            { id: '258060', name: 'Elektronika' },
            { id: '258066', name: 'Smartfony' },
          ],
        },
      ]);

      await expect(controller.searchCategories(CONN, { q: 'smart' })).resolves.toEqual([
        {
          category: { id: '258066', name: 'Smartfony', parentId: '258060', leaf: true },
          path: [
            { id: '258060', name: 'Elektronika' },
            { id: '258066', name: 'Smartfony' },
          ],
        },
      ]);
    });

    it('should forward the validated limit', async () => {
      await controller.searchCategories(CONN, { q: 'buty', limit: 5 });

      expect(taxonomyService.search).toHaveBeenCalledWith(CONN, 'buty', 5);
    });

    it('should leave the limit undefined when omitted so the service default applies', async () => {
      await controller.searchCategories(CONN, { q: 'buty' });

      expect(taxonomyService.search).toHaveBeenCalledWith(CONN, 'buty', undefined);
    });

    it('should let a missing taxonomy source propagate on search too', async () => {
      taxonomyService.search.mockRejectedValue(
        new TaxonomySourceUnavailableException(CONN, 'no capability'),
      );

      await expect(controller.searchCategories(CONN, { q: 'smart' })).rejects.toBeInstanceOf(
        TaxonomySourceUnavailableException,
      );
    });
  });
});
