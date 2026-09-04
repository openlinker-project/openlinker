/**
 * Fulfillment Work Schema Integration Test (#2392, ADR-054, DESIGN §5.2)
 *
 * Verifies the `fulfillment_works` / `fulfillment_work_lines` /
 * `fulfillment_holds` schema against real Postgres (Testcontainers). Everything
 * asserted here is a DATABASE-level guarantee a mock cannot express:
 *
 *  - `CHK_fulfillment_work_lines_capacity` rejects an over-fulfilment AND every
 *    negative counter — the DB twin of the pure
 *    `checkFulfillmentWorkLineCapacity`, which #2392 widened so the two are one
 *    rule rather than two similar ones;
 *  - `CHK_fulfillment_holds_actor` requires EXACTLY one actor, rejecting both
 *    "neither" (the shape a service-placed hold hits first) and "both";
 *  - `UQ_fulfillment_work_lines_work_order_line` makes one order line's
 *    participation in one work singular;
 *  - `fulfillment_holds` admits MANY open holds per work — the absence of an
 *    `order_holds`-style partial unique index is a deliberate grain difference
 *    (DESIGN §5.2 allows stacking here), so it is asserted rather than assumed;
 *  - the column lists are snapshotted, so a column added or dropped is a test
 *    failure rather than a surprise for #2395/#2399/#2400/#2406.
 *
 * **The harness builds its schema by `synchronize`, not by migration.** That is
 * why every CHECK and index is declared on the ORM entities under the SAME
 * NAMES the migration uses — otherwise these assertions would hold against one
 * of the two schemas, and the wrong one. It is also why the two `ON DELETE
 * CASCADE` foreign keys are NOT asserted here: `synchronize` builds no FKs at
 * all. CASCADE is covered by `fulfillment-work-migration-parity.int-spec.ts`,
 * which builds the migration's schema for real and exercises the delete against
 * it — automated, not manual.
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

describe('Fulfillment Work Schema Integration', () => {
  let harness: IntegrationTestHarness;

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

  const messageOf = async (run: Promise<unknown>): Promise<string> => {
    try {
      await run;
      return 'NO ERROR RAISED';
    } catch (error) {
      return (error as QueryFailedError).message;
    }
  };

  const insertWork = async (id: string): Promise<void> => {
    await query(
      `INSERT INTO "fulfillment_works" ("id", "orderId", "status", "requestStatus")
       VALUES ($1, $2, 'open', 'unsubmitted')`,
      [id, `ol_order_${id}`]
    );
  };

  const insertLine = async (
    workId: string,
    orderLineId: string,
    counters: { total: number; fulfilled?: number; cancelled?: number }
  ): Promise<unknown> =>
    query(
      `INSERT INTO "fulfillment_work_lines"
         ("fulfillmentWorkId", "orderLineId", "productVariantId",
          "totalQuantity", "fulfilledQuantity", "cancelledQuantity")
       VALUES ($1, $2, 'ol_variant_1', $3, $4, $5)`,
      [workId, orderLineId, counters.total, counters.fulfilled ?? 0, counters.cancelled ?? 0]
    );

  const insertHold = async (
    workId: string,
    actor: { placedByUserId?: string | null; placedByService?: string | null }
  ): Promise<unknown> =>
    query(
      `INSERT INTO "fulfillment_holds"
         ("fulfillmentWorkId", "reason", "placedByUserId", "placedByService", "placedAt")
       VALUES ($1, 'operator', $2, $3, now())`,
      [workId, actor.placedByUserId ?? null, actor.placedByService ?? null]
    );

  /**
   * Column NAME + type + nullability + default.
   *
   * Names alone were the first version of this, and names alone miss the drift
   * class the plan flags as the top risk: a `NOT NULL` on one side only, or a
   * missing `DEFAULT 0` on `version`, changes behaviour while every name still
   * matches. `table_schema = 'public'` keeps a same-named table in another
   * schema from silently unioning extra rows in.
   */
  const columnsOf = async (table: string): Promise<string[]> => {
    const rows = await query<{
      column_name: string;
      data_type: string;
      character_maximum_length: number | null;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY column_name`,
      [table]
    );
    return rows.map((r) => {
      // `data_type` alone renders `character varying`, losing the length — so a
      // varchar(32) widened to varchar(255) would pass the snapshot.
      const type =
        r.character_maximum_length === null
          ? r.data_type
          : `${r.data_type}(${r.character_maximum_length})`;
      return (
        `${r.column_name} ${type} ${r.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}` +
        `${r.column_default === null ? '' : ` DEFAULT ${r.column_default}`}`
      );
    });
  };

  describe('column sets', () => {
    it('should carry exactly the fulfillment_works columns the wave depends on', async () => {
      expect(await columnsOf('fulfillment_works')).toEqual([
        // #2399's acceptance claim column and the holder's own reference. Both
        // nullable: the claim's at-most-once semantics come from
        // `recordAcceptance`'s conditional UPDATE, never from the column being
        // populated, and a holder may report neither.
        'acceptedAt timestamp with time zone NULL',
        'assignedConnectionId uuid NULL',
        'assignmentAttempt integer NOT NULL DEFAULT 0',
        'cancellationReason character varying(64) NULL',
        'cancelledAt timestamp with time zone NULL',
        'createdAt timestamp with time zone NOT NULL DEFAULT now()',
        'deliveryMethod text NULL',
        'dispatchRelayedAt timestamp with time zone NULL',
        'externalWorkId text NULL',
        'id text NOT NULL',
        'locationId text NULL',
        'orderId text NOT NULL',
        // #2413, ADR-071 decision 2. `uuid` for the user id (the order-grain
        // fact derived from it lands on `order_records.packedByUserId`, which
        // is `uuid`), `text` for the free-form service name. Guarded together
        // by CHK_fulfillment_works_packed_actor, asserted below.
        'packedByService text NULL',
        'packedByUserId uuid NULL',
        "requestStatus character varying(32) NOT NULL DEFAULT 'unsubmitted'::character varying",
        "status character varying(32) NOT NULL DEFAULT 'open'::character varying",
        'updatedAt timestamp with time zone NOT NULL DEFAULT now()',
        'version integer NOT NULL DEFAULT 0',
      ]);
    });

    it('should carry exactly the fulfillment_work_lines columns', async () => {
      expect(await columnsOf('fulfillment_work_lines')).toEqual([
        'cancelledQuantity integer NOT NULL DEFAULT 0',
        'createdAt timestamp with time zone NOT NULL DEFAULT now()',
        'fulfilledQuantity integer NOT NULL DEFAULT 0',
        'fulfillmentWorkId text NOT NULL',
        'id uuid NOT NULL DEFAULT uuid_generate_v4()',
        'orderLineId text NOT NULL',
        'productVariantId text NOT NULL',
        'totalQuantity integer NOT NULL',
        'updatedAt timestamp with time zone NOT NULL DEFAULT now()',
      ]);
    });

    it('should carry exactly the fulfillment_holds columns', async () => {
      expect(await columnsOf('fulfillment_holds')).toEqual([
        'createdAt timestamp with time zone NOT NULL DEFAULT now()',
        'fulfillmentWorkId text NOT NULL',
        'id uuid NOT NULL DEFAULT uuid_generate_v4()',
        'note text NULL',
        'placedAt timestamp with time zone NOT NULL',
        'placedByService text NULL',
        'placedByUserId text NULL',
        'reason character varying(64) NOT NULL',
        'releaseNote text NULL',
        'releasedAt timestamp with time zone NULL',
        'releasedByUserId text NULL',
        'updatedAt timestamp with time zone NOT NULL DEFAULT now()',
      ]);
    });
  });

  describe('CHK_fulfillment_work_lines_capacity', () => {
    it('should admit a legal partial fulfilment', async () => {
      await insertWork('ol_fw_ok');
      await expect(
        insertLine('ol_fw_ok', 'l1', { total: 5, fulfilled: 3, cancelled: 2 })
      ).resolves.toBeDefined();
    });

    it('should reject an over-fulfilment at the DB level', async () => {
      // The AC's central claim: "3 of 5 shipped" must never become "6 of 5".
      await insertWork('ol_fw_over');
      const message = await messageOf(
        insertLine('ol_fw_over', 'l1', { total: 5, fulfilled: 4, cancelled: 2 })
      );
      expect(message).toContain('CHK_fulfillment_work_lines_capacity');
    });

    it('should reject a negative fulfilled quantity', async () => {
      // This is the case the pure function used to ACCEPT (remaining stays
      // positive), and the reason #2392 widened it. Asserted here so the two
      // halves of one rule cannot drift apart again.
      await insertWork('ol_fw_neg');
      const message = await messageOf(insertLine('ol_fw_neg', 'l1', { total: 5, fulfilled: -1 }));
      expect(message).toContain('CHK_fulfillment_work_lines_capacity');
    });

    it('should reject a negative cancelled quantity', async () => {
      await insertWork('ol_fw_negc');
      const message = await messageOf(insertLine('ol_fw_negc', 'l1', { total: 5, cancelled: -1 }));
      expect(message).toContain('CHK_fulfillment_work_lines_capacity');
    });
  });

  describe('UQ_fulfillment_work_lines_work_order_line', () => {
    it('should reject a second line for the same order line on the same work', async () => {
      await insertWork('ol_fw_dup');
      await insertLine('ol_fw_dup', 'l1', { total: 1 });
      const message = await messageOf(insertLine('ol_fw_dup', 'l1', { total: 1 }));
      expect(message).toContain('UQ_fulfillment_work_lines_work_order_line');
    });

    it('should allow the same order line on a DIFFERENT work', async () => {
      // A re-routed line legitimately participates in a second work object.
      await insertWork('ol_fw_a');
      await insertWork('ol_fw_b');
      await insertLine('ol_fw_a', 'shared-line', { total: 1 });
      await expect(insertLine('ol_fw_b', 'shared-line', { total: 1 })).resolves.toBeDefined();
    });
  });

  describe('CHK_fulfillment_holds_actor', () => {
    it('should accept a human-placed hold', async () => {
      await insertWork('ol_fw_h1');
      await expect(insertHold('ol_fw_h1', { placedByUserId: 'u1' })).resolves.toBeDefined();
    });

    it('should accept a service-placed hold', async () => {
      await insertWork('ol_fw_h2');
      await expect(insertHold('ol_fw_h2', { placedByService: 'router' })).resolves.toBeDefined();
    });

    it('should reject a hold with NEITHER actor', async () => {
      // The shape a service-placed hold hits first if the caller forgets.
      await insertWork('ol_fw_h3');
      const message = await messageOf(insertHold('ol_fw_h3', {}));
      expect(message).toContain('CHK_fulfillment_holds_actor');
    });

    it('should reject a hold claiming BOTH actors', async () => {
      // Not a richer record — an unanswerable audit question.
      await insertWork('ol_fw_h4');
      const message = await messageOf(
        insertHold('ol_fw_h4', { placedByUserId: 'u1', placedByService: 'router' })
      );
      expect(message).toContain('CHK_fulfillment_holds_actor');
    });
  });

  describe('CHK_fulfillment_works_packed_actor (#2413)', () => {
    const insertPacked = (id: string, actor: Record<string, string>): Promise<unknown> => {
      const cols = Object.keys(actor);
      const values = Object.values(actor);
      return query(
        `INSERT INTO "fulfillment_works" ("id", "orderId", "status", "requestStatus"${cols
          .map((c) => `, "${c}"`)
          .join('')})
         VALUES ($1, $2, 'open', 'unsubmitted'${values.map((_, i) => `, $${i + 3}`).join('')})`,
        [id, `ol_order_${id}`, ...values]
      );
    };

    it('should accept a work with NEITHER actor — the normal, unpacked state', async () => {
      // THE difference from `CHK_fulfillment_holds_actor`, which is a true XOR.
      // A hold always has an actor; a work is CREATED unpacked and spends most
      // of its life that way, so copying `<>` would refuse every INSERT the
      // router makes. If this test ever fails, the constraint was "tidied" into
      // the holds shape and the router is broken.
      await expect(insertPacked('ol_fw_p1', {})).resolves.toBeDefined();
    });

    it('should accept a work packed by a human', async () => {
      await expect(
        insertPacked('ol_fw_p2', { packedByUserId: '00000000-0000-0000-0000-000000000001' })
      ).resolves.toBeDefined();
    });

    it('should accept a work packed by a service', async () => {
      await expect(insertPacked('ol_fw_p3', { packedByService: '3pl' })).resolves.toBeDefined();
    });

    it('should reject a work claiming BOTH a human and a service packed it', async () => {
      // What the pair exists to prevent: "a 3PL packed this" and "a human
      // packed it" must never be the same value.
      const message = await messageOf(
        insertPacked('ol_fw_p4', {
          packedByUserId: '00000000-0000-0000-0000-000000000001',
          packedByService: '3pl',
        })
      );
      expect(message).toContain('CHK_fulfillment_works_packed_actor');
    });
  });

  describe('hold stacking', () => {
    it('should admit many simultaneously-open holds on one work', async () => {
      // The grain difference from `order_holds`, which carries
      // `UQ_order_holds_open_order` and permits exactly one. Asserted rather
      // than assumed: adding that index here "for symmetry" would silently
      // break DESIGN §5.2's ≤10 stacking.
      await insertWork('ol_fw_stack');
      for (let i = 0; i < 5; i += 1) {
        await insertHold('ol_fw_stack', { placedByService: `svc-${i}` });
      }

      const [{ count }] = await query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "fulfillment_holds"
         WHERE "fulfillmentWorkId" = $1 AND "releasedAt" IS NULL`,
        ['ol_fw_stack']
      );
      expect(count).toBe('5');
    });
  });
});
