/**
 * Add offer_commercial_snapshots table (#2024)
 *
 * Persists the periodically-refreshed channel-side price/currency/available
 * quantity of mapped offers, written by the SAME `marketplace.offer.statusSync`
 * job that already writes `offer_status_snapshots` (#816) — no new job, no new
 * marketplace HTTP call. Mirrors that table's shape and conventions exactly.
 *
 * Schema notes:
 * - `id` is `uuid DEFAULT uuid_generate_v4()`, matching the
 *   `offer_status_snapshots` / `offer_creation_records` convention.
 * - `connectionId` is `uuid` (connections use uuid PKs); `externalOfferId` and
 *   `internalVariantId` are `text` (marketplace offer ids and `ol_variant_*`
 *   internal ids are stored as text elsewhere).
 * - `price` is `numeric` (decimal string round-trips losslessly through
 *   TypeORM); `currency` is `text` (ISO 4217); `availableQuantity` is `integer`.
 * - `lastCommercialSyncedAt` is `timestamptz` — an absolute instant set by the
 *   application on each refresh; `createdAt`/`updatedAt` follow the
 *   `TIMESTAMP DEFAULT now()` convention used by the ORM date columns.
 * - Unique index on `(externalOfferId, connectionId)` backs the keyed read +
 *   upsert; a supporting index covers reverse-variant lookup.
 * - No FK constraints emitted (matches the `offer_status_snapshots` /
 *   `offer_creation_records` convention; cross-context FKs add coupling).
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOfferCommercialSnapshotsTable1832000000008 implements MigrationInterface {
  name = 'AddOfferCommercialSnapshotsTable1832000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "offer_commercial_snapshots" (
        "id"                      uuid NOT NULL DEFAULT uuid_generate_v4(),
        "connectionId"            uuid NOT NULL,
        "externalOfferId"         text NOT NULL,
        "internalVariantId"       text NOT NULL,
        "price"                   numeric NOT NULL,
        "currency"                text NOT NULL,
        "availableQuantity"       integer NOT NULL,
        "lastCommercialSyncedAt"  TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt"               TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"               TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_offer_commercial_snapshots" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_offer_commercial_snapshots_offer_connection" ON "offer_commercial_snapshots" ("externalOfferId", "connectionId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_offer_commercial_snapshots_variant" ON "offer_commercial_snapshots" ("internalVariantId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_offer_commercial_snapshots_variant"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_offer_commercial_snapshots_offer_connection"`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "offer_commercial_snapshots"`);
  }
}
