/**
 * Earliest Order Date Integration Test (#2083)
 *
 * Exercises the real `OrderRecordRepository.findEarliestOrderDateByConnection`
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
    // No placedAt asserted by the source — falls back to createdAt. Two rows,
    // so the fallback can be asserted by ORDERING rather than by a wall-clock
    // constant (see the note on `earliestB` below).
    await createTestOrderRecord(ds, {
      sourceConnectionId: CONNECTION_B,
      placedAt: null,
      createdAt: new Date('2026-02-10T00:00:00Z'),
    });
    await createTestOrderRecord(ds, {
      sourceConnectionId: CONNECTION_B,
      placedAt: null,
      createdAt: new Date('2026-04-20T00:00:00Z'),
    });

    const result = await repository.findEarliestOrderDateByConnection([
      CONNECTION_A,
      CONNECTION_B,
      CONNECTION_C,
    ]);

    const earliestA = result.get(CONNECTION_A);
    expect(earliestA).toBeInstanceOf(Date);
    expect(earliestA?.toISOString()).toBe(new Date('2026-01-15T00:00:00Z').toISOString());

    // The `createdAt` fallback is asserted by ORDERING against a sibling row,
    // never against a wall-clock constant, and that is deliberate. `placedAt`
    // is `timestamptz` while `createdAt` is a bare `@CreateDateColumn()` —
    // `timestamp` WITHOUT time zone on Postgres — so
    // `COALESCE("placedAt", "createdAt")` casts the naked operand using the DB
    // SESSION TimeZone, while node-postgres writes and reads that same column
    // through the CLIENT PROCESS's zone. The two agree only when the process
    // runs in UTC, which is why the original assertion passed in CI and failed
    // by exactly one hour under Europe/Warsaw (and by a whole calendar day
    // under America/Los_Angeles). Both of B's rows travel the identical cast
    // path, so their ORDER is stable in every zone while their absolute instant
    // is not — and ordering is what MIN is actually being tested for.
    // The underlying `timestamptz`/`timestamp` asymmetry predates this suite
    // (#2014's schema, read by #2083) and is reported separately.
    const [olderB, newerB] = await ds.query<{ earliest: Date }[]>(
      `SELECT COALESCE("placedAt", "createdAt") AS earliest FROM order_records
       WHERE "sourceConnectionId" = $1 ORDER BY 1 ASC`,
      [CONNECTION_B]
    );
    const earliestB = result.get(CONNECTION_B);
    expect(earliestB).toBeInstanceOf(Date);
    expect(earliestB?.getTime()).toBe(olderB.earliest.getTime());
    expect(earliestB?.getTime()).toBeLessThan(newerB.earliest.getTime());

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

    const result = await repository.findEarliestOrderDateByConnection([CONNECTION_A]);

    expect(result.get(CONNECTION_A)?.toISOString()).toBe(
      new Date('2026-01-01T00:00:00Z').toISOString()
    );
  });

  it('returns an empty Map without querying when given no connection ids', async () => {
    const result = await repository.findEarliestOrderDateByConnection([]);

    expect(result.size).toBe(0);
  });
});
