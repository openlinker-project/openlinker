/**
 * Create `return_line_events` (#2370, `W2-33`, ADR-060)
 *
 * The append-only per-line ACT LEDGER beside `return_lines`' counters. See the
 * ORM entity and `return-line-event.types.ts` for why acts exist at all — in
 * short, a counter cannot key an idempotent trigger firing, and #2360 needs a
 * three-parcel return to fire `return.received` three times.
 *
 * Every index and check declared here is ALSO declared class-level on the ORM
 * entity under the same name, because the integration harness builds its schema
 * by `synchronize` rather than by migration.
 *
 * No foreign key to `return_lines` — this context's existing posture (the one FK
 * in the returns schema is `return_lines.returnId -> returns(id)`), matching the
 * `refund_records` / `invoice_records` precedent of an indexed reference by
 * value. The integration harness therefore truncates this table explicitly.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReturnLineEvents1852000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "return_line_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "returnId" text NOT NULL,
        "returnLineId" text NOT NULL,
        "seq" integer NOT NULL,
        "kind" character varying(32) NOT NULL,
        "quantity" integer NOT NULL,
        "disposition" character varying(32),
        "restockState" character varying(32) NOT NULL DEFAULT 'not_applicable',
        "restockBlockedReason" character varying(48),
        "restockBlockedDetail" text,
        "restockedBy" character varying(32),
        "masterConnectionId" text,
        "note" text,
        "actorUserId" text,
        "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "attestedByEventId" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_return_line_events" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_return_line_events_quantity_positive" CHECK ("quantity" > 0)
      )
    `);

    // The per-line sequence IS the `{seq}` of the
    // `return:{returnId}:{lineId}:{seq}` idempotency key (#2368). Unique so two
    // concurrent writers cannot mint one key for two acts.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_return_line_events_line_seq"
        ON "return_line_events" ("returnLineId", "seq")
    `);

    // The operator-attention read (spec § 5.4): unresolved restock blocks only.
    // Partial, because the rows it can never match — every receipt, scrap and
    // applied restock — are the overwhelming majority.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_return_line_events_outstanding_restock"
        ON "return_line_events" ("returnId")
        WHERE "restockState" IN ('blocked', 'in_doubt')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_return_line_events_outstanding_restock"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_return_line_events_line_seq"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "return_line_events"`);
  }
}
