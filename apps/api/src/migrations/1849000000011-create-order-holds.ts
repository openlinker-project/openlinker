/**
 * Create Order Holds Migration (#2338, DESIGN §6.3 / REVIEW §3 H9)
 *
 * Creates `order_holds` — the record that OpenLinker deliberately stopped an
 * order, and the first OL-owned lifecycle write in the OMS programme. Before
 * this there was no way to stop an order at all: a fraud-suspect or unpaid order
 * flowed straight through provisioning and dispatch, and the operator's only
 * recourse was disabling a connection, which stops every order.
 *
 * Four choices are the contract rather than housekeeping.
 *
 * - **`UQ_order_holds_open_order` is PARTIAL, on `(internalOrderId)` over OPEN
 *   rows only.** At most one open hold per order is v1's grain. Partial rather
 *   than total is what makes releasing FREE the slot — a total unique index
 *   would leave an order permanently unholdable after its first release, a
 *   liveness bug of exactly the shape ADR-044 corrected for `order_changes`.
 *   The predicate must stay identical to the one declared on
 *   `OrderHoldOrmEntity`, because the integration harness builds its schema by
 *   `synchronize` rather than by migration.
 *
 * - **`CHK_order_holds_actor` requires EXACTLY one actor** (`<>`, i.e. XOR), not
 *   at least one. A row claiming both a human and a service placed it is not a
 *   richer record, it is an unanswerable audit question — and §6.4's release
 *   rule ("released by the placing service, or by an admin with a mandatory
 *   release note") is only decidable if the placer is unambiguous.
 *
 * - **`reason` is a plain `varchar(64)`: no PG enum, no `CHECK`** — and this is
 *   the choice most likely to be "corrected" later, because the reasoning
 *   differs from the `order_changes` file next door. There, `kind` is left open
 *   because Wave 2 widens it. Here `HoldReason` is a CLOSED union (ADR-059), so
 *   a database-level list would be defensible; it is still declined, because it
 *   would cost a migration per value and would turn a rollback past a widened
 *   vocabulary into a hard write failure rather than a coercion miss.
 *   `isHoldReason` coerces on read and `OrderHoldVocabularyError` reports a
 *   miss — deliberately reporting rather than defaulting, since silently mapping
 *   an unknown value onto `operator` would attribute a machine's hold to a human.
 *
 * - **`placedAt` is the backing fact for automation trigger T3** ("on hold for N
 *   days"). No `phaseEnteredAt` column is added here or anywhere else — that was
 *   adjudicated, because a phase fed by `now` is uninvalidatable.
 *
 * There is deliberately **no FK** to `order_records` — the `refund_records` /
 * `invoice_records` / `order_changes` precedent of an indexed reference by
 * value, avoiding cross-table lock coupling. Nothing therefore cascades into
 * this table, so `apps/api/test/integration/setup.ts` truncates it explicitly.
 *
 * Generated: 2026-08-26 (synthetic sequential prefix per docs/migrations.md
 * rule 3; 1848 is #2327's return-external-order-id).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderHolds1849000000011 implements MigrationInterface {
  name = 'CreateOrderHolds1849000000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `id` defaults to uuid_generate_v4() — the same guard 1846/1847 use.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_holds" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "internalOrderId" text NOT NULL,
        "reason" character varying(64) NOT NULL,
        "note" text,
        "placedByUserId" text,
        "placedByService" text,
        "placedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "releasedAt" TIMESTAMP WITH TIME ZONE,
        "releasedByUserId" text,
        "releaseNote" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_holds" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_order_holds_actor" CHECK (
          ("placedByUserId" IS NOT NULL) <> ("placedByService" IS NOT NULL)
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_holds_open_order"
        ON "order_holds" ("internalOrderId")
        WHERE "releasedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_holds_order"
        ON "order_holds" ("internalOrderId", "placedAt")
    `);

    // Serves T3's open-row scan (`listOpenPlacedBefore`).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_holds_open_placed_at"
        ON "order_holds" ("placedAt")
        WHERE "releasedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_order_holds_open_placed_at"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_holds_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_order_holds_open_order"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_holds"`);
  }
}
