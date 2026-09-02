/**
 * Inventory Duplicate-Position Detection Integration Test (#2319, ADR-058 step (iii))
 *
 * Vertical slice for the read-only duplicate-position report against real
 * Postgres. Three things only a real database can establish:
 *
 * - **The defect the report exists to find is real.** Two rows for the same
 *   product + variant with `locationId = NULL` INSERT successfully today,
 *   because both partial unique indexes are NULL-distinct. The spec inserts
 *   them and asserts the insert succeeds before asserting the report catches
 *   them — otherwise a passing report would prove nothing.
 * - **`GROUP BY` NULL-equality is the opposite of index NULL-distinctness.** The
 *   duplicates a NULL-bearing index admits are exactly the ones a `GROUP BY`
 *   over the same columns collapses, which is the whole detection mechanism and
 *   is not expressible against a mock.
 * - **Cross-source rows are NOT duplicates.** ADR-058 decision (2) makes
 *   coexistence across connections legitimate, so provenance is part of the
 *   four-column key. The negative case pins that: reporting those rows would
 *   permanently block #2325 on a healthy multi-source install.
 *
 * The scan is asserted to write NOTHING — a full before/after row snapshot plus
 * byte-identical index definitions, borrowing `readIndexDefs` from the #2314
 * provenance sibling. "Detection, not repair" is the issue's own boundary, and a
 * report that quietly deleted a row would be the worst possible failure here.
 *
 * The suite drives both the service seam and the HTTP route (the
 * `ai-provider-settings.int-spec.ts` shape); the viewer-403 half lives with the
 * other HTTP authz assertions in `viewer-role-authz.int-spec.ts`.
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';
import {
  ProductOrmEntity,
  ProductVariantOrmEntity,
} from '@openlinker/core/products/orm-entities';
import {
  IInventoryQueryService,
  INVENTORY_QUERY_SERVICE_TOKEN,
} from '@openlinker/core/inventory';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';

/** Every index definition on `inventory_items`, sorted (mirrors the #2314 spec). */
async function readIndexDefs(dataSource: DataSource): Promise<string[]> {
  const rows = (await dataSource.query(
    `SELECT indexdef FROM pg_indexes WHERE tablename = 'inventory_items' ORDER BY indexdef`
  )) as { indexdef: string }[];
  return rows.map((r) => r.indexdef);
}

/** Full row snapshot, ordered, for the no-write assertion. */
async function snapshotRows(dataSource: DataSource): Promise<unknown[]> {
  return (await dataSource.query(
    `SELECT "id", "productId", "productVariantId", "locationId", "sourceConnectionId",
            "availableQuantity", "reservedQuantity", "isStale", "updatedAt"
       FROM "inventory_items" ORDER BY "id"`
  )) as unknown[];
}

describe('Inventory duplicate-position detection (#2319)', () => {
  let harness: IntegrationTestHarness;
  let queryService: IInventoryQueryService;
  let dataSource: DataSource;
  let counter = 0;

  beforeAll(async () => {
    harness = await getTestHarness();
    queryService = harness.getApp().get<IInventoryQueryService>(INVENTORY_QUERY_SERVICE_TOKEN);
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
  async function seedProductAndVariant(): Promise<{
    productId: string;
    variantId: string;
    suffix: string;
  }> {
    counter += 1;
    const suffix = `${Date.now().toString()}_${counter.toString()}`;
    const productId = `ol_product_dup_${suffix}`;
    const variantId = `ol_variant_dup_${suffix}`;

    const productRepo = dataSource.getRepository(ProductOrmEntity);
    await productRepo.save(
      productRepo.create({ id: productId, name: `Dup Test ${suffix}`, sku: null, price: null })
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
    return { productId, variantId, suffix };
  }

  /**
   * Inserts an inventory row directly. Deliberately NOT via
   * `IInventoryService.setInventory`: that path is upsert-by-position and so
   * cannot produce a duplicate — the duplicates this report exists to find come
   * from concurrent writers and historic data, not from the normal write path.
   */
  async function insertRow(row: {
    id: string;
    productId: string;
    productVariantId: string | null;
    locationId: string | null;
    sourceConnectionId: string | null;
    availableQuantity: number;
    isStale?: boolean;
  }): Promise<void> {
    await dataSource.query(
      `INSERT INTO "inventory_items"
         ("id", "productId", "productVariantId", "locationId", "sourceConnectionId",
          "availableQuantity", "reservedQuantity", "isStale", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7, now())`,
      [
        row.id,
        row.productId,
        row.productVariantId,
        row.locationId,
        row.sourceConnectionId,
        row.availableQuantity,
        row.isStale ?? false,
      ]
    );
  }

  it('reports two locationless rows for one variant as a single duplicate group', async () => {
    const { productId, variantId, suffix } = await seedProductAndVariant();

    // Both inserts succeed. This is the latent defect ADR-058 step (iii)
    // closes: `locationId IS NULL` makes the partial unique index NULL-distinct,
    // so it does not consider these two rows equal — while the availability read
    // sums both, double-counting available-to-promise.
    await insertRow({
      id: `ol_inventory_dup_a_${suffix}`,
      productId,
      productVariantId: variantId,
      locationId: null,
      sourceConnectionId: null,
      availableQuantity: 5,
    });
    await insertRow({
      id: `ol_inventory_dup_b_${suffix}`,
      productId,
      productVariantId: variantId,
      locationId: null,
      sourceConnectionId: null,
      availableQuantity: 7,
    });

    const report = await queryService.getDuplicatePositionReport();

    expect(report.groupCount).toBe(1);
    expect(report.rowCount).toBe(2);
    expect(report.excessRowCount).toBe(1);
    expect(report.truncated).toBe(false);
    expect(report.groups).toHaveLength(1);

    const [group] = report.groups;
    expect(group.productId).toBe(productId);
    expect(group.productVariantId).toBe(variantId);
    expect(group.locationId).toBeNull();
    expect(group.sourceConnectionId).toBeNull();
    expect(group.rowCount).toBe(2);
    expect(group.liveRowCount).toBe(2);
    expect(group.rows.map((r) => r.id).sort()).toEqual(
      [`ol_inventory_dup_a_${suffix}`, `ol_inventory_dup_b_${suffix}`].sort()
    );
    expect(group.rows.map((r) => r.availableQuantity).sort((a, b) => a - b)).toEqual([5, 7]);
    for (const row of group.rows) {
      expect(row.updatedAt).toBeInstanceOf(Date);
    }
  });

  it('does NOT report rows that differ only in sourceConnectionId', async () => {
    // ADR-058 decision (2): cross-source coexistence is legitimate and is why
    // provenance is mandatory — decision (4) gives row identity the connection
    // axis. A three-column gate would flag these two rows and permanently block
    // #2325 on a healthy multi-source install, so this negative case is the one
    // protecting the four-column key.
    const { productId, variantId, suffix } = await seedProductAndVariant();

    await insertRow({
      id: `ol_inventory_src_a_${suffix}`,
      productId,
      productVariantId: variantId,
      locationId: null,
      sourceConnectionId: 'connection-alpha',
      availableQuantity: 5,
    });
    await insertRow({
      id: `ol_inventory_src_b_${suffix}`,
      productId,
      productVariantId: variantId,
      locationId: null,
      sourceConnectionId: 'connection-beta',
      availableQuantity: 7,
    });

    const report = await queryService.getDuplicatePositionReport();

    expect(report.groupCount).toBe(0);
    expect(report.rowCount).toBe(0);
    expect(report.excessRowCount).toBe(0);
    expect(report.groups).toEqual([]);
  });

  it('reports two rows from the SAME connection at the same position', async () => {
    // The exact positive counterpart of the negative case above: identical
    // seeds, one value changed. Same provenance ⇒ the rows really are two
    // records of one position, and the four-column key catches them.
    //
    // `locationId` stays NULL because that is the only shape in which this
    // duplicate is REACHABLE: with every index-key column non-null, the
    // existing partial unique index already rejects the second insert (proved
    // by attempting it — Postgres raises a unique violation). Duplicates exist
    // today precisely and only where a key column is NULL.
    const { productId, variantId, suffix } = await seedProductAndVariant();

    await insertRow({
      id: `ol_inventory_same_a_${suffix}`,
      productId,
      productVariantId: variantId,
      locationId: null,
      sourceConnectionId: 'connection-alpha',
      availableQuantity: 5,
    });
    await insertRow({
      id: `ol_inventory_same_b_${suffix}`,
      productId,
      productVariantId: variantId,
      locationId: null,
      sourceConnectionId: 'connection-alpha',
      availableQuantity: 7,
    });

    const report = await queryService.getDuplicatePositionReport();

    expect(report.groupCount).toBe(1);
    expect(report.groups[0].sourceConnectionId).toBe('connection-alpha');
    expect(report.groups[0].locationId).toBeNull();
    expect(report.groups[0].rowCount).toBe(2);
  });

  it('cannot produce a duplicate when every index-key column is non-null', async () => {
    // Pins the boundary the previous test's comment relies on, so the choice of
    // a NULL locationId there reads as a necessity rather than an arbitrary
    // seed. If a future migration made this insert succeed, the detection pass
    // would need to cover a shape it currently never sees.
    const { productId, variantId, suffix } = await seedProductAndVariant();

    await insertRow({
      id: `ol_inventory_full_a_${suffix}`,
      productId,
      productVariantId: variantId,
      locationId: 'wh-main',
      sourceConnectionId: 'connection-alpha',
      availableQuantity: 5,
    });

    await expect(
      insertRow({
        id: `ol_inventory_full_b_${suffix}`,
        productId,
        productVariantId: variantId,
        locationId: 'wh-main',
        sourceConnectionId: 'connection-alpha',
        availableQuantity: 7,
      })
    ).rejects.toThrow(/unique constraint/i);

    const report = await queryService.getDuplicatePositionReport();
    expect(report.groupCount).toBe(0);
  });

  it('reports a product-level duplicate (productVariantId NULL)', async () => {
    const { productId, suffix } = await seedProductAndVariant();

    await insertRow({
      id: `ol_inventory_base_a_${suffix}`,
      productId,
      productVariantId: null,
      locationId: null,
      sourceConnectionId: null,
      availableQuantity: 2,
    });
    await insertRow({
      id: `ol_inventory_base_b_${suffix}`,
      productId,
      productVariantId: null,
      locationId: null,
      sourceConnectionId: null,
      availableQuantity: 4,
    });

    const report = await queryService.getDuplicatePositionReport();

    // The IS NOT DISTINCT FROM join is what keeps this group in the detail: a
    // naive `=` join would return totals with an empty groups[].
    expect(report.groupCount).toBe(1);
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].productVariantId).toBeNull();
    expect(report.groups[0].rows).toHaveLength(2);
  });

  it('still reports a duplicate whose second row is stale, and counts it as not live', async () => {
    // Stricter than the availability read on purpose: a stale row still occupies
    // the position key, so the index #2325 creates would still reject it.
    const { productId, variantId, suffix } = await seedProductAndVariant();

    await insertRow({
      id: `ol_inventory_stale_live_${suffix}`,
      productId,
      productVariantId: variantId,
      locationId: null,
      sourceConnectionId: null,
      availableQuantity: 5,
    });
    await insertRow({
      id: `ol_inventory_stale_dead_${suffix}`,
      productId,
      productVariantId: variantId,
      locationId: null,
      sourceConnectionId: null,
      availableQuantity: 7,
      isStale: true,
    });

    const report = await queryService.getDuplicatePositionReport();

    expect(report.groupCount).toBe(1);
    expect(report.groups[0].rowCount).toBe(2);
    expect(report.groups[0].liveRowCount).toBe(1);
    expect(report.groups[0].rows.filter((r) => r.isStale)).toHaveLength(1);
  });

  it('reports a clean table as groupCount 0 — the Wave-1d gate for #2325', async () => {
    const { productId, variantId, suffix } = await seedProductAndVariant();

    await insertRow({
      id: `ol_inventory_clean_${suffix}`,
      productId,
      productVariantId: variantId,
      locationId: null,
      sourceConnectionId: null,
      availableQuantity: 5,
    });

    const report = await queryService.getDuplicatePositionReport();

    expect(report.groupCount).toBe(0);
    expect(report.groups).toEqual([]);
    expect(report.truncated).toBe(false);
  });

  it('keeps groupCount uncapped while truncating detail', async () => {
    // Three duplicate groups, detail capped at one. groupCount must still read
    // 3 — deriving the gate from the returned detail would report "clean" the
    // moment the cap bit, which is the failure mode the two-statement shape
    // exists to prevent.
    for (let i = 0; i < 3; i += 1) {
      const { productId, variantId, suffix } = await seedProductAndVariant();
      await insertRow({
        id: `ol_inventory_multi_a_${suffix}`,
        productId,
        productVariantId: variantId,
        locationId: null,
        sourceConnectionId: null,
        availableQuantity: 1,
      });
      await insertRow({
        id: `ol_inventory_multi_b_${suffix}`,
        productId,
        productVariantId: variantId,
        locationId: null,
        sourceConnectionId: null,
        availableQuantity: 2,
      });
    }

    const report = await queryService.getDuplicatePositionReport(1);

    expect(report.groupCount).toBe(3);
    expect(report.rowCount).toBe(6);
    expect(report.excessRowCount).toBe(3);
    expect(report.groups).toHaveLength(1);
    expect(report.truncated).toBe(true);
  });

  it('writes nothing: rows and index definitions are unchanged by a scan', async () => {
    const { productId, variantId, suffix } = await seedProductAndVariant();
    await insertRow({
      id: `ol_inventory_ro_a_${suffix}`,
      productId,
      productVariantId: variantId,
      locationId: null,
      sourceConnectionId: null,
      availableQuantity: 5,
    });
    await insertRow({
      id: `ol_inventory_ro_b_${suffix}`,
      productId,
      productVariantId: variantId,
      locationId: null,
      sourceConnectionId: null,
      availableQuantity: 7,
    });

    const rowsBefore = await snapshotRows(dataSource);
    const indexesBefore = await readIndexDefs(dataSource);
    // Sanity: the two NULL-distinct partial unique indexes really are present,
    // so a byte-identical comparison cannot pass vacuously.
    expect(
      indexesBefore.filter(
        (d) => d.includes('UNIQUE INDEX') && /"productVariantId" IS (NOT )?NULL/.test(d)
      )
    ).toHaveLength(2);

    const report = await queryService.getDuplicatePositionReport();
    expect(report.groupCount).toBe(1);

    // Detection, not repair: the report never deletes, merges or re-keys a row,
    // and it certainly never creates the index #2325 owns.
    expect(await snapshotRows(dataSource)).toEqual(rowsBefore);
    expect(await readIndexDefs(dataSource)).toEqual(indexesBefore);
  });

  describe('GET /inventory/duplicate-positions', () => {
    it('serves the report to an admin, with ISO dates and a generatedAt stamp', async () => {
      const http = harness.getHttp();
      const adminToken = await loginAsAdmin(http, dataSource, 'admin');
      const { productId, variantId, suffix } = await seedProductAndVariant();

      await insertRow({
        id: `ol_inventory_http_a_${suffix}`,
        productId,
        productVariantId: variantId,
        locationId: null,
        sourceConnectionId: null,
        availableQuantity: 5,
      });
      await insertRow({
        id: `ol_inventory_http_b_${suffix}`,
        productId,
        productVariantId: variantId,
        locationId: null,
        sourceConnectionId: null,
        availableQuantity: 7,
      });

      const { body } = await http
        .get('/v1/inventory/duplicate-positions')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(body.groupCount).toBe(1);
      expect(body.rowCount).toBe(2);
      expect(body.excessRowCount).toBe(1);
      expect(body.truncated).toBe(false);
      expect(body.groups).toHaveLength(1);
      expect(body.groups[0].liveRowCount).toBe(2);
      expect(typeof body.groups[0].rows[0].updatedAt).toBe('string');
      expect(typeof body.generatedAt).toBe('string');
      expect(Number.isNaN(Date.parse(body.generatedAt as string))).toBe(false);
    });

    it('rejects a maxGroups above the cap with 400 before reaching the service', async () => {
      const http = harness.getHttp();
      const adminToken = await loginAsAdmin(http, dataSource, 'admin');

      await http
        .get('/v1/inventory/duplicate-positions?maxGroups=501')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });
  });
});
