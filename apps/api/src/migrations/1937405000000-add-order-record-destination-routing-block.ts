/**
 * Add `order_records.destinationRoutingBlockReason` / `destinationRoutingBlockDetail`
 * plus their partial index (#2703 / #2704).
 *
 * How a fulfilment routing decision narrowed this order's destination fan-out,
 * so `/orders` can tell a working router making a decision apart from a broken
 * or empty configuration. The #2100 `salesDocument*` shape: `OrderSyncService`
 * is the sole writer, the value is level-triggered (re-decided on every run,
 * `null` clearing it), and both columns stay outside the ingestion write set so
 * a re-poll cannot reset them.
 *
 * `text`, matching the neighbouring `fulfillmentBlockDetail` /
 * `salesDocumentBlockDetail` columns rather than a sized `varchar`, and with no
 * CHECK — the union is enforced in TypeScript and coerced on read by
 * `isDestinationRoutingBlockReason`.
 *
 * **An index, unlike #2396's sibling columns — and PARTIAL ON `IS NOT NULL`
 * rather than over a value list.** `1869000000400` deliberately shipped no index
 * because nothing filtered on those columns; this slice does filter and count,
 * so the index has a consumer. But it must not take the obvious value-list form:
 * that is exactly what silently went stale on
 * `IDX_order_records_salesDocumentBlockReason` when #2248 widened that union
 * without touching the index. A NULL predicate cannot go stale as the vocabulary
 * grows, and is no larger — it matches only routing-narrowed orders, of which
 * there are none on any install today (no production caller populates
 * `OrderSyncRequest.destinationConnectionIds` yet).
 *
 * The mismatch with the READ side is deliberate, not an oversight: the count and
 * the filter match an explicit `IN (...)` list of the attention-worthy reasons
 * (so a value written by a newer release is not counted), while this index is
 * `IS NOT NULL`. Postgres can still use it - `reason IN (...)` implies
 * `reason IS NOT NULL`, so the partial predicate is satisfied - and the index
 * stays correct however the list is later edited.
 *
 * The index is declared on the ORM entity as well, because the integration
 * harness builds schema by `synchronize` and a migration-only index would hold
 * in production and silently not in tests.
 *
 * Generated: 2026-09-08 (synthetic sequential prefix per docs/migrations.md
 * rule 3).
 *
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordDestinationRoutingBlock1937405000000 implements MigrationInterface {
  name = 'AddOrderRecordDestinationRoutingBlock1937405000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "destinationRoutingBlockReason" text`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "destinationRoutingBlockDetail" text`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_records_destinationRoutingBlockReason" ` +
        `ON "order_records" ("destinationRoutingBlockReason") ` +
        `WHERE "destinationRoutingBlockReason" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_order_records_destinationRoutingBlockReason"`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "destinationRoutingBlockDetail"`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "destinationRoutingBlockReason"`
    );
  }
}
