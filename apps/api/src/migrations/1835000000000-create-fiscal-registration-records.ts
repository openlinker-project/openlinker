/**
 * Create Fiscal Registration Records Table Migration
 *
 * Creates `fiscal_registration_records` - OL's neutral projection of one attempt
 * to register a completed sale with a provider that performs or brokers the
 * fiscal registration (#1908, ADR-042).
 *
 * Two details differ from the `invoice_records` precedent on purpose:
 *
 *   1. `idempotencyKey` is NOT NULL and its unique index is PLAIN, not partial.
 *      Invoicing's key is optional, so its index has to exempt null rows;
 *      fiscalization has no keyless mode (ADR-042 decision 6), so there is
 *      nothing to exempt and the guard covers every row.
 *   2. `regimeExtras` is an adapter-owned jsonb bag with NO index on any key
 *      inside it. Indexing one would promote a regime-specific key into the
 *      shared contract, which ADR-042 decision 4 forbids.
 *
 * No FK to `order_records` (plain indexed `text`, matching the
 * `invoice_records.orderId` / `refund_records.internalOrderId` precedent):
 * existence is verified at the application layer, avoiding cross-table lock
 * coupling.
 *
 * Generated: 2026-08-14 (synthetic sequential prefix per docs/migrations.md #1013).
 * Re-prefixed 1834000000000 -> 1835000000000: that slot collided with a
 * different in-flight migration on another open PR (#2135's order-FX-stamp
 * table) - `check-migration-timestamps.mjs` only compares against
 * `origin/main`, so it can't see a sibling branch's choice.
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFiscalRegistrationRecords1835000000000 implements MigrationInterface {
  name = 'CreateFiscalRegistrationRecords1835000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    const table = await queryRunner.getTable('fiscal_registration_records');
    if (table) {
      return;
    }

    await queryRunner.query(`
      CREATE TABLE "fiscal_registration_records" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "connectionId" uuid NOT NULL,
        "orderId" text NOT NULL,
        "providerType" text NOT NULL,
        "idempotencyKey" text NOT NULL,
        "status" text NOT NULL,
        "providerReference" text,
        "documentReference" text,
        "signingIdentity" text,
        "registeredAt" TIMESTAMP WITH TIME ZONE,
        "regimeExtras" jsonb,
        "artefacts" jsonb,
        "failureMode" text,
        "failureReason" text,
        "errorMessage" text,
        "leaseExpiresAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fiscal_registration_records" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_fiscal_registration_records_order_connection"
        ON "fiscal_registration_records" ("orderId", "connectionId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_fiscal_registration_records_connectionId"
        ON "fiscal_registration_records" ("connectionId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_fiscal_registration_records_status"
        ON "fiscal_registration_records" ("status")
    `);

    // Exactly-once guard. PLAIN unique - the key is NOT NULL, so unlike
    // `invoice_records` there is no null-key row for a partial predicate to
    // exempt. Half of the guarantee; the atomic in-flight claim in the
    // repository is the other half.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_fiscal_registration_records_connection_idempotency"
        ON "fiscal_registration_records" ("connectionId", "idempotencyKey")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_fiscal_registration_records_connection_idempotency"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_fiscal_registration_records_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_fiscal_registration_records_connectionId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_fiscal_registration_records_order_connection"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "fiscal_registration_records"`);
  }
}
