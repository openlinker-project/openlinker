/**
 * Add order_records.salesDocumentBlockParams (#3866)
 *
 * The values behind `salesDocumentBlockDetail` (ids, counts and codes only),
 * so the frontend can phrase a sales-document block in the operator's
 * language. No backfill: an existing block keeps its English detail until the
 * order's next transition re-decides the gate and writes both.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordSalesDocumentBlockParams1938420000000 implements MigrationInterface {
  name = 'AddOrderRecordSalesDocumentBlockParams1938420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "salesDocumentBlockParams" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "salesDocumentBlockParams"`,
    );
  }
}
