/**
 * Inventory Source-Connection Provenance Integration Test (#2314, ADR-058 step (i))
 *
 * Vertical slice for the additive nullable `inventory_items."sourceConnectionId"`
 * column against real Postgres. Asserts the three things a unit test cannot:
 *
 * - the column really is nullable `text` (step (i) is additive; `SET NOT NULL`
 *   is step (iii)/#2325), so a pre-backfill NULL row is legal and readable;
 * - a sync stamps provenance onto an EXISTING row **in place** — same `id`, same
 *   `locationId` — rather than inserting a second position, which is what the
 *   column being in the UPDATE set is for;
 * - **neither partial unique index changed.** Adding a NULL-bearing column to
 *   either would make it NULL-distinct and silently admit duplicate positions
 *   that double-count available-to-promise, so the index definitions are
 *   snapshotted and compared byte-identical rather than merely counted.
 *
 * The connectionId-threading half (that `MasterInventorySyncService` passes its
 * own connection id) is pinned by unit tests; this spec drives the
 * `setInventory` → `upsert` path directly, matching the service-level shape of
 * its `inventory-stale-prune` sibling.
 *
 * NOTE the harness builds its schema by `synchronize`, not by the migrations, so
 * what these assertions read back is the ORM-decorator definition. That is the
 * right target here — the migration and the decorator are asserted to agree by
 * `migration:show` in the quality gate, not by this spec.
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';
import {
  ProductOrmEntity,
  ProductVariantOrmEntity,
} from '@openlinker/core/products/orm-entities';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';
import {
  IInventoryService,
  IInventoryQueryService,
  InventoryItemEntity,
  INVENTORY_SERVICE_TOKEN,
  INVENTORY_QUERY_SERVICE_TOKEN,
} from '@openlinker/core/inventory';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

/** Every index definition on `inventory_items`, sorted — the byte-identical subject. */
async function readIndexDefs(dataSource: DataSource): Promise<string[]> {
  const rows = (await dataSource.query(
    `SELECT indexdef FROM pg_indexes WHERE tablename = 'inventory_items' ORDER BY indexdef`,
  )) as { indexdef: string }[];
  return rows.map((r) => r.indexdef);
}

/** Seeds a product + one variant, with NO inventory row. */
async function seedProductAndVariant(
  dataSource: DataSource,
): Promise<{ productId: string; variantId: string; suffix: string }> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const productId = `ol_product_prov_${suffix}`;
  const variantId = `ol_variant_prov_${suffix}`;

  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({ id: productId, name: `Prov Test ${suffix}`, sku: null, price: null }),
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
    }),
  );

  return { productId, variantId, suffix };
}

describe('Inventory source-connection provenance (#2314)', () => {
  let harness: IntegrationTestHarness;
  let inventoryService: IInventoryService;
  let queryService: IInventoryQueryService;

  beforeAll(async () => {
    harness = await getTestHarness();
    inventoryService = harness.getApp().get<IInventoryService>(INVENTORY_SERVICE_TOKEN);
    queryService = harness.getApp().get<IInventoryQueryService>(INVENTORY_QUERY_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('declares sourceConnectionId as a nullable text column', async () => {
    const dataSource = harness.getDataSource();

    const [column] = (await dataSource.query(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'inventory_items' AND column_name = 'sourceConnectionId'`,
    )) as { data_type: string; is_nullable: string; column_default: string | null }[];

    expect(column).toBeDefined();
    expect(column.data_type).toBe('text');
    // Step (i) is additive-nullable by design: `SET NOT NULL` is #2325, and it
    // must not arrive early or the #2317 backfill has nothing to backfill onto.
    expect(column.is_nullable).toBe('YES');
    // No DEFAULT — a default would silently attribute every historical row to
    // whatever value was chosen, which is the claim the `'legacy'` sentinel
    // exists to make explicitly instead.
    expect(column.column_default).toBeNull();
  });

  it('leaves both partial unique indexes byte-identical across a provenance write', async () => {
    const dataSource = harness.getDataSource();
    const before = await readIndexDefs(dataSource);

    // Sanity: the two partial unique indexes this column must stay out of are
    // actually present, so a byte-identical comparison of an empty set cannot
    // pass vacuously. Postgres renders camelCase identifiers quoted in
    // `indexdef`, hence the quotes in the predicate.
    const partialUnique = before.filter(
      (d) => d.includes('UNIQUE INDEX') && /"productVariantId" IS (NOT )?NULL/.test(d),
    );
    expect(partialUnique).toHaveLength(2);
    for (const def of before) {
      expect(def).not.toContain('sourceConnectionId');
    }

    const { productId, variantId } = await seedProductAndVariant(dataSource);
    await inventoryService.setInventory(
      new InventoryItemEntity(
        `ignored-${variantId}`,
        productId,
        variantId,
        5,
        0,
        null,
        new Date(),
        false,
        'connection-alpha',
      ),
    );

    expect(await readIndexDefs(dataSource)).toEqual(before);
  });

  it('stamps provenance onto an existing NULL row in place, without moving its identity', async () => {
    const dataSource = harness.getDataSource();
    const { productId, variantId, suffix } = await seedProductAndVariant(dataSource);
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);

    // A pre-backfill row: provenance omitted entirely, exactly as every row in
    // an existing install looks the moment the migration lands.
    const seeded = await inventoryRepo.save(
      inventoryRepo.create({
        id: `ol_inventory_prov_${suffix}`,
        productId,
        productVariantId: variantId,
        availableQuantity: 5,
        reservedQuantity: 0,
        locationId: null,
      }),
    );
    expect(seeded.sourceConnectionId ?? null).toBeNull();

    // The NULL row is readable and its availability is unaffected — provenance
    // is metadata, and step (i) must not perturb the figure offers derive from.
    const beforeAvailability = await queryService.getAvailabilityByVariantIds([variantId]);
    expect(beforeAvailability.find((a) => a.productVariantId === variantId)?.totalAvailable).toBe(5);

    await inventoryService.setInventory(
      new InventoryItemEntity(
        `ignored-${suffix}`,
        productId,
        variantId,
        7,
        0,
        null,
        new Date(),
        false,
        'connection-alpha',
      ),
    );

    const rows = await inventoryRepo.find({ where: { productId, productVariantId: variantId } });
    // In place: the UPDATE branch acquires provenance, so no second position is
    // created for the same (product, variant, location) key.
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(seeded.id);
    expect(rows[0].locationId).toBeNull();
    expect(rows[0].sourceConnectionId).toBe('connection-alpha');
    expect(rows[0].availableQuantity).toBe(7);

    const afterAvailability = await queryService.getAvailabilityByVariantIds([variantId]);
    expect(afterAvailability.find((a) => a.productVariantId === variantId)?.totalAvailable).toBe(7);
  });

  it('stamps provenance on the insert branch', async () => {
    const dataSource = harness.getDataSource();
    const { productId, variantId, suffix } = await seedProductAndVariant(dataSource);

    await inventoryService.setInventory(
      new InventoryItemEntity(
        `ignored-${suffix}`,
        productId,
        variantId,
        9,
        0,
        null,
        new Date(),
        false,
        'connection-beta',
      ),
    );

    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);
    const [row] = await inventoryRepo.find({ where: { productId, productVariantId: variantId } });
    expect(row.sourceConnectionId).toBe('connection-beta');
  });

  it('persists a null provenance rather than inventing one', async () => {
    const dataSource = harness.getDataSource();
    const { productId, variantId, suffix } = await seedProductAndVariant(dataSource);

    // A caller with no connection axis (the three existing int-spec callers are
    // exactly this shape). NULL must survive to the row as NULL — anything else
    // would make the #2317 sweep unable to tell attributed from unattributed.
    await inventoryService.setInventory(
      new InventoryItemEntity(
        `ignored-${suffix}`,
        productId,
        variantId,
        3,
        0,
        null,
        new Date(),
        false,
      ),
    );

    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);
    const [row] = await inventoryRepo.find({ where: { productId, productVariantId: variantId } });
    expect(row.sourceConnectionId).toBeNull();
  });
});
