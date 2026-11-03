/**
 * Add Bulk Batch Idempotency Key
 *
 * Adds a nullable `idempotencyKey` text column to `bulk_offer_creation_batches`
 * plus a PARTIAL unique index over `(connectionId, idempotencyKey)` restricted
 * to non-null keys.
 *
 * The bulk offer wizard has always sent `x-idempotency-key` and told the
 * operator that a double submit returns the existing batch, but nothing on the
 * server read the header: a double click produced two batches and two offers
 * per variant on the marketplace (Allegro does not deduplicate product-offer
 * creates). The unique index is what makes the guard hold under a same-
 * millisecond race; the submit service resolves the loser to the winning batch.
 *
 * Partial, so every pre-existing row (and every submit without a key) keeps a
 * NULL and never collides. No backfill: historic batches had no key to record.
 * `IF NOT EXISTS` / `IF EXISTS` guards keep up/down idempotent. The index name
 * matches the one declared on the ORM entity so the `synchronize`-built test
 * schema and the migrated schema agree.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBulkBatchIdempotencyKey1937420000000 implements MigrationInterface {
  name = 'AddBulkBatchIdempotencyKey1937420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bulk_offer_creation_batches" ADD COLUMN IF NOT EXISTS "idempotencyKey" text`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_bulk_offer_creation_batches_connection_idempotency_key" ` +
        `ON "bulk_offer_creation_batches" ("connectionId", "idempotencyKey") ` +
        `WHERE "idempotencyKey" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_bulk_offer_creation_batches_connection_idempotency_key"`
    );
    await queryRunner.query(
      `ALTER TABLE "bulk_offer_creation_batches" DROP COLUMN IF EXISTS "idempotencyKey"`
    );
  }
}
