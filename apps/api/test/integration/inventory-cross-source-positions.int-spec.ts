/**
 * Inventory Cross-Source Positions Integration Test (#2320, ADR-058 decision (4))
 *
 * Vertical slice for the provenance-scoped row lookup and the per-source
 * staleness prune against real Postgres. It asserts the four things a unit test
 * with a mocked query builder cannot:
 *
 * - **Two connections syncing the same product produce TWO rows**, not one row
 *   whose quantities and provenance each sync clobbers in turn. This is the
 *   motivating defect: before #2320 the lookup ignored provenance, so connection
 *   B matched A's row and took the UPDATE branch. An index could never have
 *   caught it — the clobber is an UPDATE of a wrongly-matched row, so the index
 *   is never consulted.
 * - **A scoped prune stales only the scoping connection's rows.** The rival's
 *   live row survives a full-deletion sweep it has nothing to do with.
 * - **An unattributed row is claimed IN PLACE**, whether it carries NULL (a row
 *   predating the provenance column) or the `'legacy'` sentinel the #2317 sweep
 *   stamps. One class, two spellings — which is what makes the sweep's progress
 *   irrelevant to correctness here.
 * - **A single-source install is byte-identical**, indexes included. The whole
 *   slice must be invisible to the overwhelmingly common deployment, so the
 *   `readIndexDefs` snapshot is borrowed from the #2314 spec rather than merely
 *   counting rows.
 *
 * Plus the one newly-reachable failure: at a NON-NULL `locationId` the partial
 * unique indexes have no NULL to be distinct about, so the second source's
 * INSERT is refused and must surface as the typed
 * `InventoryCrossSourcePositionConflictError` rather than an opaque driver
 * error a job runner would retry forever. #2325 (the four-column index) is the
 * fix; until then the condition is reported honestly.
 *
 * NOTE the harness builds its schema by `synchronize`, not by the migrations,
 * matching its #2314 / #2319 siblings.
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
  InventoryCrossSourcePositionConflictError,
  InventoryItemEntity,
  INVENTORY_SERVICE_TOKEN,
  LEGACY_SOURCE_CONNECTION_ID,
} from '@openlinker/core/inventory';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

const ALPHA = 'connection-alpha';
const BETA = 'connection-beta';

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
  const productId = `ol_product_xsrc_${suffix}`;
  const variantId = `ol_variant_xsrc_${suffix}`;

  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({ id: productId, name: `XSrc Test ${suffix}`, sku: null, price: null }),
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

function item(
  productId: string,
  variantId: string | null,
  quantity: number,
  sourceConnectionId: string | null,
  locationId: string | null = null,
): InventoryItemEntity {
  return new InventoryItemEntity(
    `ignored-${productId}-${sourceConnectionId ?? 'none'}`,
    productId,
    variantId,
    quantity,
    0,
    locationId,
    new Date(),
    false,
    sourceConnectionId,
  );
}

describe('Inventory cross-source positions (#2320)', () => {
  let harness: IntegrationTestHarness;
  let inventoryService: IInventoryService;

  beforeAll(async () => {
    harness = await getTestHarness();
    inventoryService = harness.getApp().get<IInventoryService>(INVENTORY_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('gives two connections two rows instead of letting one clobber the other', async () => {
    const dataSource = harness.getDataSource();
    const { productId, variantId } = await seedProductAndVariant(dataSource);
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);

    await inventoryService.setInventory(item(productId, variantId, 5, ALPHA));
    await inventoryService.setInventory(item(productId, variantId, 11, BETA));

    const rows = await inventoryRepo.find({
      where: { productId, productVariantId: variantId },
      order: { sourceConnectionId: 'ASC' },
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sourceConnectionId)).toEqual([ALPHA, BETA]);
    // Alpha's figure is PRESERVED. Before #2320 beta's sync overwrote this row
    // in place and alpha read back 11 — the flapping ADR-058 decision (4) ends.
    expect(rows.find((r) => r.sourceConnectionId === ALPHA)?.availableQuantity).toBe(5);
    expect(rows.find((r) => r.sourceConnectionId === BETA)?.availableQuantity).toBe(11);

    // And each connection keeps converging on its OWN row rather than
    // alternating: a re-sync updates, it does not insert a third.
    await inventoryService.setInventory(item(productId, variantId, 6, ALPHA));
    const afterResync = await inventoryRepo.find({
      where: { productId, productVariantId: variantId },
    });
    expect(afterResync).toHaveLength(2);
    expect(afterResync.find((r) => r.sourceConnectionId === ALPHA)?.availableQuantity).toBe(6);
    expect(afterResync.find((r) => r.sourceConnectionId === BETA)?.availableQuantity).toBe(11);
  });

  it('stales only the scoping connection rows on a scoped prune', async () => {
    const dataSource = harness.getDataSource();
    const { productId, variantId } = await seedProductAndVariant(dataSource);
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);

    await inventoryService.setInventory(item(productId, variantId, 5, ALPHA));
    await inventoryService.setInventory(item(productId, variantId, 11, BETA));

    // The full-deletion shape: an empty keep set, which unscoped would stale
    // every row for the product regardless of who wrote it.
    const result = await inventoryService.pruneStaleVariants(productId, [], {
      sourceConnectionId: ALPHA,
      includeUnattributedProvenance: true,
    });

    expect(result.markedCount).toBe(1);
    expect(result.variantIds).toEqual([variantId]);

    const rows = await inventoryRepo.find({ where: { productId, productVariantId: variantId } });
    expect(rows.find((r) => r.sourceConnectionId === ALPHA)?.isStale).toBe(true);
    // Beta's row is untouched — a rival master's live stock is not this
    // connection's to delete.
    expect(rows.find((r) => r.sourceConnectionId === BETA)?.isStale).toBe(false);
  });

  it('claims a NULL-provenance row in place rather than inserting beside it', async () => {
    const dataSource = harness.getDataSource();
    const { productId, variantId, suffix } = await seedProductAndVariant(dataSource);
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);

    // A row as it looks on an install that predates the provenance column and
    // has not yet been reached by the #2317 sweep.
    const seeded = await inventoryRepo.save(
      inventoryRepo.create({
        id: `ol_inventory_xsrc_${suffix}`,
        productId,
        productVariantId: variantId,
        availableQuantity: 4,
        reservedQuantity: 0,
        locationId: null,
      }),
    );

    await inventoryService.setInventory(item(productId, variantId, 8, ALPHA));

    const rows = await inventoryRepo.find({ where: { productId, productVariantId: variantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(seeded.id);
    expect(rows[0].sourceConnectionId).toBe(ALPHA);
    expect(rows[0].availableQuantity).toBe(8);
  });

  it("claims a 'legacy'-sentinel row identically to a NULL one", async () => {
    const dataSource = harness.getDataSource();
    const { productId, variantId, suffix } = await seedProductAndVariant(dataSource);
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);

    // Same row, one #2317 sweep later. NULL and 'legacy' are ONE class, so the
    // sweep's progress must not change what a sync does.
    const seeded = await inventoryRepo.save(
      inventoryRepo.create({
        id: `ol_inventory_xsrc_${suffix}`,
        productId,
        productVariantId: variantId,
        availableQuantity: 4,
        reservedQuantity: 0,
        locationId: null,
        sourceConnectionId: LEGACY_SOURCE_CONNECTION_ID,
      }),
    );

    await inventoryService.setInventory(item(productId, variantId, 8, ALPHA));

    const rows = await inventoryRepo.find({ where: { productId, productVariantId: variantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(seeded.id);
    expect(rows[0].sourceConnectionId).toBe(ALPHA);
  });

  it('leaves a single-source install byte-identical, indexes included', async () => {
    const dataSource = harness.getDataSource();
    const before = await readIndexDefs(dataSource);

    // Sanity: the two partial unique indexes are present, so comparing an empty
    // set cannot pass vacuously.
    expect(
      before.filter(
        (d) => d.includes('UNIQUE INDEX') && /"productVariantId" IS (NOT )?NULL/.test(d),
      ),
    ).toHaveLength(2);

    const { productId, variantId } = await seedProductAndVariant(dataSource);
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);

    // A full single-source cycle: create, refresh, prune-with-keep, prune-empty.
    await inventoryService.setInventory(item(productId, variantId, 5, ALPHA));
    await inventoryService.setInventory(item(productId, variantId, 9, ALPHA));

    let rows = await inventoryRepo.find({ where: { productId, productVariantId: variantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].availableQuantity).toBe(9);

    const kept = await inventoryService.pruneStaleVariants(productId, [variantId], {
      sourceConnectionId: ALPHA,
      includeUnattributedProvenance: true,
    });
    expect(kept.markedCount).toBe(0);

    const swept = await inventoryService.pruneStaleVariants(productId, [], {
      sourceConnectionId: ALPHA,
      includeUnattributedProvenance: true,
    });
    expect(swept.markedCount).toBe(1);

    rows = await inventoryRepo.find({ where: { productId, productVariantId: variantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].isStale).toBe(true);

    // #2320 adds no column to any index — that is #2325's step, and doing it
    // early would make an index NULL-distinct and admit duplicate positions.
    expect(await readIndexDefs(dataSource)).toEqual(before);
  });

  it('reports a located cross-source collision as the typed error, not a raw driver failure', async () => {
    const dataSource = harness.getDataSource();
    const { productId, variantId } = await seedProductAndVariant(dataSource);

    // At a NON-NULL locationId the partial unique index has no NULL to be
    // distinct about, so the second source's INSERT cannot be admitted until
    // #2325 recreates the index over the four-column position key.
    await inventoryService.setInventory(item(productId, variantId, 5, ALPHA, 'loc-1'));

    await expect(
      inventoryService.setInventory(item(productId, variantId, 11, BETA, 'loc-1')),
    ).rejects.toBeInstanceOf(InventoryCrossSourcePositionConflictError);

    // The first source's row is intact: the refusal changed nothing.
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);
    const rows = await inventoryRepo.find({ where: { productId, productVariantId: variantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceConnectionId).toBe(ALPHA);
    expect(rows[0].availableQuantity).toBe(5);
  });
});
