/**
 * OMS Attention Columns — Integration Test (#2352)
 *
 * The producer-scoped, level-triggered write is almost entirely SQL — a CTE that
 * rebuilds one producer's entry inside a shared jsonb array while preserving
 * `since` — so a mocked-driver unit test can only assert that the statement was
 * composed. What it cannot assert is that the statement DOES the right thing,
 * and every property this slice exists to guarantee lives there:
 *
 *  - a producer's clear removes ONLY its own entry (the reason the column is an
 *    array and not #2100's scalar);
 *  - `since` survives a change of reason inside one episode;
 *  - an emptied column normalises back to NULL, so "nothing reported" has one
 *    spelling and the no-op guard is exact;
 *  - a reason this build does not recognise is neither counted nor returned.
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
import { ORDER_RECORD_REPOSITORY_TOKEN } from '@openlinker/core/orders';
import { RETURN_REPOSITORY_TOKEN } from '@openlinker/core/returns';
import type {
  AuthorityAttentionEntry,
  AuthorityAttentionOutcome,
  AuthorityAttentionProducer,
} from '@openlinker/core/fulfillment-authority';

/**
 * The slice of each repository this spec drives, declared locally.
 *
 * `*RepositoryPort` is a deny-pattern for a cross-context import
 * (`check-cross-context-imports.mjs`) — an intra-context persistence contract no
 * sibling may reach for. A test in `apps/api` is by definition cross-context, so
 * it names only the methods it exercises rather than claiming the whole port.
 */
interface OmsAttentionWriter<TRecord> {
  updateOmsAttention(
    id: string,
    producer: AuthorityAttentionProducer,
    outcome: AuthorityAttentionOutcome,
  ): Promise<void>;
  findById(id: string): Promise<TRecord | null>;
}

interface AttentionOrderRecord {
  readonly omsAttention: readonly AuthorityAttentionEntry[];
}

interface AttentionReturnRecord {
  readonly omsAttention: readonly AuthorityAttentionEntry[];
  attentionReasons(): readonly string[];
}

describe('OMS attention columns (integration)', () => {
  let harness: IntegrationTestHarness;
  let repository: OmsAttentionWriter<AttentionOrderRecord> & {
    upsert(record: never): Promise<unknown>;
    countOrdersWithOmsAttention(): Promise<number>;
    findMany(
      filters: Record<string, unknown>,
      pagination: { limit: number; offset: number }
    ): Promise<{ items: Array<{ internalOrderId: string }>; total: number }>;
    countByHealth(filters: Record<string, unknown>): Promise<{ omsAttention: number }>;
  };

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness.getApp().get(ORDER_RECORD_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function rawAttention(internalOrderId: string): Promise<unknown> {
    const rows = (await harness
      .getDataSource()
      .query(`SELECT "omsAttention" FROM "order_records" WHERE "internalOrderId" = $1`, [
        internalOrderId,
      ])) as Array<{ omsAttention: unknown }>;
    return rows[0]?.omsAttention ?? null;
  }

  it('stores a producer entry and reads it back through the domain record', async () => {
    const seeded = await createTestOrderRecord(harness.getDataSource());

    await repository.updateOmsAttention(seeded.internalOrderId, 'reservations', {
      kind: 'blocked',
      reason: 'reservation-shortfall',
      detail: '2 x SKU-1',
      subjectRef: 'line-1',
    });

    const record = await repository.findById(seeded.internalOrderId);
    expect(record?.omsAttention).toEqual([
      expect.objectContaining({
        producer: 'reservations',
        reason: 'reservation-shortfall',
        detail: '2 x SKU-1',
        subjectRef: 'line-1',
        since: expect.any(String),
      }),
    ]);
  });

  it('clears only the calling producer, leaving every other producer intact', async () => {
    // THE property the array shape exists for. With #2100's scalar column this
    // clear would have deleted the routing state too, and nothing would ever put
    // it back, because routing only writes when its own answer changes.
    const seeded = await createTestOrderRecord(harness.getDataSource());

    await repository.updateOmsAttention(seeded.internalOrderId, 'reservations', {
      kind: 'blocked',
      reason: 'reservation-shortfall',
    });
    await repository.updateOmsAttention(seeded.internalOrderId, 'routing', {
      kind: 'blocked',
      reason: 'line-unfulfillable',
    });

    await repository.updateOmsAttention(seeded.internalOrderId, 'reservations', { kind: 'none' });

    const record = await repository.findById(seeded.internalOrderId);
    expect(record?.omsAttention.map((entry) => entry.reason)).toEqual(['line-unfulfillable']);
  });

  it('normalises the column back to NULL once the last producer clears', async () => {
    const seeded = await createTestOrderRecord(harness.getDataSource());

    await repository.updateOmsAttention(seeded.internalOrderId, 'routing', {
      kind: 'blocked',
      reason: 'line-unfulfillable',
    });
    await repository.updateOmsAttention(seeded.internalOrderId, 'routing', { kind: 'none' });

    expect(await rawAttention(seeded.internalOrderId)).toBeNull();
  });

  it('preserves since across a change of reason within one episode', async () => {
    const seeded = await createTestOrderRecord(harness.getDataSource());

    await repository.updateOmsAttention(seeded.internalOrderId, 'routing', {
      kind: 'blocked',
      reason: 'line-unfulfillable',
    });
    const first = (await repository.findById(seeded.internalOrderId))?.omsAttention[0]?.since;

    await repository.updateOmsAttention(seeded.internalOrderId, 'routing', {
      kind: 'blocked',
      reason: 'fulfillment-unaccepted',
      detail: 'refined',
    });
    const after = (await repository.findById(seeded.internalOrderId))?.omsAttention[0];

    expect(after?.reason).toBe('fulfillment-unaccepted');
    expect(after?.since).toBe(first);
  });

  it('restamps since when a producer reports again after clearing — a new episode', async () => {
    const seeded = await createTestOrderRecord(harness.getDataSource());

    await repository.updateOmsAttention(seeded.internalOrderId, 'routing', {
      kind: 'blocked',
      reason: 'line-unfulfillable',
    });
    const first = (await repository.findById(seeded.internalOrderId))?.omsAttention[0]?.since;

    await repository.updateOmsAttention(seeded.internalOrderId, 'routing', { kind: 'none' });
    await repository.updateOmsAttention(seeded.internalOrderId, 'routing', {
      kind: 'blocked',
      reason: 'line-unfulfillable',
    });

    const after = (await repository.findById(seeded.internalOrderId))?.omsAttention[0]?.since;
    expect(after).not.toBe(first);
  });

  it('leaves the stored entry alone when the producer is indeterminate', async () => {
    const seeded = await createTestOrderRecord(harness.getDataSource());

    await repository.updateOmsAttention(seeded.internalOrderId, 'routing', {
      kind: 'blocked',
      reason: 'line-unfulfillable',
    });
    await repository.updateOmsAttention(seeded.internalOrderId, 'routing', {
      kind: 'indeterminate',
    });

    const record = await repository.findById(seeded.internalOrderId);
    expect(record?.omsAttention.map((entry) => entry.reason)).toEqual(['line-unfulfillable']);
  });

  it('restamps since when a stored entry carries a non-string one', async () => {
    // A JSON null `since` cannot round-trip `readAuthorityAttentionEntry`, so the
    // entry was never readable anyway; `->>` yields SQL NULL and COALESCE
    // restamps, which repairs the row rather than preserving a value no consumer
    // can use. Pinned because the alternative — carrying a corrupt value forward
    // forever — is silent.
    const seeded = await createTestOrderRecord(harness.getDataSource());
    await harness
      .getDataSource()
      .query(`UPDATE "order_records" SET "omsAttention" = $1 WHERE "internalOrderId" = $2`, [
        JSON.stringify([{ producer: 'routing', reason: 'line-unfulfillable', since: null }]),
        seeded.internalOrderId,
      ]);

    expect((await repository.findById(seeded.internalOrderId))?.omsAttention).toEqual([]);

    await repository.updateOmsAttention(seeded.internalOrderId, 'routing', {
      kind: 'blocked',
      reason: 'line-unfulfillable',
    });

    const repaired = (await repository.findById(seeded.internalOrderId))?.omsAttention;
    expect(repaired).toEqual([
      expect.objectContaining({ reason: 'line-unfulfillable', since: expect.any(String) }),
    ]);
  });

  it('is a no-op against a row that does not exist', async () => {
    await expect(
      repository.updateOmsAttention('ol_order_missing', 'routing', {
        kind: 'blocked',
        reason: 'line-unfulfillable',
      }),
    ).resolves.toBeUndefined();
  });

  it('re-ingesting the order does not erase a producer entry', async () => {
    // The `toOrm` exclusion, proven end to end rather than by asserting the SQL
    // text: `persistOrder` runs on every ingestion and knows nothing about
    // OL-owned state.
    const seeded = await createTestOrderRecord(harness.getDataSource());
    await repository.updateOmsAttention(seeded.internalOrderId, 'routing', {
      kind: 'blocked',
      reason: 'line-unfulfillable',
    });

    const record = await repository.findById(seeded.internalOrderId);
    expect(record).not.toBeNull();
    await repository.upsert(record as never);

    const after = await repository.findById(seeded.internalOrderId);
    expect(after?.omsAttention.map((entry) => entry.reason)).toEqual(['line-unfulfillable']);
  });

  describe('returns', () => {
    const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';

    async function seedReturn(internalOrderId: string | null): Promise<string> {
      const id = `ol_return_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      await harness
        .getDataSource()
        .query(
          `INSERT INTO "returns" ("id", "sourceConnectionId", "externalReturnId", "internalOrderId", "origin")
           VALUES ($1, $2, $3, $4, 'source_ingested')`,
          [id, CONNECTION_ID, `RET-${id}`, internalOrderId],
        );
      return id;
    }

    function returnRepository(): OmsAttentionWriter<AttentionReturnRecord> {
      return harness.getApp().get(RETURN_REPOSITORY_TOKEN);
    }

    it('stores and clears a producer entry on a return, per producer', async () => {
      const id = await seedReturn('ol_order_1');
      const repo = returnRepository();

      await repo.updateOmsAttention(id, 'returns-restock', {
        kind: 'blocked',
        reason: 'restock-blocked',
        detail: 'the shop refused',
      });
      expect((await repo.findById(id))?.omsAttention.map((e) => e.reason)).toEqual([
        'restock-blocked',
      ]);

      await repo.updateOmsAttention(id, 'returns-restock', { kind: 'none' });
      expect((await repo.findById(id))?.omsAttention).toEqual([]);
    });

    it('clears only the calling producer on a return too', async () => {
      // The shared statement is proven behaviourally on BOTH owning tables, not
      // on orders alone — the two rows differ in table, id column and alias, and
      // an int-spec on one says nothing about the other.
      const id = await seedReturn('ol_order_1');
      const repo = returnRepository();

      await repo.updateOmsAttention(id, 'returns-restock', {
        kind: 'blocked',
        reason: 'restock-blocked',
      });
      await repo.updateOmsAttention(id, 'routing', {
        kind: 'blocked',
        reason: 'line-unfulfillable',
      });
      await repo.updateOmsAttention(id, 'returns-restock', { kind: 'none' });

      expect((await repo.findById(id))?.omsAttention.map((e) => e.reason)).toEqual([
        'line-unfulfillable',
      ]);
    });

    it('preserves since across a change of reason on a return', async () => {
      const id = await seedReturn('ol_order_1');
      const repo = returnRepository();

      await repo.updateOmsAttention(id, 'returns-restock', {
        kind: 'blocked',
        reason: 'restock-blocked',
      });
      const first = (await repo.findById(id))?.omsAttention[0]?.since;

      await repo.updateOmsAttention(id, 'returns-restock', {
        kind: 'blocked',
        reason: 'restock-blocked',
        detail: 'refined',
      });
      const after = (await repo.findById(id))?.omsAttention[0];

      expect(after?.detail).toBe('refined');
      expect(after?.since).toBe(first);
    });

    it('normalises the column back to NULL once the last producer clears on a return', async () => {
      const id = await seedReturn('ol_order_1');
      const repo = returnRepository();

      await repo.updateOmsAttention(id, 'returns-restock', {
        kind: 'blocked',
        reason: 'restock-blocked',
      });
      await repo.updateOmsAttention(id, 'returns-restock', { kind: 'none' });

      const rows = (await harness
        .getDataSource()
        .query(`SELECT "omsAttention" FROM "returns" WHERE "id" = $1`, [id])) as Array<{
        omsAttention: unknown;
      }>;
      expect(rows[0]?.omsAttention).toBeNull();
    });

    it('derives the unmatched state from attribution rather than from a stored entry', async () => {
      // OR-P has exactly one definition (`internalOrderId IS NULL`). Nothing
      // writes it, and `attentionReasons()` is where the derived and persisted
      // halves are joined.
      const id = await seedReturn(null);
      const repo = returnRepository();

      const record = await repo.findById(id);
      expect(record?.omsAttention).toEqual([]);
      expect(record?.attentionReasons()).toEqual(['return-unmatched']);
    });
  });

  describe('countOrdersWithOmsAttention', () => {
    it('counts an order once however many states it carries', async () => {
      const seeded = await createTestOrderRecord(harness.getDataSource());
      await repository.updateOmsAttention(seeded.internalOrderId, 'routing', {
        kind: 'blocked',
        reason: 'line-unfulfillable',
      });
      await repository.updateOmsAttention(seeded.internalOrderId, 'reservations', {
        kind: 'blocked',
        reason: 'reservation-shortfall',
      });

      await expect(repository.countOrdersWithOmsAttention()).resolves.toBe(1);
    });

    it('counts zero on a healthy install where every column is NULL', async () => {
      await createTestOrderRecord(harness.getDataSource());

      await expect(repository.countOrdersWithOmsAttention()).resolves.toBe(0);
    });

    it('does not count a reason this build does not recognise, and does not return it', async () => {
      // A value written by a newer release and then rolled back. Counting it
      // would produce a red number with no badge anywhere to explain it, which
      // is the #2100 `IS NOT NULL` defect restated (spec §4.4 S2-5).
      const seeded = await createTestOrderRecord(harness.getDataSource());
      await harness
        .getDataSource()
        .query(`UPDATE "order_records" SET "omsAttention" = $1 WHERE "internalOrderId" = $2`, [
          JSON.stringify([
            { producer: 'automations', reason: 'automation-failed', since: '2026-08-26T00:00:00Z' },
          ]),
          seeded.internalOrderId,
        ]);

      await expect(repository.countOrdersWithOmsAttention()).resolves.toBe(0);
      const record = await repository.findById(seeded.internalOrderId);
      expect(record?.omsAttention).toEqual([]);
    });
  });

  describe('the ?attention= list axis and its summary count (#2353)', () => {
    async function seedBlockedAndHealthy(): Promise<{ blocked: string; healthy: string }> {
      const blocked = await createTestOrderRecord(harness.getDataSource());
      const healthy = await createTestOrderRecord(harness.getDataSource());
      await repository.updateOmsAttention(blocked.internalOrderId, 'reservations', {
        kind: 'blocked',
        reason: 'reservation-shortfall',
      });
      return { blocked: blocked.internalOrderId, healthy: healthy.internalOrderId };
    }

    it('keeps only orders carrying a counted state when true', async () => {
      const { blocked } = await seedBlockedAndHealthy();

      const page = await repository.findMany({ omsAttention: true }, { limit: 20, offset: 0 });

      expect(page.items.map((item) => item.internalOrderId)).toEqual([blocked]);
    });

    it('keeps the rest when false, including rows whose column is NULL', async () => {
      // The negative arm must be TOTAL over a NULL column. `jsonb_path_exists`
      // yields NULL on a NULL input, so the predicate coalesces to an empty
      // array BEFORE the test - without that the healthy majority would vanish
      // from `attention=false`, the trap `IS_SALES_DOCUMENT_BLOCKED` needs its
      // own COALESCE for.
      const { healthy } = await seedBlockedAndHealthy();

      const page = await repository.findMany({ omsAttention: false }, { limit: 20, offset: 0 });

      expect(page.items.map((item) => item.internalOrderId)).toEqual([healthy]);
    });

    it('returns both orders when the axis is omitted', async () => {
      await seedBlockedAndHealthy();

      const page = await repository.findMany({}, { limit: 20, offset: 0 });

      expect(page.total).toBe(2);
    });

    it('counts the same population in the health summary as the filter returns', async () => {
      await seedBlockedAndHealthy();

      const summary = await repository.countByHealth({});

      expect(summary.omsAttention).toBe(1);
    });

    it('does not match on a reason this build does not recognise', async () => {
      const seeded = await createTestOrderRecord(harness.getDataSource());
      await harness
        .getDataSource()
        .query(`UPDATE "order_records" SET "omsAttention" = $1 WHERE "internalOrderId" = $2`, [
          JSON.stringify([
            { producer: 'automations', reason: 'automation-failed', since: '2026-08-26T00:00:00Z' },
          ]),
          seeded.internalOrderId,
        ]);

      const page = await repository.findMany({ omsAttention: true }, { limit: 20, offset: 0 });
      const summary = await repository.countByHealth({});

      expect(page.items).toEqual([]);
      expect(summary.omsAttention).toBe(0);
    });
  });
});
