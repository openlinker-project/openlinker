/**
 * Add `order_notes.pinnedAt` + "at most one pinned note per order" (#3507
 * recovery pass, mockup M3: one pinned note, full width under the order
 * header)
 *
 * A partial unique index on `internalOrderId`, scoped to `pinnedAt IS NOT
 * NULL AND deletedAt IS NULL` — the `order_column_presets` workspace-default
 * precedent (`1912000002000-create-order-column-presets.ts`). `pin()` clears
 * whichever note previously held the order's pin in the SAME transaction as
 * setting the new one, so this index never actually refuses a legitimate
 * pin; it is the backstop against a concurrent writer bypassing that
 * discipline.
 *
 * Timestamp: this epic's synthetic block (#3507), one step after
 * `1912000004000-create-order-tags.ts`.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderNotePinnedAt1912000005000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_notes"
        ADD COLUMN "pinnedAt" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_order_notes_pinned_per_order"
        ON "order_notes" ("internalOrderId")
        WHERE "pinnedAt" IS NOT NULL AND "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_order_notes_pinned_per_order"`);
    await queryRunner.query(`ALTER TABLE "order_notes" DROP COLUMN IF EXISTS "pinnedAt"`);
  }
}
