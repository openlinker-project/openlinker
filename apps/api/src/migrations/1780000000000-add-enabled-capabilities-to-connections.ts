import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEnabledCapabilitiesToConnections1780000000000 implements MigrationInterface {
  name = 'AddEnabledCapabilitiesToConnections1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "connections" ADD COLUMN "enabledCapabilities" jsonb NOT NULL DEFAULT '[]'`,
    );

    // Backfill existing rows with the full supported capability set for their
    // resolved adapter. Hardcoded per known adapterKey / platformType fallback
    // to match AdapterRegistryService at time of writing. Unknown rows stay at
    // '[]' and are logged so operators can fix them manually.
    await queryRunner.query(
      `UPDATE "connections"
         SET "enabledCapabilities" =
           '["ProductMaster","InventoryMaster","OrderSource","OrderProcessorManager"]'::jsonb
         WHERE COALESCE("adapterKey", '') = 'prestashop.webservice.v1'
            OR ("adapterKey" IS NULL AND "platformType" = 'prestashop')`,
    );

    await queryRunner.query(
      `UPDATE "connections"
         SET "enabledCapabilities" = '["Marketplace"]'::jsonb
         WHERE COALESCE("adapterKey", '') = 'allegro.publicapi.v1'
            OR ("adapterKey" IS NULL AND "platformType" = 'allegro')`,
    );

    // GIN index so `listCapabilityAdapters` can filter by a single capability
    // without scanning every active connection when this grows past hundreds.
    await queryRunner.query(
      `CREATE INDEX "IDX_connections_enabled_capabilities" ON "connections" USING gin ("enabledCapabilities" jsonb_path_ops)`,
    );

    await queryRunner.query(`
      DO $$
      DECLARE unknown_count integer;
      BEGIN
        SELECT COUNT(*) INTO unknown_count
          FROM "connections"
          WHERE "enabledCapabilities" = '[]'::jsonb;
        IF unknown_count > 0 THEN
          RAISE NOTICE
            '[166] % connection row(s) left with empty enabledCapabilities — unknown adapterKey/platformType. Review via SELECT id, "platformType", "adapterKey" FROM connections WHERE "enabledCapabilities" = ''[]''::jsonb;',
            unknown_count;
        END IF;
      END$$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_connections_enabled_capabilities"`,
    );
    await queryRunner.query(
      `ALTER TABLE "connections" DROP COLUMN "enabledCapabilities"`,
    );
  }
}
