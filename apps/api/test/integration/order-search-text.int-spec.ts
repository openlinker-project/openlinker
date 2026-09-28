/**
 * Order search text — trigram search integration test (#3527/#3528)
 *
 * Exercises the REAL `order_records.searchText` GIN trigram index end to
 * end: a unit spec can prove `deriveOrderSearchText`'s normalization is
 * correct, but only a real Postgres proves the `LIKE '%…%'` predicate the
 * repository builds actually matches through the index, including the
 * diacritic-folding trap `normalizeOrderSearchText`'s own docblock names
 * (`Artykuły` → `artykuly`, not decomposed by plain NFD).
 *
 * The tracking-number OR path (#3528) is asserted at the `searchTrackingOrderIds`
 * filter arm the interface layer adds — `OrderRecordRepository` itself does
 * not resolve tracking numbers (that cross-context read lives in
 * `orders.controller.ts`'s `enrichCrossContextFilters`), so this test feeds
 * the repository the id list directly, as that caller would.
 *
 * @module apps/api/test/integration
 */
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { OrderRecord } from '@openlinker/core/orders';
import type { OrderRecordRepositoryPort } from '@openlinker/core/orders';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '@openlinker/core/orders';

const SOURCE_CONNECTION = '22222222-2222-4222-8222-222222222222';

describe('order search text — trigram search (integration, #3527/#3528)', () => {
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

  function makeOrder(internalOrderId: string, snapshot: Record<string, unknown>): OrderRecord {
    return new OrderRecord(
      internalOrderId,
      null,
      SOURCE_CONNECTION,
      null,
      snapshot,
      [],
      'ready',
      new Date('2026-05-01T10:00:00Z'),
      new Date('2026-05-01T10:00:00Z'),
    );
  }

  it('finds an order by a diacritic-folded query against a diacritic snapshot (the Artykuły/ł trap)', async () => {
    await repository.upsert(
      makeOrder('ol_order_pl_1', {
        orderNumber: 'PL-1001',
        customerEmail: 'michal@example.pl',
        billingAddress: { firstName: 'Michał', lastName: 'Kowalski' },
        items: [{ sku: 'ART-KUCHNIA-01' }],
      }),
    );

    const byPolishName = await repository.findMany(
      { search: 'michal' },
      { limit: 20, offset: 0 },
    );
    expect(byPolishName.items.map((o) => o.internalOrderId)).toContain('ol_order_pl_1');

    const bySku = await repository.findMany(
      { search: 'art-kuchnia' },
      { limit: 20, offset: 0 },
    );
    expect(bySku.items.map((o) => o.internalOrderId)).toContain('ol_order_pl_1');
  });

  it('does not match an unrelated order', async () => {
    await repository.upsert(
      makeOrder('ol_order_pl_2', {
        orderNumber: 'PL-2002',
        customerEmail: 'ewa@example.pl',
        items: [],
      }),
    );

    const result = await repository.findMany(
      { search: 'zzz-no-such-token' },
      { limit: 20, offset: 0 },
    );
    expect(result.items.map((o) => o.internalOrderId)).not.toContain('ol_order_pl_2');
  });

  it('widens the search to the tracking-number OR ids the caller resolved (#3528)', async () => {
    await repository.upsert(makeOrder('ol_order_tracking_1', { orderNumber: 'NO-TEXT-MATCH' }));

    // The caller (orders.controller.ts) resolved a tracking number to this
    // order id BEFORE calling the repository — the repository's job is only
    // to OR it into the predicate.
    const result = await repository.findMany(
      { search: 'no-such-text-token', searchTrackingOrderIds: ['ol_order_tracking_1'] },
      { limit: 20, offset: 0 },
    );
    expect(result.items.map((o) => o.internalOrderId)).toContain('ol_order_tracking_1');
  });
});
