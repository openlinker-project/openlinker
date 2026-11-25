/**
 * Buyer data retention (#4178): `order_records.buyerDataRedactedAt` records
 * when an order's buyer personal data was removed because its source's
 * retention period passed (Amazon's Data Protection Policy). NULL = not
 * removed, which every existing row is.
 *
 * The partial index serves the retention pass, which reads per source the
 * not-yet-redacted orders by their anchor (`COALESCE(dispatchByAt, placedAt,
 * createdAt)`); a redacted row leaves it, so it stays as small as the backlog.
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
    await queryRunner.query(
      `CREATE INDEX "IDX_order_records_buyer_data_retention" ON "order_records" ` +
        `("sourceConnectionId", (COALESCE("dispatchByAt", "placedAt", "createdAt"))) ` +
        `WHERE "buyerDataRedactedAt" IS NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_order_records_buyer_data_retention"`);
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN "buyerDataRedactedAt"`);
  }
}
