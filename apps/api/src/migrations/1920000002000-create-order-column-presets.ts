/**
 * Create `order_column_presets` (#3530)
 *
 * Personal `/orders`-list column presets, shared with the export UI, plus one
 * workspace default (D32): `userId IS NULL` marks that single row, enforced
 * by a partial unique index — hand-authored because `migration:generate`
 * would not emit a partial index over a nullable column.
 *
 * Timestamp: this epic's synthetic block (#3507), one step after
 * `1920000001000-add-shipment-tracking-number-index.ts`.
 *
 * Renumbered from `1912000002000` (#3633 review — `main` took the `1912` prefix).
 * TypeORM decides pending by class name, so it re-runs this migration on any
 * database that applied it under its old name; every DDL statement is
 * therefore guarded with `IF NOT EXISTS` (`docs/migrations.md`).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderColumnPresets1920000002000 implements MigrationInterface {
  name = 'CreateOrderColumnPresets1920000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_column_presets" (
        "id"        uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId"    uuid,
        "name"      text NOT NULL,
        "columns"   jsonb NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_column_presets" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_column_presets_workspace_default"
        ON "order_column_presets" ("userId")
        WHERE "userId" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_column_presets_userId"
        ON "order_column_presets" ("userId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_column_presets"`);
  }
}
