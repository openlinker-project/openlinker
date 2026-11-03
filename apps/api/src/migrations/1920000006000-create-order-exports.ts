/**
 * Create `order_exports` (#3534, D35)
 *
 * The `analytics_remediation_runs` shape (#2468, `1875000001000-add-analytics-remediation-runs.ts`):
 * a generated `text` id, plain columns (`status`/`format`/`scope` validated by
 * the repository's `toDomain`, not a CHECK), no FK to `users`.
 *
 * `file` is `jsonb`, nullable — populated only once the run reaches `ready`
 * (the `invoice_records.sourceDocument` `StoredDocument` pattern).
 *
 * Timestamp: this epic's synthetic block (#3507), one step after
 * `1920000005000-add-order-note-pinned-at.ts`.
 *
 * Renumbered from `1912000006000` (#3633 review — `main` took the `1912` prefix).
 * TypeORM decides pending by class name, so it re-runs this migration on any
 * database that applied it under its old name; every DDL statement is
 * therefore guarded with `IF NOT EXISTS` (`docs/migrations.md`).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderExports1920000006000 implements MigrationInterface {
  name = 'CreateOrderExports1920000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_exports" (
        "id"                  text NOT NULL,
        "requestedByUserId"   uuid NOT NULL,
        "status"              text NOT NULL,
        "format"              text NOT NULL,
        "scope"               text NOT NULL,
        "filters"             jsonb NOT NULL,
        "selectedOrderIds"    jsonb NOT NULL,
        "columns"             jsonb NOT NULL,
        "rowCount"            integer,
        "containsPii"         boolean,
        "errorMessage"        text,
        "file"                jsonb,
        "expiresAt"           TIMESTAMPTZ NOT NULL,
        "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_exports" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_exports_requestedByUserId" ON "order_exports" ("requestedByUserId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_exports"`);
  }
}
