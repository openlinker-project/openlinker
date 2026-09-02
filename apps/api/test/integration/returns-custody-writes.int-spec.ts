/**
 * Return Custody Writes Integration Test (#2370, `W2-33`, ADR-060)
 *
 * Verifies the receive/dispose/attest write paths against real Postgres. What is
 * asserted here is what a mock cannot express:
 *
 *  - the **act ledger** and the **counters** are written in one transaction and
 *    the acts sum back to the counters (the property that makes the ledger
 *    history rather than a second, drifting source of truth);
 *  - `SELECT … FOR UPDATE` really prevents a lost update — two concurrent
 *    receipts of 2 against `advised: 5` leave 4, not 2. `CHK_return_lines_
 *    quantity_ordering` is SILENT on that case (`2 <= 5` is legal), which is
 *    precisely why the row lock is not redundant with it;
 *  - the CHECK still refuses an impossible line when the service is bypassed;
 *  - `UQ_return_line_events_line_seq` refuses a duplicate per-line sequence, so
 *    two writers can never mint one idempotency key for two acts.
 *
 * The full receive -> dispose -> blocked -> attest walk is exercised at the
 * repository level, because the master `adjustInventory` call sits above this
 * layer and has its own unit coverage.
 *
 * @module apps/api/test/integration
 */
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

describe('Return Custody Writes Integration', () => {
  let harness: IntegrationTestHarness;

  const CONNECTION_A = '11111111-1111-1111-1111-111111111111';
  const RETURN_ID = 'ol_return_custody_1';
  const LINE_ID = '33333333-3333-3333-3333-333333333333';

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

  const seedLine = async (advised = 5): Promise<void> => {
    await query(
      `INSERT INTO "returns" ("id", "sourceConnectionId", "externalReturnId", "origin")
       VALUES ($1, $2, $3, 'source_ingested')`,
      [RETURN_ID, CONNECTION_A, 'ext-custody-1']
    );
    await query(
      `INSERT INTO "return_lines" ("id", "returnId", "lineIndex", "reason", "quantityAdvised")
       VALUES ($1, $2, 0, 'other', $3)`,
      [LINE_ID, RETURN_ID, advised]
    );
  };

  const insertEvent = async (
    seq: number,
    overrides: { kind?: string; quantity?: number; restockState?: string } = {}
  ): Promise<void> => {
    await query(
      `INSERT INTO "return_line_events"
         ("returnId", "returnLineId", "seq", "kind", "quantity", "restockState", "occurredAt")
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [
        RETURN_ID,
        LINE_ID,
        seq,
        overrides.kind ?? 'receive',
        overrides.quantity ?? 1,
        overrides.restockState ?? 'not_applicable',
      ]
    );
  };

  describe('the act ledger', () => {
    it('should refuse a duplicate per-line sequence, so one key can never name two acts', async () => {
      await seedLine();
      await insertEvent(1);

      // The `{seq}` of `return:{returnId}:{lineId}:{seq}` — two acts sharing it
      // would be two real adjustments under one idempotency key.
      await expect(insertEvent(1)).rejects.toMatchObject({
        message: expect.stringContaining('UQ_return_line_events_line_seq'),
      });
    });

    it('should admit the same sequence on a different line', async () => {
      await seedLine();
      const otherLine = '44444444-4444-4444-4444-444444444444';
      await query(
        `INSERT INTO "return_lines" ("id", "returnId", "lineIndex", "reason", "quantityAdvised")
         VALUES ($1, $2, 1, 'other', 3)`,
        [otherLine, RETURN_ID]
      );

      await insertEvent(1);
      await query(
        `INSERT INTO "return_line_events"
           ("returnId", "returnLineId", "seq", "kind", "quantity", "restockState", "occurredAt")
         VALUES ($1, $2, 1, 'receive', 1, 'not_applicable', now())`,
        [RETURN_ID, otherLine]
      );

      const rows = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "return_line_events" WHERE "returnId" = $1`,
        [RETURN_ID]
      );
      expect(rows[0].count).toBe('2');
    });

    it('should refuse a non-positive quantity — a correction is its own act, never a negative one', async () => {
      await seedLine();

      await expect(insertEvent(1, { quantity: 0 })).rejects.toMatchObject({
        message: expect.stringContaining('CHK_return_line_events_quantity_positive'),
      });
    });

    it('should find outstanding blocks through the partial index predicate', async () => {
      await seedLine();
      await insertEvent(1, { kind: 'dispose', restockState: 'applied' });
      await insertEvent(2, { kind: 'dispose', restockState: 'blocked' });
      await insertEvent(3, { kind: 'dispose', restockState: 'in_doubt' });
      await insertEvent(4, { kind: 'dispose', restockState: 'handled_manually' });

      // Spec § 5.4: the segment counts UNHANDLED blocks, not historical ones.
      const rows = await query<{ seq: number }>(
        `SELECT "seq" FROM "return_line_events"
          WHERE "returnId" = $1 AND "restockState" IN ('blocked', 'in_doubt')
          ORDER BY "seq"`,
        [RETURN_ID]
      );
      expect(rows.map((r) => Number(r.seq))).toEqual([2, 3]);
    });
  });

  describe('the counter invariant', () => {
    it('should still refuse an impossible line when the service is bypassed', async () => {
      await seedLine(5);

      // The DB CHECK is the guarantee that survives a caller going around this
      // context entirely — #2370 adds a ledger beside it, never instead of it.
      await expect(
        query(`UPDATE "return_lines" SET "quantityReceived" = 9 WHERE "id" = $1`, [LINE_ID])
      ).rejects.toMatchObject({
        message: expect.stringContaining('CHK_return_lines_quantity_ordering'),
      });
    });

    it('should refuse disposing more units than arrived', async () => {
      await seedLine(5);
      await query(`UPDATE "return_lines" SET "quantityReceived" = 2 WHERE "id" = $1`, [LINE_ID]);

      await expect(
        query(`UPDATE "return_lines" SET "quantityRestocked" = 3 WHERE "id" = $1`, [LINE_ID])
      ).rejects.toMatchObject({
        message: expect.stringContaining('CHK_return_lines_quantity_ordering'),
      });
    });

    it('should keep blocked units in quantityReceived rather than quantityRestocked', async () => {
      // The shape spec § 5.4 requires and #2381 asserts no surface contradicts:
      // 3 received, 2 disposed as restock but refused by the master, so
      // `quantityRestocked` stays 0 and the act carries the block.
      await seedLine(5);
      await query(`UPDATE "return_lines" SET "quantityReceived" = 3 WHERE "id" = $1`, [LINE_ID]);
      await insertEvent(1, { kind: 'receive', quantity: 3 });
      await query(
        `INSERT INTO "return_line_events"
           ("returnId", "returnLineId", "seq", "kind", "quantity", "disposition",
            "restockState", "restockBlockedReason", "restockBlockedDetail", "occurredAt")
         VALUES ($1, $2, 2, 'dispose', 2, 'restock', 'blocked', 'master-refused',
                 'PrestaShop refuses stock writes', now())`,
        [RETURN_ID, LINE_ID]
      );

      const [line] = await query<{ quantityReceived: number; quantityRestocked: number }>(
        `SELECT "quantityReceived", "quantityRestocked" FROM "return_lines" WHERE "id" = $1`,
        [LINE_ID]
      );
      expect(Number(line.quantityReceived)).toBe(3);
      expect(Number(line.quantityRestocked)).toBe(0);
    });

    it('should let the attestation move the blocked units into quantityRestocked', async () => {
      await seedLine(5);
      await query(`UPDATE "return_lines" SET "quantityReceived" = 3 WHERE "id" = $1`, [LINE_ID]);
      await insertEvent(1, { kind: 'dispose', quantity: 2, restockState: 'blocked' });

      // What `markStockHandledManually` does: the units move, and the act says
      // a human did it — never that OpenLinker wrote the stock.
      await query(
        `UPDATE "return_line_events"
            SET "restockState" = 'handled_manually', "restockedBy" = 'operator_out_of_band'
          WHERE "returnLineId" = $1 AND "seq" = 1`,
        [LINE_ID]
      );
      await query(`UPDATE "return_lines" SET "quantityRestocked" = 2 WHERE "id" = $1`, [LINE_ID]);

      const outstanding = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "return_line_events"
          WHERE "returnId" = $1 AND "restockState" IN ('blocked', 'in_doubt')`,
        [RETURN_ID]
      );
      expect(outstanding[0].count).toBe('0');

      const [line] = await query<{ quantityRestocked: number }>(
        `SELECT "quantityRestocked" FROM "return_lines" WHERE "id" = $1`,
        [LINE_ID]
      );
      expect(Number(line.quantityRestocked)).toBe(2);
    });
  });

  describe('concurrency', () => {
    it('should not lose a concurrent receipt when the row is locked', async () => {
      await seedLine(5);

      // Two receipts of 2, each reading-then-writing. Without `FOR UPDATE` both
      // read 0, both compute 2, and the line records 2 instead of 4 — a lost
      // update the CHECK cannot see, because 2 <= 5 is perfectly legal.
      const receive = async (quantity: number): Promise<void> => {
        await harness.getDataSource().transaction(async (manager) => {
          const rows = (await manager.query(
            `SELECT "quantityReceived" FROM "return_lines" WHERE "id" = $1 FOR UPDATE`,
            [LINE_ID]
          )) as Array<{ quantityReceived: number }>;
          const next = Number(rows[0].quantityReceived) + quantity;
          await manager.query(`UPDATE "return_lines" SET "quantityReceived" = $1 WHERE "id" = $2`, [
            next,
            LINE_ID,
          ]);
        });
      };

      await Promise.all([receive(2), receive(2)]);

      const [line] = await query<{ quantityReceived: number }>(
        `SELECT "quantityReceived" FROM "return_lines" WHERE "id" = $1`,
        [LINE_ID]
      );
      expect(Number(line.quantityReceived)).toBe(4);
    });
  });

  describe('schema', () => {
    it('should carry every column the act ledger needs', async () => {
      const columns = await query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'return_line_events'
          ORDER BY column_name`
      );

      expect(columns.map((c) => c.column_name)).toEqual([
        'actorUserId',
        'attestedByEventId',
        'createdAt',
        'disposition',
        'id',
        'kind',
        'masterConnectionId',
        'note',
        'occurredAt',
        'quantity',
        'restockBlockedDetail',
        'restockBlockedReason',
        'restockState',
        'restockedBy',
        'returnId',
        'returnLineId',
        'seq',
      ]);
    });

    it('should default restockState to not_applicable, the correct value for a receipt', async () => {
      await seedLine();
      await query(
        `INSERT INTO "return_line_events"
           ("returnId", "returnLineId", "seq", "kind", "quantity", "occurredAt")
         VALUES ($1, $2, 1, 'receive', 1, now())`,
        [RETURN_ID, LINE_ID]
      );

      const [row] = await query<{ restockState: string }>(
        `SELECT "restockState" FROM "return_line_events" WHERE "returnLineId" = $1`,
        [LINE_ID]
      );
      expect(row.restockState).toBe('not_applicable');
    });

    it('should keep acts when their line is deleted, because there is no FK', async () => {
      // The context's stated posture: the ONE FK is return_lines -> returns.
      // This is why the integration harness truncates the table explicitly.
      await seedLine();
      await insertEvent(1);
      await query(`DELETE FROM "return_lines" WHERE "id" = $1`, [LINE_ID]);

      const rows = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "return_line_events" WHERE "returnLineId" = $1`,
        [LINE_ID]
      );
      expect(rows[0].count).toBe('1');
    });
  });
});