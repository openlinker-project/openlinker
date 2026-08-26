/**
 * Tax Coverage — Net-Excluded Candidates Int-Spec (#2465)
 *
 * Exercises `OrderRecordRepository.findNetExcludedOrderCandidates` against
 * real Testcontainers Postgres. The unit specs mock the query builder, so
 * the `netSalesOrderNetEligibleSql` `EXISTS`/`FILTER (WHERE ...)` SQL never
 * actually runs against a server there — this proves two things no mocked
 * spec can:
 *
 * 1. `candidates.length` is EXACTLY `getDailyOrderAggregates`'
 *    `netExcludedCount` summed over the same filters/currency (the #2465
 *    regression guard) — the two reads share the same predicate fragment
 *    by construction, but only a real query proves they stay in sync.
 * 2. A pre-rollout order with an unresolved line (no rate, catalogue never
 *    checked) is correctly reported as a candidate carrying `taxRateEra:
 *    'pre-rollout'` — the live-demo defect this detector exists to surface.
 *
 * @module apps/api/test/integration/orders
 */
import {
  ORDER_RECORD_REPOSITORY_TOKEN,
  type OrderRecordRepositoryPort,
} from '@openlinker/core/orders';
import { OrderLineItemOrmEntity } from '@openlinker/core/orders/orm-entities';
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  type IntegrationTestHarness,
} from '../setup';
import { createTestOrderRecord } from '../fixtures/order.fixtures';

describe('Tax coverage — net-excluded candidates against real Postgres (#2465)', () => {
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

  const filters = {
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-08-08T00:00:00.000Z'),
  };

  async function seedLineItem(overrides: Partial<OrderLineItemOrmEntity>): Promise<void> {
    const repo = harness.getDataSource().getRepository(OrderLineItemOrmEntity);
    await repo.save(
      repo.create({
        orderRecordId: 'ol_order_placeholder',
        lineNumber: 0,
        productId: 'ol_product_placeholder',
        variantId: null,
        quantity: 1,
        unitPrice: 100,
        sourceConnectionId: '11111111-1111-4111-8111-111111111111',
        placedAt: new Date('2026-08-02T00:00:00.000Z'),
        taxRate: null,
        ...overrides,
      })
    );
  }

  it(
    'reports the SAME count as getDailyOrderAggregates.netExcludedCount for a mix of eligible, ' +
      'pre-rollout, and unresolved-rate orders (regression guard)',
    async () => {
      const dataSource = harness.getDataSource();

      // Net-eligible: exclusive pricing, no rate needed.
      const eligible = await createTestOrderRecord(dataSource, {
        placedAt: new Date('2026-08-02T00:00:00.000Z'),
        totalAmount: 100,
        currency: 'EUR',
        reportingCurrency: 'EUR',
        reportingTotalAmount: 100,
        recordStatus: 'ready',
        taxTreatment: 'exclusive',
        taxRateEra: null,
      });
      await seedLineItem({
        orderRecordId: eligible.internalOrderId,
        unitPrice: 100,
      });

      // Excluded: pre-rollout era (blanket exclusion regardless of line state).
      const preRollout = await createTestOrderRecord(dataSource, {
        placedAt: new Date('2026-08-03T00:00:00.000Z'),
        totalAmount: 50,
        currency: 'EUR',
        reportingCurrency: 'EUR',
        reportingTotalAmount: 50,
        recordStatus: 'ready',
        taxTreatment: 'inclusive',
        taxRateEra: 'pre-rollout',
      });
      await seedLineItem({
        orderRecordId: preRollout.internalOrderId,
        unitPrice: 50,
        taxRate: null,
      });

      // Excluded: post-rollout order with a genuinely unresolved line rate.
      const unresolved = await createTestOrderRecord(dataSource, {
        placedAt: new Date('2026-08-04T00:00:00.000Z'),
        totalAmount: 75,
        currency: 'EUR',
        reportingCurrency: 'EUR',
        reportingTotalAmount: 75,
        recordStatus: 'ready',
        taxTreatment: 'inclusive',
        taxRateEra: null,
      });
      await seedLineItem({
        orderRecordId: unresolved.internalOrderId,
        unitPrice: 75,
        taxRate: null,
      });

      const [aggregateRows, candidates] = await Promise.all([
        repository.getDailyOrderAggregates(filters, 'EUR'),
        repository.findNetExcludedOrderCandidates(filters, 'EUR'),
      ]);

      const netExcludedCount = aggregateRows.reduce((sum, row) => sum + row.netExcludedCount, 0);

      expect(netExcludedCount).toBe(2);
      expect(candidates).toHaveLength(netExcludedCount);

      const candidateIds = candidates.map((c) => c.internalOrderId).sort();
      expect(candidateIds).toEqual(
        [preRollout.internalOrderId, unresolved.internalOrderId].sort()
      );

      const preRolloutCandidate = candidates.find(
        (c) => c.internalOrderId === preRollout.internalOrderId
      );
      expect(preRolloutCandidate?.taxRateEra).toBe('pre-rollout');

      const unresolvedCandidate = candidates.find(
        (c) => c.internalOrderId === unresolved.internalOrderId
      );
      expect(unresolvedCandidate?.taxRateEra).toBeNull();
    }
  );

  it('excludes cancelled orders and orders stamped in a prior reporting-currency era', async () => {
    const dataSource = harness.getDataSource();

    const cancelled = await createTestOrderRecord(dataSource, {
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
      totalAmount: 10,
      currency: 'EUR',
      reportingCurrency: 'EUR',
      reportingTotalAmount: 10,
      recordStatus: 'ready',
      taxTreatment: 'inclusive',
      taxRateEra: 'pre-rollout',
      cancelledAt: new Date('2026-08-02T01:00:00.000Z'),
    });
    await seedLineItem({ orderRecordId: cancelled.internalOrderId, unitPrice: 10, taxRate: null });

    const priorEra = await createTestOrderRecord(dataSource, {
      placedAt: new Date('2026-08-02T00:00:00.000Z'),
      totalAmount: 10,
      currency: 'EUR',
      // Stamped under a DIFFERENT reporting-currency era than what this
      // read is asked about below.
      reportingCurrency: 'PLN',
      reportingTotalAmount: 40,
      recordStatus: 'ready',
      taxTreatment: 'inclusive',
      taxRateEra: 'pre-rollout',
    });
    await seedLineItem({ orderRecordId: priorEra.internalOrderId, unitPrice: 10, taxRate: null });

    const candidates = await repository.findNetExcludedOrderCandidates(filters, 'EUR');

    expect(candidates.map((c) => c.internalOrderId)).not.toContain(cancelled.internalOrderId);
    expect(candidates.map((c) => c.internalOrderId)).not.toContain(priorEra.internalOrderId);
  });
});
