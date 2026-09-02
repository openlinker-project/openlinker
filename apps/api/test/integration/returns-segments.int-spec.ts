/**
 * Return Segments Integration Test (#2378, `W2-41`)
 *
 * The strip's counts are SQL over aggregated lines and events, so only a real
 * database proves them. Four properties earn coverage here:
 *
 *  - **segments OVERLAP** — one return lands in several, and the counts
 *    deliberately do not sum to `total`. The sibling stage counts DO sum, and an
 *    int-spec one file over asserts that, so the inequality is pinned here
 *    rather than left as a comment a reader can copy past;
 *  - **the counts are scoped with `segment` REMOVED** — the defence that already
 *    survived a caller forgetting it once;
 *  - **the filter tests the SAME predicate the count buckets on**, so a filtered
 *    page can never disagree with its own card;
 *  - **`orphans` uses the same rule `ReturnRecord.isOrphan()` states**, reached
 *    through the one shared SQL constant rather than a hand-written `IS NULL`.
 *
 * @module apps/api/test/integration
 */
import {
  RETURNS_SERVICE_TOKEN,
  ReturnSegmentValues,
  type IReturnsService,
} from '@openlinker/core/returns';

import { createTestConnection } from './helpers/test-connection.helper';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

describe('Return Segments Integration', () => {
  let harness: IntegrationTestHarness;
  let connectionId: string;

  const returns = (): IReturnsService =>
    harness.getApp().get<IReturnsService>(RETURNS_SERVICE_TOKEN, { strict: false });

  const query = async <T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await harness.getDataSource().query(sql, params)) as T[];

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    connectionId = (await createTestConnection(harness.getDataSource(), { name: 'Source A' })).id;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  const seedReturn = async (
    id: string,
    opts: {
      orphan?: boolean;
      custodyState?: string;
      moneyState?: string;
      advised?: number;
      received?: number;
      restocked?: number;
      scrapped?: number;
      blocked?: boolean;
    } = {}
  ): Promise<void> => {
    await query(
      `INSERT INTO "returns" ("id", "sourceConnectionId", "externalReturnId", "internalOrderId", "origin")
       VALUES ($1, $2, $3, $4, 'source_ingested')`,
      [id, connectionId, `EXT-${id}`, opts.orphan === true ? null : 'ol_order_seg']
    );
    await query(
      `INSERT INTO "return_lines"
         ("returnId", "lineIndex", "reason", "custodyState", "moneyState",
          "quantityAdvised", "quantityReceived", "quantityRestocked", "quantityScrapped")
       VALUES ($1, 0, 'withdrawal', $2, $3, $4, $5, $6, $7)`,
      [
        id,
        opts.custodyState ?? 'advised',
        opts.moneyState ?? 'not_refundable',
        opts.advised ?? 2,
        opts.received ?? 0,
        opts.restocked ?? 0,
        opts.scrapped ?? 0,
      ]
    );

    if (opts.blocked === true) {
      const [line] = await query<{ id: string }>(
        `SELECT id FROM "return_lines" WHERE "returnId" = $1`,
        [id]
      );
      await query(
        `INSERT INTO "return_line_events"
           ("returnId", "returnLineId", "seq", "kind", "quantity", "restockState", "occurredAt")
         VALUES ($1, $2, 1, 'dispose', 1, 'blocked', now())`,
        [id, line.id]
      );
    }
  };

  it('should count overlapping segments WITHOUT summing to the total', async () => {
    // One return that sits in four segments at once.
    await seedReturn('ol_return_seg_multi', {
      orphan: true,
      custodyState: 'received',
      moneyState: 'in_doubt',
      advised: 5,
      received: 5,
      blocked: true,
    });

    const counts = await returns().countReturnsBySegment({});

    expect(counts.total).toBe(1);
    expect(counts.bySegment.needs_disposition).toBe(1);
    expect(counts.bySegment.restock_blocked).toBe(1);
    expect(counts.bySegment.money_pending).toBe(1);
    expect(counts.bySegment.orphans).toBe(1);
    expect(counts.bySegment.all_open).toBe(1);

    // Segments OVERLAP. The sibling stage counts partition and DO sum; these
    // must not, and nothing may start asserting that they do.
    const summed = ReturnSegmentValues.reduce((acc, s) => acc + counts.bySegment[s], 0);
    expect(summed).toBeGreaterThan(counts.total);
  });

  it('should count needs_receiving for a return whose parcel has not fully arrived', async () => {
    await seedReturn('ol_return_seg_recv', { advised: 5, received: 2, custodyState: 'received' });

    const counts = await returns().countReturnsBySegment({});

    expect(counts.bySegment.needs_receiving).toBe(1);
  });

  it('should leave a finished return out of every open segment', async () => {
    await seedReturn('ol_return_seg_done', {
      custodyState: 'disposed',
      moneyState: 'refunded',
      advised: 2,
      received: 2,
      restocked: 2,
    });

    const counts = await returns().countReturnsBySegment({});

    expect(counts.bySegment.needs_receiving).toBe(0);
    expect(counts.bySegment.needs_disposition).toBe(0);
    expect(counts.bySegment.money_pending).toBe(0);
    expect(counts.bySegment.all_open).toBe(0);
    expect(counts.total).toBe(1);
  });

  it('should scope the counts with `segment` REMOVED', async () => {
    await seedReturn('ol_return_seg_a', { orphan: true });
    await seedReturn('ol_return_seg_b', { advised: 3, received: 1, custodyState: 'received' });

    const unfiltered = await returns().countReturnsBySegment({});
    // A caller that forgets to strip it must not make every card report the
    // count of the segment already selected.
    const filtered = await returns().countReturnsBySegment({ segment: 'orphans' });

    expect(filtered).toEqual(unfiltered);
  });

  it('should filter on the SAME predicate the counts bucket on', async () => {
    await seedReturn('ol_return_seg_x', { orphan: true, blocked: true, received: 1, advised: 2 });
    await seedReturn('ol_return_seg_y', {
      custodyState: 'disposed',
      advised: 1,
      received: 1,
      restocked: 1,
    });

    const counts = await returns().countReturnsBySegment({});

    for (const segment of ReturnSegmentValues) {
      const rows = await returns().listReturns({ segment }, 100, 0);
      expect({ segment, rows: rows.length }).toEqual({
        segment,
        rows: counts.bySegment[segment],
      });
    }
  });

  it('should compose `segment` with `stage` without a duplicate join', async () => {
    // Both dimensions read the counters subquery; joining it per-arm would be a
    // TypeORM duplicate-alias error on exactly this request — clicking a card
    // and then narrowing by stage.
    await seedReturn('ol_return_seg_combo', { orphan: true, advised: 2, received: 0 });

    const rows = await returns().listReturns(
      { segment: 'orphans', stage: 'awaiting_parcel' },
      10,
      0
    );

    expect(rows).toHaveLength(1);
  });

  it('should count orphans by the same rule ReturnRecord.isOrphan() states', async () => {
    await seedReturn('ol_return_seg_orphan', { orphan: true });
    await seedReturn('ol_return_seg_attributed', {});

    const counts = await returns().countReturnsBySegment({});
    const buckets = await returns().countReturnsByBucket({});

    // One SQL constant feeds the segment and the bucket count, so they cannot
    // disagree about what an orphan is.
    expect(counts.bySegment.orphans).toBe(buckets.orphan);
  });

  it('should filter on the SOURCE opened instant, never OL ingestion time', async () => {
    await seedReturn('ol_return_seg_opened', {});
    await query(`UPDATE "returns" SET "openedAt" = $1 WHERE id = $2`, [
      new Date('2026-01-15T00:00:00.000Z'),
      'ol_return_seg_opened',
    ]);

    const inRange = await returns().listReturns(
      { openedFrom: new Date('2026-01-01T00:00:00.000Z'), openedTo: new Date('2026-02-01T00:00:00.000Z') },
      10,
      0
    );
    const outOfRange = await returns().listReturns(
      { openedFrom: new Date('2026-03-01T00:00:00.000Z') },
      10,
      0
    );

    expect(inRange).toHaveLength(1);
    // `createdAt` is today (OL's ingestion clock) and would have matched — the
    // arm reads `openedAt`, which is the source's own instant.
    expect(outOfRange).toHaveLength(0);
  });
});
