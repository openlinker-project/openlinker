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
 * - `price` is `numeric(12,3)` (#2032 review thread 6): three decimal places,
 *   not two — KWD/BHD/OMR/TND/JOD have three minor units, and Postgres rounds
 *   scale overflow SILENTLY (precision overflow errors instead), so `(10,2)`
 *   would drop those currencies' last digit with no warning. `currency` is
 *   `text` (ISO 4217); `availableQuantity` is `integer`. All three are
 *   independently NULLABLE: a sparse marketplace response must record "not
 *   reported" rather than a fabricated `0`/`0.00`, which an operator cannot
 *   tell apart from a genuine sell-out or a free item.
 * - `CHK_offer_commercial_snapshots_price_currency_pair` enforces
 *   `(price IS NULL) = (currency IS NULL)` — every comparable project
 *   (Vendure/Medusa/Saleor/Spree/Sylius) makes an amount's currency mandatory
 *   whenever the amount itself is present; this is the nullable-schema
 *   equivalent, since `currency` still has to stay nullable for the
 *   "nothing reported" row.
 * - `lastCommercialSyncedAt` is `timestamptz` — an absolute instant set by the
 *   application on each refresh; `createdAt`/`updatedAt` are ALSO `timestamptz`
 *   (#2032 review thread 6) rather than bare `timestamp` — TypeORM's Postgres
 *   driver hardcodes `createDate`/`updateDate` to `timestamp`, which would
 *   otherwise sit inconsistently next to a `timestamptz` business column in
 *   the same row.
 * - Unique index on `(externalOfferId, connectionId)` backs the keyed read +
 *   upsert; a supporting index covers reverse-variant lookup. No
 *   stalest-first index: nothing in this table's write path scans by
 *   `lastCommercialSyncedAt` yet (#2032 review, smaller items) — add one with
 *   the first reader that needs it.
 * - No FK constraints emitted (matches the `offer_status_snapshots` /
 *   `offer_creation_records` convention; cross-context FKs add coupling).
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOfferCommercialSnapshotsTable1833000000001 implements MigrationInterface {
  name = 'AddOfferCommercialSnapshotsTable1833000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "offer_commercial_snapshots" (
        "id"                      uuid NOT NULL DEFAULT uuid_generate_v4(),
        "connectionId"            uuid NOT NULL,
        "externalOfferId"         text NOT NULL,
        "internalVariantId"       text NOT NULL,
        "price"                   numeric(12,3),
        "currency"                text,
        "availableQuantity"       integer,
        "lastCommercialSyncedAt"  TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt"               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt"               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_offer_commercial_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_offer_commercial_snapshots_price_currency_pair"
          CHECK (("price" IS NULL) = ("currency" IS NULL))
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
