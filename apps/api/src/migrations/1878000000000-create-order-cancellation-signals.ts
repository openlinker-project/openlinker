/**
 * Create Order Cancellation Signals Migration (#2069)
 *
 * Creates `order_cancellation_signals` — a durable trace that a source
 * cancellation arrived for an order OpenLinker has not yet ingested.
 *
 * Before this, `OrderIngestionService.handleSourceCancellation` had nowhere
 * to write when `IIdentifierMappingService.getInternalId` resolved no
 * mapping: `OrderRecordRepository.markCancelled` is a bare
 * `UPDATE ... WHERE "internalOrderId" = $2` with no insert fallback, so a
 * cancel racing ahead of the order's own create/sync job was silently
 * dropped and the later create provisioned the order as active at every
 * destination. Minting an internal id via `getOrCreateInternalId` from the
 * cancellation path to give `markCancelled` something to hit was rejected —
 * it would create a phantom, operator-visible order with no real data yet,
 * exactly the shape #2328 rejected for returns attribution.
 *
 * The signal is keyed on `(sourceConnectionId, externalOrderId)` instead —
 * the one durable identity that exists before ingestion — and is consumed
 * (atomically, `DELETE ... RETURNING`) by
 * `OrderRecordService.persistIncomingSnapshot` the moment the order is
 * genuinely first ingested, applying it through the existing first-write-wins
 * `markCancelled` pipeline (#1984) that `OrderSyncService`'s `#2284`
 * `cancelledAt IS NULL` provisioning guard already reads.
 *
 * There is deliberately **no FK** to `order_records` — the `order_holds` /
 * `order_changes` / `refund_records` precedent of an indexed reference by
 * value; here there is nothing yet to reference at all. Nothing cascades
 * into this table, so `apps/api/test/integration/setup.ts` truncates it
 * explicitly.
 *
 * The unique index name matches `OrderCancellationSignalOrmEntity`'s
 * class-level `@Index` declaration exactly, because the integration harness
 * builds its schema by `synchronize` rather than by migration (the
 * `order_holds` precedent) — an unnamed index there would hash-name
 * differently and the two schemas would diverge on the very constraint the
 * repository's first-write-wins guarantee (`ON CONFLICT DO NOTHING`) depends
 * on.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderCancellationSignals1878000000000 implements MigrationInterface {
  name = 'CreateOrderCancellationSignals1878000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `id` defaults to uuid_generate_v4() — the same guard 1846/1847/1850 use.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_cancellation_signals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sourceConnectionId" uuid NOT NULL,
        "externalOrderId" text NOT NULL,
        "cancelledAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_cancellation_signals" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_cancellation_signals_source_external"
        ON "order_cancellation_signals" ("sourceConnectionId", "externalOrderId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_order_cancellation_signals_source_external"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_cancellation_signals"`);
  }
}
