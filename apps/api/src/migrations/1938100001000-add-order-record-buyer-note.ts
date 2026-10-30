/**
 * Add the buyer-note columns to `order_records` (#3538, epic #3509).
 *
 * - `buyerNote text NULL` - the buyer's checkout message. Three states in one
 *   column like `buyerTaxId` (#2599): `NULL` = not asserted or not stored,
 *   `''` = the source asserted none, otherwise the text. PII-gated at
 *   persistence: free text may carry a phone number or a parcel locker and
 *   bypasses the address redaction, so under `OL_STORE_PII=false` the text is
 *   NOT stored.
 * - `hasBuyerNote boolean NOT NULL DEFAULT false` (+ index) - written in both PII
 *   modes, so a surface can say a note exists without keeping its content, and
 *   the list filter never expands the snapshot JSONB.
 * - `buyerNoteReadAt` / `buyerNoteReadByUserId` - the fill-once read marker,
 *   sole writer `markBuyerNoteRead`.
 * - `shippingCountry` / `billingCountry` varchar(2) NULL - from the address
 *   country (not PII, survives redaction); `NULL` when the address is absent.
 * - `buyerOrderCount integer NULL` - other earlier orders of the same resolved
 *   customer, computed at ingestion; `NULL` when the order has no customer.
 *
 * Additive: existing rows read NULL / false and are not back-filled.
 *
 * Generated: 2026-10-26 (synthetic sequential prefix per docs/migrations.md).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordBuyerNote1938100001000 implements MigrationInterface {
  name = 'AddOrderRecordBuyerNote1938100001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "buyerNote" text`);
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "hasBuyerNote" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "buyerNoteReadAt" timestamptz`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "buyerNoteReadByUserId" varchar`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "shippingCountry" varchar(2)`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "billingCountry" varchar(2)`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "buyerOrderCount" integer`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_records_hasBuyerNote" ON "order_records" ("hasBuyerNote")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_hasBuyerNote"`);
    for (const column of [
      'buyerOrderCount',
      'billingCountry',
      'shippingCountry',
      'buyerNoteReadByUserId',
      'buyerNoteReadAt',
      'hasBuyerNote',
      'buyerNote',
    ]) {
      await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "${column}"`);
    }
  }
}
