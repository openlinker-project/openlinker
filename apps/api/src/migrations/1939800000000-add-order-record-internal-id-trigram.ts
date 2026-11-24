/**
 * Trigram index on `order_records."internalOrderId"` (#4229)
 *
 * The orders free-text search (#3527) now also matches an OpenLinker order id
 * (`ol_order_*`) by substring, as an OR beside the `searchText` predicate. The
 * primary-key btree cannot serve `LIKE '%x%'`, so without this index the
 * paginated total (`countMany`) would seq-scan the whole table for every search.
 *
 * Hand-authored: `migration:generate` does not emit a GIN index with an
 * operator class. Guarded (`IF NOT EXISTS`, `docs/migrations.md`). The matching
 * is `LIKE`, never the `%` similarity operator, so correctness never depends on
 * `pg_trgm` being installed - the index only makes it fast.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordInternalIdTrigram1939800000000 implements MigrationInterface {
  name = 'AddOrderRecordInternalIdTrigram1939800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_records_internalOrderId_trgm"
        ON "order_records" USING GIN ("internalOrderId" gin_trgm_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_internalOrderId_trgm"`);
    // `pg_trgm` is intentionally NOT dropped - other trigram indexes share it.
  }
}
