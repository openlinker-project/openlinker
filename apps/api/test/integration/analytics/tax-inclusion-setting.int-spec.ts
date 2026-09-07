/**
 * Tax-Inclusion Setting Int-Spec (#2469)
 *
 * Replays the live-demo fixture behind ADR-063's amendment for #2456: 31
 * `taxRateEra = 'pre-rollout'` orders whose lines DO carry a resolvable tax
 * rate (the backfill sweep already wrote it), which ADR-063's blanket exclusion
 * nevertheless keeps out of Net Sales. They are the whole reason the operator
 * opt-in exists.
 *
 * Three properties are asserted, and only a real Postgres can assert them —
 * the unit specs mock the query builder, so the era clause, the correlated
 * `NOT EXISTS` over `order_line_items` and the `FILTER (WHERE ...)` aggregates
 * never actually run there:
 *
 *  1. With the setting OFF the 31 orders are excluded, exactly as before #2469.
 *  2. With it ON they become Net-Sales eligible in the SAME query, with no job,
 *     no delay and no second request.
 *  3. **No `order_records` or `order_line_items` row is mutated by either
 *     transition.** This is Phase 1 Task 1.3's core invariant and the reason
 *     the earlier per-order "confirm" design was rejected: the fix must be
 *     instantly reversible, which it can only be if it never writes.
 *
 * @module apps/api/test/integration/analytics
 */
import {
  ORDER_RECORD_REPOSITORY_TOKEN,
  TAX_COVERAGE_DETECTION_SERVICE_TOKEN,
  type ITaxCoverageDetectionService,
  type OrderRecordRepositoryPort,
} from '@openlinker/core/orders';
import { OrderLineItemOrmEntity, OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  type IntegrationTestHarness,
} from '../setup';
import { createTestOrderRecord } from '../fixtures/order.fixtures';

/** The live-demo fixture's exact size. */
const PRE_ROLLOUT_ORDER_COUNT = 31;
const CONNECTION = '11111111-1111-4111-8111-111111111111';
const REPORTING_CURRENCY = 'EUR';

describe('Tax-inclusion setting against real Postgres (#2469)', () => {
  let harness: IntegrationTestHarness;
  let repository: OrderRecordRepositoryPort;
  let taxCoverage: ITaxCoverageDetectionService;

  beforeAll(async () => {
    harness = await getTestHarness();
    const app = harness.getApp();
    repository = app.get<OrderRecordRepositoryPort>(ORDER_RECORD_REPOSITORY_TOKEN);
    taxCoverage = app.get<ITaxCoverageDetectionService>(TAX_COVERAGE_DETECTION_SERVICE_TOKEN);
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

  /**
   * One pre-rollout order carrying a resolvable rate on every line — the shape
   * the backfill sweep leaves behind, and the shape ADR-063's blanket exclusion
   * nonetheless keeps out of Net Sales.
   */
  async function seedBackfilledPreRolloutOrder(index: number): Promise<string> {
    const dataSource = harness.getDataSource();
    const record = await createTestOrderRecord(dataSource, {
      internalOrderId: `ol_order_prerollout_${index}`,
      placedAt: new Date('2026-08-03T00:00:00.000Z'),
      recordStatus: 'ready',
      totalAmount: 123,
      currency: REPORTING_CURRENCY,
      reportingCurrency: REPORTING_CURRENCY,
      reportingTotalAmount: 123,
      taxTreatment: 'inclusive',
      taxRateEra: 'pre-rollout',
    });
    const lineRepo = dataSource.getRepository(OrderLineItemOrmEntity);
    await lineRepo.save(
      lineRepo.create({
        orderRecordId: record.internalOrderId,
        lineNumber: 0,
        productId: `ol_product_${index}`,
        variantId: null,
        quantity: 1,
        unitPrice: 123,
        sourceConnectionId: CONNECTION,
        placedAt: new Date('2026-08-03T00:00:00.000Z'),
        // A REAL rate, written by the backfill — this is what makes the order
        // resolvable and therefore category A rather than category B or C.
        taxRate: '23',
        taxSource: 'backfill',
      })
    );
    return record.internalOrderId;
  }

  async function seedFixture(): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < PRE_ROLLOUT_ORDER_COUNT; i += 1) {
      ids.push(await seedBackfilledPreRolloutOrder(i));
    }
    return ids;
  }

  /** Whole-row snapshots of everything the reads touch, for the no-mutation guard. */
  async function snapshotRows(): Promise<{ orders: unknown[]; lines: unknown[] }> {
    const dataSource = harness.getDataSource();
    const orders = await dataSource
      .getRepository(OrderRecordOrmEntity)
      .find({ order: { internalOrderId: 'ASC' } });
    const lines = await dataSource
      .getRepository(OrderLineItemOrmEntity)
      .find({ order: { orderRecordId: 'ASC', lineNumber: 'ASC' } });
    return {
      orders: JSON.parse(JSON.stringify(orders)) as unknown[],
      lines: JSON.parse(JSON.stringify(lines)) as unknown[],
    };
  }

  function sumNetExcluded(rows: Array<{ netExcludedCount: number }>): number {
    return rows.reduce((total, row) => total + row.netExcludedCount, 0);
  }

  function sumNetRevenue(rows: Array<{ netRevenue: number }>): number {
    return rows.reduce((total, row) => total + Number(row.netRevenue), 0);
  }

  it('excludes all 31 backfilled pre-rollout orders from Net Sales with the setting OFF', async () => {
    await seedFixture();

    const rows = await repository.getDailyOrderAggregates(filters, REPORTING_CURRENCY, false);

    expect(sumNetExcluded(rows)).toBe(PRE_ROLLOUT_ORDER_COUNT);
    expect(sumNetRevenue(rows)).toBe(0);
  });

  it('admits all 31 into Net Sales with the setting ON, in the very next query', async () => {
    await seedFixture();

    const rows = await repository.getDailyOrderAggregates(filters, REPORTING_CURRENCY, true);

    expect(sumNetExcluded(rows)).toBe(0);
    // 123 gross at 23% inclusive -> 100 net, times 31 orders. Asserted as a real
    // figure rather than just "> 0", so a predicate that admitted the orders but
    // computed the wrong net amount still fails.
    expect(sumNetRevenue(rows)).toBeCloseTo(100 * PRE_ROLLOUT_ORDER_COUNT, 2);
  });

  it('mutates no order_records or order_line_items row across an OFF -> ON -> OFF transition', async () => {
    await seedFixture();
    const before = await snapshotRows();

    await repository.getDailyOrderAggregates(filters, REPORTING_CURRENCY, false);
    await repository.getDailyOrderAggregates(filters, REPORTING_CURRENCY, true);
    await repository.getNetMedianOrderValue(filters, REPORTING_CURRENCY, true);
    await repository.getDailyOrderAggregates(filters, REPORTING_CURRENCY, false);

    await expect(snapshotRows()).resolves.toEqual(before);
  });

  it('reverts instantly when the setting goes back OFF', async () => {
    await seedFixture();

    const on = await repository.getDailyOrderAggregates(filters, REPORTING_CURRENCY, true);
    const off = await repository.getDailyOrderAggregates(filters, REPORTING_CURRENCY, false);

    expect(sumNetExcluded(on)).toBe(0);
    expect(sumNetExcluded(off)).toBe(PRE_ROLLOUT_ORDER_COUNT);
  });

  it('drops the 31 from the tax-a coverage category with the setting ON', async () => {
    // With the opt-in on, these orders are inside Net Sales — reporting them as
    // `tax-a` would claim outstanding work on orders that have none.
    await seedFixture();

    const off = await taxCoverage.getCategoryCounts(filters, REPORTING_CURRENCY, false);
    const on = await taxCoverage.getCategoryCounts(filters, REPORTING_CURRENCY, true);

    expect(off['tax-a']).toBe(PRE_ROLLOUT_ORDER_COUNT);
    expect(on['tax-a']).toBe(0);
    expect(on['tax-b']).toBe(0);
    expect(on['tax-c']).toBe(0);
  });

  it('still excludes a pre-rollout order whose line has NO resolvable rate, even with the setting ON', async () => {
    // The opt-in makes the era clause vacuous; it does NOT drop the
    // rate-resolution requirement. An order the backfill could not resolve
    // stays out, because there is no rate to compute a net figure with.
    const dataSource = harness.getDataSource();
    const record = await createTestOrderRecord(dataSource, {
      internalOrderId: 'ol_order_prerollout_unresolved',
      placedAt: new Date('2026-08-03T00:00:00.000Z'),
      recordStatus: 'ready',
      totalAmount: 50,
      currency: REPORTING_CURRENCY,
      reportingCurrency: REPORTING_CURRENCY,
      reportingTotalAmount: 50,
      taxTreatment: 'inclusive',
      taxRateEra: 'pre-rollout',
    });
    const lineRepo = dataSource.getRepository(OrderLineItemOrmEntity);
    await lineRepo.save(
      lineRepo.create({
        orderRecordId: record.internalOrderId,
        lineNumber: 0,
        productId: 'ol_product_unresolved',
        variantId: null,
        quantity: 1,
        unitPrice: 50,
        sourceConnectionId: CONNECTION,
        placedAt: new Date('2026-08-03T00:00:00.000Z'),
        taxRate: null,
      })
    );

    const rows = await repository.getDailyOrderAggregates(filters, REPORTING_CURRENCY, true);

    expect(sumNetExcluded(rows)).toBe(1);
    expect(sumNetRevenue(rows)).toBe(0);
  });

  it('defaults to the pre-#2469 behaviour when the flag is omitted entirely', async () => {
    await seedFixture();

    const omitted = await repository.getDailyOrderAggregates(filters, REPORTING_CURRENCY);
    const explicitOff = await repository.getDailyOrderAggregates(
      filters,
      REPORTING_CURRENCY,
      false
    );

    expect(sumNetExcluded(omitted)).toBe(sumNetExcluded(explicitOff));
    expect(sumNetExcluded(omitted)).toBe(PRE_ROLLOUT_ORDER_COUNT);
  });
});
