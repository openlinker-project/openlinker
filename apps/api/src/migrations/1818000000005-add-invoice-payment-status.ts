/**
 * Add Invoice Payment Status Migration
 *
 * Adds the `paymentStatus` text column to `invoice_records` — the neutral
 * payment lifecycle (#1354) refreshed from an authoritative `PaymentStatusReader`
 * read when a provider payment webhook (e.g. inFakt `invoice_marked_as_paid`)
 * triggers. Country-agnostic (ADR-026): the value is one of the neutral
 * `PaymentStatusValues` (`unknown`/`unpaid`/`partially-paid`/`paid`), never a
 * provider-native state. Defaults `unknown` so existing rows backfill to a
 * state that never falsely asserts "unpaid" for a document OL has not polled.
 *
 * Generated: 2026-07-06 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoicePaymentStatus1818000000005 implements MigrationInterface {
  name = 'AddInvoicePaymentStatus1818000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" ADD COLUMN IF NOT EXISTS "paymentStatus" text NOT NULL DEFAULT 'unknown'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" DROP COLUMN IF EXISTS "paymentStatus"`,
    );
  }
}
