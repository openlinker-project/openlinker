/**
 * Inventory Variant Backfill Migration Integration Test (#822)
 *
 * The shared harness runs migrations once against an empty DB at boot, so the
 * data-only backfill UPDATE never executes on seeded data there. This spec
 * seeds the pre-migration shape (product-level inventory rows) and runs the
 * migration's `up()` directly to assert the conversion:
 * - a single-variant product's product-level row becomes variant-keyed;
 * - a multi-variant product's row stays product-level (NULL);
 * - the `NOT EXISTS` guard skips a row that would collide with an existing
 *   variant-keyed row (which would otherwise violate the variant-level partial
 *   unique index).
 *
 * Uses real Postgres via Testcontainers.
 *
 * @module apps/api/test/integration
 */
import {
  ProductOrmEntity,
  ProductVariantOrmEntity,
} from '@openlinker/core/products/orm-entities';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';
import { BackfillInventoryVariantId1799000000003 } from '../../src/migrations/1799000000003-backfill-inventory-variant-id';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

describe('BackfillInventoryVariantId migration (#822)', () => {
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

  async function runBackfill(): Promise<void> {
    const queryRunner = harness.getDataSource().createQueryRunner();
    try {
      await new BackfillInventoryVariantId1799000000003().up(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  it('keys single-variant product-level rows to the variant; leaves multi-variant rows product-level', async () => {
    const dataSource = harness.getDataSource();
    const productRepo = dataSource.getRepository(ProductOrmEntity);
    const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    // Simple product: one variant + one product-level inventory row.
    const simpleProductId = `ol_product_simple_${suffix}`;
    const simpleVariantId = `ol_variant_simple_${suffix}`;
    const simpleInvId = `ol_inventory_simple_${suffix}`;
    await productRepo.save(
      productRepo.create({ id: simpleProductId, name: 'Simple', sku: null, price: null }),
    );
    await variantRepo.save(
      variantRepo.create({
        id: simpleVariantId,
        productId: simpleProductId,
        sku: null,
        attributes: null,
        ean: null,
        gtin: null,
      }),
    );
    await inventoryRepo.save(
      inventoryRepo.create({
        id: simpleInvId,
        productId: simpleProductId,
        productVariantId: null,
        availableQuantity: 15,
        reservedQuantity: 0,
        locationId: null,
      }),
    );

    // Multi-variant product: two variants + one product-level inventory row.
    const multiProductId = `ol_product_multi_${suffix}`;
    const multiInvId = `ol_inventory_multi_${suffix}`;
    await productRepo.save(
      productRepo.create({ id: multiProductId, name: 'Multi', sku: null, price: null }),
    );
    for (const n of ['m1', 'm2']) {
      await variantRepo.save(
        variantRepo.create({
          id: `ol_variant_${n}_${suffix}`,
          productId: multiProductId,
          sku: null,
          attributes: null,
          ean: null,
          gtin: null,
        }),
      );
    }
    await inventoryRepo.save(
      inventoryRepo.create({
        id: multiInvId,
        productId: multiProductId,
        productVariantId: null,
        availableQuantity: 7,
        reservedQuantity: 0,
        locationId: null,
      }),
    );

    await runBackfill();

    const simpleAfter = await inventoryRepo.findOneByOrFail({ id: simpleInvId });
    const multiAfter = await inventoryRepo.findOneByOrFail({ id: multiInvId });
    expect(simpleAfter.productVariantId).toBe(simpleVariantId);
    expect(multiAfter.productVariantId).toBeNull();
  });

  it('skips a product-level row that would collide with an existing variant-keyed row', async () => {
    const dataSource = harness.getDataSource();
    const productRepo = dataSource.getRepository(ProductOrmEntity);
    const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    const productId = `ol_product_guard_${suffix}`;
    const variantId = `ol_variant_guard_${suffix}`;
    const variantRowId = `ol_inventory_variant_${suffix}`;
    const productRowId = `ol_inventory_product_${suffix}`;

    await productRepo.save(
      productRepo.create({ id: productId, name: 'Guard', sku: null, price: null }),
    );
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
    // A variant-keyed row already exists at (product, variant, null location)…
    await inventoryRepo.save(
      inventoryRepo.create({
        id: variantRowId,
        productId,
        productVariantId: variantId,
        availableQuantity: 20,
        reservedQuantity: 0,
        locationId: null,
      }),
    );
    // …and a stray product-level row at the same location.
    await inventoryRepo.save(
      inventoryRepo.create({
        id: productRowId,
        productId,
        productVariantId: null,
        availableQuantity: 5,
        reservedQuantity: 0,
        locationId: null,
      }),
    );

    // Must not throw (the guard avoids the would-be unique-index violation).
    await runBackfill();

    const productRowAfter = await inventoryRepo.findOneByOrFail({ id: productRowId });
    expect(productRowAfter.productVariantId).toBeNull();
  });
});
