/**
 * Create Automation Tables Migration (#2358, Wave-2 spec §5 + §7.2)
 *
 * Creates the three tables behind OMS automation v1 — `automation_rules`,
 * `automation_runs` and `automation_trigger_firings` — in the shape of the
 * shipped `sales_document_rules` engine (#2161/#2170), so this repo carries one
 * answer to "how is a rule stored and evaluated" rather than two.
 *
 * Six choices are the contract rather than housekeeping.
 *
 * - **Scoped by `trigger`, not by country** (spec §5.5 divergence 1). #2161
 *   indexes by country because the law is its scoping axis; here the operator's
 *   model is *"when X happens, do Y"*, so `trigger` is the scope column and the
 *   index axis. `TRIGGER` is *non-reserved* in Postgres and legal as a column
 *   name; every identifier here is quoted, and **hand-written SQL over these
 *   tables must quote it too** (#2385/#2386 write raw SQL for the run log).
 *
 * - **`UQ_automation_rules_trigger_hash_from` is the duplicate guard's LAST
 *   line, not its only one.** `definitionHash` is one combined SHA-256 over the
 *   canonicalized `(trigger, triggerConfig, conditions, actions)` — the AC
 *   requires rejecting an identical *trigger+conditions+actions* rule, so the
 *   action list is part of rule identity, which #2161's `conditionsHash` has no
 *   counterpart for. `AutomationRulesService` applies the semantic
 *   effective-range OVERLAP check the index cannot express; the index catches
 *   the exact same-`effectiveFrom` race.
 *
 * - **No `priority` column, and no `CHECK` on the action-list length.** The
 *   first is #2170's own deliberate removal (a silent tie-break on an action
 *   that spends money is what the #2047 lineage exists to prevent). The second
 *   is sharper: the integration harness builds schema by TypeORM `synchronize`,
 *   which emits no raw CHECK — a constraint present only here would hold in
 *   production and silently not in tests. The 1..3 cap is a service invariant.
 *   For the same reason every vocabulary column is a plain `character varying`
 *   with no PG enum: `is*` narrowers coerce on read.
 *
 * - **`automation_runs.blockedByRuleIds` exists because a `blocked` run has
 *   more than one rule to name.** Spec §5.6: *"`Blocked` is the #2047
 *   two-money-rules case — nothing ran, and the row says which rules
 *   collided."* Populated only for `outcome = 'blocked'`; `ruleId` stays NOT
 *   NULL on every row and means *the rule whose evaluation raised the
 *   collision*, never *the rule that acted*.
 *
 * - **`IDX_automation_runs_failed` is PARTIAL.** The AF-X attention count runs
 *   on every page load, on installs where the healthy answer is zero (#2100);
 *   a partial index is near-empty there. The predicate must stay identical to
 *   the one declared on `AutomationRunOrmEntity`, because of the `synchronize`
 *   point above.
 *
 * - **`automation_trigger_firings` is a THIRD table, not a reuse of
 *   `automation_runs`, because the retention policies are incompatible.** Spec
 *   §5.6 keeps runs for 90 days; spec §5.2 requires the deadline-sweep
 *   guarantee to hold *"at most once per (rule, order), **ever**"*. A table
 *   pruned quarterly cannot enforce a forever-guarantee: on day 91 the sweep
 *   re-fires every pair it already handled, and on a T4 rule wired to A2 that
 *   is a second label bought with real money. Its unique key deliberately
 *   EXCLUDES `definitionHash` — *"editing a rule does not erase its firing
 *   record"* — and adding it would silently re-arm every T3/T4 rule against its
 *   whole backlog on the next edit.
 *
 * There is deliberately **no FK** anywhere here — not from `automation_runs` or
 * `automation_trigger_firings` to `automation_rules` (a deleted rule must
 * neither destroy its history nor be blocked by it; `ruleName` and `trigger`
 * are frozen on the run row so an orphan still renders), and not from
 * `subjectId` to `order_records` (the `order_changes` / `refund_records`
 * precedent of an indexed reference by value). Nothing therefore cascades into
 * these tables, so `apps/api/test/integration/setup.ts` truncates all three
 * explicitly.
 *
 * Generated: 2026-08-26 (synthetic sequential prefix per docs/migrations.md
 * rule 3; slot pre-allocated for this issue — 1849/1850/1852/1853 are held by
 * concurrent Wave-2 siblings).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAutomationTables1851000000000 implements MigrationInterface {
  name = 'CreateAutomationTables1851000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `id` defaults to uuid_generate_v4() — the same guard 1846/1847 use.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation_rules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" text NOT NULL,
        "trigger" character varying(64) NOT NULL,
        "triggerConfig" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "conditions" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "definitionHash" character varying(64) NOT NULL,
        "isActive" boolean NOT NULL DEFAULT false,
        "effectiveFrom" date NOT NULL,
        "effectiveTo" date,
        "moneyAckByUserId" uuid,
        "moneyAckAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_rules" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_automation_rules_trigger_hash_from"
        ON "automation_rules" ("trigger", "definitionHash", "effectiveFrom")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_rules_trigger_active"
        ON "automation_rules" ("trigger", "isActive")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ruleId" uuid NOT NULL,
        "ruleName" text NOT NULL,
        "trigger" character varying(64) NOT NULL,
        "subjectKind" character varying(16) NOT NULL,
        "subjectId" text NOT NULL,
        "outcome" character varying(32) NOT NULL,
        "steps" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "blockedByRuleIds" jsonb,
        "firedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_runs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_runs_fired_at"
        ON "automation_runs" ("firedAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_runs_rule"
        ON "automation_runs" ("ruleId", "firedAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_runs_subject"
        ON "automation_runs" ("subjectKind", "subjectId", "firedAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_runs_failed"
        ON "automation_runs" ("firedAt")
        WHERE "outcome" = 'failed'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation_trigger_firings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ruleId" uuid NOT NULL,
        "subjectKind" character varying(16) NOT NULL,
        "subjectId" text NOT NULL,
        "firedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_trigger_firings" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_automation_trigger_firings_rule_subject"
        ON "automation_trigger_firings" ("ruleId", "subjectKind", "subjectId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_automation_trigger_firings_rule_subject"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_trigger_firings"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automation_runs_failed"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automation_runs_subject"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automation_runs_rule"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automation_runs_fired_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_runs"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automation_rules_trigger_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_automation_rules_trigger_hash_from"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_rules"`);
  }
}
