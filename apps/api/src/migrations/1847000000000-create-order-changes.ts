/**
 * Create Order Changes Migration (#2333, ADR-044)
 *
 * Creates `order_changes` — the ADR-044 change-proposal record, and **the table
 * Wave 2 (#2389) reuses rather than re-inventing**: "`order_changes` is built
 * once, in #2333, and reused here — no second proposal mechanism."
 *
 * Four choices are the contract rather than housekeeping.
 *
 * - **`kind` names the verb OL ASKS FOR; `status` names what happened to the
 *   ASKING.** A `kind = 'return.decline'` row whose `status = 'declined'` means
 *   the marketplace refused OL's request to decline the buyer's refund. Reading
 *   it the other way inverts a commercially meaningful outcome.
 *
 * - **`kind` is a plain `varchar(64)`: no PG enum, no `CHECK`.** Wave 2 widens
 *   the vocabulary with amendment kinds, and a database-level list would cost a
 *   migration per kind and would turn an out-of-tree kind into a hard write
 *   failure instead of a coercion miss. `isOrderChangeKind` coerces on read.
 *
 * - **`UQ_order_changes_open_target` is PARTIAL, on `(internalOrderId,
 *   targetRef)` over the OPEN statuses only.** ADR-044 corrected an earlier
 *   draft on exactly this: one-open-change-per-ORDER would serialize an order's
 *   shipments against each other — a liveness bug, not a safety one. `targetRef`
 *   names the thing being mutated (here a `ReturnRecord.id`; later a shipment,
 *   a destination connection, a document). `kind` is deliberately absent from
 *   the key: two different kinds open against one target are a contradiction,
 *   not a parallelism. The predicate must stay identical to the one declared on
 *   `OrderChangeOrmEntity`, because the integration harness builds its schema by
 *   `synchronize` rather than by migration.
 *
 * - **`internalOrderId` is NOT NULL**, which is what makes "refuse the action
 *   for an orphan return" a schema fact rather than a service convention. Every
 *   ADR-044 change is a change *to an order*.
 *
 * There is deliberately **no FK** to `order_records` — the `refund_records` /
 * `invoice_records` precedent of an indexed reference by value, avoiding
 * cross-table lock coupling. Nothing therefore cascades into this table, so
 * `apps/api/test/integration/setup.ts` truncates it explicitly.
 *
 * Generated: 2026-08-25 (synthetic sequential prefix per docs/migrations.md
 * rule 3; 1846 is #2327's).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderChanges1847000000000 implements MigrationInterface {
  name = 'CreateOrderChanges1847000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `id` defaults to uuid_generate_v4() — the same guard 1846 and the
    // refund_records migration use.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_changes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "internalOrderId" text NOT NULL,
        "kind" character varying(64) NOT NULL,
        "targetRef" text NOT NULL,
        "status" character varying(16) NOT NULL,
        "payload" jsonb,
        "requestedBy" text,
        "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "confirmedBy" text,
        "confirmedAt" TIMESTAMP WITH TIME ZONE,
        "declinedReason" text,
        "appliedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_changes" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_changes_open_target"
        ON "order_changes" ("internalOrderId", "targetRef")
        WHERE "status" IN ('pending', 'requested')
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_changes_order"
        ON "order_changes" ("internalOrderId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_changes_target"
        ON "order_changes" ("targetRef")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_changes_target"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_changes_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_order_changes_open_target"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_changes"`);
  }
}
