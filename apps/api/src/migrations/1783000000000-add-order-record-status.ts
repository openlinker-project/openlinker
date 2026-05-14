/**
 * Add Order Record Status
 *
 * Adds a `recordStatus` column to `order_records` to track whether an order's
 * item refs have been fully resolved (`ready`) or are awaiting offer→variant
 * mapping (`awaiting_mapping`). Zero-downtime: existing rows default to `ready`.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordStatus1783000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN "recordStatus" VARCHAR NOT NULL DEFAULT 'ready'`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_order_records_record_status" ON "order_records" ("recordStatus")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_order_records_record_status"`);
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN "recordStatus"`);
  }
}
