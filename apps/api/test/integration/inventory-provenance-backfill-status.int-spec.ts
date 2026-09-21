/**
 * Inventory Provenance-Backfill Status Integration Test (#3240)
 *
 * Vertical slice for `GET /inventory/provenance-backfill-status` — the second,
 * independent readiness condition for the #2325 `SET NOT NULL` + unique-index
 * migration, alongside `inventory-duplicate-positions.int-spec.ts`'s
 * `groupCount`. Two things only a real database can establish:
 *
 * - **`remainingNull` is a real, live `COUNT(*)`** over
 *   `inventory_items WHERE "sourceConnectionId" IS NULL` — not a mock's
 *   canned return value. The spec inserts rows with and without provenance
 *   and asserts the count reflects exactly the NULL ones.
 * - **`latchedAt` reads the SAME cursor key the #2317 backfill handler writes.**
 *   `inventory-query.service.spec.ts` pins the literal key against a mock;
 *   this spec writes a real `connection_cursors` row under that literal key
 *   and asserts the HTTP response surfaces it — proving reader and writer
 *   agree on both the key string and the empty-string-means-unlatched
 *   normalisation, which a mock cannot prove either side of.
 *
 * The viewer-403 half lives with the other HTTP authz assertions in
 * `viewer-role-authz.int-spec.ts` (the `inventory-duplicate-positions.int-spec.ts`
 * convention).
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';
import {
  ProductOrmEntity,
  ProductVariantOrmEntity,
} from '@openlinker/core/products/orm-entities';
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';

const SYSTEM_CONNECTION_ID = '00000000-0000-0000-0000-000000000000';
const COMPLETED_AT_CURSOR_KEY = `master.inventory-provenance.completedAt:connection:${SYSTEM_CONNECTION_ID}`;

describe('Inventory provenance-backfill status (#3240)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let counter = 0;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(() => {
    dataSource = harness.getDataSource();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  /** Seeds a product + one variant, with NO inventory rows. */
  async function seedProductAndVariant(): Promise<{ productId: string; variantId: string }> {
    counter += 1;
    const suffix = `${Date.now().toString()}_${counter.toString()}`;
    const productId = `ol_product_pbf_${suffix}`;
    const variantId = `ol_variant_pbf_${suffix}`;

    const productRepo = dataSource.getRepository(ProductOrmEntity);
    await productRepo.save(
      productRepo.create({ id: productId, name: `Backfill Test ${suffix}`, sku: null, price: null })
    );
    const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
    await variantRepo.save(
      variantRepo.create({
        id: variantId,
        productId,
        sku: null,
        attributes: null,
        ean: null,
        gtin: null,
      })
    );
    return { productId, variantId };
  }

  async function insertRow(row: {
    id: string;
    productId: string;
    productVariantId: string;
    sourceConnectionId: string | null;
  }): Promise<void> {
    await dataSource.query(
      `INSERT INTO "inventory_items"
         ("id", "productId", "productVariantId", "locationId", "sourceConnectionId",
          "availableQuantity", "reservedQuantity", "isStale", "updatedAt")
       VALUES ($1, $2, $3, NULL, $4, 1, 0, false, now())`,
      [row.id, row.productId, row.productVariantId, row.sourceConnectionId]
    );
  }

  async function writeCompletedAtCursor(value: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO "connection_cursors" ("connectionId", "cursorKey", "value")
       VALUES ($1, $2, $3)
       ON CONFLICT ("connectionId", "cursorKey") DO UPDATE SET "value" = EXCLUDED."value"`,
      [SYSTEM_CONNECTION_ID, COMPLETED_AT_CURSOR_KEY, value]
    );
  }

  describe('GET /inventory/provenance-backfill-status', () => {
    it('reports remainingNull as a live count and completed: true with no rows missing provenance', async () => {
      const http = harness.getHttp();
      const adminToken = await loginAsAdmin(http, dataSource, 'admin');
      const { productId, variantId } = await seedProductAndVariant();

      // Provenance is present — must not count toward remainingNull.
      await insertRow({
        id: `${variantId}_has_provenance`,
        productId,
        productVariantId: variantId,
        sourceConnectionId: 'connection-alpha',
      });

      const { body } = await http
        .get('/v1/inventory/provenance-backfill-status')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(body.remainingNull).toBe(0);
      expect(body.completed).toBe(true);
      expect(body.latchedAt).toBeNull();
    });

    it('counts a real NULL-provenance row and reports completed: false', async () => {
      const http = harness.getHttp();
      const adminToken = await loginAsAdmin(http, dataSource, 'admin');
      const { productId, variantId } = await seedProductAndVariant();

      await insertRow({
        id: `${variantId}_no_provenance`,
        productId,
        productVariantId: variantId,
        sourceConnectionId: null,
      });

      const { body } = await http
        .get('/v1/inventory/provenance-backfill-status')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(body.remainingNull).toBeGreaterThanOrEqual(1);
      expect(body.completed).toBe(false);
    });

    it('surfaces the #2317 handler\'s persisted latch under its own literal cursor key', async () => {
      const http = harness.getHttp();
      const adminToken = await loginAsAdmin(http, dataSource, 'admin');
      await writeCompletedAtCursor('2026-08-01T00:00:00.000Z');

      const { body } = await http
        .get('/v1/inventory/provenance-backfill-status')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(body.latchedAt).toBe('2026-08-01T00:00:00.000Z');
    });

    it('treats an empty-string cursor row identically to no latch, matching the handler\'s own predicate', async () => {
      const http = harness.getHttp();
      const adminToken = await loginAsAdmin(http, dataSource, 'admin');
      // InventoryProvenanceBackfillHandler.execute() never writes '' itself,
      // but a reader that surfaced it verbatim would report `latchedAt: ''`
      // (non-null) and every consumer of the contract would read the pass as
      // stuck. Proving the row's mere presence-as-empty-string is normalised
      // is what this case is for.
      await writeCompletedAtCursor('');

      const { body } = await http
        .get('/v1/inventory/provenance-backfill-status')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(body.latchedAt).toBeNull();
    });

    it('reports the stuck-pass state: latched while rows still lack provenance', async () => {
      const http = harness.getHttp();
      const adminToken = await loginAsAdmin(http, dataSource, 'admin');
      const { productId, variantId } = await seedProductAndVariant();
      await insertRow({
        id: `${variantId}_stuck`,
        productId,
        productVariantId: variantId,
        sourceConnectionId: null,
      });
      await writeCompletedAtCursor('2026-08-01T00:00:00.000Z');

      const { body } = await http
        .get('/v1/inventory/provenance-backfill-status')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(body.remainingNull).toBeGreaterThanOrEqual(1);
      expect(body.completed).toBe(false);
      expect(body.latchedAt).toBe('2026-08-01T00:00:00.000Z');
    });
  });
});
