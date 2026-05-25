/**
 * Add offer_status_snapshots table (#816)
 *
 * Persists the periodically-refreshed marketplace publication status of mapped
 * offers (the steady-state `marketplace.offer.statusSync` job). Distinct from
 * `offer_creation_records` (one-shot creation lifecycle): this table is
 * long-lived and re-read on a schedule so operators can see when an offer goes
 * `ended` / `inactive` without opening each listing.
 *
 * Schema notes:
 * - `id` is `uuid DEFAULT uuid_generate_v4()` matching the listings/products
 *   `@PrimaryGeneratedColumn('uuid')` convention (e.g. `offer_creation_records`).
 * - `connectionId` is `uuid` (connections use uuid PKs); `externalOfferId` and
 *   `internalVariantId` are `text` (marketplace offer ids and `ol_variant_*`
 *   internal ids are stored as text elsewhere).
 * - `lastStatusSyncedAt` is `timestamptz` — an absolute instant set by the
 *   application on each refresh; `createdAt`/`updatedAt` follow the
 *   `TIMESTAMP DEFAULT now()` convention used by the ORM date columns.
 * - Unique index on `(externalOfferId, connectionId)` backs the keyed read +
 *   upsert; supporting indexes cover reverse-variant lookup, stalest-first
 *   ordering, and per-connection status aggregation.
 * - No FK constraints emitted (matches the recent `offer_creation_records` /
 *   `bulk_offer_creation_batches` convention; cross-context FKs add coupling).
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOfferStatusSnapshotsTable1799000000002 implements MigrationInterface {
  name = 'AddOfferStatusSnapshotsTable1799000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "offer_status_snapshots" (
        "id"                  uuid NOT NULL DEFAULT uuid_generate_v4(),
        "connectionId"        uuid NOT NULL,
        "externalOfferId"     text NOT NULL,
        "internalVariantId"   text NOT NULL,
        "publicationStatus"   text NOT NULL,
        "statusDetails"       jsonb,
        "lastStatusSyncedAt"  TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt"           TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_offer_status_snapshots" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_offer_status_snapshots_offer_connection" ON "offer_status_snapshots" ("externalOfferId", "connectionId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_offer_status_snapshots_variant" ON "offer_status_snapshots" ("internalVariantId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_offer_status_snapshots_lastSyncedAt" ON "offer_status_snapshots" ("lastStatusSyncedAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_offer_status_snapshots_connection_status" ON "offer_status_snapshots" ("connectionId", "publicationStatus")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_offer_status_snapshots_connection_status"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_offer_status_snapshots_lastSyncedAt"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_offer_status_snapshots_variant"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_offer_status_snapshots_offer_connection"`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "offer_status_snapshots"`);
  }
}
