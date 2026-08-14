/**
 * Add `destination_categories.expandedAt` (#2061, ADR-037)
 *
 * Moves the taxonomy sync's breadth-first progress out of the connection cursor
 * and into the projection. A node carries the watermark of the run that expanded
 * it, so the frontier becomes a query instead of a JSON id-list on a cursor that
 * every other caller in the repo keeps scalar.
 *
 * Additive and nullable: existing rows read as "never expanded", which is the
 * correct starting state — the first run after this migration re-walks the tree
 * and stamps as it goes.
 *
 * Timestamp is a synthetic sequential prefix per `docs/migrations.md`
 * § Timestamp uniqueness invariant — the tail on `main` was `1833000000000`.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDestinationCategoryExpandedAt1833000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "destination_categories"
      ADD COLUMN IF NOT EXISTS "expandedAt" TIMESTAMP WITH TIME ZONE
    `);

    // Serves the frontier query: rows carrying the current run's watermark that
    // are still expandable.
    //
    // MEASURED against the SHIPPED predicate at 20k rows in one scope (~85%
    // leaves, ~1% still unexpanded — roughly one Allegro tree mid-run), matching
    // the honesty the sibling trigram-index comment sets:
    //
    //   this index:           cost  98.30
    //   scope-prefixed index: cost 189.99
    //   no index:             cost 647.81  (Seq Scan)
    //
    // Two things measurement settled that a guess got wrong:
    //
    // 1. The index deliberately OMITS the scope columns. The repository matches
    //    scope with `$1 IS NOT DISTINCT FROM "taxonomyOwner"` (either scope
    //    column may be NULL), and btree cannot search on that operator — so a
    //    leading `taxonomyOwner` is dead weight that only widens the index.
    //    Dropping it also collapses what would have been two scope-specific
    //    indexes into one that serves both.
    // 2. It is KEPT, unlike the trigram index above — the opposite outcome for
    //    two predicates that look superficially alike. `searchText LIKE '%…%'`
    //    matches a broad swathe, so a scan wins; `syncedAt = $run AND
    //    expandedAt IS NULL` matches only the few rows still owed work, and that
    //    slice shrinks as the run progresses. Selectivity decides it.
    //
    // Partial on `leaf IS NOT TRUE` because a leaf is never expandable, and on
    // a leaf-gated marketplace tree leaves are the majority of rows.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_destination_categories_frontier"
        ON "destination_categories" ("syncedAt", "expandedAt")
        WHERE "leaf" IS NOT TRUE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_destination_categories_frontier"`);
    // Dropping the column discards in-flight run progress; the next run restarts
    // from the roots, which is the same outcome as a cursor reset.
    await queryRunner.query(
      `ALTER TABLE "destination_categories" DROP COLUMN IF EXISTS "expandedAt"`,
    );
  }
}
