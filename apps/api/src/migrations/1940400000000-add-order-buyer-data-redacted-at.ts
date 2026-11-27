/**
 * Buyer data retention (#4178): `order_records.buyerDataRedactedAt` records
 * when an order's buyer personal data was removed because its source's
 * retention period passed (Amazon's Data Protection Policy). NULL = not
 * removed, which every existing row is.
 *
 * The partial index serves the retention pass, which reads per source the
 * not-yet-redacted orders by their anchor (`COALESCE(dispatchByAt, placedAt,
 * createdAt AT TIME ZONE 'UTC')`: `createdAt` is a zone-less `timestamp`, and the
 * implicit cast to `timestamptz` depends on the session time zone, which an
 * index expression may not); a redacted row leaves it, so it stays as small as
 * the backlog.
 * Declared on the ORM entity as well (column only: TypeORM's `@Index` cannot
 * express an expression index), because the integration harness builds schema
 * by `synchronize`.
 *
 * Generated: 2026-11-17 (synthetic sequential prefix per docs/migrations.md rule 3).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderBuyerDataRedactedAt1940400000000 implements MigrationInterface {
  name = 'AddOrderBuyerDataRedactedAt1940400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN "buyerDataRedactedAt" TIMESTAMP WITH TIME ZONE`
    );
    // `createdAt` is a TIMESTAMP without time zone while the other two are
    // timestamptz, so a bare COALESCE casts it through the session time zone,
    // which Postgres refuses in an index expression. OpenLinker writes it in
    // UTC; the repository's retention query uses the same expression.
    await queryRunner.query(
      `CREATE INDEX "IDX_order_records_buyer_data_retention" ON "order_records" ` +
        `("sourceConnectionId", (COALESCE("dispatchByAt", "placedAt", "createdAt" AT TIME ZONE 'UTC'))) ` +
        `WHERE "buyerDataRedactedAt" IS NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_order_records_buyer_data_retention"`);
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN "buyerDataRedactedAt"`);
  }
}
