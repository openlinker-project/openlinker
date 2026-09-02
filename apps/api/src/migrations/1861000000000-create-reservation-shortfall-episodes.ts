/**
 * Reservation shortfall episodes (#2349, design § 4.2 story I6)
 *
 * Creates `reservation_shortfall_episodes` — the persisted, operator-facing
 * fact that OpenLinker promised more of a sku than the master now has, and
 * which ORDER that lands on.
 *
 * Two schema decisions carry the whole design:
 *
 * - **`UQ_reservation_shortfall_open` is PARTIAL on `"closedAt" IS NULL`.** It
 *   is not merely a duplicate guard: it is what makes an episode's id STABLE.
 *   While the condition stands, every re-detection conflicts, and the conflict
 *   arm refreshes the quantities while leaving the ID alone (#2628 review) — so
 *   an edge-triggered automation (`W2-23`'s T8) has a fixed key to build an
 *   idempotency key from, and the row never asserts a stale figure. A closed
 *   row leaves the index, so a recurrence inserts cleanly under a NEW id.
 * - **`IDX_inventory_items_ol_reserved` is added to `inventory_items`.** The
 *   reconciler compares `"availableQuantity"` against a correlated sum over
 *   `reservations` (#2628 review — only holds stamped `published` count), which
 *   NO index on this table can serve directly, so without this
 *   the pass sequentially scans the table every published quantity derives
 *   from, on every tick. Narrowing to positions carrying any hold bounds that
 *   cost by the size of the ledger rather than of the catalogue.
 *
 * No foreign keys: `orderRecordId` follows the `reservations` precedent (an
 * episode must be recordable for an order OL has not ingested), and
 * `inventoryItemId` is deliberately unconstrained because an episode is
 * EVIDENCE about a position and must outlive the position row rather than
 * cascade away with it.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReservationShortfallEpisodes1861000000000 implements MigrationInterface {
  name = 'CreateReservationShortfallEpisodes1861000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "reservation_shortfall_episodes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "orderRecordId" text NOT NULL,
        "inventoryItemId" text NOT NULL,
        "productVariantId" text,
        "sku" text,
        "shortQuantity" integer NOT NULL,
        "positionShortfall" integer NOT NULL,
        "openedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "closedAt" TIMESTAMP WITH TIME ZONE,
        "closeReason" character varying(32),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reservation_shortfall_episodes" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_reservation_shortfall_quantity_positive" CHECK ("shortQuantity" > 0)
      )
    `);

    // The episode-identity key. See the file header for why it is partial.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_reservation_shortfall_open"
        ON "reservation_shortfall_episodes" ("orderRecordId", "inventoryItemId")
        WHERE "closedAt" IS NULL
    `);

    // The close sweep's page: the partial UNIQUE index cannot serve
    // `"closedAt" IS NULL ORDER BY "id"`.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_reservation_shortfall_open_id"
        ON "reservation_shortfall_episodes" ("id")
        WHERE "closedAt" IS NULL
    `);

    // The order-detail projection's read.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_reservation_shortfall_order"
        ON "reservation_shortfall_episodes" ("orderRecordId")
    `);

    // The detection scan's bound. See the file header.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inventory_items_ol_reserved"
        ON "inventory_items" ("id")
        WHERE "olReservedQuantity" > 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_inventory_items_ol_reserved"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_reservation_shortfall_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_reservation_shortfall_open_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_reservation_shortfall_open"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "reservation_shortfall_episodes"`);
  }
}
