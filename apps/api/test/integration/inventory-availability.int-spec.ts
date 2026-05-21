/**
 * Inventory Availability Endpoint Integration Test
 *
 * Vertical slice for `GET /inventory/availability` (#792 PR 2). Seeds
 * variants with multi-location inventory and asserts the endpoint sums
 * `availableQuantity` per variant, counts distinct locations, and
 * zero-fills variants with no inventory rows.
 *
 * Uses real Postgres via Testcontainers.
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
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';

interface SeedVariantInventory {
  variantId: string;
  rows: Array<{ availableQuantity: number; locationId: string | null }>;
}

/**
 * Seeds one product + N variants + per-variant inventory rows. Returns
 * the variant IDs in the order they were requested so the test body can
 * reference them stably.
 */
async function seedProductWithVariantInventory(
  dataSource: DataSource,
  spec: SeedVariantInventory[],
): Promise<{ productId: string; variantIds: string[] }> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const productId = `ol_product_avail_${suffix}`;

  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({
      id: productId,
      name: `Availability Test Product ${suffix}`,
      sku: null,
      price: null,
    }),
  );

  const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
  const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);
  const variantIds: string[] = [];

  for (const v of spec) {
    await variantRepo.save(
      variantRepo.create({
        id: v.variantId,
        productId,
        sku: null,
        attributes: null,
        ean: null,
        gtin: null,
      }),
    );
    variantIds.push(v.variantId);

    for (let i = 0; i < v.rows.length; i++) {
      const row = v.rows[i];
      await inventoryRepo.save(
        inventoryRepo.create({
          id: `ol_inventory_${v.variantId}_${i.toString()}`,
          productId,
          productVariantId: v.variantId,
          availableQuantity: row.availableQuantity,
          reservedQuantity: 0,
          locationId: row.locationId,
        }),
      );
    }
  }

  return { productId, variantIds };
}

describe('GET /inventory/availability (#792 PR 2)', () => {
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

  it('sums availableQuantity across locations, counts distinct locations, zero-fills unknowns', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const variantMulti = `ol_variant_multi_${suffix}`;
    const variantSingle = `ol_variant_single_${suffix}`;
    const variantEmpty = `ol_variant_empty_${suffix}`;
    const variantUnknown = `ol_variant_unknown_${suffix}`;

    await seedProductWithVariantInventory(dataSource, [
      {
        variantId: variantMulti,
        rows: [
          { availableQuantity: 5, locationId: 'warehouse-a' },
          { availableQuantity: 3, locationId: 'warehouse-b' },
        ],
      },
      {
        variantId: variantSingle,
        rows: [{ availableQuantity: 10, locationId: 'warehouse-a' }],
      },
      {
        // Seeded but with no inventory rows — expected to zero-fill.
        variantId: variantEmpty,
        rows: [],
      },
    ]);

    const params = new URLSearchParams({
      productVariantIds: [variantMulti, variantSingle, variantEmpty, variantUnknown].join(','),
    });

    const response = await http
      .get(`/inventory/availability?${params.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.items).toHaveLength(4);

    const byId = new Map<string, { totalAvailable: number; locationCount: number }>(
      (response.body.items as Array<{
        productVariantId: string;
        totalAvailable: number;
        locationCount: number;
      }>).map((item) => [
        item.productVariantId,
        { totalAvailable: item.totalAvailable, locationCount: item.locationCount },
      ]),
    );

    // Multi-location: 5 + 3 = 8 across 2 distinct locations.
    expect(byId.get(variantMulti)).toEqual({ totalAvailable: 8, locationCount: 2 });
    // Single-location: 10 across 1 distinct location.
    expect(byId.get(variantSingle)).toEqual({ totalAvailable: 10, locationCount: 1 });
    // Seeded but no inventory rows → zero-fill.
    expect(byId.get(variantEmpty)).toEqual({ totalAvailable: 0, locationCount: 0 });
    // Not seeded at all → zero-fill (variant doesn't even exist in the variants table).
    expect(byId.get(variantUnknown)).toEqual({ totalAvailable: 0, locationCount: 0 });
  });

  it('returns 400 on empty productVariantIds list', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    await http
      .get('/inventory/availability?productVariantIds=')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('returns 400 when more than 200 productVariantIds are requested', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    const ids = Array.from({ length: 201 }, (_, i) => `ol_variant_${i.toString()}`).join(',');

    await http
      .get(`/inventory/availability?productVariantIds=${ids}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('returns 401 without an auth token', async () => {
    const http = harness.getHttp();
    await http.get('/inventory/availability?productVariantIds=ol_variant_x').expect(401);
  });

  it('preserves input order in the response items[]', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const v1 = `ol_variant_order1_${suffix}`;
    const v2 = `ol_variant_order2_${suffix}`;
    const v3 = `ol_variant_order3_${suffix}`;

    await seedProductWithVariantInventory(dataSource, [
      { variantId: v1, rows: [{ availableQuantity: 1, locationId: 'w' }] },
      { variantId: v2, rows: [{ availableQuantity: 2, locationId: 'w' }] },
      { variantId: v3, rows: [{ availableQuantity: 3, locationId: 'w' }] },
    ]);

    // Request in reverse order — response must echo input order.
    const params = new URLSearchParams({
      productVariantIds: [v3, v1, v2].join(','),
    });

    const response = await http
      .get(`/inventory/availability?${params.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(
      (response.body.items as Array<{ productVariantId: string }>).map((i) => i.productVariantId),
    ).toEqual([v3, v1, v2]);
  });
});
