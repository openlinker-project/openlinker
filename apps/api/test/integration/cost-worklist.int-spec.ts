/**
 * Cost Coverage + Work List Integration Test (#3588, mockup M30)
 *
 * Real Testcontainers Postgres, hand-computed figures. "Now" is pinned to
 * 2026-10-29 so the 30-day window is [2026-09-30, 2026-10-30). Every order is in
 * the reporting currency (fx 1) and gross-priced at 23% VAT: unitPrice 123 is
 * net 100.
 *
 *  catalogue: P1 {V1 SKU-A none, V2 SKU-B none, V3 SKU-C has cost}, P2 {V4 SKU-D none, never sold},
 *             P3 "Zzz mug" {V5 SKU-E none, sold 58 days ago only}
 *  window orders:
 *    o1 C1 10-20: V1 x3 (net 300, not-recorded)  + V3 x1 (net 100, recorded cost -> covered)
 *    o2 C2 10-22: V1 x1 (net 100)                + V2 x1 (net 100)
 *    o3 C1 10-25: V3 x1 (net 100, not-recorded: the cost was entered after the sale)
 *    o4 C1 10-26: a line with no variant (net 100)
 *    o5 C1 09-01: V5 x1 (net 100) - outside 30 days, inside 90
 *    cancelled order of V2 (net 1000) - never counts
 *
 * 30 days: netSales 800, sold variants 3 (V1 V2 V3), without cost 2 (V1 V2),
 * netSalesWithoutCost 500, coveragePct 37.5, productOnly 100, gaps
 * no-cost 500 (3 lines) + cost-entered-after-sale 100 + no-variant 100 =
 * notInMargin 700, covered 100 = 800 - 700.
 *
 * @module apps/api/test/integration
 */
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import {
  COST_COVERAGE_SERVICE_TOKEN,
  type ICostCoverageService,
} from '@openlinker/core/orders';
import { OrderLineItemOrmEntity, OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import {
  REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
  type IReportingCurrencySettingsService,
} from '@openlinker/core/currency';

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-29T12:00:00.000Z');

describe('Cost coverage and work list (integration, #3588)', () => {
  let harness: IntegrationTestHarness;
  let coverage: ICostCoverageService;
  let currency: string;
  let seq = 0;

  beforeAll(async () => {
    harness = await getTestHarness();
    coverage = harness.getApp().get<ICostCoverageService>(COST_COVERAGE_SERVICE_TOKEN);
    currency = await harness
      .getApp()
      .get<IReportingCurrencySettingsService>(REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN)
      .resolve();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function seedProduct(
    id: string,
    name: string,
    variants: Array<{ id: string; sku: string; cost?: boolean; stale?: boolean }>
  ): Promise<void> {
    const ds = harness.getDataSource();
    const products = ds.getRepository(ProductOrmEntity);
    await products.save(products.create({ id, name, sku: null, price: null }));
    const repo = ds.getRepository(ProductVariantOrmEntity);
    for (const v of variants) {
      await repo.save(
        repo.create({
          id: v.id,
          productId: id,
          sku: v.sku,
          attributes: { colour: 'black' },
          ean: null,
          gtin: null,
          isStale: v.stale ?? false,
          netUnitCost: v.cost ? '40.0000' : null,
          costCurrency: v.cost ? currency : null,
          costUpdatedAt: v.cost ? new Date('2026-10-27T00:00:00.000Z') : null,
        })
      );
    }
  }

  async function seedOrder(
    connection: string,
    placedAt: string,
    lines: Array<Partial<OrderLineItemOrmEntity>>,
    overrides: Partial<OrderRecordOrmEntity> = {}
  ): Promise<void> {
    seq += 1;
    const orders = harness.getDataSource().getRepository(OrderRecordOrmEntity);
    const total = lines.reduce((s, l) => s + (l.quantity ?? 1) * Number(l.unitPrice ?? 123), 0);
    const order = await orders.save(
      orders.create({
        internalOrderId: `ol_order_cw_${seq}`,
        customerId: null,
        sourceConnectionId: connection,
        sourceEventId: null,
        orderSnapshot: { items: [] },
        syncStatus: [],
        recordStatus: 'ready',
        cancelledAt: null,
        currency,
        taxTreatment: 'inclusive',
        placedAt: new Date(placedAt),
        totalAmount: total,
        reportingCurrency: currency,
        reportingTotalAmount: total,
        ...overrides,
      })
    );
    const repo = harness.getDataSource().getRepository(OrderLineItemOrmEntity);
    let lineNumber = 0;
    for (const line of lines) {
      await repo.save(
        repo.create({
          orderRecordId: order.internalOrderId,
          lineNumber: lineNumber++,
          quantity: 1,
          unitPrice: 123,
          taxRate: '23',
          sourceConnectionId: connection,
          placedAt: new Date(placedAt),
          costState: 'not-recorded',
          unitCostNet: null,
          unitCostCurrency: null,
          ...line,
        } as OrderLineItemOrmEntity)
      );
    }
  }

  async function seedFixture(): Promise<void> {
    await seedProduct('ol_product_1', 'Espresso cup', [
      { id: 'ol_variant_1', sku: 'SKU-A' },
      { id: 'ol_variant_2', sku: 'SKU-B' },
      { id: 'ol_variant_3', sku: 'SKU-C', cost: true },
    ]);
    await seedProduct('ol_product_2', 'Saucer', [{ id: 'ol_variant_4', sku: 'SKU-D' }]);
    await seedProduct('ol_product_3', 'Zzz mug', [
      { id: 'ol_variant_5', sku: 'SKU-E' },
      { id: 'ol_variant_6', sku: 'SKU-F', stale: true },
    ]);

    await seedOrder(C1, '2026-10-20T10:00:00.000Z', [
      { productId: 'ol_product_1', variantId: 'ol_variant_1', quantity: 3 },
      {
        productId: 'ol_product_1',
        variantId: 'ol_variant_3',
        costState: 'recorded',
        unitCostNet: '40.0000',
        unitCostCurrency: currency,
      },
    ]);
    await seedOrder(C2, '2026-10-22T10:00:00.000Z', [
      { productId: 'ol_product_1', variantId: 'ol_variant_1' },
      { productId: 'ol_product_1', variantId: 'ol_variant_2' },
    ]);
    await seedOrder(C1, '2026-10-25T10:00:00.000Z', [
      { productId: 'ol_product_1', variantId: 'ol_variant_3' },
    ]);
    await seedOrder(C1, '2026-10-26T10:00:00.000Z', [
      { productId: 'ol_product_1', variantId: null },
    ]);
    await seedOrder(C1, '2026-09-01T10:00:00.000Z', [
      { productId: 'ol_product_3', variantId: 'ol_variant_5' },
    ]);
    await seedOrder(
      C1,
      '2026-10-21T10:00:00.000Z',
      [{ productId: 'ol_product_1', variantId: 'ol_variant_2', quantity: 10 }],
      { cancelledAt: new Date('2026-10-22T00:00:00.000Z') }
    );
  }

  describe('coverage', () => {
    it('should report the 30-day figures, the gap split and the top variants', async () => {
      await seedFixture();

      const result = await coverage.getCostCoverage(30, false, NOW);

      expect(result.from.toISOString()).toBe('2026-09-30T00:00:00.000Z');
      expect(result.to.toISOString()).toBe('2026-10-30T00:00:00.000Z');
      expect(result.currency).toBe(currency);
      expect(result.soldVariantCount).toBe(3);
      expect(result.soldVariantsWithoutCost).toBe(2);
      expect(result.netSales).toBeCloseTo(800, 2);
      expect(result.netSalesWithoutCost).toBeCloseTo(500, 2);
      expect(result.coveragePct).toBe(37.5);
      expect(result.productOnlyNetSales).toBeCloseTo(100, 2);
      expect(result.notInMarginNetSales).toBeCloseTo(700, 2);

      const gap = Object.fromEntries(result.gapByReason.map((g) => [g.reason, g]));
      expect(gap['no-cost'].lineCount).toBe(3);
      expect(gap['no-cost'].netAmount).toBeCloseTo(500, 2);
      expect(gap['cost-entered-after-sale'].lineCount).toBe(1);
      expect(gap['cost-entered-after-sale'].netAmount).toBeCloseTo(100, 2);
      expect(gap['no-variant'].netAmount).toBeCloseTo(100, 2);
      expect(gap['currency-mismatch'].lineCount).toBe(0);

      expect(result.top3.map((v) => v.variantId)).toEqual(['ol_variant_1', 'ol_variant_2']);
      expect(result.top3[0].netSales).toBeCloseTo(400, 2);
      expect(result.top3SharePct).toBe(100);
    });

    it('should widen the window with days and keep a variant with a cost out of the without-cost figures', async () => {
      await seedFixture();

      const result = await coverage.getCostCoverage(90, false, NOW);

      expect(result.soldVariantCount).toBe(4);
      expect(result.soldVariantsWithoutCost).toBe(3);
      expect(result.netSalesWithoutCost).toBeCloseTo(600, 2);
      expect(result.top3.map((v) => v.variantId)).not.toContain('ol_variant_3');
    });
  });

  describe('work list', () => {
    const page = { limit: 20, offset: 0 };

    it('should list sold-without-cost variants by net sales, excluding a variant that has a cost', async () => {
      await seedFixture();

      const result = await coverage.getWorklist({ ...page, tab: 'sold' }, { now: NOW });

      expect(result.currency).toBe(currency);
      expect(result.total).toBe(2);
      expect(result.items.map((r) => r.variantId)).toEqual(['ol_variant_1', 'ol_variant_2']);
      expect(result.items[0]).toMatchObject({
        productName: 'Espresso cup',
        sku: 'SKU-A',
        netUnitCost: null,
        units30d: 4,
      });
      expect(result.items[0].netSales30d).toBeCloseTo(400, 2);
      expect([...result.items[0].soldOnConnectionIds].sort()).toEqual([C1, C2]);
    });

    it('should list every non-stale variant without a cost on the all tab, sales first then sku', async () => {
      await seedFixture();

      const result = await coverage.getWorklist({ ...page, tab: 'all' }, { now: NOW });

      expect(result.items.map((r) => r.variantId)).toEqual([
        'ol_variant_1',
        'ol_variant_2',
        'ol_variant_4',
        'ol_variant_5',
      ]);
      expect(result.total).toBe(4);
    });

    it('should list variants that have a cost on the has-cost tab', async () => {
      await seedFixture();

      const result = await coverage.getWorklist({ ...page, tab: 'has-cost' }, { now: NOW });

      expect(result.items.map((r) => r.variantId)).toEqual(['ol_variant_3']);
      expect(result.items[0].netUnitCost).toBe('40.0000');
      expect(result.items[0].costCurrency).toBe(currency);
    });

    it('should search product name and sku, treating wildcards literally', async () => {
      await seedFixture();

      const bySku = await coverage.getWorklist({ ...page, tab: 'all', q: 'sku-b' }, { now: NOW });
      const byName = await coverage.getWorklist({ ...page, tab: 'all', q: 'zzz' }, { now: NOW });
      const wildcard = await coverage.getWorklist({ ...page, tab: 'all', q: '%' }, { now: NOW });
      const injection = await coverage.getWorklist(
        { ...page, tab: 'all', q: "'; DROP TABLE products; --" },
        { now: NOW }
      );

      expect(bySku.items.map((r) => r.variantId)).toEqual(['ol_variant_2']);
      expect(byName.items.map((r) => r.variantId)).toEqual(['ol_variant_5']);
      expect(wildcard.items).toHaveLength(0);
      expect(injection.items).toHaveLength(0);
      await expect(coverage.getSummary()).resolves.toBeDefined();
    });

    it('should narrow the sales columns to a channel and require a sale there', async () => {
      await seedFixture();

      const c1 = await coverage.getWorklist({ ...page, tab: 'sold', channel: C1 }, { now: NOW });
      const c2 = await coverage.getWorklist({ ...page, tab: 'sold', channel: C2 }, { now: NOW });
      const c2all = await coverage.getWorklist({ ...page, tab: 'all', channel: C2 }, { now: NOW });

      expect(c1.items.map((r) => r.variantId)).toEqual(['ol_variant_1']);
      expect(c1.items[0].netSales30d).toBeCloseTo(300, 2);
      expect(c2.items.map((r) => r.variantId)).toEqual(['ol_variant_1', 'ol_variant_2']);
      expect(c2.items[0].netSales30d).toBeCloseTo(100, 2);
      expect(c2all.items.map((r) => r.variantId)).toEqual(['ol_variant_1', 'ol_variant_2']);
    });

    it('should page and report the total, or omit it with withTotal=false', async () => {
      await seedFixture();

      const second = await coverage.getWorklist(
        { tab: 'all', limit: 1, offset: 1 },
        { now: NOW }
      );
      const noTotal = await coverage.getWorklist(
        { tab: 'all', limit: 1, offset: 0 },
        { now: NOW, withTotal: false }
      );

      expect(second.items.map((r) => r.variantId)).toEqual(['ol_variant_2']);
      expect(second.total).toBe(4);
      expect(noTotal.items).toHaveLength(1);
      expect('total' in noTotal).toBe(false);
      await expect(coverage.countWorklist({ tab: 'all' }, false, NOW)).resolves.toBe(4);
      await expect(coverage.countWorklist({ tab: 'sold', channel: C1 }, false, NOW)).resolves.toBe(1);
    });
  });

  describe('summary', () => {
    it('should count variants and products without a cost, ignoring stale variants', async () => {
      await seedFixture();

      await expect(coverage.getSummary()).resolves.toEqual({
        variantsWithoutCost: 4,
        productsWithoutCost: 3,
        variantsWithCost: 1,
      });
    });
  });
});
