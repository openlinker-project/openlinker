/**
 * Margin Analytics Integration Test (#3588, D27)
 *
 * Runs the margin reads against real Testcontainers Postgres with hand-computed
 * figures. Reporting currency is EUR throughout (the repository methods take it
 * explicitly, so the test does not depend on the settings resolution).
 *
 * Fixture (all placed 2026-09-02..05, range [09-01, 09-08)):
 *  - A  EUR order, gross-priced @23% VAT, fx 1:   line 123.00 -> net 100.00, cost 60 EUR   -> covered, cogs 60
 *  - B  PLN order stamped EUR, fx 0.25, net-priced:
 *         line qty 2 x 100 PLN -> net 200 PLN = 50 EUR, cost 30 PLN   -> covered, cogs 30*2*0.25 = 15
 *         line qty 1 x 200 PLN -> net 200 PLN = 50 EUR, cost in EUR   -> gap currency-mismatch 50
 *  - C  EUR order, gross @23%: variant without cost (net 100)         -> gap no-cost 100
 *                              variant that has a cost NOW (net 100)  -> gap cost-entered-after-sale 100
 *  - D  EUR order, gross @23%: line without a variant (net 100)       -> gap no-variant 100
 *  - excluded: a cancelled order, an unstamped order, an other-era (PLN-stamped) order
 *
 * netRevenue 500, covered 150, cogs 75, grossMargin 75, marginPct 0.5,
 * costCoveragePct 0.3; gaps sum to 350 = 500 - 150.
 *
 * @module apps/api/test/integration
 */
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import {
  MARGIN_ANALYTICS_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  type IMarginAnalyticsService,
  type IOrderRecordService,
} from '@openlinker/core/orders';
import { OrderLineItemOrmEntity, OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';

const CONNECTION = '11111111-1111-4111-8111-111111111111';
const FILTERS = {
  from: new Date('2026-09-01T00:00:00.000Z'),
  to: new Date('2026-09-08T00:00:00.000Z'),
};

describe('Margin analytics (integration, #3588)', () => {
  let harness: IntegrationTestHarness;
  let orderRecords: IOrderRecordService;
  let margin: IMarginAnalyticsService;
  let seq = 0;

  beforeAll(async () => {
    harness = await getTestHarness();
    orderRecords = harness.getApp().get<IOrderRecordService>(ORDER_RECORD_SERVICE_TOKEN);
    margin = harness.getApp().get<IMarginAnalyticsService>(MARGIN_ANALYTICS_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function seedProductWithVariants(
    productId: string,
    variants: Array<{ id: string; cost?: { amount: string; currency: string } }>
  ): Promise<void> {
    const ds = harness.getDataSource();
    const productRepo = ds.getRepository(ProductOrmEntity);
    await productRepo.save(
      productRepo.create({ id: productId, name: `Product ${productId}`, sku: null, price: null })
    );
    const variantRepo = ds.getRepository(ProductVariantOrmEntity);
    for (const variant of variants) {
      await variantRepo.save(
        variantRepo.create({
          id: variant.id,
          productId,
          sku: null,
          attributes: null,
          ean: null,
          gtin: null,
          netUnitCost: variant.cost?.amount ?? null,
          costCurrency: variant.cost?.currency ?? null,
          costUpdatedAt: variant.cost ? new Date('2026-10-01T00:00:00.000Z') : null,
        })
      );
    }
  }

  async function seedOrder(overrides: Partial<OrderRecordOrmEntity>): Promise<string> {
    seq += 1;
    const repo = harness.getDataSource().getRepository(OrderRecordOrmEntity);
    const saved = await repo.save(
      repo.create({
        internalOrderId: `ol_order_margin_${seq}`,
        customerId: null,
        sourceConnectionId: CONNECTION,
        sourceEventId: null,
        orderSnapshot: { items: [] },
        syncStatus: [],
        recordStatus: 'ready',
        cancelledAt: null,
        currency: 'EUR',
        taxTreatment: 'inclusive',
        placedAt: new Date('2026-09-02T10:00:00.000Z'),
        reportingCurrency: 'EUR',
        ...overrides,
      })
    );
    return saved.internalOrderId;
  }

  async function seedLine(overrides: Partial<OrderLineItemOrmEntity>): Promise<void> {
    seq += 1;
    const repo = harness.getDataSource().getRepository(OrderLineItemOrmEntity);
    await repo.save(
      repo.create({
        lineNumber: 0,
        quantity: 1,
        sourceConnectionId: CONNECTION,
        placedAt: new Date('2026-09-02T10:00:00.000Z'),
        costState: 'not-recorded',
        unitCostNet: null,
        unitCostCurrency: null,
        ...overrides,
      } as OrderLineItemOrmEntity)
    );
  }

  async function seedFixture(): Promise<void> {
    await seedProductWithVariants('ol_product_m1', [
      { id: 'ol_variant_m1', cost: { amount: '60', currency: 'EUR' } },
    ]);
    await seedProductWithVariants('ol_product_m2', [
      { id: 'ol_variant_m2' },
      { id: 'ol_variant_m3' },
      { id: 'ol_variant_m4', cost: { amount: '10', currency: 'EUR' } },
    ]);

    const a = await seedOrder({ totalAmount: 123, reportingTotalAmount: 123 });
    await seedLine({
      orderRecordId: a,
      productId: 'ol_product_m1',
      variantId: 'ol_variant_m1',
      unitPrice: 123,
      taxRate: '23',
      costState: 'recorded',
      unitCostNet: '60.0000',
      unitCostCurrency: 'EUR',
    });

    const b = await seedOrder({
      currency: 'PLN',
      taxTreatment: 'exclusive',
      totalAmount: 400,
      reportingTotalAmount: 100,
      placedAt: new Date('2026-09-03T10:00:00.000Z'),
    });
    await seedLine({
      orderRecordId: b,
      lineNumber: 0,
      productId: 'ol_product_m1',
      variantId: 'ol_variant_m1',
      quantity: 2,
      unitPrice: 100,
      placedAt: new Date('2026-09-03T10:00:00.000Z'),
      costState: 'recorded',
      unitCostNet: '30.0000',
      unitCostCurrency: 'PLN',
    });
    await seedLine({
      orderRecordId: b,
      lineNumber: 1,
      productId: 'ol_product_m2',
      variantId: 'ol_variant_m2',
      unitPrice: 200,
      placedAt: new Date('2026-09-03T10:00:00.000Z'),
      costState: 'recorded',
      unitCostNet: '5.0000',
      unitCostCurrency: 'EUR',
    });

    const c = await seedOrder({
      totalAmount: 246,
      reportingTotalAmount: 246,
      placedAt: new Date('2026-09-04T10:00:00.000Z'),
    });
    await seedLine({
      orderRecordId: c,
      lineNumber: 0,
      productId: 'ol_product_m2',
      variantId: 'ol_variant_m3',
      unitPrice: 123,
      taxRate: '23',
      placedAt: new Date('2026-09-04T10:00:00.000Z'),
    });
    await seedLine({
      orderRecordId: c,
      lineNumber: 1,
      productId: 'ol_product_m2',
      variantId: 'ol_variant_m4',
      unitPrice: 123,
      taxRate: '23',
      placedAt: new Date('2026-09-04T10:00:00.000Z'),
    });

    const d = await seedOrder({
      totalAmount: 123,
      reportingTotalAmount: 123,
      placedAt: new Date('2026-09-05T10:00:00.000Z'),
    });
    await seedLine({
      orderRecordId: d,
      productId: 'ol_product_m3',
      variantId: null,
      unitPrice: 123,
      taxRate: '23',
      placedAt: new Date('2026-09-05T10:00:00.000Z'),
    });

    // Excluded populations - each carries a recorded cost that must NOT count.
    const cancelled = await seedOrder({
      totalAmount: 123,
      reportingTotalAmount: 123,
      cancelledAt: new Date('2026-09-03T00:00:00.000Z'),
    });
    await seedLine({
      orderRecordId: cancelled,
      productId: 'ol_product_m1',
      variantId: 'ol_variant_m1',
      unitPrice: 123,
      taxRate: '23',
      costState: 'recorded',
      unitCostNet: '60.0000',
      unitCostCurrency: 'EUR',
    });
    const unstamped = await seedOrder({
      totalAmount: 123,
      reportingTotalAmount: null,
      reportingCurrency: null,
    });
    await seedLine({
      orderRecordId: unstamped,
      productId: 'ol_product_m1',
      variantId: 'ol_variant_m1',
      unitPrice: 123,
      taxRate: '23',
      costState: 'recorded',
      unitCostNet: '60.0000',
      unitCostCurrency: 'EUR',
    });
    const otherEra = await seedOrder({
      totalAmount: 123,
      reportingTotalAmount: 530,
      reportingCurrency: 'PLN',
    });
    await seedLine({
      orderRecordId: otherEra,
      productId: 'ol_product_m1',
      variantId: 'ol_variant_m1',
      unitPrice: 123,
      taxRate: '23',
      costState: 'recorded',
      unitCostNet: '60.0000',
      unitCostCurrency: 'EUR',
    });
  }

  it('computes margin on net revenue with FX applied to revenue and cost, and attributes every gap', async () => {
    await seedFixture();

    const result = await margin.getMargin(FILTERS, 'day');
    const headline = result.headline;

    expect(result.currency).toBe('EUR');
    expect(headline.netRevenue).toBeCloseTo(500, 4);
    expect(headline.coveredNetRevenue).toBeCloseTo(150, 4);
    expect(headline.costOfGoods).toBeCloseTo(75, 4);
    expect(headline.grossMargin).toBeCloseTo(75, 4);
    expect(headline.marginPct).toBeCloseTo(0.5, 4);
    expect(headline.costCoveragePct).toBeCloseTo(0.3, 4);

    const gap = (reason: string) => headline.gaps.find((g) => g.reason === reason);
    expect(gap('no-cost')).toMatchObject({ lineCount: 1 });
    expect(gap('no-cost')?.netAmount).toBeCloseTo(100, 4);
    expect(gap('cost-entered-after-sale')).toMatchObject({ lineCount: 1 });
    expect(gap('cost-entered-after-sale')?.netAmount).toBeCloseTo(100, 4);
    expect(gap('no-variant')).toMatchObject({ lineCount: 1 });
    expect(gap('no-variant')?.netAmount).toBeCloseTo(100, 4);
    expect(gap('currency-mismatch')).toMatchObject({ lineCount: 1 });
    expect(gap('currency-mismatch')?.netAmount).toBeCloseTo(50, 4);

    const gapTotal = headline.gaps.reduce((sum, g) => sum + g.netAmount, 0);
    expect(headline.coveredNetRevenue + gapTotal).toBeCloseTo(headline.netRevenue, 4);

    // The unstamped and other-era orders are outside net revenue (counted as excluded); the cancelled one is not in scope at all.
    expect(result.excludedLineCount).toBe(2);
  });

  it('reports the same net revenue as the top-products NET figure for the same range', async () => {
    await seedFixture();

    const marginResult = await margin.getMargin(FILTERS, 'week');
    const top = await orderRecords.getTopProducts({
      ...FILTERS,
      sortBy: 'revenue',
      limit: 100,
      offset: 0,
    });
    const topProductsNet = top.items.reduce((sum, item) => sum + item.netRevenue, 0);

    expect(marginResult.headline.netRevenue).toBeCloseTo(topProductsNet, 4);
  });

  it('splits margin by product and by variant', async () => {
    await seedFixture();

    const products = await margin.getMarginProducts({
      ...FILTERS,
      sortBy: 'grossMargin',
      limit: 10,
      offset: 0,
    });
    expect(products.total).toBe(3);
    expect(products.items[0].productId).toBe('ol_product_m1');
    expect(products.items[0].grossMargin).toBeCloseTo(75, 4);
    // Nothing covered -> null margin %, sorted last.
    expect(products.items[products.items.length - 1].marginPct).toBeNull();

    const variants = await margin.getMarginProductVariants('ol_product_m2', FILTERS);
    const byVariant = new Map(variants.variants.map((v) => [v.variantId, v]));
    expect(
      byVariant.get('ol_variant_m2')?.gaps.find((g) => g.reason === 'currency-mismatch')?.lineCount
    ).toBe(1);
    expect(
      byVariant.get('ol_variant_m3')?.gaps.find((g) => g.reason === 'no-cost')?.lineCount
    ).toBe(1);
    expect(
      byVariant.get('ol_variant_m4')?.gaps.find((g) => g.reason === 'cost-entered-after-sale')
        ?.lineCount
    ).toBe(1);
  });

  it('folds the trend into UTC days and ISO weeks', async () => {
    await seedFixture();

    const daily = await margin.getMargin(FILTERS, 'day');
    expect(daily.trend.find((p) => p.date === '2026-09-02')?.netRevenue).toBeCloseTo(100, 4);
    expect(daily.trend.find((p) => p.date === '2026-09-03')?.netRevenue).toBeCloseTo(100, 4);

    // 2026-09-01 is a Tuesday; its ISO Monday is 2026-08-31, and 09-07 starts the next week.
    const weekly = await margin.getMargin(FILTERS, 'week');
    expect(weekly.trend.map((p) => p.date)).toEqual(['2026-08-31', '2026-09-07']);
    expect(weekly.trend[0].netRevenue).toBeCloseTo(500, 4);
  });

  it('counts uncovered lines (the no-cost coverage count) equal to the sum of the gap line counts', async () => {
    await seedFixture();

    const result = await margin.getMargin(FILTERS, 'day');
    const gapLines = result.headline.gaps.reduce((sum, g) => sum + g.lineCount, 0);

    expect(await margin.countUncoveredLines(FILTERS)).toBe(gapLines);
    expect(gapLines).toBe(4);
  });
});
