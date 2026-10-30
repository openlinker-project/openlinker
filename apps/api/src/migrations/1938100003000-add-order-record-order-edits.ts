/**
 * Add `order_records.orderEdits` (#3542, D9).
 *
 * The overlay of what an operator changed on an order after import: shipping
 * address, lowered line quantities, delivery method (and, later, the discount
 * of #3543). Ingestion rewrites `orderSnapshot` wholesale on every poll and
 * webhook, so an edit cannot live inside it; this column is named by no
 * ingestion statement, which is what lets it survive a re-ingestion, and the
 * snapshot stays the channel original for display.
 *
 * Nullable with no default and NO backfill: `NULL` means "never edited", which
 * is true of every existing row. Additive, so the previous release ignores it.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordOrderEdits1938100003000 implements MigrationInterface {
  name = 'AddOrderRecordOrderEdits1938100003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "orderEdits" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "orderEdits"`);
  }
}
