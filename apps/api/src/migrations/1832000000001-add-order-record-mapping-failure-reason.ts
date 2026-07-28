/**
 * Add OrderRecord mappingFailureReason Migration
 *
 * Adds `mappingFailureReason` (nullable text) to `order_records` (#1689). Set
 * when item resolution fails at ingestion — either an ordinary missing
 * mapping (`awaiting_mapping`) or a stale/deleted-at-source item
 * (`source_deleted`) — so the orders UI can render the operator-facing reason
 * instead of it dying in the worker log. No DDL is needed for the new
 * `recordStatus = 'source_deleted'` value: `recordStatus` is a plain
 * `character varying` column with no check constraint
 * (`1783000000000-add-order-record-status.ts`). Nullable/additive.
 *
 * Generated: 2026-07-27 (synthetic sequential prefix per docs/migrations.md
 * #1013 — sorts strictly after the current `main` tail `1831000000002`).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordMappingFailureReason1832000000001 implements MigrationInterface {
  name = 'AddOrderRecordMappingFailureReason1832000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "mappingFailureReason" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "mappingFailureReason"`,
    );
  }
}
