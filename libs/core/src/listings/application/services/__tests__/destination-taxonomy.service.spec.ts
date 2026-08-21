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
import type {
  DestinationCategoryUpsert,
  TaxonomyScope,
} from '../../../domain/types/destination-category.types';

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

/** Declares a taxonomy identity but ships no `fetchCategories` (ADR-031 shape). */
function allegroOfferManagerNoBrowse(): Adapters {
  return { OfferManager: { getTaxonomyIdentity: (): string => 'allegro' } };
}

function buildService(options: {
  adaptersByConnection: Record<string, Adapters>;
  repository?: Partial<DestinationCategoryRepositoryPort>;
  /** `false` makes `acquire` return null — another run holds the scope. */
  lockAcquires?: boolean;
}): {
  service: DestinationTaxonomyService;
  repository: jest.Mocked<DestinationCategoryRepositoryPort>;
  getCapabilityAdapter: jest.Mock;
  syncLock: { acquire: jest.Mock; release: jest.Mock };
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
    findExpandable: jest.fn().mockResolvedValue([]),
    markExpanded: jest.fn().mockResolvedValue(undefined),
    hasObserved: jest.fn().mockResolvedValue(false),
    deleteStaleBelow: jest.fn().mockResolvedValue(0),
    findPath: jest.fn().mockResolvedValue([]),
    ...options.repository,
  } as unknown as jest.Mocked<DestinationCategoryRepositoryPort>;

  const syncLock = {
    acquire: jest.fn().mockResolvedValue(options.lockAcquires === false ? null : 'token-1'),
    release: jest.fn().mockResolvedValue(true),
    extend: jest.fn().mockResolvedValue(true),
  };

  return {
    service: new DestinationTaxonomyService(integrationsService, repository, syncLock as never),
    repository,
    getCapabilityAdapter,
    syncLock,
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

  describe('path', () => {
    it('should read the breadcrumb from the projection, never the adapter', async () => {
      // The route this backs used to call `CategoryPathReader` live. ADR-037's
      // defining property is that reads do not touch the platform.
      const adapters = { [ALLEGRO_CONNECTION]: { OfferManager: allegroOfferManager() } };
      const { service, repository } = buildService({
        adaptersByConnection: adapters,
        repository: {
          findPath: jest.fn().mockResolvedValue([
            { id: 'a', name: 'Clothing' },
            { id: 'a1', name: 'Shoes' },
          ]),
        },
      });

      await expect(service.path(ALLEGRO_CONNECTION, 'a1')).resolves.toEqual([
        { id: 'a', name: 'Clothing' },
        { id: 'a1', name: 'Shoes' },
      ]);
      expect(repository.findPath).toHaveBeenCalledWith(
        { taxonomyOwner: 'allegro', connectionId: null },
        'a1',
      );
      const fetchCategories = adapters[ALLEGRO_CONNECTION].OfferManager
        ?.fetchCategories as jest.Mock;
      expect(fetchCategories).not.toHaveBeenCalled();
    });

    it('should return an empty path for an id the scope has never synced', async () => {
      const { service } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: { OfferManager: allegroOfferManager() } },
      });

      await expect(service.path(ALLEGRO_CONNECTION, 'unknown')).resolves.toEqual([]);
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
    /**
     * Faithful in-memory stand-in for the projection.
     *
     * Since #2061 the sync's progress IS the row state, so a mock returning
     * canned arrays could not express the behaviour under test — it would
     * assert that the service calls methods, not that the walk terminates or
     * that the sweep is authorised. This implements the port's real semantics
     * (upsert preserving `expandedAt`, the frontier predicate, the observation
     * count) so the loop is genuinely exercised. The Postgres equivalents are
     * pinned separately in `destination-taxonomy.int-spec.ts`.
     */
    interface FakeRow {
      parentId: string | null;
      leaf: boolean | null;
      syncedAt: number;
      expandedAt: number | null;
    }

    function inMemoryRepository(): DestinationCategoryRepositoryPort {
      const rows = new Map<string, FakeRow>();

      return {
        browse: jest.fn().mockResolvedValue([]),
        search: jest.fn().mockResolvedValue([]),
        deleteStaleBelow: jest.fn().mockResolvedValue(0),

        upsertMany: (
          _scope: TaxonomyScope,
          nodes: readonly DestinationCategoryUpsert[],
          syncedAt: Date,
        ): Promise<number> => {
          for (const node of nodes) {
            const existing = rows.get(node.externalId);
            rows.set(node.externalId, {
              parentId: node.parentId,
              leaf: node.leaf,
              syncedAt: syncedAt.getTime(),
              // The load-bearing invariant: an upsert NEVER resets expandedAt.
              expandedAt: existing?.expandedAt ?? null,
            });
          }
          return Promise.resolve(nodes.length);
        },

        findExpandable: (
          _scope: TaxonomyScope,
          runStartedAt: Date,
          limit: number,
        ): Promise<string[]> => {
          const run = runStartedAt.getTime();
          const hits = [...rows.entries()]
            .filter(
              ([, row]) =>
                row.syncedAt === run &&
                row.leaf !== true &&
                (row.expandedAt === null || row.expandedAt < run),
            )
            .map(([externalId]) => externalId)
            .sort();
          return Promise.resolve(hits.slice(0, limit));
        },

        markExpanded: (
          _scope: TaxonomyScope,
          externalIds: readonly string[],
          runStartedAt: Date,
        ): Promise<void> => {
          for (const externalId of externalIds) {
            const row = rows.get(externalId);
            if (row) {
              row.expandedAt = runStartedAt.getTime();
            }
          }
          return Promise.resolve();
        },

        hasObserved: (_scope: TaxonomyScope, runStartedAt: Date): Promise<boolean> =>
          Promise.resolve(
            [...rows.values()].some((row) => row.syncedAt === runStartedAt.getTime()),
          ),
      } as unknown as DestinationCategoryRepositoryPort;
    }

    interface Level {
      id: string;
      name: string;
      parentId: string | null;
      leaf: boolean;
    }

    const tree: Record<string, Level[]> = {
      root: [
        { id: 'a', name: 'Odzież', parentId: null, leaf: false },
        { id: 'b', name: 'Elektronika', parentId: null, leaf: true },
      ],
      a: [{ id: 'a1', name: 'Buty', parentId: 'a', leaf: true }],
    };

    function allegroWithTree(levels: Record<string, Level[]> = tree): Adapters {
      return {
        OfferManager: allegroOfferManager({
          fetchCategories: jest.fn((parentId?: string) =>
            Promise.resolve(levels[parentId ?? 'root'] ?? []),
          ),
        }),
      };
    }

    /** Drive a run to completion the way the worker handler does. */
    async function runToCompletion(
      service: DestinationTaxonomyService,
      pageLimit?: number,
      maxTicks = 20,
    ): Promise<{ ticks: number; completed: boolean }> {
      let runStartedAt: string | null = null;
      for (let tick = 1; tick <= maxTicks; tick += 1) {
        const result = await service.syncTaxonomy(ALLEGRO_CONNECTION, { runStartedAt, pageLimit });
        if (result.completed) {
          return { ticks: tick, completed: true };
        }
        runStartedAt = result.nextRunStartedAt;
      }
      return { ticks: maxTicks, completed: false };
    }

    it('should walk the whole tree and sweep disappearance when it completes', async () => {
      const repository = inMemoryRepository();
      const { service } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: allegroWithTree() },
        repository,
      });

      const { completed } = await runToCompletion(service);

      expect(completed).toBe(true);
      expect(repository.deleteStaleBelow).toHaveBeenCalledTimes(1);
    });

    it('should not expand a leaf node', async () => {
      const adapters = allegroWithTree();
      const { service } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: adapters },
        repository: inMemoryRepository(),
      });

      await runToCompletion(service);

      const fetchCategories = adapters.OfferManager?.fetchCategories as jest.Mock;
      const requested = (fetchCategories.mock.calls as unknown[][]).map((call) => call[0]);
      expect(requested).not.toContain('b');
      expect(requested).not.toContain('a1');
    });

    it('should carry the run watermark forward and NOT sweep before it completes', async () => {
      const repository = inMemoryRepository();
      const { service } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: allegroWithTree() },
        repository,
      });

      const result = await service.syncTaxonomy(ALLEGRO_CONNECTION, {
        runStartedAt: null,
        pageLimit: 1,
      });

      expect(result.completed).toBe(false);
      expect(result.nextRunStartedAt).not.toBeNull();
      expect(repository.deleteStaleBelow).not.toHaveBeenCalled();
    });

    it('should floor a zero page limit rather than sweeping an unwalked tree', async () => {
      // `??` passes a literal 0 through, and LIMIT 0 returns an empty frontier —
      // which reads as "complete" and would authorise the sweep. The handler
      // filters this, but the service is public API and the failure is silent.
      const repository = inMemoryRepository();
      const adapters = allegroWithTree();
      const { service } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: adapters },
        repository,
      });

      const result = await service.syncTaxonomy(ALLEGRO_CONNECTION, {
        runStartedAt: null,
        pageLimit: 0,
      });

      // One node expanded, so the run is NOT complete and nothing is swept.
      expect(result.completed).toBe(false);
      expect(repository.deleteStaleBelow).not.toHaveBeenCalled();
    });

    it('should expand a node reachable from two parents only ONCE, across pages', async () => {
      // The point of #2061. Wave 1's run-local Set covered this only inside one
      // page; with pageLimit 1 the shared child is reached from `a` on one page
      // and from `b` on another, so only the persisted `expandedAt` can stop
      // the second expansion.
      const shared: Record<string, Level[]> = {
        root: [
          { id: 'a', name: 'A', parentId: null, leaf: false },
          { id: 'b', name: 'B', parentId: null, leaf: false },
        ],
        a: [{ id: 'shared', name: 'Shared', parentId: 'a', leaf: false }],
        b: [{ id: 'shared', name: 'Shared', parentId: 'b', leaf: false }],
        shared: [],
      };
      const adapters = allegroWithTree(shared);
      const { service } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: adapters },
        repository: inMemoryRepository(),
      });

      const { completed } = await runToCompletion(service, 1);

      expect(completed).toBe(true);
      const fetchCategories = adapters.OfferManager?.fetchCategories as jest.Mock;
      const sharedExpansions = (fetchCategories.mock.calls as unknown[][]).filter(
        (call) => call[0] === 'shared',
      );
      expect(sharedExpansions).toHaveLength(1);
    });

    it('should terminate on a cyclic tree', async () => {
      const cyclic: Record<string, Level[]> = {
        root: [{ id: 'x', name: 'X', parentId: null, leaf: false }],
        x: [{ id: 'y', name: 'Y', parentId: 'x', leaf: false }],
        y: [{ id: 'x', name: 'X', parentId: 'y', leaf: false }],
      };
      const { service } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: allegroWithTree(cyclic) },
        repository: inMemoryRepository(),
      });

      const { completed } = await runToCompletion(service, 1);

      expect(completed).toBe(true);
    });

    it('should resume a stored run rather than restarting it', async () => {
      const adapters = allegroWithTree();
      const { service } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: adapters },
        repository: inMemoryRepository(),
      });

      const first = await service.syncTaxonomy(ALLEGRO_CONNECTION, {
        runStartedAt: null,
        pageLimit: 1,
      });
      await service.syncTaxonomy(ALLEGRO_CONNECTION, {
        runStartedAt: first.nextRunStartedAt,
        pageLimit: 1,
      });

      const fetchCategories = adapters.OfferManager?.fetchCategories as jest.Mock;
      const rootBrowses = (fetchCategories.mock.calls as unknown[][]).filter(
        (call) => call[0] === undefined,
      );
      // A resumed run must not re-browse the roots — that is what "portable"
      // buys over Wave 1, where a re-election restarted from scratch.
      expect(rootBrowses).toHaveLength(1);
    });

    it('should NOT sweep when the run observed nothing', async () => {
      // An empty root response (a transient platform hiccup) would otherwise
      // complete a run that saw zero rows and delete the entire scope.
      const repository = inMemoryRepository();
      const { service } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: allegroWithTree({ root: [] }) },
        repository,
      });

      const result = await service.syncTaxonomy(ALLEGRO_CONNECTION, { runStartedAt: null });

      expect(result.completed).toBe(true);
      expect(result.removed).toBe(0);
      expect(repository.deleteStaleBelow).not.toHaveBeenCalled();
    });

    it('should restart from the roots when the stored watermark is unparseable', async () => {
      // The Wave 1 upgrade path: a stored JSON frontier does not parse as a
      // timestamp, so the first run after deploy starts fresh instead of
      // sweeping against a watermark it cannot honour.
      const adapters = allegroWithTree();
      const { service } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: adapters },
        repository: inMemoryRepository(),
      });

      await service.syncTaxonomy(ALLEGRO_CONNECTION, {
        runStartedAt: '{"runStartedAt":"2026-08-13T10:00:00.000Z","pending":["a"]}',
      });

      const fetchCategories = adapters.OfferManager?.fetchCategories as jest.Mock;
      expect((fetchCategories.mock.calls as unknown[][])[0]?.[0]).toBeUndefined();
    });

    it('should restart from the roots when the stored run is past the freshness limit', async () => {
      const adapters = allegroWithTree();
      const { service } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: adapters },
        repository: inMemoryRepository(),
      });

      const stale = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      await service.syncTaxonomy(ALLEGRO_CONNECTION, { runStartedAt: stale });

      const fetchCategories = adapters.OfferManager?.fetchCategories as jest.Mock;
      expect((fetchCategories.mock.calls as unknown[][])[0]?.[0]).toBeUndefined();
    });

    it('should skip the tick when another run holds the scope lock', async () => {
      const repository = inMemoryRepository();
      const { service } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: allegroWithTree() },
        repository,
        lockAcquires: false,
      });

      const result = await service.syncTaxonomy(ALLEGRO_CONNECTION, {
        runStartedAt: '2026-08-13T10:00:00.000Z',
      });

      expect(result.completed).toBe(false);
      // The watermark is handed back untouched, so the holder's run continues.
      expect(result.nextRunStartedAt).toBe('2026-08-13T10:00:00.000Z');
      expect(repository.deleteStaleBelow).not.toHaveBeenCalled();
    });

    it('should not let a lock-release failure mask the run result', async () => {
      // A bare `await release()` in the finally would replace the successful
      // result with the Redis error, sending an operator to debug the wrong
      // system. Mirrors the `orderCreateLock` precedent.
      const { service, syncLock } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: allegroWithTree() },
        repository: inMemoryRepository(),
      });
      syncLock.release.mockRejectedValue(new Error('redis down'));

      await expect(
        service.syncTaxonomy(ALLEGRO_CONNECTION, { runStartedAt: null }),
      ).resolves.toMatchObject({ completed: expect.any(Boolean) });
    });

    it('should not let a lock-release failure mask the run error', async () => {
      const { service, syncLock } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: allegroOfferManagerNoBrowse() },
        repository: inMemoryRepository(),
      });
      syncLock.release.mockRejectedValue(new Error('redis down'));

      // The REAL cause must survive, not the release failure.
      await expect(
        service.syncTaxonomy(ALLEGRO_CONNECTION, { runStartedAt: null }),
      ).rejects.toBeInstanceOf(TaxonomySourceUnavailableException);
    });

    it('should release the scope lock even when the run throws', async () => {
      const { service, syncLock } = buildService({
        adaptersByConnection: { [ALLEGRO_CONNECTION]: allegroOfferManagerNoBrowse() },
        repository: inMemoryRepository(),
      });

      await expect(
        service.syncTaxonomy(ALLEGRO_CONNECTION, { runStartedAt: null }),
      ).rejects.toBeInstanceOf(TaxonomySourceUnavailableException);

      expect(syncLock.release).toHaveBeenCalledTimes(1);
    });
  });
});
