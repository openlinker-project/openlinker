/**
 * Create `order_column_presets` (#3530)
 *
 * Personal `/orders`-list column presets, shared with the export UI, plus one
 * workspace default (D32): `userId IS NULL` marks that single row, enforced
 * by a partial unique index — hand-authored because `migration:generate`
 * would not emit a partial index over a nullable column.
 *
 * Timestamp: this epic's synthetic block (#3507), one step after
 * `1912000001000-add-shipment-tracking-number-index.ts`.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderColumnPresets1912000002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE "order_column_presets" (
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
      CREATE UNIQUE INDEX "UQ_order_column_presets_workspace_default"
        ON "order_column_presets" ("userId")
        WHERE "userId" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_order_column_presets_userId"
        ON "order_column_presets" ("userId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_column_presets"`);
  }
}
