/**
 * Index `fulfillment_works ("createdAt", "id")` (#3629).
 *
 * `inventory.saleDecrement.reconcileSweep` selects works inside a createdAt
 * window, oldest first, and without this the driving scan is a sequential read
 * of the table every 15 minutes. Synthetic sequential prefix per
 * docs/migrations.md rule 3 (1937370001000 is the current tail).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFulfillmentWorksCreatedAtIndex1937370002000 implements MigrationInterface {
  name = 'AddFulfillmentWorksCreatedAtIndex1937370002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fulfillment_works_created_at" ON "fulfillment_works" ("createdAt", "id")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fulfillment_works_created_at"`);
  }
}
