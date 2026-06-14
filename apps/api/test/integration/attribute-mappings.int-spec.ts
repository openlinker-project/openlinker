/**
 * Attribute Mappings Integration Test (#1038)
 *
 * Verifies the `attribute_mappings` + `attribute_value_mappings` schema against
 * real Postgres (Testcontainers; schema built by the harness):
 *  - the two partial unique indexes enforce NULL-distinct semantics on the
 *    nullable `destination_category_id` (connection-wide default vs per-category);
 *  - the value-mapping FK cascades on parent delete;
 *  - the `MappingConfigService` round-trip (upsert create → replace values →
 *    delete) works end-to-end, including the cascade/orphan-delete child replace.
 *
 * @module apps/api/test/integration
 */
import {
  IMappingConfigService,
  MAPPING_CONFIG_SERVICE_TOKEN,
} from '@openlinker/core/mappings';
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';

const INSERT_MAPPING = `
  INSERT INTO attribute_mappings
    (source_connection_id, destination_connection_id, source_attribute_key,
     destination_parameter_name, destination_category_id)
  VALUES ($1, $2, $3, $4, $5)
  RETURNING id
`;

const INSERT_VALUE = `
  INSERT INTO attribute_value_mappings (attribute_mapping_id, source_value, destination_value)
  VALUES ($1, $2, $3)
`;

describe('Attribute Mappings Integration', () => {
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

  describe('partial unique indexes (NULL-distinct on destination_category_id)', () => {
    it('rejects a duplicate connection-wide default (category NULL) for the same key', async () => {
      const ds = harness.getDataSource();
      const dest = await seedDestination();
      const src = await seedSource('PS A');

      await ds.query(INSERT_MAPPING, [src, dest, 'Color', 'Kolor', null]);
      await expect(
        ds.query(INSERT_MAPPING, [src, dest, 'Color', 'Barwa', null])
      ).rejects.toThrow(/duplicate key|unique/i);
    });

    it('allows a per-category override alongside the connection-wide default', async () => {
      const ds = harness.getDataSource();
      const dest = await seedDestination();
      const src = await seedSource('PS A');

      await ds.query(INSERT_MAPPING, [src, dest, 'Color', 'Kolor', null]);
      // Same (src, dest, key) but a category id → permitted by the per-category index.
      await expect(
        ds.query(INSERT_MAPPING, [src, dest, 'Color', 'Kolor', 'cat-1'])
      ).resolves.toBeDefined();
      // Duplicate within the same category → rejected.
      await expect(
        ds.query(INSERT_MAPPING, [src, dest, 'Color', 'Inny', 'cat-1'])
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });

  describe('value-mapping cascade', () => {
    it('deletes child value rows when the parent mapping is deleted', async () => {
      const ds = harness.getDataSource();
      const dest = await seedDestination();
      const src = await seedSource('PS A');

      const [{ id }] = (await ds.query(INSERT_MAPPING, [
        src,
        dest,
        'Color',
        'Kolor',
        null,
      ])) as { id: string }[];
      await ds.query(INSERT_VALUE, [id, 'Red', 'Czerwony']);

      await ds.query(`DELETE FROM attribute_mappings WHERE id = $1`, [id]);

      const rows = (await ds.query(
        `SELECT 1 FROM attribute_value_mappings WHERE attribute_mapping_id = $1`,
        [id]
      )) as unknown[];
      expect(rows).toHaveLength(0);
    });
  });

  describe('MappingConfigService round-trip', () => {
    it('upserts (create → replace values → delete) end-to-end', async () => {
      const service = getService();
      const dest = await seedDestination();
      const src = await seedSource('PS A');

      const created = await service.upsertAttributeMapping(dest, {
        sourceConnectionId: src,
        sourceAttributeKey: 'Color',
        destinationParameterName: 'Kolor',
        values: [{ sourceValue: 'Red', destinationValue: 'Czerwony' }],
      });
      expect(created.destinationCategoryId).toBeNull();
      expect(created.values).toHaveLength(1);

      // Re-upsert same key replaces the value set (orphan-delete) in place.
      const updated = await service.upsertAttributeMapping(dest, {
        sourceConnectionId: src,
        sourceAttributeKey: 'Color',
        destinationParameterName: 'Kolor',
        values: [
          { sourceValue: 'Red', destinationValue: 'Czerwony' },
          { sourceValue: 'Blue', destinationValue: 'Niebieski' },
        ],
      });
      expect(updated.id).toBe(created.id);
      expect(updated.values).toHaveLength(2);

      const all = await service.getAttributeMappings(dest);
      expect(all).toHaveLength(1);
      expect(all[0].values).toHaveLength(2);

      await service.deleteAttributeMapping(created.id);
      expect(await service.getAttributeMappings(dest)).toHaveLength(0);
    });
  });
});
