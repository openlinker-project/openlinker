/**
 * Inventory Stale-Prune Integration Test (#1478)
 *
 * Vertical slice for the soft-delete of orphaned inventory rows. Seeds a product
 * with per-variant inventory, then drives the public inventory services against
 * Postgres to assert:
 * - `pruneStaleVariants` flags rows whose variant is absent from the keep set and
 *   leaves kept rows live (variant-level and product-level `null`);
 * - `getAvailabilityByVariantIds` excludes stale rows (zero-fills them);
 * - a reappearing variant clears its own `isStale` flag through `setInventory`,
 *   without creating a duplicate row.
 *
 * Uses real Postgres via Testcontainers.
 *
 * @module apps/api/test/integration
 */
import { DataSource, IsNull } from 'typeorm';
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

interface SeedRow {
  variantId: string | null;
  availableQuantity: number;
}

/** Seeds one product + its variants + one inventory row per spec entry (location null). */
async function seedProduct(
  dataSource: DataSource,
  rows: SeedRow[],
): Promise<{ productId: string }> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const productId = `ol_product_stale_${suffix}`;

  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({ id: productId, name: `Stale Test ${suffix}`, sku: null, price: null }),
  );

  const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
  const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);

  for (const row of rows) {
    if (row.variantId !== null) {
      await variantRepo.save(
        variantRepo.create({
          id: row.variantId,
          productId,
          sku: null,
          attributes: null,
          ean: null,
          gtin: null,
        }),
      );
    }
    await inventoryRepo.save(
      inventoryRepo.create({
        id: `ol_inventory_${row.variantId ?? 'base'}_${suffix}`,
        productId,
        productVariantId: row.variantId,
        availableQuantity: row.availableQuantity,
        reservedQuantity: 0,
        locationId: null,
      }),
    );
  }

  return { productId };
}

describe('Inventory stale-prune (#1478)', () => {
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

  it('marks variant rows absent from the keep set stale and leaves kept rows live', async () => {
    const dataSource = harness.getDataSource();
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const variantKeep = `ol_variant_keep_${suffix}`;
    const variantGone = `ol_variant_gone_${suffix}`;

    const { productId } = await seedProduct(dataSource, [
      { variantId: variantKeep, availableQuantity: 5 },
      { variantId: variantGone, availableQuantity: 3 },
    ]);

    const marked = await inventoryService.pruneStaleVariants(productId, [variantKeep]);
    expect(marked.markedCount).toBe(1);
    // The `UPDATE … RETURNING "productVariantId"` extraction surfaces the exact
    // flagged variant id (real-Postgres coverage for the RETURNING path, #1599).
    expect(marked.variantIds).toEqual([variantGone]);

    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);
    const kept = await inventoryRepo.findOneBy({ productId, productVariantId: variantKeep });
    const gone = await inventoryRepo.findOneBy({ productId, productVariantId: variantGone });
    expect(kept?.isStale).toBe(false);
    expect(gone?.isStale).toBe(true);
  });

  it('excludes stale rows from the variant-availability read', async () => {
    const dataSource = harness.getDataSource();
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const variantKeep = `ol_variant_keep_${suffix}`;
    const variantGone = `ol_variant_gone_${suffix}`;

    const { productId } = await seedProduct(dataSource, [
      { variantId: variantKeep, availableQuantity: 5 },
      { variantId: variantGone, availableQuantity: 3 },
    ]);
    await inventoryService.pruneStaleVariants(productId, [variantKeep]);

    const availability = await queryService.getAvailabilityByVariantIds([variantKeep, variantGone]);
    const byId = new Map(availability.map((a) => [a.productVariantId, a.totalAvailable]));

    // Kept variant keeps its stock; stale variant is excluded from the aggregate
    // and therefore zero-filled by the query service.
    expect(byId.get(variantKeep)).toBe(5);
    expect(byId.get(variantGone)).toBe(0);
  });

  it('clears isStale when a variant reappears via setInventory, reusing the same row', async () => {
    const dataSource = harness.getDataSource();
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const variantKeep = `ol_variant_keep_${suffix}`;
    const variantGone = `ol_variant_gone_${suffix}`;

    const { productId } = await seedProduct(dataSource, [
      { variantId: variantKeep, availableQuantity: 5 },
      { variantId: variantGone, availableQuantity: 3 },
    ]);
    await inventoryService.pruneStaleVariants(productId, [variantKeep]);

    // The gone variant reappears at the master — a fresh (live) canonical write.
    await inventoryService.setInventory(
      new InventoryItemEntity(
        `ignored-${suffix}`,
        productId,
        variantGone,
        4,
        0,
        null,
        new Date(),
        false,
      ),
    );

    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);
    const rows = await inventoryRepo.find({ where: { productId, productVariantId: variantGone } });
    expect(rows).toHaveLength(1); // no duplicate created
    expect(rows[0].isStale).toBe(false);
    expect(rows[0].availableQuantity).toBe(4);

    const availability = await queryService.getAvailabilityByVariantIds([variantGone]);
    expect(availability.find((a) => a.productVariantId === variantGone)?.totalAvailable).toBe(4);
  });

  it('marks a product-level (null-variant) row stale when the keep set omits null', async () => {
    const dataSource = harness.getDataSource();
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const variantKeep = `ol_variant_keep_${suffix}`;

    const { productId } = await seedProduct(dataSource, [
      { variantId: variantKeep, availableQuantity: 5 },
      { variantId: null, availableQuantity: 9 },
    ]);

    const marked = await inventoryService.pruneStaleVariants(productId, [variantKeep]);
    expect(marked.markedCount).toBe(1);

    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);
    const baseRow = await inventoryRepo.findOneBy({ productId, productVariantId: IsNull() });
    const keptRow = await inventoryRepo.findOneBy({ productId, productVariantId: variantKeep });
    expect(baseRow?.isStale).toBe(true);
    expect(keptRow?.isStale).toBe(false);
  });

  it('keeps a product-level (null-variant) row live when the keep set includes null', async () => {
    const dataSource = harness.getDataSource();
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const variantGone = `ol_variant_gone_${suffix}`;

    const { productId } = await seedProduct(dataSource, [
      { variantId: null, availableQuantity: 9 },
      { variantId: variantGone, availableQuantity: 3 },
    ]);

    const marked = await inventoryService.pruneStaleVariants(productId, [null]);
    expect(marked.markedCount).toBe(1);

    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);
    const baseRow = await inventoryRepo.findOneBy({ productId, productVariantId: IsNull() });
    const goneRow = await inventoryRepo.findOneBy({ productId, productVariantId: variantGone });
    expect(baseRow?.isStale).toBe(false);
    expect(goneRow?.isStale).toBe(true);
  });
});
