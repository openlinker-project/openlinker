/**
 * Earliest Order Date Integration Test (#2083)
 *
 * Exercises the real `OrderRecordRepository.findEarliestPlacedAtByConnection`
 * — the batched `MIN(COALESCE("placedAt", "createdAt"))` `GROUP BY` query —
 * against Testcontainers Postgres. A mocked query builder can only assert
 * that the right SQL fragments were requested; this asserts the aggregate
 * actually computes the right answer over a mixed null/non-null `placedAt`
 * population and that the `pg` driver hands back a real `Date` for the raw
 * `earliest_at` alias (the repository types it `Date` on faith).
 *
 * @module apps/api/test/integration
 */
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestOrderRecord } from './fixtures/order.fixtures';
import type { OrderRecordRepositoryPort } from '@openlinker/core/orders';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '@openlinker/core/orders';

const CONNECTION_A = '11111111-1111-4111-8111-111111111111';
const CONNECTION_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONNECTION_C = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('Earliest order date by connection (integration)', () => {
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

  it('returns MIN(COALESCE(placedAt, createdAt)) per connection as a real Date', async () => {
    const ds = harness.getDataSource();
    await createTestOrderRecord(ds, {
      sourceConnectionId: CONNECTION_A,
      placedAt: new Date('2026-03-01T00:00:00Z'),
      createdAt: new Date('2026-03-02T00:00:00Z'),
    });
    // Earlier placedAt on the same connection — must win the MIN.
    await createTestOrderRecord(ds, {
      sourceConnectionId: CONNECTION_A,
      placedAt: new Date('2026-01-15T00:00:00Z'),
      createdAt: new Date('2026-01-16T00:00:00Z'),
    });
    // No placedAt asserted by the source — falls back to createdAt.
    await createTestOrderRecord(ds, {
      sourceConnectionId: CONNECTION_B,
      placedAt: null,
      createdAt: new Date('2026-02-10T00:00:00Z'),
    });

    const result = await repository.findEarliestPlacedAtByConnection([
      CONNECTION_A,
      CONNECTION_B,
      CONNECTION_C,
    ]);

    const earliestA = result.get(CONNECTION_A);
    expect(earliestA).toBeInstanceOf(Date);
    expect(earliestA?.toISOString()).toBe(new Date('2026-01-15T00:00:00Z').toISOString());

    const earliestB = result.get(CONNECTION_B);
    expect(earliestB).toBeInstanceOf(Date);
    expect(earliestB?.toISOString()).toBe(new Date('2026-02-10T00:00:00Z').toISOString());

    // No orders at all for this connection — absent, not a zeroed entry.
    expect(result.has(CONNECTION_C)).toBe(false);
  });

  it('ignores recordStatus — the coverage window is unfiltered by design', async () => {
    const ds = harness.getDataSource();
    await createTestOrderRecord(ds, {
      sourceConnectionId: CONNECTION_A,
      recordStatus: 'awaiting_mapping',
      placedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const result = await repository.findEarliestPlacedAtByConnection([CONNECTION_A]);

    expect(result.get(CONNECTION_A)?.toISOString()).toBe(
      new Date('2026-01-01T00:00:00Z').toISOString()
    );
  });

  it('returns an empty Map without querying when given no connection ids', async () => {
    const result = await repository.findEarliestPlacedAtByConnection([]);

    expect(result.size).toBe(0);
  });
});
