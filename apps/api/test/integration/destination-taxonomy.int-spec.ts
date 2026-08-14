/**
 * Destination Taxonomy Projection — integration tests (#1979, ADR-037)
 *
 * Exercises the projection against a real Postgres, because the three things
 * most worth proving are all database behaviour that a unit test with a mocked
 * repository cannot reach:
 *
 *  - the exactly-one-of-scope invariant, enforced by two PARTIAL unique indexes
 *    (a plain composite unique would let NULLs duplicate rows);
 *  - the upsert's `ON CONFLICT ... WHERE <predicate>` conflict target, which
 *    fails at runtime if the index predicate and the statement disagree;
 *  - `search`, whose whole point is finding a DEEP category from the root — the
 *    thing the pre-#1979 level-scoped pickers could not do.
 *
 * Seeding goes through the repository rather than the ORM entity, which is what
 * lets `listings` avoid adding an `orm-entities` sub-barrel (and so a new
 * `libs/core/package.json` export) purely for tests. See `TaxonomyRepositoryHandle`
 * for why the port type itself is not imported.
 *
 * @module apps/api/test/integration
 */
import {
  DESTINATION_CATEGORY_REPOSITORY_TOKEN,
  DESTINATION_TAXONOMY_SERVICE_TOKEN,
  TaxonomySourceUnavailableException,
  type IDestinationTaxonomyService,
  type DestinationCategory,
  type DestinationCategorySearchHit,
  type DestinationCategoryUpsert,
  type TaxonomyScope,
  type CategoryPathSegment,
} from '@openlinker/core/listings';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { createTestConnection } from './helpers/test-connection.helper';

/**
 * Structural handle for the repository this spec resolves out of the container.
 *
 * `DestinationCategoryRepositoryPort` is deliberately NOT imported: a
 * `*RepositoryPort` is an intra-context contract and importing one across
 * contexts — `apps/api/test/**` included — is a deny shape enforced by
 * `check-cross-context-imports`. The Symbol token is an allowed shape, so the
 * spec binds to the token and declares the surface it uses.
 */
interface TaxonomyRepositoryHandle {
  browse(scope: TaxonomyScope, parentId: string | null): Promise<DestinationCategory[]>;
  search(
    scope: TaxonomyScope,
    query: string,
    limit: number,
  ): Promise<DestinationCategorySearchHit[]>;
  upsertMany(
    scope: TaxonomyScope,
    nodes: readonly DestinationCategoryUpsert[],
    syncedAt: Date,
  ): Promise<number>;
  deleteStaleBelow(scope: TaxonomyScope, syncedAt: Date): Promise<number>;
  findExpandable(scope: TaxonomyScope, runStartedAt: Date, limit: number): Promise<string[]>;
  markExpanded(
    scope: TaxonomyScope,
    externalIds: readonly string[],
    runStartedAt: Date,
  ): Promise<void>;
  hasObserved(scope: TaxonomyScope, runStartedAt: Date): Promise<boolean>;
  findPath(scope: TaxonomyScope, externalId: string): Promise<CategoryPathSegment[]>;
}


const ALLEGRO_SCOPE: TaxonomyScope = { taxonomyOwner: 'allegro', connectionId: null };
const SHOP_CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const SHOP_SCOPE: TaxonomyScope = { taxonomyOwner: null, connectionId: SHOP_CONNECTION_ID };

describe('Destination taxonomy projection (#1979)', () => {
  let harness: IntegrationTestHarness;
  let repository: TaxonomyRepositoryHandle;
  let service: IDestinationTaxonomyService;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness
      .getApp()
      .get<TaxonomyRepositoryHandle>(DESTINATION_CATEGORY_REPOSITORY_TOKEN);
    service = harness
      .getApp()
      .get<IDestinationTaxonomyService>(DESTINATION_TAXONOMY_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const seedAllegroTree = async (syncedAt: Date): Promise<void> => {
    await repository.upsertMany(
      ALLEGRO_SCOPE,
      [
        { externalId: 'root-1', name: 'Odzież', parentId: null, leaf: false },
        { externalId: 'child-1', name: 'Buty sportowe', parentId: 'root-1', leaf: true },
        { externalId: 'root-2', name: 'Elektronika', parentId: null, leaf: true },
      ],
      syncedAt,
    );
  };

  describe('scope keying', () => {
    it('should store a marketplace tree once no matter how many times it is synced', async () => {
      await seedAllegroTree(new Date('2026-01-01T00:00:00Z'));
      // A second connection to the same marketplace syncs the SAME owner scope.
      await seedAllegroTree(new Date('2026-01-02T00:00:00Z'));

      const roots = await repository.browse(ALLEGRO_SCOPE, null);

      expect(roots.map((category) => category.externalId).sort()).toEqual(['root-1', 'root-2']);
    });

    it('should keep an owner tree and a shop tree with colliding ids separate', async () => {
      // Both scopes legitimately use the id "root-1"; the partial unique indexes
      // must treat them as different rows, not a conflict.
      await seedAllegroTree(new Date('2026-01-01T00:00:00Z'));
      await repository.upsertMany(
        SHOP_SCOPE,
        [{ externalId: 'root-1', name: 'Shirts', parentId: null, leaf: null }],
        new Date('2026-01-01T00:00:00Z'),
      );

      const ownerRoots = await repository.browse(ALLEGRO_SCOPE, null);
      const shopRoots = await repository.browse(SHOP_SCOPE, null);

      expect(ownerRoots.find((c) => c.externalId === 'root-1')?.name).toBe('Odzież');
      expect(shopRoots.find((c) => c.externalId === 'root-1')?.name).toBe('Shirts');
      expect(shopRoots).toHaveLength(1);
    });

    it('should preserve a null leaf flag for a shop node and a boolean for a marketplace node', async () => {
      await seedAllegroTree(new Date('2026-01-01T00:00:00Z'));
      await repository.upsertMany(
        SHOP_SCOPE,
        [{ externalId: 'shop-1', name: 'Shirts', parentId: null, leaf: null }],
        new Date('2026-01-01T00:00:00Z'),
      );

      const [shopNode] = await repository.browse(SHOP_SCOPE, null);
      const ownerNodes = await repository.browse(ALLEGRO_SCOPE, null);

      expect(shopNode.leaf).toBeNull();
      expect(ownerNodes.find((c) => c.externalId === 'root-2')?.leaf).toBe(true);
    });
  });

  describe('upsert', () => {
    it('should tolerate a duplicated externalId within one batch', async () => {
      // Postgres rejects an ON CONFLICT that matches the same row twice in one
      // statement, so an adapter returning a duplicate would crash the sync.
      await expect(
        repository.upsertMany(
          ALLEGRO_SCOPE,
          [
            { externalId: 'dup', name: 'First', parentId: null, leaf: true },
            { externalId: 'dup', name: 'Second', parentId: null, leaf: true },
          ],
          new Date('2026-01-01T00:00:00Z'),
        ),
      ).resolves.toBe(1);

      const roots = await repository.browse(ALLEGRO_SCOPE, null);
      expect(roots).toHaveLength(1);
      expect(roots[0].name).toBe('Second');
    });

    it('should update an existing node in place rather than duplicating it', async () => {
      await seedAllegroTree(new Date('2026-01-01T00:00:00Z'));

      await repository.upsertMany(
        ALLEGRO_SCOPE,
        [{ externalId: 'root-1', name: 'Odzież i obuwie', parentId: null, leaf: false }],
        new Date('2026-01-02T00:00:00Z'),
      );

      const roots = await repository.browse(ALLEGRO_SCOPE, null);
      const renamed = roots.filter((category) => category.externalId === 'root-1');
      expect(renamed).toHaveLength(1);
      expect(renamed[0].name).toBe('Odzież i obuwie');
    });

    it('should re-derive the search text when a node is renamed', async () => {
      await seedAllegroTree(new Date('2026-01-01T00:00:00Z'));
      await repository.upsertMany(
        ALLEGRO_SCOPE,
        [{ externalId: 'child-1', name: 'Kurtki zimowe', parentId: 'root-1', leaf: true }],
        new Date('2026-01-02T00:00:00Z'),
      );

      await expect(repository.search(ALLEGRO_SCOPE, 'kurtki', 20)).resolves.toHaveLength(1);
      await expect(repository.search(ALLEGRO_SCOPE, 'sportowe', 20)).resolves.toHaveLength(0);
    });
  });

  describe('browse', () => {
    it('should return only the requested level', async () => {
      await seedAllegroTree(new Date('2026-01-01T00:00:00Z'));

      const children = await repository.browse(ALLEGRO_SCOPE, 'root-1');

      expect(children.map((category) => category.externalId)).toEqual(['child-1']);
    });
  });

  describe('search', () => {
    it('should find a DEEP category from the root — the bug this model fixes', async () => {
      // Pre-#1979 the pickers filtered only the currently-loaded level, so this
      // returned nothing and an operator concluded the category did not exist.
      await seedAllegroTree(new Date('2026-01-01T00:00:00Z'));

      const hits = await repository.search(ALLEGRO_SCOPE, 'buty', 20);

      expect(hits).toHaveLength(1);
      expect(hits[0].category.externalId).toBe('child-1');
    });

    it('should match a diacritic-free query against an accented name', async () => {
      await seedAllegroTree(new Date('2026-01-01T00:00:00Z'));

      const hits = await repository.search(ALLEGRO_SCOPE, 'odziez', 20);

      expect(hits.map((hit) => hit.category.externalId)).toEqual(['root-1']);
    });

    it('should return a root -> leaf breadcrumb for each hit', async () => {
      await seedAllegroTree(new Date('2026-01-01T00:00:00Z'));

      const [hit] = await repository.search(ALLEGRO_SCOPE, 'buty', 20);

      expect(hit.path.map((segment) => segment.name)).toEqual(['Odzież', 'Buty sportowe']);
    });

    it('should not leak hits across scopes', async () => {
      await seedAllegroTree(new Date('2026-01-01T00:00:00Z'));

      await expect(repository.search(SHOP_SCOPE, 'buty', 20)).resolves.toEqual([]);
    });

    it('should treat a LIKE wildcard in the query as a literal', async () => {
      // `%` is a bound parameter but still a LIKE metacharacter, so without
      // escaping this would match every row in the scope.
      await seedAllegroTree(new Date('2026-01-01T00:00:00Z'));

      await expect(repository.search(ALLEGRO_SCOPE, '%', 20)).resolves.toEqual([]);
      await expect(repository.search(ALLEGRO_SCOPE, 'b_ty', 20)).resolves.toEqual([]);
    });

    it('should honour the limit', async () => {
      await seedAllegroTree(new Date('2026-01-01T00:00:00Z'));

      await repository.upsertMany(
        ALLEGRO_SCOPE,
        [
          { externalId: 'x1', name: 'Buty damskie', parentId: 'root-1', leaf: true },
          { externalId: 'x2', name: 'Buty męskie', parentId: 'root-1', leaf: true },
        ],
        new Date('2026-01-01T00:00:00Z'),
      );

      const hits = await repository.search(ALLEGRO_SCOPE, 'buty', 2);

      expect(hits).toHaveLength(2);
    });
  });

  describe('watermark sweep', () => {
    it('should delete only the rows a completing run did not observe', async () => {
      await seedAllegroTree(new Date('2026-01-01T00:00:00Z'));

      // A later run sees root-1 and child-1, but root-2 has been removed upstream.
      const secondRun = new Date('2026-02-01T00:00:00Z');
      await repository.upsertMany(
        ALLEGRO_SCOPE,
        [
          { externalId: 'root-1', name: 'Odzież', parentId: null, leaf: false },
          { externalId: 'child-1', name: 'Buty sportowe', parentId: 'root-1', leaf: true },
        ],
        secondRun,
      );
      const removed = await repository.deleteStaleBelow(ALLEGRO_SCOPE, secondRun);

      const roots = await repository.browse(ALLEGRO_SCOPE, null);
      expect(removed).toBe(1);
      expect(roots.map((category) => category.externalId)).toEqual(['root-1']);
    });

    it('should not sweep another scope', async () => {
      await repository.upsertMany(
        SHOP_SCOPE,
        [{ externalId: 'shop-1', name: 'Shirts', parentId: null, leaf: null }],
        new Date('2026-01-01T00:00:00Z'),
      );
      await seedAllegroTree(new Date('2026-01-01T00:00:00Z'));

      await repository.deleteStaleBelow(ALLEGRO_SCOPE, new Date('2026-03-01T00:00:00Z'));

      await expect(repository.browse(SHOP_SCOPE, null)).resolves.toHaveLength(1);
    });
  });

  describe('service wiring', () => {
    // The repository cases above bypass the service, so nothing else proves the
    // module actually resolves it — a missing provider or a mis-bound token
    // would leave every unit test green.
    it('should resolve IDestinationTaxonomyService from the container', () => {
      expect(service).toBeDefined();
      expect(typeof service.browse).toBe('function');
      expect(typeof service.search).toBe('function');
    });

    it('should reject a connection with no taxonomy capability', async () => {
      // A bare PrestaShop connection supports neither OfferManager nor
      // ProductPublisher, so scope resolution has nothing to key on. Asserted
      // end-to-end because the failure mode is a real operator misconfiguration.
      const connection = await createTestConnection(harness.getDataSource());

      await expect(service.resolveScope(connection.id)).rejects.toBeInstanceOf(
        TaxonomySourceUnavailableException,
      );
    });
  });

  describe('derived sync frontier (#2061)', () => {
    const node = (
      externalId: string,
      parentId: string | null,
      leaf: boolean | null,
    ): DestinationCategoryUpsert => ({ externalId, name: `n-${externalId}`, parentId, leaf });

    it('should match syncedAt = runStartedAt exactly across the Postgres round-trip', async () => {
      // The linchpin of the whole derivation, and the one assumption a mocked
      // repository cannot falsify: the frontier selects on timestamp EQUALITY,
      // so any precision loss between the bound JS Date and the stored
      // timestamptz would silently return an empty frontier — which reads as
      // "run complete" and would authorise a sweep.
      const runStartedAt = new Date('2026-08-13T10:00:00.123Z');
      await repository.upsertMany(ALLEGRO_SCOPE, [node('a', null, false)], runStartedAt);

      await expect(repository.hasObserved(ALLEGRO_SCOPE, runStartedAt)).resolves.toBe(true);
      await expect(
        repository.findExpandable(ALLEGRO_SCOPE, runStartedAt, 10),
      ).resolves.toEqual(['a']);
    });

    it('should exclude leaves and already-expanded nodes from the frontier', async () => {
      const runStartedAt = new Date('2026-08-13T11:00:00.000Z');
      await repository.upsertMany(
        ALLEGRO_SCOPE,
        [node('branch', null, false), node('leaf', null, true), node('done', null, false)],
        runStartedAt,
      );
      await repository.markExpanded(ALLEGRO_SCOPE, ['done'], runStartedAt);

      await expect(
        repository.findExpandable(ALLEGRO_SCOPE, runStartedAt, 10),
      ).resolves.toEqual(['branch']);
    });

    it('should treat a shop node (leaf null) as expandable', async () => {
      // A shop tree has no leaf concept (ADR-024), so `leaf IS NOT TRUE` must
      // admit NULL or a shop's tree would never be walked past its roots.
      const runStartedAt = new Date('2026-08-13T12:00:00.000Z');
      await repository.upsertMany(SHOP_SCOPE, [node('s1', null, null)], runStartedAt);

      await expect(repository.findExpandable(SHOP_SCOPE, runStartedAt, 10)).resolves.toEqual([
        's1',
      ]);
    });

    it('should NOT reset expandedAt when a node is re-upserted by a second parent', async () => {
      // The invariant that makes the walk terminate. If the ON CONFLICT DO
      // UPDATE list ever grows an "expandedAt" entry, this fails — which is the
      // point, because the alternative is an infinite run in production.
      const runStartedAt = new Date('2026-08-13T13:00:00.000Z');
      await repository.upsertMany(ALLEGRO_SCOPE, [node('shared', 'a', false)], runStartedAt);
      await repository.markExpanded(ALLEGRO_SCOPE, ['shared'], runStartedAt);

      // Re-upserted as a child of a different parent, same run.
      await repository.upsertMany(ALLEGRO_SCOPE, [node('shared', 'b', false)], runStartedAt);

      await expect(repository.findExpandable(ALLEGRO_SCOPE, runStartedAt, 10)).resolves.toEqual(
        [],
      );
    });

    it('should re-admit a node expanded by an OLDER run', async () => {
      // expandedAt is per-run, not permanent: the next run must walk the tree
      // again or the projection would freeze after its first sync.
      const firstRun = new Date('2026-08-13T14:00:00.000Z');
      const secondRun = new Date('2026-08-13T15:00:00.000Z');
      await repository.upsertMany(ALLEGRO_SCOPE, [node('a', null, false)], firstRun);
      await repository.markExpanded(ALLEGRO_SCOPE, ['a'], firstRun);

      await repository.upsertMany(ALLEGRO_SCOPE, [node('a', null, false)], secondRun);

      await expect(repository.findExpandable(ALLEGRO_SCOPE, secondRun, 10)).resolves.toEqual([
        'a',
      ]);
    });

    it('should scope the frontier so one owner cannot see another tree', async () => {
      const runStartedAt = new Date('2026-08-13T16:00:00.000Z');
      await repository.upsertMany(ALLEGRO_SCOPE, [node('owned', null, false)], runStartedAt);
      await repository.upsertMany(SHOP_SCOPE, [node('shopped', null, null)], runStartedAt);

      await expect(
        repository.findExpandable(ALLEGRO_SCOPE, runStartedAt, 10),
      ).resolves.toEqual(['owned']);
      await expect(repository.findExpandable(SHOP_SCOPE, runStartedAt, 10)).resolves.toEqual([
        'shopped',
      ]);
    });

    it('should bound the frontier by limit and order it deterministically', async () => {
      const runStartedAt = new Date('2026-08-13T17:00:00.000Z');
      await repository.upsertMany(
        ALLEGRO_SCOPE,
        [node('c', null, false), node('a', null, false), node('b', null, false)],
        runStartedAt,
      );

      await expect(repository.findExpandable(ALLEGRO_SCOPE, runStartedAt, 2)).resolves.toEqual([
        'a',
        'b',
      ]);
    });
  });
  describe('breadcrumb reads (#2074)', () => {
    const node = (
      externalId: string,
      parentId: string | null,
      name: string,
    ): DestinationCategoryUpsert => ({ externalId, name, parentId, leaf: parentId !== null });

    it('should derive a root-to-leaf breadcrumb for a nested node', async () => {
      const syncedAt = new Date('2026-08-14T09:00:00.000Z');
      await repository.upsertMany(
        ALLEGRO_SCOPE,
        [node('root', null, 'Electronics'), node('mid', 'root', 'Phones'), node('leaf', 'mid', 'Smartphones')],
        syncedAt,
      );

      await expect(repository.findPath(ALLEGRO_SCOPE, 'leaf')).resolves.toEqual([
        { id: 'root', name: 'Electronics' },
        { id: 'mid', name: 'Phones' },
        { id: 'leaf', name: 'Smartphones' },
      ]);
    });

    it('should return a single segment for a root node', async () => {
      const syncedAt = new Date('2026-08-14T09:10:00.000Z');
      await repository.upsertMany(ALLEGRO_SCOPE, [node('solo', null, 'Books')], syncedAt);

      await expect(repository.findPath(ALLEGRO_SCOPE, 'solo')).resolves.toEqual([
        { id: 'solo', name: 'Books' },
      ]);
    });

    it('should return an empty path for an unknown id rather than throwing', async () => {
      // A caller cannot distinguish "unknown id" from "not walked yet", so the
      // repository must not force it to. #2075 renders the empty state.
      await expect(repository.findPath(ALLEGRO_SCOPE, 'never-synced')).resolves.toEqual([]);
    });

    it('should not cross scopes when resolving a breadcrumb', async () => {
      const syncedAt = new Date('2026-08-14T09:20:00.000Z');
      await repository.upsertMany(ALLEGRO_SCOPE, [node('shared', null, 'Owner tree')], syncedAt);

      await expect(repository.findPath(SHOP_SCOPE, 'shared')).resolves.toEqual([]);
    });

    it('should terminate on a cyclic parentId instead of recursing forever', async () => {
      // Reachable, not hypothetical: the upsert reassigns `parentId` on conflict
      // and re-parenting is a documented normal case, so two individually-valid
      // observations across a paged sync (A under B, then B under A after the
      // platform reorganizes) leave a cycle. #2061's `expandedAt` guard
      // terminates the SYNC; nothing protected this READ. With no
      // statement_timeout configured, an unbounded walk pins a pooled connection
      // indefinitely — so this asserts termination, not a specific path.
      const syncedAt = new Date('2026-08-14T09:30:00.000Z');
      await repository.upsertMany(
        ALLEGRO_SCOPE,
        [
          { externalId: 'cyc-a', name: 'A', parentId: 'cyc-b', leaf: false },
          { externalId: 'cyc-b', name: 'B', parentId: 'cyc-a', leaf: false },
        ],
        syncedAt,
      );

      const path = await repository.findPath(ALLEGRO_SCOPE, 'cyc-a');

      // 65 = the seed row at depth 0 plus depths 1..64 admitted by `depth < 64`.
      // The exact number is incidental; what this pins is that it is FINITE.
      expect(path.length).toBeGreaterThan(0);
      expect(path.length).toBeLessThanOrEqual(65);
    }, 20_000);
  });
});
