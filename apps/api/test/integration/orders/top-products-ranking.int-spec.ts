/**
 * Top Products Ranking Int-Spec (#1988)
 *
 * Exercises `IOrderRecordService.getTopProducts` against the real Postgres
 * harness — the layer the mocked repository/service unit specs cannot prove.
 * In particular this proves two things no mocked spec can:
 *
 * 1. The FILTER/GROUP BY/aggregate SQL in `getTopProductRanking` and
 *    `getProductChannelBreakdown` actually executes and produces correct
 *    numbers against real Postgres — including the FX-multiplier arithmetic
 *    (`reportingTotalAmount / totalAmount`) applied per line.
 * 2. Currency correctness end-to-end: a stamped order's revenue is
 *    comparable across products; an unstamped order's native-currency amount
 *    is disclosed separately and never silently summed into `revenue`; a
 *    cancelled order is excluded entirely.
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

describe('Top products ranking — currency correctness against real Postgres (#1988)', () => {
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
    sortBy: 'revenue' as const,
    limit: 20,
    offset: 0,
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

  it(
    'ranks by revenue using only FX-stamped orders, discloses unstamped orders separately, ' +
      'excludes cancelled orders, and carries an inline per-channel breakdown',
    async () => {
      const dataSource = harness.getDataSource();
      const connA = await createTestConnection(dataSource, {
        platformType: 'allegro',
        name: 'Connection A',
        adapterKey: 'allegro.test.unused-a',
      });
      const connB = await createTestConnection(dataSource, {
        platformType: 'woocommerce',
        name: 'Connection B',
        adapterKey: 'woocommerce.test.unused-b',
      });

      // Order 1 (connection A, stamped EUR @ rate 1.1): 2 x 50.00 native = 100.00,
      // reportingTotalAmount = 110.00 -> implicit rate 1.1 applied per line.
      await createTestOrderRecord(dataSource, {
        internalOrderId: 'ol_order_tp_1',
        sourceConnectionId: connA.id,
        orderSnapshot: { items: [] },
        recordStatus: 'ready',
        cancelledAt: null,
        placedAt: new Date('2026-08-02T00:00:00.000Z'),
        totalAmount: 100,
        reportingCurrency: 'EUR',
        reportingTotalAmount: 110,
      });
      await seedLineItem(dataSource, {
        orderRecordId: 'ol_order_tp_1',
        productId: 'ol_product_p1',
        sourceConnectionId: connA.id,
        quantity: 2,
        unitPrice: 50,
        placedAt: new Date('2026-08-02T00:00:00.000Z'),
      });

      // Order 2 (connection B, UNSTAMPED): 2 x 25.00 native = 50.00. Must
      // surface as unconvertedRevenue/unconvertedOrderCount for p1, never as
      // part of p1.revenue.
      await createTestOrderRecord(dataSource, {
        internalOrderId: 'ol_order_tp_2',
        sourceConnectionId: connB.id,
        orderSnapshot: { items: [] },
        recordStatus: 'ready',
        cancelledAt: null,
        placedAt: new Date('2026-08-03T00:00:00.000Z'),
        totalAmount: 50,
        reportingCurrency: null,
        reportingTotalAmount: null,
      });
      await seedLineItem(dataSource, {
        orderRecordId: 'ol_order_tp_2',
        productId: 'ol_product_p1',
        sourceConnectionId: connB.id,
        quantity: 2,
        unitPrice: 25,
        placedAt: new Date('2026-08-03T00:00:00.000Z'),
      });

      // Order 3 (connection A, stamped EUR @ rate 1.0): product p2, only sold
      // on connection A.
      await createTestOrderRecord(dataSource, {
        internalOrderId: 'ol_order_tp_3',
        sourceConnectionId: connA.id,
        orderSnapshot: { items: [] },
        recordStatus: 'ready',
        cancelledAt: null,
        placedAt: new Date('2026-08-04T00:00:00.000Z'),
        totalAmount: 30,
        reportingCurrency: 'EUR',
        reportingTotalAmount: 30,
      });
      await seedLineItem(dataSource, {
        orderRecordId: 'ol_order_tp_3',
        productId: 'ol_product_p2',
        sourceConnectionId: connA.id,
        quantity: 1,
        unitPrice: 30,
        placedAt: new Date('2026-08-04T00:00:00.000Z'),
      });

      // Order 4 (connection A, CANCELLED): a huge p1 line that must be
      // entirely excluded — proves the cancelledAt IS NULL scope, not just
      // the recordStatus scope.
      await createTestOrderRecord(dataSource, {
        internalOrderId: 'ol_order_tp_4_cancelled',
        sourceConnectionId: connA.id,
        orderSnapshot: { items: [] },
        recordStatus: 'ready',
        cancelledAt: new Date('2026-08-05T00:00:00.000Z'),
        placedAt: new Date('2026-08-05T00:00:00.000Z'),
        totalAmount: 10000,
        reportingCurrency: 'EUR',
        reportingTotalAmount: 10000,
      });
      await seedLineItem(dataSource, {
        orderRecordId: 'ol_order_tp_4_cancelled',
        productId: 'ol_product_p1',
        sourceConnectionId: connA.id,
        quantity: 999,
        unitPrice: 10000,
        placedAt: new Date('2026-08-05T00:00:00.000Z'),
      });

      const result = await orderRecordService.getTopProducts(filters);

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);

      // p1 ranks first: comparable revenue 110 > p2's 30.
      const p1 = result.items[0];
      expect(p1.productId).toBe('ol_product_p1');
      expect(p1.revenue).toBeCloseTo(110, 2);
      expect(p1.unconvertedRevenue).toBeCloseTo(50, 2);
      expect(p1.unconvertedOrderCount).toBe(1);
      expect(p1.currency).toBe('EUR');
      expect(p1.units).toBe(4); // 2 (connA, stamped) + 2 (connB, unstamped) — cancelled 999 excluded

      const p1ChannelA = p1.channels.find((c) => c.sourceConnectionId === connA.id);
      const p1ChannelB = p1.channels.find((c) => c.sourceConnectionId === connB.id);
      expect(p1ChannelA).toBeDefined();
      expect(p1ChannelA!.units).toBe(2);
      expect(p1ChannelA!.revenue).toBeCloseTo(110, 2);
      expect(p1ChannelA!.unconvertedRevenue).toBe(0);
      expect(p1ChannelB).toBeDefined();
      expect(p1ChannelB!.units).toBe(2);
      expect(p1ChannelB!.revenue).toBe(0);
      expect(p1ChannelB!.unconvertedRevenue).toBeCloseTo(50, 2);

      const p2 = result.items[1];
      expect(p2.productId).toBe('ol_product_p2');
      expect(p2.revenue).toBeCloseTo(30, 2);
      expect(p2.unconvertedRevenue).toBe(0);
      expect(p2.channels).toHaveLength(1);
      expect(p2.channels[0].sourceConnectionId).toBe(connA.id);
      expect(p2.channels[0].units).toBe(1);
      expect(p2.channels[0].revenue).toBeCloseTo(30, 2);
    }
  );

  it('ranks by units when sortBy is units, independent of currency stamping', async () => {
    const dataSource = harness.getDataSource();
    const conn = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Connection units test',
      adapterKey: 'allegro.test.unused-units',
    });

    await createTestOrderRecord(dataSource, {
      internalOrderId: 'ol_order_units_1',
      sourceConnectionId: conn.id,
      orderSnapshot: { items: [] },
      recordStatus: 'ready',
      cancelledAt: null,
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
      totalAmount: 1000,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 1000,
    });
    // High revenue, low units.
    await seedLineItem(dataSource, {
      orderRecordId: 'ol_order_units_1',
      productId: 'ol_product_high_revenue',
      sourceConnectionId: conn.id,
      quantity: 1,
      unitPrice: 1000,
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
    });

    await createTestOrderRecord(dataSource, {
      internalOrderId: 'ol_order_units_2',
      sourceConnectionId: conn.id,
      orderSnapshot: { items: [] },
      recordStatus: 'ready',
      cancelledAt: null,
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
      totalAmount: 5,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 5,
    });
    // Low revenue, high units.
    await seedLineItem(dataSource, {
      orderRecordId: 'ol_order_units_2',
      productId: 'ol_product_high_units',
      sourceConnectionId: conn.id,
      quantity: 50,
      unitPrice: 0.1,
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
    });

    const byUnits = await orderRecordService.getTopProducts({ ...filters, sortBy: 'units' });
    expect(byUnits.items[0].productId).toBe('ol_product_high_units');

    const byRevenue = await orderRecordService.getTopProducts({ ...filters, sortBy: 'revenue' });
    expect(byRevenue.items[0].productId).toBe('ol_product_high_revenue');
  });

  it('paginates via limit/offset while total reflects the full scoped distinct-product count', async () => {
    const dataSource = harness.getDataSource();
    const conn = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Connection pagination test',
      adapterKey: 'allegro.test.unused-paging',
    });

    for (let i = 0; i < 3; i += 1) {
      await createTestOrderRecord(dataSource, {
        internalOrderId: `ol_order_page_${i}`,
        sourceConnectionId: conn.id,
        orderSnapshot: { items: [] },
        recordStatus: 'ready',
        cancelledAt: null,
        placedAt: new Date('2026-08-02T00:00:00.000Z'),
        totalAmount: 10 - i,
        reportingCurrency: 'EUR',
        reportingTotalAmount: 10 - i,
      });
      await seedLineItem(dataSource, {
        orderRecordId: `ol_order_page_${i}`,
        productId: `ol_product_page_${i}`,
        sourceConnectionId: conn.id,
        quantity: 1,
        unitPrice: 10 - i,
        placedAt: new Date('2026-08-02T00:00:00.000Z'),
      });
    }

    const page = await orderRecordService.getTopProducts({ ...filters, limit: 2, offset: 0 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);

    const secondPage = await orderRecordService.getTopProducts({ ...filters, limit: 2, offset: 2 });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.total).toBe(3);
  });

  it(
    'never mixes a prior reporting-currency era into revenue when the system setting changed (#2049/ADR-040 bugfix)',
    async () => {
      const dataSource = harness.getDataSource();
      const conn = await createTestConnection(dataSource, {
        platformType: 'allegro',
        name: 'Connection currency-era test',
        adapterKey: 'allegro.test.unused-era',
      });

      // The system's CURRENT reporting currency is PLN — settings changes are
      // forward-only (ADR-040 § Decision 7), so this only affects how NEW
      // stamps are labelled; it never rewrites an already-stamped order.
      await dataSource.query(
        `INSERT INTO reporting_currency_setting (id, reporting_currency, updated_by)
         VALUES ('singleton', 'PLN', NULL)
         ON CONFLICT (id) DO UPDATE SET reporting_currency = EXCLUDED.reporting_currency`
      );

      // Order A was stamped EUR under the PREVIOUS setting, before the switch
      // to PLN — a real, permanently-pinned earlier era.
      await createTestOrderRecord(dataSource, {
        internalOrderId: 'ol_order_era_eur',
        sourceConnectionId: conn.id,
        orderSnapshot: { items: [] },
        recordStatus: 'ready',
        cancelledAt: null,
        placedAt: new Date('2026-08-02T00:00:00.000Z'),
        totalAmount: 100,
        reportingCurrency: 'EUR',
        reportingTotalAmount: 110,
      });
      await seedLineItem(dataSource, {
        orderRecordId: 'ol_order_era_eur',
        productId: 'ol_product_era',
        sourceConnectionId: conn.id,
        quantity: 2,
        unitPrice: 50,
        placedAt: new Date('2026-08-02T00:00:00.000Z'),
      });

      // Order B was stamped PLN under the CURRENT setting — the only era
      // `revenue` may count.
      await createTestOrderRecord(dataSource, {
        internalOrderId: 'ol_order_era_pln',
        sourceConnectionId: conn.id,
        orderSnapshot: { items: [] },
        recordStatus: 'ready',
        cancelledAt: null,
        placedAt: new Date('2026-08-03T00:00:00.000Z'),
        totalAmount: 40,
        reportingCurrency: 'PLN',
        reportingTotalAmount: 40,
      });
      await seedLineItem(dataSource, {
        orderRecordId: 'ol_order_era_pln',
        productId: 'ol_product_era',
        sourceConnectionId: conn.id,
        quantity: 1,
        unitPrice: 40,
        placedAt: new Date('2026-08-03T00:00:00.000Z'),
      });

      const result = await orderRecordService.getTopProducts(filters);

      expect(result.items).toHaveLength(1);
      const product = result.items[0];
      expect(product.productId).toBe('ol_product_era');
      // Only the PLN-stamped order counts toward revenue — the EUR-stamped
      // order's 110 must NOT be added in under either label.
      expect(product.revenue).toBeCloseTo(40, 2);
      expect(product.currency).toBe('PLN');
      // The prior EUR era discloses as unconverted evidence, exactly like a
      // never-stamped order — never silently folded into `revenue`.
      expect(product.unconvertedRevenue).toBeCloseTo(100, 2);
      expect(product.unconvertedOrderCount).toBe(1);
      expect(product.units).toBe(3);
    }
  );

  it(
    'discloses a stamped order with totalAmount = 0 as unconverted evidence rather than dropping it (#2172 review, IMPORTANT 2)',
    async () => {
      const dataSource = harness.getDataSource();
      const conn = await createTestConnection(dataSource, {
        platformType: 'allegro',
        name: 'Connection zero-total test',
        adapterKey: 'allegro.test.unused-zero-total',
      });

      // Fully-discounted order: stamped EUR, but totalAmount = 0 means the
      // FX multiplier (reportingTotalAmount / totalAmount) is NULL via
      // NULLIF — without the fix this line silently vanishes from both
      // `revenue` and `unconvertedRevenue`.
      await createTestOrderRecord(dataSource, {
        internalOrderId: 'ol_order_zero_total',
        sourceConnectionId: conn.id,
        orderSnapshot: { items: [] },
        recordStatus: 'ready',
        cancelledAt: null,
        placedAt: new Date('2026-08-02T00:00:00.000Z'),
        totalAmount: 0,
        currency: 'EUR',
        reportingCurrency: 'EUR',
        reportingTotalAmount: 0,
      });
      await seedLineItem(dataSource, {
        orderRecordId: 'ol_order_zero_total',
        productId: 'ol_product_zero_total',
        sourceConnectionId: conn.id,
        quantity: 2,
        unitPrice: 15,
        placedAt: new Date('2026-08-02T00:00:00.000Z'),
      });

      const result = await orderRecordService.getTopProducts(filters);

      expect(result.items).toHaveLength(1);
      const product = result.items[0];
      expect(product.productId).toBe('ol_product_zero_total');
      expect(product.revenue).toBe(0);
      // The line's own native amount (2 x 15 = 30) is disclosed, not lost.
      expect(product.unconvertedRevenue).toBeCloseTo(30, 2);
      expect(product.unconvertedOrderCount).toBe(1);
      expect(product.unconvertedCurrency).toBe('EUR');
      expect(product.units).toBe(2);
    }
  );

  it(
    'labels a channel\'s own unconvertedCurrency even when the mixed full set forces the parent row to null (#2172 review, still-open follow-up)',
    async () => {
      const dataSource = harness.getDataSource();
      const connEur = await createTestConnection(dataSource, {
        platformType: 'allegro',
        name: 'Connection channel-currency test EUR',
        adapterKey: 'allegro.test.unused-channel-currency-eur',
      });
      const connPln = await createTestConnection(dataSource, {
        platformType: 'woocommerce',
        name: 'Connection channel-currency test PLN',
        adapterKey: 'woocommerce.test.unused-channel-currency-pln',
      });

      // Same product, unstamped on both channels, but each channel's native
      // currency is uniform on its own — only the UNION across channels
      // mixes EUR and PLN. The parent ranking row must report
      // unconvertedCurrency: null (mixed), while each channel row keeps its
      // own single-currency label.
      await createTestOrderRecord(dataSource, {
        internalOrderId: 'ol_order_channel_currency_eur',
        sourceConnectionId: connEur.id,
        orderSnapshot: { items: [] },
        recordStatus: 'ready',
        cancelledAt: null,
        placedAt: new Date('2026-08-02T00:00:00.000Z'),
        totalAmount: 20,
        currency: 'EUR',
        reportingCurrency: null,
        reportingTotalAmount: null,
      });
      await seedLineItem(dataSource, {
        orderRecordId: 'ol_order_channel_currency_eur',
        productId: 'ol_product_channel_currency',
        sourceConnectionId: connEur.id,
        quantity: 1,
        unitPrice: 20,
        placedAt: new Date('2026-08-02T00:00:00.000Z'),
      });

      await createTestOrderRecord(dataSource, {
        internalOrderId: 'ol_order_channel_currency_pln',
        sourceConnectionId: connPln.id,
        orderSnapshot: { items: [] },
        recordStatus: 'ready',
        cancelledAt: null,
        placedAt: new Date('2026-08-03T00:00:00.000Z'),
        totalAmount: 80,
        currency: 'PLN',
        reportingCurrency: null,
        reportingTotalAmount: null,
      });
      await seedLineItem(dataSource, {
        orderRecordId: 'ol_order_channel_currency_pln',
        productId: 'ol_product_channel_currency',
        sourceConnectionId: connPln.id,
        quantity: 1,
        unitPrice: 80,
        placedAt: new Date('2026-08-03T00:00:00.000Z'),
      });

      const result = await orderRecordService.getTopProducts(filters);

      expect(result.items).toHaveLength(1);
      const product = result.items[0];
      expect(product.productId).toBe('ol_product_channel_currency');
      // Mixed across channels — the parent row cannot honestly pick one.
      expect(product.unconvertedCurrency).toBeNull();

      const eurChannel = product.channels.find((c) => c.sourceConnectionId === connEur.id);
      const plnChannel = product.channels.find((c) => c.sourceConnectionId === connPln.id);
      expect(eurChannel).toBeDefined();
      expect(eurChannel!.unconvertedCurrency).toBe('EUR');
      expect(plnChannel).toBeDefined();
      expect(plnChannel!.unconvertedCurrency).toBe('PLN');
    }
  );
});
