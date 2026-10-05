/**
 * Create `order_tags` + `order_tag_assignments` (#3532, D34)
 *
 * `internalOrderId` on `order_tag_assignments` is `text`, never `uuid` — an
 * internal order id has the shape `ol_order_{uuid}`
 * (`docs/architecture-overview.md § Identifier Mapping Service`), matching
 * every other reference to it in this context (`order_holds`,
 * `order_changes`, `refund_records`).
 *
 * Timestamp: this epic's synthetic block (#3507), one step after
 * `1920000003000-create-order-notes.ts`.
 *
 * Renumbered from `1912000004000` (#3633 review — `main` took the `1912` prefix).
 * TypeORM decides pending by class name, so it re-runs this migration on any
 * database that applied it under its old name; every DDL statement is
 * therefore guarded with `IF NOT EXISTS` (`docs/migrations.md`).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderTags1920000004000 implements MigrationInterface {
  name = 'CreateOrderTags1920000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_tags" (
        "id"        uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name"      text NOT NULL,
        "color"     text NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_tags" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_tags_name" ON "order_tags" ("name")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_tag_assignments" (
        "id"               uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tagId"            uuid NOT NULL,
        "internalOrderId"  text NOT NULL,
        "assignedByUserId" uuid NOT NULL,
        "assignedAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_tag_assignments" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_tag_assignments_tag_order"
        ON "order_tag_assignments" ("tagId", "internalOrderId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_tag_assignments_tagId" ON "order_tag_assignments" ("tagId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_tag_assignments_internalOrderId"
        ON "order_tag_assignments" ("internalOrderId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_tag_assignments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_tags"`);
  }
}
