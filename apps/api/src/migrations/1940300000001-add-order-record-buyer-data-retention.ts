/**
 * Add `hiddenAt` and `personalDataErasedAt` to `order_records` (#4289)
 *
 * Both nullable timestamps, no default, no backfill: `NULL` means the order is
 * visible and its personal data has not been erased, which is true of every
 * existing row. Each has a single narrow atomic writer in `OrderRecordRepository`
 * and is excluded from the ingestion upsert's write set, so a re-ingestion can
 * neither un-hide an order nor restore erased personal data.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordBuyerDataRetention1940300000001 implements MigrationInterface {
  name = 'AddOrderRecordBuyerDataRetention1940300000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "hiddenAt" timestamptz`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "personalDataErasedAt" timestamptz`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "personalDataErasedAt"`
    );
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "hiddenAt"`);
  }
}
