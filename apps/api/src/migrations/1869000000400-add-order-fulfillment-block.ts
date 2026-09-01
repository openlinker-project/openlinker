/**
 * Add `order_records.fulfillmentBlockReason` / `fulfillmentBlockDetail` (#2396, W3a).
 *
 * Why an order is HELD by the fulfilment intercept — not mirrored to any
 * destination — when no work object explains it. The #2100 `salesDocument*`
 * shape: `OrderIngestionService` is the sole writer, the value is level-
 * triggered (re-decided on every transition, `null` clearing it), and both
 * columns stay outside the ingestion write set so a re-poll cannot reset them.
 *
 * **Narrower than #2396's text, deliberately.** The issue also prescribes a
 * reason for the `ambiguous` arm. #2352 landed after that was written and
 * already reports it: `'sourcing-ambiguous'` (spec row A2-A) surfaces at
 * `['order', 'connection']` with `counted: true`, derived on every read and
 * never persisted. Writing it here too would double-count `Needs attention (N)`.
 * See `fulfillment-block-reason.types.ts`.
 *
 * `text`, matching the neighbouring `shippingAddressHash` / `buyerTaxId` and
 * `salesDocumentBlockDetail` columns rather than a sized `varchar`.
 *
 * **No index, deliberately** — the same call `omsAttention` (#2352) made.
 * Nothing filters on these columns yet (the operator surface is a later issue),
 * so an index here would be permanently empty DDL sized against no real
 * cardinality; and a partial index over a hardcoded value list is exactly the
 * shape that silently went stale on `IDX_order_records_salesDocumentBlockReason`
 * when #2248 widened that union without touching the index. The consuming issue
 * adds it, against its own data.
 *
 * Generated: 2026-08-31 (synthetic sequential prefix per docs/migrations.md
 * rule 3; 1869000000000 is #2402's `shipments.fulfillmentWorkId`).
 *
 * The `…400` rather than `…001` is deliberate, not a gap to tidy up: Wave 3a
 * reserved `…100` / `…200` / `…300` / `…900` for siblings in flight on
 * unpushed branches. `check-migration-timestamps.mjs` compares only against
 * `origin/main`, so it cannot see those and would not catch a collision.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderFulfillmentBlock1869000000400 implements MigrationInterface {
  name = 'AddOrderFulfillmentBlock1869000000400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "fulfillmentBlockReason" text`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "fulfillmentBlockDetail" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "fulfillmentBlockDetail"`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "fulfillmentBlockReason"`
    );
  }
}
