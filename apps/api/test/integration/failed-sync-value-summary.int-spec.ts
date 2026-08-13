/**
 * Failed Sync Value Summary Integration Test (#1983)
 *
 * Exercises the real `OrderRecordRepository.getFailedSyncValueSummary` — the
 * needs-attention aggregate reusing `countByHealth`'s `HAS_FAILED` /
 * `NOT_MAPPING_OR_DELETED` predicate plus the `TOTAL_EXPR` SQL fragment —
 * against Testcontainers Postgres. Mirrors `order-health-summary.int-spec.ts`'s
 * structure. Asserts the value sum, the exclusion of `awaiting_mapping` /
 * `source_deleted` records (same precedence as `countByHealth`'s
 * `needsAttention` bucket), the mixed-currency flag, and the oldest-failure
 * timestamp.
 *
 * @module apps/api/test/integration
 */
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestOrderRecord } from './fixtures/order.fixtures';
import type { OrderRecordRepositoryPort } from '@openlinker/core/orders';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '@openlinker/core/orders';

const SOURCE_A = '11111111-1111-4111-8111-111111111111';
const SOURCE_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEST = '22222222-2222-4222-8222-222222222222';

describe('Failed sync value summary (integration)', () => {
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

  it('sums the value of failed-sync orders and reports the oldest failed attempt', async () => {
    const ds = harness.getDataSource();
    // Record created well before its sync ever failed — oldestFailedAt must
    // reflect the failed attempt's own timestamp, not this creation time.
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      orderSnapshot: { items: [], totals: { total: 100, currency: 'PLN' } },
      syncStatus: [{ destinationConnectionId: DEST, status: 'failed', error: 'x' }],
      syncAttempts: [
        {
          destinationConnectionId: DEST,
          status: 'failed',
          attemptedAt: new Date('2026-03-01T00:00:00Z').toISOString(),
          error: 'x',
        },
      ],
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      orderSnapshot: { items: [], totals: { total: 250.5, currency: 'PLN' } },
      syncStatus: [{ destinationConnectionId: DEST, status: 'failed', error: 'x' }],
      syncAttempts: [
        {
          destinationConnectionId: DEST,
          status: 'failed',
          attemptedAt: new Date('2026-02-01T00:00:00Z').toISOString(),
          error: 'x',
        },
      ],
      createdAt: new Date('2026-02-01T00:00:00Z'),
    });
    // Ready + synced — not stuck, must not contribute to the sum.
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      orderSnapshot: { items: [], totals: { total: 9999, currency: 'PLN' } },
      syncStatus: [{ destinationConnectionId: DEST, status: 'synced' }],
    });

    const summary = await repository.getFailedSyncValueSummary({});

    expect(summary.count).toBe(2);
    expect(summary.totalValue).toBeCloseTo(350.5);
    expect(summary.mixedCurrency).toBe(false);
    expect(summary.oldestFailedAt?.toISOString()).toBe(new Date('2026-02-01T00:00:00Z').toISOString());
  });

  it('excludes awaiting_mapping and source_deleted records, matching countByHealth precedence (#1689)', async () => {
    const ds = harness.getDataSource();
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'awaiting_mapping',
      orderSnapshot: { items: [], totals: { total: 100, currency: 'PLN' } },
      syncStatus: [{ destinationConnectionId: DEST, status: 'failed', error: 'x' }],
    });
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'source_deleted',
      orderSnapshot: { items: [], totals: { total: 200, currency: 'PLN' } },
      syncStatus: [{ destinationConnectionId: DEST, status: 'failed', error: 'x' }],
    });
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      orderSnapshot: { items: [], totals: { total: 50, currency: 'PLN' } },
      syncStatus: [{ destinationConnectionId: DEST, status: 'failed', error: 'x' }],
    });

    const summary = await repository.getFailedSyncValueSummary({});

    expect(summary.count).toBe(1);
    expect(summary.totalValue).toBeCloseTo(50);
  });

  it('flags mixedCurrency when failed orders span more than one currency', async () => {
    const ds = harness.getDataSource();
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      orderSnapshot: { items: [], totals: { total: 100, currency: 'PLN' } },
      syncStatus: [{ destinationConnectionId: DEST, status: 'failed', error: 'x' }],
    });
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      orderSnapshot: { items: [], totals: { total: 20, currency: 'EUR' } },
      syncStatus: [{ destinationConnectionId: DEST, status: 'failed', error: 'x' }],
    });

    const summary = await repository.getFailedSyncValueSummary({});

    expect(summary.mixedCurrency).toBe(true);
  });

  it('returns a zeroed summary and null oldestFailedAt when nothing is stuck', async () => {
    const summary = await repository.getFailedSyncValueSummary({});

    expect(summary).toEqual({
      count: 0,
      totalValue: 0,
      mixedCurrency: false,
      oldestFailedAt: null,
    });
  });

  it('scopes the sum to a single source connection', async () => {
    const ds = harness.getDataSource();
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      orderSnapshot: { items: [], totals: { total: 100, currency: 'PLN' } },
      syncStatus: [{ destinationConnectionId: DEST, status: 'failed', error: 'x' }],
    });
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_B,
      recordStatus: 'ready',
      orderSnapshot: { items: [], totals: { total: 500, currency: 'PLN' } },
      syncStatus: [{ destinationConnectionId: DEST, status: 'failed', error: 'x' }],
    });

    const all = await repository.getFailedSyncValueSummary({});
    expect(all.count).toBe(2);
    expect(all.totalValue).toBeCloseTo(600);

    const scoped = await repository.getFailedSyncValueSummary({ sourceConnectionId: SOURCE_A });
    expect(scoped.count).toBe(1);
    expect(scoped.totalValue).toBeCloseTo(100);
  });
});
