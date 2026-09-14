/**
 * Add `price_change_episodes."claimedAt"` (#3162 review, BLOCKING).
 *
 * `claimForResolution` takes exclusive resolution rights with a guarded
 * conditional `UPDATE ... SET "claimedAt" = $1 WHERE "resolvedAt" IS NULL AND
 * "claimedAt" IS NULL ... RETURNING` - the repo's `claimWaybillRelay` idiom -
 * and `releaseClaim` clears it when the enqueue that followed the claim fails.
 * The column was declared on the ORM entity and written by both, and nothing
 * created it.
 *
 * **Why the column cannot go into `1880000000000-create-price-change-episodes.ts`.**
 * That migration has been on `main` since #3158 and is therefore already
 * executed everywhere. TypeORM tracks executed migrations by class name, so
 * adding a column to its `CREATE TABLE` body changes nothing on a database
 * that already ran it: a from-scratch install would get `claimedAt` and every
 * migrated environment would not. `docs/migrations.md` § Best Practices 4:
 * never edit an executed migration.
 *
 * **What the omission actually broke.** On every already-migrated database the
 * claim `UPDATE` fails with `column "claimedAt" does not exist`, and because
 * accept, edit and bulk-accept all reach it through `claimOrThrow`, all three
 * are dead on arrival - not degraded, refused at the first statement.
 *
 * **Why CI was green over it.** `docs/testing-guide.md` § Testcontainers
 * Lifecycle: the integration harness builds schema by TypeORM `synchronize`
 * and runs no migrations at all. A `synchronize`-built database gets every
 * column the entity declares, so a create-versus-alter divergence is invisible
 * to that suite by construction. The same blind spot is what let the #3159
 * baseline defect through twice; `1888000000000` records it for that one.
 *
 * `IF NOT EXISTS` is deliberate rather than defensive noise: a developer whose
 * database was built by `synchronize` already has the column, and this
 * migration must be a no-op there rather than an error that wedges the chain.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPriceChangeEpisodeClaimedAt1889000000000 implements MigrationInterface {
  name = 'AddPriceChangeEpisodeClaimedAt1889000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "price_change_episodes" ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP WITH TIME ZONE`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Dropping the column discards every in-flight claim. That is correct:
    // without the column there is no claim to honour, and a claim is a
    // short-lived marker rather than a fact about the episode.
    await queryRunner.query(
      `ALTER TABLE "price_change_episodes" DROP COLUMN IF EXISTS "claimedAt"`
    );
  }
}
