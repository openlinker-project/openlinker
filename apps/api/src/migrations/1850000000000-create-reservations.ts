/**
 * Create Reservations Migration (#2343, ADR-061, ANALYSIS-1032 § 6I)
 *
 * Creates the `reservations` table — OpenLinker's own advisory reservation
 * ledger — and adds the `inventory_items.olReservedQuantity` counter it
 * denormalises.
 *
 * Four constraint choices are the design rather than housekeeping:
 *
 * - **`UQ_reservations_active_line` is PARTIAL on `status = 'held'`.** That
 *   partiality IS the idempotency key (§ 6I): a retried reserve conflicts
 *   instead of double-incrementing the counter, while a released line can be
 *   re-reserved later without colliding with its own terminal history. The key
 *   must carry `orderRecordId` — `orderLineId` is the *source-supplied*
 *   `OrderItem.id`, unique only within its own order, and Allegro / PrestaShop
 *   line ids collide across orders trivially.
 * - **`CHK_inventory_items_ol_reserved_nonneg` is § 6I's hard floor** beneath
 *   the guarded `WHERE` that makes underflow unreachable in the first place.
 * - **There is deliberately NO `CHECK ("olReservedQuantity" <=
 *   "availableQuantity")`.** A master may legitimately lower availability below
 *   an already-committed reservation set; such a constraint would make the
 *   *sync* fail rather than surface a shortfall, and the shortfall is a fact an
 *   operator must see (`W2-12`), not an error that hides it.
 * - **`CHK_reservations_quantity_positive` is an addition** to the schema § 6I
 *   specifies. A zero-unit hold is meaningless and a negative one would corrupt
 *   the counter through the guarded add, so the floor belongs in the database
 *   where no caller can bypass it.
 *
 * The ONE foreign key is `reservations.inventoryItemId -> inventory_items(id)`
 * `ON DELETE RESTRICT`: a position carrying live reservations must not vanish
 * (the stale path soft-marks rather than deletes). There is no FK on
 * `orderRecordId` / `orderLineId` — the `refund_records` / `returns` precedent
 * for the first, and for the second it is not merely undesirable but impossible:
 * `order_records` has no lines table, so the value points into the
 * `orderSnapshot` jsonb document.
 *
 * Every constraint below is declared under the SAME NAME on the ORM entities,
 * because the integration harness builds its schema by `synchronize` rather than
 * by migration and an anonymous constraint would carry a hash name there.
 *
 * `olReservedQuantity` is `NOT NULL DEFAULT 0`, so existing rows backfill
 * without a data migration.
 *
 * Generated: 2026-08-26 (synthetic sequential prefix per docs/migrations.md rule 3).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReservations1850000000000 implements MigrationInterface {
  name = 'CreateReservations1850000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `reservations.id` defaults to uuid_generate_v4() — same guard the
    // refund_records / returns migrations use.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      ALTER TABLE "inventory_items"
        ADD COLUMN IF NOT EXISTS "olReservedQuantity" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'CHK_inventory_items_ol_reserved_nonneg'
        ) THEN
          ALTER TABLE "inventory_items"
            ADD CONSTRAINT "CHK_inventory_items_ol_reserved_nonneg"
            CHECK ("olReservedQuantity" >= 0);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "reservations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "orderRecordId" text NOT NULL,
        "orderLineId" text NOT NULL,
        "inventoryItemId" text NOT NULL,
        "quantity" integer NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'held',
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "atpEffect" character varying(16) NOT NULL,
        "closedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reservations" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_reservations_quantity_positive" CHECK ("quantity" > 0),
        CONSTRAINT "FK_reservations_inventory_item"
          FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id")
          ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_reservations_active_line"
        ON "reservations" ("orderRecordId", "orderLineId", "inventoryItemId")
        WHERE "status" = 'held'
    `);

    // Named for the query #2345 must run: `computeAtp` fixes the sum as
    // `Σ quantity WHERE status='held' AND atpEffect='published'`, joined to
    // `inventory_items` to reach the variant. Both predicate columns lead.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_reservations_atp_sum"
        ON "reservations" ("status", "atpEffect", "inventoryItemId")
    `);

    // #2349's expiry-sweep candidate scan (only half its predicate — expiry is
    // state-dependent and reads orders afterwards).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_reservations_status_expires_at"
        ON "reservations" ("status", "expiresAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_reservations_order_record"
        ON "reservations" ("orderRecordId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_reservations_order_record"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_reservations_status_expires_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_reservations_atp_sum"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_reservations_active_line"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "reservations"`);
    await queryRunner.query(`
      ALTER TABLE "inventory_items"
        DROP CONSTRAINT IF EXISTS "CHK_inventory_items_ol_reserved_nonneg"
    `);
    await queryRunner.query(`
      ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "olReservedQuantity"
    `);
  }
}
