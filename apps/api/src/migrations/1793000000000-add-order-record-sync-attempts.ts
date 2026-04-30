/**
 * Add Order Record Sync Attempts
 *
 * Adds an append-only `syncAttempts` JSONB column to `order_records` so the
 * activity timeline can preserve every per-destination attempt instead of
 * showing only the current state in `syncStatus`. The repository UPDATE
 * caps each destination's history at the documented per-destination cap
 * via a window function inside a single statement; no index is needed
 * because reads are always row-by-PK.
 *
 * Zero-downtime: the column has a `[]` default, so the ALTER is a
 * metadata-only operation in PG 11+ and existing rows start with an empty
 * history (no backfill).
 *
 * @module apps/api/src/migrations
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordSyncAttempts1793000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN "syncAttempts" jsonb NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN "syncAttempts"`);
  }
}
