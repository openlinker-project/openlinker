/**
 * Order Dispatch-SLA Integration Test (#927)
 *
 * Exercises the real `OrderRecordRepository` against Testcontainers Postgres for
 * the ship-by deadline column: the `dispatchBy` sort (ascending, NULLs last),
 * the `dueBefore` "breaching / overdue" filter, and recompute-on-re-pull (an
 * upsert with a changed deadline updates the indexed column — the #904/#906/#909
 * reconcile path stays fresh).
 *
 * @module apps/api/test/integration
 */
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { createTestOrderRecord } from './fixtures/order.fixtures';
import {
  ORDER_RECORD_REPOSITORY_TOKEN,
  OrderRecord,
  OrderRecordRepositoryPort,
} from '@openlinker/core/orders';

const SOURCE = '11111111-1111-4111-8111-111111111111';
const PAGE = { limit: 50, offset: 0 };

describe('Order dispatch SLA (integration)', () => {
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

  it('sorts by dispatchBy ascending with NULL deadlines last', async () => {
    const ds = harness.getDataSource();
    const late = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      dispatchByAt: new Date('2026-06-03T12:00:00Z'),
    });
    const noDeadline = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      dispatchByAt: null,
    });
    const soon = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      dispatchByAt: new Date('2026-06-01T12:00:00Z'),
    });

    const { items } = await repository.findMany({ sort: 'dispatchBy' }, PAGE);

    expect(items.map((o) => o.internalOrderId)).toEqual([
      soon.internalOrderId, // earliest deadline first
      late.internalOrderId,
      noDeadline.internalOrderId, // NULLs last
    ]);
  });

  it('filters by dueBefore — only known deadlines at or before the cutoff', async () => {
    const ds = harness.getDataSource();
    const overdue = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      dispatchByAt: new Date('2026-06-01T08:00:00Z'),
    });
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      dispatchByAt: new Date('2026-06-05T08:00:00Z'), // after cutoff — excluded
    });
    await createTestOrderRecord(ds, { sourceConnectionId: SOURCE, dispatchByAt: null }); // excluded

    const { items, total } = await repository.findMany(
      { dueBefore: new Date('2026-06-02T00:00:00Z') },
      PAGE
    );

    expect(total).toBe(1);
    expect(items[0].internalOrderId).toBe(overdue.internalOrderId);
  });

  it('updates dispatchByAt on re-pull (upsert with a changed deadline)', async () => {
    const seeded = await createTestOrderRecord(harness.getDataSource(), {
      sourceConnectionId: SOURCE,
      dispatchByAt: new Date('2026-06-01T12:00:00Z'),
    });

    // Re-pull: same PK, new deadline (the source moved the dispatch window).
    const rePulled = new OrderRecord(
      seeded.internalOrderId,
      null,
      SOURCE,
      null,
      { dispatchTime: { to: '2026-06-02T18:00:00Z' } },
      [],
      'ready',
      new Date(),
      new Date(),
      [],
      new Date('2026-06-02T18:00:00Z')
    );
    await repository.upsert(rePulled);

    const found = await repository.findById(seeded.internalOrderId);
    expect(found?.dispatchByAt?.toISOString()).toBe('2026-06-02T18:00:00.000Z');
  });
});
