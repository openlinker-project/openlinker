/**
 * Order Changes Schema Integration Test (#2333, ADR-044)
 *
 * Verifies `order_changes` against real Postgres (Testcontainers). Everything
 * asserted here is a DATABASE-level guarantee that a mock cannot express, and
 * each one is part of the contract Wave 2 (#2389) builds on:
 *
 *  - `UQ_order_changes_open_target` admits exactly ONE open proposal per
 *    `(internalOrderId, targetRef)` — the property that makes a double-call a
 *    no-op rather than a second remote request;
 *  - …and RELEASES the slot the moment that proposal terminalises, so an order's
 *    target is never permanently unmutable (ADR-044's reason for `expired`);
 *  - …and does NOT serialize two DIFFERENT targets of one order against each
 *    other, which is exactly the liveness bug ADR-044 corrected an earlier draft
 *    to avoid;
 *  - `internalOrderId` is NOT NULL, which is what makes "refuse the action for an
 *    orphan return" a schema fact rather than a service convention;
 *  - the column list is snapshotted, so a later widening of `kind` cannot
 *    silently reshape the table Wave 2 was promised.
 *
 * **The harness builds its schema by `synchronize`, not by migration**, which is
 * why the partial unique index is declared on `OrderChangeOrmEntity` under the
 * same name and with the same predicate as the migration — otherwise these
 * assertions would hold against only one of the two schemas.
 *
 * @module apps/api/test/integration
 */
import type { QueryFailedError } from 'typeorm';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

describe('Order Changes Schema Integration', () => {
  let harness: IntegrationTestHarness;

  const ORDER_A = 'ol_order_aaa';
  const TARGET_A = 'ol_return_aaa';
  const TARGET_B = 'ol_return_bbb';

  beforeAll(async () => {
    harness = await getTestHarness();
  });
  afterEach(async () => {
    await resetTestHarness();
  });
  afterAll(async () => {
    await teardownTestHarness();
  });

  const query = async <T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await harness.getDataSource().query(sql, params)) as T[];

  const insertChange = async (
    targetRef: string,
    status = 'requested',
    internalOrderId: string | null = ORDER_A
  ): Promise<string> => {
    const rows = await query<{ id: string }>(
      `INSERT INTO "order_changes"
         ("internalOrderId", "kind", "targetRef", "status", "requestedAt")
       VALUES ($1, 'return.decline', $2, $3, now())
       RETURNING "id"`,
      [internalOrderId, targetRef, status]
    );
    return rows[0].id;
  };

  it('should accept an open proposal and default its audit columns to null', async () => {
    const id = await insertChange(TARGET_A);

    const rows = await query<{
      status: string;
      confirmedAt: Date | null;
      appliedAt: Date | null;
      declinedReason: string | null;
    }>(`SELECT "status", "confirmedAt", "appliedAt", "declinedReason" FROM "order_changes" WHERE "id" = $1`, [id]);

    expect(rows[0].status).toBe('requested');
    expect(rows[0].confirmedAt).toBeNull();
    expect(rows[0].appliedAt).toBeNull();
    expect(rows[0].declinedReason).toBeNull();
  });

  it('should reject a second OPEN proposal against the same order and target', async () => {
    await insertChange(TARGET_A, 'requested');

    let error: QueryFailedError | undefined;
    try {
      await insertChange(TARGET_A, 'pending');
    } catch (caught) {
      error = caught as QueryFailedError;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain('UQ_order_changes_open_target');
  });

  it('should release the slot once the holding proposal terminalises', async () => {
    // Without this, one hung remote call would leave the target permanently
    // unmutable — ADR-044's stated reason for making `expired` mandatory.
    const first = await insertChange(TARGET_A, 'requested');
    await query(`UPDATE "order_changes" SET "status" = 'expired' WHERE "id" = $1`, [first]);

    await expect(insertChange(TARGET_A, 'requested')).resolves.toEqual(expect.any(String));

    const rows = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "order_changes" WHERE "targetRef" = $1`,
      [TARGET_A]
    );
    expect(rows[0].count).toBe('2');
  });

  it.each(['confirmed', 'declined', 'canceled', 'expired'])(
    'should treat %s as terminal for the purposes of the slot',
    async (terminal) => {
      const first = await insertChange(TARGET_A, 'requested');
      await query(`UPDATE "order_changes" SET "status" = $2 WHERE "id" = $1`, [first, terminal]);

      await expect(insertChange(TARGET_A, 'requested')).resolves.toEqual(expect.any(String));
    }
  );

  it('should NOT serialize two different targets of the same order against each other', async () => {
    // The grain is (order, target), never the order alone — one-open-change-per-
    // ORDER would serialize an order's shipments, a liveness bug.
    await insertChange(TARGET_A, 'requested');

    await expect(insertChange(TARGET_B, 'requested')).resolves.toEqual(expect.any(String));
  });

  it('should refuse a proposal with no order, so an orphan cannot record one', async () => {
    let error: QueryFailedError | undefined;
    try {
      await insertChange(TARGET_A, 'requested', null);
    } catch (caught) {
      error = caught as QueryFailedError;
    }

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/internalOrderId/);
  });

  it('should carry exactly the ADR-044 column set', async () => {
    const rows = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'order_changes' ORDER BY column_name`
    );

    expect(rows.map((row) => row.column_name)).toEqual([
      'appliedAt',
      'confirmedAt',
      'confirmedBy',
      'createdAt',
      'declinedReason',
      'id',
      'internalOrderId',
      'kind',
      'payload',
      'requestedAt',
      'requestedBy',
      'status',
      'targetRef',
      'updatedAt',
    ]);
  });
});
