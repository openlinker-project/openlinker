/**
 * Create the shipment line tables (#2727, `DECISION-oms-fulfilment-grain` option C).
 *
 * `shipment_lines` + `shipment_line_events` — line-grain shipment records so an
 * order's shipped / delivered quantities are DERIVABLE rather than inferred
 * from shipment status alone.
 *
 * Four choices below are **contract rather than housekeeping**:
 *
 * - **`orderId` is part of the line's identity, not a payload column.**
 *   `shipments.orderId` is the order the parcel was *dispatched for*; a
 *   CONSOLIDATED parcel carries units from more than one order, and keeping
 *   that expressible is the entire reason option C keys on
 *   `(shipmentId, orderId, lineId)`. Derive it from the shipment header instead
 *   and a line belonging to order B inside a parcel headed by order A becomes
 *   unrepresentable — order B's derived shipped quantity is permanently zero
 *   and nothing says so.
 *
 * - **`CHK_shipment_lines_capacity` deliberately OMITS `"shippedQuantity" <=
 *   "quantity"`.** Two ordinary paths violate it: re-ingestion rewrites
 *   `orderSnapshot` wholesale (so a frozen `quantity` of 2 meets a `ship(5)`
 *   act), and `ShipmentDispatchService` reuses one shipment row across retries
 *   (so `ship`+`cancel`+`ship` folds to `shipped = 4` on a line of 2). Either
 *   would raise inside the best-effort reconcile and silently stop the read
 *   model converging. `quantity` is provenance; the bound that matters is
 *   `"cancelledQuantity" <= "shippedQuantity"`, which makes the NET shipped
 *   quantity non-negative by construction.
 *
 * - **`UQ_shipment_line_events_line_kind_occurred` carries the INSTANT.** A
 *   `(line, kind)` key would let a re-dispatched shipment fold to a net shipped
 *   of 0 for a parcel that really shipped, because its `cancel` act could never
 *   be superseded. With the instant in the key, a repeated reconcile re-derives
 *   the identical tuple and inserts nothing, while a genuine re-dispatch
 *   carries a new `dispatchedAt` and emits a second `ship` act — idempotent
 *   with no sequence counter and therefore no lock, unlike the returns
 *   `(returnLineId, seq)` shape.
 *
 * - **Both FKs are real and CASCADE; the cross-aggregate references are not.**
 *   A line is part of its shipment and an act is part of its line, so deleting
 *   a shipment must take both. `orderId` / `lineId` / `productVariantId` get
 *   references by value with no FK — the `order_changes` / `refund_records` /
 *   `returns.internalOrderId` precedent — and `lineId` could not have one in
 *   any case: `order_records` has no lines table, items live inside the
 *   `orderSnapshot` jsonb.
 *
 * No PG enum on `kind`, matching the whole tree (zero `CREATE TYPE … AS ENUM`
 * in this directory): the union is enforced in TypeScript, so widening it never
 * needs an `ALTER TYPE` plus a coordinated deploy.
 *
 * Every index and CHECK is declared class-level on the ORM entities under the
 * SAME NAME used here — the integration harness builds its schema by
 * `synchronize`, so a constraint present only here would hold in production and
 * silently not in tests. Both tables join
 * `fulfillment-work-migration-parity.int-spec.ts`, the only automated check of
 * a migration in this repository.
 *
 * Generated: 2026-09-06 (synthetic sequential prefix per docs/migrations.md
 * rule 3; `main`'s tail is 1870000004000).
 *
 * @module migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateShipmentLines1874000000000 implements MigrationInterface {
  name = 'CreateShipmentLines1874000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Both ids default to uuid_generate_v4() — the same guard the neighbouring
    // OMS migrations use, because the chain cannot assume the extension (#2684).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "shipment_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shipmentId" text NOT NULL,
        "orderId" text NOT NULL,
        "lineId" text NOT NULL,
        "productVariantId" text,
        "quantity" integer NOT NULL,
        "shippedQuantity" integer NOT NULL DEFAULT 0,
        "deliveredQuantity" integer NOT NULL DEFAULT 0,
        "cancelledQuantity" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_shipment_lines" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_shipment_lines_capacity" CHECK (
          "quantity" >= 0 AND "shippedQuantity" >= 0
          AND "deliveredQuantity" >= 0 AND "cancelledQuantity" >= 0
          AND "deliveredQuantity" <= "shippedQuantity"
          AND "cancelledQuantity" <= "shippedQuantity"
        ),
        CONSTRAINT "FK_shipment_lines_shipment" FOREIGN KEY ("shipmentId")
          REFERENCES "shipments"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "shipment_line_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shipmentLineId" uuid NOT NULL,
        "kind" character varying(16) NOT NULL,
        "quantity" integer NOT NULL,
        "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_shipment_line_events" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_shipment_line_events_quantity_positive" CHECK ("quantity" > 0),
        CONSTRAINT "FK_shipment_line_events_line" FOREIGN KEY ("shipmentLineId")
          REFERENCES "shipment_lines"("id") ON DELETE CASCADE
      )
    `);

    // The line's identity, and the key every upsert conflicts on. Its leading
    // column serves every `WHERE "shipmentId" = ?` read AND the CASCADE FK's
    // referential check, so there is no separate index on "shipmentId".
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_shipment_lines_shipment_order_line"
        ON "shipment_lines" ("shipmentId", "orderId", "lineId")
    `);
    // The per-order derivation read. Not servable by the unique index above,
    // which leads on "shipmentId".
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_shipment_lines_order_line"
        ON "shipment_lines" ("orderId", "lineId")
    `);
    // Instant in the key — see the module docblock. Leading column serves the
    // per-line fold and the CASCADE FK's referential check.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_shipment_line_events_line_kind_occurred"
        ON "shipment_line_events" ("shipmentLineId", "kind", "occurredAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_shipment_line_events_line_kind_occurred"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_shipment_lines_order_line"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_shipment_lines_shipment_order_line"`);
    // Children before parent — the FKs are CASCADE on delete, not on drop.
    await queryRunner.query(`DROP TABLE IF EXISTS "shipment_line_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "shipment_lines"`);
  }
}
