/**
 * Order Column-Sort Integration Test (#944)
 *
 * Exercises the real `OrderRecordRepository.findMany` against Testcontainers
 * Postgres for the server-side sortable columns: `total` / `items` / `customer`
 * (JSONB-derived from `orderSnapshot`) and `status` (the health ordinal),
 * including the `dir` direction override. Mirrors the dispatch-SLA spec's
 * harness + seed-then-assert-order pattern.
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
  OrderRecordRepositoryPort,
} from '@openlinker/core/orders';

const SOURCE = '11111111-1111-4111-8111-111111111111';
const PAGE = { limit: 50, offset: 0 };

describe('Order column sort (integration)', () => {
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

  it('sorts by total descending (default direction), NULLs last', async () => {
    const ds = harness.getDataSource();
    const cheap = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      orderSnapshot: { items: [], totals: { total: 10.5, currency: 'PLN' } },
    });
    const pricey = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      orderSnapshot: { items: [], totals: { total: 199.99, currency: 'PLN' } },
    });
    const noTotal = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      orderSnapshot: { items: [] },
    });

    const { items } = await repository.findMany({ sort: 'total', dir: 'desc' }, PAGE);

    expect(items.map((o) => o.internalOrderId)).toEqual([
      pricey.internalOrderId,
      cheap.internalOrderId,
      noTotal.internalOrderId, // NULLs last
    ]);
  });

  it('sorts by total ascending when dir=asc', async () => {
    const ds = harness.getDataSource();
    const cheap = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      orderSnapshot: { items: [], totals: { total: 10.5, currency: 'PLN' } },
    });
    const pricey = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      orderSnapshot: { items: [], totals: { total: 199.99, currency: 'PLN' } },
    });

    const { items } = await repository.findMany({ sort: 'total', dir: 'asc' }, PAGE);

    expect(items.map((o) => o.internalOrderId)).toEqual([
      cheap.internalOrderId,
      pricey.internalOrderId,
    ]);
  });

  it('sorts by item count descending', async () => {
    const ds = harness.getDataSource();
    const one = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      orderSnapshot: { items: [{ id: 'a', quantity: 1, price: 1 }] },
    });
    const three = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      orderSnapshot: {
        items: [
          { id: 'a', quantity: 1, price: 1 },
          { id: 'b', quantity: 1, price: 1 },
          { id: 'c', quantity: 1, price: 1 },
        ],
      },
    });

    const { items } = await repository.findMany({ sort: 'items', dir: 'desc' }, PAGE);

    expect(items.map((o) => o.internalOrderId)).toEqual([
      three.internalOrderId,
      one.internalOrderId,
    ]);
  });

  it('sorts by customer last name ascending (case-insensitive), NULLs last', async () => {
    const ds = harness.getDataSource();
    const nowak = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      orderSnapshot: { items: [], shippingAddress: { lastName: 'nowak' } },
    });
    const kowalski = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      orderSnapshot: { items: [], shippingAddress: { lastName: 'Kowalski' } },
    });
    const noName = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      orderSnapshot: { items: [] },
    });

    const { items } = await repository.findMany({ sort: 'customer', dir: 'asc' }, PAGE);

    expect(items.map((o) => o.internalOrderId)).toEqual([
      kowalski.internalOrderId, // 'kowalski' < 'nowak' (lowercased)
      nowak.internalOrderId,
      noName.internalOrderId, // NULLs last
    ]);
  });

  it('sorts by status ascending using the triage-urgency ordinal (needs_attention first)', async () => {
    const ds = harness.getDataSource();
    const synced = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      recordStatus: 'ready',
      syncStatus: [{ destinationConnectionId: SOURCE, status: 'synced' }],
    });
    const needsAttention = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      recordStatus: 'ready',
      syncStatus: [{ destinationConnectionId: SOURCE, status: 'failed' }],
    });
    const awaitingMapping = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      recordStatus: 'awaiting_mapping',
      syncStatus: [],
    });
    const awaitingDispatch = await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE,
      recordStatus: 'ready',
      syncStatus: [{ destinationConnectionId: SOURCE, status: 'pending' }],
    });

    const { items } = await repository.findMany({ sort: 'status', dir: 'asc' }, PAGE);

    expect(items.map((o) => o.internalOrderId)).toEqual([
      needsAttention.internalOrderId, // 0
      awaitingMapping.internalOrderId, // 1
      awaitingDispatch.internalOrderId, // 2
      synced.internalOrderId, // 3
    ]);
  });
});
