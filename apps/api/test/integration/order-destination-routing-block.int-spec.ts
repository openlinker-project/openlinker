/**
 * Order destination-routing block Integration Test (#2703 / #2704)
 *
 * Exercises the real `updateDestinationRoutingBlock` raw-SQL UPDATE and the
 * `destinationRoutingBlocked` filter / count against Testcontainers Postgres —
 * the only reliable cover for the `IN (...)` / `COALESCE ... NOT IN (...)` pair,
 * where the negation form returning ZERO rows on an unblocked install is
 * invisible to a mocked repository.
 *
 * @module apps/api/test/integration
 */
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestOrderRecord } from './fixtures/order.fixtures';
import type { OrderRecordRepositoryPort } from '@openlinker/core/orders';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '@openlinker/core/orders';

const SOURCE = '11111111-1111-4111-8111-111111111111';

describe('Order destination-routing block (integration)', () => {
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

  async function seed(): Promise<{ plain: string; unavailable: string; decision: string }> {
    const ds = harness.getDataSource();
    const plain = await createTestOrderRecord(ds, { sourceConnectionId: SOURCE });
    const unavailable = await createTestOrderRecord(ds, { sourceConnectionId: SOURCE });
    const decision = await createTestOrderRecord(ds, { sourceConnectionId: SOURCE });
    await repository.updateDestinationRoutingBlock(unavailable.internalOrderId, {
      reason: 'routed-destinations-unavailable',
      detail: '1 unresolved destination(s): conn-a',
    });
    await repository.updateDestinationRoutingBlock(decision.internalOrderId, {
      reason: 'routed-to-no-destination',
      detail: null,
    });
    return {
      plain: plain.internalOrderId,
      unavailable: unavailable.internalOrderId,
      decision: decision.internalOrderId,
    };
  }

  const ids = async (blocked: boolean): Promise<string[]> => {
    const page = await repository.findMany(
      { destinationRoutingBlocked: blocked },
      { limit: 50, offset: 0 }
    );
    return page.items.map((record) => record.internalOrderId).sort();
  };

  it('should return only attention-worthy reasons when destinationRoutingBlocked is true', async () => {
    const { unavailable } = await seed();

    expect(await ids(true)).toEqual([unavailable]);
    expect(await repository.countMany({ destinationRoutingBlocked: true })).toBe(1);
  });

  it('should return every unblocked order when destinationRoutingBlocked is false', async () => {
    const { plain, decision } = await seed();

    // The NULL-reason order must be INCLUDED: `NOT (NULL IN (...))` is NULL.
    expect(await ids(false)).toEqual([plain, decision].sort());
  });

  it('should return all orders when nothing is blocked and the filter is false', async () => {
    const ds = harness.getDataSource();
    const a = await createTestOrderRecord(ds, { sourceConnectionId: SOURCE });

    expect(await ids(false)).toEqual([a.internalOrderId]);
    expect(await ids(true)).toEqual([]);
  });

  it('should count the blocked orders in the health summary without counting the decision reason', async () => {
    await seed();

    const summary = await repository.countByHealth({});

    expect(summary.destinationRoutingBlocked).toBe(1);
  });

  it('should clear the reason and detail when the block is written as null', async () => {
    const { unavailable } = await seed();

    await repository.updateDestinationRoutingBlock(unavailable, null);

    expect(await ids(true)).toEqual([]);
  });

  it('should leave updatedAt untouched when the written block is unchanged', async () => {
    const { unavailable } = await seed();
    const ds = harness.getDataSource();
    const read = async (): Promise<Date> => {
      const rows = await ds.query(
        `SELECT "updatedAt" FROM "order_records" WHERE "internalOrderId" = $1`,
        [unavailable]
      );
      return rows[0].updatedAt as Date;
    };
    const before = await read();

    await repository.updateDestinationRoutingBlock(unavailable, {
      reason: 'routed-destinations-unavailable',
      detail: '1 unresolved destination(s): conn-a',
    });

    expect((await read()).getTime()).toBe(before.getTime());
  });
});
