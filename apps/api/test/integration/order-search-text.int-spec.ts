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
 * #3507 adds the two write-path defects a unit spec cannot see end to end:
 * the upsert never writing `searchText` (G03-1), and the PII mode not being
 * applied to the index or to rows stored before the flag was turned off
 * (G03-14, via `IOrderSearchTextReindexService`).
 *
 * @module apps/api/test/integration
 */
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { OrderRecord } from '@openlinker/core/orders';
import type {
  IOrderSearchTextReindexService,
  OrderRecordRepositoryPort,
} from '@openlinker/core/orders';
import {
  ORDER_RECORD_REPOSITORY_TOKEN,
  ORDER_SEARCH_TEXT_REINDEX_SERVICE_TOKEN,
} from '@openlinker/core/orders';

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

  /**
   * #3507 G03-1 — the frozen-attribution upsert enumerates its columns, and
   * `searchText` was not one of them: a re-ingested order kept the text its
   * FIRST write produced. Asserted on both write paths, since the column is
   * part of the shared half of the statement.
   */
  it('refreshes the search text on re-ingestion through upsert, so the previous buyer no longer matches', async () => {
    await repository.upsert(
      makeOrder('ol_order_reingest_1', {
        orderNumber: 'PL-3001',
        billingAddress: { firstName: 'Zofia', lastName: 'Wójcik' },
        items: [],
      }),
    );
    await repository.upsert(
      makeOrder('ol_order_reingest_1', {
        orderNumber: 'PL-3001',
        billingAddress: { firstName: 'Tomasz', lastName: 'Zieliński' },
        items: [],
      }),
    );

    const byNewBuyer = await repository.findMany({ search: 'zielinski' }, { limit: 20, offset: 0 });
    expect(byNewBuyer.items.map((o) => o.internalOrderId)).toContain('ol_order_reingest_1');

    const byOldBuyer = await repository.findMany({ search: 'wojcik' }, { limit: 20, offset: 0 });
    expect(byOldBuyer.items.map((o) => o.internalOrderId)).not.toContain('ol_order_reingest_1');
  });

  it('writes the search text on the ready path (upsertWithLineItems) too', async () => {
    await repository.upsertWithLineItems(
      makeOrder('ol_order_ready_1', {
        orderNumber: 'PL-4001',
        billingAddress: { firstName: 'Łucja', lastName: 'Mazur' },
        items: [{ sku: 'READY-SKU-1' }],
      }),
      [],
    );

    const byName = await repository.findMany({ search: 'lucja' }, { limit: 20, offset: 0 });
    expect(byName.items.map((o) => o.internalOrderId)).toContain('ol_order_ready_1');
  });

  /**
   * #3507 G03-14 — a row written while PII storage was on keeps the buyer's
   * name in its search text after the flag is turned off; the reindex pass is
   * what takes it out, and a new write under the flag never puts it in.
   */
  describe('with OL_STORE_PII=false', () => {
    const originalStorePii = process.env.OL_STORE_PII;

    afterEach(() => {
      if (originalStorePii === undefined) {
        delete process.env.OL_STORE_PII;
      } else {
        process.env.OL_STORE_PII = originalStorePii;
      }
    });

    it('drops the buyer surname from a row stored with PII on once the reindex pass runs, keeping the order number', async () => {
      process.env.OL_STORE_PII = 'true';
      await repository.upsert(
        makeOrder('ol_order_pii_1', {
          orderNumber: 'PL-5001',
          customerEmail: 'grazyna@example.pl',
          billingAddress: { firstName: 'Grażyna', lastName: 'Kamińska' },
          items: [{ sku: 'PII-SKU-1' }],
        }),
      );
      const beforeFlip = await repository.findMany({ search: 'kaminska' }, { limit: 20, offset: 0 });
      expect(beforeFlip.items.map((o) => o.internalOrderId)).toContain('ol_order_pii_1');

      process.env.OL_STORE_PII = 'false';
      const reindex = harness
        .getApp()
        .get<IOrderSearchTextReindexService>(ORDER_SEARCH_TEXT_REINDEX_SERVICE_TOKEN);
      const result = await reindex.runOnce(null);
      expect(result).toMatchObject({ status: 'completed', budgetExhausted: false, nextCursor: null });

      const bySurname = await repository.findMany({ search: 'kaminska' }, { limit: 20, offset: 0 });
      expect(bySurname.items).toHaveLength(0);
      const byEmail = await repository.findMany({ search: 'grazyna@' }, { limit: 20, offset: 0 });
      expect(byEmail.items).toHaveLength(0);
      const byNumber = await repository.findMany({ search: 'pl-5001' }, { limit: 20, offset: 0 });
      expect(byNumber.items.map((o) => o.internalOrderId)).toEqual(['ol_order_pii_1']);

      // Idempotent: a second pass over the now-clean table rewrites nothing.
      await expect(reindex.runOnce(null)).resolves.toMatchObject({ rewritten: 0 });
    });

    it('never indexes the buyer name on a write made while PII is not stored', async () => {
      process.env.OL_STORE_PII = 'false';
      await repository.upsert(
        makeOrder('ol_order_pii_2', {
          orderNumber: 'PL-5002',
          billingAddress: { firstName: 'Bożena', lastName: 'Lewandowska' },
          items: [],
        }),
      );

      const bySurname = await repository.findMany({ search: 'lewandowska' }, { limit: 20, offset: 0 });
      expect(bySurname.items).toHaveLength(0);
      const byNumber = await repository.findMany({ search: 'pl-5002' }, { limit: 20, offset: 0 });
      expect(byNumber.items.map((o) => o.internalOrderId)).toEqual(['ol_order_pii_2']);
    });
  });
});
