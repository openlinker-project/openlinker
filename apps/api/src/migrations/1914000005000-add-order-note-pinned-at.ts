/**
 * Add `order_notes.pinnedAt` + "at most one pinned note per order" (#3507
 * recovery pass, mockup M3: one pinned note, full width under the order
 * header)
 *
 * A partial unique index on `internalOrderId`, scoped to `pinnedAt IS NOT
 * NULL AND deletedAt IS NULL` — the `order_column_presets` workspace-default
 * precedent (`1914000002000-create-order-column-presets.ts`). `pin()` clears
 * whichever note previously held the order's pin in the SAME transaction as
 * setting the new one, so this index never actually refuses a legitimate
 * pin; it is the backstop against a concurrent writer bypassing that
 * discipline.
 *
 * Timestamp: this epic's synthetic block (#3507), one step after
 * `1914000004000-create-order-tags.ts`.
 *
 * Renumbered from `1912000005000` (#3633 review — `main` took the `1912` prefix).
 * TypeORM decides pending by class name, so it re-runs this migration on any
 * database that applied it under its old name; every DDL statement is
 * therefore guarded with `IF NOT EXISTS` (`docs/migrations.md`).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderNotePinnedAt1914000005000 implements MigrationInterface {
  name = 'AddOrderNotePinnedAt1914000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_notes"
        ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_notes_pinned_per_order"
        ON "order_notes" ("internalOrderId")
        WHERE "pinnedAt" IS NOT NULL AND "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_order_notes_pinned_per_order"`);
    await queryRunner.query(`ALTER TABLE IF EXISTS "order_notes" DROP COLUMN IF EXISTS "pinnedAt"`);
  }
}
