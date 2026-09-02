/**
 * Add `shipments.fulfillmentWorkId` (#2402, `W3a-13`)
 *
 * The work→shipment bridge. DESIGN §5.2 states the relation as
 * `FulfillmentWork` **1:N** `Shipment`, and for a 1:N relation the key belongs
 * on the MANY side — so the column lands on `shipments`.
 *
 * ## Why not `shipment_lines`, which #2392's AC and DESIGN §5.2 both name
 *
 * There is no `shipment_lines` table, on this branch or on `main`:
 * `libs/core/src/shipping` declares exactly one entity, `@Entity('shipments')`.
 * #2392 deferred the column here on that basis. The design sentence is
 * self-contradictory — "1:N with the shipment keeping its identity" and "a line
 * table gains the key" cannot both hold — and `shipment_lines` is in fact a
 * DIFFERENT concern with a different key and motive: option C of
 * `DECISION-oms-fulfilment-grain`, keyed `(shipmentId, orderId, lineId,
 * quantity)`, existing to make `shipped_quantity` derivable. It carries
 * obligations this issue does not (a backfill written as ledger events, the
 * `fulfillment-rollup.ts` precedence fix, line counters, an FE panel) and is
 * tracked as its own issue.
 *
 * ## No FK, deliberately
 *
 * An indexed reference by value — the cross-aggregate precedent
 * (`order_changes`, `refund_records`, `returns.internalOrderId`). A shipment is
 * not part of a work: it outlives it and is queried independently, and the
 * dispatch path already takes a per-order lock, so a real FK would add
 * cross-table lock coupling on a hot write path for referential tidiness. A
 * real FK stays reserved for a part-of-its-parent child
 * (`return_lines.returnId ON DELETE CASCADE`).
 *
 * ## No default and no backfill
 *
 * `NULL` is the CORRECT value for every existing row — those shipments
 * genuinely satisfy no work — so this is a pure additive column and the
 * migration is safe to run against a populated table with no rewrite.
 *
 * ## The index is NOT partial
 *
 * Unlike `IDX_shipments_reservation_consume_pending` on this same table — whose
 * unclaimed set shrinks to nothing in steady state, making a full index almost
 * entirely dead rows — the populated set here GROWS as OMS routing is adopted
 * and is expected to become the majority. A partial index would have to be
 * rebuilt as a full one later, and `IS NOT NULL` is not a predicate the planner
 * needs help with once most rows qualify.
 *
 * Generated: 2026-08-31 (synthetic sequential prefix per docs/migrations.md
 * rule 3; the preceding slots are #2399's handshake and #2395's routing commit).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShipmentFulfillmentWorkId1869000000000 implements MigrationInterface {
  name = 'AddShipmentFulfillmentWorkId1869000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shipments"
      ADD COLUMN IF NOT EXISTS "fulfillmentWorkId" text
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_shipments_fulfillmentWorkId"
      ON "shipments" ("fulfillmentWorkId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_shipments_fulfillmentWorkId"`);
    await queryRunner.query(`ALTER TABLE "shipments" DROP COLUMN IF EXISTS "fulfillmentWorkId"`);
  }
}
