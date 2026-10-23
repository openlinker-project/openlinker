/**
 * Invoice Record Keyset List Integration Test (#3306)
 *
 * Proves `InvoiceRecordRepository.findManyKeyset` against REAL Postgres,
 * specifically the property a pure-function test cannot: that paging with a
 * `(createdAt, id)` keyset cursor does not skip or duplicate a row when a new
 * row is inserted BETWEEN two page fetches — the exact failure mode plain
 * `OFFSET` pagination has under concurrent inserts, which is why the merged
 * `/sales-documents` list (#3306) uses this instead.
 *
 * The fiscal-registration side shares the byte-identical keyset SQL shape
 * (same `date_trunc('milliseconds', ...)` comparison, same DESC walk) and is
 * covered by its own unit tests plus the pure `mergeSalesDocumentPages` spec;
 * this file is the one Testcontainers proof of the underlying mechanism.
 *
 * @module apps/api/test/integration/invoicing
 */
import { InvoiceRecordOrmEntity } from '@openlinker/core/invoicing/orm-entities';
import { InvoiceRecordRepository } from '@openlinker/core/invoicing/infrastructure/persistence/repositories/invoice-record.repository';
import type { Repository } from 'typeorm';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from '../setup';

const CONNECTION_ID = '00000000-0000-0000-0000-000000003306';

function row(
  orderId: string,
  createdAt: Date,
  overrides: Partial<InvoiceRecordOrmEntity> = {},
): InvoiceRecordOrmEntity {
  const entity = new InvoiceRecordOrmEntity();
  Object.assign(
    entity,
    {
      connectionId: CONNECTION_ID,
      orderId,
      providerType: 'subiekt-gt',
      documentType: 'invoice',
      status: 'issued',
      idempotencyKey: null,
      createdAt,
    },
    overrides,
  );
  return entity;
}

describe('InvoiceRecordRepository.findManyKeyset (integration, #3306)', () => {
  let harness: IntegrationTestHarness;
  let ormRepo: Repository<InvoiceRecordOrmEntity>;
  let repo: InvoiceRecordRepository;

  beforeAll(async () => {
    harness = await getTestHarness();
    ormRepo = harness.getDataSource().getRepository(InvoiceRecordOrmEntity);
    repo = new InvoiceRecordRepository(ormRepo);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('walks the whole set across several small pages with no gap and no duplicate', async () => {
    const base = new Date('2026-01-01T00:00:00.000Z');
    const rows = [0, 1, 2, 3, 4].map((i) =>
      row(`ol_order_walk_${i}`, new Date(base.getTime() + i * 60_000)),
    );
    await ormRepo.save(rows);

    const seen: string[] = [];
    let cursor: { createdAt: Date; id: string } | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await repo.findManyKeyset({ connectionId: CONNECTION_ID }, { limit: 2, cursor });
      seen.push(...page.items.map((item) => item.orderId));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }

    // Newest-first, all five, no repeats.
    expect(seen).toEqual([
      'ol_order_walk_4',
      'ol_order_walk_3',
      'ol_order_walk_2',
      'ol_order_walk_1',
      'ol_order_walk_0',
    ]);
  });

  it('does not skip a row inserted between two page fetches, even when it lands strictly before the cursor', async () => {
    const base = new Date('2026-02-01T00:00:00.000Z');
    // Three rows spanning a 3-minute window; the walk will pause between them.
    await ormRepo.save([
      row('ol_order_a', new Date(base.getTime())),
      row('ol_order_c', new Date(base.getTime() + 2 * 60_000)),
    ]);

    // Page 1: only 'c' exists in the newer half.
    const page1 = await repo.findManyKeyset({ connectionId: CONNECTION_ID }, { limit: 1 });
    expect(page1.items.map((i) => i.orderId)).toEqual(['ol_order_c']);
    expect(page1.nextCursor).not.toBeNull();

    // Between fetches, a new row lands BETWEEN 'a' and 'c' in time - the
    // OFFSET failure mode would either skip it or re-show 'a' twice depending
    // on where it lands relative to a numeric offset. A keyset cursor is a
    // ROW POSITION, not a row count, so it is unaffected either way.
    await ormRepo.save(row('ol_order_b', new Date(base.getTime() + 60_000)));

    const page2 = await repo.findManyKeyset(
      { connectionId: CONNECTION_ID },
      { limit: 10, cursor: page1.nextCursor! },
    );

    // Both 'b' (inserted mid-walk) and 'a' (always there) are present,
    // newest-first, and 'c' (already consumed on page 1) does NOT reappear.
    expect(page2.items.map((i) => i.orderId)).toEqual(['ol_order_b', 'ol_order_a']);
    expect(page2.nextCursor).toBeNull();
  });

  it('applies the same filters findMany does, and returns null nextCursor on a short (final) page', async () => {
    const base = new Date('2026-03-01T00:00:00.000Z');
    await ormRepo.save([
      row('ol_order_issued', base, { status: 'issued' }),
      row('ol_order_failed', new Date(base.getTime() + 60_000), { status: 'failed' }),
    ]);

    const page = await repo.findManyKeyset(
      { connectionId: CONNECTION_ID, status: 'issued' },
      { limit: 10 },
    );

    expect(page.items.map((i) => i.orderId)).toEqual(['ol_order_issued']);
    expect(page.nextCursor).toBeNull();
  });
});
