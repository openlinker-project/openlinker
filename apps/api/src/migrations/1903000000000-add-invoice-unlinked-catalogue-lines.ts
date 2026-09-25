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
 * SELF-HEALING, and re-timestamped THREE times. This file was `1893000000000`,
 * then `1894000000000`, then `1900000000000`, and is now `1903000000000`.
 *
 * The third move has a different cause from the first two, and the difference
 * is the useful part. Those were collisions WITHIN one tree. This one is the
 * ORDERING rule: while this branch was open, `main` gained
 * `1901000000000-add-return-line-resolved-catalog-identity`, so a `1900` prefix
 * here now sorts BEFORE the newest migration already merged - which
 * `check-migration-timestamps.mjs` refuses, because a branch whose migration
 * interleaves with main's history has no defined order on a database that
 * applied main's first. `1902000000000` was already taken by this branch's own
 * `split-subiekt-product-lines`, so `1903000000000` is the next free prefix
 * above both.
 *
 * The lesson the header can usefully carry: a merged-but-unrebased branch's
 * migration number DECAYS. Picking a free number once is not enough; it has to
 * still be free against `origin/main` at merge time, and this file has now been
 * caught by that twice under two different rules.
 *
 * The move off `1893` was made on a reason that is FALSE, and the correction
 * matters more than the move. The old header claimed TypeORM keys an applied
 * migration by TIMESTAMP, so a same-timestamp migration would be "silently
 * skipped". It does not: `MigrationExecutor` decides what is pending by CLASS
 * NAME (`typeorm@0.3.17`, `MigrationExecutor.js:146`; `migration:show` uses the
 * same comparison at :107), and only the ORDERING is timestamp-keyed, with no
 * tie-break (`:425`). Two migrations sharing a timestamp therefore BOTH run;
 * what is undefined is which runs first, which is why
 * `check-migration-timestamps.mjs` refuses a duplicate at all.
 *
 * Observed directly rather than reasoned about: the demo database's
 * `migrations` table holds `SplitSubiektGtIdentity1898000000000` AND
 * `SplitSubiektProductLines1898000000000` - two classes, one timestamp, both
 * recorded as applied.
 *
 *
 * WHAT THE GUARD ACTUALLY CHECKS, since this header is the most likely thing a
 * future author reads before picking a number. `check-migration-timestamps.mjs`
 * enforces exactly three things: a 13-digit prefix, a class suffix matching that
 * prefix, prefix uniqueness WITHIN ONE TREE, and ordering against `origin/main`.
 * It knows nothing about an unmerged sibling branch, so two branches can each
 * hold the same free-looking number and both pass their own lint. The hazard of
 * that is UNDEFINED ORDERING between the two plus a hard lint failure when the
 * second one merges - it is NOT a silent skip, and treating it as one is what
 * made a rename look free here.
 * That correction is what makes a RENAME the dangerous operation here, not a
 * collision: a renamed class is a NEW migration to TypeORM, so `up()` runs
 * again on every database that applied an earlier name. This file's `up()` was
 * a bare `ALTER TABLE ... ADD COLUMN`, which is `42701 column already exists` -
 * and because the batch runs in one transaction it takes every other pending
 * migration down with it.
 *
 * So it follows `docs/migrations.md` section 6 (the #1013 recovery shape) in
 * full, which the previous renumber did only one third of:
 *   1. `up()` first DELETEs the `migrations` rows written under BOTH earlier
 *      class names. No-op on a fresh database; on an already-migrated one it is
 *      what stops the guarded DDL below from being reached in a state where it
 *      would have to no-op silently forever.
 *   2. Every statement is `IF [NOT] EXISTS`-guarded, so re-applying after a
 *      successful earlier run converges instead of failing.
 *   3. The previous file is deleted in the same commit.
 *
 * Both already-migrated and fresh databases converge on a plain
 * `migration:run`, with no manual SQL.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The class names this migration has already been recorded under. */
const SUPERSEDED_MIGRATION_NAMES = [
  'AddInvoiceUnlinkedCatalogueLines1893000000000',
  'AddInvoiceUnlinkedCatalogueLines1894000000000',
  'AddInvoiceUnlinkedCatalogueLines1900000000000',
];

export class AddInvoiceUnlinkedCatalogueLines1903000000000 implements MigrationInterface {
  name = 'AddInvoiceUnlinkedCatalogueLines1903000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "migrations" WHERE "name" = ANY($1)`,
      [SUPERSEDED_MIGRATION_NAMES],
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_records" ADD COLUMN IF NOT EXISTS "unlinkedCatalogueLines" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" DROP COLUMN IF EXISTS "unlinkedCatalogueLines"`,
    );
  }
}
