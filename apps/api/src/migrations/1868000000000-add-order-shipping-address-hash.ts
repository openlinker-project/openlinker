/**
 * Add `order_records.shippingAddressHash` (#2395, W3a).
 *
 * `RoutingShipTo`'s degraded arm (`OL_STORE_PII=false`) needs a `locationHash`
 * for the order. It cannot be derived on read:
 *
 * - Hashing the persisted `orderSnapshot` address is wrong under hash-only
 *   mode, where that address has already been through `redactAddress` - the
 *   hash then collapses to ONE value per country, shared by every order in the
 *   install, looking correct while grouping everything.
 * - `customer_address_projections` are keyed by CUSTOMER, not by order, so they
 *   cannot answer "the address on THIS order".
 *
 * So the value is stamped at ingestion, where the un-redacted address is still
 * in hand, and persisted here. Nullable: existing rows carry no hash and are
 * never backfilled (the un-redacted address is gone), and an order with no
 * shipping address legitimately has none.
 *
 * `text`, matching the neighbouring `buyerTaxId` column rather than a sized
 * `varchar` - the hash width is a property of the hashing function, not of the
 * schema, and pinning it here would need a migration to change it.
 *
 * Generated: 2026-08-31 (synthetic sequential prefix per docs/migrations.md
 * rule 3; 1866000000000 is #2394's `routing_decisions`).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderShippingAddressHash1868000000000 implements MigrationInterface {
  name = 'AddOrderShippingAddressHash1868000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "shippingAddressHash" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "shippingAddressHash"`
    );
  }
}
