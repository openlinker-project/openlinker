/**
 * Create the fulfilment progress claim table (#2400, `W3a-11`, ADR-054).
 *
 * `fulfillment_progress_claims` — one row per `(workId, idempotencyKey)`, the
 * at-most-once gate for fulfilment progress ingestion (REVIEW C9).
 *
 * Three choices are **contract rather than housekeeping**:
 *
 * - **The uniqueness is the composite PRIMARY KEY, and it is UNCONDITIONAL.**
 *   A partial index over "live" states was considered on the
 *   `reservations WHERE status = 'held'` / `order_changes WHERE status IN (...)`
 *   precedent and rejected. Those predicates express SLOT-HOLDING, where a
 *   terminal row must not block a legitimate fresh holder, so the index
 *   deliberately forgets terminal rows. A progress dedup key is the opposite:
 *   PERMANENT MEMORY. A replay must be a no-op forever, and any predicate that
 *   lets a row leave the index reopens the window in which a replay re-moves
 *   counters and re-fires a relay.
 *
 * - **It is also the table's ONLY uniqueness declaration, and
 *   `FulfillmentProgressClaimRepository` depends on that.** That repository
 *   emits a bare `ON CONFLICT DO NOTHING` (TypeORM 0.3.17's `orIgnore` discards
 *   its argument — #2360), which is safe only while exactly one conflict is
 *   reachable. Adding a second unique index here without first giving that
 *   insert an explicit column-list target would make an unrelated conflict
 *   report "already claimed" — the answer that suppresses a progress write and
 *   its relay permanently, and silently.
 *
 * - **The FK CASCADEs.** A claim is meaningless without its work row, and an
 *   orphan would let a re-created work id inherit a stale suppression.
 *
 * There is deliberately **no `fulfillment_works.externalWorkId` column here**,
 * though an earlier draft of #2400's plan carried one. #2399 owns the executor
 * handshake and therefore the writer, and with it the choice between a column
 * (the `returns.externalReturnId` shape) and `identifier_mappings` resolution.
 * A migration is the hardest artefact to unship, so guessing would hand #2399 a
 * schema it must migrate away from. `record()` takes a `workId` instead — an
 * internal id entering as an argument, which is ADR-053's stated discipline.
 *
 * No PG enum on `eventKind`, matching the whole tree: it is forensic evidence of
 * what arrived, and a CHECK would make a future kind (`awaiting_wave`) a
 * migration before it is a feature.
 *
 * `uuid_generate_v4()` is deliberately NOT used — every column here is supplied
 * by the caller — so this migration is unaffected by #2684.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFulfillmentProgressClaims1865000000000 implements MigrationInterface {
  name = 'CreateFulfillmentProgressClaims1865000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fulfillment_progress_claims" (
        "workId" text NOT NULL,
        "idempotencyKey" text NOT NULL,
        "connectionId" uuid NOT NULL,
        "eventKind" text NOT NULL,
        "claimedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_fulfillment_progress_claims" PRIMARY KEY ("workId", "idempotencyKey"),
        CONSTRAINT "FK_fulfillment_progress_claims_work" FOREIGN KEY ("workId")
          REFERENCES "fulfillment_works"("id") ON DELETE CASCADE
      )
    `);

    // Supports an age-based retention sweep, which does not exist yet. Cheap
    // now; a second migration later is not (the #2392 `requestStatus` reasoning).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fulfillment_progress_claims_claimed_at"
        ON "fulfillment_progress_claims" ("claimedAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fulfillment_progress_claims_claimed_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fulfillment_progress_claims"`);
  }
}
