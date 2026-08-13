/**
 * Recently-Listed Variant Ids Integration Test (#1983)
 *
 * Exercises the real `OfferMappingRepository.findRecentlyListedVariantIds` /
 * `ShopProductMappingRepository.findRecentlyListedVariantIds` against
 * Testcontainers Postgres — the coverage-gap / stock-at-risk candidate-pool
 * read backing `CoverageGapReadService` / `StockAtRiskReadService`. Both
 * methods are hand-written query-builder SQL (raw-table join onto
 * `product_variants`, `GROUP BY`, `ORDER BY` on an aggregate alias) that the
 * services' own unit specs never execute, since those mock the repository
 * ports entirely. Mirrors `product-variant-stale-prune.int-spec.ts`'s
 * `seedProduct` helper and `failed-sync-value-summary.int-spec.ts`'s
 * structure.
 *
 * @module apps/api/test/integration
 */
import type { DataSource } from 'typeorm';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import {
  OFFER_MAPPING_REPOSITORY_TOKEN,
  SHOP_PRODUCT_MAPPING_REPOSITORY_TOKEN,
  type OfferMappingRepositoryPort,
  type ShopProductMappingRepositoryPort,
} from '@openlinker/core/listings';
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';

const CONNECTION_A = '11111111-1111-4111-8111-111111111111';
const CONNECTION_B = '22222222-2222-4222-8222-222222222222';

async function seedProduct(dataSource: DataSource, variantIds: string[]): Promise<{ productId: string }> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const productId = `ol_product_recent_${suffix}`;

  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({ id: productId, name: `Recent ${suffix}`, sku: null, price: null }),
  );

  const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
  for (const id of variantIds) {
    await variantRepo.save(
      variantRepo.create({ id, productId, sku: null, attributes: null, ean: null, gtin: null }),
    );
  }

  return { productId };
}

async function markStale(dataSource: DataSource, variantId: string): Promise<void> {
  await dataSource
    .getRepository(ProductVariantOrmEntity)
    .update({ id: variantId }, { isStale: true, staleAt: new Date() });
}

async function seedMapping(
  dataSource: DataSource,
  overrides: Partial<IdentifierMappingOrmEntity>,
): Promise<void> {
  const repo = dataSource.getRepository(IdentifierMappingOrmEntity);
  await repo.save(
    repo.create({
      entityType: 'Offer',
      internalId: 'ol_variant_placeholder',
      externalId: `ext_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      platformType: 'allegro',
      connectionId: CONNECTION_A,
      context: null,
      ...overrides,
    }),
  );
}

describe('Recently-listed variant ids (#1983)', () => {
  let harness: IntegrationTestHarness;
  let offerMappingRepository: OfferMappingRepositoryPort;
  let shopProductMappingRepository: ShopProductMappingRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    offerMappingRepository = harness
      .getApp()
      .get<OfferMappingRepositoryPort>(OFFER_MAPPING_REPOSITORY_TOKEN);
    shopProductMappingRepository = harness
      .getApp()
      .get<ShopProductMappingRepositoryPort>(SHOP_PRODUCT_MAPPING_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('OfferMappingRepository.findRecentlyListedVariantIds', () => {
    it('returns distinct variant ids for entityType=Offer mappings, with their product id', async () => {
      const ds = harness.getDataSource();
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const variantId = `ol_variant_offer_${suffix}`;
      const { productId } = await seedProduct(ds, [variantId]);
      await seedMapping(ds, { entityType: 'Offer', internalId: variantId, connectionId: CONNECTION_A });

      const rows = await offerMappingRepository.findRecentlyListedVariantIds({ limit: 20 });

      expect(rows).toContainEqual({ variantId, productId });
    });

    it('excludes isStale (#1689) variants', async () => {
      const ds = harness.getDataSource();
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const staleVariant = `ol_variant_stale_${suffix}`;
      const liveVariant = `ol_variant_live_${suffix}`;
      await seedProduct(ds, [staleVariant, liveVariant]);
      await markStale(ds, staleVariant);
      await seedMapping(ds, { entityType: 'Offer', internalId: staleVariant, connectionId: CONNECTION_A });
      await seedMapping(ds, { entityType: 'Offer', internalId: liveVariant, connectionId: CONNECTION_A });

      const rows = await offerMappingRepository.findRecentlyListedVariantIds({ limit: 20 });

      expect(rows.map((r) => r.variantId)).not.toContain(staleVariant);
      expect(rows.map((r) => r.variantId)).toContain(liveVariant);
    });

    it('scopes to one connection when connectionId is given', async () => {
      const ds = harness.getDataSource();
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const variantOnA = `ol_variant_a_${suffix}`;
      const variantOnB = `ol_variant_b_${suffix}`;
      await seedProduct(ds, [variantOnA, variantOnB]);
      await seedMapping(ds, { entityType: 'Offer', internalId: variantOnA, connectionId: CONNECTION_A });
      await seedMapping(ds, { entityType: 'Offer', internalId: variantOnB, connectionId: CONNECTION_B });

      const rows = await offerMappingRepository.findRecentlyListedVariantIds({
        connectionId: CONNECTION_A,
        limit: 20,
      });

      expect(rows.map((r) => r.variantId)).toEqual([variantOnA]);
    });

    it('caps output at the requested limit', async () => {
      const ds = harness.getDataSource();
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const variantIds = [`ol_variant_cap1_${suffix}`, `ol_variant_cap2_${suffix}`, `ol_variant_cap3_${suffix}`];
      await seedProduct(ds, variantIds);
      for (const variantId of variantIds) {
        await seedMapping(ds, { entityType: 'Offer', internalId: variantId, connectionId: CONNECTION_A });
      }

      const rows = await offerMappingRepository.findRecentlyListedVariantIds({ limit: 2 });

      expect(rows).toHaveLength(2);
    });

    it('does not return entityType=ShopProduct mappings', async () => {
      const ds = harness.getDataSource();
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const variantId = `ol_variant_shoponly_${suffix}`;
      await seedProduct(ds, [variantId]);
      await seedMapping(ds, {
        entityType: 'ShopProduct',
        internalId: variantId,
        connectionId: CONNECTION_A,
      });

      const rows = await offerMappingRepository.findRecentlyListedVariantIds({ limit: 20 });

      expect(rows.map((r) => r.variantId)).not.toContain(variantId);
    });
  });

  describe('ShopProductMappingRepository.findRecentlyListedVariantIds', () => {
    it('returns distinct variant ids for entityType=ShopProduct mappings, with their product id', async () => {
      const ds = harness.getDataSource();
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const variantId = `ol_variant_shop_${suffix}`;
      const { productId } = await seedProduct(ds, [variantId]);
      await seedMapping(ds, {
        entityType: 'ShopProduct',
        internalId: variantId,
        connectionId: CONNECTION_A,
      });

      const rows = await shopProductMappingRepository.findRecentlyListedVariantIds({ limit: 20 });

      expect(rows).toContainEqual({ variantId, productId });
    });

    it('excludes isStale (#1689) variants', async () => {
      const ds = harness.getDataSource();
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const staleVariant = `ol_variant_shopstale_${suffix}`;
      await seedProduct(ds, [staleVariant]);
      await markStale(ds, staleVariant);
      await seedMapping(ds, {
        entityType: 'ShopProduct',
        internalId: staleVariant,
        connectionId: CONNECTION_A,
      });

      const rows = await shopProductMappingRepository.findRecentlyListedVariantIds({ limit: 20 });

      expect(rows.map((r) => r.variantId)).not.toContain(staleVariant);
    });

    it('scopes to one connection when connectionId is given', async () => {
      const ds = harness.getDataSource();
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const variantOnA = `ol_variant_shopa_${suffix}`;
      const variantOnB = `ol_variant_shopb_${suffix}`;
      await seedProduct(ds, [variantOnA, variantOnB]);
      await seedMapping(ds, {
        entityType: 'ShopProduct',
        internalId: variantOnA,
        connectionId: CONNECTION_A,
      });
      await seedMapping(ds, {
        entityType: 'ShopProduct',
        internalId: variantOnB,
        connectionId: CONNECTION_B,
      });

      const rows = await shopProductMappingRepository.findRecentlyListedVariantIds({
        connectionId: CONNECTION_B,
        limit: 20,
      });

      expect(rows.map((r) => r.variantId)).toEqual([variantOnB]);
    });
  });
});
