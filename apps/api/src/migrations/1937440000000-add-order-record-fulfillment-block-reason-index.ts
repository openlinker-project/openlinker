/**
 * Add a partial index on `order_records.fulfillmentBlockReason` (#3558).
 *
 * `1869000000400` shipped the column with no index because nothing filtered on
 * it at volume; #3485's reroute sweep reads a handful of held orders, which the
 * primary key serves. #3558 changes that: `listOrderIdsHeldForVariant` runs on
 * every `inventory.propagateToMarketplaces` that carries a variant, the hottest
 * write path in the system, and without an index each stock change paid a
 * sequential scan of `order_records` (the #2943 pattern).
 *
 * **Partial on `IS NOT NULL`, not over a value list** - the
 * `IDX_order_records_destinationRoutingBlockReason` reasoning: a value-list
 * predicate goes stale when the reason union widens, a NULL predicate does not.
 * The query's `reason IN (...)` implies `reason IS NOT NULL`, so Postgres can
 * use it, and it stays tiny because held orders are rare.
 *
 * Plain `CREATE INDEX`, not `CONCURRENTLY`: TypeORM runs each migration in a
 * transaction, and the partial predicate keeps the build to the held rows'
 * share of a single scan.
 *
 * Declared on the ORM entity as well, because the integration harness builds
 * schema by `synchronize`.
 *
 * Generated: 2026-11-02 (synthetic sequential prefix per docs/migrations.md
 * rule 3).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordFulfillmentBlockReasonIndex1937440000000 implements MigrationInterface {
  name = 'AddOrderRecordFulfillmentBlockReasonIndex1937440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_records_fulfillmentBlockReason" ` +
        `ON "order_records" ("fulfillmentBlockReason") ` +
        `WHERE "fulfillmentBlockReason" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_fulfillmentBlockReason"`);
  }
}
