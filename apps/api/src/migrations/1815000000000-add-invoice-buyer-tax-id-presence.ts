/**
 * Add invoice_records.hasBuyerTaxId (#1202)
 *
 * Denormalizes whether the buyer carried a tax identifier at issue time onto the
 * InvoiceRecord projection, so the GET /invoices `taxId=with|without` list filter
 * can be served without joining to the Order. Neutral presence concept — a
 * boolean, NOT a stored "nip" value (ADR-026).
 *
 * Set on the write path (`InvoiceService.issueInvoice` → `create`) from the
 * command's buyer. Additive + `NOT NULL DEFAULT false` → existing rows backfill
 * to `false` in one statement (a legacy invoice's buyer tax-id presence is
 * unknown to the projection; `false` keeps it out of the `with` bucket rather
 * than mislabelling it). `down()` drops the column.
 *
 * Prefix `1815000000000` is strictly greater than the current migration tail
 * (`1811000000000`) and leaves room for the in-flight W1–W3 invoicing migrations
 * (`1812`–`1814`) that land on their own PRs.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceBuyerTaxIdPresence1815000000000 implements MigrationInterface {
  name = 'AddInvoiceBuyerTaxIdPresence1815000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" ADD "hasBuyerTaxId" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "invoice_records" DROP COLUMN "hasBuyerTaxId"`);
  }
}
