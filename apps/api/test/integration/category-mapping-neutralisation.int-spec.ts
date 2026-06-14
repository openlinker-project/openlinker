/**
 * Category Mapping Neutralisation Integration Test (#1036)
 *
 * Verifies the neutralised `category_mappings` schema against real Postgres
 * (Testcontainers; migration `NeutraliseCategoryMappings1804000000000` applied
 * by the harness):
 *  - the two partial unique indexes enforce NULL-distinct semantics on the
 *    nullable `source_connection_id` (null-source branch vs source-scoped branch);
 *  - the `MappingConfigService` round-trip (upsert create → update → resolve)
 *    works end-to-end on the new shape.
 *
 * Backfill-branch coverage (0 / 1 / >1 PrestaShop connections) is via migration
 * review: the harness applies migrations once on an empty DB, so the backfill's
 * UPDATE is a no-op here and can't be exercised without a migration-replay rig.
 *
 * @module apps/api/test/integration
 */
import {
  IMappingConfigService,
  MAPPING_CONFIG_SERVICE_TOKEN,
} from '@openlinker/core/mappings';
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';

const INSERT = `
  INSERT INTO category_mappings
    (source_connection_id, destination_connection_id, source_category_id,
     destination_category_id, destination_category_name, destination_taxonomy_provenance)
  VALUES ($1, $2, $3, $4, $5, 'allegro')
`;

describe('Category Mapping Neutralisation Integration', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });
  afterEach(async () => {
    await resetTestHarness();
  });
  afterAll(async () => {
    await teardownTestHarness();
  });

  function getService(): IMappingConfigService {
    return harness.getApp().get<IMappingConfigService>(MAPPING_CONFIG_SERVICE_TOKEN);
  }

  async function seedDestination(): Promise<string> {
    const conn = await createTestConnection(harness.getDataSource(), {
      platformType: 'allegro',
      name: 'Allegro destination',
      adapterKey: 'allegro.publicapi.v1',
      enabledCapabilities: ['OfferManager'],
    });
    return conn.id;
  }

  async function seedSource(name: string): Promise<string> {
    const conn = await createTestConnection(harness.getDataSource(), {
      platformType: 'prestashop',
      name,
      adapterKey: 'prestashop.webservice.v1',
      enabledCapabilities: ['ProductMaster'],
    });
    return conn.id;
  }

  describe('partial unique indexes', () => {
    it('rejects a duplicate (destination, source category) when source connection is NULL', async () => {
      const ds = harness.getDataSource();
      const dest = await seedDestination();
      await ds.query(INSERT, [null, dest, 'cat-1', 'd-1', 'Cameras']);

      await expect(ds.query(INSERT, [null, dest, 'cat-1', 'd-2', 'Cameras 2'])).rejects.toThrow(
        /duplicate key|unique/i
      );
    });

    it('allows the same (destination, source category) for two different source connections', async () => {
      const ds = harness.getDataSource();
      const dest = await seedDestination();
      const srcA = await seedSource('PS store A');
      const srcB = await seedSource('PS store B');

      await ds.query(INSERT, [srcA, dest, 'cat-1', 'd-1', 'Cameras']);
      // Different source → permitted by the source-scoped partial index.
      await expect(ds.query(INSERT, [srcB, dest, 'cat-1', 'd-1', 'Cameras'])).resolves.toBeDefined();
      // Same source + (dest, cat) → rejected.
      await expect(ds.query(INSERT, [srcA, dest, 'cat-1', 'd-9', 'Other'])).rejects.toThrow(
        /duplicate key|unique/i
      );
    });
  });

  describe('MappingConfigService round-trip', () => {
    it('upserts (create then idempotent update) and resolves on the neutral shape', async () => {
      const service = getService();
      const dest = await seedDestination();

      const created = await service.upsertCategoryMapping(dest, {
        sourceCategoryId: 'cat-7',
        destinationCategoryId: 'allegro-7',
        destinationCategoryName: 'Phones',
        destinationCategoryPath: 'Electronics > Phones',
      });
      expect(created.destinationCategoryId).toBe('allegro-7');
      expect(created.destinationTaxonomyProvenance).toBe('allegro');
      expect(created.sourceConnectionId).toBeNull();

      // Re-upsert same (dest, source cat) updates in place — no duplicate row.
      const updated = await service.upsertCategoryMapping(dest, {
        sourceCategoryId: 'cat-7',
        destinationCategoryId: 'allegro-77',
        destinationCategoryName: 'Smartphones',
      });
      expect(updated.id).toBe(created.id);
      expect(updated.destinationCategoryId).toBe('allegro-77');

      const all = await service.getCategoryMappings(dest);
      expect(all).toHaveLength(1);

      expect(await service.resolveDestinationCategory(dest, 'cat-7')).toBe('allegro-77');
      expect(await service.resolveDestinationCategory(dest, 'missing')).toBeNull();
    });
  });
});
