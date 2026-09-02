/**
 * Add the order-timeline index on `return_line_events` (#2383)
 *
 * The order-detail timeline reads every act on every return of one order. The
 * existing `returnId` index is PARTIAL
 * (`WHERE "restockState" IN ('blocked','in_doubt')`, built for #2378's blocked
 * segment count), so it cannot serve a read that wants every act; the other
 * index leads on `returnLineId`. Without this one the read is a sequential scan
 * of the act ledger on every order-detail page load.
 *
 * `occurredAt` is the second column because the read orders by it within a
 * return. No predicate, deliberately.
 *
 * Kept in exact step with the `@Index` on `ReturnLineEventOrmEntity` — the
 * integration harness builds its schema with `synchronize`, so a mismatch here
 * is invisible in every gate and appears only in production.
 *
 * @module migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReturnLineEventsTimelineIndex1863000000000 implements MigrationInterface {
  name = 'AddReturnLineEventsTimelineIndex1863000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_return_line_events_return_id_occurred" ON "return_line_events" ("returnId", "occurredAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_return_line_events_return_id_occurred"`);
  }
}
