/**
 * Create Inventory Locations Migration (#2313, ADR-058 decision 1)
 *
 * `inventory_locations` makes a location a first-class, operator-authored row.
 * Until now `inventory_items.locationId` was a bare nullable `varchar` pointing
 * at nothing — no location table existed anywhere in the tree.
 *
 * `countryIso2`, `postcode` and the optional geo pair land **from day one**
 * (ADR-058 R1 / REVIEW §3 D3): the fulfillment router's filters are
 * unimplementable without them, and the table is cheapest to get right while it
 * is still new and empty.
 *
 * The FK to `connections` is **ON DELETE SET NULL**, following the existing
 * `FK_category_mappings_source_connection` precedent
 * (`1804000000000-neutralise-category-mappings.ts:63`). `ownerConnectionId` is
 * *provenance, never authority* — it records whose sync may write positions
 * here, so deleting the connection must clear that provenance, not delete the
 * operator's warehouse along with it.
 *
 * **No `ALTER TABLE inventory_items` of any kind is performed here.** Existing
 * `locationId` values are unattributable, so constraining that column is a
 * step-(iii)-class change under ADR-058 decision 3 and is deliberately out of
 * scope — the int-spec asserts `inventory_items` gained no foreign key.
 *
 * Column names keep the quoted-camelCase style `inventory_items` already uses in
 * this context, so TypeORM's default naming strategy needs no `name:` overrides.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInventoryLocations1849000000005 implements MigrationInterface {
  name = 'CreateInventoryLocations1849000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inventory_locations" (
        "id" text NOT NULL,
        "code" varchar(64) NOT NULL,
        "name" varchar(255) NOT NULL,
        "kind" varchar(32) NOT NULL,
        "ownerConnectionId" uuid,
        "externalRef" text,
        "status" varchar(16) NOT NULL DEFAULT 'active',
        "countryIso2" varchar(2),
        "postcode" varchar(16),
        "latitude" numeric(9,6),
        "longitude" numeric(9,6),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventory_locations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_inventory_locations_owner_connection"
          FOREIGN KEY ("ownerConnectionId") REFERENCES "connections"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_inventory_locations_code"
      ON "inventory_locations" ("code")
    `);

    // FK join target — not covered by the unique index above. `IF NOT EXISTS`
    // on BOTH indexes, matching the table above: a migration that is idempotent
    // in one statement and not the next fails halfway on a re-run against a
    // partially-applied schema, which is the case idempotence exists for.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inventory_locations_owner_connection"
      ON "inventory_locations" ("ownerConnectionId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_inventory_locations_owner_connection"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_inventory_locations_code"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_locations"`);
  }
}
