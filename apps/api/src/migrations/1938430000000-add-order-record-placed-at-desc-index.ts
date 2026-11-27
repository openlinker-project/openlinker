/**
 * Add `IDX_order_records_placedAt_desc` on `order_records ("placedAt" DESC NULLS LAST)` (#4025).
 *
 * #4025 adds a `placedAt` sort to the orders list and #4026 makes it the
 * default ("newest first"). The sort is `placedAt DESC NULLS LAST`: a source
 * that reports no placement time must not put its orders on top. The existing
 * `IDX_order_records_placedAt` (`1840000000001`) is a plain ASC index, whose
 * backward scan gives DESC NULLS FIRST - the wrong null position - so without
 * this index the planner sorts the whole scope on every page load of the
 * default list view.
 *
 * The ascending direction keeps using the existing index (ASC NULLS LAST is its
 * natural order), with the `createdAt` / `internalOrderId` tie-breaks applied
 * by an incremental sort.
 *
 * Declared on the ORM entity by name and column only: TypeORM's `@Index`
 * cannot express a sort order and does not compare one, so the declaration
 * keeps `migration:generate` from dropping this index and gives the
 * `synchronize`-built test schema an index of the same name.
 *
 * Plain `CREATE INDEX`, not `CONCURRENTLY`: TypeORM runs each migration in a
 * transaction.
 *
 * Generated: 2026-11-06 (synthetic sequential prefix per docs/migrations.md
 * rule 3).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordPlacedAtDescIndex1938430000000 implements MigrationInterface {
  name = 'AddOrderRecordPlacedAtDescIndex1938430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_records_placedAt_desc" ` +
        `ON "order_records" ("placedAt" DESC NULLS LAST)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_placedAt_desc"`);
  }
}
