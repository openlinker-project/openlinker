/**
 * Price change auto-applied log (#3144, ADR-072 decision 3)
 *
 * The lightweight stand-in for a full "Daily digest" mode: one row per price
 * change published without review because its (destination, source) pair is
 * set to `automatic`. Deliberately no foreign keys — same reference-by-value
 * posture as `price_change_episodes` (a log entry must outlive a deleted
 * connection or a re-mapped variant).
 *
 * `oldAmount` is NULLABLE (#3161 review): the first-ever detection for a
 * (variant, destination, source) key carries no baseline
 * (`PriceChangeEpisode.computedOldAmount === null`, #3159) — a brand-new
 * mapping with nothing to compare against. Forcing a NOT NULL column here
 * would require fabricating a number (the shipped bug this migration fixes
 * was `oldAmount === newAmount`); `NULL` is the honest "first observation,
 * no prior price" state and is rendered as such by the FE (#3168).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePriceChangeAutoAppliedLog1879000000000 implements MigrationInterface {
  name = 'CreatePriceChangeAutoAppliedLog1879000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "price_change_auto_applied_log" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "productVariantId" text NOT NULL,
        "destinationConnectionId" uuid NOT NULL,
        "sourceConnectionId" uuid NOT NULL,
        "oldAmount" numeric(14,4),
        "newAmount" numeric(14,4) NOT NULL,
        "currency" character varying(8) NOT NULL,
        "appliedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_price_change_auto_applied_log" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_price_change_auto_applied_log_applied_at"
        ON "price_change_auto_applied_log" ("appliedAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_price_change_auto_applied_log_applied_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "price_change_auto_applied_log"`);
  }
}
