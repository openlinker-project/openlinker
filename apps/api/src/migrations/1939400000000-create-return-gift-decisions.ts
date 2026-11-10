/**
 * Create `return_gift_decisions` (#3943, gifts spec section 9, rule G5).
 *
 * The operator's decision about a gift on a return - keep, ask back, deduct. One
 * row per (return, gift line). A new table, nothing backfilled: no return has a
 * gift decision today, and a gift with no row is simply undecided. No foreign
 * keys, matching the returns context (indexed references by value).
 *
 * Generated: 2026-11-05 (synthetic sequential prefix per docs/migrations.md rule 3).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReturnGiftDecisions1939400000000 implements MigrationInterface {
  name = 'CreateReturnGiftDecisions1939400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "return_gift_decisions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "returnId" text NOT NULL,
        "giftLineId" text NOT NULL,
        "decision" character varying(16) NOT NULL,
        "deductionGross" numeric(14,2),
        "note" text,
        "decidedByUserId" text,
        "decidedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_return_gift_decisions" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_return_gift_decisions_decision" CHECK ("decision" IN ('keep','ask_back','deduct')),
        CONSTRAINT "CHK_return_gift_decisions_deduction" CHECK (("decision" = 'deduct') = ("deductionGross" IS NOT NULL))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_return_gift_decisions_return_gift" ON "return_gift_decisions" ("returnId", "giftLineId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_return_gift_decisions_return_gift"`);
    await queryRunner.query(`DROP TABLE "return_gift_decisions"`);
  }
}
