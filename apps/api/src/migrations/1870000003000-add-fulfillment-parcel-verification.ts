/**
 * Parcel verification at the pack bench (#2418, `W3b-5`, spec § 2.5)
 *
 * Two things: the ledger of units verified into a box, and the instant the box
 * shut.
 *
 * ## `fulfillment_works."parcelClosedAt"`
 *
 * The completion instant #2413 deliberately withheld — its own words: *"no
 * `packedAt` is added here because that would be a second completion instant
 * competing with the model #2418 owns."* This is that model's instant, written
 * in the same statement as `packedByUserId` on the verification that completes
 * the last line (D18: the parcel closes on the last verification, with no
 * confirmation step).
 *
 * It is deliberately NOT `fulfillment_works."status" = 'closed'`. That status is
 * the executor's completion of the whole job; packing is one part of it, and a
 * packed parcel is not a finished one — it still has to be labelled and leave.
 * Telling the rest of the system about a packed parcel is #2420's.
 *
 * ## `fulfillment_work_verifications`
 *
 * One row per unit, append-only. What the table does NOT carry is the point:
 * no `source`, no `barcode`, no `manual` — a hand-confirmed unit is recorded
 * identically to a scanned one (D20), as a property of the schema rather than a
 * convention. It carries no `quantity` either: one row is one physical gesture,
 * which is what makes `gestureId` able to promise that one action is recorded
 * once while a legitimate second scan is a second unit.
 *
 * Every constraint is created under the SAME NAME the ORM entity declares. The
 * integration harness builds its schema by TypeORM `synchronize` rather than by
 * running migrations, so a name present in one and not the other holds in
 * production and silently not in tests — the drift
 * `fulfillment-work-migration-parity.int-spec.ts` exists to catch, and which
 * this migration adds the new table to.
 *
 * ## The down migration is NOT lossless, unlike its `expeditedAt` sibling
 *
 * Dropping the ledger discards who verified what into which box, which is
 * dispute evidence (D1) rather than an ordering preference. A revert is
 * recoverable only in the sense that the parcels can be re-verified; the record
 * of who packed them the first time is gone. Stated so the asymmetry with
 * #2416's migration is a decision a reader can see rather than an assumption.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFulfillmentParcelVerification1870000003000 implements MigrationInterface {
  name = 'AddFulfillmentParcelVerification1870000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" ADD COLUMN IF NOT EXISTS "parcelClosedAt" TIMESTAMP WITH TIME ZONE`
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fulfillment_work_verifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "fulfillmentWorkId" text NOT NULL,
        "workLineId" uuid NOT NULL,
        "gestureId" text NOT NULL,
        "verifiedByUserId" uuid,
        "verifiedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "voidedAt" TIMESTAMP WITH TIME ZONE,
        "voidedByUserId" uuid,
        CONSTRAINT "PK_fulfillment_work_verifications" PRIMARY KEY ("id")
      )
    `);

    // The ONE foreign key this table wants. A verification is a part of its
    // work, not a peer of it, so deleting a work must take its ledger with it —
    // the `fulfillment_work_lines` precedent, declared here and not as a
    // `@ManyToOne`.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_fulfillment_work_verifications_work'
        ) THEN
          ALTER TABLE "fulfillment_work_verifications"
            ADD CONSTRAINT "FK_fulfillment_work_verifications_work"
            FOREIGN KEY ("fulfillmentWorkId") REFERENCES "fulfillment_works"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    // The idempotency key, and it IS the enforcement — a read-then-insert
    // enforces nothing at READ COMMITTED, because the conflicting row is a
    // phantom that cannot be locked before it exists.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fulfillment_work_verifications_gesture"
        ON "fulfillment_work_verifications" ("fulfillmentWorkId", "gestureId")
    `);

    // The count read. Partial on the ACTIVE rows: a voided row is history and
    // must leave the index the moment a reopen writes `voidedAt`.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fulfillment_work_verifications_active"
        ON "fulfillment_work_verifications" ("fulfillmentWorkId", "workLineId")
        WHERE "voidedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_fulfillment_work_verifications_active"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_fulfillment_work_verifications_gesture"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fulfillment_work_verifications"`);
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" DROP COLUMN IF EXISTS "parcelClosedAt"`
    );
  }
}
