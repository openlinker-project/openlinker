/**
 * Price change episodes (#3142, ADR-072)
 *
 * Creates `price_change_episodes` — the persisted, operator-facing fact that
 * a master catalog price changed and a given (destination connection, source
 * connection) pair hasn't decided what to do about it yet.
 *
 * `UQ_price_change_episodes_open` is PARTIAL on `"resolvedAt" IS NULL` — the
 * `ReservationShortfallEpisode` idiom (see
 * `1861000000000-create-reservation-shortfall-episodes.ts`): while the
 * condition stands, a re-detection CONFLICTS and the conflict arm refreshes
 * the amounts in place, so the episode's id is stable for the life of the
 * open condition; a resolved row leaves the index, so a later re-detection
 * opens a fresh episode under a new id.
 *
 * No foreign keys: `productVariantId`, `destinationConnectionId` and
 * `sourceConnectionId` are all references by value — an episode is evidence
 * of a past detection and must survive a re-mapped variant or a deleted
 * connection rather than cascade away with it.
 *
 * `computedOldAmount` AND `sourceOldAmount` are both nullable (#3159 review,
 * the second amended in after the first): a brand-new mapping's first
 * detection, or a variant that previously carried NO source price at all,
 * has no recorded baseline to report — writing `sourceNewAmount` into a
 * `NOT NULL` `sourceOldAmount` column would fabricate a "changed from N to
 * N" fact the source never asserted. `CHK_price_change_episodes_amounts_non_negative`
 * is unaffected — a Postgres CHECK evaluates to "not violated" on a NULL
 * operand.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePriceChangeEpisodes1878000000000 implements MigrationInterface {
  name = 'CreatePriceChangeEpisodes1878000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "price_change_episodes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "productVariantId" text NOT NULL,
        "destinationConnectionId" uuid NOT NULL,
        "sourceConnectionId" uuid NOT NULL,
        "sourceCurrency" character varying(8) NOT NULL,
        "sourceOldAmount" numeric(14,4),
        "sourceNewAmount" numeric(14,4) NOT NULL,
        "computedOldAmount" numeric(14,4),
        "computedNewAmount" numeric(14,4) NOT NULL,
        "manualPriceOverride" numeric(14,4),
        "manualPriceOverrideSetAt" TIMESTAMP WITH TIME ZONE,
        "blockReason" character varying(32),
        "detectedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "refreshedAt" TIMESTAMP WITH TIME ZONE,
        "resolvedAt" TIMESTAMP WITH TIME ZONE,
        "resolution" character varying(32),
        "resolvedByUserId" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_price_change_episodes" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_price_change_episodes_amounts_non_negative" CHECK (
          "sourceOldAmount" >= 0 AND "sourceNewAmount" >= 0 AND
          "computedOldAmount" >= 0 AND "computedNewAmount" >= 0
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_price_change_episodes_open"
        ON "price_change_episodes" ("productVariantId", "destinationConnectionId", "sourceConnectionId")
        WHERE "resolvedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_price_change_episodes_destination"
        ON "price_change_episodes" ("destinationConnectionId", "resolvedAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_price_change_episodes_source"
        ON "price_change_episodes" ("sourceConnectionId", "resolvedAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_price_change_episodes_source"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_price_change_episodes_destination"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_price_change_episodes_open"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "price_change_episodes"`);
  }
}
