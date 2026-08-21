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
import type { OrderRecordRepositoryPort } from '@openlinker/core/orders';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '@openlinker/core/orders';
import { OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';

const CONNECTION = '11111111-1111-4111-8111-111111111111';

describe('Sales analytics daily aggregates (integration, #1987)', () => {
  let harness: IntegrationTestHarness;
  let repository: OrderRecordRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness.getApp().get<OrderRecordRepositoryPort>(ORDER_RECORD_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function seedStampedOrder(overrides: Partial<OrderRecordOrmEntity>): Promise<void> {
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
    await repo.save(entity);
  }

  it('buckets an order placed just before UTC midnight on the same UTC day, not the local-timezone day (#1987 review, IMPORTANT 2)', async () => {
    // 23:30 UTC — a session TimeZone set to anything east of UTC (Warsaw,
    // Tokyo) would truncate this to the FOLLOWING calendar day under a bare
    // date_trunc('day', placedAt); the explicit `AT TIME ZONE 'UTC'` pair
    // must keep it on 2026-08-02.
    await seedStampedOrder({
      placedAt: new Date('2026-08-02T23:30:00.000Z'),
      totalAmount: 100,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 100,
    });

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
    await seedStampedOrder({
      placedAt: day,
      currency: 'EUR',
      totalAmount: 100,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 100,
    });
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
    await seedStampedOrder({
      placedAt: day,
      totalAmount: 50,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 50,
    });
    await seedStampedOrder({
      placedAt: day,
      totalAmount: 60,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 60,
    });

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

  it('getMedianOrderValue computes PERCENTILE_CONT over stamped, non-cancelled orders', async () => {
    const day = new Date('2026-08-05T10:00:00.000Z');
    await seedStampedOrder({
      placedAt: day,
      totalAmount: 10,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 10,
    });
    await seedStampedOrder({
      placedAt: day,
      totalAmount: 20,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 20,
    });
    await seedStampedOrder({
      placedAt: day,
      totalAmount: 30,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 30,
    });
    // Cancelled — must not enter the median.
    await seedStampedOrder({
      placedAt: day,
      totalAmount: 1000,
      reportingCurrency: 'EUR',
      reportingTotalAmount: 1000,
      cancelledAt: new Date('2026-08-05T11:00:00.000Z'),
    });

    const median = await repository.getMedianOrderValue(
      {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
      },
      'EUR'
    );

    expect(median).toBe(20);
  });
});
