/**
 * Executor handshake schema (#2399, `W3a-10`, ADR-054, DESIGN §5.4).
 *
 * Two acceptance columns on `fulfillment_works`, and the `fulfillment_work_rejections`
 * child table.
 *
 * Three choices below are **contract rather than housekeeping**:
 *
 * - **`acceptedAt` is a CLAIM column, not a timestamp.**
 *   `fulfillment-request-status.types.ts` states it verbatim: "ADR-054 makes
 *   acceptance a conditional claim (`WHERE acceptedAt IS NULL`), so at most one
 *   holder can accept; the claim column and its at-most-once semantics land with
 *   #2399." `recordAcceptance` carries that guard. It is nullable because the
 *   value is the HOLDER's instant and stays null when the holder reports none —
 *   at-most-once comes from the conditional UPDATE, not from the column being
 *   populated.
 *
 * - **Rejections are a TABLE, not the two columns #2392 deferred.** `blocking`
 *   exists so re-sourcing can exclude a rejecter — without it, "re-source plus a
 *   deterministic sort re-picks the refuser forever". An exclusion is a SET: A
 *   refuses, the router tries B, B refuses too. A scalar pair on the work row
 *   holds only the LAST refusal, so A's exclusion is lost and the loop the field
 *   exists to terminate runs anyway. `orderId` is denormalised so the lineage
 *   survives whichever way #2395 decides re-sourcing works (reuse the row, or
 *   mint a new one) with no second migration.
 *
 * - **`UQ_fulfillment_work_rejections_work_attempt` is a real invariant**, not a
 *   convenience: one recorded answer per attempt. `recordRejection`'s transaction
 *   guard enforces it only incidentally, and an incidental invariant is one a
 *   later caller breaks. Its leading column also serves the FK's referential
 *   check, so — like `fulfillment_work_lines` and unlike `fulfillment_holds`,
 *   whose only other index is partial — no separate `(fulfillmentWorkId)` index
 *   is needed for the CASCADE.
 *
 * The FK is CASCADE and declared here only, with no `@ManyToOne` on the entity —
 * the `fulfillment_work_lines` / `fulfillment_holds` precedent in this same
 * slice. `connectionId` gets a reference by value with no FK, matching
 * `fulfillment_works.assignedConnectionId`.
 *
 * Generated: 2026-08-30 (synthetic sequential prefix per docs/migrations.md
 * rule 3; 1864000000000 is #2392's fulfillment work tables; 1865000000000 is claimed concurrently by #2394's routing_decisions, so this slice takes 1866000000000 rather than collide).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFulfillmentHandshake1866000000000 implements MigrationInterface {
  name = 'AddFulfillmentHandshake1866000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The rejection id defaults to uuid_generate_v4() — the same guard
    // 1864000000000 uses. Idempotent, so it costs nothing where #2392 already ran.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      ALTER TABLE "fulfillment_works"
        ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(`
      ALTER TABLE "fulfillment_works"
        ADD COLUMN IF NOT EXISTS "externalWorkId" text
    `);

    // #2400's inbound-progress correlation read (its shape deferred to #2399,
    // which owns the writer). COMPOSITE and NOT keyed on "externalWorkId"
    // alone: the value is a third party's, so two holders may both mint "1" and
    // an unscoped lookup would correlate one holder's webhook onto another's
    // work. Partial — a row with no vendor reference can never match. Non-unique
    // because OL cannot assert uniqueness on a vendor's behalf, and a unique
    // index would refuse a legitimate acceptance.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fulfillment_works_external_work_id"
        ON "fulfillment_works" ("assignedConnectionId", "externalWorkId")
        WHERE "externalWorkId" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fulfillment_work_rejections" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "fulfillmentWorkId" text NOT NULL,
        "orderId" text NOT NULL,
        "connectionId" uuid NOT NULL,
        "assignmentAttempt" integer NOT NULL,
        "reason" text NOT NULL,
        "blocking" boolean NOT NULL,
        "detail" text,
        "rejectedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fulfillment_work_rejections" PRIMARY KEY ("id"),
        CONSTRAINT "FK_fulfillment_work_rejections_work" FOREIGN KEY ("fulfillmentWorkId")
          REFERENCES "fulfillment_works"("id") ON DELETE CASCADE
      )
    `);

    // One recorded answer per attempt. Leading column also serves the FK check.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fulfillment_work_rejections_work_attempt"
        ON "fulfillment_work_rejections" ("fulfillmentWorkId", "assignmentAttempt")
    `);
    // The exclusion read. Partial: a non-blocking rejection is exactly the set
    // this lookup can never match.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fulfillment_work_rejections_blocking"
        ON "fulfillment_work_rejections" ("fulfillmentWorkId", "connectionId")
        WHERE "blocking" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fulfillment_work_rejections_blocking"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_fulfillment_work_rejections_work_attempt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fulfillment_work_rejections"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fulfillment_works_external_work_id"`);
    await queryRunner.query(`ALTER TABLE "fulfillment_works" DROP COLUMN IF EXISTS "externalWorkId"`);
    await queryRunner.query(`ALTER TABLE "fulfillment_works" DROP COLUMN IF EXISTS "acceptedAt"`);
  }
}
