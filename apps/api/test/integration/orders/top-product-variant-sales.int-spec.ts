/**
 * Top Product Variant Sales Int-Spec (#2765)
 *
 * Exercises `IOrderRecordService.getTopProductVariantSales` against the real
 * Postgres harness — the variant-scoped counterpart to
 * `top-products-ranking.int-spec.ts`. Proves the same two things that file
 * proves for the product-level read, one grain finer:
 *
 * 1. The FILTER/GROUP BY aggregate SQL, grouped by `variantId` instead of
 *    `productId` and pre-filtered to one product, produces correct numbers.
 * 2. A `variantId: null` line (order_line_items' documented "simple
 *    product's synthetic-variant edge case") surfaces as its own row rather
 *    than being dropped or silently merged.
 *
 * @module apps/api/test/integration/orders
 */
import {
  ORDER_RECORD_SERVICE_TOKEN,
  type IOrderRecordService,
} from '@openlinker/core/orders';
import { OrderLineItemOrmEntity } from '@openlinker/core/orders/orm-entities';
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  type IntegrationTestHarness,
} from '../setup';
import { createTestConnection } from '../helpers/test-connection.helper';
import { createTestOrderRecord } from '../fixtures/order.fixtures';

describe('Top product variant sales — real Postgres (#2765)', () => {
  let harness: IntegrationTestHarness;
  let orderRecordService: IOrderRecordService;

  beforeAll(async () => {
    harness = await getTestHarness();
    orderRecordService = harness.getApp().get<IOrderRecordService>(ORDER_RECORD_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const filters = {
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-08-08T00:00:00.000Z'),
  };

  async function seedLineItem(
    dataSource: ReturnType<IntegrationTestHarness['getDataSource']>,
    overrides: Partial<OrderLineItemOrmEntity>
  ): Promise<void> {
    const repo = dataSource.getRepository(OrderLineItemOrmEntity);
    await repo.save(
      repo.create({
        orderRecordId: 'ol_order_placeholder',
        lineNumber: 0,
        productId: 'ol_product_placeholder',
        variantId: null,
        quantity: 1,
        unitPrice: 0,
        sourceConnectionId: '00000000-0000-4000-8000-000000000000',
        placedAt: new Date('2026-08-02T00:00:00.000Z'),
        ...overrides,
      })
    );
  }

  it('groups one product’s lines by variant, per channel, never leaking another product’s variants', async () => {
    const dataSource = harness.getDataSource();
    const connA = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Variant sales connection A',
      adapterKey: 'allegro.test.unused-variant-a',
    });
    const connB = await createTestConnection(dataSource, {
      platformType: 'woocommerce',
      name: 'Variant sales connection B',
      adapterKey: 'woocommerce.test.unused-variant-b',
    });

    await createTestOrderRecord(dataSource, {
      internalOrderId: 'ol_order_variant_1',
      sourceConnectionId: connA.id,
      orderSnapshot: { items: [] },
      recordStatus: 'ready',
      cancelledAt: null,
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
      totalAmount: 100,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 100,
    });
    // Variant S on connection A.
    await seedLineItem(dataSource, {
      orderRecordId: 'ol_order_variant_1',
      productId: 'ol_product_jacket',
      variantId: 'ol_variant_s',
      sourceConnectionId: connA.id,
      quantity: 2,
      unitPrice: 30,
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
    });
    // Variant M on the SAME order/connection — a distinct lineNumber, since
    // (orderRecordId, lineNumber) is the line's own identity key.
    await seedLineItem(dataSource, {
      orderRecordId: 'ol_order_variant_1',
      lineNumber: 1,
      productId: 'ol_product_jacket',
      variantId: 'ol_variant_m',
      sourceConnectionId: connA.id,
      quantity: 1,
      unitPrice: 40,
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
    });

    await createTestOrderRecord(dataSource, {
      internalOrderId: 'ol_order_variant_2',
      sourceConnectionId: connB.id,
      orderSnapshot: { items: [] },
      recordStatus: 'ready',
      cancelledAt: null,
      placedAt: new Date('2026-08-03T00:00:00.000Z'),
      totalAmount: 30,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 30,
    });
    // Variant S again, on a DIFFERENT channel.
    await seedLineItem(dataSource, {
      orderRecordId: 'ol_order_variant_2',
      productId: 'ol_product_jacket',
      variantId: 'ol_variant_s',
      sourceConnectionId: connB.id,
      quantity: 1,
      unitPrice: 30,
      placedAt: new Date('2026-08-03T00:00:00.000Z'),
    });

    // A DIFFERENT product's variant — must never appear in this product's result.
    await createTestOrderRecord(dataSource, {
      internalOrderId: 'ol_order_other_product',
      sourceConnectionId: connA.id,
      orderSnapshot: { items: [] },
      recordStatus: 'ready',
      cancelledAt: null,
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
      totalAmount: 999,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 999,
    });
    await seedLineItem(dataSource, {
      orderRecordId: 'ol_order_other_product',
      productId: 'ol_product_other',
      variantId: 'ol_variant_other',
      sourceConnectionId: connA.id,
      quantity: 1,
      unitPrice: 999,
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
    });

    const result = await orderRecordService.getTopProductVariantSales(
      'ol_product_jacket',
      filters
    );

    expect(result.productId).toBe('ol_product_jacket');
    expect(result.variants.map((v) => v.variantId).sort()).toEqual(['ol_variant_m', 'ol_variant_s']);

    const variantS = result.variants.find((v) => v.variantId === 'ol_variant_s')!;
    expect(variantS.units).toBe(3); // 2 (connA) + 1 (connB)
    expect(variantS.revenue).toBeCloseTo(90, 2); // 60 + 30
    expect(variantS.channels).toHaveLength(2);
    const sChannelA = variantS.channels.find((c) => c.sourceConnectionId === connA.id)!;
    const sChannelB = variantS.channels.find((c) => c.sourceConnectionId === connB.id)!;
    expect(sChannelA.units).toBe(2);
    expect(sChannelA.revenue).toBeCloseTo(60, 2);
    expect(sChannelB.units).toBe(1);
    expect(sChannelB.revenue).toBeCloseTo(30, 2);

    const variantM = result.variants.find((v) => v.variantId === 'ol_variant_m')!;
    expect(variantM.units).toBe(1);
    expect(variantM.revenue).toBeCloseTo(40, 2);
    expect(variantM.channels).toHaveLength(1);
  });

  it('reports a null-variantId line as its own row, never dropped or merged into a real variant', async () => {
    const dataSource = harness.getDataSource();
    const conn = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Variant sales null-bucket connection',
      adapterKey: 'allegro.test.unused-variant-null',
    });

    await createTestOrderRecord(dataSource, {
      internalOrderId: 'ol_order_variant_null',
      sourceConnectionId: conn.id,
      orderSnapshot: { items: [] },
      recordStatus: 'ready',
      cancelledAt: null,
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
      totalAmount: 20,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 20,
    });
    // No variantId — the documented historical edge case.
    await seedLineItem(dataSource, {
      orderRecordId: 'ol_order_variant_null',
      productId: 'ol_product_simple',
      variantId: null,
      sourceConnectionId: conn.id,
      quantity: 1,
      unitPrice: 20,
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
    });

    const result = await orderRecordService.getTopProductVariantSales('ol_product_simple', filters);

    expect(result.variants).toHaveLength(1);
    expect(result.variants[0].variantId).toBeNull();
    expect(result.variants[0].units).toBe(1);
    expect(result.variants[0].revenue).toBeCloseTo(20, 2);
  });

  it('ranks variants by revenue descending, deterministically, whatever order the lines were written in', async () => {
    // #2765 review, finding 2: the query had no ORDER BY at all, so
    // `HashAggregate` output order decided the panel's row order — which
    // Postgres does not promise to keep stable between two identical
    // requests. The `variantId ASC NULLS LAST` tiebreak (not exercised
    // here, since every revenue differs) additionally pins the "Unassigned"
    // bucket behind a real variant of EQUAL revenue rather than leaving
    // that pair's order to the plan.
    const dataSource = harness.getDataSource();
    const conn = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Variant sales ordering connection',
      adapterKey: 'allegro.test.unused-variant-ordering',
    });

    await createTestOrderRecord(dataSource, {
      internalOrderId: 'ol_order_variant_ordering',
      sourceConnectionId: conn.id,
      orderSnapshot: { items: [] },
      recordStatus: 'ready',
      cancelledAt: null,
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
      totalAmount: 100,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 100,
    });

    // Seeded smallest-revenue-first, and with the null bucket in the middle,
    // so insertion order cannot be mistaken for the assertion passing.
    await seedLineItem(dataSource, {
      orderRecordId: 'ol_order_variant_ordering',
      productId: 'ol_product_ordering',
      variantId: 'ol_variant_low',
      sourceConnectionId: conn.id,
      quantity: 1,
      unitPrice: 10,
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
    });
    await seedLineItem(dataSource, {
      orderRecordId: 'ol_order_variant_ordering',
      lineNumber: 1,
      productId: 'ol_product_ordering',
      variantId: null,
      sourceConnectionId: conn.id,
      quantity: 1,
      unitPrice: 20,
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
    });
    await seedLineItem(dataSource, {
      orderRecordId: 'ol_order_variant_ordering',
      lineNumber: 2,
      productId: 'ol_product_ordering',
      variantId: 'ol_variant_high',
      sourceConnectionId: conn.id,
      quantity: 1,
      unitPrice: 70,
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
    });

    const result = await orderRecordService.getTopProductVariantSales(
      'ol_product_ordering',
      filters
    );

    expect(result.variants.map((variant) => variant.variantId)).toEqual([
      'ol_variant_high',
      null,
      'ol_variant_low',
    ]);
  });

  it('discloses an unstamped order’s native amount as unconvertedRevenue, never silently summed into revenue', async () => {
    const dataSource = harness.getDataSource();
    const conn = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Variant sales unstamped connection',
      adapterKey: 'allegro.test.unused-variant-unstamped',
    });

    await createTestOrderRecord(dataSource, {
      internalOrderId: 'ol_order_variant_unstamped',
      sourceConnectionId: conn.id,
      orderSnapshot: { items: [] },
      recordStatus: 'ready',
      cancelledAt: null,
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
      totalAmount: 60,
      reportingCurrency: null,
      reportingTotalAmount: null,
    });
    await seedLineItem(dataSource, {
      orderRecordId: 'ol_order_variant_unstamped',
      productId: 'ol_product_unstamped',
      variantId: 'ol_variant_unstamped',
      sourceConnectionId: conn.id,
      quantity: 2,
      unitPrice: 30,
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
    });

    const result = await orderRecordService.getTopProductVariantSales(
      'ol_product_unstamped',
      filters
    );

    expect(result.variants).toHaveLength(1);
    const variant = result.variants[0];
    expect(variant.revenue).toBe(0);
    expect(variant.unconvertedRevenue).toBeCloseTo(60, 2);
    expect(variant.unconvertedOrderCount).toBe(1);
    expect(variant.currency).toBeNull();
  });
});
