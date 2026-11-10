/**
 * Add Sales Document Batch Runs (#3583, epic #3515)
 *
 * Batch issuing: an order whose sales-document connection batches its kind
 * waits in that connection's queue until a scheduled or operator-started run
 * issues it.
 *
 * 1. `order_records.salesDocumentBlockConnectionId` / `...DocumentKind` - the
 *    target a sales-document block is about. Set for `trigger-model-batched`,
 *    where it is the order's place in the queue. Nullable, no backfill: a
 *    batched block written before this migration came from the gate that only
 *    threw, carries no target, and is re-evaluated on the order's next
 *    transition.
 * 2. `IDX_order_records_sales_document_batch_queue` - partial on the one reason
 *    that means "queued", keyed for the keyset read a run pages with.
 * 3. `sales_document_batch_runs` - one row per run. The partial unique index
 *    `UQ_sales_document_batch_runs_running` is the overlap guard: at most one
 *    `running` run per connection, refused by the database.
 * 4. `sales_document_batch_run_items` - what a run did with each order; its
 *    rows go with the run (`ON DELETE CASCADE`).
 *
 * `IF [NOT] EXISTS` keeps up/down idempotent.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSalesDocumentBatchRuns1938780000000 implements MigrationInterface {
  name = 'AddSalesDocumentBatchRuns1938780000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "salesDocumentBlockConnectionId" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "salesDocumentBlockDocumentKind" text`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_records_sales_document_batch_queue" ` +
        `ON "order_records" ("salesDocumentBlockConnectionId", "internalOrderId") ` +
        `WHERE "salesDocumentBlockReason" = 'trigger-model-batched'`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "sales_document_batch_runs" (
        "id" text NOT NULL,
        "connectionId" uuid NOT NULL,
        "trigger" text NOT NULL,
        "documentKinds" jsonb NOT NULL,
        "segment" text NOT NULL,
        "slotAt" TIMESTAMP WITH TIME ZONE,
        "status" text NOT NULL,
        "failureReason" text,
        "eligibleCount" integer NOT NULL DEFAULT 0,
        "enqueuedCount" integer NOT NULL DEFAULT 0,
        "blockedCount" integer NOT NULL DEFAULT 0,
        "startedByUserId" uuid,
        "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_sales_document_batch_runs" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sales_document_batch_runs_connection_started" ` +
        `ON "sales_document_batch_runs" ("connectionId", "startedAt")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_sales_document_batch_runs_running" ` +
        `ON "sales_document_batch_runs" ("connectionId") WHERE "status" = 'running'`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "sales_document_batch_run_items" (
        "id" uuid NOT NULL,
        "runId" text NOT NULL,
        "orderId" text NOT NULL,
        "documentKind" text,
        "result" text NOT NULL,
        "blockReason" text,
        "idempotencyKey" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sales_document_batch_run_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_sales_document_batch_run_items_run" FOREIGN KEY ("runId")
          REFERENCES "sales_document_batch_runs" ("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sales_document_batch_run_items_run" ` +
        `ON "sales_document_batch_run_items" ("runId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "sales_document_batch_run_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sales_document_batch_runs"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_order_records_sales_document_batch_queue"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "salesDocumentBlockDocumentKind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "salesDocumentBlockConnectionId"`,
    );
  }
}
