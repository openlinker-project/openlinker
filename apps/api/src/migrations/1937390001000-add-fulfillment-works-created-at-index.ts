/**
 * Index `fulfillment_works ("createdAt", "id")` (#3629).
 *
 * `inventory.saleDecrement.reconcileSweep` selects works inside a createdAt
 * window, oldest first, and without this the driving scan is a sequential read
 * of the table every 15 minutes. Synthetic sequential prefix per
 * docs/migrations.md rule 3.
 *
 * Renumbered from 1937370002000, which add-invoice-clearance-detail (#1578)
 * landed on `main` with first. A shared prefix leaves the apply order
 * undefined and `check-migration-timestamps` refuses it. The `up()` is
 * `IF NOT EXISTS`, so a database that already ran it under the old name
 * applies this one as a no-op.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFulfillmentWorksCreatedAtIndex1937390001000 implements MigrationInterface {
  name = 'AddFulfillmentWorksCreatedAtIndex1937390001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fulfillment_works_created_at" ON "fulfillment_works" ("createdAt", "id")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fulfillment_works_created_at"`);
  }
}
