/**
 * Add `order_records.buyerNoteChangedAt` (#3538, N-22, epic #3509).
 *
 * When a real buyer-note text replaces a different stored one, the read marker
 * is reset but bench acknowledgements (kept on the fulfilment work) are not.
 * This column records the instant of the change so the order Activity can say
 * the note changed after it was read at the bench.
 *
 * Additive and nullable: existing rows read NULL (never changed) and are not
 * back-filled.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordBuyerNoteChangedAt1938100004000 implements MigrationInterface {
  name = 'AddOrderRecordBuyerNoteChangedAt1938100004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "buyerNoteChangedAt" timestamptz`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "buyerNoteChangedAt"`);
  }
}
