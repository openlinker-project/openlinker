/**
 * Add invoice_records.buyerTaxId (#3188)
 *
 * The value behind the presence flag #1202 added. `hasBuyerTaxId` is what
 * serves the `taxId=with|without` list filter, so the list could already ask
 * the question and had no way to show the answer.
 *
 * Three-state, encoded exactly as `order_records.buyerTaxId` is (#2599): `NULL`
 * = the source asserted nothing, `''` = it positively asserted the buyer has
 * none, otherwise the id the document carries. Read it back through
 * `decodeBuyerTaxIdColumn` — a bare `IS NOT NULL` reports true for the
 * asserted-none row.
 *
 * FROZEN at issue time on the write path (`InvoiceService.issueInvoice` ->
 * `create`), deliberately rather than joined from the Order on read. An invoice
 * is an immutable fiscal document while `order_records.buyerTaxId` is rewritten
 * by every re-ingestion, so a joined read could later show a number the issued
 * document does not carry.
 *
 * Nullable with NO default and NO backfill: every existing row predates the
 * column and there is nothing to recover its value from, so `NULL` is the
 * truthful answer ("not asserted") rather than a manufactured one. The column
 * is unindexed — the filter is served by the boolean beside it, and nothing
 * filters or sorts on the value.
 *
 * Prefix `1883000000000` is strictly greater than the current tail
 * (`1882000000000`).
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceBuyerTaxIdValue1883000000000 implements MigrationInterface {
  name = 'AddInvoiceBuyerTaxIdValue1883000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "invoice_records" ADD "buyerTaxId" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "invoice_records" DROP COLUMN "buyerTaxId"`);
  }
}
