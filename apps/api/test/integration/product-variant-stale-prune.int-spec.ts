/**
 * Product Variant Stale-Prune Integration Test (#1599)
 *
 * Vertical slice for the products-context soft-delete of variants deleted at the
 * master. Seeds a product with variants, then drives the public products service
 * against Postgres to assert:
 * - `markVariantsStaleExcept` flags variants absent from the keep set (setting
 *   `staleAt`) and leaves kept variants live, returning the flagged ids;
 * - an empty keep-set marks EVERY live variant stale (the 404 whole-product path);
 * - `upsertVariants` clears a reappearing variant's `isStale`/`staleAt` flags.
 *
 * Uses real Postgres via Testcontainers — exercises the `UPDATE … RETURNING` and
 * empty-keep branch that a mocked unit test can't.
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

async function seedProduct(
  dataSource: DataSource,
  variantIds: string[],
): Promise<{ productId: string }> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const productId = `ol_product_vstale_${suffix}`;

  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({ id: productId, name: `VStale ${suffix}`, sku: null, price: null }),
  );

  const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
  for (const id of variantIds) {
    await variantRepo.save(
      variantRepo.create({ id, productId, sku: null, attributes: null, ean: null, gtin: null }),
    );
  }

  return { productId };
}

describe('Product variant stale-prune (#1599)', () => {
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

  it('marks variants absent from the keep set stale (with staleAt) and leaves kept variants live', async () => {
    const dataSource = harness.getDataSource();
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const keep = `ol_variant_keep_${suffix}`;
    const gone = `ol_variant_gone_${suffix}`;

    const { productId } = await seedProduct(dataSource, [keep, gone]);

    const marked = await productsService.markVariantsStaleExcept(productId, [keep]);
    expect(marked).toEqual([gone]);

    const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
    const keptRow = await variantRepo.findOneBy({ id: keep });
    const goneRow = await variantRepo.findOneBy({ id: gone });
    expect(keptRow?.isStale).toBe(false);
    expect(keptRow?.staleAt).toBeNull();
    expect(goneRow?.isStale).toBe(true);
    expect(goneRow?.staleAt).toBeInstanceOf(Date);
  });

  it('marks every live variant stale when the keep set is empty (product fully removed / 404)', async () => {
    const dataSource = harness.getDataSource();
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const a = `ol_variant_a_${suffix}`;
    const b = `ol_variant_b_${suffix}`;

    const { productId } = await seedProduct(dataSource, [a, b]);

    const marked = await productsService.markVariantsStaleExcept(productId, []);
    expect(marked.sort()).toEqual([a, b].sort());

    const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
    const rows = await variantRepo.findBy({ productId });
    expect(rows.every((r) => r.isStale)).toBe(true);
  });

  it('does not re-flag an already-stale variant (idempotent — returns only newly flagged)', async () => {
    const dataSource = harness.getDataSource();
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const gone = `ol_variant_gone_${suffix}`;

    const { productId } = await seedProduct(dataSource, [gone]);

    const first = await productsService.markVariantsStaleExcept(productId, []);
    expect(first).toEqual([gone]);
    const second = await productsService.markVariantsStaleExcept(productId, []);
    expect(second).toEqual([]);
  });

  it('clears isStale/staleAt when a stale variant reappears via upsertVariants', async () => {
    const dataSource = harness.getDataSource();
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const variantId = `ol_variant_back_${suffix}`;

    const { productId } = await seedProduct(dataSource, [variantId]);
    await productsService.markVariantsStaleExcept(productId, []);

    await productsService.upsertVariants(productId, [
      { id: variantId, productId, sku: null, attributes: null, ean: null, gtin: null },
    ]);

    const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
    const row = await variantRepo.findOneBy({ id: variantId });
    expect(row?.isStale).toBe(false);
    expect(row?.staleAt).toBeNull();
  });
});
