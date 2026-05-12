/**
 * Inventory Test Fixtures
 *
 * Factory helpers for seeding inventory_items rows in integration tests.
 * Also seeds the required parent product row.
 *
 * @module apps/api/test/integration/fixtures
 */
import { DataSource } from 'typeorm';
import { ProductOrmEntity } from '@openlinker/core/products/orm-entities';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';

/**
 * Seed a product + inventory item row.
 *
 * Returns the seeded inventory item.
 *
 * @param productOverrides Optional overrides applied to the seeded parent
 * product (e.g. `images`) — defaults keep the product minimal.
 */
export async function createTestInventoryItem(
  dataSource: DataSource,
  overrides?: Partial<InventoryItemOrmEntity>,
  productOverrides?: Partial<ProductOrmEntity>,
): Promise<InventoryItemOrmEntity> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const productId = `ol_product_fixture_${suffix}`;

  // Seed parent product (inventory_items has FK to products)
  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({
      id: productId,
      name: `Test Product ${suffix}`,
      sku: null,
      price: null,
      ...productOverrides,
    }),
  );

  const repo = dataSource.getRepository(InventoryItemOrmEntity);
  const entity = repo.create({
    id: `ol_inventory_fixture_${suffix}`,
    productId,
    productVariantId: null,
    availableQuantity: 10,
    reservedQuantity: 0,
    locationId: null,
    ...overrides,
  });

  return repo.save(entity);
}
