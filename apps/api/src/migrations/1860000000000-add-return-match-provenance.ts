/**
 * Add Return Match Provenance Migration (#2372, ADR-060)
 *
 * Two additive, nullable columns on `returns` recording that an OPERATOR matched
 * an orphan return to an order, and who.
 *
 * **Why columns rather than an event row.** OL's order/return timeline is DERIVED
 * from persisted facts — there is no event table for either (the #1689 /
 * #2100 precedent), and `return_line_events` is the per-LINE act ledger whose rows
 * sum back to the counters, so a header-level attribution has neither a line nor a
 * quantity to sit against. Without these two columns, `internalOrderId` going
 * non-null carries no *when* and no *who*, and the read API (#2376) has nothing to
 * render.
 *
 * **No backfill, and NULL is meaningful.** NULL means "not matched by an operator"
 * — true for a return attributed at ingestion and for one the #2332 background
 * reconcile resolved. Backfilling would assert an operator act that did not happen.
 *
 * No index: these are display fields on a row already fetched by id, never a
 * predicate.
 *
 * Generated: 2026-08-26 (synthetic sequential prefix per docs/migrations.md rule 3;
 * the tail at authoring time was 1859000000000).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReturnMatchProvenance1860000000000 implements MigrationInterface {
  name = 'AddReturnMatchProvenance1860000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "returns" ADD COLUMN IF NOT EXISTS "matchedAt" TIMESTAMP WITH TIME ZONE`
    );
    await queryRunner.query(
      `ALTER TABLE "returns" ADD COLUMN IF NOT EXISTS "matchedByUserId" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "returns" DROP COLUMN IF EXISTS "matchedByUserId"`);
    await queryRunner.query(`ALTER TABLE "returns" DROP COLUMN IF EXISTS "matchedAt"`);
  }
}
