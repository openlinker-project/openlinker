/**
 * Inventory Test Fixtures
 *
 * Factory helpers for seeding inventory_items rows in integration tests.
 * Also seeds the required parent product row.
 *
 * @module apps/api/test/integration/fixtures
 */
import { DataSource } from 'typeorm';
import { ProductOrmEntity } from '@openlinker/core/products';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory';

let productCounter = 0;

/**
 * Seed a product + inventory item row.
 *
 * Returns the seeded inventory item.
 */
export async function createTestInventoryItem(
  dataSource: DataSource,
  overrides?: Partial<InventoryItemOrmEntity>,
): Promise<InventoryItemOrmEntity> {
  productCounter++;
  const productId = `ol_product_fixture_${productCounter}`;

  // Seed parent product (inventory_items has FK to products)
  const productRepo = dataSource.getRepository(ProductOrmEntity);
  if (!(await productRepo.findOne({ where: { id: productId } }))) {
    await productRepo.save(
      productRepo.create({ id: productId, name: `Test Product ${productCounter}`, sku: null, price: null }),
    );
  }

  const repo = dataSource.getRepository(InventoryItemOrmEntity);
  const entity = repo.create({
    id: `ol_inventory_fixture_${productCounter}`,
    productId,
    productVariantId: null,
    availableQuantity: 10,
    reservedQuantity: 0,
    locationId: null,
    ...overrides,
  });

  return repo.save(entity);
}
