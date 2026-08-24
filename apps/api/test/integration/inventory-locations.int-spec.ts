/**
 * Inventory Locations Integration Test (#2313, ADR-058 decision 1)
 *
 * Verifies the `inventory_locations` schema against real Postgres
 * (Testcontainers):
 *  - a full round-trip through `ILocationService` keeps country, postcode and
 *    `numeric(9,6)` geo intact (and returns geo as `number`, not the string pg
 *    hands back);
 *  - `UQ_inventory_locations_code` rejects a duplicate code as a DOMAIN error,
 *    and the service's single normalisation point means `wh1` collides with
 *    `WH1` rather than creating a second row the index cannot see;
 *  - deleting the owning connection leaves the operator's location standing,
 *    and no CASCADING FK was introduced that would take it down;
 *  - `inventory_items` gained no foreign key, asserted against
 *    `information_schema` (ADR-058 decision 3 defers that to step iii).
 *
 * **The harness builds its schema by `synchronize`, not by migration.** That is
 * why the index names are declared explicitly on the ORM entity (so the two
 * schemas cannot diverge on the uniqueness constraint), and why the FK's
 * `SET NULL` clearing is not asserted here — it is migration-only, exactly like
 * `category_mappings` and `fulfillment_routing_rules`, and `setup.ts` records
 * the same consequence for the truncate list.
 *
 * Since #2316 the file also carries its first HTTP surface — the locations CRUD
 * API — exercised through the harness's supertest client under the `/v1` prefix.
 *
 * @module apps/api/test/integration
 */
import {
  DuplicateLocationCodeError,
  ILocationService,
  LOCATION_SERVICE_TOKEN,
  LocationNotFoundException,
} from '@openlinker/core/inventory';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { loginAsAdmin, loginAsOperator } from './helpers/test-auth.helper';
import { createTestInventoryItem } from './fixtures/inventory.fixtures';

describe('Inventory Locations Integration', () => {
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

  function getService(): ILocationService {
    return harness.getApp().get<ILocationService>(LOCATION_SERVICE_TOKEN);
  }

  async function seedConnection(name = 'PrestaShop master'): Promise<string> {
    const conn = await createTestConnection(harness.getDataSource(), {
      platformType: 'prestashop',
      name,
      adapterKey: 'prestashop.webservice.v1',
      enabledCapabilities: ['InventoryMaster'],
    });
    return conn.id;
  }

  describe('round-trip', () => {
    it('should read back country, postcode and geo intact after a create', async () => {
      const service = getService();

      const created = await service.createLocation({
        code: 'WH1',
        name: 'Main warehouse',
        kind: 'warehouse',
        countryIso2: 'PL',
        postcode: '00-001',
        latitude: 52.229676,
        longitude: 21.012229,
      });

      const found = await service.getLocation(created.id);

      expect(found).not.toBeNull();
      expect(found?.code).toBe('WH1');
      expect(found?.kind).toBe('warehouse');
      expect(found?.status).toBe('active');
      expect(found?.countryIso2).toBe('PL');
      expect(found?.postcode).toBe('00-001');
      // numeric(9,6) comes back from pg as a string; the repository coerces once.
      expect(found?.latitude).toBe(52.229676);
      expect(found?.longitude).toBe(21.012229);
      expect(typeof found?.latitude).toBe('number');
    });

    it('should mint an ol_location_ prefixed id with no identifier mapping', async () => {
      const created = await getService().createLocation({
        code: 'WH1',
        name: 'Main warehouse',
        kind: 'warehouse',
      });

      expect(created.id).toMatch(/^ol_location_[0-9a-f]{32}$/);

      const mappings = await harness
        .getDataSource()
        .query(`SELECT COUNT(*)::int AS c FROM identifier_mappings WHERE "internalId" = $1`, [
          created.id,
        ]);
      expect(mappings[0].c).toBe(0);
    });

    it('should leave omitted fields untouched and clear an explicit null on update', async () => {
      const service = getService();
      const created = await service.createLocation({
        code: 'WH1',
        name: 'Main warehouse',
        kind: 'warehouse',
        externalRef: 'ERP-7',
        countryIso2: 'PL',
      });

      const updated = await service.updateLocation(created.id, { externalRef: null });

      expect(updated.externalRef).toBeNull();
      expect(updated.name).toBe('Main warehouse');
      expect(updated.countryIso2).toBe('PL');
    });

    it('should list locations filtered by kind and status', async () => {
      const service = getService();
      await service.createLocation({ code: 'WH1', name: 'A', kind: 'warehouse' });
      await service.createLocation({ code: 'ST1', name: 'B', kind: 'store' });
      await service.createLocation({
        code: 'WH2',
        name: 'C',
        kind: 'warehouse',
        status: 'inactive',
      });

      const active = await service.listLocations(
        { kind: 'warehouse', status: 'active' },
        { page: 1, limit: 20 }
      );

      expect(active.total).toBe(1);
      expect(active.items[0].code).toBe('WH1');
    });
  });

  describe('code uniqueness', () => {
    it('should reject a duplicate code with a domain error, never a raw driver error', async () => {
      const service = getService();
      await service.createLocation({ code: 'WH1', name: 'Main', kind: 'warehouse' });

      await expect(
        service.createLocation({ code: 'WH1', name: 'Second', kind: 'store' })
      ).rejects.toBeInstanceOf(DuplicateLocationCodeError);
    });

    it('should collide a lowercase code with its uppercase twin via the single normalisation point', async () => {
      const service = getService();
      await service.createLocation({ code: 'WH1', name: 'Main', kind: 'warehouse' });

      // The DB index is case-sensitive — this only collides because the service
      // normalises. A skipped normalisation would silently create a second row.
      await expect(
        service.createLocation({ code: ' wh1 ', name: 'Second', kind: 'store' })
      ).rejects.toBeInstanceOf(DuplicateLocationCodeError);
    });
  });

  describe('ownerConnectionId provenance', () => {
    it('should keep the location when its owning connection is deleted', async () => {
      const service = getService();
      const connectionId = await seedConnection();

      const created = await service.createLocation({
        code: 'WH1',
        name: 'Main warehouse',
        kind: 'warehouse',
        ownerConnectionId: connectionId,
      });
      expect(created.ownerConnectionId).toBe(connectionId);

      await harness.getDataSource().query(`DELETE FROM connections WHERE id = $1`, [connectionId]);

      // The invariant that matters: an operator's warehouse is NEVER removed
      // along with the integration that happened to stock it. Under the
      // migration-built schema the FK additionally SETs NULL, clearing the
      // provenance — see the note below for why that half is not asserted here.
      const survivor = await service.getLocation(created.id);
      expect(survivor).not.toBeNull();
      expect(survivor?.code).toBe('WH1');
    });

    it('should declare the owner FK in the migration rather than as a cascading ORM relation', async () => {
      // The harness builds its schema by `synchronize`, so a migration-only FK
      // simply is not present here — the same reason `setup.ts` truncates this
      // table explicitly. Asserting `ownerConnectionId IS NULL` after the delete
      // would therefore be asserting the harness, not the schema we ship. What
      // IS assertable, and is the thing that would actually break the property,
      // is that no CASCADING relation was added to the ORM entity: a
      // `@ManyToOne(..., onDelete: 'CASCADE')` would delete the operator's
      // warehouse in production regardless of what the migration says.
      const rows = await harness.getDataSource().query(`
        SELECT rc.delete_rule
        FROM information_schema.table_constraints tc
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'inventory_locations'
          AND tc.constraint_type = 'FOREIGN KEY'
      `);

      const deleteRules: string[] = rows.map((r: { delete_rule: string }) => r.delete_rule);
      expect(deleteRules).not.toContain('CASCADE');
    });
  });

  describe('delete', () => {
    it('should throw LocationNotFoundException when deleting an unknown id', async () => {
      await expect(getService().deleteLocation('ol_location_missing')).rejects.toBeInstanceOf(
        LocationNotFoundException
      );
    });

    it('should remove the row when the location exists', async () => {
      const service = getService();
      const created = await service.createLocation({
        code: 'WH1',
        name: 'Main',
        kind: 'warehouse',
      });

      await service.deleteLocation(created.id);

      await expect(service.getLocation(created.id)).resolves.toBeNull();
    });
  });

  describe('inventory_items is untouched', () => {
    it('should add no foreign key to inventory_items (ADR-058 decision 3 defers it)', async () => {
      const rows = await harness.getDataSource().query(`
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        WHERE tc.table_name = 'inventory_items'
          AND tc.constraint_type = 'FOREIGN KEY'
      `);

      const names: string[] = rows.map((r: { constraint_name: string }) => r.constraint_name);
      expect(names.some((n) => n.toLowerCase().includes('location'))).toBe(false);
    });

    it('should leave inventory_items.locationId an unconstrained nullable column', async () => {
      const rows = await harness.getDataSource().query(`
        SELECT is_nullable, data_type
        FROM information_schema.columns
        WHERE table_name = 'inventory_items' AND column_name = 'locationId'
      `);

      expect(rows).toHaveLength(1);
      expect(rows[0].is_nullable).toBe('YES');
    });
  });

  describe('schema', () => {
    it('should create the unique code index and the owner-connection index', async () => {
      const rows = await harness.getDataSource().query(`
        SELECT indexname FROM pg_indexes WHERE tablename = 'inventory_locations'
      `);

      const names: string[] = rows.map((r: { indexname: string }) => r.indexname);
      expect(names).toContain('UQ_inventory_locations_code');
      expect(names).toContain('IDX_inventory_locations_owner_connection');
    });
  });

  describe('HTTP CRUD API (#2316)', () => {
    const BASE = '/v1/inventory/locations';

    async function adminToken(): Promise<string> {
      return loginAsAdmin(harness.getHttp(), harness.getDataSource());
    }

    it('should round-trip create -> get -> list -> patch -> delete', async () => {
      const http = harness.getHttp();
      const token = await adminToken();

      const created = await http
        .post(BASE)
        .set('Authorization', `Bearer ${token}`)
        .send({
          code: 'wh1',
          name: 'Main warehouse',
          kind: 'warehouse',
          countryIso2: 'pl',
          postcode: '00-001',
          latitude: 52.2297,
          longitude: 21.0122,
        })
        .expect(201);

      // The service normalises; the response is the allowlist projection.
      expect(created.body.code).toBe('WH1');
      expect(created.body.countryIso2).toBe('PL');
      expect(created.body.latitude).toBe(52.2297);
      expect(typeof created.body.latitude).toBe('number');
      expect(typeof created.body.createdAt).toBe('string');
      expect(created.body.id).toMatch(/^ol_location_/);

      const id: string = created.body.id;

      await http
        .get(`${BASE}/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.code).toBe('WH1');
        });

      const listed = await http.get(BASE).set('Authorization', `Bearer ${token}`).expect(200);
      expect(listed.body).toMatchObject({ total: 1, page: 1, limit: 25 });
      expect(listed.body.items[0].id).toBe(id);

      await http
        .patch(`${BASE}/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Renamed warehouse' })
        .expect(200)
        .expect((res) => {
          expect(res.body.name).toBe('Renamed warehouse');
          // An omitted field is untouched, not cleared.
          expect(res.body.postcode).toBe('00-001');
        });

      await http
        .patch(`${BASE}/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ postcode: null })
        .expect(200)
        .expect((res) => {
          expect(res.body.postcode).toBeNull();
        });

      await http.delete(`${BASE}/${id}`).set('Authorization', `Bearer ${token}`).expect(204);

      await http.get(`${BASE}/${id}`).set('Authorization', `Bearer ${token}`).expect(404);
    });

    it('should reject a duplicate code with 409, case-insensitively', async () => {
      const http = harness.getHttp();
      const token = await adminToken();

      await http
        .post(BASE)
        .set('Authorization', `Bearer ${token}`)
        .send({ code: 'WH1', name: 'First', kind: 'warehouse' })
        .expect(201);

      await http
        .post(BASE)
        .set('Authorization', `Bearer ${token}`)
        .send({ code: 'wh1', name: 'Second', kind: 'store' })
        .expect(409)
        .expect((res) => {
          expect(res.body.error).toBe('DuplicateLocationCodeError');
        });
    });

    it('should refuse a delete with 409 while positions reference the location', async () => {
      const http = harness.getHttp();
      const token = await adminToken();

      const created = await http
        .post(BASE)
        .set('Authorization', `Bearer ${token}`)
        .send({ code: 'WH2', name: 'Stocked', kind: 'warehouse' })
        .expect(201);
      const id: string = created.body.id;

      await createTestInventoryItem(harness.getDataSource(), { locationId: id });

      await http
        .delete(`${BASE}/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409)
        .expect((res) => {
          expect(res.body.error).toBe('LocationInUseError');
        });

      // The refusal is a refusal: the row is still there.
      await http.get(`${BASE}/${id}`).set('Authorization', `Bearer ${token}`).expect(200);
    });

    it('should 404 a patch or delete against an unknown id', async () => {
      const http = harness.getHttp();
      const token = await adminToken();

      await http
        .patch(`${BASE}/ol_location_missing`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Nope' })
        .expect(404)
        .expect((res) => {
          expect(res.body.error).toBe('LocationNotFoundException');
        });

      await http
        .delete(`${BASE}/ol_location_missing`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should 400 an unknown kind, a code sent to PATCH, and an explicit null name', async () => {
      const http = harness.getHttp();
      const token = await adminToken();

      await http
        .post(BASE)
        .set('Authorization', `Bearer ${token}`)
        .send({ code: 'WH3', name: 'Bad kind', kind: 'spaceship' })
        .expect(400);

      const created = await http
        .post(BASE)
        .set('Authorization', `Bearer ${token}`)
        .send({ code: 'WH4', name: 'Fine', kind: 'warehouse' })
        .expect(201);

      // `code` is not patchable, and forbidNonWhitelisted turns that into a
      // 400 rather than a silently ignored field.
      await http
        .patch(`${BASE}/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ code: 'WH5' })
        .expect(400);

      // An explicit null on a NOT NULL column is bad input, not a 500.
      await http
        .patch(`${BASE}/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: null })
        .expect(400);
    });

    it('should let an operator read but not write', async () => {
      const http = harness.getHttp();
      const admin = await adminToken();
      const operator = await loginAsOperator(http, harness.getDataSource());

      await http
        .post(BASE)
        .set('Authorization', `Bearer ${admin}`)
        .send({ code: 'WH6', name: 'Readable', kind: 'warehouse' })
        .expect(201);

      await http.get(BASE).set('Authorization', `Bearer ${operator}`).expect(200);

      await http
        .post(BASE)
        .set('Authorization', `Bearer ${operator}`)
        .send({ code: 'WH7', name: 'Denied', kind: 'warehouse' })
        .expect(403);
    });

    it('should find a row by a lowercase countryIso2 filter', async () => {
      const http = harness.getHttp();
      const token = await adminToken();

      await http
        .post(BASE)
        .set('Authorization', `Bearer ${token}`)
        .send({ code: 'WH8', name: 'Warsaw', kind: 'warehouse', countryIso2: 'PL' })
        .expect(201);

      // Stored uppercase; the controller uppercases the filter, so a lowercase
      // query still matches the repository's equality filter.
      await http
        .get(`${BASE}?countryIso2=pl`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.total).toBe(1);
        });
    });
  });
});
