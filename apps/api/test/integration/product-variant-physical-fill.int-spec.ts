/**
 * Product Variant Physical-Data Fill Integration Test (#3650)
 *
 * Proves the fill-when-NULL writer against real Postgres: a NULL column is
 * filled, a column that already holds a value (operator-typed or earlier sync)
 * is left untouched even when the shop reports a different number, and a
 * re-sync never blanks anything. Real Postgres is required because the
 * guarantee is a per-column COALESCE inside one UPDATE, which a mock cannot
 * exercise.
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import { IProductsService, PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

async function seedVariant(
  dataSource: DataSource,
  physical: Partial<
    Pick<ProductVariantOrmEntity, 'weightGrams' | 'lengthMm' | 'widthMm' | 'heightMm'>
  > = {},
): Promise<string> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const productId = `ol_product_phys_${suffix}`;
  const variantId = `ol_variant_phys_${suffix}`;

  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({ id: productId, name: `Phys ${suffix}`, sku: null, price: null }),
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
      ...physical,
    }),
  );
  return variantId;
}

describe('Product variant physical-data fill-when-NULL (#3650)', () => {
  let harness: IntegrationTestHarness;
  let productsService: IProductsService;

  beforeAll(async () => {
    harness = await getTestHarness();
    productsService = harness.getApp().get<IProductsService>(PRODUCTS_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should fill every column that is NULL', async () => {
    const variantId = await seedVariant(harness.getDataSource());

    const filled = await productsService.fillVariantPhysicalDimensionsIfAbsent(variantId, {
      weightGrams: 700,
      lengthMm: 300,
      widthMm: 200,
      heightMm: 100,
    });

    const row = await harness
      .getDataSource()
      .getRepository(ProductVariantOrmEntity)
      .findOneByOrFail({ id: variantId });
    expect(filled).toBe(true);
    expect([row.weightGrams, row.lengthMm, row.widthMm, row.heightMm]).toEqual([700, 300, 200, 100]);
  });

  it('should keep an existing value and fill only the empty columns', async () => {
    const variantId = await seedVariant(harness.getDataSource(), { weightGrams: 1234 });

    await productsService.fillVariantPhysicalDimensionsIfAbsent(variantId, {
      weightGrams: 999,
      lengthMm: 300,
    });

    const row = await harness
      .getDataSource()
      .getRepository(ProductVariantOrmEntity)
      .findOneByOrFail({ id: variantId });
    expect(row.weightGrams).toBe(1234);
    expect(row.lengthMm).toBe(300);
    expect(row.widthMm).toBeNull();
  });

  it('should report nothing filled and change nothing when every supplied column already has a value', async () => {
    const variantId = await seedVariant(harness.getDataSource(), { weightGrams: 500 });

    const filled = await productsService.fillVariantPhysicalDimensionsIfAbsent(variantId, {
      weightGrams: 900,
    });

    const row = await harness
      .getDataSource()
      .getRepository(ProductVariantOrmEntity)
      .findOneByOrFail({ id: variantId });
    expect(filled).toBe(false);
    expect(row.weightGrams).toBe(500);
  });

  it('should never blank a column when the supplied value is null', async () => {
    const variantId = await seedVariant(harness.getDataSource(), { weightGrams: 500 });

    await productsService.fillVariantPhysicalDimensionsIfAbsent(variantId, {
      weightGrams: null,
      lengthMm: null,
    });

    const row = await harness
      .getDataSource()
      .getRepository(ProductVariantOrmEntity)
      .findOneByOrFail({ id: variantId });
    expect(row.weightGrams).toBe(500);
  });
});
