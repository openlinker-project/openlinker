/**
 * Product Variant Cost Integration Test (#3588)
 *
 * Proves against real Postgres that the operator-authored net unit cost is
 * written only by its dedicated writers: a master-sync upsert leaves cost and
 * provenance untouched even when the domain object carries different values,
 * the bulk fill touches only NULLs and buckets skipped/unknown ids, the single
 * write overwrites and clears, and the DB CHECK refuses a half-set pair.
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import {
  IProductsService,
  PRODUCTS_SERVICE_TOKEN,
  ProductVariantNotFoundError,
} from '@openlinker/core/products';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

async function seedVariants(
  dataSource: DataSource,
  count: number
): Promise<{ productId: string; variantIds: string[] }> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const productId = `ol_product_cost_${suffix}`;
  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({ id: productId, name: `Cost ${suffix}`, sku: null, price: null })
  );
  const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
  const variantIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `ol_variant_cost_${suffix}_${i}`;
    variantIds.push(id);
    await variantRepo.save(
      variantRepo.create({ id, productId, sku: `S-${i}`, attributes: null, ean: null, gtin: null })
    );
  }
  return { productId, variantIds };
}

describe('Product variant cost (#3588)', () => {
  let harness: IntegrationTestHarness;
  let productsService: IProductsService;

  const readRow = (id: string): Promise<ProductVariantOrmEntity> =>
    harness.getDataSource().getRepository(ProductVariantOrmEntity).findOneByOrFail({ id });

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

  it('should leave cost and provenance untouched when a master sync upserts the variant', async () => {
    const { productId, variantIds } = await seedVariants(harness.getDataSource(), 1);
    await productsService.recordVariantCost(
      variantIds[0],
      { netUnitCost: '12.5000', currency: 'PLN' },
      'operator-1'
    );
    const before = await readRow(variantIds[0]);

    await productsService.upsertVariants(productId, [
      {
        id: variantIds[0],
        productId,
        sku: 'S-0-renamed',
        attributes: null,
        ean: null,
        gtin: null,
        netUnitCost: '99.0000',
        costCurrency: 'EUR',
        costUpdatedAt: new Date('2020-01-01T00:00:00Z'),
        costUpdatedByUserId: 'sync-bot',
      },
    ]);

    const after = await readRow(variantIds[0]);
    expect(after.sku).toBe('S-0-renamed');
    expect(after.netUnitCost).toBe('12.5000');
    expect(after.costCurrency).toBe('PLN');
    expect(after.costUpdatedByUserId).toBe('operator-1');
    expect(after.costUpdatedAt?.getTime()).toBe(before.costUpdatedAt?.getTime());
  });

  it('should fill only NULL costs in bulk and report skipped and unknown ids', async () => {
    const { variantIds } = await seedVariants(harness.getDataSource(), 3);
    await productsService.recordVariantCost(
      variantIds[1],
      { netUnitCost: '7.0000', currency: 'PLN' },
      'operator-1'
    );

    const result = await productsService.fillVariantCostsIfAbsent(
      [variantIds[0], variantIds[1], 'ol_variant_missing'],
      '3.0000',
      'EUR',
      'admin-2'
    );

    expect(result.filled).toEqual([variantIds[0]]);
    expect(result.skippedAlreadySet).toEqual([variantIds[1]]);
    expect(result.notFound).toEqual(['ol_variant_missing']);
    const filled = await readRow(variantIds[0]);
    expect([filled.netUnitCost, filled.costCurrency, filled.costUpdatedByUserId]).toEqual([
      '3.0000',
      'EUR',
      'admin-2',
    ]);
    const kept = await readRow(variantIds[1]);
    expect([kept.netUnitCost, kept.costCurrency]).toEqual(['7.0000', 'PLN']);
    expect((await readRow(variantIds[2])).netUnitCost).toBeNull();
  });

  it('should overwrite on a single write, accept 0.00, and clear with null', async () => {
    const { variantIds } = await seedVariants(harness.getDataSource(), 1);
    const id = variantIds[0];

    await productsService.recordVariantCost(id, { netUnitCost: '5.0000', currency: 'PLN' }, 'u1');
    await productsService.recordVariantCost(id, { netUnitCost: '0.00', currency: 'EUR' }, 'u2');
    const zero = await readRow(id);
    expect([zero.netUnitCost, zero.costCurrency, zero.costUpdatedByUserId]).toEqual([
      '0.0000',
      'EUR',
      'u2',
    ]);

    await productsService.recordVariantCost(id, null, 'u3');
    const cleared = await readRow(id);
    expect([cleared.netUnitCost, cleared.costCurrency]).toEqual([null, null]);
    expect(cleared.costUpdatedByUserId).toBe('u3');
    expect(cleared.costUpdatedAt).toBeInstanceOf(Date);
  });

  it('should throw ProductVariantNotFoundError for an unknown variant', async () => {
    await expect(
      productsService.recordVariantCost('ol_variant_nope', null, 'u1')
    ).rejects.toBeInstanceOf(ProductVariantNotFoundError);
  });

  it('should reject a half-set pair and a negative cost at the database', async () => {
    const { variantIds } = await seedVariants(harness.getDataSource(), 1);
    const ds = harness.getDataSource();

    await expect(
      ds.query(`UPDATE "product_variants" SET "netUnitCost" = 1 WHERE "id" = $1`, [variantIds[0]])
    ).rejects.toThrow(/CHK_product_variants_cost_pair/);
    await expect(
      ds.query(`UPDATE "product_variants" SET "costCurrency" = 'PLN' WHERE "id" = $1`, [
        variantIds[0],
      ])
    ).rejects.toThrow(/CHK_product_variants_cost_pair/);
    await expect(
      ds.query(
        `UPDATE "product_variants" SET "netUnitCost" = -1, "costCurrency" = 'PLN' WHERE "id" = $1`,
        [variantIds[0]]
      )
    ).rejects.toThrow(/CHK_product_variants_cost_non_negative/);
  });
});
