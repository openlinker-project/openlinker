/**
 * Persist the buyer's tax identifier on an order record (#2599, epic #2590).
 *
 * The neutral order contract carried no buyer tax id, so a B2B invoice could
 * not be issued for an order at all, and the sales-document rule engine's
 * `buyerHasTaxId` condition was permanently unknowable. The value now rides the
 * snapshot's billing address and is denormalized into this column, so a routing
 * or gating query never expands JSONB and so the value survives
 * `OL_STORE_PII=false`, under which the snapshot address is redacted.
 *
 * THREE states in one nullable column, because a buyer who has no tax id and a
 * source that never said are different facts:
 *
 * - `NULL` - the source asserted nothing. Unknown.
 * - `''` - the source asserted the buyer has none.
 * - anything else - the tax id, trimmed of surrounding whitespace and never
 *   otherwise normalised.
 *
 * A bare `buyerTaxId IS NOT NULL` therefore reports true for the middle state.
 * Read the column through `decodeBuyerTaxIdColumn` (`@openlinker/core/orders`).
 *
 * `text`, not `varchar(n)`: no length is universally right for an identifier
 * whose format is a national matter, and this migration must not encode one.
 *
 * Additive, nullable, no backfill. `NULL` is honest for every existing row -
 * nothing was ever collected for it, which is not the same as a buyer known to
 * have no tax id.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordBuyerTaxId1842000000001 implements MigrationInterface {
  name = 'AddOrderRecordBuyerTaxId1842000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "buyerTaxId" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "buyerTaxId"`);
  }
}
