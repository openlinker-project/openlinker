/**
 * Observed source payment methods - integration test (#3774)
 *
 * Exercises the real `listObservedSourcePaymentMethods` (service -> repository)
 * (jsonb extraction + case-folding GROUP BY) against Testcontainers Postgres.
 * Proven at a handful of rows per case; the query is bounded by the
 * `sourceConnectionId` index and the placement window, so it scans one
 * connection's rows, never the table.
 *
 * @module apps/api/test/integration/orders
 */
import type { IntegrationTestHarness } from '../setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import { createTestOrderRecord } from '../fixtures/order.fixtures';
import type { IOrderRecordService } from '@openlinker/core/orders';
import { ORDER_RECORD_SERVICE_TOKEN } from '@openlinker/core/orders';

const CONNECTION_A = '11111111-1111-4111-8111-111111111111';
const CONNECTION_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SINCE = new Date('2026-06-01T00:00:00Z');
const INSIDE = new Date('2026-07-01T00:00:00Z');
const OUTSIDE = new Date('2026-01-01T00:00:00Z');

describe('Observed source payment methods (integration)', () => {
  let harness: IntegrationTestHarness;
  let repository: IOrderRecordService;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness.getApp().get<IOrderRecordService>(ORDER_RECORD_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const seed = async (
    connectionId: string,
    sourcePaymentMethod: string | undefined,
    placedAt: Date = INSIDE
  ): Promise<void> => {
    await createTestOrderRecord(harness.getDataSource(), {
      sourceConnectionId: connectionId,
      placedAt,
      orderSnapshot: {
        items: [],
        ...(sourcePaymentMethod !== undefined && { sourcePaymentMethod }),
      },
    });
  };

  it('should group case and whitespace variants into one normalised row', async () => {
    await seed(CONNECTION_A, 'PayU');
    await seed(CONNECTION_A, 'payu');
    await seed(CONNECTION_A, '  PAYU ');

    const rows = await repository.listObservedSourcePaymentMethods(CONNECTION_A, SINCE, 100);

    expect(rows).toHaveLength(1);
    expect(rows[0].sourcePaymentMethod).toBe('payu');
    expect(rows[0].orderCount).toBe(3);
    expect(rows[0].lastSeenAt).toBeInstanceOf(Date);
  });

  it('should exclude orders outside the window, without the key, blank, or on another connection', async () => {
    await seed(CONNECTION_A, 'inside');
    await seed(CONNECTION_A, 'outside', OUTSIDE);
    await seed(CONNECTION_A, undefined);
    await seed(CONNECTION_A, '   ');
    await seed(CONNECTION_B, 'other-connection');

    const rows = await repository.listObservedSourcePaymentMethods(CONNECTION_A, SINCE, 100);

    expect(rows.map((r) => r.sourcePaymentMethod)).toEqual(['inside']);
  });

  it('should order by count descending (ties by identifier) and honour the cap', async () => {
    await seed(CONNECTION_A, 'rare');
    await seed(CONNECTION_A, 'common');
    await seed(CONNECTION_A, 'common');
    await seed(CONNECTION_A, 'alpha');

    const all = await repository.listObservedSourcePaymentMethods(CONNECTION_A, SINCE, 100);
    expect(all.map((r) => [r.sourcePaymentMethod, r.orderCount])).toEqual([
      ['common', 2],
      ['alpha', 1],
      ['rare', 1],
    ]);

    const capped = await repository.listObservedSourcePaymentMethods(CONNECTION_A, SINCE, 2);
    expect(capped.map((r) => r.sourcePaymentMethod)).toEqual(['common', 'alpha']);
  });
});
