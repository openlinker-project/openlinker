/**
 * Add invoice_records.unlinkedCatalogueLines
 *
 * How many of a document's lines the provider could not link to a record in its
 * own catalogue, and therefore issued as free text.
 *
 * It exists because such a document looks entirely normal — correct name,
 * quantity, price and VAT on every line — while the seller's warehouse never
 * registers the sale. On Subiekt an unlinked line becomes a "usługa
 * jednorazowa" (one-time service) with `ob_TowId = NULL`, which no warehouse
 * document can release: the goods leave, the stock does not move, and the next
 * inventory pull republishes the already-sold quantity to every channel. The
 * only previous signal was a `logger.warn` nobody reads.
 *
 * TRI-STATE, and the states are not interchangeable: `NULL` = this provider
 * does not report linkage at all (inFakt, KSeF and eparagony never will —
 * they have no catalogue to link to); `0` = every line was linked; `> 0` = that
 * many were not. A surface must therefore test `> 0` rather than nullability;
 * `InvoiceRecord.hasUnlinkedCatalogueLines` is the convenience derivation for
 * a caller that only needs the yes/no question, but every shipped consumer
 * needs the count itself (to name it, e.g. "2 lines") and reads the raw
 * column.
 *
 * Nullable with NO default and NO backfill: every existing row predates the
 * column and nothing records what its documents' linkage was, so `NULL` —
 * "not reported" — is the truthful answer rather than a manufactured `0`,
 * which would assert that those documents were fully linked.
 *
 * Unindexed, deliberately. The value is read through the invoice projection the
 * orders list and detail already load, so there is no query that would use an
 * index. If operators ever need a worklist of affected orders, the answer is to
 * promote it to an independently-filterable order-level axis (the
 * `taxRateConflict` shape), not to index this column.
 *
 * Prefix `1894000000000`, not `1893000000000`: that timestamp is already
 * claimed by `AddFulfillmentWorkAssignment1893000000000` on the unmerged
 * pack-bench branches, and TypeORM keys an applied migration by TIMESTAMP, not
 * by name - so on any database that ran theirs first, this one is recorded as
 * already applied and SILENTLY SKIPPED. The column is then missing while
 * `migration:show` reports nothing pending, and the feature is dead with no
 * error anywhere. Caught on a live stand, not in review:
 * `check-migration-timestamps.mjs` compares against `origin/main` only, so a
 * collision with a branch that has not merged yet is invisible to it.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceUnlinkedCatalogueLines1894000000000 implements MigrationInterface {
  name = 'AddInvoiceUnlinkedCatalogueLines1894000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "invoice_records" ADD "unlinkedCatalogueLines" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" DROP COLUMN "unlinkedCatalogueLines"`,
    );
  }
}
