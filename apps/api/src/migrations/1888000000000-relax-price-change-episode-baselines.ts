/**
 * Relax the `price_change_episodes` baseline columns to nullable (#3159).
 *
 * `computedOldAmount` AND `sourceOldAmount` both have to be nullable: a
 * brand-new mapping's first detection, or a variant that previously carried NO
 * source price at all, has no recorded baseline to report — writing
 * `sourceNewAmount` into a `NOT NULL` `sourceOldAmount` column would fabricate
 * a "changed from N to N" fact the source never asserted.
 * `CHK_price_change_episodes_amounts_non_negative` is unaffected: a Postgres
 * CHECK evaluates to "not violated" on a NULL operand.
 *
 * **Why this is a separate migration rather than an edit to
 * `1880000000000-create-price-change-episodes.ts`** (#3159 round-4 review,
 * BLOCKING). That migration has been on `main` since #3158 and is therefore
 * already executed everywhere. TypeORM tracks executed migrations by class
 * name, so rewriting its `CREATE TABLE` body changes nothing on a database
 * that already ran it: every migrated environment would keep `NOT NULL` while
 * a from-scratch install got them nullable — two different schemas from one
 * codebase. The detection path genuinely writes `null` here, so the migrated
 * environments would fail with `null value in column "sourceOldAmount"
 * violates not-null constraint` on exactly the path this change exists to
 * enable. `docs/migrations.md` § Best Practices 4: never edit an executed
 * migration.
 *
 * The integration suite could not have caught it — `docs/testing-guide.md`
 * § Testcontainers Lifecycle: the harness builds schema by TypeORM
 * `synchronize` and runs no migrations at all, so this class of divergence is
 * invisible to it by construction.
 *
 * `1880…` is back to its merged content, so both a fresh database and an
 * already-migrated one reach this migration with the columns `NOT NULL` and
 * leave it with them nullable. `DROP NOT NULL` is a no-op on an
 * already-nullable column regardless, so no guard is needed even if some
 * environment arrives here in a different state.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RelaxPriceChangeEpisodeBaselines1888000000000 implements MigrationInterface {
  name = 'RelaxPriceChangeEpisodeBaselines1888000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "price_change_episodes" ALTER COLUMN "sourceOldAmount" DROP NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "price_change_episodes" ALTER COLUMN "computedOldAmount" DROP NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // A row written since `up()` may legitimately hold NULL in either column,
    // in which case `SET NOT NULL` fails — which is the correct outcome: the
    // operator must decide what those baselines should become before the
    // constraint can come back.
    await queryRunner.query(
      `ALTER TABLE "price_change_episodes" ALTER COLUMN "computedOldAmount" SET NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "price_change_episodes" ALTER COLUMN "sourceOldAmount" SET NOT NULL`
    );
  }
}
