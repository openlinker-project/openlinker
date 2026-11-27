/**
 * Gift rules (#3938): list position on automation rules, plus the gift rule state
 * and grant ledger tables.
 *
 * A gift rule is an ordinary `automation_rules` row (trigger `order.ingested`, one
 * `add-gift` action). What changes while it runs does not belong on that row,
 * whose definition hash is its identity:
 *  - `automation_rules.position` is the explicit list order "do not combine" is
 *    defined against (nullable; only gift rules use it).
 *  - `automation_gift_rule_state` holds why a rule is paused and how far an
 *    operator raised its cap.
 *  - `automation_gift_grants` is one row per (rule, order): the idempotency
 *    guarantee for re-ingestion and what the unit cap and the per-customer limit
 *    are summed over.
 * Neither new table carries a foreign key (indexed references by value, the
 * `automation_trigger_firings` precedent), so a deleted rule keeps its history.
 *
 * Declared on the ORM entities as well, because the integration harness builds
 * schema by `synchronize`.
 *
 * Generated: 2026-11-05 (synthetic sequential prefix per docs/migrations.md rule 3).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGiftRules1939200000000 implements MigrationInterface {
  name = 'CreateGiftRules1939200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "automation_rules" ADD COLUMN "position" integer`);
    await queryRunner.query(
      `CREATE TABLE "automation_gift_rule_state" (
        "ruleId" uuid NOT NULL,
        "pausedReason" character varying(32),
        "pausedAt" TIMESTAMP WITH TIME ZONE,
        "capExtension" integer NOT NULL DEFAULT 0,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_gift_rule_state" PRIMARY KEY ("ruleId")
      )`
    );
    await queryRunner.query(
      `CREATE TABLE "automation_gift_grants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ruleId" uuid NOT NULL,
        "internalOrderId" text NOT NULL,
        "customerId" text,
        "quantity" integer NOT NULL,
        "productId" text NOT NULL,
        "variantId" text NOT NULL,
        "documentForm" character varying(32),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_gift_grants" PRIMARY KEY ("id")
      )`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_automation_gift_grants_rule_order" ON "automation_gift_grants" ("ruleId", "internalOrderId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_automation_gift_grants_rule_customer" ON "automation_gift_grants" ("ruleId", "customerId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_automation_gift_grants_order" ON "automation_gift_grants" ("internalOrderId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_automation_gift_grants_variant" ON "automation_gift_grants" ("variantId", "createdAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automation_gift_grants_variant"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automation_gift_grants_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automation_gift_grants_rule_customer"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_automation_gift_grants_rule_order"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_gift_grants"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_gift_rule_state"`);
    await queryRunner.query(`ALTER TABLE "automation_rules" DROP COLUMN "position"`);
  }
}
