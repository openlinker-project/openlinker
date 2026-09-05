/**
 * Sales Analytics Daily Aggregates Integration Test (#1987 review)
 *
 * Exercises `OrderRecordRepository.getDailyOrderAggregates` /
 * `getMedianOrderValue` against real Testcontainers Postgres — the two
 * review findings (UTC day-bucket semantics, and the mixed-reportingCurrency
 * guard) were only reachable because the existing unit specs mock the query
 * builder, so `date_trunc`/`PERCENTILE_CONT`/`FILTER (WHERE ...)` never
 * actually ran against a server.
 *
 * @module apps/api/test/integration
 */
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IOrderRecordService, OrderRecordRepositoryPort } from '@openlinker/core/orders';
import { ORDER_RECORD_REPOSITORY_TOKEN, ORDER_RECORD_SERVICE_TOKEN } from '@openlinker/core/orders';
import { OrderLineItemOrmEntity, OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';

const CONNECTION = '11111111-1111-4111-8111-111111111111';

describe('Sales analytics daily aggregates (integration, #1987)', () => {
  let harness: IntegrationTestHarness;
  let repository: OrderRecordRepositoryPort;
  let orderRecordService: IOrderRecordService;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness.getApp().get<OrderRecordRepositoryPort>(ORDER_RECORD_REPOSITORY_TOKEN);
    orderRecordService = harness.getApp().get<IOrderRecordService>(ORDER_RECORD_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function seedStampedOrder(overrides: Partial<OrderRecordOrmEntity>): Promise<string> {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    const repo = harness.getDataSource().getRepository(OrderRecordOrmEntity);
    const entity = repo.create({
      internalOrderId: `ol_order_sales_${suffix}`,
      customerId: null,
      sourceConnectionId: CONNECTION,
      sourceEventId: null,
      orderSnapshot: { items: [] },
      syncStatus: [],
      recordStatus: 'ready',
      cancelledAt: null,
      currency: 'EUR',
      taxTreatment: 'inclusive',
      ...overrides,
    });
    const saved = await repo.save(entity);
    return saved.internalOrderId;
  }

  async function seedLineItem(overrides: Partial<OrderLineItemOrmEntity>): Promise<void> {
    const repo = harness.getDataSource().getRepository(OrderLineItemOrmEntity);
    await repo.save(
      repo.create({
        orderRecordId: 'ol_order_placeholder',
        lineNumber: 0,
        productId: 'ol_product_placeholder',
        variantId: null,
        quantity: 1,
        unitPrice: 0,
        sourceConnectionId: CONNECTION,
        placedAt: new Date('2026-08-02T00:00:00.000Z'),
        ...overrides,
      })
    );
  }

  it('buckets an order placed just before UTC midnight on the same UTC day, not the local-timezone day (#1987 review, IMPORTANT 2)', async () => {
    // 23:30 UTC — a session TimeZone set to anything east of UTC (Warsaw,
    // Tokyo) would truncate this to the FOLLOWING calendar day under a bare
    // date_trunc('day', placedAt); the explicit `AT TIME ZONE 'UTC'` pair
    // must keep it on 2026-08-02.
    const orderId = await seedStampedOrder({
      placedAt: new Date('2026-08-02T23:30:00.000Z'),
      totalAmount: 100,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 100,
    });
    await seedLineItem({ orderRecordId: orderId, unitPrice: 100, quantity: 1 });

    // Testcontainers Postgres boots with TimeZone = UTC, so this assertion
    // would pass identically with or without the `AT TIME ZONE 'UTC'` pair —
    // it documents intent but can't fail on a regression (#2151 review,
    // SUGGESTION). Force the session TimeZone to Warsaw (east of UTC) for
    // this one read so a regression to a bare `date_trunc('day', placedAt)`
    // actually flips the bucket to 2026-08-03 and fails the test. `SET TIME
    // ZONE` is session-scoped; `dataSource.query` and `repository.
    // getDailyOrderAggregates` run back-to-back with no concurrent query in
    // flight, so the pool hands back the same just-released client.
    const dataSource = harness.getDataSource();
    await dataSource.query(`SET TIME ZONE 'Europe/Warsaw'`);
    let rows;
    try {
      rows = await repository.getDailyOrderAggregates(
        {
          from: new Date('2026-08-01T00:00:00.000Z'),
          to: new Date('2026-08-08T00:00:00.000Z'),
        },
        'EUR'
      );
    } finally {
      await dataSource.query(`SET TIME ZONE 'UTC'`);
    }

    expect(rows).toHaveLength(1);
    expect(rows[0].day.toISOString()).toBe('2026-08-02T00:00:00.000Z');
    expect(rows[0].revenue).toBe(100);
  });

  it('folds a prior-era stamp into the unconverted bucket rather than mixing it into revenue (#1987 review notes, ported from #2172)', async () => {
    const day = new Date('2026-08-03T10:00:00.000Z');
    // Current-era stamp — the system reporting currency is EUR at read time.
    const currentEraOrderId = await seedStampedOrder({
      placedAt: day,
      currency: 'EUR',
      totalAmount: 100,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 100,
    });
    await seedLineItem({ orderRecordId: currentEraOrderId, unitPrice: 100, quantity: 1 });
    // A stamp taken while the operator's reporting-currency setting held a
    // different value (#2096) — `reportingCurrency` never moves once set
    // (ADR-040), so this row must NOT be summed into `revenue` alongside the
    // current-era row above.
    await seedStampedOrder({
      placedAt: day,
      currency: 'PLN',
      totalAmount: 100,
      reportingCurrency: 'PLN',
      reportingTotalAmount: 430,
    });

    const rows = await repository.getDailyOrderAggregates(
      {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      },
      'EUR'
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].orderCount).toBe(1);
    expect(rows[0].revenue).toBe(100);
    expect(rows[0].reportingCurrency).toBe('EUR');
    // The prior-era row reads as unconverted, native-currency evidence —
    // never silently summed into `revenue` or silently dropped.
    expect(rows[0].unconvertedCount).toBe(1);
    expect(rows[0].unconvertedValue).toBe(100);
    expect(rows[0].unconvertedCurrency).toBe('PLN');
  });

  it('reports the shared reportingCurrency when a bucket agrees', async () => {
    const day = new Date('2026-08-04T10:00:00.000Z');
    const orderIdA = await seedStampedOrder({
      placedAt: day,
      totalAmount: 50,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 50,
    });
    await seedLineItem({ orderRecordId: orderIdA, unitPrice: 50, quantity: 1 });
    const orderIdB = await seedStampedOrder({
      placedAt: day,
      totalAmount: 60,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 60,
    });
    await seedLineItem({ orderRecordId: orderIdB, unitPrice: 60, quantity: 1 });

    const rows = await repository.getDailyOrderAggregates(
      {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      },
      'EUR'
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].reportingCurrency).toBe('EUR');
    expect(rows[0].revenue).toBe(110);
  });

  it('excludes shipping from revenue (GMV) — the order total includes it, the line items do not (#2892)', async () => {
    // Mirrors the live-confirmed defect shape: subtotal=44.97, shipping=10.95,
    // total=55.92. Revenue must report the merchandise-only 44.97, never the
    // shipping-inclusive order total.
    const day = new Date('2026-08-05T10:00:00.000Z');
    const orderId = await seedStampedOrder({
      placedAt: day,
      totalAmount: 55.92,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 55.92,
      taxTreatment: 'inclusive',
    });
    await seedLineItem({ orderRecordId: orderId, unitPrice: 44.97, quantity: 1, taxRate: '0' });

    const rows = await repository.getDailyOrderAggregates(
      {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      },
      'EUR'
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].revenue).toBeCloseTo(44.97, 5);
  });

  it('grosses up an exclusive (net-priced) line via its tax rate, rather than reporting the net value as revenue (#2892)', async () => {
    const day = new Date('2026-08-06T10:00:00.000Z');
    // Net-priced line: unitPrice is VAT-exclusive. 100 net at 23% VAT -> 123 gross.
    const orderId = await seedStampedOrder({
      placedAt: day,
      totalAmount: 123,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 123,
      taxTreatment: 'exclusive',
    });
    await seedLineItem({ orderRecordId: orderId, unitPrice: 100, quantity: 1, taxRate: '23' });

    const rows = await repository.getDailyOrderAggregates(
      {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      },
      'EUR'
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].revenue).toBeCloseTo(123, 5);
  });

  it('computes cancelledValue net-of-VAT and shipping-excluded for a cancelled order (#2910)', async () => {
    // Same shape as the GMV shipping-exclusion fixture above: subtotal=123
    // gross (23% VAT, so 100 net), shipping=10, total=133. cancelledValue
    // must report the merchandise-only NET figure (100), never the
    // shipping-inclusive gross order total (133) and never the gross
    // merchandise value (123).
    const day = new Date('2026-08-05T10:00:00.000Z');
    const orderId = await seedStampedOrder({
      placedAt: day,
      totalAmount: 133,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 133,
      taxTreatment: 'inclusive',
      cancelledAt: new Date('2026-08-05T12:00:00.000Z'),
    });
    await seedLineItem({ orderRecordId: orderId, unitPrice: 123, quantity: 1, taxRate: '23' });

    const rows = await repository.getDailyOrderAggregates(
      {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      },
      'EUR'
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].cancelledCount).toBe(1);
    expect(rows[0].cancelledValue).toBeCloseTo(100, 5);
    expect(rows[0].cancelledNetExcludedCount).toBe(0);
    expect(rows[0].cancelledNetExcludedValue).toBe(0);
  });

  it('excludes a cancelled order with an unresolvable tax rate from cancelledValue and reports it via cancelledNetExcludedCount/Value (#2910)', async () => {
    const day = new Date('2026-08-06T10:00:00.000Z');
    const orderId = await seedStampedOrder({
      placedAt: day,
      totalAmount: 133,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 133,
      taxTreatment: 'inclusive',
      cancelledAt: new Date('2026-08-06T12:00:00.000Z'),
    });
    // No resolvable rate on the only line — gross-priced (`inclusive`) with
    // an unparseable taxRate, so net cannot be derived for this order.
    await seedLineItem({ orderRecordId: orderId, unitPrice: 123, quantity: 1, taxRate: null });

    const rows = await repository.getDailyOrderAggregates(
      {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      },
      'EUR'
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].cancelledCount).toBe(1);
    expect(rows[0].cancelledValue).toBe(0);
    expect(rows[0].cancelledNetExcludedCount).toBe(1);
    // Reported at the order's native gross total (informational), mirroring
    // netExcludedValue's convention for the non-cancelled cohort.
    expect(rows[0].cancelledNetExcludedValue).toBe(133);
  });

  it('getMedianOrderValue returns null when no stamped order matches the range', async () => {
    const median = await repository.getMedianOrderValue(
      {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      },
      'EUR'
    );

    expect(median).toBeNull();
  });

  it('getMedianOrderValue computes PERCENTILE_CONT over stamped, non-cancelled orders, on the gross merchandise-only basis (#2906)', async () => {
    const day = new Date('2026-08-05T10:00:00.000Z');
    // Each order's `totalAmount` (shipping-INCLUSIVE) diverges from its
    // merchandise-only line-item value by a flat 5 shipping charge, so a
    // regression back to `reportingTotalAmount` would shift the median from
    // 20 to 25 — the assertion below fails on that basis, not just on this
    // one.
    const order1 = await seedStampedOrder({
      placedAt: day,
      totalAmount: 15,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 15,
    });
    await seedLineItem({ orderRecordId: order1, unitPrice: 10, quantity: 1 });

    const order2 = await seedStampedOrder({
      placedAt: day,
      totalAmount: 25,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 25,
    });
    await seedLineItem({ orderRecordId: order2, unitPrice: 20, quantity: 1 });

    const order3 = await seedStampedOrder({
      placedAt: day,
      totalAmount: 35,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 35,
    });
    await seedLineItem({ orderRecordId: order3, unitPrice: 30, quantity: 1 });

    // Cancelled — must not enter the median.
    const cancelledOrder = await seedStampedOrder({
      placedAt: day,
      totalAmount: 1000,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 1000,
      cancelledAt: new Date('2026-08-05T11:00:00.000Z'),
    });
    await seedLineItem({ orderRecordId: cancelledOrder, unitPrice: 990, quantity: 1 });

    const median = await repository.getMedianOrderValue(
      {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      },
      'EUR'
    );

    expect(median).toBe(20);
  });

  it('getMedianOrderValue shares AOV/Revenue\'s gross, shipping-EXCLUDED basis instead of the shipping-inclusive order total (#2906)', async () => {
    // Live-proven regression: for this exact shape (a shipping-inclusive
    // order total of 300 against a merchandise-only line value of 200), the
    // pre-#2906 implementation — PERCENTILE_CONT over `reportingTotalAmount`
    // directly — returned 300. AOV/Revenue for the identical order set report
    // 200 (`getSalesAndChannelAnalytics`/`getDailyOrderAggregates`, computed
    // from `order_line_items` via `buildGrossRevenueOrderAmountSql`). The
    // spec's own contract (`docs/specs/metrics-analytics-dashboard.md`)
    // requires median and AOV to share the same value field.
    const day = new Date('2026-08-05T10:00:00.000Z');
    const orderId = await seedStampedOrder({
      placedAt: day,
      totalAmount: 300,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 300,
    });
    await seedLineItem({ orderRecordId: orderId, unitPrice: 200, quantity: 1 });

    const median = await repository.getMedianOrderValue(
      {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      },
      'EUR'
    );

    expect(median).toBe(200);
    expect(median).not.toBe(300);
  });

  describe('findCurrencyMismatchOrders (#2464)', () => {
    it('flags a never-stamped order (reportingCurrency IS NULL)', async () => {
      await seedStampedOrder({
        placedAt: new Date('2026-08-02T10:00:00.000Z'),
        currency: 'PLN',
        totalAmount: 100,
        reportingCurrency: null,
        reportingTotalAmount: null,
        fxStampedAt: null,
      });

      const result = await repository.findCurrencyMismatchOrders(
        {
          from: new Date('2026-08-01T00:00:00.000Z'),
          to: new Date('2026-08-08T00:00:00.000Z'),
        },
        'EUR',
        { limit: 20, offset: 0 }
      );

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].nativeCurrency).toBe('PLN');
      expect(result.items[0].stampedCurrency).toBeNull();
      expect(result.items[0].stampedAt).toBeNull();
    });

    it('flags the demo-DB same-currency-code stale-stamp shape (reportingCurrency present but not the CURRENT setting)', async () => {
      // Exactly the shape #2464's issue calls out as manually fixed on the
      // demo DB: a real stamp exists (fxStampedAt is set, the order is NOT
      // "never stamped"), but it was taken while the operator's reporting
      // setting held a different value than it holds now.
      const stampedAt = new Date('2026-06-01T09:00:00.000Z');
      await seedStampedOrder({
        placedAt: new Date('2026-08-03T10:00:00.000Z'),
        currency: 'PLN',
        totalAmount: 100,
        reportingCurrency: 'EUR',
        reportingTotalAmount: 23,
        fxStampedAt: stampedAt,
      });

      const result = await repository.findCurrencyMismatchOrders(
        {
          from: new Date('2026-08-01T00:00:00.000Z'),
          to: new Date('2026-08-08T00:00:00.000Z'),
        },
        // The CURRENT setting has since moved to PLN — the EUR stamp above
        // is now a prior-era, stale stamp, not a fresh one.
        'PLN',
        { limit: 20, offset: 0 }
      );

      expect(result.total).toBe(1);
      expect(result.items[0].nativeCurrency).toBe('PLN');
      expect(result.items[0].stampedCurrency).toBe('EUR');
      expect(result.items[0].stampedAt?.toISOString()).toBe(stampedAt.toISOString());
    });

    it('combines both populations into one total that matches getDailyOrderAggregates.unconvertedCount exactly (regression guard)', async () => {
      const day = new Date('2026-08-04T10:00:00.000Z');
      // Never-stamped.
      await seedStampedOrder({
        placedAt: day,
        currency: 'PLN',
        totalAmount: 10,
        reportingCurrency: null,
        reportingTotalAmount: null,
        fxStampedAt: null,
      });
      // Stale-stamp, cross-currency.
      await seedStampedOrder({
        placedAt: day,
        currency: 'USD',
        totalAmount: 20,
        reportingCurrency: 'EUR',
        reportingTotalAmount: 18,
        fxStampedAt: new Date('2026-05-01T00:00:00.000Z'),
      });
      // Stale-stamp, same-currency-code shape from the issue.
      await seedStampedOrder({
        placedAt: day,
        currency: 'PLN',
        totalAmount: 30,
        reportingCurrency: 'EUR',
        reportingTotalAmount: 7,
        fxStampedAt: new Date('2026-05-02T00:00:00.000Z'),
      });
      // Current-era stamped — must NOT be counted as a mismatch.
      await seedStampedOrder({
        placedAt: day,
        currency: 'PLN',
        totalAmount: 40,
        reportingCurrency: 'PLN',
        reportingTotalAmount: 40,
        fxStampedAt: new Date('2026-08-04T00:00:00.000Z'),
      });
      // Cancelled — excluded from both reads identically.
      await seedStampedOrder({
        placedAt: day,
        currency: 'PLN',
        totalAmount: 999,
        reportingCurrency: null,
        reportingTotalAmount: null,
        fxStampedAt: null,
        cancelledAt: new Date('2026-08-04T12:00:00.000Z'),
      });

      const filters = {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      };

      const [dailyRows, mismatchPage] = await Promise.all([
        repository.getDailyOrderAggregates(filters, 'PLN'),
        repository.findCurrencyMismatchOrders(filters, 'PLN', { limit: 20, offset: 0 }),
      ]);

      const unconvertedCount = dailyRows.reduce((sum, row) => sum + row.unconvertedCount, 0);

      expect(unconvertedCount).toBe(3);
      expect(mismatchPage.total).toBe(unconvertedCount);
      expect(mismatchPage.items).toHaveLength(3);
    });

    it('reports a zero-mismatch page when every order is current-era stamped (backs the all-clear mockup state)', async () => {
      const day = new Date('2026-08-05T10:00:00.000Z');
      await seedStampedOrder({
        placedAt: day,
        currency: 'EUR',
        totalAmount: 50,
        reportingCurrency: 'EUR',
        reportingTotalAmount: 50,
        fxStampedAt: new Date('2026-08-05T00:00:00.000Z'),
      });

      const filters = {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      };

      const [dailyRows, mismatchPage] = await Promise.all([
        repository.getDailyOrderAggregates(filters, 'EUR'),
        repository.findCurrencyMismatchOrders(filters, 'EUR', { limit: 20, offset: 0 }),
      ]);

      const unconvertedCount = dailyRows.reduce((sum, row) => sum + row.unconvertedCount, 0);

      expect(unconvertedCount).toBe(0);
      expect(mismatchPage).toEqual({ items: [], total: 0 });
    });

    it('paginates via limit/offset, newest-first', async () => {
      // Distinct native currencies so the two pages are distinguishable —
      // the row shape carries no `placedAt`, so ordering is asserted via
      // which order lands on which page rather than a raw date comparison.
      await seedStampedOrder({
        placedAt: new Date('2026-08-02T10:00:00.000Z'),
        currency: 'PLN',
        totalAmount: 10,
        reportingCurrency: null,
        fxStampedAt: null,
      });
      await seedStampedOrder({
        placedAt: new Date('2026-08-03T10:00:00.000Z'),
        currency: 'USD',
        totalAmount: 20,
        reportingCurrency: null,
        fxStampedAt: null,
      });

      const filters = {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      };

      const firstPage = await repository.findCurrencyMismatchOrders(filters, 'EUR', {
        limit: 1,
        offset: 0,
      });
      const secondPage = await repository.findCurrencyMismatchOrders(filters, 'EUR', {
        limit: 1,
        offset: 1,
      });

      expect(firstPage.total).toBe(2);
      expect(secondPage.total).toBe(2);
      // 2026-08-03 (USD) is the newer of the two — must land on page 1.
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.items[0].nativeCurrency).toBe('USD');
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.items[0].nativeCurrency).toBe('PLN');
    });
  });

  describe('OrderRecordService.getCurrencyMismatchOrders line-item enrichment against real Postgres (#2799 review, BLOCKING 1)', () => {
    // The unit specs mock the query builder, so they can never fail on the
    // actual GROUP BY/dedup semantics — a mock happily reports whatever rows
    // it's told to. This proves the real SQL: an order whose lines span
    // several products gets every one of them back, not just the first.
    it('returns every distinct product an order touches, not just its first line', async () => {
      const internalOrderId = await seedStampedOrder({
        placedAt: new Date('2026-08-06T10:00:00.000Z'),
        currency: 'PLN',
        totalAmount: 100,
        reportingCurrency: null,
        reportingTotalAmount: null,
        fxStampedAt: null,
      });
      await seedLineItem({
        orderRecordId: internalOrderId,
        lineNumber: 0,
        productId: 'ol_product_a',
        variantId: 'ol_variant_a1',
      });
      await seedLineItem({
        orderRecordId: internalOrderId,
        lineNumber: 1,
        productId: 'ol_product_b',
        variantId: null,
      });
      // A second line on the SAME product (different variant) must not
      // produce a duplicate entry once collapsed to distinct product ids by
      // the exclusion-map layer — but the repository read itself is keyed
      // by (product, variant), so this legitimately adds one more row.
      await seedLineItem({
        orderRecordId: internalOrderId,
        lineNumber: 2,
        productId: 'ol_product_a',
        variantId: 'ol_variant_a2',
      });

      const filters = {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      };
      const page = await orderRecordService.getCurrencyMismatchOrders(filters, 'EUR', {
        limit: 20,
        offset: 0,
      });

      const row = page.items.find((item) => item.internalOrderId === internalOrderId);
      expect(row).toBeDefined();
      expect(row!.lineProducts).toHaveLength(3);
      expect(new Set(row!.lineProducts.map((p) => p.productId))).toEqual(
        new Set(['ol_product_a', 'ol_product_b'])
      );
      expect(row!.lineProducts).toEqual(
        expect.arrayContaining([
          { productId: 'ol_product_a', variantId: 'ol_variant_a1' },
          { productId: 'ol_product_a', variantId: 'ol_variant_a2' },
          { productId: 'ol_product_b', variantId: null },
        ])
      );
    });

    it('reports an empty lineProducts array, never a fabricated entry, when an order genuinely carries no line items', async () => {
      const internalOrderId = await seedStampedOrder({
        placedAt: new Date('2026-08-06T11:00:00.000Z'),
        currency: 'PLN',
        totalAmount: 50,
        reportingCurrency: null,
        reportingTotalAmount: null,
        fxStampedAt: null,
      });

      const filters = {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      };
      const page = await orderRecordService.getCurrencyMismatchOrders(filters, 'EUR', {
        limit: 20,
        offset: 0,
      });

      const row = page.items.find((item) => item.internalOrderId === internalOrderId);
      expect(row).toBeDefined();
      expect(row!.lineProducts).toEqual([]);
    });
  });

  describe('findCurrencyMismatchOrdersByConnection (#2713)', () => {
    const OTHER_CONNECTION = '22222222-2222-4222-8222-222222222222';

    it('groups mismatch counts across ≥2 connections, matching findCurrencyMismatchOrders.total per connection', async () => {
      const day = new Date('2026-08-02T10:00:00.000Z');
      // Two mismatches on the default CONNECTION.
      await seedStampedOrder({
        placedAt: day,
        currency: 'PLN',
        totalAmount: 10,
        reportingCurrency: null,
        reportingTotalAmount: null,
        fxStampedAt: null,
      });
      // A stale-era stamp: stamped in PLN while the CURRENT setting (the
      // `'EUR'` passed to the read below) has since moved on. Stamping this
      // one `'EUR'` — as this fixture originally did — made it current-era
      // by definition, so it was correctly NOT counted and the expected
      // count of 2 could never hold (#2799 review, IMPORTANT 3: this test
      // asserted a total the predicate it documents cannot produce, and no
      // mocked spec could catch it).
      await seedStampedOrder({
        placedAt: day,
        currency: 'USD',
        totalAmount: 20,
        reportingCurrency: 'PLN',
        reportingTotalAmount: 85,
        fxStampedAt: new Date('2026-05-01T00:00:00.000Z'),
      });
      // One mismatch on a SECOND, distinct connection.
      await seedStampedOrder({
        placedAt: day,
        sourceConnectionId: OTHER_CONNECTION,
        currency: 'PLN',
        totalAmount: 30,
        reportingCurrency: null,
        reportingTotalAmount: null,
        fxStampedAt: null,
      });
      // Current-era stamped on the second connection — must not be counted.
      await seedStampedOrder({
        placedAt: day,
        sourceConnectionId: OTHER_CONNECTION,
        currency: 'EUR',
        totalAmount: 40,
        reportingCurrency: 'EUR',
        reportingTotalAmount: 40,
        fxStampedAt: new Date('2026-08-02T00:00:00Z'),
      });

      const filters = {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      };

      const rows = await repository.findCurrencyMismatchOrdersByConnection(filters, 'EUR');

      const byConnection = new Map(rows.map((row) => [row.sourceConnectionId, row.affectedCount]));
      expect(byConnection.get(CONNECTION)).toBe(2);
      expect(byConnection.get(OTHER_CONNECTION)).toBe(1);
      expect(rows).toHaveLength(2);

      // Cross-check against the paginated read's per-connection total, so a
      // regression that lets the two predicates drift is caught here rather
      // than only by the source-level "identical predicate" comment.
      const [connectionPage, otherConnectionPage] = await Promise.all([
        repository.findCurrencyMismatchOrders(
          { ...filters, sourceConnectionId: CONNECTION },
          'EUR',
          { limit: 20, offset: 0 }
        ),
        repository.findCurrencyMismatchOrders(
          { ...filters, sourceConnectionId: OTHER_CONNECTION },
          'EUR',
          { limit: 20, offset: 0 }
        ),
      ]);
      expect(byConnection.get(CONNECTION)).toBe(connectionPage.total);
      expect(byConnection.get(OTHER_CONNECTION)).toBe(otherConnectionPage.total);
    });

    it('excludes cancelled orders from the count, matching the paginated read', async () => {
      await seedStampedOrder({
        placedAt: new Date('2026-08-03T10:00:00.000Z'),
        currency: 'PLN',
        totalAmount: 10,
        reportingCurrency: null,
        reportingTotalAmount: null,
        fxStampedAt: null,
        cancelledAt: new Date('2026-08-03T12:00:00.000Z'),
      });

      const filters = {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      };

      const rows = await repository.findCurrencyMismatchOrdersByConnection(filters, 'EUR');

      expect(rows).toEqual([]);
    });

    it('returns an empty array — a connection with zero mismatches is simply absent — when every order is current-era stamped', async () => {
      await seedStampedOrder({
        placedAt: new Date('2026-08-04T10:00:00.000Z'),
        currency: 'EUR',
        totalAmount: 50,
        reportingCurrency: 'EUR',
        reportingTotalAmount: 50,
        fxStampedAt: new Date('2026-08-04T00:00:00.000Z'),
      });

      const rows = await repository.findCurrencyMismatchOrdersByConnection(
        {
          from: new Date('2026-08-01T00:00:00.000Z'),
          to: new Date('2026-08-08T00:00:00.000Z'),
        },
        'EUR'
      );

      expect(rows).toEqual([]);
    });
  });

  describe('findProductMatchingErrorOrders (#2466)', () => {
    it(
      'reports the SAME total as countByHealth.sourceDeleted + awaitingMapping, mapping both ' +
        'statuses to the row shape (regression guard)',
      async () => {
        await seedStampedOrder({
          recordStatus: 'awaiting_mapping',
          mappingFailureReason: 'no variant mapping for SKU-123',
          placedAt: null,
          totalAmount: null,
          reportingCurrency: null,
        });
        await seedStampedOrder({
          recordStatus: 'source_deleted',
          mappingFailureReason: 'variant deleted at master',
          placedAt: null,
          totalAmount: null,
          reportingCurrency: null,
        });
        // A healthy, ready order — must NOT appear in the product-matching page.
        await seedStampedOrder({
          recordStatus: 'ready',
          placedAt: new Date('2026-08-02T00:00:00.000Z'),
          totalAmount: 20,
          reportingCurrency: 'EUR',
          reportingTotalAmount: 20,
        });

        const [health, page] = await Promise.all([
          repository.countByHealth({}),
          repository.findProductMatchingErrorOrders({}, { limit: 20, offset: 0 }),
        ]);

        const expectedCount = health.sourceDeleted + health.awaitingMapping;
        expect(expectedCount).toBe(2);
        expect(page.total).toBe(expectedCount);

        const reasons = page.items.map((item) => item.mappingFailureReason).sort();
        expect(reasons).toEqual(['no variant mapping for SKU-123', 'variant deleted at master']);
        const statuses = page.items.map((item) => item.recordStatus).sort();
        expect(statuses).toEqual(['awaiting_mapping', 'source_deleted']);
      }
    );

    it('scopes by createdFrom/createdTo, and reports an empty page when nothing matches', async () => {
      const filters = {
        createdFrom: new Date(Date.now() + 60_000),
        createdTo: new Date(Date.now() + 120_000),
      };

      await seedStampedOrder({
        recordStatus: 'awaiting_mapping',
        mappingFailureReason: 'no variant mapping',
        placedAt: null,
        totalAmount: null,
        reportingCurrency: null,
      });

      const page = await repository.findProductMatchingErrorOrders(filters, {
        limit: 20,
        offset: 0,
      });

      expect(page).toEqual({ items: [], total: 0 });
    });
  });
});
