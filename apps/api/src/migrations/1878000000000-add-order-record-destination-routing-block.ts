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
 * The index is declared on the ORM entity as well, because the integration
 * harness builds schema by `synchronize` and a migration-only index would hold
 * in production and silently not in tests.
 *
 * Generated: 2026-09-08 (synthetic sequential prefix per docs/migrations.md
 * rule 3).
 *
 * RENUMBERED from `1875000003400` before merge. That original value was chosen
 * with a `…3400` offset so it could not collide with a sibling on a concurrent
 * unpushed branch — `check-migration-timestamps.mjs` compares only against
 * `origin/main` and cannot see one. The offset did its job and was then
 * overtaken by ordinary merges: `1876000000000` (#2073's waybill-relay failure
 * tracking) and `1877000000000` (#2728's progress-claim index) both landed on
 * `main` first, so `…3400` came to sort BEFORE the newest migration there and
 * the guard refused it — correctly, and only once those merged.
 *
 * `1878000000000` sits above both. The lesson is that an offset protects
 * against a sibling branch, not against the branch being outlived by the queue
 * ahead of it; a late-merging migration is renumbered rather than nudged.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordDestinationRoutingBlock1878000000000 implements MigrationInterface {
  name = 'AddOrderRecordDestinationRoutingBlock1878000000000';

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
