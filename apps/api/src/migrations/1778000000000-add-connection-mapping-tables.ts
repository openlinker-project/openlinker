/**
 * Migration: Add connection mapping tables
 *
 * Creates three connection-scoped mapping tables:
 *   - connection_status_mappings  (Allegro order status → PrestaShop status ID)
 *   - connection_carrier_mappings (Allegro delivery method ID → PrestaShop carrier ID)
 *   - connection_payment_mappings (Allegro payment provider → PrestaShop payment module)
 *
 * Each table has a unique constraint on (connection_id, source_value) to
 * enforce one mapping per Allegro value per connection.
 *
 * @module apps/api/src/migrations
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConnectionMappingTables1778000000000 implements MigrationInterface {
  name = 'AddConnectionMappingTables1778000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "connection_status_mappings" (
        "id"                    uuid                NOT NULL DEFAULT gen_random_uuid(),
        "connection_id"         uuid                NOT NULL,
        "allegro_status"        character varying   NOT NULL,
        "prestashop_status_id"  character varying   NOT NULL,
        "created_at"            timestamptz         NOT NULL DEFAULT now(),
        "updated_at"            timestamptz         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_connection_status_mappings_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_connection_status_mappings_conn_status"
          UNIQUE ("connection_id", "allegro_status")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "connection_carrier_mappings" (
        "id"                          uuid                NOT NULL DEFAULT gen_random_uuid(),
        "connection_id"               uuid                NOT NULL,
        "allegro_delivery_method_id"  character varying   NOT NULL,
        "prestashop_carrier_id"       character varying   NOT NULL,
        "created_at"                  timestamptz         NOT NULL DEFAULT now(),
        "updated_at"                  timestamptz         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_connection_carrier_mappings_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_connection_carrier_mappings_conn_method"
          UNIQUE ("connection_id", "allegro_delivery_method_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "connection_payment_mappings" (
        "id"                          uuid                NOT NULL DEFAULT gen_random_uuid(),
        "connection_id"               uuid                NOT NULL,
        "allegro_payment_provider"    character varying   NOT NULL,
        "prestashop_payment_module"   character varying   NOT NULL,
        "created_at"                  timestamptz         NOT NULL DEFAULT now(),
        "updated_at"                  timestamptz         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_connection_payment_mappings_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_connection_payment_mappings_conn_provider"
          UNIQUE ("connection_id", "allegro_payment_provider")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "connection_payment_mappings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "connection_carrier_mappings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "connection_status_mappings"`);
  }
}
