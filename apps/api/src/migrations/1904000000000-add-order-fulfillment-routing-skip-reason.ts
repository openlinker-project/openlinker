/**
 * Add `order_records.fulfillmentRoutingSkipReason` (#3455, epic #3460).
 *
 * Why OpenLinker deliberately did NOT route an order to the pack bench while the
 * OMS is on: the order came from the operator's own shop (#3487), its delivery
 * method is routed to another system (#3488), or the product master already
 * received it before routing was switched on (#3455). One column for the one
 * question an operator asks ("why is this order not on the pack bench?").
 *
 * Distinct from `fulfillmentBlockReason` (#2396): every value there means the
 * order is HELD and not mirrored, whereas a skipped order follows today's path.
 *
 * Level-triggered, sole writer `OrderIngestionService` via
 * `updateFulfillmentRoutingSkipReason`, and outside the ingestion write set so a
 * re-poll cannot reset it. Nullable with no backfill: an order ingested before
 * this column existed has no recorded answer, which is the honest state until
 * its next ingestion re-decides it.
 *
 * **No index, deliberately** - the `fulfillmentBlockReason` call: nothing filters
 * on it yet, and a partial index over a hardcoded value list is the shape that
 * went stale on `IDX_order_records_salesDocumentBlockReason`. The consuming
 * issue (#3482) adds one against its own data.
 *
 * Generated: 2026-09-25 (synthetic sequential prefix per docs/migrations.md
 * rule 3; above `origin/main`'s 1899000000000 and the stack's 1893000000000).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderFulfillmentRoutingSkipReason1904000000000 implements MigrationInterface {
  name = 'AddOrderFulfillmentRoutingSkipReason1904000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "fulfillmentRoutingSkipReason" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "fulfillmentRoutingSkipReason"`
    );
  }
}
