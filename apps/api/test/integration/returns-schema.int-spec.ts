/**
 * Returns Schema Integration Test (#2327, ADR-060)
 *
 * Verifies the `returns` / `return_lines` schema against real Postgres
 * (Testcontainers). Everything asserted here is a DATABASE-level guarantee that
 * a mock cannot express, which is the whole reason the file exists:
 *  - `CHK_return_lines_quantity_ordering` rejects both orderings it exists to
 *    forbid (received > advised; restocked + scrapped > received) and admits a
 *    legal partial receipt;
 *  - `UQ_returns_source_external` collides on a repeated non-null external id
 *    and does NOT collide on NULLs — the partial predicate is the point, since
 *    a source that mints no return id (Erli) would otherwise be able to hold
 *    exactly one return per connection, forever;
 *  - `UQ_return_lines_return_index` gives #2328 line-level replay idempotency;
 *  - an orphan return (`internalOrderId IS NULL`) inserts cleanly — the AC's
 *    central claim, and the one a NOT NULL column would silently break;
 *  - `refund_records` accepts a null AND an arbitrary non-existent `returnId`
 *    (linked, not extended — deliberately NO foreign key), and its column list
 *    is snapshotted so that "no existing refund column changed" is a test
 *    rather than a promise.
 *
 * **The harness builds its schema by `synchronize`, not by migration.** That is
 * why the CHECK and every index are declared on the ORM entities under the SAME
 * NAMES the migration uses — otherwise these assertions would hold only against
 * one of the two schemas, and the wrong one.
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

describe('Returns Schema Integration', () => {
  let harness: IntegrationTestHarness;

  const CONNECTION_A = '11111111-1111-1111-1111-111111111111';
  const CONNECTION_B = '22222222-2222-2222-2222-222222222222';

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

  const insertReturn = async (
    id: string,
    overrides: { externalReturnId?: string | null; internalOrderId?: string | null } = {}
  ): Promise<void> => {
    await query(
      `INSERT INTO "returns" ("id", "sourceConnectionId", "externalReturnId", "internalOrderId", "origin")
       VALUES ($1, $2, $3, $4, 'source_ingested')`,
      [
        id,
        CONNECTION_A,
        overrides.externalReturnId === undefined ? 'RET-1' : overrides.externalReturnId,
        overrides.internalOrderId === undefined ? 'ol_order_abc' : overrides.internalOrderId,
      ]
    );
  };

  const insertLine = async (
    returnId: string,
    lineIndex: number,
    counters: {
      advised?: number;
      received?: number;
      restocked?: number;
      scrapped?: number;
    } = {}
  ): Promise<void> => {
    await query(
      `INSERT INTO "return_lines"
         ("returnId", "lineIndex", "reason", "quantityAdvised", "quantityReceived", "quantityRestocked", "quantityScrapped")
       VALUES ($1, $2, 'withdrawal', $3, $4, $5, $6)`,
      [
        returnId,
        lineIndex,
        counters.advised ?? 2,
        counters.received ?? 0,
        counters.restocked ?? 0,
        counters.scrapped ?? 0,
      ]
    );
  };

  const messageOf = async (run: Promise<unknown>): Promise<string> => {
    try {
      await run;
      return 'NO ERROR RAISED';
    } catch (error) {
      return (error as QueryFailedError).message;
    }
  };

  describe('quantity ordering CHECK', () => {
    it('should reject a line whose received exceeds advised when inserted', async () => {
      await insertReturn('ol_return_check_1');

      const message = await messageOf(
        insertLine('ol_return_check_1', 0, { advised: 1, received: 2 })
      );

      expect(message).toContain('CHK_return_lines_quantity_ordering');
    });

    it('should reject a line disposing more than it received when inserted', async () => {
      await insertReturn('ol_return_check_2');

      const message = await messageOf(
        insertLine('ol_return_check_2', 0, {
          advised: 5,
          received: 2,
          restocked: 2,
          scrapped: 1,
        })
      );

      expect(message).toContain('CHK_return_lines_quantity_ordering');
    });

    it('should reject a negative counter when inserted', async () => {
      await insertReturn('ol_return_check_3');

      const message = await messageOf(
        insertLine('ol_return_check_3', 0, { advised: -1 })
      );

      expect(message).toContain('CHK_return_lines_quantity_ordering');
    });

    it('should admit a legal partial receipt and partial disposition when inserted', async () => {
      await insertReturn('ol_return_check_4');

      await insertLine('ol_return_check_4', 0, {
        advised: 5,
        received: 3,
        restocked: 2,
        scrapped: 1,
      });

      const rows = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "return_lines" WHERE "returnId" = $1`,
        ['ol_return_check_4']
      );
      expect(rows[0].count).toBe('1');
    });
  });

  describe('UQ_returns_source_external', () => {
    it('should reject a second return with the same non-null external id on one connection when inserted', async () => {
      await insertReturn('ol_return_uq_1', { externalReturnId: 'RET-DUP' });

      const message = await messageOf(
        insertReturn('ol_return_uq_2', { externalReturnId: 'RET-DUP' })
      );

      expect(message).toContain('UQ_returns_source_external');
    });

    it('should allow the same external id on a different connection when inserted', async () => {
      await insertReturn('ol_return_uq_3', { externalReturnId: 'RET-SHARED' });

      await query(
        `INSERT INTO "returns" ("id", "sourceConnectionId", "externalReturnId", "origin")
         VALUES ($1, $2, 'RET-SHARED', 'source_ingested')`,
        ['ol_return_uq_4', CONNECTION_B]
      );

      const rows = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "returns" WHERE "externalReturnId" = 'RET-SHARED'`
      );
      expect(rows[0].count).toBe('2');
    });

    it('should allow many id-less returns on one connection when inserted (the partial predicate)', async () => {
      await insertReturn('ol_return_uq_5', { externalReturnId: null });
      await insertReturn('ol_return_uq_6', { externalReturnId: null });
      await insertReturn('ol_return_uq_7', { externalReturnId: null });

      const rows = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "returns" WHERE "externalReturnId" IS NULL`
      );
      expect(rows[0].count).toBe('3');
    });
  });

  describe('UQ_return_lines_return_index', () => {
    it('should reject a second line at the same index on one return when inserted', async () => {
      await insertReturn('ol_return_line_uq');
      await insertLine('ol_return_line_uq', 0);

      const message = await messageOf(insertLine('ol_return_line_uq', 0));

      expect(message).toContain('UQ_return_lines_return_index');
    });

    it('should allow the same line index on a different return when inserted', async () => {
      await insertReturn('ol_return_line_a', { externalReturnId: 'RET-A' });
      await insertReturn('ol_return_line_b', { externalReturnId: 'RET-B' });

      await insertLine('ol_return_line_a', 0);
      await insertLine('ol_return_line_b', 0);

      const rows = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "return_lines" WHERE "lineIndex" = 0`
      );
      expect(rows[0].count).toBe('2');
    });
  });

  // `FK_return_lines_return` (ON DELETE CASCADE) is deliberately NOT asserted
  // here. It is declared in the MIGRATION only — there is no `@ManyToOne`
  // relation on `ReturnLineOrmEntity` (the `category_mappings` /
  // `inventory_locations` precedent), so `synchronize` never creates it and this
  // harness's schema does not carry it. Asserting a cascade here would test
  // nothing about the schema an operator actually runs. `setup.ts` records the
  // same consequence in the truncate list.

  describe('orphan returns', () => {
    it('should insert a return with no internalOrderId when the order is unknown', async () => {
      await insertReturn('ol_return_orphan', { internalOrderId: null });

      const rows = await query<{ id: string; internalOrderId: string | null }>(
        `SELECT "id", "internalOrderId" FROM "returns" WHERE "internalOrderId" IS NULL`
      );
      expect(rows).toEqual([{ id: 'ol_return_orphan', internalOrderId: null }]);
    });
  });

  describe('refund_records link', () => {
    const insertRefund = async (id: string, returnId: string | null): Promise<void> => {
      await query(
        `INSERT INTO "refund_records"
           ("internalOrderId", "amount", "currency", "reason", "recordedAt", "returnId")
         VALUES ($1, '19.99', 'PLN', 'withdrawal', now(), $2)`,
        [id, returnId]
      );
    };

    it('should accept a refund with no returnId when inserted', async () => {
      await insertRefund('ol_order_no_return', null);

      const rows = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "refund_records" WHERE "returnId" IS NULL`
      );
      expect(rows[0].count).toBe('1');
    });

    it('should accept a refund naming a return that does not exist when inserted (no FK, by design)', async () => {
      await insertRefund('ol_order_dangling', 'ol_return_never_created');

      const rows = await query<{ returnId: string | null }>(
        `SELECT "returnId" FROM "refund_records" WHERE "internalOrderId" = 'ol_order_dangling'`
      );
      expect(rows).toEqual([{ returnId: 'ol_return_never_created' }]);
    });

    /**
     * The AC's "no existing refund column changed", as a test. A snapshot of the
     * column list catches a rename, a drop, a type change and a nullability
     * change in one assertion — and fails loudly on a "while we're here" edit
     * to a table whose live rows already feed analytics.
     */
    /**
     * #2377's third acceptance criterion, as a test.
     *
     * The derived operator stage is a PRESENTATION PROJECTION: it is computed
     * from counters and timestamps in two places (a SQL `CASE` and a browser
     * function) and stored in neither. Persisting it would be a model change
     * needing its own ADR, and the cheapest way for one to arrive by the back
     * door is a "while we're here" column on a migration that is really about
     * something else. This fails the moment one appears.
     */
    it('should persist NO stage column on returns or return_lines', async () => {
      const columns = await query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name
           FROM information_schema.columns
          WHERE table_name IN ('returns', 'return_lines')
            AND column_name ILIKE '%stage%'
          ORDER BY table_name, column_name`
      );

      expect(columns).toEqual([]);
    });

    it('should leave every pre-existing refund column untouched when the returns migration runs', async () => {
      const columns = await query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_name = 'refund_records'
          ORDER BY column_name`
      );

      expect(columns).toEqual([
        { column_name: 'amount', data_type: 'numeric', is_nullable: 'NO' },
        { column_name: 'createdAt', data_type: 'timestamp with time zone', is_nullable: 'NO' },
        { column_name: 'currency', data_type: 'character varying', is_nullable: 'NO' },
        // #2371 — who moved the money. NOT NULL with a DEFAULT, which is the
        // whole backfill story: every pre-existing row reads
        // `operator_out_of_band`, the only value any shipped path can produce.
        { column_name: 'executedBy', data_type: 'character varying', is_nullable: 'NO' },
        { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
        { column_name: 'idempotencyKey', data_type: 'text', is_nullable: 'YES' },
        { column_name: 'internalOrderId', data_type: 'text', is_nullable: 'NO' },
        { column_name: 'note', data_type: 'text', is_nullable: 'YES' },
        { column_name: 'reason', data_type: 'text', is_nullable: 'NO' },
        { column_name: 'recordedAt', data_type: 'timestamp with time zone', is_nullable: 'NO' },
        // The one addition (#2327) — nullable, so every existing row is valid.
        { column_name: 'returnId', data_type: 'text', is_nullable: 'YES' },
        { column_name: 'updatedAt', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      ]);
    });
  });
});
