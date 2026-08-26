/**
 * Automation Schema Integration Test (#2358, Wave-2 spec §5 + §7.2)
 *
 * Verifies the three automation tables against real Postgres (Testcontainers).
 * Everything asserted here is a DATABASE-level guarantee a mock cannot express,
 * and each is part of the contract the rest of body D builds on:
 *
 *  - `UQ_automation_trigger_firings_rule_subject` actually REJECTS a second
 *    firing for one `(rule, subject)` — the durable at-most-once guarantee
 *    #2360's `ON CONFLICT DO NOTHING` writer depends on, and the reason spec
 *    §5.2's "at most once, ever" is enforceable rather than aspirational;
 *  - …and does NOT serialize two different subjects of one rule against each
 *    other, which would stop a duration rule ever firing for a second order;
 *  - `UQ_automation_rules_trigger_hash_from` rejects the exact-duplicate race
 *    the service's semantic overlap check cannot see;
 *  - …and admits the same definition at a DIFFERENT `effectiveFrom`, which is
 *    the legitimate versioning case the guard must not forbid;
 *  - `isActive` defaults to false, so a row inserted by any path that omits it
 *    cannot arrive armed;
 *  - each column list is snapshotted, so a later widening cannot silently
 *    reshape a table a sibling issue was promised.
 *
 * **The harness builds its schema by `synchronize`, not by migration**, which is
 * why every index here is declared on the ORM entity under the same name as in
 * migration `1851000000000` — otherwise these assertions would hold against
 * only one of the two schemas.
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

describe('Automation Schema Integration', () => {
  let harness: IntegrationTestHarness;

  const RULE_A = '11111111-1111-4111-8111-111111111111';
  const RULE_B = '22222222-2222-4222-8222-222222222222';
  const ORDER_A = 'ol_order_aaa';
  const ORDER_B = 'ol_order_bbb';

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

  const insertRule = async (
    definitionHash: string,
    effectiveFrom = '2026-09-01',
    trigger = 'order.packed',
  ): Promise<string> => {
    const rows = await query<{ id: string }>(
      `INSERT INTO "automation_rules"
         ("name", "trigger", "triggerConfig", "conditions", "actions",
          "definitionHash", "effectiveFrom")
       VALUES ('Label and tell', $1, '{}'::jsonb, '[]'::jsonb,
               '[{"action":"relay-status-to-source"}]'::jsonb, $2, $3)
       RETURNING "id"`,
      [trigger, definitionHash, effectiveFrom],
    );
    return rows[0].id;
  };

  const insertFiring = async (ruleId: string, subjectId: string): Promise<string> => {
    const rows = await query<{ id: string }>(
      `INSERT INTO "automation_trigger_firings"
         ("ruleId", "subjectKind", "subjectId", "firedAt")
       VALUES ($1, 'order', $2, now())
       RETURNING "id"`,
      [ruleId, subjectId],
    );
    return rows[0].id;
  };

  describe('automation_rules', () => {
    it('should default a new rule to inactive so it cannot arrive armed', async () => {
      // Fails closed — a rule that has not been deliberately armed must not
      // spend money.
      const id = await insertRule('hash-a');
      const rows = await query<{ isActive: boolean; triggerConfig: unknown }>(
        `SELECT "isActive", "triggerConfig" FROM "automation_rules" WHERE "id" = $1`,
        [id],
      );
      expect(rows[0].isActive).toBe(false);
      expect(rows[0].triggerConfig).toEqual({});
    });

    it('should reject a second rule with the same trigger, hash and effective date', async () => {
      await insertRule('hash-a', '2026-09-01');

      let error: QueryFailedError | undefined;
      try {
        await insertRule('hash-a', '2026-09-01');
      } catch (caught) {
        error = caught as QueryFailedError;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain('UQ_automation_rules_trigger_hash_from');
    });

    it('should admit the same definition at a different effective date', async () => {
      // The versioning case: the service's overlap check owns whether the two
      // windows may coexist; the index must not forbid it outright.
      await insertRule('hash-a', '2026-09-01');
      await expect(insertRule('hash-a', '2027-01-01')).resolves.toEqual(expect.any(String));
    });

    it('should admit the same hash under a different trigger', async () => {
      await insertRule('hash-a', '2026-09-01', 'order.packed');
      await expect(
        insertRule('hash-a', '2026-09-01', 'return.received'),
      ).resolves.toEqual(expect.any(String));
    });

    it('should carry exactly the declared column set', async () => {
      const rows = await query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'automation_rules' ORDER BY column_name`,
      );
      expect(rows.map((row) => row.column_name)).toEqual([
        'actions',
        'conditions',
        'createdAt',
        'definitionHash',
        'effectiveFrom',
        'effectiveTo',
        'id',
        'isActive',
        'moneyAckAt',
        'moneyAckByUserId',
        'name',
        'trigger',
        'triggerConfig',
        'updatedAt',
      ]);
    });
  });

  describe('automation_trigger_firings', () => {
    it('should REJECT a second firing for the same rule and subject', async () => {
      // This index IS the at-most-once guarantee. A duration trigger whose
      // condition stays true for three days must not fire 288 times.
      await insertFiring(RULE_A, ORDER_A);

      let error: QueryFailedError | undefined;
      try {
        await insertFiring(RULE_A, ORDER_A);
      } catch (caught) {
        error = caught as QueryFailedError;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain('UQ_automation_trigger_firings_rule_subject');
    });

    it('should admit the same rule firing for a DIFFERENT subject', async () => {
      await insertFiring(RULE_A, ORDER_A);
      await expect(insertFiring(RULE_A, ORDER_B)).resolves.toEqual(expect.any(String));
    });

    it('should admit a DIFFERENT rule firing for the same subject', async () => {
      await insertFiring(RULE_A, ORDER_A);
      await expect(insertFiring(RULE_B, ORDER_A)).resolves.toEqual(expect.any(String));
    });

    it('should distinguish an order subject from a return subject with the same id', async () => {
      await insertFiring(RULE_A, ORDER_A);
      await expect(
        query(
          `INSERT INTO "automation_trigger_firings"
             ("ruleId", "subjectKind", "subjectId", "firedAt")
           VALUES ($1, 'return', $2, now())`,
          [RULE_A, ORDER_A],
        ),
      ).resolves.toBeDefined();
    });

    it('should carry exactly the declared column set', async () => {
      const rows = await query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'automation_trigger_firings' ORDER BY column_name`,
      );
      expect(rows.map((row) => row.column_name)).toEqual([
        'createdAt',
        'firedAt',
        'id',
        'ruleId',
        'subjectId',
        'subjectKind',
      ]);
    });
  });

  describe('automation_runs', () => {
    it('should accept a blocked run naming every colliding rule', async () => {
      // §5.6: "nothing ran, and the row says which rules collided". A single
      // ruleId can name one; blockedByRuleIds names both.
      const rows = await query<{ blockedByRuleIds: string[] }>(
        `INSERT INTO "automation_runs"
           ("ruleId", "ruleName", "trigger", "subjectKind", "subjectId",
            "outcome", "steps", "blockedByRuleIds", "firedAt")
         VALUES ($1, 'Label and tell', 'order.packed', 'order', $2,
                 'blocked', '[]'::jsonb, $3::jsonb, now())
         RETURNING "blockedByRuleIds"`,
        [RULE_A, ORDER_A, JSON.stringify([RULE_A, RULE_B])],
      );
      expect(rows[0].blockedByRuleIds).toEqual([RULE_A, RULE_B]);
    });

    it('should leave blockedByRuleIds null on an ordinary run', async () => {
      const rows = await query<{ blockedByRuleIds: string[] | null; steps: unknown }>(
        `INSERT INTO "automation_runs"
           ("ruleId", "ruleName", "trigger", "subjectKind", "subjectId",
            "outcome", "firedAt")
         VALUES ($1, 'Label and tell', 'order.packed', 'order', $2, 'done', now())
         RETURNING "blockedByRuleIds", "steps"`,
        [RULE_A, ORDER_A],
      );
      expect(rows[0].blockedByRuleIds).toBeNull();
      expect(rows[0].steps).toEqual([]);
    });

    it('should keep a run readable after its rule is deleted', async () => {
      // No FK: a deleted rule must neither destroy its history nor be blocked
      // by it, and the frozen ruleName is what keeps the orphan renderable.
      const ruleId = await insertRule('hash-a');
      await query(
        `INSERT INTO "automation_runs"
           ("ruleId", "ruleName", "trigger", "subjectKind", "subjectId", "outcome", "firedAt")
         VALUES ($1, 'Label and tell', 'order.packed', 'order', $2, 'done', now())`,
        [ruleId, ORDER_A],
      );
      await query(`DELETE FROM "automation_rules" WHERE "id" = $1`, [ruleId]);

      const rows = await query<{ ruleName: string }>(
        `SELECT "ruleName" FROM "automation_runs" WHERE "ruleId" = $1`,
        [ruleId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].ruleName).toBe('Label and tell');
    });

    it('should carry exactly the declared column set', async () => {
      const rows = await query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'automation_runs' ORDER BY column_name`,
      );
      expect(rows.map((row) => row.column_name)).toEqual([
        'blockedByRuleIds',
        'createdAt',
        'firedAt',
        'id',
        'outcome',
        'ruleId',
        'ruleName',
        'steps',
        'subjectId',
        'subjectKind',
        'trigger',
      ]);
    });
  });
});
