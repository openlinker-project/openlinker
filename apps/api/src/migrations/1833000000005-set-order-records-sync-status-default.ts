/**
 * Set order_records.syncStatus Column Default
 *
 * Guarantees the `DEFAULT '[]'` that `OrderRecordRepository.toOrm` now depends
 * on (#2140): `syncStatus` was dropped from the upsert's write set, so an
 * INSERT that omits it emits the literal `DEFAULT` and the column must supply
 * the empty array itself.
 *
 * The default is not guaranteed by the creating migration. `1770000000000`
 * wraps its whole `CREATE TABLE` in `if (!table)`, so on any database whose
 * `order_records` was first built by TypeORM `synchronize`
 * (`libs/shared/src/database/database.module.ts` enables it for every
 * `NODE_ENV !== 'production'`) that migration took the early-out and the
 * column came from the ORM decorator, which carried no `default` before
 * #2140. There, `DEFAULT` would resolve to NULL against a NOT NULL column and
 * break order ingestion outright.
 *
 * `syncAttempts` needs no equivalent: it has a default under both
 * provenances - `1793000000000` adds it as an unconditional
 * `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT '[]'` that cannot have been
 * skipped, and its ORM decorator has carried `default: () => "'[]'"` since it
 * was introduced.
 *
 * Idempotent and metadata-only: `SET DEFAULT` rewrites no rows and is a no-op
 * on a database that already has it.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SetOrderRecordsSyncStatusDefault1833000000005 implements MigrationInterface {
  name = 'SetOrderRecordsSyncStatusDefault1833000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ALTER COLUMN "syncStatus" SET DEFAULT '[]'`
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Deliberately a no-op. This migration asserts a default rather than
    // introducing one, and it cannot tell the two provenances apart after the
    // fact: on a migration-built database `1770000000000` already created the
    // column WITH `DEFAULT '[]'`, so dropping it here would leave that
    // database in a state no migration ever produced (and `1770000000000`'s
    // own `down()` only removes the default by dropping the table). Reverting
    // the assertion is therefore not a meaningful operation.
  }
}
