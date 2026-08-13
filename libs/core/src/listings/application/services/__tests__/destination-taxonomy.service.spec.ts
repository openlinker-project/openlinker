/**
 * Destination Taxonomy Service — unit tests (#1979, ADR-037)
 *
 * Covers the two invariants the read model rests on: scope resolution is
 * capability-driven (so a borrowing destination shares the owner's rows and two
 * connections to one marketplace never duplicate a tree), and reads NEVER touch
 * the live platform.
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';

import { DestinationTaxonomyService } from '../destination-taxonomy.service';
import { TaxonomySourceUnavailableException } from '../../../domain/exceptions/taxonomy-source-unavailable.exception';
import type { DestinationCategoryRepositoryPort } from '../../../domain/ports/destination-category-repository.port';

const ALLEGRO_CONNECTION = 'conn-allegro-1';
const ALLEGRO_CONNECTION_2 = 'conn-allegro-2';
const ERLI_CONNECTION = 'conn-erli';
const SHOP_CONNECTION = 'conn-woo';

interface Adapters {
  OfferManager?: Record<string, unknown>;
  ProductPublisher?: Record<string, unknown>;
}

/**
 * An OWNING marketplace adapter. Since #2063 identity is declared, never
 * inferred from `platformType` — so a fake that only browses resolves to `null`
 * and is (correctly) treated as having no taxonomy source.
 */
function allegroOfferManager(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { fetchCategories: jest.fn(), getTaxonomyIdentity: () => 'allegro', ...extra };
}

function buildService(options: {
  adaptersByConnection: Record<string, Adapters>;
  repository?: Partial<DestinationCategoryRepositoryPort>;
}): {
  service: DestinationTaxonomyService;
  repository: jest.Mocked<DestinationCategoryRepositoryPort>;
  getCapabilityAdapter: jest.Mock;
} {
  const getCapabilityAdapter = jest.fn(
    (connectionId: string, capability: string): Promise<Record<string, unknown>> => {
      const adapter = options.adaptersByConnection[connectionId]?.[capability as keyof Adapters];
      if (!adapter) {
        return Promise.reject(
          new Error(`Capability ${capability} not supported by ${connectionId}`),
        );
      }
      return Promise.resolve(adapter);
    },
  );

  const integrationsService = {
    getCapabilityAdapter,
    getAdapter: jest.fn((connectionId: string) =>
      Promise.resolve({
        connection: { id: connectionId, platformType: 'x' },
        metadata: {},
      }),
    ),
    listCapabilityAdapters: jest.fn(),
    resolveAdapterMetadata: jest.fn(),
  } as unknown as IIntegrationsService;

  const repository: jest.Mocked<DestinationCategoryRepositoryPort> = {
    browse: jest.fn().mockResolvedValue([]),
    search: jest.fn().mockResolvedValue([]),
    upsertMany: jest.fn().mockResolvedValue(0),
    deleteStaleBelow: jest.fn().mockResolvedValue(0),
    ...options.repository,
  } as unknown as jest.Mocked<DestinationCategoryRepositoryPort>;

  return {
    service: new DestinationTaxonomyService(integrationsService, repository),
    repository,
    getCapabilityAdapter,
  };
}

describe('DestinationTaxonomyService', () => {
  describe('resolveScope', () => {
    it('should resolve an owning marketplace to its platform taxonomy owner', async () => {
      const { service } = buildService({
        adaptersByConnection: {
          [ALLEGRO_CONNECTION]: { OfferManager: allegroOfferManager() },
        },
      });

      await expect(service.resolveScope(ALLEGRO_CONNECTION)).resolves.toEqual({
        taxonomyOwner: 'allegro',
        connectionId: null,
      });
    });

    it('should resolve two connections to the same marketplace to ONE shared scope', async () => {
      // The correctness point of owner-keying: a marketplace tree must be
      // stored once, not once per seller connection.
      const { service } = buildService({
        adaptersByConnection: {
          [ALLEGRO_CONNECTION]: { OfferManager: allegroOfferManager() },
          [ALLEGRO_CONNECTION_2]: { OfferManager: allegroOfferManager() },
        },
      });

      expect(await service.resolveScope(ALLEGRO_CONNECTION)).toEqual(
        await service.resolveScope(ALLEGRO_CONNECTION_2),
      );
    });

    it('should resolve a borrowing destination to the owner it borrows from', async () => {
      // Erli accepts Allegro ids verbatim, so it reads Allegro's rows with no
      // special handling at the call site (#1045).
      const { service } = buildService({
        adaptersByConnection: {
          [ERLI_CONNECTION]: { OfferManager: { getBorrowedTaxonomy: () => 'allegro' } },
        },
      });

      await expect(service.resolveScope(ERLI_CONNECTION)).resolves.toEqual({
        taxonomyOwner: 'allegro',
        connectionId: null,
      });
    });

    it('should resolve a shop to a connection-keyed scope', async () => {
      const { service } = buildService({
        adaptersByConnection: {
          [SHOP_CONNECTION]: { ProductPublisher: { browseCategories: jest.fn() } },
        },
      });

      await expect(service.resolveScope(SHOP_CONNECTION)).resolves.toEqual({
        taxonomyOwner: null,
        connectionId: SHOP_CONNECTION,
      });
    });

    it('should throw when a browsing marketplace declares no taxonomy identity', async () => {
      // Guards the ADR's "one value per distinct tree" rule. Before #2063 this
      // adapter would have resolved from `platformType`; now an adapter that
      // browses but names no tree writes nothing, because guessing the owner
      // would be a data migration to undo.
      const { service } = buildService({
        adaptersByConnection: {
          'conn-ebay': { OfferManager: { fetchCategories: jest.fn() } },
        },
      });

      await expect(service.resolveScope('conn-ebay')).rejects.toBeInstanceOf(
        TaxonomySourceUnavailableException,
      );
    });

    it('should throw when the connection has no taxonomy capability at all', async () => {
      const { service } = buildService({ adaptersByConnection: { 'conn-plain': {} } });

      await expect(service.resolveScope('conn-plain')).rejects.toBeInstanceOf(
        TaxonomySourceUnavailableException,
      );
    });

    it('should memoise the scope so repeated reads do not re-probe the registry', async () => {
      const { service, getCapabilityAdapter } = buildService({
        adaptersByConnection: {
          [ALLEGRO_CONNECTION]: { OfferManager: allegroOfferManager() },
        },
      });

      await service.resolveScope(ALLEGRO_CONNECTION);
      const callsAfterFirst = getCapabilityAdapter.mock.calls.length;
      await service.resolveScope(ALLEGRO_CONNECTION);

      expect(getCapabilityAdapter.mock.calls.length).toBe(callsAfterFirst);
    });

    it('should resolve the scope for a borrower that cannot browse', async () => {
      // An Erli connection without catalogue credentials assigns no
      // `fetchCategories` (ADR-031). It can still READ the owner's rows — only
      // the refresh path is unavailable.
      const { service } = buildService({
        adaptersByConnection: {
          [ERLI_CONNECTION]: { OfferManager: { getBorrowedTaxonomy: () => 'allegro' } },
        },
      });

      await expect(service.resolveScope(ERLI_CONNECTION)).resolves.toEqual({
        taxonomyOwner: 'allegro',
        connectionId: null,
      });
    });
  });

  describe('browse / search', () => {
    it('should never call the live browse capability on a read', async () => {
      const fetchCategories = jest.fn();
      const { service } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: { OfferManager: allegroOfferManager({ fetchCategories }) } },
      });

      await service.browse(ALLEGRO_CONNECTION);
      await service.search(ALLEGRO_CONNECTION, 'buty');

      expect(fetchCategories).not.toHaveBeenCalled();
    });

    it('should read the owner scope for a borrowing connection', async () => {
      const { service, repository } = buildService({
        adaptersByConnection: {
          [ERLI_CONNECTION]: { OfferManager: { getBorrowedTaxonomy: () => 'allegro' } },
        },
      });

      await service.browse(ERLI_CONNECTION, 'cat-1');

      expect(repository.browse).toHaveBeenCalledWith(
        { taxonomyOwner: 'allegro', connectionId: null },
        'cat-1',
      );
    });

    it('should clamp an oversized search limit', async () => {
      // `search` is agent-reachable in Wave 4, so the limit is untrusted input.
      const { service, repository } = buildService({
        adaptersByConnection: {
          [ALLEGRO_CONNECTION]: { OfferManager: allegroOfferManager() },
        },
      });

      await service.search(ALLEGRO_CONNECTION, 'buty', 10_000);

      expect(repository.search).toHaveBeenCalledWith(expect.anything(), 'buty', 100);
    });

    it('should default the search limit when none is supplied', async () => {
      const { service, repository } = buildService({
        adaptersByConnection: {
          [ALLEGRO_CONNECTION]: { OfferManager: allegroOfferManager() },
        },
      });

      await service.search(ALLEGRO_CONNECTION, 'buty');

      expect(repository.search).toHaveBeenCalledWith(expect.anything(), 'buty', 20);
    });
  });

  describe('syncTaxonomy', () => {
    const tree: Record<string, { id: string; name: string; parentId: string | null; leaf: boolean }[]> =
      {
        root: [
          { id: 'a', name: 'Odzież', parentId: null, leaf: false },
          { id: 'b', name: 'Elektronika', parentId: null, leaf: true },
        ],
        a: [{ id: 'a1', name: 'Buty', parentId: 'a', leaf: true }],
      };

    function allegroWithTree(): Adapters {
      return {
        OfferManager: allegroOfferManager({
          fetchCategories: jest.fn((parentId?: string) =>
            Promise.resolve(tree[parentId ?? 'root'] ?? []),
          ),
        }),
      };
    }

    it('should walk the whole tree and sweep disappearance when it completes', async () => {
      const { service, repository } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: allegroWithTree() },
      });

      const result = await service.syncTaxonomy(ALLEGRO_CONNECTION, { frontier: null });

      expect(result.completed).toBe(true);
      expect(result.nextFrontier).toBeNull();
      expect(repository.deleteStaleBelow).toHaveBeenCalledTimes(1);
    });

    it('should not expand a leaf node', async () => {
      const adapters = allegroWithTree();
      const { service } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: adapters },
      });

      await service.syncTaxonomy(ALLEGRO_CONNECTION, { frontier: null });

      const fetchCategories = adapters.OfferManager?.fetchCategories as jest.Mock;
      const requested = (fetchCategories.mock.calls as unknown[][]).map((call) => call[0]);
      expect(requested).not.toContain('b');
      expect(requested).not.toContain('a1');
    });

    it('should return a resumable frontier and NOT sweep when the page limit is hit', async () => {
      // Sweeping mid-run would delete rows the run had not reached yet.
      const { service, repository } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: allegroWithTree() },
      });

      const result = await service.syncTaxonomy(ALLEGRO_CONNECTION, {
        frontier: null,
        pageLimit: 1,
      });

      expect(result.completed).toBe(false);
      expect(result.nextFrontier?.pending).toEqual(['a']);
      expect(repository.deleteStaleBelow).not.toHaveBeenCalled();
    });

    it('should reuse the original watermark when resuming so one run sweeps consistently', async () => {
      const { service, repository } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: allegroWithTree() },
      });

      // Must be recent: a frontier older than the max run age is deliberately
      // discarded so a resumed run cannot sweep against a dead watermark.
      const runStartedAt = new Date(Date.now() - 60_000).toISOString();
      const result = await service.syncTaxonomy(ALLEGRO_CONNECTION, {
        frontier: { runStartedAt, pending: ['a'] },
      });

      expect(result.completed).toBe(true);
      expect(repository.deleteStaleBelow).toHaveBeenCalledWith(
        expect.anything(),
        new Date(runStartedAt),
      );
      expect(repository.upsertMany).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        new Date(runStartedAt),
      );
    });

    it('should write shop nodes with a null leaf flag', async () => {
      // A shop accepts a product in any node, so it has no leaf concept (ADR-024).
      const { service, repository } = buildService({
        adaptersByConnection: {
          [SHOP_CONNECTION]: {
            ProductPublisher: {
              browseCategories: jest.fn((parentId?: string) =>
                Promise.resolve(
                  parentId === undefined ? [{ id: 'c1', name: 'Shirts', parentId: null }] : [],
                ),
              ),
            },
          },
        },
      });

      await service.syncTaxonomy(SHOP_CONNECTION, { frontier: null });

      expect(repository.upsertMany).toHaveBeenCalledWith(
        { taxonomyOwner: null, connectionId: SHOP_CONNECTION },
        [{ externalId: 'c1', name: 'Shirts', parentId: null, leaf: null }],
        expect.any(Date),
      );
    });

    it('should not re-expand a node reachable from two parents', async () => {
      // Without a dedupe the frontier grows faster than pageLimit drains it, so
      // the run never completes and the watermark sweep never fires.
      const shared: Record<string, { id: string; name: string; parentId: string | null; leaf: boolean }[]> =
        {
          root: [
            { id: 'p1', name: 'P1', parentId: null, leaf: false },
            { id: 'p2', name: 'P2', parentId: null, leaf: false },
          ],
          p1: [{ id: 'shared', name: 'Shared', parentId: 'p1', leaf: false }],
          p2: [{ id: 'shared', name: 'Shared', parentId: 'p2', leaf: false }],
          shared: [],
        };
      const fetchCategories = jest.fn((parentId?: string) =>
        Promise.resolve(shared[parentId ?? 'root'] ?? []),
      );
      const { service } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: { OfferManager: allegroOfferManager({ fetchCategories }) } },
      });

      const result = await service.syncTaxonomy(ALLEGRO_CONNECTION, { frontier: null });

      expect(result.completed).toBe(true);
      const expandedShared = (fetchCategories.mock.calls as unknown[][]).filter(
        (call) => call[0] === 'shared',
      );
      expect(expandedShared).toHaveLength(1);
    });

    it('should discard a stale frontier so the watermark sweep stays effective', async () => {
      // Resuming a weeks-old run would sweep against its own old watermark,
      // which matches nothing — disappearance detection would silently stop.
      const { service, repository } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: allegroWithTree() },
      });

      const staleStartedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const result = await service.syncTaxonomy(ALLEGRO_CONNECTION, {
        frontier: { runStartedAt: staleStartedAt, pending: ['a'] },
      });

      expect(result.completed).toBe(true);
      const sweptAt = repository.deleteStaleBelow.mock.calls[0][1];
      expect(sweptAt.toISOString()).not.toBe(staleStartedAt);
      expect(sweptAt.getTime()).toBeGreaterThan(Date.parse(staleStartedAt));
    });

    it('should throw when a borrowing connection cannot browse the owner taxonomy', async () => {
      const { service } = buildService({
        adaptersByConnection: {
          [ERLI_CONNECTION]: { OfferManager: { getBorrowedTaxonomy: () => 'allegro' } },
        },
      });

      await expect(
        service.syncTaxonomy(ERLI_CONNECTION, { frontier: null }),
      ).rejects.toBeInstanceOf(TaxonomySourceUnavailableException);
    });
  });
});
