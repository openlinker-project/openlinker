import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rename persisted capability token 'Marketplace' → 'OfferManager' as part of
 * the #328 split of `MarketplacePort` into `OrderSourcePort` + `OfferManagerPort`.
 *
 * Allegro connections additionally gain the `'OrderSource'` capability because
 * the split makes Allegro order ingestion flow through `OrderSourcePort` as well.
 *
 * Scoped updates match the house style established in
 * `1780000000000-add-enabled-capabilities-to-connections.ts`:
 * platform-scoped `UPDATE`s with a catch-all `array_replace` at the end so
 * any mis-tagged rows still get their token rewritten.
 */
export class RenameMarketplaceCapability1788000000000 implements MigrationInterface {
  name = 'RenameMarketplaceCapability1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Allegro rows: promote to the new ['OrderSource', 'OfferManager'] set.
    // Only apply when the row currently carries the legacy 'Marketplace' token
    // so operators who already edited the array by hand are left alone.
    await queryRunner.query(
      `UPDATE "connections"
         SET "enabledCapabilities" = '["OrderSource","OfferManager"]'::jsonb
         WHERE (COALESCE("adapterKey", '') = 'allegro.publicapi.v1'
                OR ("adapterKey" IS NULL AND "platformType" = 'allegro'))
           AND "enabledCapabilities" @> '["Marketplace"]'::jsonb`,
    );

    // Catch-all: any remaining 'Marketplace' token on other / unknown platforms
    // gets renamed to 'OfferManager' in place. `array_replace` keeps the rest
    // of the set intact.
    await queryRunner.query(
      `UPDATE "connections"
         SET "enabledCapabilities" = to_jsonb(
               array_replace(
                 ARRAY(SELECT jsonb_array_elements_text("enabledCapabilities")),
                 'Marketplace',
                 'OfferManager'
               )
             )
         WHERE "enabledCapabilities" @> '["Marketplace"]'::jsonb`,
    );

    // Visibility: flag any row we couldn't map so operators can audit it.
    await queryRunner.query(`
      DO $$
      DECLARE empty_count integer;
      BEGIN
        SELECT COUNT(*) INTO empty_count
          FROM "connections"
          WHERE "enabledCapabilities" = '[]'::jsonb;
        IF empty_count > 0 THEN
          RAISE NOTICE
            '[328] % connection row(s) have empty enabledCapabilities after migration. Review via SELECT id, "platformType", "adapterKey" FROM connections WHERE "enabledCapabilities" = ''[]''::jsonb;',
            empty_count;
        END IF;
      END$$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Allegro rows: revert to the pre-split ['Marketplace'] set.
    await queryRunner.query(
      `UPDATE "connections"
         SET "enabledCapabilities" = '["Marketplace"]'::jsonb
         WHERE (COALESCE("adapterKey", '') = 'allegro.publicapi.v1'
                OR ("adapterKey" IS NULL AND "platformType" = 'allegro'))
           AND "enabledCapabilities" @> '["OfferManager"]'::jsonb`,
    );

    // Catch-all: rename any remaining 'OfferManager' token back to 'Marketplace'.
    await queryRunner.query(
      `UPDATE "connections"
         SET "enabledCapabilities" = to_jsonb(
               array_replace(
                 ARRAY(SELECT jsonb_array_elements_text("enabledCapabilities")),
                 'OfferManager',
                 'Marketplace'
               )
             )
         WHERE "enabledCapabilities" @> '["OfferManager"]'::jsonb`,
    );
  }
}
