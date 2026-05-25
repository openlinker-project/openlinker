/**
 * Multi-variant Product-Level Inventory Cleanup Migration Integration Test (#823)
 *
 * The shared harness runs migrations once against an empty DB at boot, so the
 * data-only cleanup DELETE never executes on seeded data there. This spec seeds
 * the pre-#823 shape (a stale product-level NULL-variant inventory row) and runs
 * the migration's `up()` directly to assert:
 * - a multi-variant product's product-level NULL row is deleted;
 * - a multi-variant product's variant-keyed rows are left intact (only NULL rows go);
 * - a single-variant product's product-level NULL row is left intact (scope is >1 variant).
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
import { CleanupMultivariantProductLevelInventory1799000000004 } from '../../src/migrations/1799000000004-cleanup-multivariant-product-level-inventory';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

describe('CleanupMultivariantProductLevelInventory migration (#823)', () => {
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

  async function runCleanup(): Promise<void> {
    const queryRunner = harness.getDataSource().createQueryRunner();
    try {
      await new CleanupMultivariantProductLevelInventory1799000000004().up(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  it('deletes only product-level rows of multi-variant products', async () => {
    const dataSource = harness.getDataSource();
    const productRepo = dataSource.getRepository(ProductOrmEntity);
    const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    const makeVariant = async (id: string, productId: string): Promise<void> => {
      await variantRepo.save(
        variantRepo.create({
          id,
          productId,
          sku: null,
          attributes: null,
          ean: null,
          gtin: null,
        }),
      );
    };

    // Multi-variant product: two variants + a stale product-level NULL row +
    // a legitimate variant-keyed row.
    const multiProductId = `ol_product_multi_${suffix}`;
    const multiNullInvId = `ol_inventory_multi_null_${suffix}`;
    const multiVariantInvId = `ol_inventory_multi_variant_${suffix}`;
    await productRepo.save(
      productRepo.create({ id: multiProductId, name: 'Multi', sku: null, price: null }),
    );
    await makeVariant(`ol_variant_m1_${suffix}`, multiProductId);
    await makeVariant(`ol_variant_m2_${suffix}`, multiProductId);
    await inventoryRepo.save(
      inventoryRepo.create({
        id: multiNullInvId,
        productId: multiProductId,
        productVariantId: null,
        availableQuantity: 7,
        reservedQuantity: 0,
        locationId: null,
      }),
    );
    await inventoryRepo.save(
      inventoryRepo.create({
        id: multiVariantInvId,
        productId: multiProductId,
        productVariantId: `ol_variant_m1_${suffix}`,
        availableQuantity: 3,
        reservedQuantity: 0,
        locationId: null,
      }),
    );

    // Single-variant product: one variant + a product-level NULL row (out of scope).
    const singleProductId = `ol_product_single_${suffix}`;
    const singleNullInvId = `ol_inventory_single_null_${suffix}`;
    await productRepo.save(
      productRepo.create({ id: singleProductId, name: 'Single', sku: null, price: null }),
    );
    await makeVariant(`ol_variant_s1_${suffix}`, singleProductId);
    await inventoryRepo.save(
      inventoryRepo.create({
        id: singleNullInvId,
        productId: singleProductId,
        productVariantId: null,
        availableQuantity: 15,
        reservedQuantity: 0,
        locationId: null,
      }),
    );

    await runCleanup();

    expect(await inventoryRepo.findOneBy({ id: multiNullInvId })).toBeNull();
    expect(await inventoryRepo.findOneBy({ id: multiVariantInvId })).not.toBeNull();
    expect(await inventoryRepo.findOneBy({ id: singleNullInvId })).not.toBeNull();
  });
});
