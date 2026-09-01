/**
 * Add `returns.externalOrderId` + the orphan re-attribution index (#2332)
 *
 * The source's own order reference, persisted so the re-attribution reconcile has
 * something to key on. #2327 shipped the nullable `internalOrderId` that makes an orphan
 * return representable, and #2328 reads `IncomingReturn.externalOrderId` once to resolve
 * it — but stored the value nowhere, so an orphan could never be re-checked later.
 *
 * **No backfill, deliberately.** Rows written before this migration never persisted the
 * source order reference anywhere (it is not in `rawPayload` either), so there is nothing
 * to backfill FROM. Those orphans stay orphaned until an operator resolves them or the
 * source re-reports the return, at which point `upsertFromSource` fills the column in.
 * Inventing a value would be worse than the gap.
 *
 * The index is the reconcile's exact query and is partial for the same reason
 * `IDX_returns_orphans` is: on a healthy install the matching rows are a vanishing
 * fraction of the table. `("createdAt" DESC)` here vs. ascending in the
 * `synchronize`-built test schema is the documented #2327 decorator limitation — same
 * name, same predicate, same columns, a scan-direction difference only.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReturnExternalOrderId1850000000007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Self-heal. This migration has been re-timestamped (1848000000000 -> 1849000000010 ->
    // 1850000000007), so an environment that already ran an earlier revision holds a
    // `migrations` row under a stale class name. Dropping those rows lets
    // TypeORM re-record it under the current name; the DDL below is
    // IF [NOT] EXISTS-guarded, so the re-run is a no-op. On a fresh database
    // the DELETE matches nothing.
    await queryRunner.query(
      `DELETE FROM "migrations" WHERE "name" IN ('AddReturnExternalOrderId1849000000010', 'AddReturnExternalOrderId1848000000000')`
    );
    await queryRunner.query(
      `ALTER TABLE "returns" ADD COLUMN IF NOT EXISTS "externalOrderId" text`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_returns_orphan_reattribution"
         ON "returns" ("sourceConnectionId", "createdAt" DESC)
         WHERE "internalOrderId" IS NULL AND "externalOrderId" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_returns_orphan_reattribution"`);
    await queryRunner.query(`ALTER TABLE "returns" DROP COLUMN IF EXISTS "externalOrderId"`);
  }
}
